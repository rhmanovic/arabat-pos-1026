import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { id } from '../../database/schema/columns.js';

/**
 * Append-only audit trail (DATABASE.md §5). merchant_id is NULL for events without a merchant
 * context (e.g. failed sign-in, platform actions); such rows are invisible to merchants.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    merchantId: uuid(),
    actorType: text().notNull(),
    actorId: uuid(),
    action: text().notNull(),
    targetType: text(),
    targetId: uuid(),
    ip: text(),
    details: jsonb().notNull().default({}),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_merchant_time_idx').on(t.merchantId, t.occurredAt)],
);
