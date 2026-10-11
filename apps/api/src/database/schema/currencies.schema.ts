import { char, check, pgTable, smallint, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** ISO 4217 reference data (global, not merchant-owned). Exponent = minor-unit digits. */
export const currencies = pgTable(
  'currencies',
  {
    code: char({ length: 3 }).primaryKey(),
    exponent: smallint().notNull(),
    nameEn: text().notNull(),
    nameAr: text().notNull(),
  },
  (t) => [
    check('currencies_code_format', sql`${t.code} ~ '^[A-Z]{3}$'`),
    check('currencies_exponent_range', sql`${t.exponent} between 0 and 4`),
  ],
);
