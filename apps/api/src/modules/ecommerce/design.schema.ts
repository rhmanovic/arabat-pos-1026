import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId, updatedAt } from '../../database/schema/columns.js';
import { merchants } from '../merchants/merchants.schema.js';

/**
 * Storefront design (ADR-0128): one row per store. `draft` is what the merchant edits in the
 * console; `published` is what shoppers see (null = the legacy layout). Both are validated by
 * `storeDesignSchema` before they are written.
 */
export const onlineStoreDesigns = pgTable('online_store_designs', {
  merchantId: uuid()
    .primaryKey()
    .references(() => merchants.id),
  draft: jsonb().notNull(),
  published: jsonb(),
  publishedAt: timestamp({ withTimezone: true }),
  publishedByUserId: uuid(),
  version: integer().notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Pictures uploaded for the design (slides, banners, image sections), stored through
 * `FileStorage` and served publicly by the store. Removed only when no design refers to them.
 */
export const onlineStoreAssets = pgTable(
  'online_store_assets',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    storageKey: text().notNull(),
    contentType: text().notNull(),
    bytes: integer().notNull(),
    createdByUserId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    index('online_store_assets_merchant_idx').on(t.merchantId, t.createdAt),
    check('online_store_assets_bytes_valid', sql`${t.bytes} > 0`),
  ],
);
