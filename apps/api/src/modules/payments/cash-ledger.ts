import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Transaction } from '../../database/database.service.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { nextDocumentNumber } from '../../database/schema/sequences.schema.js';
import {
  cashDisbursements,
  cashTransfers,
  financialAccountEntries,
  financialAccounts,
} from './payments.schema.js';

/**
 * Cash custody ledger (ADR-0090): the only place that changes register and treasury
 * balances. A register's drawer and a branch treasury are accounts of the same append-only
 * ledger, so a transfer is two entries (− from, + to) and cash is never counted twice.
 *
 * Lock order everywhere: the shift row (if any) first, then account rows sorted by id
 * ({@link lockAccounts}), so concurrent writers never deadlock.
 */

export type EntryType =
  | 'payment'
  | 'fee'
  | 'refund'
  | 'cash_movement'
  | 'transfer'
  | 'adjustment'
  | 'expense'
  | 'supplier_payment';

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

/** The company account holding cash sent between branches (ADR-0091). */
export async function ensureInTransitAccount(tx: Transaction, merchantId: string): Promise<void> {
  await tx
    .insert(financialAccounts)
    .values({
      id: newId(),
      merchantId,
      kind: 'in_transit',
      nameAr: 'نقد قيد النقل',
      nameEn: 'Cash in transit',
    })
    .onConflictDoNothing();
}

export async function inTransitAccount(tx: Transaction, merchantId: string): Promise<string> {
  await ensureInTransitAccount(tx, merchantId);
  const [row] = await tx
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .where(eq(financialAccounts.kind, 'in_transit'));
  return row!.id;
}

/** The company account holding cash deposited but not yet confirmed by the bank (BR-168). */
export async function ensureDepositTransitAccount(
  tx: Transaction,
  merchantId: string,
): Promise<void> {
  await tx
    .insert(financialAccounts)
    .values({
      id: newId(),
      merchantId,
      kind: 'deposit_transit',
      nameAr: 'إيداعات في الطريق',
      nameEn: 'Deposits in transit',
    })
    .onConflictDoNothing();
}

export async function depositTransitAccount(tx: Transaction, merchantId: string): Promise<string> {
  await ensureDepositTransitAccount(tx, merchantId);
  const [row] = await tx
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .where(eq(financialAccounts.kind, 'deposit_transit'));
  return row!.id;
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
 * Moves cash between two custody accounts (register ↔ treasury, into deposits in transit and on
 * to a bank, or through the in-transit account): a transfer record and its two ledger entries.
 * The caller holds the locks and has checked the source balance.
 */
export async function postTransfer(
  tx: Transaction,
  args: {
    merchantId: string;
    fromAccountId: string;
    toAccountId: string;
    amountMinor: bigint;
    origin:
      | 'pos_movement'
      | 'manager'
      | 'deposit'
      | 'branch_transfer'
      | 'deposit_confirmation'
      | 'deposit_return';
    cashMovementId?: string | null;
    branchTransferId?: string | null;
    /** Deposits: the bank the cash is meant for. */
    targetAccountId?: string | null;
    /** Confirmations and returns: the deposit in transit being settled. */
    confirmsTransferId?: string | null;
    reference?: string | null;
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
    branchTransferId: args.branchTransferId ?? null,
    targetAccountId: args.targetAccountId ?? null,
    confirmsTransferId: args.confirmsTransferId ?? null,
    reference: args.reference ?? null,
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

/**
 * Pays cash out of a register or treasury as a real outflow (ADR-0091): an expense or a
 * supplier payment, with its single ledger entry. A reversal posts the same amount back.
 * The caller holds the locks and has checked the balance (not needed for a reversal).
 */
export async function postDisbursement(
  tx: Transaction,
  args: {
    merchantId: string;
    branchId: string;
    sourceAccountId: string;
    shiftId: string | null;
    cashMovementId?: string | null;
    kind: 'expense' | 'supplier_payment';
    category: string | null;
    supplierId: string | null;
    purchaseOrderId: string | null;
    amountMinor: bigint;
    description: string | null;
    receiptReference: string | null;
    reversesId?: string | null;
    idempotencyKey?: string | null;
    userId: string;
  },
): Promise<string> {
  const id = newId();
  const number = await nextDocumentNumber(
    tx,
    args.merchantId,
    args.kind === 'expense' ? 'cash_expense' : 'supplier_payment',
    args.kind === 'expense' ? 'EX' : 'SP',
  );
  await tx.insert(cashDisbursements).values({
    id,
    merchantId: args.merchantId,
    number,
    branchId: args.branchId,
    sourceAccountId: args.sourceAccountId,
    shiftId: args.shiftId,
    cashMovementId: args.cashMovementId ?? null,
    kind: args.kind,
    category: args.category,
    supplierId: args.supplierId,
    purchaseOrderId: args.purchaseOrderId,
    amountMinor: args.amountMinor,
    description: args.description,
    receiptReference: args.receiptReference,
    reversesId: args.reversesId ?? null,
    idempotencyKey: args.idempotencyKey ?? null,
    createdByUserId: args.userId,
  });
  await postEntries(tx, [
    {
      merchantId: args.merchantId,
      accountId: args.sourceAccountId,
      amountMinor: args.reversesId ? args.amountMinor : -args.amountMinor,
      entryType: args.kind,
      sourceType: 'cash_disbursement',
      sourceId: id,
      description: args.description,
      createdByUserId: args.userId,
      shiftId: args.shiftId,
    },
  ]);
  return id;
}

/** An active bank account of the merchant (deposit target). */
export async function activeBankAccount(tx: Transaction, id: string): Promise<string> {
  const [row] = await tx
    .select({ id: financialAccounts.id })
    .from(financialAccounts)
    .where(
      and(
        eq(financialAccounts.id, id),
        eq(financialAccounts.kind, 'bank'),
        eq(financialAccounts.status, 'active'),
      ),
    );
  if (!row)
    throw new AppError(400, 'TRANSFER_NOT_ALLOWED', 'Choose an active bank account.', [
      { path: 'bankAccountId', code: 'invalid', message: 'Choose an active bank account.' },
    ]);
  return row.id;
}
