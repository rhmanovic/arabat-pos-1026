import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId } from '../../database/schema/columns.js';
import { branches } from '../branches/branches.schema.js';
import { users } from '../iam/iam.schema.js';
import { merchants } from '../merchants/merchants.schema.js';
import { registers } from '../registers/registers.schema.js';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/**
 * A registered local-first device (ADR-0112): the native Arabat app on a till. Registration
 * creates its own register (never shared, never reused); the device signs in with a bearer
 * token whose SHA-256 is stored. Revocation is final: a device registers again as a new device.
 */
export const posDevices = pgTable(
  'pos_devices',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    branchId: uuid().notNull(),
    registerId: uuid().notNull(),
    name: text().notNull(),
    tokenHash: bytea().notNull(),
    registeredByUserId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    lastSeenAt: timestamp({ withTimezone: true }),
    lastSyncAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    revokedByUserId: uuid().references(() => users.id),
  },
  (t) => [
    unique('pos_devices_merchant_id_id_key').on(t.merchantId, t.id),
    uniqueIndex('pos_devices_token_hash_key').on(t.tokenHash),
    uniqueIndex('pos_devices_register_key').on(t.registerId),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.registerId, t.branchId],
      foreignColumns: [registers.merchantId, registers.id, registers.branchId],
    }),
    check('pos_devices_name_present', sql`length(trim(${t.name})) between 1 and 80`),
  ],
);

/**
 * The last device register number of a branch (`R1`, `R2`, …). It only grows, so a register code
 * is never reused and a device can never repeat another device's receipt numbers (ADR-0112 gap C).
 */
export const registerCodeSequences = pgTable(
  'register_code_sequences',
  {
    merchantId: merchantId(),
    branchId: uuid().notNull(),
    lastNumber: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.merchantId, t.branchId] }),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    check('register_code_sequences_positive', sql`${t.lastNumber} > 0`),
  ],
);
