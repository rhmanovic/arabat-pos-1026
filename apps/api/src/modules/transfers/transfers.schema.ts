import { sql } from 'drizzle-orm';
import {
  bigint,
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
      sql`${t.status} in ('requested', 'approved', 'in_transit', 'received', 'cancelled')`,
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
    receivedQuantity: quantity(),
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
          and (${t.receivedQuantity} is null or (${t.dispatchedQuantity} is not null and ${t.receivedQuantity} >= 0
               and ${t.receivedQuantity} <= ${t.dispatchedQuantity}))`,
    ),
  ],
);
