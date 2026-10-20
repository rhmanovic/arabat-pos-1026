import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
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
    /** The register (cash drawer) a manager bound to this device, or null (amendment 4). */
    registerId: uuid(),
    /** The device's permanent code in its branch (`D1`, `D2`, …, never reused): its receipt series. */
    code: text().notNull(),
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
    /** Last move to another branch: a sync `since` before it gets a full snapshot. */
    branchChangedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique('pos_devices_merchant_id_id_key').on(t.merchantId, t.id),
    uniqueIndex('pos_devices_token_hash_key').on(t.tokenHash),
    /** A register is bound to at most one device. */
    uniqueIndex('pos_devices_register_key')
      .on(t.registerId)
      .where(sql`${t.registerId} is not null`),
    uniqueIndex('pos_devices_branch_code_key').on(t.merchantId, t.branchId, sql`lower(${t.code})`),
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
 * The last device number of a branch (`D1`, `D2`, …). It only grows, so a device code is never
 * reused and a device can never repeat another device's receipt numbers (ADR-0112 gap C,
 * amendment 4).
 */
export const deviceCodeSequences = pgTable(
  // Table name kept from the register era (migration 0052); it now numbers devices.
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

/**
 * Every record a device uploaded (ADR-0112 §6, §7b): the device's own id (UUIDv7) is the key, so
 * a record is ingested exactly once. Accepted records point at what they created (`result`);
 * refused records keep their payload and reason for the managers instead of being lost, and are
 * tried again when the device sends them again unchanged.
 */
export const deviceRecords = pgTable(
  'device_records',
  {
    id: uuid().primaryKey(),
    merchantId: merchantId(),
    deviceId: uuid().notNull(),
    branchId: uuid().notNull(),
    /** shift_open | sale | cash_movement | refund | shift_close | sign_in */
    kind: text().notNull(),
    /** accepted | refused */
    status: text().notNull(),
    requestHash: text().notNull(),
    payload: jsonb().notNull(),
    result: jsonb(),
    errorCode: text(),
    errorMessage: text(),
    /** The device's clock when the record happened; business dates use it (gap B). */
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    /** The server's clock at the (latest) upload. */
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    clockSkew: boolean().notNull().default(false),
    attempts: integer().notNull().default(1),
  },
  (t) => [
    unique('device_records_merchant_id_id_key').on(t.merchantId, t.id),
    foreignKey({
      columns: [t.merchantId, t.deviceId],
      foreignColumns: [posDevices.merchantId, posDevices.id],
    }),
    check(
      'device_records_kind_valid',
      sql`${t.kind} in ('shift_open', 'sale', 'cash_movement', 'refund', 'shift_close', 'sign_in')`,
    ),
    check('device_records_status_valid', sql`${t.status} in ('accepted', 'refused')`),
    index('device_records_refused_idx')
      .on(t.merchantId, t.receivedAt)
      .where(sql`${t.status} = 'refused'`),
  ],
);

/**
 * What managers must look at after device uploads (ADR-0112 §5, gap B): a device sale that drove
 * stock below zero, a record whose device clock looks wrong, a record the server refused.
 */
export const deviceExceptions = pgTable(
  'device_exceptions',
  {
    id: id(),
    merchantId: merchantId(),
    branchId: uuid().notNull(),
    deviceId: uuid().notNull(),
    recordId: uuid().notNull(),
    /** negative_stock | clock_skew | refused | shift_left_open | late | forced_close */
    kind: text().notNull(),
    details: jsonb().notNull().default({}),
    createdAt: createdAt(),
    resolvedAt: timestamp({ withTimezone: true }),
    resolvedByUserId: uuid().references(() => users.id),
    resolutionNote: text(),
  },
  (t) => [
    foreignKey({
      columns: [t.merchantId, t.deviceId],
      foreignColumns: [posDevices.merchantId, posDevices.id],
    }),
    check(
      'device_exceptions_kind_valid',
      sql`${t.kind} in ('negative_stock', 'clock_skew', 'refused', 'shift_left_open', 'late', 'forced_close')`,
    ),
    check(
      'device_exceptions_resolved_consistent',
      sql`(${t.resolvedAt} is null) = (${t.resolvedByUserId} is null) or ${t.kind} = 'refused'`,
    ),
    index('device_exceptions_open_idx')
      .on(t.merchantId, t.createdAt)
      .where(sql`${t.resolvedAt} is null`),
    uniqueIndex('device_exceptions_refused_key')
      .on(t.merchantId, t.recordId)
      .where(sql`${t.kind} = 'refused'`),
  ],
);

/**
 * Links for cashiers to choose their own device PIN (ADR-0112, owner decision 6): asked from a
 * registered till, sent to the member's e-mail, used once within the hour. Global like
 * `password_reset_tokens` (the link carries no company); only the SHA-256 of the token is kept.
 */
export const pinResetTokens = pgTable(
  'pin_reset_tokens',
  {
    id: id(),
    merchantId: uuid()
      .notNull()
      .references(() => merchants.id),
    membershipId: uuid().notNull(),
    deviceId: uuid().notNull(),
    tokenHash: bytea().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('pin_reset_tokens_membership_idx').on(t.membershipId)],
);
