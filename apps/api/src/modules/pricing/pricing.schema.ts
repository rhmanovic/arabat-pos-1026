import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from '../../database/schema/columns.js';
import { platformOperators } from '../platform-admin/platform.schema.js';

/**
 * What the public pricing page sells (ADR-0114). Global (no merchant), changed only by platform
 * operators. Exactly one `system` item (the yearly subscription, per company); `device` items
 * are hardware sold once. Hidden items stay for the requests that name them.
 */
export const offerItems = pgTable(
  'offer_items',
  {
    id: id(),
    kind: text().notNull(),
    nameAr: text().notNull(),
    nameEn: text().notNull(),
    descriptionAr: text(),
    descriptionEn: text(),
    /** fils; the system price is per year, a device price is paid once. */
    priceMinor: bigint({ mode: 'bigint' }).notNull(),
    /** Picture shown when no image is uploaded. */
    icon: text().notNull().default('other'),
    imageKey: text(),
    imageContentType: text(),
    maxQuantity: integer().notNull().default(10),
    /** Units the operator can lend for free trials (ADR-0115); availability subtracts those out. */
    trialStock: integer().notNull().default(0),
    status: text().notNull().default('active'),
    sortOrder: integer().notNull().default(100),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('offer_items_one_system')
      .on(t.kind)
      .where(sql`${t.kind} = 'system'`),
    check('offer_items_kind_valid', sql`${t.kind} in ('system', 'device')`),
    check('offer_items_status_valid', sql`${t.status} in ('active', 'hidden')`),
    check('offer_items_system_active', sql`${t.kind} <> 'system' or ${t.status} = 'active'`),
    check('offer_items_price_valid', sql`${t.priceMinor} >= 0`),
    check('offer_items_quantity_valid', sql`${t.maxQuantity} between 1 and 100`),
    check('offer_items_trial_stock_valid', sql`${t.trialStock} >= 0`),
    check(
      'offer_items_icon_valid',
      sql`${t.icon} in ('system', 'tablet', 'ipad', 'scanner', 'printer', 'drawer', 'other')`,
    ),
    check(
      'offer_items_names_present',
      sql`length(trim(${t.nameAr})) between 1 and 80 and length(trim(${t.nameEn})) between 1 and 80`,
    ),
    check('offer_items_image_pair', sql`(${t.imageKey} is null) = (${t.imageContentType} is null)`),
  ],
);

/**
 * A purchase request sent from the pricing page. Prices are copied from the items at the time of
 * the request; no money is taken online (BR-155). Only its follow-up status changes.
 */
export const salesRequests = pgTable(
  'sales_requests',
  {
    id: id(),
    number: integer().notNull().generatedAlwaysAsIdentity(),
    companyName: text().notNull(),
    contactName: text().notNull(),
    phone: text().notNull(),
    email: text().notNull(),
    notes: text(),
    language: text().notNull(),
    /** fils: the yearly system price, the devices paid once, and their sum (first payment). */
    systemMinor: bigint({ mode: 'bigint' }).notNull(),
    devicesMinor: bigint({ mode: 'bigint' }).notNull(),
    totalMinor: bigint({ mode: 'bigint' }).notNull(),
    status: text().notNull().default('new'),
    operatorNote: text(),
    handledByOperatorId: uuid().references(() => platformOperators.id),
    ip: text(),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('sales_requests_number_key').on(t.number),
    index('sales_requests_status_idx').on(t.status, t.createdAt),
    check('sales_requests_status_valid', sql`${t.status} in ('new', 'contacted', 'won', 'lost')`),
    check('sales_requests_language_valid', sql`${t.language} in ('ar', 'en')`),
    check(
      'sales_requests_totals_valid',
      sql`${t.systemMinor} >= 0 and ${t.devicesMinor} >= 0 and ${t.totalMinor} = ${t.systemMinor} + ${t.devicesMinor}`,
    ),
  ],
);

export const salesRequestLines = pgTable(
  'sales_request_lines',
  {
    id: id(),
    requestId: uuid()
      .notNull()
      .references(() => salesRequests.id),
    itemId: uuid()
      .notNull()
      .references(() => offerItems.id),
    kind: text().notNull(),
    nameAr: text().notNull(),
    nameEn: text().notNull(),
    unitPriceMinor: bigint({ mode: 'bigint' }).notNull(),
    quantity: integer().notNull(),
    lineTotalMinor: bigint({ mode: 'bigint' }).notNull(),
  },
  (t) => [
    index('sales_request_lines_request_idx').on(t.requestId),
    check('sales_request_lines_kind_valid', sql`${t.kind} in ('system', 'device')`),
    check(
      'sales_request_lines_amounts_valid',
      sql`${t.quantity} between 1 and 100 and ${t.unitPriceMinor} >= 0 and ${t.lineTotalMinor} = ${t.unitPriceMinor} * ${t.quantity}`,
    ),
  ],
);
