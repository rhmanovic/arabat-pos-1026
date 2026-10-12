import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
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
import { createdAt, id, merchantId, updatedAt } from '../../database/schema/columns.js';
import { branches } from '../branches/branches.schema.js';
import { memberships, users } from '../iam/iam.schema.js';

/** Cash registers (tills) of a branch (Prompt 9). */
export const registers = pgTable(
  'registers',
  {
    id: id(),
    merchantId: merchantId(),
    branchId: uuid().notNull(),
    code: text().notNull(),
    nameEn: text(),
    nameAr: text(),
    status: text().notNull().default('active'),
    /** branch: anyone allowed to operate shifts at the branch; restricted: listed members only. */
    accessMode: text().notNull().default('branch'),
    defaultOpeningFloatMinor: bigint({ mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    /** Discrepancies within ± this amount are reported as balanced. */
    discrepancyToleranceMinor: bigint({ mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    /**
     * The drawer has no verified count yet (new register, cutover) or its last shift was
     * force-closed without counting: the next opening must count it (ADR-0090).
     */
    needsCount: boolean().notNull().default(true),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('registers_merchant_id_id_key').on(t.merchantId, t.id),
    unique('registers_merchant_id_id_branch_key').on(t.merchantId, t.id, t.branchId),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    uniqueIndex('registers_branch_code_key').on(t.merchantId, t.branchId, sql`lower(${t.code})`),
    check('registers_name_present', sql`coalesce(${t.nameEn}, ${t.nameAr}) is not null`),
    check('registers_status_valid', sql`${t.status} in ('active', 'inactive')`),
    check('registers_access_mode_valid', sql`${t.accessMode} in ('branch', 'restricted')`),
    check(
      'registers_amounts_valid',
      sql`${t.defaultOpeningFloatMinor} >= 0 and ${t.discrepancyToleranceMinor} >= 0`,
    ),
  ],
);

/** Employees allowed to use a restricted register. */
export const registerMembers = pgTable(
  'register_members',
  {
    merchantId: merchantId(),
    registerId: uuid().notNull(),
    membershipId: uuid().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.registerId, t.membershipId] }),
    foreignKey({
      columns: [t.merchantId, t.registerId],
      foreignColumns: [registers.merchantId, registers.id],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.merchantId, t.membershipId],
      foreignColumns: [memberships.merchantId, memberships.id],
    }),
  ],
);

/**
 * A cashier shift on one register (BR-027, BR-073): one open shift per register and per
 * employee. Closing records the expected and counted cash and the discrepancy; a closed
 * shift is never reopened or edited.
 */
export const shifts = pgTable(
  'shifts',
  {
    id: id(),
    merchantId: merchantId(),
    branchId: uuid().notNull(),
    registerId: uuid().notNull(),
    membershipId: uuid().notNull(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    status: text().notNull().default('open'),
    /** Cash counted in the drawer at opening (before ADR-0090: the float put in). */
    openingFloatMinor: bigint({ mode: 'bigint' }).notNull(),
    /** Drawer balance the system expected at opening (null before ADR-0090). */
    openingExpectedMinor: bigint({ mode: 'bigint' }),
    /** counted − expected at opening; null for the drawer's first count. */
    openingDiscrepancyMinor: bigint({ mode: 'bigint' }),
    /** The opening was the drawer's first verified count, not a discrepancy. */
    openingIsInitial: boolean().notNull().default(false),
    /** The opening difference belongs to this earlier shift, force-closed without a count. */
    openingFollowsShiftId: uuid(),
    openingBreakdown: jsonb(),
    /** Opened before ADR-0090: closes with the old record-based expected cash. */
    legacyOpen: boolean().notNull().default(false),
    openingNote: text(),
    openedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp({ withTimezone: true }),
    closedByUserId: uuid().references(() => users.id),
    /** normal (by the cashier) | forced (manager, counted) | forced_uncounted (manager, no count) */
    closeType: text(),
    expectedCashMinor: bigint({ mode: 'bigint' }),
    countedCashMinor: bigint({ mode: 'bigint' }),
    /** Register tolerance at closing time, so later changes never rewrite history. */
    discrepancyToleranceMinor: bigint({ mode: 'bigint' }),
    /** counted − expected: positive = over, negative = short. */
    discrepancyMinor: bigint({ mode: 'bigint' }),
    /** Optional denomination count: [{ value: "20.000", count: 3 }]. */
    countedBreakdown: jsonb(),
    closingNote: text(),
    version: integer().notNull().default(1),
  },
  (t) => [
    unique('shifts_merchant_id_id_key').on(t.merchantId, t.id),
    foreignKey({
      columns: [t.merchantId, t.registerId],
      foreignColumns: [registers.merchantId, registers.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.membershipId],
      foreignColumns: [memberships.merchantId, memberships.id],
    }),
    uniqueIndex('shifts_one_open_per_register')
      .on(t.registerId)
      .where(sql`${t.status} = 'open'`),
    uniqueIndex('shifts_one_open_per_member')
      .on(t.membershipId)
      .where(sql`${t.status} = 'open'`),
    check('shifts_status_valid', sql`${t.status} in ('open', 'closed')`),
    check('shifts_opening_float_valid', sql`${t.openingFloatMinor} >= 0`),
    check(
      'shifts_closed_complete',
      sql`(${t.status} = 'open' and ${t.closedAt} is null) or (${t.status} = 'closed' and ${t.closedAt} is not null
           and ${t.expectedCashMinor} is not null and ${t.countedCashMinor} is not null
           and ${t.discrepancyMinor} = ${t.countedCashMinor} - ${t.expectedCashMinor}
           and ${t.closeType} in ('normal', 'forced'))
          or (${t.status} = 'closed' and ${t.closedAt} is not null and ${t.closeType} = 'forced_uncounted'
           and ${t.countedCashMinor} is null and ${t.discrepancyMinor} is null)`,
    ),
    check(
      'shifts_opening_discrepancy_valid',
      sql`${t.openingDiscrepancyMinor} is null
          or ${t.openingDiscrepancyMinor} = ${t.openingFloatMinor} - ${t.openingExpectedMinor}`,
    ),
    index('shifts_branch_opened_idx').on(t.merchantId, t.branchId, t.openedAt),
    index('shifts_branch_closed_idx').on(t.merchantId, t.branchId, t.closedAt),
  ],
);

/** Cash put into or taken out of the drawer during a shift (append-only). */
export const cashMovements = pgTable(
  'cash_movements',
  {
    id: id(),
    merchantId: merchantId(),
    shiftId: uuid().notNull(),
    branchId: uuid().notNull(),
    registerId: uuid().notNull(),
    /** cash_in | cash_out */
    kind: text().notNull(),
    amountMinor: bigint({ mode: 'bigint' }).notNull(),
    reason: text().notNull(),
    note: text(),
    idempotencyKey: uuid(),
    createdByUserId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.merchantId, t.shiftId],
      foreignColumns: [shifts.merchantId, shifts.id],
    }),
    unique('cash_movements_idempotency_key').on(t.merchantId, t.idempotencyKey),
    check('cash_movements_kind_valid', sql`${t.kind} in ('cash_in', 'cash_out')`),
    check(
      'cash_movements_amount_positive',
      sql`${t.amountMinor} > 0 and ${t.amountMinor} <= 1000000000`,
    ),
    index('cash_movements_shift_idx').on(t.merchantId, t.shiftId, t.createdAt),
    index('cash_movements_branch_time_idx').on(t.merchantId, t.branchId, t.createdAt),
  ],
);
