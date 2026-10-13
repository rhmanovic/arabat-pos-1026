import { sql } from 'drizzle-orm';
import { char, check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from '../../database/schema/columns.js';
import { currencies } from '../../database/schema/currencies.schema.js';

/** The tenant (ADR-0015). Row-Level Security: visible to its own context and to its members. */
export const merchants = pgTable(
  'merchants',
  {
    id: id(),
    displayNameEn: text(),
    displayNameAr: text(),
    legalName: text(),
    commercialRegistrationNo: text(),
    contactEmail: text(),
    contactPhone: text(),
    countryCode: char({ length: 2 }).notNull().default('KW'),
    defaultCurrency: char({ length: 3 })
      .notNull()
      .default('KWD')
      .references(() => currencies.code),
    defaultLanguage: text().notNull().default('ar'),
    /** The single cut-off zone of every list, statement and report (BR-184). */
    timezone: text().notNull().default('Asia/Kuwait'),
    /** Set when the zone is changed after registration (audited, BR-184). */
    timezoneChangedAt: timestamp({ withTimezone: true }),
    status: text().notNull().default('active'),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'merchants_name_present',
      sql`coalesce(${t.displayNameEn}, ${t.displayNameAr}) is not null`,
    ),
    check('merchants_status_valid', sql`${t.status} in ('active', 'suspended', 'closed')`),
    check('merchants_language_valid', sql`${t.defaultLanguage} in ('ar', 'en')`),
  ],
);
