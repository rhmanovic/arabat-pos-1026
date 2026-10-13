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
import { customers } from '../customers/customers.schema.js';
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
  /** Refunds later than this many days after the sale need approval. */
  refundWindowDays: integer().notNull().default(30),
  /** Refunds above this amount (fils) need `refunds.approve`. */
  refundApprovalLimitMinor: bigint({ mode: 'bigint' })
    .notNull()
    .default(sql`20000`),
  /**
   * Blind counts (BR-162, remediation R1.5): cashiers without `shifts.view_all` count the
   * drawer at opening and closing without seeing the expected balance first.
   */
  blindCashCount: boolean().notNull().default(true),
  /**
   * Cash-out controls (BR-164, remediation R1.1): an "other" cash-out above the per-movement
   * limit, or taking the shift's "other" cash-outs above the per-shift limit, waits for a
   * manager unless the owner records it. Owner-set, per company (D2).
   */
  cashOutOtherLimitMinor: bigint({ mode: 'bigint' })
    .notNull()
    .default(sql`20000`),
  cashOutOtherShiftLimitMinor: bigint({ mode: 'bigint' })
    .notNull()
    .default(sql`50000`),
  /** Largest discrepancy tolerance a register may be given (FND-403). */
  maxRegisterToleranceMinor: bigint({ mode: 'bigint' })
    .notNull()
    .default(sql`1000`),
  /**
   * Disbursement approvals (BR-166, remediation R1.2, owner decision D2): an expense or a
   * supplier payment above these amounts waits for a second person unless the owner records it.
   */
  expenseApprovalLimitMinor: bigint({ mode: 'bigint' })
    .notNull()
    .default(sql`20000`),
  supplierPaymentApprovalLimitMinor: bigint({ mode: 'bigint' })
    .notNull()
    .default(sql`100000`),
  /** Stock adjustments above this value at cost wait for a second person (BR-169, D2). */
  adjustmentApprovalLimitMinor: bigint({ mode: 'bigint' })
    .notNull()
    .default(sql`50000`),
  /** Count sheets hide the expected quantity (BR-170). */
  blindStockCount: boolean().notNull().default(true),
  /**
   * Price-change bounds (BR-178, remediation R3.2): a changed price must stay between the
   * floor and the ceiling, as a % of the list price (null = no bound), and may go below the
   * item's cost only when allowed. Hard limits for everyone, supervisors included.
   */
  priceOverrideFloorPercent: numeric({ precision: 5, scale: 2 }).default('50'),
  priceOverrideCeilingPercent: numeric({ precision: 5, scale: 2 }).default('200'),
  priceOverrideBelowCost: boolean().notNull().default(false),
  /** A refund of a sale the requester rang up waits for a second person (BR-180, R3.4). */
  refundOwnSalesNeedApproval: boolean().notNull().default(true),
  /** Card / transfer tenders and pay-backs need a reference (BR-181, R3.5). */
  requireTenderReference: boolean().notNull().default(true),
  /** Held sales are discarded after this many hours; 0 = never (BR-182, R3.6). */
  heldSaleExpiryHours: integer().notNull().default(24),
  /** Clearing a cart worth at least this much is logged (BR-182). */
  cartClearLogThresholdMinor: bigint({ mode: 'bigint' })
    .notNull()
    .default(sql`5000`),
  /** Refund rate above which an employee is flagged in the activity review (BR-186). */
  unusualRefundRatePercent: numeric({ precision: 5, scale: 2 }).notNull().default('10'),
  /** Default window of the activity review (BR-186). */
  unusualActivityDays: integer().notNull().default(30),
  version: integer().notNull().default(1),
  updatedAt: updatedAt(),
});

/** Receipt copies printed after the first one (BR-182, FND-310): append-only, audited. */
export const receiptReprints = pgTable(
  'receipt_reprints',
  {
    id: id(),
    merchantId: merchantId(),
    saleId: uuid().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    shiftId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.merchantId, t.saleId], foreignColumns: [sales.merchantId, sales.id] }),
    index('receipt_reprints_sale_idx').on(t.merchantId, t.saleId),
  ],
);

/**
 * Carts cleared or lines removed after a total was shown (BR-182, FND-311): a lightweight
 * append-only trace of what never became a sale, logged above the company threshold.
 */
export const posCartEvents = pgTable(
  'pos_cart_events',
  {
    id: id(),
    merchantId: merchantId(),
    branchId: uuid().notNull(),
    shiftId: uuid().notNull(),
    membershipId: uuid().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    kind: text().notNull(),
    amountMinor: minor().notNull(),
    lineCount: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.merchantId, t.shiftId],
      foreignColumns: [shifts.merchantId, shifts.id],
    }),
    check('pos_cart_events_kind_valid', sql`${t.kind} in ('cleared', 'line_removed')`),
    index('pos_cart_events_shift_idx').on(t.merchantId, t.shiftId),
  ],
);

/**
 * Supervisor override on a cashier's till (BR-177, remediation R3.1): a second person proves
 * their identity on the cashier's screen and lends, once and for a few minutes, the overridable
 * selling rights they hold at the branch. The sale stays on the cashier's shift; the grant
 * records who authorised what, and is consumed by exactly one sale (column-level grant and
 * trigger `sale_overrides_use`, migration 0043).
 */
export const saleOverrides = pgTable(
  'sale_overrides',
  {
    id: id(),
    merchantId: merchantId(),
    branchId: uuid().notNull(),
    shiftId: uuid().notNull(),
    cashierMembershipId: uuid().notNull(),
    cashierUserId: uuid()
      .notNull()
      .references(() => users.id),
    approverMembershipId: uuid().notNull(),
    approverUserId: uuid()
      .notNull()
      .references(() => users.id),
    /** Overridable rights the approver holds at the branch and the cashier lacks. */
    permissions: text().array().notNull(),
    note: text(),
    status: text().notNull().default('granted'),
    /** Rights actually supplied to the sale that used the grant. */
    kinds: text().array(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('sale_overrides_merchant_id_id_key').on(t.merchantId, t.id),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.shiftId],
      foreignColumns: [shifts.merchantId, shifts.id],
    }),
    check('sale_overrides_status_valid', sql`${t.status} in ('granted', 'used')`),
    check(
      'sale_overrides_used_consistent',
      sql`(${t.status} = 'used') = (${t.usedAt} is not null) and (${t.status} = 'used') = (${t.kinds} is not null)`,
    ),
    index('sale_overrides_cashier_idx').on(t.merchantId, t.cashierMembershipId, t.status),
  ],
);

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
    /** Null for walk-in sales. */
    customerId: uuid(),
    orderDiscountType: text(),
    orderDiscountValue: text(),
    /** Checkout idempotency key (client-generated per cart). */
    idempotencyKey: uuid(),
    requestHash: text(),
    completedAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    /** Who completed a held cart, when it was not the holder (BR-182). */
    completedByUserId: uuid(),
    completedByMembershipId: uuid(),
    completedShiftId: uuid(),
    expiredAt: timestamp({ withTimezone: true }),
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
    check(
      'orders_status_valid',
      sql`${t.status} in ('suspended', 'completed', 'cancelled', 'expired')`,
    ),
    check(
      'orders_discount_valid',
      sql`${t.orderDiscountType} is null or ${t.orderDiscountType} in ('percent', 'amount')`,
    ),
    index('orders_branch_status_idx').on(t.merchantId, t.branchId, t.status),
    foreignKey({
      columns: [t.merchantId, t.customerId],
      foreignColumns: [customers.merchantId, customers.id],
    }),
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
    /** Kept with a held cart so the reason survives a resume (BR-178). */
    priceOverrideReason: text(),
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
    /** pos | online (Prompt 16). Online sales have no order, register, shift or cashier. */
    channel: text().notNull().default('pos'),
    orderId: uuid(),
    onlineOrderId: uuid(),
    branchId: uuid().notNull(),
    registerId: uuid(),
    shiftId: uuid(),
    membershipId: uuid(),
    userId: uuid().references(() => users.id),
    receiptNumber: text().notNull(),
    /** Null for walk-in sales; fixed when the sale is completed. */
    customerId: uuid(),
    /** Restaurant bill: the order it pays for and its service type (Prompt 15). */
    restaurantOrderId: uuid(),
    serviceType: text(),
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
    /** A discount or price change beyond the limit in force was allowed (BR-178). */
    aboveLimit: boolean().notNull().default(false),
    /** The company discount limit when the sale was made; null for online sales. */
    discountLimitPercent: numeric({ precision: 5, scale: 2 }),
    /** Required on every sale whose total is zero (BR-179). */
    zeroTotalReason: text(),
    /** Supervisor override used for this sale (BR-177). */
    overrideId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('sales_merchant_id_id_key').on(t.merchantId, t.id),
    unique('sales_order_key').on(t.orderId),
    unique('sales_override_key').on(t.merchantId, t.overrideId),
    foreignKey({
      columns: [t.merchantId, t.overrideId],
      foreignColumns: [saleOverrides.merchantId, saleOverrides.id],
    }),
    check(
      'sales_zero_total_reason',
      sql`${t.channel} <> 'pos' or ${t.totalMinor} > 0 or ${t.zeroTotalReason} is not null`,
    ),
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
    index('sales_customer_idx').on(t.merchantId, t.customerId, t.createdAt),
    index('sales_restaurant_order_idx').on(t.merchantId, t.restaurantOrderId),
    unique('sales_online_order_key').on(t.merchantId, t.onlineOrderId),
    check(
      'sales_channel_valid',
      sql`(${t.channel} = 'pos' and ${t.orderId} is not null and ${t.registerId} is not null and ${t.shiftId} is not null
           and ${t.membershipId} is not null and ${t.userId} is not null and ${t.onlineOrderId} is null)
          or (${t.channel} = 'online' and ${t.onlineOrderId} is not null and ${t.shiftId} is null)`,
    ),
    check(
      'sales_service_type_valid',
      sql`${t.serviceType} is null or ${t.serviceType} in ('dine_in', 'takeaway', 'pickup')`,
    ),
    foreignKey({
      columns: [t.merchantId, t.customerId],
      foreignColumns: [customers.merchantId, customers.id],
    }),
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
    /** Why the price was changed (BR-178); set whenever `price_overridden`. */
    priceOverrideReason: text(),
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
    /** Null only for exchange credit (`method_kind = 'exchange'`). */
    paymentMethodId: uuid(),
    methodKind: text().notNull(),
    /** Exchange credit: the refund that funds this payment. */
    refundId: uuid(),
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
    check(
      'payments_verification_valid',
      sql`${t.verification} in ('manual', 'gateway', 'internal')`,
    ),
    check(
      'payments_exchange_valid',
      sql`(${t.methodKind} = 'exchange') = (${t.refundId} is not null) and (${t.methodKind} = 'exchange' or ${t.paymentMethodId} is not null)`,
    ),
    check(
      'payments_amounts_valid',
      sql`${t.amountMinor} > 0 and ${t.feeMinor} >= 0 and ${t.feeMinor} <= ${t.amountMinor} and ${t.changeMinor} >= 0
          and (${t.tenderedMinor} is null or ${t.tenderedMinor} = ${t.amountMinor} + ${t.changeMinor})`,
    ),
    index('payments_sale_idx').on(t.merchantId, t.saleId),
    index('payments_shift_idx').on(t.merchantId, t.shiftId),
    index('payments_branch_time_idx').on(t.merchantId, t.branchId, t.createdAt),
  ],
);

/** Modifiers chosen on a sale line (snapshot; their prices are part of the line's unit price). */
export const saleLineModifiers = pgTable(
  'sale_line_modifiers',
  {
    merchantId: merchantId(),
    saleId: uuid().notNull(),
    position: integer().notNull(),
    modifierId: uuid().notNull(),
    nameEn: text(),
    nameAr: text(),
    priceMinor: minor().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.saleId, t.position, t.modifierId] }),
    foreignKey({
      columns: [t.merchantId, t.saleId],
      foreignColumns: [sales.merchantId, sales.id],
    }),
  ],
);
