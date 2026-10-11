import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id } from '../../database/schema/columns.js';
import { users } from '../iam/iam.schema.js';
import { platformOperators } from '../platform-admin/platform.schema.js';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/**
 * Server-side sessions (ADR-0006). Only the SHA-256 hash of the token is stored.
 * A merchant session always carries an explicit merchant and membership context.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    tokenHash: bytea().notNull().unique(),
    realm: text().notNull(),
    interface: text().notNull(),
    userId: uuid().references(() => users.id),
    operatorId: uuid().references(() => platformOperators.id),
    merchantId: uuid(),
    membershipId: uuid(),
    branchId: uuid(),
    createdAt: createdAt(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    idleExpiresAt: timestamp({ withTimezone: true }).notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    revokeReason: text(),
    ip: text(),
    userAgent: text(),
  },
  (t) => [
    index('sessions_user_idx').on(t.userId),
    index('sessions_operator_idx').on(t.operatorId),
    check(
      'sessions_realm_shape',
      sql`(${t.realm} = 'merchant' and ${t.interface} in ('manager', 'pos') and ${t.userId} is not null
            and ${t.merchantId} is not null and ${t.membershipId} is not null and ${t.operatorId} is null)
       or (${t.realm} = 'platform' and ${t.interface} = 'platform' and ${t.operatorId} is not null
            and ${t.userId} is null and ${t.merchantId} is null)`,
    ),
    check('sessions_pos_branch', sql`${t.interface} <> 'pos' or ${t.branchId} is not null`),
  ],
);

/**
 * Short-lived, single-use tickets for multi-step sign-in: merchant/branch selection after a
 * correct password, and the TOTP step of platform sign-in.
 */
export const authTickets = pgTable(
  'auth_tickets',
  {
    id: id(),
    tokenHash: bytea().notNull().unique(),
    purpose: text().notNull(),
    interface: text().notNull(),
    userId: uuid().references(() => users.id),
    operatorId: uuid().references(() => platformOperators.id),
    attempts: integer().notNull().default(0),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    consumedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [check('auth_tickets_purpose_valid', sql`${t.purpose} in ('merchant_selection', 'mfa')`)],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: id(),
    tokenHash: bytea().notNull().unique(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    requestedIp: text(),
    createdAt: createdAt(),
  },
  (t) => [index('password_reset_tokens_user_idx').on(t.userId)],
);

/** Fixed-window counters for authentication rate limits, shared by all API instances. */
export const rateLimitBuckets = pgTable('rate_limit_buckets', {
  key: text().primaryKey(),
  windowStart: timestamp({ withTimezone: true }).notNull(),
  count: integer().notNull(),
});
