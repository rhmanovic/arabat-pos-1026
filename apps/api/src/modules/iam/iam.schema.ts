import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
import { createdAt, id, merchantId, updatedAt } from '../../database/schema/columns.js';
import { branches } from '../branches/branches.schema.js';
import { merchants } from '../merchants/merchants.schema.js';

/**
 * Global merchant-user identity (not merchant-owned). Email is stored lower-cased.
 * A user may belong to several merchants through memberships.
 */
export const users = pgTable(
  'users',
  {
    id: id(),
    email: text().notNull(),
    passwordHash: text().notNull(),
    fullName: text().notNull(),
    preferredLanguage: text(),
    status: text().notNull().default('active'),
    emailVerifiedAt: timestamp({ withTimezone: true }),
    passwordChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
    check('users_status_valid', sql`${t.status} in ('active', 'disabled')`),
    check(
      'users_language_valid',
      sql`${t.preferredLanguage} is null or ${t.preferredLanguage} in ('ar', 'en')`,
    ),
  ],
);

/** User ↔ merchant link. Exactly one owner membership per merchant (BR-002). */
export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    isOwner: boolean().notNull().default(false),
    status: text().notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('memberships_merchant_id_id_key').on(t.merchantId, t.id),
    unique('memberships_merchant_user_key').on(t.merchantId, t.userId),
    uniqueIndex('memberships_one_owner_per_merchant')
      .on(t.merchantId)
      .where(sql`${t.isOwner}`),
    check('memberships_status_valid', sql`${t.status} in ('invited', 'active', 'inactive')`),
    check('memberships_owner_active', sql`not ${t.isOwner} or ${t.status} = 'active'`),
  ],
);

/** Per-merchant role: a named set of permission keys (AUTH.md §3). */
export const roles = pgTable(
  'roles',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    nameEn: text(),
    nameAr: text(),
    templateKey: text(),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('roles_merchant_id_id_key').on(t.merchantId, t.id),
    uniqueIndex('roles_merchant_template_key')
      .on(t.merchantId, t.templateKey)
      .where(sql`${t.templateKey} is not null`),
    check('roles_name_present', sql`coalesce(${t.nameEn}, ${t.nameAr}) is not null`),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    merchantId: merchantId(),
    roleId: uuid().notNull(),
    permissionKey: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionKey] }),
    foreignKey({
      columns: [t.merchantId, t.roleId],
      foreignColumns: [roles.merchantId, roles.id],
    }).onDelete('cascade'),
  ],
);

/** Role granted to a membership at one branch, or at all branches when branch_id is NULL (ADR-0011). */
export const roleAssignments = pgTable(
  'role_assignments',
  {
    id: id(),
    merchantId: merchantId(),
    membershipId: uuid().notNull(),
    roleId: uuid().notNull(),
    branchId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('role_assignments_unique').on(t.membershipId, t.roleId, t.branchId).nullsNotDistinct(),
    foreignKey({
      columns: [t.merchantId, t.membershipId],
      foreignColumns: [memberships.merchantId, memberships.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.merchantId, t.roleId],
      foreignColumns: [roles.merchantId, roles.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
  ],
);
