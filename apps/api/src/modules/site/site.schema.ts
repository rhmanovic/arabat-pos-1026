import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from '../../database/schema/columns.js';

/**
 * The "Our apps" menu of the public site (ADR-0117). Global (no merchant), changed only by
 * platform operators; a hidden app stays stored, a deleted one is gone (it is a menu entry, not a
 * financial record). The public API lists active entries in `sort_order`.
 */
export const siteApps = pgTable(
  'site_apps',
  {
    id: id(),
    nameAr: text().notNull(),
    nameEn: text().notNull(),
    descriptionAr: text(),
    descriptionEn: text(),
    /** A path on this site (`/manager/`) or an absolute http(s) address (an app store page). */
    url: text().notNull(),
    icon: text().notNull().default('other'),
    openInNewTab: boolean().notNull().default(false),
    status: text().notNull().default('active'),
    sortOrder: integer().notNull().default(100),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('site_apps_status_valid', sql`${t.status} in ('active', 'hidden')`),
    check(
      'site_apps_icon_valid',
      sql`${t.icon} in ('dashboard', 'till', 'store', 'links', 'computer', 'phone', 'other')`,
    ),
    check(
      'site_apps_names_present',
      sql`length(trim(${t.nameAr})) between 1 and 60 and length(trim(${t.nameEn})) between 1 and 60`,
    ),
    check('site_apps_url_valid', sql`${t.url} ~ '^(/[^[:space:]]*|https?://[^[:space:]]+)$'`),
  ],
);
