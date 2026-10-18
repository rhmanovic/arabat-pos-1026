import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId, updatedAt } from '../../database/schema/columns.js';
import { merchants } from '../merchants/merchants.schema.js';

/** One link page ("link in bio") per merchant (ADR-0116). Public pages resolve it by `slug`. */
export const linkPages = pgTable(
  'link_pages',
  {
    merchantId: uuid()
      .primaryKey()
      .references(() => merchants.id),
    slug: text().notNull(),
    /** draft (never public) ↔ published. */
    status: text().notNull().default('draft'),
    titleAr: text(),
    titleEn: text(),
    bioAr: text(),
    bioEn: text(),
    /** Button colour as #rrggbb. */
    themeColor: text().notNull().default('#1e3a8a'),
    buttonStyle: text().notNull().default('rounded'),
    background: text().notNull().default('light'),
    avatarKey: text(),
    avatarContentType: text(),
    version: integer().notNull().default(1),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('link_pages_slug_key').on(sql`lower(${t.slug})`),
    check('link_pages_status_valid', sql`${t.status} in ('draft', 'published')`),
    check('link_pages_slug_valid', sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,40}$'`),
    check('link_pages_color_valid', sql`${t.themeColor} ~ '^#[0-9a-fA-F]{6}$'`),
    check('link_pages_button_valid', sql`${t.buttonStyle} in ('rounded', 'pill', 'square')`),
    check('link_pages_background_valid', sql`${t.background} in ('light', 'dark', 'brand')`),
    check(
      'link_pages_avatar_pair',
      sql`(${t.avatarKey} is null) = (${t.avatarContentType} is null)`,
    ),
  ],
);

/** The buttons of a link page, in `sort_order`. */
export const linkPageItems = pgTable(
  'link_page_items',
  {
    id: id(),
    merchantId: merchantId(),
    kind: text().notNull(),
    labelAr: text(),
    labelEn: text(),
    url: text().notNull(),
    status: text().notNull().default('active'),
    sortOrder: integer().notNull().default(0),
    /** Opens counted from the public page (BR-201). */
    clicks: bigint({ mode: 'number' }).notNull().default(0),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({ columns: [t.merchantId], foreignColumns: [linkPages.merchantId] }),
    index('link_page_items_merchant_idx').on(t.merchantId, t.sortOrder),
    check(
      'link_page_items_kind_valid',
      sql`${t.kind} in ('link', 'website', 'store', 'instagram', 'tiktok', 'snapchat', 'x', 'facebook', 'youtube', 'whatsapp', 'telegram', 'email', 'phone', 'location')`,
    ),
    check('link_page_items_status_valid', sql`${t.status} in ('active', 'hidden')`),
    check(
      'link_page_items_url_valid',
      sql`length(${t.url}) <= 2000 and ${t.url} ~* '^(https?://|mailto:|tel:)'`,
    ),
    check(
      'link_page_items_label_present',
      sql`coalesce(length(trim(${t.labelAr})), 0) + coalesce(length(trim(${t.labelEn})), 0) > 0`,
    ),
    check('link_page_items_clicks_valid', sql`${t.clicks} >= 0`),
  ],
);
