import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId, updatedAt } from '../../database/schema/columns.js';
import { merchants } from '../merchants/merchants.schema.js';

/**
 * Product discounts (ADR-0133): a percentage or an amount off the catalog price of the products
 * a discount covers, at the point of sale and / or in the online store, optionally between two
 * dates. They change no catalog price: the price in force is worked out when an item is shown
 * or sold (`@arabat/pos-core` discounts), and a sale line records the regular price and the
 * discount. Never deleted once created (sales name them): archived instead.
 */
export const productDiscounts = pgTable(
  'product_discounts',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    nameEn: text(),
    nameAr: text(),
    /** percentage | amount. */
    discountType: text().notNull(),
    percent: numeric({ precision: 5, scale: 2 }),
    amountMinor: bigint({ mode: 'bigint' }),
    /** all | categories | collections | products. */
    appliesTo: text().notNull(),
    /** Category, collection or product ids (empty for `all`). */
    targetIds: jsonb().notNull().default([]),
    posEnabled: boolean().notNull().default(true),
    onlineEnabled: boolean().notNull().default(true),
    startsAt: timestamp({ withTimezone: true }),
    endsAt: timestamp({ withTimezone: true }),
    /** active | paused | archived. */
    status: text().notNull().default('active'),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('product_discounts_merchant_id_id_key').on(t.merchantId, t.id),
    index('product_discounts_merchant_idx').on(t.merchantId, t.status),
    check('product_discounts_name_present', sql`coalesce(${t.nameEn}, ${t.nameAr}) is not null`),
    check('product_discounts_type_valid', sql`${t.discountType} in ('percentage', 'amount')`),
    check(
      'product_discounts_value_valid',
      sql`(${t.discountType} = 'percentage' and ${t.percent} > 0 and ${t.percent} < 100 and ${t.amountMinor} is null)
          or (${t.discountType} = 'amount' and ${t.amountMinor} > 0 and ${t.percent} is null)`,
    ),
    check(
      'product_discounts_applies_valid',
      sql`${t.appliesTo} in ('all', 'categories', 'collections', 'products')`,
    ),
    check('product_discounts_channel_present', sql`${t.posEnabled} or ${t.onlineEnabled}`),
    check('product_discounts_status_valid', sql`${t.status} in ('active', 'paused', 'archived')`),
    check(
      'product_discounts_dates_valid',
      sql`${t.startsAt} is null or ${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`,
    ),
  ],
);
