import type { BridgeDb, SqlStatement } from './bridge.js';

/**
 * The device's local schema (ADR-0112). Money is TEXT (fils as a decimal integer string),
 * booleans are INTEGER 0 / 1, times are ISO 8601 TEXT. Each entry is one migration; the applied
 * count is kept in `meta.schemaVersion`, so a new app bundle upgrades an older database in place.
 */
export const MIGRATIONS: readonly string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
    // A row can only hold 1: inserting 0 into it fails the transaction (optimistic checks).
    `CREATE TABLE IF NOT EXISTS guard (x INTEGER NOT NULL CHECK (x = 1))`,
    `CREATE TABLE IF NOT EXISTS payment_methods (id TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, json TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS staff (membership_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, full_name TEXT NOT NULL,
       is_owner INTEGER NOT NULL, pin_hash TEXT, permissions TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, parent_id TEXT, name_en TEXT, name_ar TEXT,
       sort_order INTEGER NOT NULL, status TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, category_id TEXT, name_en TEXT, name_ar TEXT, type TEXT NOT NULL,
       track_inventory INTEGER NOT NULL, sellable INTEGER NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS variants (id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
       name_en TEXT, name_ar TEXT, sku TEXT, price_minor TEXT NOT NULL, cost_minor TEXT, is_default INTEGER NOT NULL,
       status TEXT NOT NULL, position INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS variants_product_idx ON variants(product_id)`,
    `CREATE TABLE IF NOT EXISTS barcodes (barcode TEXT PRIMARY KEY, variant_id TEXT NOT NULL REFERENCES variants(id) ON DELETE CASCADE)`,
    `CREATE INDEX IF NOT EXISTS barcodes_variant_idx ON barcodes(variant_id)`,
    `CREATE TABLE IF NOT EXISTS shifts (id TEXT PRIMARY KEY, membership_id TEXT NOT NULL, user_id TEXT NOT NULL, opened_at TEXT NOT NULL,
       closed_at TEXT, opening_cash_minor TEXT NOT NULL, counted_cash_minor TEXT, expected_cash_minor TEXT,
       status TEXT NOT NULL CHECK (status IN ('open', 'closed')))`,
    `CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open ON shifts(status) WHERE status = 'open'`,
    `CREATE TABLE IF NOT EXISTS sales (id TEXT PRIMARY KEY, shift_id TEXT NOT NULL REFERENCES shifts(id), membership_id TEXT NOT NULL,
       user_id TEXT NOT NULL, receipt_number TEXT NOT NULL UNIQUE, receipt_seq INTEGER NOT NULL UNIQUE, occurred_at TEXT NOT NULL,
       subtotal_minor TEXT NOT NULL, line_discounts_minor TEXT NOT NULL, order_discount_minor TEXT NOT NULL,
       total_minor TEXT NOT NULL, change_minor TEXT NOT NULL, above_limit INTEGER NOT NULL, catalog_version TEXT NOT NULL,
       zero_total_reason TEXT, supervisor_membership_id TEXT)`,
    `CREATE INDEX IF NOT EXISTS sales_shift_idx ON sales(shift_id)`,
    `CREATE TABLE IF NOT EXISTS sale_lines (sale_id TEXT NOT NULL REFERENCES sales(id), position INTEGER NOT NULL, variant_id TEXT NOT NULL,
       name_en TEXT, name_ar TEXT, variant_name_en TEXT, variant_name_ar TEXT, sku TEXT, quantity TEXT NOT NULL,
       list_unit_price_minor TEXT NOT NULL, unit_price_minor TEXT NOT NULL, gross_minor TEXT NOT NULL,
       line_discount_minor TEXT NOT NULL, order_discount_minor TEXT NOT NULL, net_minor TEXT NOT NULL,
       track_inventory INTEGER NOT NULL, PRIMARY KEY (sale_id, position))`,
    `CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id), method_id TEXT NOT NULL,
       method_kind TEXT NOT NULL, name_en TEXT, name_ar TEXT, amount_minor TEXT NOT NULL, tendered_minor TEXT,
       change_minor TEXT NOT NULL, fee_minor TEXT NOT NULL, reference TEXT)`,
    `CREATE INDEX IF NOT EXISTS payments_sale_idx ON payments(sale_id)`,
    `CREATE TABLE IF NOT EXISTS cash_movements (id TEXT PRIMARY KEY, shift_id TEXT NOT NULL REFERENCES shifts(id), membership_id TEXT NOT NULL,
       direction TEXT NOT NULL CHECK (direction IN ('cash_in', 'cash_out')), amount_minor TEXT NOT NULL, note TEXT,
       occurred_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS refunds (id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id), shift_id TEXT NOT NULL,
       membership_id TEXT NOT NULL, refund_number TEXT NOT NULL UNIQUE, reason TEXT NOT NULL, note TEXT,
       total_minor TEXT NOT NULL, occurred_at TEXT NOT NULL, approver_membership_id TEXT)`,
    `CREATE INDEX IF NOT EXISTS refunds_sale_idx ON refunds(sale_id)`,
    `CREATE TABLE IF NOT EXISTS refund_lines (refund_id TEXT NOT NULL REFERENCES refunds(id), sale_position INTEGER NOT NULL,
       quantity TEXT NOT NULL, amount_minor TEXT NOT NULL, PRIMARY KEY (refund_id, sale_position))`,
    `CREATE TABLE IF NOT EXISTS refund_payments (refund_id TEXT NOT NULL REFERENCES refunds(id), payment_id TEXT NOT NULL,
       method_kind TEXT NOT NULL, amount_minor TEXT NOT NULL)`,
    // Every record for the server, in causal order (seq), with its exact JSON body.
    `CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, kind TEXT NOT NULL, body TEXT NOT NULL,
       status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'duplicate', 'refused')), code TEXT, message TEXT,
       result TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS outbox_status_idx ON outbox(status, seq)`,
    `CREATE TABLE IF NOT EXISTS pin_attempts (membership_id TEXT PRIMARY KEY, failures INTEGER NOT NULL, lockouts INTEGER NOT NULL,
       locked_until TEXT)`,
  ],
  // ADR-0112 amendment 3: the branch shift. `origin` is 'local' for a shift this device opened
  // (the primary) and 'branch' for the primary's shift a secondary device learned from sync;
  // `closed_by` tells a local close ('device', 'forced') from one learned from the server.
  [
    `ALTER TABLE shifts ADD COLUMN origin TEXT NOT NULL DEFAULT 'local'`,
    `ALTER TABLE shifts ADD COLUMN closed_by TEXT`,
  ],
];

export const META = {
  schemaVersion: 'schemaVersion',
  version: 'version',
  catalogVersion: 'catalogVersion',
  lastSuccessfulSyncAt: 'lastSuccessfulSyncAt',
  offlineLimitHours: 'offlineLimitHours',
  device: 'device',
  merchant: 'merchant',
  branch: 'branch',
  register: 'register',
  settings: 'settings',
  /** The last receipt sequence number this device used (integer as text). */
  receiptCounter: 'receiptCounter',
  /** The branch shift as the server last described it (JSON, amendment 3). */
  branchShift: 'branchShift',
  primaryDevice: 'primaryDevice',
} as const;

export const setMeta = (key: string, value: string | null): SqlStatement => ({
  sql: `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  params: [key, value],
});

export async function getMeta(db: BridgeDb, key: string): Promise<string | null> {
  const rows = await db.query(`SELECT value FROM meta WHERE key = ?`, [key]);
  const v = rows[0]?.['value'];
  return v === undefined || v === null ? null : String(v);
}

/** Creates or upgrades the local schema; safe to call at every start. */
export async function migrate(db: BridgeDb): Promise<void> {
  await db.exec(MIGRATIONS[0]![0]!);
  const current = Number((await getMeta(db, META.schemaVersion)) ?? '0');
  for (let i = current; i < MIGRATIONS.length; i += 1) {
    await db.transaction([
      ...MIGRATIONS[i]!.map((sql) => ({ sql })),
      setMeta(META.schemaVersion, String(i + 1)),
    ]);
  }
}
