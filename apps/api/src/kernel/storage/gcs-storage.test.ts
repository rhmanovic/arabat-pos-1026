import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env.js';
import { GcsStorage } from './gcs-storage.js';

/** In-memory stand-in for the Cloud Storage JSON API and the metadata token server. */
let server: Server;
let base: string;
const objects = new Map<string, Buffer>();
const seen: { method: string; path: string; auth?: string }[] = [];
let tokenRequests = 0;

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://stub');
    if (url.pathname === '/token') {
      tokenRequests++;
      if (req.headers['metadata-flavor'] !== 'Google') return void res.writeHead(403).end();
      res.writeHead(200, { 'content-type': 'application/json' });
      return void res.end(JSON.stringify({ access_token: 'tok-1', expires_in: 3599 }));
    }
    seen.push({ method: req.method!, path: url.pathname, auth: req.headers.authorization });
    if (req.headers.authorization !== 'Bearer tok-1') return void res.writeHead(401).end();
    if (req.method === 'POST' && url.pathname === '/upload/storage/v1/b/uploads/o') {
      const name = url.searchParams.get('name')!;
      if (url.searchParams.get('ifGenerationMatch') === '0' && objects.has(name))
        return void res.writeHead(412).end();
      objects.set(name, await readBody(req));
      return void res.writeHead(200).end('{}');
    }
    const match = /^\/storage\/v1\/b\/uploads\/o\/(.+)$/.exec(url.pathname);
    if (!match) return void res.writeHead(400).end();
    const name = decodeURIComponent(match[1]!);
    const data = objects.get(name);
    if (req.method === 'GET' && url.searchParams.get('alt') === 'media') {
      if (!data) return void res.writeHead(404).end();
      return void res.writeHead(200).end(data);
    }
    if (req.method === 'DELETE') {
      if (!objects.delete(name)) return void res.writeHead(404).end();
      return void res.writeHead(204).end();
    }
    res.writeHead(400).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(() => {
  objects.clear();
  seen.length = 0;
  tokenRequests = 0;
});

function storage(bucket = 'uploads') {
  return new GcsStorage(
    loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://u:p@localhost/db',
      MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      FILE_STORAGE_DRIVER: 'gcs',
      GCS_BUCKET: bucket,
      GCS_API_URL: base,
      GCS_TOKEN_URL: `${base}/token`,
    }),
  );
}

describe('GcsStorage', () => {
  it('stores, reads and deletes an object under its key', async () => {
    const s = storage();
    const key = 'merchants/m1/products/p1/img1';
    await s.put(key, Buffer.from('hello'));
    expect(objects.get(key)?.toString()).toBe('hello');
    expect((await s.get(key))?.toString()).toBe('hello');
    await s.delete(key);
    expect(objects.has(key)).toBe(false);
    expect(await s.get(key)).toBeNull();
    // A missing object deletes quietly, like the local adapter.
    await expect(s.delete(key)).resolves.toBeUndefined();
  });

  it('never overwrites an existing object', async () => {
    const s = storage();
    await s.put('a/b', Buffer.from('one'));
    await expect(s.put('a/b', Buffer.from('two'))).rejects.toThrow(/already exists/);
    expect(objects.get('a/b')?.toString()).toBe('one');
  });

  it('reuses the metadata token and sends it on every call', async () => {
    const s = storage();
    await s.put('k1', Buffer.from('x'));
    await s.get('k1');
    await s.delete('k1');
    expect(tokenRequests).toBe(1);
    expect(seen.every((r) => r.auth === 'Bearer tok-1')).toBe(true);
  });

  it('rejects unsafe keys before any request', async () => {
    const s = storage();
    await expect(s.put('../etc/passwd', Buffer.from('x'))).rejects.toThrow(/Invalid storage key/);
    await expect(s.get('a b')).rejects.toThrow(/Invalid storage key/);
    expect(seen).toHaveLength(0);
  });

  it('reports API errors instead of treating them as missing files', async () => {
    const s = storage('other-bucket');
    await expect(s.get('k1')).rejects.toThrow(/HTTP 400/);
  });

  it('requires a bucket', () => {
    expect(
      () =>
        new GcsStorage(
          loadEnv({
            NODE_ENV: 'test',
            DATABASE_URL: 'postgres://u:p@localhost/db',
            MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
            FILE_STORAGE_DRIVER: 'gcs',
          }),
        ),
    ).toThrow(/GCS_BUCKET/);
  });
});
