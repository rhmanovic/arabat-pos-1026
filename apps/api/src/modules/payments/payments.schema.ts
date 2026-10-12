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
import { purchaseOrders, suppliers } from '../purchasing/purchasing.schema.js';

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
    /** cash | bank | card_clearing | wallet | other | register | treasury | in_transit */
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
      sql`${t.kind} in ('cash', 'bank', 'card_clearing', 'wallet', 'other', 'register', 'treasury', 'in_transit')`,
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
    // Cash sent between branches waits in one company "in transit" account (ADR-0091).
    uniqueIndex('financial_accounts_one_in_transit')
      .on(t.merchantId)
      .where(sql`${t.kind} = 'in_transit'`),
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
    /** payment | fee | refund | cash_movement | transfer | adjustment | expense | supplier_payment */
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
      sql`${t.entryType} in ('payment', 'fee', 'refund', 'cash_movement', 'transfer', 'adjustment', 'expense', 'supplier_payment')`,
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
    /** pos_movement (a cashier's drop, top-up or deposit) | manager | deposit | branch_transfer */
    origin: text().notNull(),
    cashMovementId: uuid(),
    /** Set on the send, receive and cancel steps of a branch-to-branch transfer. */
    branchTransferId: uuid(),
    /** Bank deposits: the deposit slip or reference. */
    reference: text(),
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
    check(
      'cash_transfers_origin_valid',
      sql`${t.origin} in ('pos_movement', 'manager', 'deposit', 'branch_transfer')`,
    ),
    index('cash_transfers_time_idx').on(t.merchantId, t.createdAt),
    foreignKey({
      columns: [t.merchantId, t.branchTransferId],
      foreignColumns: [cashBranchTransfers.merchantId, cashBranchTransfers.id],
    }),
  ],
);

/**
 * Cash sent from one branch treasury to another (ADR-0091). Sending moves the amount into the
 * company "in transit" account; the receiving branch confirms the amount actually counted
 * (a difference is booked on the transfer), or the sender cancels it back. Status only moves
 * forward: in_transit → received | cancelled.
 */
export const cashBranchTransfers = pgTable(
  'cash_branch_transfers',
  {
    id: id(),
    merchantId: merchantId(),
    number: text().notNull(),
    fromBranchId: uuid().notNull(),
    toBranchId: uuid().notNull(),
    fromAccountId: uuid().notNull(),
    toAccountId: uuid().notNull(),
    amountSentMinor: bigint({ mode: 'bigint' }).notNull(),
    amountReceivedMinor: bigint({ mode: 'bigint' }),
    /** in_transit | received | cancelled */
    status: text().notNull().default('in_transit'),
    sendNote: text(),
    receiveNote: text(),
    cancelNote: text(),
    idempotencyKey: uuid(),
    sentByUserId: uuid()
      .notNull()
      .references(() => users.id),
    receivedByUserId: uuid().references(() => users.id),
    receivedAt: timestamp({ withTimezone: true }),
    cancelledByUserId: uuid().references(() => users.id),
    cancelledAt: timestamp({ withTimezone: true }),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('cash_branch_transfers_merchant_id_id_key').on(t.merchantId, t.id),
    unique('cash_branch_transfers_number_key').on(t.merchantId, t.number),
    unique('cash_branch_transfers_idempotency_key').on(t.merchantId, t.idempotencyKey),
    foreignKey({
      columns: [t.merchantId, t.fromBranchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.toBranchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.fromAccountId],
      foreignColumns: [financialAccounts.merchantId, financialAccounts.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.toAccountId],
      foreignColumns: [financialAccounts.merchantId, financialAccounts.id],
    }),
    check('cash_branch_transfers_distinct', sql`${t.fromBranchId} <> ${t.toBranchId}`),
    check(
      'cash_branch_transfers_amounts',
      sql`${t.amountSentMinor} > 0 and ${t.amountSentMinor} <= 1000000000
       and (${t.amountReceivedMinor} is null or (${t.amountReceivedMinor} >= 0 and ${t.amountReceivedMinor} <= 1000000000))`,
    ),
    check(
      'cash_branch_transfers_status_shape',
      sql`(${t.status} = 'in_transit' and ${t.amountReceivedMinor} is null and ${t.receivedAt} is null and ${t.cancelledAt} is null)
       or (${t.status} = 'received' and ${t.amountReceivedMinor} is not null and ${t.receivedByUserId} is not null and ${t.receivedAt} is not null)
       or (${t.status} = 'cancelled' and ${t.cancelledByUserId} is not null and ${t.cancelledAt} is not null and ${t.amountReceivedMinor} is null)`,
    ),
    index('cash_branch_transfers_status_idx').on(t.merchantId, t.status, t.createdAt),
  ],
);

/**
 * Real cash outflows (ADR-0091): operating expenses (by category) and payments to suppliers,
 * paid from a register drawer or a branch treasury. Never a transfer, sale or revenue.
 * Append-only: a correction is a reversing record (`reverses_id`), never an edit.
 */
export const cashDisbursements = pgTable(
  'cash_disbursements',
  {
    id: id(),
    merchantId: merchantId(),
    number: text().notNull(),
    branchId: uuid().notNull(),
    sourceAccountId: uuid().notNull(),
    /** Set when paid from a drawer during a shift. */
    shiftId: uuid(),
    cashMovementId: uuid(),
    /** expense | supplier_payment */
    kind: text().notNull(),
    category: text(),
    supplierId: uuid(),
    purchaseOrderId: uuid(),
    amountMinor: bigint({ mode: 'bigint' }).notNull(),
    description: text(),
    receiptReference: text(),
    /** A reversal points at the record it cancels (same kind, amount and source). */
    reversesId: uuid(),
    idempotencyKey: uuid(),
    createdByUserId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('cash_disbursements_merchant_id_id_key').on(t.merchantId, t.id),
    unique('cash_disbursements_number_key').on(t.merchantId, t.number),
    unique('cash_disbursements_idempotency_key').on(t.merchantId, t.idempotencyKey),
    uniqueIndex('cash_disbursements_one_reversal').on(t.reversesId),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.sourceAccountId],
      foreignColumns: [financialAccounts.merchantId, financialAccounts.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.shiftId],
      foreignColumns: [shifts.merchantId, shifts.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.supplierId],
      foreignColumns: [suppliers.merchantId, suppliers.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.purchaseOrderId, t.supplierId],
      foreignColumns: [purchaseOrders.merchantId, purchaseOrders.id, purchaseOrders.supplierId],
    }),
    foreignKey({
      columns: [t.merchantId, t.reversesId],
      foreignColumns: [t.merchantId, t.id],
    }),
    check(
      'cash_disbursements_amount_positive',
      sql`${t.amountMinor} > 0 and ${t.amountMinor} <= 1000000000`,
    ),
    check(
      'cash_disbursements_shape',
      sql`(${t.kind} = 'expense' and ${t.category} is not null and ${t.supplierId} is null and ${t.purchaseOrderId} is null)
       or (${t.kind} = 'supplier_payment' and ${t.supplierId} is not null and ${t.category} is null)`,
    ),
    check(
      'cash_disbursements_category_valid',
      sql`${t.category} is null or ${t.category} in ('supplies', 'maintenance', 'transport', 'hospitality', 'utilities', 'cleaning', 'other')`,
    ),
    check(
      'cash_disbursements_other_described',
      sql`${t.category} is distinct from 'other' or ${t.description} is not null`,
    ),
    index('cash_disbursements_time_idx').on(t.merchantId, t.branchId, t.createdAt),
    index('cash_disbursements_supplier_idx').on(t.merchantId, t.supplierId, t.createdAt),
  ],
);
