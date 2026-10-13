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
import { createdAt, id, merchantId, updatedAt } from '../../database/schema/columns.js';
import { branches } from '../branches/branches.schema.js';
import { productVariants } from '../catalog/catalog.schema.js';
import { users } from '../iam/iam.schema.js';

const quantity = () => numeric({ precision: 14, scale: 3 });

/**
 * Stock transfer between two branches (Prompt 12): requested → approved → in_transit →
 * received; cancelled before dispatch. Stock leaves the source at dispatch and arrives at
 * the destination at receipt; what was dispatched but not received is the discrepancy.
 */
export const stockTransfers = pgTable(
  'stock_transfers',
  {
    id: id(),
    merchantId: merchantId(),
    number: text().notNull(),
    sourceBranchId: uuid().notNull(),
    destinationBranchId: uuid().notNull(),
    status: text().notNull().default('requested'),
    note: text(),
    requestedByUserId: uuid()
      .notNull()
      .references(() => users.id),
    approvedByUserId: uuid().references(() => users.id),
    approvedAt: timestamp({ withTimezone: true }),
    dispatchedByUserId: uuid().references(() => users.id),
    dispatchedAt: timestamp({ withTimezone: true }),
    receivedByUserId: uuid().references(() => users.id),
    receivedAt: timestamp({ withTimezone: true }),
    cancelledByUserId: uuid().references(() => users.id),
    cancelledAt: timestamp({ withTimezone: true }),
    discrepancyNote: text(),
    /** Recall (BR-173): goods in transit brought back to the source before receipt. */
    recalledByUserId: uuid().references(() => users.id),
    recalledAt: timestamp({ withTimezone: true }),
    recallNote: text(),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('stock_transfers_merchant_id_id_key').on(t.merchantId, t.id),
    unique('stock_transfers_number_key').on(t.merchantId, t.number),
    foreignKey({
      columns: [t.merchantId, t.sourceBranchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.destinationBranchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    check('stock_transfers_branches_differ', sql`${t.sourceBranchId} <> ${t.destinationBranchId}`),
    check(
      'stock_transfers_status_valid',
      sql`${t.status} in ('requested', 'approved', 'in_transit', 'received', 'cancelled', 'recalled')`,
    ),
    index('stock_transfers_source_idx').on(t.merchantId, t.sourceBranchId, t.status),
    index('stock_transfers_destination_idx').on(t.merchantId, t.destinationBranchId, t.status),
    index('stock_transfers_dispatched_idx').on(t.merchantId, t.dispatchedAt),
  ],
);

export const stockTransferLines = pgTable(
  'stock_transfer_lines',
  {
    merchantId: merchantId(),
    transferId: uuid().notNull(),
    position: integer().notNull(),
    variantId: uuid().notNull(),
    requestedQuantity: quantity().notNull(),
    dispatchedQuantity: quantity(),
    /** May exceed the dispatched quantity: a surplus, explained at receipt (BR-172). */
    receivedQuantity: quantity(),
    /** Set when the transfer is recalled: the dispatched quantity came back to the source. */
    recalledQuantity: quantity(),
    /** Unit cost at dispatch (source average); the destination receives at this cost. */
    unitCostMinor: bigint({ mode: 'bigint' }),
  },
  (t) => [
    primaryKey({ columns: [t.transferId, t.position] }),
    foreignKey({
      columns: [t.merchantId, t.transferId],
      foreignColumns: [stockTransfers.merchantId, stockTransfers.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.variantId],
      foreignColumns: [productVariants.merchantId, productVariants.id],
    }),
    check(
      'stock_transfer_lines_quantities',
      sql`${t.requestedQuantity} > 0 and (${t.dispatchedQuantity} is null or ${t.dispatchedQuantity} >= 0)
          and (${t.receivedQuantity} is null or (${t.dispatchedQuantity} is not null and ${t.receivedQuantity} >= 0))
          and (${t.recalledQuantity} is null or (${t.dispatchedQuantity} is not null and ${t.recalledQuantity} >= 0))`,
    ),
  ],
);

/**
 * Transfer loss (BR-172, remediation R2.3): the quantity dispatched but not received, written
 * off explicitly with the receiver's explanation. Created at receipt (or claimed later for a
 * remaining shortage); above the company's adjustment approval limit it waits for the source
 * approver (claimant ≠ decider, owner excepted and flagged). Append-only: a pending loss
 * changes once, into posted or rejected. The quantity it covers leaves "in transit" only when
 * posted.
 */
export const stockTransferLosses = pgTable(
  'stock_transfer_losses',
  {
    id: id(),
    merchantId: merchantId(),
    transferId: uuid().notNull(),
    number: text().notNull(),
    /** posted | pending | rejected */
    status: text().notNull(),
    /** Σ quantity × dispatch unit cost (minor units). */
    valueMinor: bigint({ mode: 'bigint' }).notNull(),
    explanation: text().notNull(),
    limitExceeded: boolean().notNull().default(false),
    ownerOverride: boolean().notNull().default(false),
    claimedByUserId: uuid()
      .notNull()
      .references(() => users.id),
    decidedByUserId: uuid().references(() => users.id),
    decidedAt: timestamp({ withTimezone: true }),
    decisionNote: text(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('stock_transfer_losses_merchant_id_id_key').on(t.merchantId, t.id),
    unique('stock_transfer_losses_number_key').on(t.merchantId, t.number),
    foreignKey({
      columns: [t.merchantId, t.transferId],
      foreignColumns: [stockTransfers.merchantId, stockTransfers.id],
    }),
    check(
      'stock_transfer_losses_status_valid',
      sql`${t.status} in ('posted', 'pending', 'rejected')`,
    ),
    check('stock_transfer_losses_value_valid', sql`${t.valueMinor} >= 0`),
    index('stock_transfer_losses_transfer_idx').on(t.merchantId, t.transferId),
    index('stock_transfer_losses_status_idx').on(t.merchantId, t.status),
  ],
);

export const stockTransferLossLines = pgTable(
  'stock_transfer_loss_lines',
  {
    merchantId: merchantId(),
    lossId: uuid().notNull(),
    /** The transfer line the loss belongs to. */
    position: integer().notNull(),
    variantId: uuid().notNull(),
    quantity: quantity().notNull(),
    unitCostMinor: bigint({ mode: 'bigint' }),
  },
  (t) => [
    primaryKey({ columns: [t.lossId, t.position] }),
    foreignKey({
      columns: [t.merchantId, t.lossId],
      foreignColumns: [stockTransferLosses.merchantId, stockTransferLosses.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.variantId],
      foreignColumns: [productVariants.merchantId, productVariants.id],
    }),
    check('stock_transfer_loss_lines_quantity_positive', sql`${t.quantity} > 0`),
  ],
);
