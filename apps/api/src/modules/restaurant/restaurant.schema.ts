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
import { categories, productVariants, products } from '../catalog/catalog.schema.js';
import { users } from '../iam/iam.schema.js';
import { merchants } from '../merchants/merchants.schema.js';

const quantity = () => numeric({ precision: 14, scale: 3 });
const minor = () => bigint({ mode: 'bigint' });

/** The restaurant module is off until a merchant enables it (Prompt 15, ADR-0072). */
export const restaurantSettings = pgTable('restaurant_settings', {
  merchantId: uuid()
    .primaryKey()
    .references(() => merchants.id),
  enabled: boolean().notNull().default(false),
  /** Items are sent to the kitchen automatically when a takeaway/pickup bill is paid. */
  autoSendOnPayment: boolean().notNull().default(true),
  version: integer().notNull().default(1),
  updatedAt: updatedAt(),
});

export const diningAreas = pgTable(
  'dining_areas',
  {
    id: id(),
    merchantId: merchantId(),
    branchId: uuid().notNull(),
    nameEn: text(),
    nameAr: text(),
    position: integer().notNull().default(0),
    status: text().notNull().default('active'),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    unique('dining_areas_merchant_id_id_key').on(t.merchantId, t.id),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    check('dining_areas_name_present', sql`coalesce(${t.nameEn}, ${t.nameAr}) is not null`),
    check('dining_areas_status_valid', sql`${t.status} in ('active', 'inactive')`),
  ],
);

export const diningTables = pgTable(
  'dining_tables',
  {
    id: id(),
    merchantId: merchantId(),
    branchId: uuid().notNull(),
    areaId: uuid().notNull(),
    code: text().notNull(),
    seats: integer().notNull().default(4),
    position: integer().notNull().default(0),
    status: text().notNull().default('active'),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    unique('dining_tables_merchant_id_id_key').on(t.merchantId, t.id),
    unique('dining_tables_code_key').on(t.merchantId, t.branchId, t.code),
    foreignKey({
      columns: [t.merchantId, t.areaId],
      foreignColumns: [diningAreas.merchantId, diningAreas.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    check('dining_tables_seats_valid', sql`${t.seats} between 1 and 100`),
    check('dining_tables_status_valid', sql`${t.status} in ('active', 'inactive')`),
  ],
);

/** Preparation station (kitchen, bar, …) at a branch; items are routed by category. */
export const kitchenStations = pgTable(
  'kitchen_stations',
  {
    id: id(),
    merchantId: merchantId(),
    branchId: uuid().notNull(),
    nameEn: text(),
    nameAr: text(),
    /** Receives items whose category is not routed to another station. */
    isDefault: boolean().notNull().default(false),
    status: text().notNull().default('active'),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    unique('kitchen_stations_merchant_id_id_key').on(t.merchantId, t.id),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    check('kitchen_stations_name_present', sql`coalesce(${t.nameEn}, ${t.nameAr}) is not null`),
    check('kitchen_stations_status_valid', sql`${t.status} in ('active', 'inactive')`),
  ],
);

export const kitchenStationCategories = pgTable(
  'kitchen_station_categories',
  {
    merchantId: merchantId(),
    stationId: uuid().notNull(),
    branchId: uuid().notNull(),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id),
  },
  (t) => [
    primaryKey({ columns: [t.stationId, t.categoryId] }),
    // A category goes to one station per branch.
    unique('kitchen_station_categories_branch_key').on(t.merchantId, t.branchId, t.categoryId),
    foreignKey({
      columns: [t.merchantId, t.stationId],
      foreignColumns: [kitchenStations.merchantId, kitchenStations.id],
    }),
  ],
);

/** Choice list attached to menu items (e.g. "Size", "Add-ons"). Merchant-wide. */
export const modifierGroups = pgTable(
  'modifier_groups',
  {
    id: id(),
    merchantId: merchantId(),
    nameEn: text(),
    nameAr: text(),
    /** 0 = optional; ≥ 1 = required. */
    minSelect: integer().notNull().default(0),
    maxSelect: integer().notNull().default(1),
    status: text().notNull().default('active'),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    unique('modifier_groups_merchant_id_id_key').on(t.merchantId, t.id),
    check('modifier_groups_name_present', sql`coalesce(${t.nameEn}, ${t.nameAr}) is not null`),
    check(
      'modifier_groups_select_valid',
      sql`${t.minSelect} >= 0 and ${t.maxSelect} >= 1 and ${t.minSelect} <= ${t.maxSelect} and ${t.maxSelect} <= 50`,
    ),
    check('modifier_groups_status_valid', sql`${t.status} in ('active', 'inactive')`),
  ],
);

export const modifiers = pgTable(
  'modifiers',
  {
    id: id(),
    merchantId: merchantId(),
    groupId: uuid().notNull(),
    nameEn: text(),
    nameAr: text(),
    /** Added to the item's unit price (fils, ≥ 0). */
    priceMinor: minor()
      .notNull()
      .default(sql`0`),
    position: integer().notNull().default(0),
    status: text().notNull().default('active'),
    /** Optional ingredient consumed per unit of the item (e.g. extra cheese). */
    componentVariantId: uuid().references(() => productVariants.id),
    componentQuantity: quantity(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('modifiers_merchant_id_id_key').on(t.merchantId, t.id),
    foreignKey({
      columns: [t.merchantId, t.groupId],
      foreignColumns: [modifierGroups.merchantId, modifierGroups.id],
    }),
    check('modifiers_name_present', sql`coalesce(${t.nameEn}, ${t.nameAr}) is not null`),
    check('modifiers_price_valid', sql`${t.priceMinor} >= 0`),
    check('modifiers_status_valid', sql`${t.status} in ('active', 'inactive')`),
    check(
      'modifiers_component_valid',
      sql`(${t.componentVariantId} is null and ${t.componentQuantity} is null)
          or (${t.componentVariantId} is not null and ${t.componentQuantity} > 0)`,
    ),
  ],
);

export const productModifierGroups = pgTable(
  'product_modifier_groups',
  {
    merchantId: merchantId(),
    productId: uuid()
      .notNull()
      .references(() => products.id),
    groupId: uuid().notNull(),
    position: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.groupId] }),
    foreignKey({
      columns: [t.merchantId, t.groupId],
      foreignColumns: [modifierGroups.merchantId, modifierGroups.id],
    }),
  ],
);

/**
 * Recipe: ingredients consumed per unit of a menu item (ADR-0074). Only for items that are
 * not stock-tracked themselves, so stock is never deducted twice.
 */
export const recipeComponents = pgTable(
  'recipe_components',
  {
    merchantId: merchantId(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id),
    componentVariantId: uuid()
      .notNull()
      .references(() => productVariants.id),
    quantity: quantity().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.variantId, t.componentVariantId] }),
    check('recipe_components_quantity_positive', sql`${t.quantity} > 0`),
    check('recipe_components_not_self', sql`${t.variantId} <> ${t.componentVariantId}`),
  ],
);

/**
 * A restaurant order (table, takeaway or pickup) — the mutable intent document. Money is
 * only recorded by the sales created when it is paid (one per bill).
 */
export const restaurantOrders = pgTable(
  'restaurant_orders',
  {
    id: id(),
    merchantId: merchantId(),
    branchId: uuid().notNull(),
    number: text().notNull(),
    orderType: text().notNull(),
    tableId: uuid(),
    guests: integer(),
    /** Name for takeaway/pickup calls. */
    label: text(),
    note: text(),
    status: text().notNull().default('open'),
    mergedIntoId: uuid(),
    openedByUserId: uuid()
      .notNull()
      .references(() => users.id),
    openedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp({ withTimezone: true }),
    version: integer().notNull().default(1),
  },
  (t) => [
    unique('restaurant_orders_merchant_id_id_key').on(t.merchantId, t.id),
    unique('restaurant_orders_number_key').on(t.merchantId, t.number),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.tableId],
      foreignColumns: [diningTables.merchantId, diningTables.id],
    }),
    check('restaurant_orders_type_valid', sql`${t.orderType} in ('dine_in', 'takeaway', 'pickup')`),
    check(
      'restaurant_orders_status_valid',
      sql`${t.status} in ('open', 'closed', 'cancelled', 'merged')`,
    ),
    check(
      'restaurant_orders_table_valid',
      sql`${t.orderType} <> 'dine_in' or ${t.tableId} is not null`,
    ),
    index('restaurant_orders_branch_status_idx').on(t.merchantId, t.branchId, t.status),
  ],
);

/**
 * Ordered item. `kitchenStatus`: pending (not sent) → queued → preparing → ready → served;
 * cancelled items keep their row (with reason and whether it was wasted).
 */
export const restaurantOrderItems = pgTable(
  'restaurant_order_items',
  {
    id: id(),
    merchantId: merchantId(),
    orderId: uuid().notNull(),
    position: integer().notNull(),
    variantId: uuid()
      .notNull()
      .references(() => productVariants.id),
    quantity: quantity().notNull(),
    note: text(),
    kitchenStatus: text().notNull().default('pending'),
    stationId: uuid(),
    ticketId: uuid(),
    /** The bill (sale) that paid for this item. */
    saleId: uuid(),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelReason: text(),
    wasted: boolean(),
    cancelledByUserId: uuid().references(() => users.id),
    addedByUserId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    version: integer().notNull().default(1),
  },
  (t) => [
    unique('restaurant_order_items_merchant_id_id_key').on(t.merchantId, t.id),
    foreignKey({
      columns: [t.merchantId, t.orderId],
      foreignColumns: [restaurantOrders.merchantId, restaurantOrders.id],
    }),
    check('restaurant_order_items_quantity_positive', sql`${t.quantity} > 0`),
    check(
      'restaurant_order_items_status_valid',
      sql`${t.kitchenStatus} in ('pending', 'queued', 'preparing', 'ready', 'served', 'cancelled')`,
    ),
    check(
      'restaurant_order_items_paid_or_cancelled',
      sql`not (${t.saleId} is not null and ${t.kitchenStatus} = 'cancelled')`,
    ),
    index('restaurant_order_items_order_idx').on(t.merchantId, t.orderId),
    index('restaurant_order_items_ticket_idx').on(t.merchantId, t.ticketId),
  ],
);

export const restaurantOrderItemModifiers = pgTable(
  'restaurant_order_item_modifiers',
  {
    merchantId: merchantId(),
    itemId: uuid().notNull(),
    modifierId: uuid().notNull(),
    nameEn: text(),
    nameAr: text(),
    priceMinor: minor().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.modifierId] }),
    foreignKey({
      columns: [t.merchantId, t.itemId],
      foreignColumns: [restaurantOrderItems.merchantId, restaurantOrderItems.id],
    }),
  ],
);

/** What a station has to prepare for one "send" of an order. */
export const kitchenTickets = pgTable(
  'kitchen_tickets',
  {
    id: id(),
    merchantId: merchantId(),
    branchId: uuid().notNull(),
    orderId: uuid().notNull(),
    stationId: uuid().notNull(),
    status: text().notNull().default('new'),
    createdAt: createdAt(),
    startedAt: timestamp({ withTimezone: true }),
    readyAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    version: integer().notNull().default(1),
  },
  (t) => [
    unique('kitchen_tickets_merchant_id_id_key').on(t.merchantId, t.id),
    foreignKey({
      columns: [t.merchantId, t.orderId],
      foreignColumns: [restaurantOrders.merchantId, restaurantOrders.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.stationId],
      foreignColumns: [kitchenStations.merchantId, kitchenStations.id],
    }),
    check(
      'kitchen_tickets_status_valid',
      sql`${t.status} in ('new', 'preparing', 'ready', 'completed', 'cancelled')`,
    ),
    index('kitchen_tickets_station_status_idx').on(t.merchantId, t.stationId, t.status),
  ],
);
