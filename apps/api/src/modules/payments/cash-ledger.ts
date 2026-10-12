import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Transaction } from '../../database/database.service.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { cashTransfers, financialAccountEntries, financialAccounts } from './payments.schema.js';

/**
 * Cash custody ledger (ADR-0090): the only place that changes register and treasury
 * balances. A register's drawer and a branch treasury are accounts of the same append-only
 * ledger, so a transfer is two entries (− from, + to) and cash is never counted twice.
 *
 * Lock order everywhere: the shift row (if any) first, then account rows sorted by id
 * ({@link lockAccounts}), so concurrent writers never deadlock.
 */

export type EntryType = 'payment' | 'fee' | 'refund' | 'cash_movement' | 'transfer' | 'adjustment';

export interface Entry {
  merchantId: string;
  accountId: string;
  amountMinor: bigint;
  entryType: EntryType;
  sourceType: string;
  sourceId: string;
  description?: string | null;
  createdByUserId: string | null;
  /** Required for register entries while the register has an open shift (DB trigger). */
  shiftId?: string | null;
}

export async function postEntries(tx: Transaction, entries: Entry[]): Promise<void> {
  const rows = entries.filter((e) => e.amountMinor !== 0n);
  if (rows.length === 0) return;
  await tx.insert(financialAccountEntries).values(
    rows.map((e) => ({
      id: newId(),
      merchantId: e.merchantId,
      accountId: e.accountId,
      amountMinor: e.amountMinor,
      entryType: e.entryType,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      description: e.description ?? null,
      createdByUserId: e.createdByUserId,
      shiftId: e.shiftId ?? null,
    })),
  );
}

/** Locks account rows (sorted by id) so balances read afterwards cannot change underneath. */
export async function lockAccounts(tx: Transaction, ids: string[]): Promise<void> {
  const sorted = [...new Set(ids)].sort();
  if (sorted.length === 0) return;
  await tx
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .where(inArray(financialAccounts.id, sorted))
    .orderBy(financialAccounts.id)
    .for('update');
}

export async function accountBalance(tx: Transaction, accountId: string): Promise<bigint> {
  const [row] = (
    await tx.execute(sql`select coalesce(sum(amount_minor), 0)::text as balance
      from financial_account_entries where account_id = ${accountId}`)
  ).rows as { balance: string }[];
  return BigInt(row!.balance);
}

export interface CustodyAccount {
  id: string;
  branchId: string;
  countedAt: Date | null;
  status: string;
}

/** The drawer account of a register (created with the register; repaired by seed 005). */
export async function registerAccount(
  tx: Transaction,
  registerId: string,
): Promise<CustodyAccount> {
  const [row] = await tx
    .select({
      id: financialAccounts.id,
      branchId: financialAccounts.branchId,
      countedAt: financialAccounts.countedAt,
      status: financialAccounts.status,
    })
    .from(financialAccounts)
    .where(
      and(eq(financialAccounts.kind, 'register'), eq(financialAccounts.registerId, registerId)),
    );
  if (!row) throw new AppError(500, 'INTERNAL_ERROR', 'The register has no cash account.');
  return { ...row, branchId: row.branchId! };
}

/** The treasury of a branch. */
export async function branchTreasury(tx: Transaction, branchId: string): Promise<CustodyAccount> {
  const [row] = await tx
    .select({
      id: financialAccounts.id,
      branchId: financialAccounts.branchId,
      countedAt: financialAccounts.countedAt,
      status: financialAccounts.status,
    })
    .from(financialAccounts)
    .where(and(eq(financialAccounts.kind, 'treasury'), eq(financialAccounts.branchId, branchId)));
  if (!row) throw new AppError(500, 'INTERNAL_ERROR', 'The branch has no treasury.');
  return { ...row, branchId: row.branchId! };
}

export async function ensureBranchTreasury(
  tx: Transaction,
  merchantId: string,
  branch: { id: string; nameEn: string | null; nameAr: string | null },
): Promise<void> {
  await tx
    .insert(financialAccounts)
    .values({
      id: newId(),
      merchantId,
      kind: 'treasury',
      branchId: branch.id,
      nameAr: `خزينة ${branch.nameAr ?? branch.nameEn}`,
      nameEn: `${branch.nameEn ?? branch.nameAr} treasury`,
    })
    .onConflictDoNothing();
}

export async function ensureRegisterAccount(
  tx: Transaction,
  merchantId: string,
  register: { id: string; branchId: string; nameEn: string | null; nameAr: string | null },
): Promise<void> {
  await tx
    .insert(financialAccounts)
    .values({
      id: newId(),
      merchantId,
      kind: 'register',
      branchId: register.branchId,
      registerId: register.id,
      nameAr: register.nameAr ?? register.nameEn,
      nameEn: register.nameEn ?? register.nameAr,
    })
    .onConflictDoNothing();
}

/**
 * Moves cash between a register and its branch treasury: a transfer record and its two
 * ledger entries. The caller holds the locks and has checked the source balance.
 */
export async function postTransfer(
  tx: Transaction,
  args: {
    merchantId: string;
    fromAccountId: string;
    toAccountId: string;
    amountMinor: bigint;
    origin: 'pos_movement' | 'manager';
    cashMovementId?: string | null;
    note?: string | null;
    idempotencyKey?: string | null;
    userId: string;
    /** The open shift of the register side, if any. */
    fromShiftId?: string | null;
    toShiftId?: string | null;
  },
): Promise<string> {
  const id = newId();
  await tx.insert(cashTransfers).values({
    id,
    merchantId: args.merchantId,
    fromAccountId: args.fromAccountId,
    toAccountId: args.toAccountId,
    amountMinor: args.amountMinor,
    origin: args.origin,
    cashMovementId: args.cashMovementId ?? null,
    note: args.note ?? null,
    idempotencyKey: args.idempotencyKey ?? null,
    createdByUserId: args.userId,
  });
  await postEntries(tx, [
    {
      merchantId: args.merchantId,
      accountId: args.fromAccountId,
      amountMinor: -args.amountMinor,
      entryType: 'transfer',
      sourceType: 'cash_transfer',
      sourceId: id,
      description: args.note,
      createdByUserId: args.userId,
      shiftId: args.fromShiftId ?? null,
    },
    {
      merchantId: args.merchantId,
      accountId: args.toAccountId,
      amountMinor: args.amountMinor,
      entryType: 'transfer',
      sourceType: 'cash_transfer',
      sourceId: id,
      description: args.note,
      createdByUserId: args.userId,
      shiftId: args.toShiftId ?? null,
    },
  ]);
  return id;
}

/** Treasuries pay nothing out before their first physical count (ADR-0090 cutover). */
export function assertTreasuryCounted(treasury: CustodyAccount): void {
  if (!treasury.countedAt)
    throw new AppError(
      409,
      'TREASURY_NOT_COUNTED',
      'Record the treasury’s opening count before taking cash out of it.',
    );
}

export function assertCovers(balance: bigint, amount: bigint, kind: 'register' | 'treasury') {
  if (amount > balance)
    throw kind === 'register'
      ? new AppError(409, 'INSUFFICIENT_CASH', 'The drawer does not hold this much cash.')
      : new AppError(
          409,
          'INSUFFICIENT_TREASURY_CASH',
          'The treasury does not hold this much cash.',
        );
}
