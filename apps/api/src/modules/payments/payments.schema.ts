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
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId, updatedAt } from '../../database/schema/columns.js';
import { currencies } from '../../database/schema/currencies.schema.js';
import { branches } from '../branches/branches.schema.js';
import { users } from '../iam/iam.schema.js';
import { registers, shifts } from '../registers/registers.schema.js';
import { merchants } from '../merchants/merchants.schema.js';

/**
 * Internal financial balances (Prompt 9), e.g. "Bank – NBK", "KNET clearing". The balance
 * is the sum of its append-only entries; it is never stored or edited directly.
 *
 * Cash custody (ADR-0090): every register's drawer (`register`, with `register_id` and
 * `branch_id`) and every branch treasury (`treasury`, with `branch_id`; a null branch is
 * reserved for a future company treasury) is an account of this same ledger, so a transfer
 * moves value between two rows and cash is never counted twice. `archived` accounts keep
 * their history but take no new entries and count in no cash total.
 */
export const financialAccounts = pgTable(
  'financial_accounts',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    nameEn: text(),
    nameAr: text(),
    /** cash | bank | card_clearing | wallet | other | register | treasury */
    kind: text().notNull(),
    branchId: uuid(),
    registerId: uuid(),
    /** Treasuries: when the first physical count was recorded (null = not yet counted). */
    countedAt: timestamp({ withTimezone: true }),
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
      sql`${t.kind} in ('cash', 'bank', 'card_clearing', 'wallet', 'other', 'register', 'treasury')`,
    ),
    check(
      'financial_accounts_status_valid',
      sql`${t.status} in ('active', 'inactive', 'archived')`,
    ),
    check(
      'financial_accounts_custody_shape',
      sql`(${t.kind} = 'register' and ${t.registerId} is not null and ${t.branchId} is not null)
       or (${t.kind} = 'treasury' and ${t.registerId} is null)
       or (${t.kind} not in ('register', 'treasury') and ${t.registerId} is null and ${t.branchId} is null)`,
    ),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.registerId, t.branchId],
      foreignColumns: [registers.merchantId, registers.id, registers.branchId],
    }),
    uniqueIndex('financial_accounts_one_per_register')
      .on(t.registerId)
      .where(sql`${t.kind} = 'register'`),
    uniqueIndex('financial_accounts_one_treasury_per_branch')
      .on(t.merchantId, t.branchId)
      .where(sql`${t.kind} = 'treasury' and ${t.branchId} is not null`),
    uniqueIndex('financial_accounts_one_company_treasury')
      .on(t.merchantId)
      .where(sql`${t.kind} = 'treasury' and ${t.branchId} is null`),
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
    /** Register entries made while the register has an open shift carry that shift. */
    shiftId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.merchantId, t.accountId],
      foreignColumns: [financialAccounts.merchantId, financialAccounts.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.shiftId],
      foreignColumns: [shifts.merchantId, shifts.id],
    }),
    index('financial_account_entries_shift_idx').on(t.merchantId, t.shiftId),
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

/**
 * A movement of cash between two custody accounts (ADR-0090): register ↔ branch treasury.
 * Append-only; its two ledger entries (− from, + to) must exist and sum to zero.
 */
export const cashTransfers = pgTable(
  'cash_transfers',
  {
    id: id(),
    merchantId: merchantId(),
    fromAccountId: uuid().notNull(),
    toAccountId: uuid().notNull(),
    amountMinor: bigint({ mode: 'bigint' }).notNull(),
    /** pos_movement (a cashier's drop or top-up) | manager */
    origin: text().notNull(),
    cashMovementId: uuid(),
    note: text(),
    idempotencyKey: uuid(),
    createdByUserId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.merchantId, t.fromAccountId],
      foreignColumns: [financialAccounts.merchantId, financialAccounts.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.toAccountId],
      foreignColumns: [financialAccounts.merchantId, financialAccounts.id],
    }),
    unique('cash_transfers_idempotency_key').on(t.merchantId, t.idempotencyKey),
    uniqueIndex('cash_transfers_movement_key').on(t.cashMovementId),
    check(
      'cash_transfers_amount_positive',
      sql`${t.amountMinor} > 0 and ${t.amountMinor} <= 1000000000`,
    ),
    check('cash_transfers_distinct', sql`${t.fromAccountId} <> ${t.toAccountId}`),
    check('cash_transfers_origin_valid', sql`${t.origin} in ('pos_movement', 'manager')`),
    index('cash_transfers_time_idx').on(t.merchantId, t.createdAt),
  ],
);
