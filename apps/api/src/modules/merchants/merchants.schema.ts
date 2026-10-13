import { sql } from 'drizzle-orm';
import {
  char,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId, updatedAt } from '../../database/schema/columns.js';
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
    /** Emergency freeze of the owner's access by the platform (BR-020, R5.2). */
    ownerFrozenAt: timestamp({ withTimezone: true }),
    ownerFrozenReason: text(),
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

/**
 * Ownership transfers (BR-020, R5.2): the owner names a member and the member confirms with an
 * e-mailed token; the platform may transfer directly with a recorded reason. One pending
 * transfer per merchant; the row only moves pending → accepted / cancelled / expired
 * (migration 0047).
 */
export const ownershipTransfers = pgTable(
  'ownership_transfers',
  {
    id: id(),
    merchantId: merchantId(),
    fromMembershipId: uuid().notNull(),
    toMembershipId: uuid().notNull(),
    /** owner | platform */
    initiatedBy: text().notNull(),
    tokenHash: text(),
    reason: text(),
    status: text().notNull().default('pending'),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('ownership_transfers_merchant_id_id_key').on(t.merchantId, t.id),
    index('ownership_transfers_merchant_idx').on(t.merchantId, t.status),
    check('ownership_transfers_initiated_valid', sql`${t.initiatedBy} in ('owner', 'platform')`),
    check(
      'ownership_transfers_status_valid',
      sql`${t.status} in ('pending', 'accepted', 'cancelled', 'expired')`,
    ),
  ],
);
