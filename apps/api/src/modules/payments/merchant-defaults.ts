import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Transaction } from '../../database/database.service.js';
import { newId } from '../../kernel/ids.js';
import { branches } from '../branches/branches.schema.js';
import { registers } from '../registers/registers.schema.js';
import {
  ensureBranchTreasury,
  ensureInTransitAccount,
  ensureRegisterAccount,
} from './cash-ledger.js';
import { financialAccounts, paymentMethods } from './payments.schema.js';

type AccountKey = 'bank1' | 'bank2';

/**
 * Starting bank accounts (ADR-0089). Cash has no account here: it settles into the drawer of
 * the register that took it, and branch treasuries hold the rest (ADR-0090).
 */
const DEFAULT_ACCOUNTS: { key: AccountKey; kind: string; nameEn: string; nameAr: string }[] = [
  { key: 'bank1', kind: 'bank', nameEn: 'Bank account 1', nameAr: 'الحساب البنكي 1' },
  { key: 'bank2', kind: 'bank', nameEn: 'Bank account 2', nameAr: 'الحساب البنكي 2' },
];

/**
 * Starting payment methods, each settling into an internal balance so every payment (and
 * its fee) is recorded in a ledger. No fees by default: the owner enters the real rates.
 */
const DEFAULT_METHODS: {
  kind: string;
  nameEn: string;
  nameAr: string;
  /** null: cash settles into the register drawer, never into a fixed account. */
  account: AccountKey | null;
  /** Recognises an equivalent method a merchant already has, so it is not added twice. */
  matches: (m: { kind: string; nameEn: string | null; nameAr: string | null }) => boolean;
}[] = [
  {
    kind: 'cash',
    nameEn: 'Cash',
    nameAr: 'نقدًا',
    account: null,
    matches: (m) => m.kind === 'cash',
  },
  {
    kind: 'card',
    nameEn: 'Card (KNET)',
    nameAr: 'بطاقة (كي نت)',
    account: 'bank1',
    matches: (m) => /knet/i.test(m.nameEn ?? '') || /كي ?نت/.test(m.nameAr ?? ''),
  },
  {
    kind: 'card',
    nameEn: 'Visa / Mastercard',
    nameAr: 'فيزا / ماستركارد',
    account: 'bank2',
    matches: (m) => /visa|master/i.test(m.nameEn ?? '') || /فيزا|ماستر/.test(m.nameAr ?? ''),
  },
  {
    kind: 'custom',
    nameEn: 'Payment link',
    nameAr: 'رابط دفع',
    account: 'bank1',
    matches: (m) => /link/i.test(m.nameEn ?? '') || /رابط/.test(m.nameAr ?? ''),
  },
  {
    kind: 'bank_transfer',
    nameEn: 'WAMD',
    nameAr: 'ومض',
    account: 'bank1',
    matches: (m) => /wamd/i.test(m.nameEn ?? '') || /ومض/.test(m.nameAr ?? ''),
  },
];

/**
 * Gives a merchant the default payment configuration (ADR-0089) once: the internal
 * balances, the default methods it lacks, and an internal balance for every method that
 * settles nowhere. A merchant that already has any internal balance has been
 * set up (by this or by its owner) and is left untouched, so later runs never re-add a
 * method the owner renamed or relink one. Used at merchant creation and by the `004` seed.
 */
export async function ensureDefaultPaymentSetup(tx: Transaction, merchantId: string) {
  // Registers and treasuries are custody accounts, created with their branch and register.
  const existing = await tx.execute(
    sql`select 1 from financial_accounts where merchant_id = ${merchantId}
        and kind not in ('register', 'treasury', 'in_transit') limit 1`,
  );
  if (existing.rows.length > 0) return { accounts: 0, added: 0, linked: 0 };
  const ids = {} as Record<AccountKey, string | null>;
  for (const a of DEFAULT_ACCOUNTS) {
    const accountId = newId();
    ids[a.key] = accountId;
    await tx.insert(financialAccounts).values({
      id: accountId,
      merchantId,
      kind: a.kind,
      nameEn: a.nameEn,
      nameAr: a.nameAr,
    });
  }
  const methods = await tx
    .select({
      id: paymentMethods.id,
      kind: paymentMethods.kind,
      nameEn: paymentMethods.nameEn,
      nameAr: paymentMethods.nameAr,
      financialAccountId: paymentMethods.financialAccountId,
    })
    .from(paymentMethods)
    .where(eq(paymentMethods.merchantId, merchantId));
  let added = 0;
  let linked = 0;
  for (const [index, d] of DEFAULT_METHODS.entries()) {
    const account = d.account ? ids[d.account] : null;
    const found = methods.find((m) => d.matches(m));
    if (!found) {
      await tx.insert(paymentMethods).values({
        id: newId(),
        merchantId,
        kind: d.kind,
        nameEn: d.nameEn,
        nameAr: d.nameAr,
        financialAccountId: account,
        availableInPos: true,
        sortOrder: index,
      });
      added++;
    } else if (!found.financialAccountId && account) {
      await tx
        .update(paymentMethods)
        .set({ financialAccountId: account, version: sql`${paymentMethods.version} + 1` })
        .where(and(eq(paymentMethods.id, found.id), isNull(paymentMethods.financialAccountId)));
      linked++;
    }
  }
  // Any other non-cash method that settles nowhere (e.g. an older «Bank transfer») goes to
  // the first bank account, so no payment is left outside a ledger.
  const matched = new Set(
    DEFAULT_METHODS.map((d) => methods.find((m) => d.matches(m))?.id).filter(Boolean),
  );
  for (const m of methods) {
    if (matched.has(m.id) || m.financialAccountId || m.kind === 'cash') continue;
    await tx
      .update(paymentMethods)
      .set({ financialAccountId: ids.bank1, version: sql`${paymentMethods.version} + 1` })
      .where(and(eq(paymentMethods.id, m.id), isNull(paymentMethods.financialAccountId)));
    linked++;
  }
  return { accounts: DEFAULT_ACCOUNTS.length, added, linked };
}

/**
 * Every branch starts with one register ("Register 1"), its treasury, and a cash account
 * for each of its registers (ADR-0090). Idempotent; seed 003 repairs any missing piece.
 */
export async function ensureDefaultRegister(tx: Transaction, merchantId: string, branchId: string) {
  const existing = await tx.execute(
    sql`select 1 from registers where merchant_id = ${merchantId} and branch_id = ${branchId} limit 1`,
  );
  let added = 0;
  if (existing.rows.length === 0) {
    await tx.insert(registers).values({
      id: newId(),
      merchantId,
      branchId,
      code: 'R1',
      nameEn: 'Register 1',
      nameAr: 'الصندوق 1',
    });
    added = 1;
  }
  const [branch] = await tx
    .select({ id: branches.id, nameEn: branches.nameEn, nameAr: branches.nameAr })
    .from(branches)
    .where(and(eq(branches.merchantId, merchantId), eq(branches.id, branchId)));
  if (branch) await ensureBranchTreasury(tx, merchantId, branch);
  await ensureInTransitAccount(tx, merchantId);
  for (const r of await tx
    .select({
      id: registers.id,
      branchId: registers.branchId,
      nameEn: registers.nameEn,
      nameAr: registers.nameAr,
    })
    .from(registers)
    .where(and(eq(registers.merchantId, merchantId), eq(registers.branchId, branchId))))
    await ensureRegisterAccount(tx, merchantId, r);
  return added;
}
