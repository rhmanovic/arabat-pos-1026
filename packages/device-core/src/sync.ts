import type { DeviceSnapshot, DeviceUploadResult } from '@arabat/contracts';
import { type ArabatBridge, type BridgeDb, bridgeErrorCode } from './bridge.js';
import { applyResults, nextBatch, outboxCounts } from './outbox.js';
import { META, getMeta, setMeta } from './schema.js';
import { applySnapshot } from './snapshot.js';

export interface SyncStatus {
  /** A sync is running now. */
  syncing: boolean;
  /** The last request reached the server (null before the first attempt). */
  online: boolean | null;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
  pending: number;
  refused: number;
  /** 401 DEVICE_REVOKED: the device must be registered again; unsent records are kept. */
  revoked: boolean;
  /** 403 MERCHANT_SUSPENDED: the company is suspended; selling stops. */
  suspended: boolean;
  version: string | null;
  catalogVersion: string | null;
}

export interface SyncEngineOptions {
  /** Background sync period while online (default 3 minutes). */
  intervalMs?: number;
  /** Delay between a new record and its upload (default 1.5 s). */
  uploadDelayMs?: number;
  now?: () => Date;
  log?: (message: string) => void;
}

type Listener = (status: SyncStatus) => void;

const problemCode = (body: unknown): string | null =>
  body && typeof body === 'object' && 'code' in body
    ? String((body as { code: unknown }).code)
    : null;

/**
 * Sync (ADR-0112 §7, docs/DEVICE_API.md): downloads the snapshot (full, then deltas) and
 * uploads the outbox in causal order in batches of up to 200, byte-identical on every retry.
 * Runs at start, after each new record, after each successful upload and every few minutes
 * while online. One sync at a time.
 */
export class SyncEngine {
  private listeners = new Set<Listener>();
  private status: SyncStatus = {
    syncing: false,
    online: null,
    lastSuccessfulSyncAt: null,
    lastError: null,
    pending: 0,
    refused: 0,
    revoked: false,
    suspended: false,
    version: null,
    catalogVersion: null,
  };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private uploadTimer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private stopped = true;
  private readonly intervalMs: number;
  private readonly uploadDelayMs: number;
  private readonly now: () => Date;
  private readonly log: (message: string) => void;

  constructor(
    private readonly bridge: ArabatBridge,
    private readonly db: BridgeDb,
    options: SyncEngineOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 3 * 60_000;
    this.uploadDelayMs = options.uploadDelayMs ?? 1500;
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? (() => {});
  }

  get current(): SyncStatus {
    return this.status;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  /** Reads the stored state (counts, versions) without touching the network. */
  async refresh(): Promise<SyncStatus> {
    const counts = await outboxCounts(this.db);
    this.set({
      ...counts,
      lastSuccessfulSyncAt: await getMeta(this.db, META.lastSuccessfulSyncAt),
      version: await getMeta(this.db, META.version),
      catalogVersion: await getMeta(this.db, META.catalogVersion),
    });
    return this.status;
  }

  /** Starts the background schedule: a sync now, then every `intervalMs`. */
  start(): void {
    this.stopped = false;
    void this.syncNow();
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.uploadTimer) clearTimeout(this.uploadTimer);
    this.timer = null;
    this.uploadTimer = null;
  }

  /** A record was queued: upload soon (debounced so a burst of records goes in one batch). */
  requestUpload(): void {
    if (this.stopped) return;
    // The new record counts as waiting at once, before the upload runs.
    void this.refresh();
    if (this.uploadTimer) clearTimeout(this.uploadTimer);
    this.uploadTimer = setTimeout(() => {
      this.uploadTimer = null;
      void this.syncNow();
    }, this.uploadDelayMs);
  }

  /** Upload what is waiting, then download the changes. Concurrent calls share one run. */
  syncNow(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private schedule(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow().finally(() => this.schedule());
    }, this.intervalMs);
  }

  private set(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l(this.status);
  }

  private async run(): Promise<void> {
    if (this.status.revoked) return;
    this.set({ syncing: true });
    try {
      await this.refresh();
      const uploaded = await this.upload();
      if (uploaded !== 'blocked') await this.download();
    } catch (error) {
      this.failure(error);
    } finally {
      await this.refresh();
      this.set({ syncing: false });
    }
  }

  /** Marks a network or server failure; a revocation or suspension is final until re-registration / release. */
  private failure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.log(`sync failed: ${message}`);
    const code = bridgeErrorCode(error);
    this.set({ online: code === 'NETWORK' ? false : this.status.online, lastError: message });
  }

  /** The device was removed by a manager: stop, keep every unsent record, forget the token. */
  private async revoked(): Promise<void> {
    this.set({ revoked: true, lastError: 'DEVICE_REVOKED' });
    try {
      await this.bridge.api.forget();
    } catch {
      // Nothing else to do: the next request would be refused anyway.
    }
  }

  /** Uploads every waiting batch; 'blocked' when the server refuses the device itself. */
  private async upload(): Promise<'done' | 'blocked'> {
    for (;;) {
      const batch = await nextBatch(this.db);
      if (batch.length === 0) return 'done';
      const records = batch.map((e) => JSON.parse(e.body) as unknown);
      const res = await this.bridge.api.request('POST', '/device/sync', { records });
      this.set({ online: true });
      if (res.status === 401) {
        if (problemCode(res.body) === 'DEVICE_REVOKED') await this.revoked();
        else this.set({ lastError: 'UNAUTHENTICATED' });
        return 'blocked';
      }
      if (res.status === 403 && problemCode(res.body) === 'MERCHANT_SUSPENDED') {
        this.set({ suspended: true, lastError: 'MERCHANT_SUSPENDED' });
        return 'blocked';
      }
      if (res.status !== 200) {
        this.set({ lastError: `UPLOAD_${res.status}` });
        return 'blocked';
      }
      const body = res.body as DeviceUploadResult;
      await applyResults(this.db, body.results, this.now().toISOString());
      // The server took the batch: a successful sync, whatever it answered per record.
      const synced = setMeta(META.lastSuccessfulSyncAt, this.now().toISOString());
      await this.db.exec(synced.sql, synced.params);
      this.set({ lastError: null });
      // Records that were refused with a retryable code are sent again on the next sync, not
      // in a loop within this one.
      if (body.results.every((r) => r.status === 'refused')) return 'done';
      if (batch.length < 200) return 'done';
    }
  }

  private async download(): Promise<void> {
    const since = await getMeta(this.db, META.version);
    const path = since ? `/device/sync?since=${encodeURIComponent(since)}` : '/device/sync';
    const res = await this.bridge.api.request('GET', path);
    this.set({ online: true });
    if (res.status === 401) {
      if (problemCode(res.body) === 'DEVICE_REVOKED') await this.revoked();
      else this.set({ lastError: 'UNAUTHENTICATED' });
      return;
    }
    if (res.status === 403 && problemCode(res.body) === 'MERCHANT_SUSPENDED') {
      this.set({ suspended: true, lastError: 'MERCHANT_SUSPENDED' });
      return;
    }
    if (res.status !== 200) {
      this.set({ lastError: `DOWNLOAD_${res.status}` });
      return;
    }
    await applySnapshot(this.db, res.body as DeviceSnapshot, this.now());
    this.set({ suspended: false, lastError: null });
  }
}
