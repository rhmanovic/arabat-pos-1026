import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId, updatedAt } from '../../database/schema/columns.js';
import { currencies } from '../../database/schema/currencies.schema.js';
import { users } from '../iam/iam.schema.js';
import { merchants } from '../merchants/merchants.schema.js';

/**
 * Internal financial balances (Prompt 9), e.g. "Bank – NBK", "KNET clearing". The balance
 * is the sum of its append-only entries; it is never stored or edited directly.
 */
export const financialAccounts = pgTable(
  'financial_accounts',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    nameEn: text(),
    nameAr: text(),
    /** cash | bank | card_clearing | wallet | other */
    kind: text().notNull(),
    currency: char({ length: 3 })
      .notNull()
      .default('KWD')
      .references(() => currencies.code),
    status: text().notNull().default('active'),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('financial_accounts_merchant_id_id_key').on(t.merchantId, t.id),
    check('financial_accounts_name_present', sql`coalesce(${t.nameEn}, ${t.nameAr}) is not null`),
    check(
      'financial_accounts_kind_valid',
      sql`${t.kind} in ('cash', 'bank', 'card_clearing', 'wallet', 'other')`,
    ),
    check('financial_accounts_status_valid', sql`${t.status} in ('active', 'inactive')`),
  ],
);

/** Ledger of an internal balance (append-only). Written by payments, fees and refunds. */
export const financialAccountEntries = pgTable(
  'financial_account_entries',
  {
    id: id(),
    merchantId: merchantId(),
    accountId: uuid().notNull(),
    /** Signed amount in minor units (+ in, − out). */
    amountMinor: bigint({ mode: 'bigint' }).notNull(),
    /** payment | fee | refund | cash_movement | transfer | adjustment */
    entryType: text().notNull(),
    sourceType: text().notNull(),
    sourceId: uuid().notNull(),
    description: text(),
    createdByUserId: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.merchantId, t.accountId],
      foreignColumns: [financialAccounts.merchantId, financialAccounts.id],
    }),
    check('financial_account_entries_nonzero', sql`${t.amountMinor} <> 0`),
    check(
      'financial_account_entries_type_valid',
      sql`${t.entryType} in ('payment', 'fee', 'refund', 'cash_movement', 'transfer', 'adjustment')`,
    ),
    index('financial_account_entries_account_idx').on(t.merchantId, t.accountId, t.createdAt),
    index('financial_account_entries_source_idx').on(t.merchantId, t.sourceType, t.sourceId),
  ],
);

/** Merchant-configured payment methods (Prompt 9). Gateways are not integrated yet. */
export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    /** cash | card | bank_transfer | custom. Only cash counts towards the drawer. */
    kind: text().notNull(),
    nameEn: text(),
    nameAr: text(),
    status: text().notNull().default('active'),
    availableInPos: boolean().notNull().default(true),
    availableOnline: boolean().notNull().default(false),
    /** none | fixed | percentage | fixed_plus_percentage */
    feeType: text().notNull().default('none'),
    feeFixedMinor: bigint({ mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    feePercent: numeric({ precision: 6, scale: 3 }).notNull().default('0'),
    financialAccountId: uuid(),
    /** Future gateway integration (no live gateway yet). Never holds secrets. */
    gatewayProvider: text(),
    gatewayConfig: jsonb().notNull().default({}),
    sortOrder: integer().notNull().default(0),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('payment_methods_merchant_id_id_key').on(t.merchantId, t.id),
    foreignKey({
      columns: [t.merchantId, t.financialAccountId],
      foreignColumns: [financialAccounts.merchantId, financialAccounts.id],
    }),
    // Exactly one cash method per merchant: it defines the drawer's expected cash.
    uniqueIndex('payment_methods_one_cash')
      .on(t.merchantId)
      .where(sql`${t.kind} = 'cash'`),
    check('payment_methods_name_present', sql`coalesce(${t.nameEn}, ${t.nameAr}) is not null`),
    check(
      'payment_methods_kind_valid',
      sql`${t.kind} in ('cash', 'card', 'bank_transfer', 'custom')`,
    ),
    check('payment_methods_status_valid', sql`${t.status} in ('active', 'inactive')`),
    check(
      'payment_methods_fee_type_valid',
      sql`${t.feeType} in ('none', 'fixed', 'percentage', 'fixed_plus_percentage')`,
    ),
    check(
      'payment_methods_fee_range',
      sql`${t.feeFixedMinor} >= 0 and ${t.feeFixedMinor} <= 1000000000 and ${t.feePercent} >= 0 and ${t.feePercent} <= 100`,
    ),
    check(
      'payment_methods_gateway_valid',
      sql`${t.gatewayProvider} is null or ${t.gatewayProvider} in ('tap', 'upayments', 'hesabe', 'bookeey', 'mock')`,
    ),
  ],
);
