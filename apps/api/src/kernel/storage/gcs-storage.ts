import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { FileStorage, assertStorageKey } from './file-storage.js';

type Token = { value: string; expiresAt: number };

/**
 * Google Cloud Storage adapter (ADR-0105) over the JSON API. On Cloud Run the access token
 * comes from the metadata server for the service's own service account, so no key file or
 * secret exists. Objects are private; the API streams them to the browser as before.
 */
@Injectable()
export class GcsStorage extends FileStorage {
  private readonly bucket: string;
  private readonly apiUrl: string;
  private readonly tokenUrl: string;
  private token: Token | null = null;

  constructor(@Inject(ENV) env: Env) {
    super();
    if (!env.GCS_BUCKET) throw new Error('GCS_BUCKET is required when FILE_STORAGE_DRIVER=gcs');
    this.bucket = env.GCS_BUCKET;
    this.apiUrl = env.GCS_API_URL.replace(/\/$/, '');
    this.tokenUrl = env.GCS_TOKEN_URL;
  }

  async put(key: string, data: Buffer): Promise<void> {
    assertStorageKey(key);
    // ifGenerationMatch=0: create only, like the local adapter's exclusive write.
    const url = `${this.apiUrl}/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(key)}`;
    const res = await this.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array(data),
    });
    if (res.status === 412) throw new Error(`Storage object already exists: ${key}`);
    await this.expectOk(res, 'upload');
  }

  async get(key: string): Promise<Buffer | null> {
    assertStorageKey(key);
    const res = await this.request(`${this.objectUrl(key)}?alt=media`, { method: 'GET' });
    if (res.status === 404) return null;
    await this.expectOk(res, 'download');
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    assertStorageKey(key);
    const res = await this.request(this.objectUrl(key), { method: 'DELETE' });
    if (res.status === 404) return;
    await this.expectOk(res, 'delete');
  }

  private objectUrl(key: string): string {
    return `${this.apiUrl}/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(key)}`;
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${await this.accessToken()}`);
    return fetch(url, { ...init, headers, signal: AbortSignal.timeout(30_000) });
  }

  private async expectOk(res: Response, what: string): Promise<void> {
    if (res.ok) return;
    const body = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Cloud Storage ${what} failed: HTTP ${res.status} ${body}`);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const res = await fetch(this.tokenUrl, {
      headers: { 'metadata-flavor': 'Google' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Cloud Storage token request failed: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    // Renew a minute early so a token never expires mid-request.
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + Math.max(0, body.expires_in - 60) * 1000,
    };
    return this.token.value;
  }
}
