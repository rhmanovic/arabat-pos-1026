import { sql } from 'drizzle-orm';
import { bigint, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import type { Transaction } from '../database.service.js';

/** Gap-free document numbers per merchant and document kind (PO-000001, TR-000001, …). */
export const documentSequences = pgTable(
  'document_sequences',
  {
    merchantId: uuid().notNull(),
    kind: text().notNull(),
    lastNumber: bigint({ mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.merchantId, t.kind] })],
);

/** Next number inside the caller's transaction (rolled back with it). */
export async function nextDocumentNumber(
  tx: Transaction,
  merchantId: string,
  kind: string,
  prefix: string,
): Promise<string> {
  const [row] = (
    await tx.execute(sql`
      insert into document_sequences (merchant_id, kind, last_number) values (${merchantId}, ${kind}, 1)
      on conflict (merchant_id, kind) do update set last_number = document_sequences.last_number + 1
      returning last_number`)
  ).rows as { last_number: string }[];
  return `${prefix}-${String(row!.last_number).padStart(6, '0')}`;
}
