import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId, updatedAt } from '../../database/schema/columns.js';
import { branches } from '../branches/branches.schema.js';
import { productVariants } from '../catalog/catalog.schema.js';
import { users } from '../iam/iam.schema.js';
import { merchants } from '../merchants/merchants.schema.js';

const quantity = () => numeric({ precision: 14, scale: 3 });

export const suppliers = pgTable(
  'suppliers',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    code: text(),
    nameEn: text(),
    nameAr: text(),
    contactName: text(),
    phone: text(),
    email: text(),
    address: text(),
    taxNumber: text(),
    paymentTerms: text(),
    notes: text(),
    status: text().notNull().default('active'),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('suppliers_merchant_id_id_key').on(t.merchantId, t.id),
    uniqueIndex('suppliers_code_key')
      .on(t.merchantId, sql`lower(${t.code})`)
      .where(sql`${t.code} is not null`),
    check('suppliers_name_present', sql`coalesce(${t.nameEn}, ${t.nameAr}) is not null`),
    check('suppliers_status_valid', sql`${t.status} in ('active', 'inactive')`),
  ],
);

/**
 * Purchase order (Prompt 12): draft → submitted → approved → partially_received →
 * received; cancelled (nothing received) or closed (rest of a partial order cancelled).
 */
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: id(),
    merchantId: merchantId(),
    number: text().notNull(),
    supplierId: uuid().notNull(),
    branchId: uuid().notNull(),
    status: text().notNull().default('draft'),
    expectedDate: date(),
    note: text(),
    createdByUserId: uuid()
      .notNull()
      .references(() => users.id),
    submittedAt: timestamp({ withTimezone: true }),
    approvedByUserId: uuid().references(() => users.id),
    approvedAt: timestamp({ withTimezone: true }),
    closedByUserId: uuid().references(() => users.id),
    closedAt: timestamp({ withTimezone: true }),
    closeReason: text(),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('purchase_orders_merchant_id_id_key').on(t.merchantId, t.id),
    unique('purchase_orders_number_key').on(t.merchantId, t.number),
    foreignKey({
      columns: [t.merchantId, t.supplierId],
      foreignColumns: [suppliers.merchantId, suppliers.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    check(
      'purchase_orders_status_valid',
      sql`${t.status} in ('draft', 'submitted', 'approved', 'partially_received', 'received', 'cancelled', 'closed')`,
    ),
    index('purchase_orders_supplier_idx').on(t.merchantId, t.supplierId),
    index('purchase_orders_branch_status_idx').on(t.merchantId, t.branchId, t.status),
  ],
);

export const purchaseOrderLines = pgTable(
  'purchase_order_lines',
  {
    merchantId: merchantId(),
    purchaseOrderId: uuid().notNull(),
    position: integer().notNull(),
    variantId: uuid().notNull(),
    quantity: quantity().notNull(),
    unitCostMinor: bigint({ mode: 'bigint' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.purchaseOrderId, t.position] }),
    foreignKey({
      columns: [t.merchantId, t.purchaseOrderId],
      foreignColumns: [purchaseOrders.merchantId, purchaseOrders.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.variantId],
      foreignColumns: [productVariants.merchantId, productVariants.id],
    }),
    check('purchase_order_lines_valid', sql`${t.quantity} > 0 and ${t.unitCostMinor} >= 0`),
  ],
);

/** One delivery against an order (append-only). Stock rises through the inventory ledger. */
export const purchaseReceipts = pgTable(
  'purchase_receipts',
  {
    id: id(),
    merchantId: merchantId(),
    number: text().notNull(),
    purchaseOrderId: uuid().notNull(),
    branchId: uuid().notNull(),
    note: text(),
    supplierReference: text(),
    idempotencyKey: uuid(),
    requestHash: text(),
    receivedByUserId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('purchase_receipts_merchant_id_id_key').on(t.merchantId, t.id),
    unique('purchase_receipts_number_key').on(t.merchantId, t.number),
    unique('purchase_receipts_idempotency_key').on(t.merchantId, t.idempotencyKey),
    foreignKey({
      columns: [t.merchantId, t.purchaseOrderId],
      foreignColumns: [purchaseOrders.merchantId, purchaseOrders.id],
    }),
    index('purchase_receipts_order_idx').on(t.merchantId, t.purchaseOrderId),
    index('purchase_receipts_branch_time_idx').on(t.merchantId, t.branchId, t.createdAt),
  ],
);

export const purchaseReceiptLines = pgTable(
  'purchase_receipt_lines',
  {
    merchantId: merchantId(),
    receiptId: uuid().notNull(),
    orderPosition: integer().notNull(),
    variantId: uuid().notNull(),
    quantity: quantity().notNull(),
    unitCostMinor: bigint({ mode: 'bigint' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.receiptId, t.orderPosition] }),
    foreignKey({
      columns: [t.merchantId, t.receiptId],
      foreignColumns: [purchaseReceipts.merchantId, purchaseReceipts.id],
    }),
    check('purchase_receipt_lines_positive', sql`${t.quantity} > 0`),
  ],
);
