import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId, updatedAt } from '../../database/schema/columns.js';
import { currencies } from '../../database/schema/currencies.schema.js';
import { branches } from '../branches/branches.schema.js';
import { users } from '../iam/iam.schema.js';
import { merchants } from '../merchants/merchants.schema.js';

/**
 * Product catalog (Prompt 7). Definitions only: stock quantities live in the inventory
 * module. Prices are bigint minor units (fils) with an explicit currency.
 */
export const categories = pgTable(
  'categories',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    parentId: uuid(),
    nameEn: text(),
    nameAr: text(),
    sortOrder: integer().notNull().default(0),
    status: text().notNull().default('active'),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('categories_merchant_id_id_key').on(t.merchantId, t.id),
    foreignKey({ columns: [t.merchantId, t.parentId], foreignColumns: [t.merchantId, t.id] }),
    check('categories_name_present', sql`coalesce(${t.nameEn}, ${t.nameAr}) is not null`),
    check('categories_status_valid', sql`${t.status} in ('active', 'archived')`),
    check('categories_not_own_parent', sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
  ],
);

export const products = pgTable(
  'products',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    categoryId: uuid(),
    nameEn: text(),
    nameAr: text(),
    descriptionEn: text(),
    descriptionAr: text(),
    /** 'standard' goods (stock can be tracked) or 'service' (never stocked). */
    type: text().notNull().default('standard'),
    hasVariants: boolean().notNull().default(false),
    trackInventory: boolean().notNull().default(true),
    /** When false, the product is sold only at the branches listed in product_branch_availability. */
    availableInAllBranches: boolean().notNull().default(true),
    status: text().notNull().default('active'),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('products_merchant_id_id_key').on(t.merchantId, t.id),
    foreignKey({
      columns: [t.merchantId, t.categoryId],
      foreignColumns: [categories.merchantId, categories.id],
    }),
    check('products_name_present', sql`coalesce(${t.nameEn}, ${t.nameAr}) is not null`),
    check('products_type_valid', sql`${t.type} in ('standard', 'service')`),
    check('products_status_valid', sql`${t.status} in ('active', 'archived')`),
    check('products_service_not_tracked', sql`${t.type} = 'standard' or not ${t.trackInventory}`),
    index('products_merchant_status_idx').on(t.merchantId, t.status),
    index('products_merchant_category_idx').on(t.merchantId, t.categoryId),
  ],
);

/** Every product has at least one variant; a simple product has exactly one default variant. */
export const productVariants = pgTable(
  'product_variants',
  {
    id: id(),
    merchantId: merchantId(),
    productId: uuid().notNull(),
    nameEn: text(),
    nameAr: text(),
    sku: text(),
    priceMinor: bigint({ mode: 'bigint' }).notNull(),
    costMinor: bigint({ mode: 'bigint' }),
    currency: char({ length: 3 })
      .notNull()
      .default('KWD')
      .references(() => currencies.code),
    position: integer().notNull().default(0),
    isDefault: boolean().notNull().default(false),
    status: text().notNull().default('active'),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('product_variants_merchant_id_id_key').on(t.merchantId, t.id),
    foreignKey({
      columns: [t.merchantId, t.productId],
      foreignColumns: [products.merchantId, products.id],
    }),
    // SKUs are unique per merchant, including archived variants (unambiguous history).
    uniqueIndex('product_variants_merchant_sku_key')
      .on(t.merchantId, sql`lower(${t.sku})`)
      .where(sql`${t.sku} is not null`),
    uniqueIndex('product_variants_one_default')
      .on(t.productId)
      .where(sql`${t.isDefault}`),
    check(
      'product_variants_price_range',
      sql`${t.priceMinor} >= 0 and ${t.priceMinor} <= 1000000000000`,
    ),
    check(
      'product_variants_cost_range',
      sql`${t.costMinor} is null or (${t.costMinor} >= 0 and ${t.costMinor} <= 1000000000000)`,
    ),
    check('product_variants_status_valid', sql`${t.status} in ('active', 'archived')`),
    index('product_variants_product_idx').on(t.merchantId, t.productId),
  ],
);

/** Barcodes are unique per merchant; a variant may have several (e.g. old and new packaging). */
export const productBarcodes = pgTable(
  'product_barcodes',
  {
    merchantId: merchantId(),
    barcode: text().notNull(),
    variantId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.merchantId, t.barcode] }),
    foreignKey({
      columns: [t.merchantId, t.variantId],
      foreignColumns: [productVariants.merchantId, productVariants.id],
    }).onDelete('cascade'),
    check('product_barcodes_format', sql`${t.barcode} ~ '^[A-Za-z0-9._-]{3,64}$'`),
    index('product_barcodes_variant_idx').on(t.merchantId, t.variantId),
  ],
);

export const productBranchAvailability = pgTable(
  'product_branch_availability',
  {
    merchantId: merchantId(),
    productId: uuid().notNull(),
    branchId: uuid().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.branchId] }),
    foreignKey({
      columns: [t.merchantId, t.productId],
      foreignColumns: [products.merchantId, products.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    index('product_branch_availability_branch_idx').on(t.merchantId, t.branchId),
  ],
);

/** Image metadata; the bytes live in the configured file storage (local disk in development). */
export const productImages = pgTable(
  'product_images',
  {
    id: id(),
    merchantId: merchantId(),
    productId: uuid().notNull(),
    storageKey: text().notNull(),
    contentType: text().notNull(),
    sizeBytes: integer().notNull(),
    position: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique('product_images_merchant_id_id_key').on(t.merchantId, t.id),
    foreignKey({
      columns: [t.merchantId, t.productId],
      foreignColumns: [products.merchantId, products.id],
    }).onDelete('cascade'),
    check(
      'product_images_type_valid',
      sql`${t.contentType} in ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check('product_images_size_valid', sql`${t.sizeBytes} > 0 and ${t.sizeBytes} <= 5242880`),
  ],
);

/** Price and cost changes of variants (BR-191, FND-222): append-only, RLS (migration 0047). */
export const priceHistory = pgTable(
  'price_history',
  {
    id: id(),
    merchantId: merchantId(),
    productId: uuid().notNull(),
    variantId: uuid().notNull(),
    /** price | cost */
    kind: text().notNull(),
    fromMinor: bigint({ mode: 'bigint' }),
    toMinor: bigint({ mode: 'bigint' }),
    /** manual | created */
    source: text().notNull().default('manual'),
    changedByUserId: uuid().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('price_history_merchant_id_id_key').on(t.merchantId, t.id),
    index('price_history_product_idx').on(t.merchantId, t.productId, t.createdAt),
    check('price_history_kind_valid', sql`${t.kind} in ('price', 'cost')`),
    check('price_history_source_valid', sql`${t.source} in ('manual', 'created')`),
  ],
);
