import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from '../../database/schema/columns.js';
import { merchants } from '../merchants/merchants.schema.js';
import { offerItems } from '../pricing/pricing.schema.js';

/** The operator's trial settings (ADR-0115): a single row, changed only by operators. */
export const trialSettings = pgTable(
  'trial_settings',
  {
    id: smallint().primaryKey().default(1),
    trialDaysOwn: integer().notNull().default(14),
    trialDaysDevices: integer().notNull().default(7),
    waitlistEnabled: boolean().notNull().default(true),
    version: integer().notNull().default(1),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('trial_settings_single_row', sql`${t.id} = 1`),
    check(
      'trial_settings_days_valid',
      sql`${t.trialDaysOwn} between 1 and 365 and ${t.trialDaysDevices} between 1 and 365`,
    ),
  ],
);

/**
 * A prospect who left an e-mail in the funnel: on the demo receipt (`receipt`), on the account
 * form (`started`) or with a verified trial account (`trial`). Global (platform data).
 */
export const leads = pgTable(
  'leads',
  {
    id: id(),
    email: text().notNull(),
    fullName: text(),
    companyName: text(),
    businessType: text(),
    phone: text(),
    language: text().notNull().default('ar'),
    stage: text().notNull(),
    merchantId: uuid().references(() => merchants.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('leads_email_key').on(t.email),
    index('leads_stage_idx').on(t.stage, t.updatedAt),
    check('leads_email_lowercase', sql`${t.email} = lower(${t.email})`),
    check('leads_stage_valid', sql`${t.stage} in ('receipt', 'started', 'trial')`),
    check(
      'leads_business_valid',
      sql`${t.businessType} is null or ${t.businessType} in ('retail', 'restaurant', 'cafe', 'other')`,
    ),
    check('leads_language_valid', sql`${t.language} in ('ar', 'en')`),
  ],
);

/** A trial sign-up waiting for its e-mailed code; the account is created on verification. */
export const trialSignups = pgTable(
  'trial_signups',
  {
    id: id(),
    email: text().notNull(),
    fullName: text().notNull(),
    companyName: text(),
    passwordHash: text().notNull(),
    businessType: text().notNull(),
    language: text().notNull(),
    /** [{ itemId, quantity }] requested for the trial. */
    devices: jsonb().notNull().default([]),
    codeHash: text().notNull(),
    attempts: integer().notNull().default(0),
    sentCount: integer().notNull().default(1),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    verifiedAt: timestamp({ withTimezone: true }),
    merchantId: uuid().references(() => merchants.id),
    /** Anonymous funnel session, to count the verified step. */
    sessionId: uuid(),
    ip: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('trial_signups_email_idx').on(t.email),
    check('trial_signups_attempts_valid', sql`${t.attempts} between 0 and 10`),
  ],
);

/** Devices lent for a trial; their trial time starts on delivery. */
export const deviceTrialRequests = pgTable(
  'device_trial_requests',
  {
    id: id(),
    merchantId: uuid()
      .notNull()
      .references(() => merchants.id),
    leadId: uuid().references(() => leads.id),
    status: text().notNull(),
    note: text(),
    deliveredAt: timestamp({ withTimezone: true }),
    returnedAt: timestamp({ withTimezone: true }),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('device_trial_requests_status_idx').on(t.status, t.createdAt),
    check(
      'device_trial_requests_status_valid',
      sql`${t.status} in ('pending', 'waitlist', 'approved', 'delivered', 'returned', 'rejected')`,
    ),
  ],
);

export const deviceTrialRequestLines = pgTable(
  'device_trial_request_lines',
  {
    id: id(),
    requestId: uuid()
      .notNull()
      .references(() => deviceTrialRequests.id),
    itemId: uuid()
      .notNull()
      .references(() => offerItems.id),
    nameAr: text().notNull(),
    nameEn: text().notNull(),
    quantity: integer().notNull(),
  },
  (t) => [
    index('device_trial_request_lines_request_idx').on(t.requestId),
    index('device_trial_request_lines_item_idx').on(t.itemId),
    check('device_trial_request_lines_quantity_valid', sql`${t.quantity} between 1 and 20`),
  ],
);

/** Anonymous funnel progress: one row per browser session and step (no personal data). */
export const funnelEvents = pgTable(
  'funnel_events',
  {
    sessionId: uuid().notNull(),
    step: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.step] }),
    index('funnel_events_time_idx').on(t.createdAt),
    check(
      'funnel_events_step_valid',
      sql`${t.step} in ('business', 'demo', 'receipt', 'devices', 'account', 'verified')`,
    ),
  ],
);
