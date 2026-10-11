import { sql } from 'drizzle-orm';
import { bigint, check, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from '../../database/schema/columns.js';

/** SaaS operator staff — a separate identity realm from merchant users (ADR-0007). */
export const platformOperators = pgTable(
  'platform_operators',
  {
    id: id(),
    email: text().notNull(),
    passwordHash: text().notNull(),
    fullName: text().notNull(),
    platformRole: text().notNull(),
    status: text().notNull().default('active'),
    /** TOTP secret, AES-256-GCM encrypted with MFA_ENCRYPTION_KEY. */
    mfaSecretEnc: text().notNull(),
    /** Last accepted TOTP time step; codes at or before it are rejected (replay protection). */
    mfaLastStep: bigint({ mode: 'number' }).notNull().default(0),
    lastLoginAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('platform_operators_email_key').on(t.email),
    check('platform_operators_email_lowercase', sql`${t.email} = lower(${t.email})`),
    check('platform_operators_status_valid', sql`${t.status} in ('active', 'disabled')`),
    check(
      'platform_operators_role_valid',
      sql`${t.platformRole} in ('platform.super_admin', 'platform.support', 'platform.billing')`,
    ),
  ],
);
