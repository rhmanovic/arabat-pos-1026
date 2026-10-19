/**
 * The native bridge the Arabat app exposes to the device web app as `window.ArabatApp`
 * (bridge version 2). All methods return promises; errors reject with an `Error` whose message
 * starts with a code (`DB_ERROR: …`, `NOT_REGISTERED`, `NETWORK: …`, `PRINTER_UNAVAILABLE`,
 * `PRINT_FAILED: …`, `FORBIDDEN_ORIGIN`, `BAD_REQUEST: …`). Money and other 64-bit integers
 * travel as strings. The device token never reaches JavaScript: `api.*` adds it natively.
 */
export const BRIDGE_VERSION = 2;

export type SqlParam = string | number | boolean | null;
export type SqlRow = Record<string, string | number | null>;

export interface SqlStatement {
  sql: string;
  params?: SqlParam[];
}

/** The device's local SQLite database (one file per device, WAL, foreign keys on). */
export interface BridgeDb {
  exec(sql: string, params?: SqlParam[]): Promise<{ changes: number; lastInsertRowid: number }>;
  query(sql: string, params?: SqlParam[]): Promise<SqlRow[]>;
  /** `BEGIN IMMEDIATE … COMMIT`; any error rolls every statement back. */
  transaction(statements: SqlStatement[]): Promise<{ changes: number }[]>;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface BridgeApi {
  /** `POST /device/register`; on "registered" the native app keeps the token and strips it. */
  register(input: {
    email: string;
    password: string;
    deviceName: string;
    merchantId?: string;
    branchId?: string;
  }): Promise<ApiResponse>;
  request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<ApiResponse>;
  isRegistered(): Promise<boolean>;
  /** Deletes the token (after `DEVICE_REVOKED`, or to register again). */
  forget(): Promise<void>;
}

export interface PrinterStatus {
  ready: boolean;
  name: string | null;
  connection: 'usb' | 'network' | 'airprint' | 'other' | null;
}

export interface DeviceInfo {
  platform: 'macos' | 'ios' | 'android' | 'windows';
  appVersion: string;
  bridgeVersion: number;
  bundleVersion: string;
}

export interface ArabatBridge {
  bridgeVersion: number;
  device: { info(): Promise<DeviceInfo> };
  db: BridgeDb;
  api: BridgeApi;
  print: { receipt(html: string): Promise<{ ok: true }> };
  printer: { status(): Promise<PrinterStatus> };
  app: { applyUpdate(): Promise<void>; log(message: string): Promise<void> };
}

declare global {
  interface Window {
    ArabatApp?: ArabatBridge;
  }
}

/** The bridge of the page, when this really runs inside the Arabat app (bridge version 2). */
export function findBridge(): ArabatBridge | null {
  const w = globalThis as { ArabatApp?: ArabatBridge };
  return w.ArabatApp?.bridgeVersion === BRIDGE_VERSION ? w.ArabatApp : null;
}

/** The code a bridge error starts with (`NETWORK: timeout` → `NETWORK`). */
export function bridgeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(':')[0]!.trim();
}
