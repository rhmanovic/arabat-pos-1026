import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId, updatedAt } from '../../database/schema/columns.js';
import { merchants } from '../merchants/merchants.schema.js';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/** Branches of a merchant (BR-004). Every merchant gets a main branch at registration. */
export const branches = pgTable(
  'branches',
  {
    id: id(),
    merchantId: merchantId().references(() => merchants.id),
    code: text().notNull(),
    nameEn: text(),
    nameAr: text(),
    isMain: boolean().notNull().default(false),
    phone: text(),
    address: text(),
    /** Printed at the top / bottom of receipts issued at this branch. */
    receiptHeader: text(),
    receiptFooter: text(),
    timezone: text().notNull().default('Asia/Kuwait'),
    /**
     * SHA-256 of the branch's PIN sign-in link key (Plan A): the browser POS lists the branch's
     * cashiers and signs them in with their PIN. Null: no link. Regenerating replaces it.
     */
    pinLinkKeyHash: bytea(),
    status: text().notNull().default('active'),
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('branches_merchant_id_id_key').on(t.merchantId, t.id),
    unique('branches_merchant_code_key').on(t.merchantId, t.code),
    uniqueIndex('branches_one_main_per_merchant')
      .on(t.merchantId)
      .where(sql`${t.isMain}`),
    check('branches_name_present', sql`coalesce(${t.nameEn}, ${t.nameAr}) is not null`),
    check('branches_status_valid', sql`${t.status} in ('active', 'inactive')`),
    uniqueIndex('branches_pin_link_key')
      .on(t.pinLinkKeyHash)
      .where(sql`${t.pinLinkKeyHash} is not null`),
  ],
);
