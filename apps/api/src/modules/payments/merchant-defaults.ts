import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Transaction } from '../../database/database.service.js';
import { newId } from '../../kernel/ids.js';
import { registers } from '../registers/registers.schema.js';
import { financialAccounts, paymentMethods } from './payments.schema.js';

type AccountKey = 'cash' | 'bank1' | 'bank2';

/** Starting internal balances: the shop's cash box and two bank accounts (ADR-0089). */
const DEFAULT_ACCOUNTS: { key: AccountKey; kind: string; nameEn: string; nameAr: string }[] = [
  { key: 'cash', kind: 'cash', nameEn: 'Cash box', nameAr: 'صندوق النقد' },
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
  account: AccountKey;
  /** Recognises an equivalent method a merchant already has, so it is not added twice. */
  matches: (m: { kind: string; nameEn: string | null; nameAr: string | null }) => boolean;
}[] = [
  {
    kind: 'cash',
    nameEn: 'Cash',
    nameAr: 'نقدًا',
    account: 'cash',
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
  const existing = await tx.execute(
    sql`select 1 from financial_accounts where merchant_id = ${merchantId} limit 1`,
  );
  if (existing.rows.length > 0) return { accounts: 0, added: 0, linked: 0 };
  const ids = {} as Record<AccountKey, string>;
  for (const a of DEFAULT_ACCOUNTS) {
    ids[a.key] = newId();
    await tx.insert(financialAccounts).values({
      id: ids[a.key],
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
    const found = methods.find((m) => d.matches(m));
    if (!found) {
      await tx.insert(paymentMethods).values({
        id: newId(),
        merchantId,
        kind: d.kind,
        nameEn: d.nameEn,
        nameAr: d.nameAr,
        financialAccountId: ids[d.account],
        availableInPos: true,
        sortOrder: index,
      });
      added++;
    } else if (!found.financialAccountId) {
      await tx
        .update(paymentMethods)
        .set({ financialAccountId: ids[d.account], version: sql`${paymentMethods.version} + 1` })
        .where(and(eq(paymentMethods.id, found.id), isNull(paymentMethods.financialAccountId)));
      linked++;
    }
  }
  // Any other method that settles nowhere (e.g. an older «Bank transfer») goes to the
  // first bank account, so no payment is left outside a ledger.
  const matched = new Set(
    DEFAULT_METHODS.map((d) => methods.find((m) => d.matches(m))?.id).filter(Boolean),
  );
  for (const m of methods) {
    if (matched.has(m.id) || m.financialAccountId) continue;
    await tx
      .update(paymentMethods)
      .set({
        financialAccountId: m.kind === 'cash' ? ids.cash : ids.bank1,
        version: sql`${paymentMethods.version} + 1`,
      })
      .where(and(eq(paymentMethods.id, m.id), isNull(paymentMethods.financialAccountId)));
    linked++;
  }
  return { accounts: DEFAULT_ACCOUNTS.length, added, linked };
}

/** Every branch starts with one register ("Register 1"). Idempotent. */
export async function ensureDefaultRegister(tx: Transaction, merchantId: string, branchId: string) {
  const existing = await tx.execute(
    sql`select 1 from registers where merchant_id = ${merchantId} and branch_id = ${branchId} limit 1`,
  );
  if (existing.rows.length > 0) return 0;
  await tx.insert(registers).values({
    id: newId(),
    merchantId,
    branchId,
    code: 'R1',
    nameEn: 'Register 1',
    nameAr: 'الصندوق 1',
  });
  return 1;
}
