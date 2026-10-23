import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
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
import { productVariants, products } from '../catalog/catalog.schema.js';
import { productDiscounts } from '../catalog/discounts.schema.js';
import { merchants } from '../merchants/merchants.schema.js';
import { onlinePromotions } from './promotions.schema.js';

const quantity = () => numeric({ precision: 14, scale: 3 });
const minor = () => bigint({ mode: 'bigint' });

/** One online store per merchant (Prompt 16). Public pages resolve it by `slug`. */
export const onlineStores = pgTable(
  'online_stores',
  {
    merchantId: uuid()
      .primaryKey()
      .references(() => merchants.id),
    slug: text().notNull(),
    /**
     * The store's permanent code (ADR-0137), e.g. `st-4k9m2p`: given once by the database and
     * never changed, so `st-4k9m2p.arabatapp.com` always reaches the store whatever its address.
     */
    publicCode: text()
      .notNull()
      .default(sql`new_store_code()`),
    /** draft (never public) → published ↔ paused (closed for orders, still visible). */
    status: text().notNull().default('draft'),
    nameEn: text(),
    nameAr: text(),
    taglineEn: text(),
    taglineAr: text(),
    announcementEn: text(),
    announcementAr: text(),
    /** Brand colour as #rrggbb. */
    primaryColor: text().notNull().default('#1e3a8a'),
    contactPhone: text(),
    contactEmail: text(),
    /** Stock, prices and fulfilment come from this branch. */
    fulfillmentBranchId: uuid(),
    pickupEnabled: boolean().notNull().default(true),
    deliveryEnabled: boolean().notNull().default(false),
    deliveryFeeMinor: minor()
      .notNull()
      .default(sql`0`),
    minimumOrderMinor: minor()
      .notNull()
      .default(sql`0`),
    /** Minutes an unpaid gateway order keeps its stock reserved. */
    reservationMinutes: integer().notNull().default(30),
    /** Orders may be placed without paying online; the money is collected on hand-over (ADR-0118). */
    payOnReceiptEnabled: boolean().notNull().default(true),
    /** Store logo and banner (ADR-0121); the bytes live in the file storage. */
    logoKey: text(),
    logoContentType: text(),
    bannerKey: text(),
    bannerContentType: text(),
    /** Products with nothing available at the fulfilment branch are left out of the storefront. */
    hideOutOfStock: boolean().notNull().default(false),
    /**
     * Opening hours (ADR-0123): { mon: [{ open: 'HH:MM', close: 'HH:MM' }], …, sun: [] }; null =
     * always open. A branch row may override them.
     */
    hours: jsonb(),
    /** Shoppers may pick a time slot instead of "as soon as possible". */
    schedulingEnabled: boolean().notNull().default(false),
    slotMinutes: integer().notNull().default(30),
    /** Orders accepted per slot and branch; null = unlimited. */
    slotCapacity: integer(),
    /** E-mail the store's contact address about new orders. */
    notifyEmail: boolean().notNull().default(true),
    /** Shoppers may create an account (ADR-0124); guests can always order. */
    accountsEnabled: boolean().notNull().default(true),
    version: integer().notNull().default(1),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('online_stores_slot_valid', sql`${t.slotMinutes} between 15 and 240`),
    check('online_stores_capacity_valid', sql`${t.slotCapacity} is null or ${t.slotCapacity} >= 1`),
    check('online_stores_logo_pair', sql`(${t.logoKey} is null) = (${t.logoContentType} is null)`),
    check(
      'online_stores_banner_pair',
      sql`(${t.bannerKey} is null) = (${t.bannerContentType} is null)`,
    ),
    uniqueIndex('online_stores_slug_key').on(sql`lower(${t.slug})`),
    uniqueIndex('online_stores_public_code_key').on(t.publicCode),
    check('online_stores_public_code_valid', sql`${t.publicCode} ~ '^st-[a-z0-9]{6}$'`),
    foreignKey({
      columns: [t.merchantId, t.fulfillmentBranchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    check('online_stores_status_valid', sql`${t.status} in ('draft', 'published', 'paused')`),
    check('online_stores_slug_valid', sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,40}$'`),
    check('online_stores_color_valid', sql`${t.primaryColor} ~ '^#[0-9a-fA-F]{6}$'`),
    check(
      'online_stores_money_valid',
      sql`${t.deliveryFeeMinor} >= 0 and ${t.minimumOrderMinor} >= 0`,
    ),
    check('online_stores_reservation_valid', sql`${t.reservationMinutes} between 5 and 1440`),
  ],
);

/**
 * Former store addresses (ADR-0118): a renamed store keeps answering on its old address until
 * `expires_at`, and nobody else can take it meanwhile. Append-only.
 */
export const onlineStoreSlugHistory = pgTable(
  'online_store_slug_history',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    slug: text().notNull(),
    replacedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    index('online_store_slug_history_slug_idx').on(sql`lower(${t.slug})`),
    index('online_store_slug_history_merchant_idx').on(t.merchantId, t.replacedAt),
    check('online_store_slug_history_slug_valid', sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,40}$'`),
  ],
);

/**
 * Marketing collections of the store (ADR-0130): "Offers", "New in"… A product may be in several;
 * they never replace the shared categories. The store categories of ADR-0121 became collections
 * (same ids, so links, designs and promotions that named them keep working).
 */
export const onlineCollections = pgTable(
  'online_collections',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    nameEn: text(),
    nameAr: text(),
    position: integer().notNull().default(0),
    /** active | hidden (kept, not shown). */
    status: text().notNull().default('active'),
    imageKey: text(),
    imageContentType: text(),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('online_collections_merchant_id_id_key').on(t.merchantId, t.id),
    index('online_collections_merchant_idx').on(t.merchantId, t.position),
    check('online_collections_name_present', sql`coalesce(${t.nameEn}, ${t.nameAr}) is not null`),
    check('online_collections_status_valid', sql`${t.status} in ('active', 'hidden')`),
    check(
      'online_collections_image_pair',
      sql`(${t.imageKey} is null) = (${t.imageContentType} is null)`,
    ),
  ],
);

/** Products of a collection, in the collection's own order. */
export const onlineCollectionProducts = pgTable(
  'online_collection_products',
  {
    merchantId: merchantId(),
    collectionId: uuid().notNull(),
    productId: uuid().notNull(),
    position: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.merchantId, t.collectionId, t.productId] }),
    foreignKey({
      columns: [t.merchantId, t.collectionId],
      foreignColumns: [onlineCollections.merchantId, onlineCollections.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.merchantId, t.productId],
      foreignColumns: [products.merchantId, products.id],
    }),
    index('online_collection_products_product_idx').on(t.merchantId, t.productId),
  ],
);

/**
 * Every product has a listing (ADR-0130: a product added anywhere is in both places); `visible`
 * says whether shoppers see it on the website. On top of the catalog, the listing holds what
 * the store says about the product (ADR-0121): an online title and description, featured, a
 * per-order cap and the display order. Prices, stock and the category stay the catalog's.
 */
export const onlineListings = pgTable(
  'online_listings',
  {
    merchantId: merchantId(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    position: integer().notNull().default(0),
    titleEn: text(),
    titleAr: text(),
    descriptionEn: text(),
    descriptionAr: text(),
    featured: boolean().notNull().default(false),
    /** Shown on the website (the store console's switch, ADR-0130). */
    visible: boolean().notNull().default(true),
    /** Units of one variant per order (1–20); null = the store default (20). */
    maxPerOrder: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.merchantId, t.productId] }),
    check(
      'online_listings_max_per_order_valid',
      sql`${t.maxPerOrder} is null or (${t.maxPerOrder} between 1 and 20)`,
    ),
  ],
);

/**
 * Delivery areas (ADR-0123): the shopper picks one at checkout; its fee and minimum apply, and
 * orders above `free_delivery_from_minor` are delivered free. The serving branch defaults to
 * the store's fulfilment branch. While a merchant has none, the flat store fee applies.
 */
export const onlineDeliveryAreas = pgTable(
  'online_delivery_areas',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    nameEn: text(),
    nameAr: text(),
    feeMinor: minor()
      .notNull()
      .default(sql`0`),
    minimumOrderMinor: minor()
      .notNull()
      .default(sql`0`),
    freeDeliveryFromMinor: minor(),
    estimatedMinutes: integer(),
    branchId: uuid(),
    position: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('online_delivery_areas_merchant_id_id_key').on(t.merchantId, t.id),
    index('online_delivery_areas_merchant_idx').on(t.merchantId, t.position),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    check(
      'online_delivery_areas_name_present',
      sql`coalesce(${t.nameEn}, ${t.nameAr}) is not null`,
    ),
    check(
      'online_delivery_areas_money_valid',
      sql`${t.feeMinor} >= 0 and ${t.minimumOrderMinor} >= 0 and (${t.freeDeliveryFromMinor} is null or ${t.freeDeliveryFromMinor} >= 0)`,
    ),
    check(
      'online_delivery_areas_minutes_valid',
      sql`${t.estimatedMinutes} is null or (${t.estimatedMinutes} between 1 and 1440)`,
    ),
  ],
);

/**
 * Branches that serve the store (ADR-0123): pickup and / or delivery, with their preparation
 * time and, optionally, their own hours. While a merchant has none, the store's single
 * fulfilment branch serves everything, as before.
 */
export const onlineStoreBranches = pgTable(
  'online_store_branches',
  {
    merchantId: merchantId().references(() => merchants.id),
    branchId: uuid().notNull(),
    pickupEnabled: boolean().notNull().default(true),
    deliveryEnabled: boolean().notNull().default(false),
    preparationMinutes: integer().notNull().default(30),
    /** Same shape as `online_stores.hours`; null = the store's hours. */
    hours: jsonb(),
    position: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.merchantId, t.branchId] }),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    check(
      'online_store_branches_preparation_valid',
      sql`${t.preparationMinutes} between 0 and 1440`,
    ),
    check('online_store_branches_fulfilment', sql`${t.pickupEnabled} or ${t.deliveryEnabled}`),
  ],
);

/**
 * Online order: customer intent until paid; the sale created on payment is the financial
 * document (ADR-0077). Gateway orders: pending_payment → paid → preparing → ready |
 * out_for_delivery → completed; or expired / payment_failed / cancelled; needs_attention
 * when a late payment can no longer be fulfilled. Pay-on-receipt orders (ADR-0118, no
 * reservation, no gateway attempt): placed → confirmed → preparing → ready | out_for_delivery
 * → completed; the payment is recorded by staff at any point before completion.
 */
export const onlineOrders = pgTable(
  'online_orders',
  {
    id: id(),
    merchantId: merchantId(),
    number: text().notNull(),
    branchId: uuid().notNull(),
    status: text().notNull().default('pending_payment'),
    fulfillment: text().notNull(),
    customerName: text().notNull(),
    customerPhone: text().notNull(),
    customerEmail: text(),
    deliveryAddress: text(),
    /** The delivery area chosen at checkout (ADR-0123) and its name then; single-column FK. */
    deliveryAreaId: uuid().references(() => onlineDeliveryAreas.id, { onDelete: 'set null' }),
    deliveryAreaName: text(),
    /** Requested slot start; null = as soon as possible. */
    scheduledFor: timestamp({ withTimezone: true }),
    /** Idempotency key of the till payment that settled the order (POS hand-over, ADR-0123). */
    posIdempotencyKey: uuid(),
    /** The promotion applied (ADR-0125): id while it exists, code and name as they were. */
    promotionId: uuid().references(() => onlinePromotions.id, { onDelete: 'set null' }),
    promotionCode: text(),
    promotionName: text(),
    discountMinor: minor()
      .notNull()
      .default(sql`0`),
    note: text(),
    customerId: uuid(),
    currency: char({ length: 3 }).notNull().default('KWD'),
    subtotalMinor: minor().notNull(),
    deliveryFeeMinor: minor().notNull(),
    totalMinor: minor().notNull(),
    /** gateway: paid online before fulfilment · on_receipt: collected on hand-over. */
    paymentMode: text().notNull().default('gateway'),
    /** Gateway orders: chosen at checkout. Pay-on-receipt orders: the tender recorded by staff. */
    paymentMethodId: uuid(),
    /** Reference of a non-cash tender recorded by staff (pay on receipt). */
    paymentReference: text(),
    collectedByUserId: uuid(),
    /** Unguessable token for the customer's tracking page. */
    trackingToken: text().notNull(),
    idempotencyKey: uuid().notNull(),
    requestHash: text().notNull(),
    /** Gateway orders only: when the stock reservation ends. */
    reservedUntil: timestamp({ withTimezone: true }),
    saleId: uuid(),
    confirmedAt: timestamp({ withTimezone: true }),
    paidAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    statusNote: text(),
    /** Status changes for the customer's timeline: [{ status, at }]. */
    history: jsonb().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: integer().notNull().default(1),
  },
  (t) => [
    unique('online_orders_merchant_id_id_key').on(t.merchantId, t.id),
    unique('online_orders_number_key').on(t.merchantId, t.number),
    unique('online_orders_idempotency_key').on(t.merchantId, t.idempotencyKey),
    uniqueIndex('online_orders_tracking_key').on(t.trackingToken),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    index('online_orders_schedule_idx')
      .on(t.merchantId, t.branchId, t.scheduledFor)
      .where(sql`${t.scheduledFor} is not null`),
    check(
      'online_orders_status_valid',
      sql`${t.status} in ('pending_payment', 'placed', 'confirmed', 'paid', 'preparing', 'ready', 'out_for_delivery',
                          'completed', 'expired', 'payment_failed', 'cancelled', 'needs_attention')`,
    ),
    check('online_orders_payment_mode_valid', sql`${t.paymentMode} in ('gateway', 'on_receipt')`),
    check(
      'online_orders_gateway_fields',
      sql`${t.paymentMode} <> 'gateway' or (${t.paymentMethodId} is not null and ${t.reservedUntil} is not null)`,
    ),
    check('online_orders_fulfillment_valid', sql`${t.fulfillment} in ('pickup', 'delivery')`),
    check(
      'online_orders_delivery_address',
      sql`${t.fulfillment} <> 'delivery' or ${t.deliveryAddress} is not null`,
    ),
    check(
      'online_orders_totals',
      sql`${t.totalMinor} = ${t.subtotalMinor} - ${t.discountMinor} + ${t.deliveryFeeMinor}
          and ${t.discountMinor} >= 0 and ${t.discountMinor} <= ${t.subtotalMinor} and ${t.totalMinor} > 0`,
    ),
    index('online_orders_status_idx').on(t.merchantId, t.status, t.createdAt),
  ],
);

export const onlineOrderLines = pgTable(
  'online_order_lines',
  {
    merchantId: merchantId(),
    orderId: uuid().notNull(),
    position: integer().notNull(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id),
    productId: uuid().notNull(),
    nameEn: text(),
    nameAr: text(),
    variantNameEn: text(),
    variantNameAr: text(),
    sku: text(),
    quantity: quantity().notNull(),
    /** Price shown at checkout; the sale uses it even if the catalog price changes later. */
    unitPriceMinor: minor().notNull(),
    /** The price before a product discount (ADR-0133); null without one. */
    regularUnitPriceMinor: minor(),
    productDiscountId: uuid().references(() => productDiscounts.id),
    lineTotalMinor: minor().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.position] }),
    foreignKey({
      columns: [t.merchantId, t.orderId],
      foreignColumns: [onlineOrders.merchantId, onlineOrders.id],
    }),
    check('online_order_lines_positive', sql`${t.quantity} > 0 and ${t.unitPriceMinor} >= 0`),
  ],
);

/**
 * Stock held for an unpaid online order (ADR-0079). Counts against availability for POS
 * and online sales while `status = 'active' and expires_at > now()`.
 */
export const stockReservations = pgTable(
  'stock_reservations',
  {
    id: id(),
    merchantId: merchantId(),
    branchId: uuid().notNull(),
    variantId: uuid().notNull(),
    onlineOrderId: uuid().notNull(),
    quantity: quantity().notNull(),
    status: text().notNull().default('active'),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
    releasedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.merchantId, t.onlineOrderId],
      foreignColumns: [onlineOrders.merchantId, onlineOrders.id],
    }),
    check('stock_reservations_quantity_positive', sql`${t.quantity} > 0`),
    check(
      'stock_reservations_status_valid',
      sql`${t.status} in ('active', 'consumed', 'released')`,
    ),
    index('stock_reservations_active_idx')
      .on(t.merchantId, t.branchId, t.variantId)
      .where(sql`${t.status} = 'active'`),
  ],
);

/**
 * One payment attempt at a gateway (mutable state machine). A succeeded attempt is copied
 * into the append-only `payments` table of the sale. Status: initiated → succeeded |
 * failed | cancelled | expired.
 */
export const onlinePayments = pgTable(
  'online_payments',
  {
    id: id(),
    merchantId: merchantId(),
    onlineOrderId: uuid().notNull(),
    provider: text().notNull(),
    providerReference: text(),
    amountMinor: minor().notNull(),
    currency: char({ length: 3 }).notNull().default('KWD'),
    status: text().notNull().default('initiated'),
    redirectUrl: text(),
    failureReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique('online_payments_merchant_id_id_key').on(t.merchantId, t.id),
    uniqueIndex('online_payments_provider_ref_key').on(t.provider, t.providerReference),
    foreignKey({
      columns: [t.merchantId, t.onlineOrderId],
      foreignColumns: [onlineOrders.merchantId, onlineOrders.id],
    }),
    check(
      'online_payments_status_valid',
      sql`${t.status} in ('initiated', 'succeeded', 'failed', 'cancelled', 'expired')`,
    ),
    check('online_payments_amount_positive', sql`${t.amountMinor} > 0`),
  ],
);

/** Every gateway notification received, once per provider event id (idempotency + audit). */
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: id(),
    merchantId: merchantId(),
    provider: text().notNull(),
    eventId: text().notNull(),
    onlinePaymentId: uuid().notNull(),
    status: text().notNull(),
    amountMinor: minor(),
    payload: jsonb().notNull(),
    outcome: text().notNull(),
    receivedAt: createdAt(),
  },
  (t) => [uniqueIndex('payment_events_provider_event_key').on(t.provider, t.eventId)],
);
