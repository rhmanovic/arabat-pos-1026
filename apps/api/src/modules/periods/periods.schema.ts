import { char, date, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId } from '../../database/schema/columns.js';
import { users } from '../iam/iam.schema.js';

/**
 * Closed accounting months (BR-189, remediation R4.2): one row per merchant and month, written
 * once with the month-end pack. RLS; never updated or deleted (migration 0046). The lock on
 * document dates is checked in the services that accept a date (purchase orders, receipts).
 */
export const periodCloses = pgTable(
  'period_closes',
  {
    id: id(),
    merchantId: merchantId(),
    /** 'YYYY-MM' in the merchant's time zone. */
    period: char({ length: 7 }).notNull(),
    fromDate: date().notNull(),
    toDate: date().notNull(),
    timezone: text().notNull(),
    closedByUserId: uuid()
      .notNull()
      .references(() => users.id),
    note: text(),
    /** The pack as computed at close time (`PeriodPack` without the status fields). */
    pack: jsonb().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('period_closes_merchant_id_id_key').on(t.merchantId, t.id),
    unique('period_closes_period_key').on(t.merchantId, t.period),
  ],
);
