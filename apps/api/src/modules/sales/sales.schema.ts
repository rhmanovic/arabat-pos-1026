import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId, updatedAt } from '../../database/schema/columns.js';
import { branches } from '../branches/branches.schema.js';
import { users } from '../iam/iam.schema.js';
import { merchants } from '../merchants/merchants.schema.js';
import { registers, shifts } from '../registers/registers.schema.js';

const quantity = () => numeric({ precision: 14, scale: 3 });
const minor = () => bigint({ mode: 'bigint' });

/** Merchant selling policy (Prompt 10). One row, created on first change. */
export const salesSettings = pgTable('sales_settings', {
  merchantId: uuid()
    .primaryKey()
    .references(() => merchants.id),
  /** Largest discount (per line and per order, in %) without `sales.discount.override_limit`. */
  maxDiscountPercent: numeric({ precision: 5, scale: 2 }).notNull().default('10'),
  version: integer().notNull().default(1),
  updatedAt: updatedAt(),
});

/** Gap-free receipt counter per branch, incremented under a row lock at checkout. */
export const receiptSequences = pgTable(
  'receipt_sequences',
  {
    merchantId: merchantId(),
    branchId: uuid().notNull(),
    lastNumber: bigint({ mode: 'number' }).notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.merchantId, t.branchId] }),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
  ],
);

/**
 * The order is the cashier's (mutable) intent: a suspended cart or the request that
 * became a sale. States: suspended → completed | cancelled; a checkout without a
 * suspended order is created directly as completed.
 */
export const orders = pgTable(
  'orders',
  {
    id: id(),
    merchantId: merchantId(),
    branchId: uuid().notNull(),
    registerId: uuid().notNull(),
    shiftId: uuid().notNull(),
    membershipId: uuid().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    status: text().notNull(),
    label: text(),
    orderDiscountType: text(),
    orderDiscountValue: text(),
    /** Checkout idempotency key (client-generated per cart). */
    idempotencyKey: uuid(),
    requestHash: text(),
    completedAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('orders_merchant_id_id_key').on(t.merchantId, t.id),
    unique('orders_idempotency_key').on(t.merchantId, t.idempotencyKey),
    foreignKey({
      columns: [t.merchantId, t.shiftId],
      foreignColumns: [shifts.merchantId, shifts.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.registerId],
      foreignColumns: [registers.merchantId, registers.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    check('orders_status_valid', sql`${t.status} in ('suspended', 'completed', 'cancelled')`),
    check(
      'orders_discount_valid',
      sql`${t.orderDiscountType} is null or ${t.orderDiscountType} in ('percent', 'amount')`,
    ),
    index('orders_branch_status_idx').on(t.merchantId, t.branchId, t.status),
  ],
);

export const orderLines = pgTable(
  'order_lines',
  {
    merchantId: merchantId(),
    orderId: uuid().notNull(),
    position: integer().notNull(),
    variantId: uuid().notNull(),
    quantity: quantity().notNull(),
    priceOverrideMinor: minor(),
    discountType: text(),
    discountValue: text(),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.position] }),
    foreignKey({
      columns: [t.merchantId, t.orderId],
      foreignColumns: [orders.merchantId, orders.id],
    }),
    check('order_lines_quantity_positive', sql`${t.quantity} > 0`),
  ],
);

/** The immutable financial document of a completed checkout. */
export const sales = pgTable(
  'sales',
  {
    id: id(),
    merchantId: merchantId(),
    orderId: uuid().notNull(),
    branchId: uuid().notNull(),
    registerId: uuid().notNull(),
    shiftId: uuid().notNull(),
    membershipId: uuid().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    receiptNumber: text().notNull(),
    currency: char({ length: 3 }).notNull().default('KWD'),
    subtotalMinor: minor().notNull(),
    lineDiscountsMinor: minor().notNull(),
    orderDiscountMinor: minor().notNull(),
    totalMinor: minor().notNull(),
    paidMinor: minor().notNull(),
    changeMinor: minor().notNull(),
    feesMinor: minor().notNull(),
    /** Cost of goods at weighted-average cost; null when some cost was unknown. */
    costMinor: minor(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('sales_merchant_id_id_key').on(t.merchantId, t.id),
    unique('sales_order_key').on(t.orderId),
    unique('sales_receipt_number_key').on(t.merchantId, t.receiptNumber),
    foreignKey({
      columns: [t.merchantId, t.orderId],
      foreignColumns: [orders.merchantId, orders.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.shiftId],
      foreignColumns: [shifts.merchantId, shifts.id],
    }),
    check(
      'sales_totals_consistent',
      sql`${t.totalMinor} = ${t.subtotalMinor} - ${t.lineDiscountsMinor} - ${t.orderDiscountMinor}
          and ${t.totalMinor} >= 0 and ${t.paidMinor} = ${t.totalMinor} and ${t.changeMinor} >= 0`,
    ),
    index('sales_branch_time_idx').on(t.merchantId, t.branchId, t.createdAt),
    index('sales_shift_idx').on(t.merchantId, t.shiftId),
  ],
);

/** Snapshot of what was sold: later catalog changes never alter a sale (BR-050). */
export const saleLines = pgTable(
  'sale_lines',
  {
    merchantId: merchantId(),
    saleId: uuid().notNull(),
    position: integer().notNull(),
    variantId: uuid().notNull(),
    productId: uuid().notNull(),
    nameEn: text(),
    nameAr: text(),
    variantNameEn: text(),
    variantNameAr: text(),
    sku: text(),
    quantity: quantity().notNull(),
    listUnitPriceMinor: minor().notNull(),
    unitPriceMinor: minor().notNull(),
    priceOverridden: boolean().notNull().default(false),
    grossMinor: minor().notNull(),
    discountType: text(),
    discountValue: text(),
    lineDiscountMinor: minor().notNull(),
    orderDiscountMinor: minor().notNull(),
    netMinor: minor().notNull(),
    trackInventory: boolean().notNull(),
    unitCostMinor: minor(),
  },
  (t) => [
    primaryKey({ columns: [t.saleId, t.position] }),
    foreignKey({ columns: [t.merchantId, t.saleId], foreignColumns: [sales.merchantId, sales.id] }),
    check(
      'sale_lines_amounts_consistent',
      sql`${t.netMinor} = ${t.grossMinor} - ${t.lineDiscountMinor} - ${t.orderDiscountMinor} and ${t.netMinor} >= 0`,
    ),
    index('sale_lines_variant_idx').on(t.merchantId, t.variantId),
  ],
);

/**
 * Customer payments. A sale is completed only with `succeeded` payments; gateway payments
 * stay `pending` until verified (Prompt 16), and never complete a sale while unverified.
 */
export const payments = pgTable(
  'payments',
  {
    id: id(),
    merchantId: merchantId(),
    saleId: uuid(),
    branchId: uuid().notNull(),
    shiftId: uuid(),
    paymentMethodId: uuid().notNull(),
    methodKind: text().notNull(),
    methodNameEn: text(),
    methodNameAr: text(),
    amountMinor: minor().notNull(),
    tenderedMinor: minor(),
    changeMinor: minor()
      .notNull()
      .default(sql`0`),
    feeMinor: minor()
      .notNull()
      .default(sql`0`),
    status: text().notNull(),
    /** manual (cashier-confirmed: cash, card terminal, transfer) | gateway (provider-verified) */
    verification: text().notNull(),
    reference: text(),
    financialAccountId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.merchantId, t.saleId], foreignColumns: [sales.merchantId, sales.id] }),
    check('payments_status_valid', sql`${t.status} in ('succeeded', 'pending', 'failed')`),
    check('payments_verification_valid', sql`${t.verification} in ('manual', 'gateway')`),
    check(
      'payments_amounts_valid',
      sql`${t.amountMinor} > 0 and ${t.feeMinor} >= 0 and ${t.feeMinor} <= ${t.amountMinor} and ${t.changeMinor} >= 0
          and (${t.tenderedMinor} is null or ${t.tenderedMinor} = ${t.amountMinor} + ${t.changeMinor})`,
    ),
    index('payments_sale_idx').on(t.merchantId, t.saleId),
    index('payments_shift_idx').on(t.merchantId, t.shiftId),
  ],
);
