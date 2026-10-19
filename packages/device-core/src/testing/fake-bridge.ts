import initSqlJs from 'sql.js/dist/sql-asm.js';
import {
  type ApiResponse,
  type ArabatBridge,
  BRIDGE_VERSION,
  type BridgeDb,
  type PrinterStatus,
  type SqlParam,
  type SqlRow,
  type SqlStatement,
} from '../bridge.js';

export interface FakeBridgeOptions {
  /** The API base, e.g. `http://localhost:3100/api/v1`. */
  baseUrl: string;
  fetch?: typeof fetch;
  /** Start registered with this token (the real app keeps it natively). */
  token?: string | null;
  platform?: 'macos' | 'ios' | 'android' | 'windows';
  printer?: PrinterStatus;
}

export interface FakeBridge extends ArabatBridge {
  /** Every receipt document handed to the printer. */
  printed: string[];
  /** The stored device token (tests only; the real bridge never exposes it). */
  token: string | null;
  /** Simulate being offline: every API call rejects with `NETWORK: …`. */
  offline: boolean;
  /** How many times `applyUpdate` was called. */
  updatesApplied: number;
}

/**
 * `window.ArabatApp` for tests and for development in a normal browser (ADR-0112): an in-memory
 * SQLite (sql.js, asm.js build so it needs no .wasm file), an `api` that calls a test server with
 * the token the native app would hold, and a `print` that records the HTML. Same contract as the
 * native bridge (version 2), including the error codes.
 */
export async function createFakeBridge(options: FakeBridgeOptions): Promise<FakeBridge> {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.run('PRAGMA foreign_keys = ON');
  const doFetch = options.fetch ?? fetch;
  const bind = (params: SqlParam[] | undefined) =>
    (params ?? []).map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p));
  const fail = (error: unknown) =>
    new Error(`DB_ERROR: ${error instanceof Error ? error.message : String(error)}`);

  const exec = (sql: string, params?: SqlParam[]) => {
    try {
      sqlite.run(sql, bind(params));
      const changes = sqlite.getRowsModified();
      const [row] = sqlite.exec('SELECT last_insert_rowid() AS id');
      return { changes, lastInsertRowid: Number(row?.values[0]?.[0] ?? 0) };
    } catch (error) {
      throw fail(error);
    }
  };
  const db: BridgeDb = {
    async exec(sql, params) {
      return exec(sql, params);
    },
    async query(sql, params) {
      try {
        const stmt = sqlite.prepare(sql);
        stmt.bind(bind(params));
        const rows: SqlRow[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as SqlRow);
        stmt.free();
        return rows;
      } catch (error) {
        throw fail(error);
      }
    },
    async transaction(statements: SqlStatement[]) {
      sqlite.run('BEGIN IMMEDIATE');
      try {
        const out = statements.map((s) => ({ changes: exec(s.sql, s.params).changes }));
        sqlite.run('COMMIT');
        return out;
      } catch (error) {
        sqlite.run('ROLLBACK');
        throw error;
      }
    },
  };

  const bridge: FakeBridge = {
    bridgeVersion: BRIDGE_VERSION,
    printed: [],
    token: options.token ?? null,
    offline: false,
    updatesApplied: 0,
    device: {
      async info() {
        return {
          platform: options.platform ?? 'macos',
          appVersion: '0.0.0-fake',
          bridgeVersion: BRIDGE_VERSION,
          bundleVersion: 'dev',
        };
      },
    },
    db,
    api: {
      async register(input) {
        const res = await call('POST', '/device/register', input, false);
        const body = res.body as { status?: string; token?: string } | null;
        if (res.status === 200 && body?.status === 'registered' && body.token) {
          bridge.token = body.token;
          const { token: _token, ...rest } = body;
          return { status: res.status, body: rest };
        }
        return res;
      },
      request(method, path, body) {
        return call(method, path, body, true);
      },
      async isRegistered() {
        return bridge.token !== null;
      },
      async forget() {
        bridge.token = null;
      },
    },
    print: {
      async receipt(html) {
        if (!(options.printer?.ready ?? true)) throw new Error('PRINTER_UNAVAILABLE');
        bridge.printed.push(html);
        return { ok: true };
      },
    },
    printer: {
      async status() {
        return options.printer ?? { ready: true, name: 'Fake printer', connection: 'usb' };
      },
    },
    app: {
      async applyUpdate() {
        bridge.updatesApplied += 1;
      },
      async log() {},
    },
  };

  async function call(
    method: string,
    path: string,
    body: unknown,
    withToken: boolean,
  ): Promise<ApiResponse> {
    if (bridge.offline) throw new Error('NETWORK: offline');
    if (withToken && bridge.token === null) throw new Error('NOT_REGISTERED');
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (withToken) headers['authorization'] = `Bearer ${bridge.token}`;
    let res: Response;
    try {
      res = await doFetch(options.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(`NETWORK: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  }

  return bridge;
}
