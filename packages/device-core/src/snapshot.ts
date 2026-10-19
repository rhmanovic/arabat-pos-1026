import type { DeviceSnapshot } from '@arabat/contracts';
import type { BridgeDb, SqlStatement } from './bridge.js';
import { META, getMeta, setMeta } from './schema.js';

export type StaffMember = DeviceSnapshot['staff'][number];
export type DevicePaymentMethod = DeviceSnapshot['paymentMethods'][number];
export type DeviceSettings = DeviceSnapshot['settings'];
export type BranchShift = NonNullable<DeviceSnapshot['branchShift']>;

/** The parts of the snapshot every screen needs, as stored locally. */
export interface LocalContext {
  device: DeviceSnapshot['device'];
  merchant: DeviceSnapshot['merchant'];
  branch: DeviceSnapshot['branch'];
  register: DeviceSnapshot['register'];
  settings: DeviceSettings;
  catalogVersion: string;
  version: string;
  offlineLimitHours: number;
  lastSuccessfulSyncAt: string | null;
  /** The branch shift as the server last described it (amendment 3). */
  branchShift: BranchShift | null;
  primaryDevice: DeviceSnapshot['primaryDevice'];
}

const b = (v: boolean) => (v ? 1 : 0);

/** The sequence number of a receipt in this device's series, or null for another series. */
export function receiptSequence(receiptNumber: string | null, prefix: string): number | null {
  if (!receiptNumber || !receiptNumber.toUpperCase().startsWith(prefix.toUpperCase())) return null;
  const digits = receiptNumber.slice(prefix.length);
  return /^\d{6}$/.test(digits) ? Number(digits) : null;
}

/**
 * The statements that store a snapshot (ADR-0112 §7a): a full one replaces every collection;
 * a delta replaces the products it carries and every always-complete collection. Run in one
 * transaction so a half-applied snapshot can never be seen.
 */
export function snapshotStatements(
  snap: DeviceSnapshot,
  currentCounter: number,
  now: string,
): SqlStatement[] {
  const s: SqlStatement[] = [];
  if (snap.full)
    s.push(
      { sql: `DELETE FROM barcodes` },
      { sql: `DELETE FROM variants` },
      { sql: `DELETE FROM products` },
    );
  s.push(
    { sql: `DELETE FROM payment_methods` },
    { sql: `DELETE FROM staff` },
    { sql: `DELETE FROM categories` },
  );
  for (const m of snap.paymentMethods)
    s.push({
      sql: `INSERT INTO payment_methods (id, sort_order, json) VALUES (?, ?, ?)`,
      params: [m.id, m.sortOrder, JSON.stringify(m)],
    });
  for (const m of snap.staff)
    s.push({
      sql: `INSERT INTO staff (membership_id, user_id, full_name, is_owner, pin_hash, permissions) VALUES (?, ?, ?, ?, ?, ?)`,
      params: [
        m.membershipId,
        m.userId,
        m.fullName,
        b(m.isOwner),
        m.pinHash,
        JSON.stringify(m.permissions),
      ],
    });
  for (const c of snap.categories)
    s.push({
      sql: `INSERT INTO categories (id, parent_id, name_en, name_ar, sort_order, status) VALUES (?, ?, ?, ?, ?, ?)`,
      params: [c.id, c.parentId, c.nameEn, c.nameAr, c.sortOrder, c.status],
    });
  for (const p of snap.products) {
    if (!snap.full) {
      s.push(
        {
          sql: `DELETE FROM barcodes WHERE variant_id IN (SELECT id FROM variants WHERE product_id = ?)`,
          params: [p.id],
        },
        { sql: `DELETE FROM variants WHERE product_id = ?`, params: [p.id] },
        { sql: `DELETE FROM products WHERE id = ?`, params: [p.id] },
      );
    }
    s.push({
      sql: `INSERT INTO products (id, category_id, name_en, name_ar, type, track_inventory, sellable, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        p.id,
        p.categoryId,
        p.nameEn,
        p.nameAr,
        p.type,
        b(p.trackInventory),
        b(p.sellable),
        p.updatedAt,
      ],
    });
    p.variants.forEach((v, position) => {
      s.push({
        sql: `INSERT INTO variants (id, product_id, name_en, name_ar, sku, price_minor, cost_minor, is_default, status, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          v.id,
          p.id,
          v.nameEn,
          v.nameAr,
          v.sku,
          v.priceMinor,
          v.costMinor,
          b(v.isDefault),
          v.status,
          position,
        ],
      });
      for (const code of v.barcodes)
        s.push({
          sql: `INSERT OR REPLACE INTO barcodes (barcode, variant_id) VALUES (?, ?)`,
          params: [code, v.id],
        });
    });
  }
  s.push(...branchShiftStatements(snap, now));
  // The device's counter never goes below what the server already has from it (a reinstall).
  const prefix = `${snap.branch.code}-${snap.register.code}-`;
  const serverSeq = receiptSequence(snap.counters.lastReceiptNumber, prefix) ?? 0;
  s.push(
    setMeta(META.branchShift, snap.branchShift ? JSON.stringify(snap.branchShift) : null),
    setMeta(META.primaryDevice, snap.primaryDevice ? JSON.stringify(snap.primaryDevice) : null),
    setMeta(META.version, snap.version),
    setMeta(META.catalogVersion, snap.catalogVersion),
    setMeta(META.offlineLimitHours, String(snap.offlineLimitHours)),
    setMeta(META.device, JSON.stringify(snap.device)),
    setMeta(META.merchant, JSON.stringify(snap.merchant)),
    setMeta(META.branch, JSON.stringify(snap.branch)),
    setMeta(META.register, JSON.stringify(snap.register)),
    setMeta(META.settings, JSON.stringify(snap.settings)),
    setMeta(META.receiptCounter, String(Math.max(currentCounter, serverSeq))),
    setMeta(META.lastSuccessfulSyncAt, now),
  );
  return s;
}

/**
 * The branch shift on this device (ADR-0112 amendment 3). A secondary device sells into the
 * primary's open shift: it is kept as a local `shifts` row of origin 'branch' (so sales can
 * reference it) and closed here when the server says so. The primary's own shift is closed
 * here when a manager closed it online (same id, status closed). A close learned from the
 * server is `closed_by = 'server'`.
 */
function branchShiftStatements(snap: DeviceSnapshot, now: string): SqlStatement[] {
  const bs = snap.branchShift;
  const closeServer = (
    where: string,
    params: (string | null)[],
    at: string | null,
  ): SqlStatement => ({
    sql: `UPDATE shifts SET status = 'closed', closed_at = ?, closed_by = 'server' WHERE status = 'open' AND ${where}`,
    params: [at ?? now, ...params],
  });
  if (snap.device.role === 'secondary') {
    if (bs && bs.status === 'open')
      return [
        closeServer(`id <> ?`, [bs.id], null),
        {
          sql: `INSERT OR IGNORE INTO shifts (id, membership_id, user_id, opened_at, opening_cash_minor, status, origin)
                VALUES (?, ?, ?, ?, '0', 'open', 'branch')`,
          params: [bs.id, bs.openedBy.membershipId, bs.openedBy.userId, bs.openedAt],
        },
      ];
    return [closeServer(`origin = 'branch'`, [], bs?.closedAt ?? null)];
  }
  const out = [closeServer(`origin = 'branch'`, [], null)];
  if (bs && bs.status === 'closed') out.push(closeServer(`id = ?`, [bs.id], bs.closedAt));
  return out;
}

export async function applySnapshot(
  db: BridgeDb,
  snap: DeviceSnapshot,
  now = new Date(),
): Promise<void> {
  // A device moved to another branch gets a new register and so a new series from 1.
  const stored = await getMeta(db, META.register);
  const sameRegister = !stored || (JSON.parse(stored) as { id: string }).id === snap.register.id;
  const counter = sameRegister ? Number((await getMeta(db, META.receiptCounter)) ?? '0') : 0;
  await db.transaction(snapshotStatements(snap, counter, now.toISOString()));
}

/** The stored context, or null before the first full snapshot. */
export async function loadContext(db: BridgeDb): Promise<LocalContext | null> {
  const rows = await db.query(`SELECT key, value FROM meta`);
  const meta = new Map(
    rows.map((r) => [String(r['key']), r['value'] === null ? null : String(r['value'])]),
  );
  const json = <T>(key: string): T | null => {
    const v = meta.get(key);
    return v ? (JSON.parse(v) as T) : null;
  };
  const device = json<LocalContext['device']>(META.device);
  const settings = json<DeviceSettings>(META.settings);
  if (!device || !settings) return null;
  return {
    device,
    merchant: json<LocalContext['merchant']>(META.merchant)!,
    branch: json<LocalContext['branch']>(META.branch)!,
    register: json<LocalContext['register']>(META.register)!,
    settings,
    catalogVersion: meta.get(META.catalogVersion) ?? '',
    version: meta.get(META.version) ?? '',
    offlineLimitHours: Number(meta.get(META.offlineLimitHours) ?? '72'),
    lastSuccessfulSyncAt: meta.get(META.lastSuccessfulSyncAt) ?? null,
    branchShift: json<BranchShift>(META.branchShift),
    primaryDevice: json<NonNullable<LocalContext['primaryDevice']>>(META.primaryDevice),
  };
}

export async function loadStaff(db: BridgeDb): Promise<StaffMember[]> {
  const rows = await db.query(`SELECT * FROM staff ORDER BY full_name, membership_id`);
  return rows.map((r) => ({
    membershipId: String(r['membership_id']),
    userId: String(r['user_id']),
    fullName: String(r['full_name']),
    isOwner: r['is_owner'] === 1,
    pinHash: r['pin_hash'] === null ? null : String(r['pin_hash']),
    permissions: JSON.parse(String(r['permissions'])) as string[],
  }));
}

export async function loadPaymentMethods(db: BridgeDb): Promise<DevicePaymentMethod[]> {
  const rows = await db.query(`SELECT json FROM payment_methods ORDER BY sort_order, id`);
  return rows.map((r) => JSON.parse(String(r['json'])) as DevicePaymentMethod);
}

/** Whether a member holds a permission at this branch (the server resolved the list). */
export const holds = (member: StaffMember, permission: string): boolean =>
  member.permissions.includes(permission);
