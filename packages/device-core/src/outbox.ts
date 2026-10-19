import type { DeviceRecord, DeviceRecordResult } from '@arabat/contracts';
import type { BridgeDb, SqlStatement } from './bridge.js';

export type OutboxStatus = 'pending' | 'accepted' | 'duplicate' | 'refused';

export interface OutboxEntry {
  id: string;
  seq: number;
  kind: DeviceRecord['kind'];
  /** The exact JSON sent to the server (byte-identical on every retry). */
  body: string;
  status: OutboxStatus;
  code: string | null;
  message: string | null;
  result: Record<string, unknown> | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Refusals that may clear up on their own once earlier records are accepted (a sale uploaded
 * before its shift, a refund before its sale) or the server is healthy again. Anything else
 * stays refused until a manager handles it.
 */
export const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  'SHIFT_REQUIRED',
  'NOT_FOUND',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
]);

/** The statement that queues a record, in the same transaction as the rows it describes. */
export function enqueueStatement(record: DeviceRecord, now: string): SqlStatement {
  return {
    sql: `INSERT INTO outbox (id, seq, kind, body, status, attempts, created_at, updated_at)
          VALUES (?, (SELECT coalesce(max(seq), 0) + 1 FROM outbox), ?, ?, 'pending', 0, ?, ?)`,
    params: [record.id, record.kind, JSON.stringify(record), now, now],
  };
}

const toEntry = (r: Record<string, unknown>): OutboxEntry => ({
  id: String(r['id']),
  seq: Number(r['seq']),
  kind: r['kind'] as DeviceRecord['kind'],
  body: String(r['body']),
  status: r['status'] as OutboxStatus,
  code: r['code'] === null ? null : String(r['code']),
  message: r['message'] === null ? null : String(r['message']),
  result: r['result'] ? (JSON.parse(String(r['result'])) as Record<string, unknown>) : null,
  attempts: Number(r['attempts']),
  createdAt: String(r['created_at']),
  updatedAt: String(r['updated_at']),
});

/** The next batch to upload, in causal order: pending records and retryable refusals. */
export async function nextBatch(db: BridgeDb, limit = 200): Promise<OutboxEntry[]> {
  const rows = await db.query(
    `SELECT * FROM outbox WHERE status = 'pending' OR (status = 'refused' AND code IN (${[...RETRYABLE_CODES].map(() => '?').join(', ')}))
     ORDER BY seq LIMIT ?`,
    [...RETRYABLE_CODES, limit],
  );
  return rows.map(toEntry);
}

export async function listOutbox(db: BridgeDb, status?: OutboxStatus): Promise<OutboxEntry[]> {
  const rows = status
    ? await db.query(`SELECT * FROM outbox WHERE status = ? ORDER BY seq DESC`, [status])
    : await db.query(`SELECT * FROM outbox ORDER BY seq DESC`);
  return rows.map(toEntry);
}

export async function outboxCounts(db: BridgeDb): Promise<{ pending: number; refused: number }> {
  const rows = await db.query(`SELECT status, count(*) AS n FROM outbox GROUP BY status`);
  const n = (status: string) => Number(rows.find((r) => r['status'] === status)?.['n'] ?? 0);
  return { pending: n('pending'), refused: n('refused') };
}

/** Records the server's answer for each uploaded record. */
export async function applyResults(
  db: BridgeDb,
  results: readonly DeviceRecordResult[],
  now: string,
): Promise<void> {
  if (results.length === 0) return;
  await db.transaction(
    results.map((r) => ({
      sql: `UPDATE outbox SET status = ?, code = ?, message = ?, result = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?`,
      params: [r.status, r.code, r.message, r.result ? JSON.stringify(r.result) : null, now, r.id],
    })),
  );
}
