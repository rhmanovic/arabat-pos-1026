import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId, updatedAt } from '../../database/schema/columns.js';
import { branches } from '../branches/branches.schema.js';
import { users } from '../iam/iam.schema.js';
import { merchants } from '../merchants/merchants.schema.js';

/**
 * Customer profile (Prompt 13). Merchant-wide (shared by all branches); never deleted,
 * only deactivated. Financial history lives on sales/refunds via `sales.customer_id`.
 * Loyalty, credit and promotions will hang off this table in their own append-only
 * ledgers when their rules are confirmed (DATABASE.md §6.2).
 */
export const customers = pgTable(
  'customers',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    /** C-000001, gap-free per merchant (document_sequences). */
    code: text().notNull(),
    fullName: text().notNull(),
    /** Canonical "+<digits>" form (normalizePhone), unique per merchant. */
    phone: text(),
    email: text(),
    address: text(),
    preferredLanguage: text(),
    status: text().notNull().default('active'),
    createdByUserId: uuid()
      .notNull()
      .references(() => users.id),
    createdBranchId: uuid(),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('customers_merchant_id_id_key').on(t.merchantId, t.id),
    unique('customers_code_key').on(t.merchantId, t.code),
    uniqueIndex('customers_phone_key')
      .on(t.merchantId, t.phone)
      .where(sql`${t.phone} is not null`),
    index('customers_email_idx').on(t.merchantId, sql`lower(${t.email})`),
    foreignKey({
      columns: [t.merchantId, t.createdBranchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    check('customers_status_valid', sql`${t.status} in ('active', 'inactive')`),
    check('customers_language_valid', sql`${t.preferredLanguage} in ('ar', 'en')`),
    check('customers_name_present', sql`length(trim(${t.fullName})) > 0`),
  ],
);

/** Append-only notes about a customer (who wrote what, when). */
export const customerNotes = pgTable(
  'customer_notes',
  {
    id: id(),
    merchantId: merchantId(),
    customerId: uuid().notNull(),
    body: text().notNull(),
    createdByUserId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.merchantId, t.customerId],
      foreignColumns: [customers.merchantId, customers.id],
    }),
    index('customer_notes_customer_idx').on(t.merchantId, t.customerId, t.createdAt),
  ],
);
