import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId, updatedAt } from '../../database/schema/columns.js';
import { customers } from '../customers/customers.schema.js';
import { merchants } from '../merchants/merchants.schema.js';
import { onlineDeliveryAreas } from './ecommerce.schema.js';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/**
 * Shopper accounts of the online store (ADR-0124): a sign-in (e-mail + password) attached to
 * the merchant's customer record, so the till and the store share one customer. Optional:
 * a store still takes guest orders.
 */
export const customerAccounts = pgTable(
  'customer_accounts',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    customerId: uuid().notNull(),
    email: text().notNull(),
    passwordHash: text().notNull(),
    status: text().notNull().default('active'),
    lastLoginAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('customer_accounts_merchant_id_id_key').on(t.merchantId, t.id),
    unique('customer_accounts_customer_key').on(t.merchantId, t.customerId),
    uniqueIndex('customer_accounts_email_key').on(t.merchantId, sql`lower(${t.email})`),
    foreignKey({
      columns: [t.merchantId, t.customerId],
      foreignColumns: [customers.merchantId, customers.id],
    }),
    check('customer_accounts_status_valid', sql`${t.status} in ('active', 'disabled')`),
  ],
);

/** Bearer sessions of shopper accounts; the token is only ever stored hashed. */
export const customerSessions = pgTable(
  'customer_sessions',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    accountId: uuid().notNull(),
    tokenHash: bytea().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('customer_sessions_token_key').on(t.tokenHash),
    index('customer_sessions_account_idx').on(t.merchantId, t.accountId),
    foreignKey({
      columns: [t.merchantId, t.accountId],
      foreignColumns: [customerAccounts.merchantId, customerAccounts.id],
    }),
  ],
);

/** One-time password reset links (e-mailed), hashed, short-lived. */
export const customerPasswordResets = pgTable(
  'customer_password_resets',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    accountId: uuid().notNull(),
    tokenHash: bytea().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('customer_password_resets_token_key').on(t.tokenHash),
    foreignKey({
      columns: [t.merchantId, t.accountId],
      foreignColumns: [customerAccounts.merchantId, customerAccounts.id],
    }),
  ],
);

/** Saved delivery addresses of a customer (ADR-0124), with the delivery area when known. */
export const customerAddresses = pgTable(
  'customer_addresses',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    customerId: uuid().notNull(),
    label: text(),
    /** Single-column FK (a composite `set null` would null `merchant_id`). */
    deliveryAreaId: uuid().references(() => onlineDeliveryAreas.id, { onDelete: 'set null' }),
    address: text().notNull(),
    isDefault: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('customer_addresses_customer_idx').on(t.merchantId, t.customerId),
    foreignKey({
      columns: [t.merchantId, t.customerId],
      foreignColumns: [customers.merchantId, customers.id],
    }),
    check('customer_addresses_address_present', sql`length(trim(${t.address})) > 0`),
  ],
);
