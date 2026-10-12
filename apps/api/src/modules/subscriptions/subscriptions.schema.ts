import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId, updatedAt } from '../../database/schema/columns.js';
import { merchants } from '../merchants/merchants.schema.js';
import { platformOperators } from '../platform-admin/platform.schema.js';

/**
 * Subscription plan (Prompt 17). Global (no merchant), managed only by platform operators.
 * Limits are optional: NULL means unlimited. Prices are informational until pricing and a
 * billing provider are confirmed (no automatic billing, BR-155).
 */
export const plans = pgTable(
  'plans',
  {
    id: id(),
    code: text().notNull(),
    nameEn: text().notNull(),
    nameAr: text().notNull(),
    descriptionEn: text(),
    descriptionAr: text(),
    status: text().notNull().default('active'),
    /** The plan new merchants start on (exactly one). */
    isDefault: boolean().notNull().default(false),
    /** Shown to merchants as an available plan. */
    isPublic: boolean().notNull().default(true),
    maxBranches: integer(),
    maxEmployees: integer(),
    maxProducts: integer(),
    maxRegisters: integer(),
    features: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    priceMinor: bigint({ mode: 'bigint' }),
    currency: char({ length: 3 }).notNull().default('KWD'),
    billingPeriod: text(),
    trialDays: integer().notNull().default(0),
    sortOrder: integer().notNull().default(0),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('plans_code_key').on(sql`lower(${t.code})`),
    uniqueIndex('plans_default_key')
      .on(t.isDefault)
      .where(sql`${t.isDefault}`),
    check('plans_status_valid', sql`${t.status} in ('active', 'archived')`),
    check('plans_default_active', sql`not ${t.isDefault} or ${t.status} = 'active'`),
    check(
      'plans_limits_valid',
      sql`coalesce(${t.maxBranches}, 1) >= 1 and coalesce(${t.maxEmployees}, 0) >= 0
          and coalesce(${t.maxProducts}, 0) >= 0 and coalesce(${t.maxRegisters}, 1) >= 1`,
    ),
    check('plans_features_valid', sql`${t.features} <@ array['restaurant', 'ecommerce']::text[]`),
    check('plans_price_valid', sql`${t.priceMinor} is null or ${t.priceMinor} >= 0`),
    check(
      'plans_period_valid',
      sql`${t.billingPeriod} is null or ${t.billingPeriod} in ('month', 'year')`,
    ),
    check('plans_trial_valid', sql`${t.trialDays} between 0 and 365`),
  ],
);

/** The merchant's current subscription (one per merchant). Changed only by operators. */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    planId: uuid()
      .notNull()
      .references(() => plans.id),
    status: text().notNull(),
    startsAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp({ withTimezone: true }),
    trialEndsAt: timestamp({ withTimezone: true }),
    notes: text(),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('subscriptions_merchant_key').on(t.merchantId),
    unique('subscriptions_merchant_id_id_key').on(t.merchantId, t.id),
    check(
      'subscriptions_status_valid',
      sql`${t.status} in ('trialing', 'active', 'past_due', 'cancelled', 'expired')`,
    ),
    check(
      'subscriptions_trial_valid',
      sql`${t.status} <> 'trialing' or ${t.trialEndsAt} is not null`,
    ),
    check('subscriptions_dates_valid', sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`),
  ],
);

/** Append-only history of subscription changes (who, what, why). */
export const subscriptionEvents = pgTable(
  'subscription_events',
  {
    id: id(),
    merchantId: merchantId(),
    subscriptionId: uuid().notNull(),
    kind: text().notNull(),
    fromPlanId: uuid().references(() => plans.id),
    toPlanId: uuid().references(() => plans.id),
    fromStatus: text(),
    toStatus: text(),
    operatorId: uuid().references(() => platformOperators.id),
    reason: text(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.merchantId, t.subscriptionId],
      foreignColumns: [subscriptions.merchantId, subscriptions.id],
    }),
    index('subscription_events_merchant_idx').on(t.merchantId, t.createdAt),
    check('subscription_events_kind_valid', sql`${t.kind} in ('created', 'changed')`),
  ],
);
