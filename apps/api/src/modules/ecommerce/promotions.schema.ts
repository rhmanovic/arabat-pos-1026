import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId, updatedAt } from '../../database/schema/columns.js';
import { merchants } from '../merchants/merchants.schema.js';

const minor = () => bigint({ mode: 'bigint' });

/**
 * Store promotions (ADR-0125): a code the shopper enters, or an automatic offer applied when
 * its conditions hold. One promotion per order; the discount is an order discount on the
 * sale (or a free delivery). Never stacked.
 */
export const onlinePromotions = pgTable(
  'online_promotions',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    nameEn: text(),
    nameAr: text(),
    /** code (entered at checkout) | automatic (applied when it fits). */
    kind: text().notNull().default('code'),
    /** Upper-case letters and digits; unique per merchant while present. */
    code: text(),
    /** percentage | fixed | free_delivery. */
    discountType: text().notNull(),
    percent: numeric({ precision: 5, scale: 2 }),
    amountMinor: minor(),
    minimumOrderMinor: minor()
      .notNull()
      .default(sql`0`),
    /** Null = unlimited. Uses are counted on placed orders and never decremented. */
    maxUses: integer(),
    usesCount: integer().notNull().default(0),
    maxUsesPerCustomer: integer(),
    startsAt: timestamp({ withTimezone: true }),
    endsAt: timestamp({ withTimezone: true }),
    /** active | paused. */
    status: text().notNull().default('active'),
    /** order | category | product: what the percentage / fixed discount applies to. */
    appliesTo: text().notNull().default('order'),
    /** Category or product ids when `applies_to` is not `order`. */
    targetIds: jsonb().notNull().default([]),
    /** Also applies to items lowered by a product discount (ADR-0133); off by default. */
    stacksWithDiscounts: boolean().notNull().default(false),
    position: integer().notNull().default(0),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('online_promotions_merchant_id_id_key').on(t.merchantId, t.id),
    uniqueIndex('online_promotions_code_key')
      .on(t.merchantId, t.code)
      .where(sql`${t.code} is not null`),
    index('online_promotions_merchant_idx').on(t.merchantId, t.position),
    check('online_promotions_name_present', sql`coalesce(${t.nameEn}, ${t.nameAr}) is not null`),
    check('online_promotions_kind_valid', sql`${t.kind} in ('code', 'automatic')`),
    check(
      'online_promotions_code_valid',
      sql`(${t.kind} = 'code') = (${t.code} is not null) and (${t.code} is null or ${t.code} ~ '^[A-Z0-9]{3,20}$')`,
    ),
    check(
      'online_promotions_type_valid',
      sql`${t.discountType} in ('percentage', 'fixed', 'free_delivery')`,
    ),
    check(
      'online_promotions_value_valid',
      sql`(${t.discountType} = 'percentage' and ${t.percent} > 0 and ${t.percent} <= 100 and ${t.amountMinor} is null)
          or (${t.discountType} = 'fixed' and ${t.amountMinor} > 0 and ${t.percent} is null)
          or (${t.discountType} = 'free_delivery' and ${t.amountMinor} is null and ${t.percent} is null)`,
    ),
    check('online_promotions_status_valid', sql`${t.status} in ('active', 'paused')`),
    check(
      'online_promotions_applies_valid',
      sql`${t.appliesTo} in ('order', 'category', 'product')`,
    ),
    check(
      'online_promotions_limits_valid',
      sql`${t.minimumOrderMinor} >= 0 and (${t.maxUses} is null or ${t.maxUses} >= 1)
          and (${t.maxUsesPerCustomer} is null or ${t.maxUsesPerCustomer} >= 1) and ${t.usesCount} >= 0`,
    ),
    check(
      'online_promotions_dates_valid',
      sql`${t.startsAt} is null or ${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`,
    ),
  ],
);

/** Every use of a promotion by an order (append-only; the count on the promotion is derived). */
export const onlinePromotionUses = pgTable(
  'online_promotion_uses',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    promotionId: uuid().notNull(),
    orderId: uuid().notNull(),
    customerId: uuid(),
    customerPhone: text().notNull(),
    discountMinor: minor().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('online_promotion_uses_order_key').on(t.merchantId, t.orderId),
    index('online_promotion_uses_promotion_idx').on(t.merchantId, t.promotionId, t.customerPhone),
    foreignKey({
      columns: [t.merchantId, t.promotionId],
      foreignColumns: [onlinePromotions.merchantId, onlinePromotions.id],
    }),
    check('online_promotion_uses_amount_valid', sql`${t.discountMinor} >= 0`),
  ],
);
