import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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
import { createdAt, id, merchantId } from '../../database/schema/columns.js';
import { users } from '../iam/iam.schema.js';
import { sales } from '../sales/sales.schema.js';

const quantity = () => numeric({ precision: 14, scale: 3 });
const minor = () => bigint({ mode: 'bigint' });

/**
 * A refund linked to an original sale (Prompt 11). The sale itself is never changed.
 * kind: refund | void (same-shift cancellation) | exchange (credit moved to a new sale).
 * status: pending_approval → completed | rejected; cancelled (request withdrawn);
 * processing = waiting for a gateway to confirm (never "completed" before that).
 */
export const refunds = pgTable(
  'refunds',
  {
    id: id(),
    merchantId: merchantId(),
    saleId: uuid().notNull(),
    branchId: uuid().notNull(),
    registerId: uuid().notNull(),
    /** Shift of the requesting cashier: cash refunds leave this drawer. */
    shiftId: uuid().notNull(),
    membershipId: uuid().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    refundNumber: text().notNull(),
    kind: text().notNull(),
    status: text().notNull(),
    reason: text().notNull(),
    note: text(),
    totalMinor: minor().notNull(),
    /** Exchange: part of the credit applied to the new sale. */
    exchangeCreditMinor: minor()
      .notNull()
      .default(sql`0`),
    exchangeSaleId: uuid(),
    /** Why approval was required (e.g. over_limit, outside_window). */
    approvalReasons: text().array(),
    decidedByUserId: uuid().references(() => users.id),
    decidedAt: timestamp({ withTimezone: true }),
    decisionNote: text(),
    /** The owner completed a refund that would otherwise have waited (BR-180, D3). */
    ownerOverride: boolean().notNull().default(false),
    /** Customer phone or name captured on refunds that wait for approval (BR-180). */
    customerContact: text(),
    completedAt: timestamp({ withTimezone: true }),
    idempotencyKey: uuid(),
    requestHash: text(),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    unique('refunds_merchant_id_id_key').on(t.merchantId, t.id),
    unique('refunds_number_key').on(t.merchantId, t.refundNumber),
    unique('refunds_idempotency_key').on(t.merchantId, t.idempotencyKey),
    foreignKey({ columns: [t.merchantId, t.saleId], foreignColumns: [sales.merchantId, sales.id] }),
    check('refunds_kind_valid', sql`${t.kind} in ('refund', 'void', 'exchange')`),
    check(
      'refunds_status_valid',
      sql`${t.status} in ('pending_approval', 'processing', 'completed', 'rejected', 'cancelled')`,
    ),
    check(
      'refunds_amounts_valid',
      sql`${t.totalMinor} >= 0 and ${t.exchangeCreditMinor} >= 0 and ${t.exchangeCreditMinor} <= ${t.totalMinor}`,
    ),
    index('refunds_sale_idx').on(t.merchantId, t.saleId),
    index('refunds_branch_time_idx').on(t.merchantId, t.branchId, t.createdAt),
    index('refunds_status_idx').on(t.merchantId, t.status),
    index('refunds_completed_idx')
      .on(t.merchantId, t.branchId, t.completedAt)
      .where(sql`${t.status} = 'completed'`),
  ],
);

export const refundLines = pgTable(
  'refund_lines',
  {
    merchantId: merchantId(),
    refundId: uuid().notNull(),
    /** Position of the original sale line. */
    salePosition: integer().notNull(),
    variantId: uuid().notNull(),
    quantity: quantity().notNull(),
    amountMinor: minor().notNull(),
    restock: boolean().notNull(),
    unitCostMinor: minor(),
  },
  (t) => [
    primaryKey({ columns: [t.refundId, t.salePosition] }),
    foreignKey({
      columns: [t.merchantId, t.refundId],
      foreignColumns: [refunds.merchantId, refunds.id],
    }),
    check('refund_lines_positive', sql`${t.quantity} > 0 and ${t.amountMinor} >= 0`),
  ],
);

/** Money paid back, allocated to the original payments (split payments refunded per tender). */
export const refundPayments = pgTable(
  'refund_payments',
  {
    id: id(),
    merchantId: merchantId(),
    refundId: uuid().notNull(),
    /** The original payment being refunded; null for exchange credit. */
    originalPaymentId: uuid(),
    paymentMethodId: uuid(),
    /** cash | card | bank_transfer | custom | exchange */
    methodKind: text().notNull(),
    methodNameEn: text(),
    methodNameAr: text(),
    amountMinor: minor().notNull(),
    shiftId: uuid(),
    status: text().notNull(),
    verification: text().notNull(),
    reference: text(),
    /** Account the pay-back leaves (exchange credit traced back to the original tender, BR-180). */
    financialAccountId: uuid(),
    /** Processing fee given back with this pay-back under the method's policy (D6). */
    feeReversedMinor: minor()
      .notNull()
      .default(sql`0`),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.merchantId, t.refundId],
      foreignColumns: [refunds.merchantId, refunds.id],
    }),
    check('refund_payments_amount_positive', sql`${t.amountMinor} > 0`),
    check('refund_payments_fee_reversed_valid', sql`${t.feeReversedMinor} >= 0`),
    check('refund_payments_status_valid', sql`${t.status} in ('succeeded', 'pending', 'failed')`),
    check(
      'refund_payments_verification_valid',
      sql`${t.verification} in ('manual', 'gateway', 'internal')`,
    ),
    index('refund_payments_refund_idx').on(t.merchantId, t.refundId),
    index('refund_payments_original_idx').on(t.merchantId, t.originalPaymentId),
    index('refund_payments_shift_idx').on(t.merchantId, t.shiftId),
    index('refund_payments_time_idx').on(t.merchantId, t.createdAt),
  ],
);
