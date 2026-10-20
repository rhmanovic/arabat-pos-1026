import { sql } from 'drizzle-orm';
import {
  check,
  customType,
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
import { createdAt, id, merchantId } from '../../database/schema/columns.js';
import { posDevices } from '../devices/devices.schema.js';
import { branches } from '../branches/branches.schema.js';
import { users } from '../iam/iam.schema.js';
import { merchants } from '../merchants/merchants.schema.js';
import { sales } from '../sales/sales.schema.js';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/**
 * A print agent (ADR-0111): a program on a computer with the receipt printer attached. It signs
 * in with a bearer token (only its SHA-256 is stored), receives `print:job` over Socket.IO and
 * claims jobs through the agent API. Bound to one branch, or to every branch when null.
 */
export const printAgents = pgTable(
  'print_agents',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    branchId: uuid(),
    name: text().notNull(),
    tokenHash: bytea().notNull(),
    lastSeenAt: timestamp({ withTimezone: true }),
    createdByUserId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('print_agents_merchant_id_id_key').on(t.merchantId, t.id),
    uniqueIndex('print_agents_token_hash_key').on(t.tokenHash),
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    check('print_agents_name_present', sql`length(trim(${t.name})) between 1 and 80`),
  ],
);

/**
 * One receipt to print (ADR-0111): a self-contained 72 mm HTML document. Created when a sale
 * completes (setting `auto_print_receipts`) or on a manager's reprint. pending → printing (claim)
 * → printed | failed. `agent_id` is the agent that claimed it.
 */
export const printJobs = pgTable(
  'print_jobs',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    branchId: uuid(),
    agentId: uuid().references(() => printAgents.id, { onDelete: 'set null' }),
    /** The branch's primary device when it claimed the job instead of a print agent (Plan A). */
    deviceId: uuid(),
    saleId: uuid(),
    /** An online order document (packing slip) printed before any sale exists (ADR-0123). */
    onlineOrderId: uuid(),
    kind: text().notNull(),
    status: text().notNull().default('pending'),
    html: text().notNull(),
    attempts: integer().notNull().default(0),
    error: text(),
    createdByUserId: uuid().references(() => users.id),
    createdAt: createdAt(),
    claimedAt: timestamp({ withTimezone: true }),
    printedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.merchantId, t.branchId],
      foreignColumns: [branches.merchantId, branches.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.saleId],
      foreignColumns: [sales.merchantId, sales.id],
    }),
    foreignKey({
      columns: [t.merchantId, t.deviceId],
      foreignColumns: [posDevices.merchantId, posDevices.id],
    }),
    check('print_jobs_one_claimer', sql`${t.agentId} is null or ${t.deviceId} is null`),
    index('print_jobs_queue_idx').on(t.merchantId, t.status, t.createdAt),
    index('print_jobs_sale_idx').on(t.merchantId, t.saleId),
    index('print_jobs_online_order_idx').on(t.merchantId, t.onlineOrderId),
    check('print_jobs_kind_valid', sql`${t.kind} in ('auto', 'reprint', 'online_order')`),
    check(
      'print_jobs_status_valid',
      sql`${t.status} in ('pending', 'printing', 'printed', 'failed')`,
    ),
    check('print_jobs_attempts_valid', sql`${t.attempts} >= 0`),
  ],
);
