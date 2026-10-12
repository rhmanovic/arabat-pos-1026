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
import { merchants } from '../merchants/merchants.schema.js';

/** Quantities: exact numeric(14,3) (thousandths), handled as bigint milli-units in code. */
const quantity = () => numeric({ precision: 14, scale: 3 });

/** Per-merchant inventory policy (BR-062). One row, created on first change. */
export const inventorySettings = pgTable('inventory_settings', {
  merchantId: uuid()
    .primaryKey()
    .references(() => merchants.id),
  /** When false (default) no movement may take a balance below zero. */
  allowNegativeStock: boolean().notNull().default(false),
  version: integer().notNull().default(1),
  updatedAt: updatedAt(),
});

/**
 * Current balance per branch and variant. Derived from stock_movements (the ledger) and
 * only ever changed together with a movement row, under a row lock.
 */
export const stockLevels = pgTable(
  'stock_levels',
  {
    merchantId: merchantId(),
    branchId: uuid().notNull(),
    variantId: uuid().notNull(),
    onHand: quantity().notNull().default('0'),
    /** Moving weighted-average unit cost in minor units (BR-061); null until known. */
    avgCostMinor: bigint({ mode: 'bigint' }),
    lowStockThreshold: quantity(),
    lastMovementAt: timestamp({ withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.merchantId, t.branchId, t.variantId] }),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.variantId],
      foreignColumns: [productVariants.merchantId, productVariants.id],
    }),
    check(
      'stock_levels_threshold_valid',
      sql`${t.lowStockThreshold} is null or ${t.lowStockThreshold} >= 0`,
    ),
    check('stock_levels_avg_cost_valid', sql`${t.avgCostMinor} is null or ${t.avgCostMinor} >= 0`),
    index('stock_levels_variant_idx').on(t.merchantId, t.variantId),
  ],
);

/** A manual stock document: opening stock, increase, decrease or count (append-only). */
export const stockAdjustments = pgTable(
  'stock_adjustments',
  {
    id: id(),
    merchantId: merchantId(),
    branchId: uuid().notNull(),
    /** opening | increase | decrease | count */
    kind: text().notNull(),
    reason: text().notNull(),
    note: text(),
    idempotencyKey: uuid(),
    requestHash: text().notNull(),
    createdByUserId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('stock_adjustments_merchant_id_id_key').on(t.merchantId, t.id),
    unique('stock_adjustments_idempotency_key').on(t.merchantId, t.idempotencyKey),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    check(
      'stock_adjustments_kind_valid',
      sql`${t.kind} in ('opening', 'increase', 'decrease', 'count')`,
    ),
    index('stock_adjustments_branch_idx').on(t.merchantId, t.branchId, t.createdAt),
  ],
);

export const stockAdjustmentLines = pgTable(
  'stock_adjustment_lines',
  {
    merchantId: merchantId(),
    adjustmentId: uuid().notNull(),
    variantId: uuid().notNull(),
    /** Entered quantity: the change for opening/increase/decrease, the counted quantity for count. */
    quantity: quantity().notNull(),
    previousOnHand: quantity().notNull(),
    /** Signed applied change (0 for a count that matched). */
    delta: quantity().notNull(),
    unitCostMinor: bigint({ mode: 'bigint' }),
  },
  (t) => [
    primaryKey({ columns: [t.adjustmentId, t.variantId] }),
    foreignKey({
      columns: [t.merchantId, t.adjustmentId],
      foreignColumns: [stockAdjustments.merchantId, stockAdjustments.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.variantId],
      foreignColumns: [productVariants.merchantId, productVariants.id],
    }),
  ],
);

/**
 * The stock ledger (append-only). Every change of a balance is one row with the signed
 * quantity, the resulting balance and the unit cost used, linked to its source document
 * (adjustment, sale, refund, transfer, purchase receipt).
 */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: id(),
    merchantId: merchantId(),
    branchId: uuid().notNull(),
    variantId: uuid().notNull(),
    /** opening | adjustment | count | sale | sale_void | refund | transfer_out | transfer_in | purchase_receipt */
    movementType: text().notNull(),
    reason: text(),
    quantity: quantity().notNull(),
    balanceAfter: quantity().notNull(),
    unitCostMinor: bigint({ mode: 'bigint' }),
    /** Signed value of the movement at unit cost (minor units), null when the cost is unknown. */
    valueMinor: bigint({ mode: 'bigint' }),
    avgCostAfterMinor: bigint({ mode: 'bigint' }),
    sourceType: text().notNull(),
    sourceId: uuid().notNull(),
    note: text(),
    createdByUserId: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.variantId],
      foreignColumns: [productVariants.merchantId, productVariants.id],
    }),
    check('stock_movements_quantity_nonzero', sql`${t.quantity} <> 0`),
    check(
      'stock_movements_type_valid',
      sql`${t.movementType} in ('opening', 'adjustment', 'count', 'sale', 'sale_void', 'refund', 'transfer_out', 'transfer_in', 'purchase_receipt')`,
    ),
    index('stock_movements_level_idx').on(t.merchantId, t.branchId, t.variantId, t.createdAt),
    index('stock_movements_branch_time_idx').on(t.merchantId, t.branchId, t.createdAt),
    index('stock_movements_source_idx').on(t.merchantId, t.sourceType, t.sourceId),
  ],
);
