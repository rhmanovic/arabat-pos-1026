import { hash } from '@node-rs/argon2';
import type { PlatformRole } from '@arabat/permissions';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateTotpSecret, totpCode, totpStep } from '../../kernel/crypto/totp.js';
import { ApiClient, PASSWORD, uniqueEmail, sessionCookie } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { TEST_MFA_KEY, createTestApp, testEnv } from '../../testing/test-app.js';
import { upsertOperator } from '../platform-admin/operators.js';

let app: NestFastifyApplication;
let owner: pg.Pool;
let passwordHash: string;
type Cookies = Record<string, string>;
const ops = {} as Record<'super' | 'support' | 'billing', Cookies>;

async function operator(role: PlatformRole): Promise<Cookies> {
  const email = uniqueEmail('op');
  const secret = generateTotpSecret();
  const client = await owner.connect();
  try {
    const { drizzle } = await import('drizzle-orm/node-postgres');
    await drizzle({ client, casing: 'snake_case' }).transaction((tx) =>
      upsertOperator(tx as never, {
        email,
        fullName: `Operator ${role}`,
        role,
        passwordHash,
        encryptionKey: TEST_MFA_KEY,
        totpSecret: secret,
      }),
    );
  } finally {
    client.release();
  }
  const api = new ApiClient(app);
  const step1 = (
    await api.request('POST', '/auth/platform/login', { body: { email, password: PASSWORD } })
  ).json();
  const done = await api.request('POST', '/auth/platform/mfa', {
    body: { ticket: step1.ticket, code: totpCode(secret, totpStep()) },
  });
  return sessionCookie(done, 'platform');
}

beforeAll(async () => {
  const prepared = await prepareIntegrationDatabase();
  owner = prepared.owner;
  app = await createTestApp({ env: testEnv({ DATABASE_URL: prepared.runtimeUrl }) });
  passwordHash = await hash(PASSWORD, { algorithm: 2 });
  ops.super = await operator('platform.super_admin');
  ops.support = await operator('platform.support');
  ops.billing = await operator('platform.billing');
});
afterAll(async () => {
  await app?.close();
  await owner?.end();
});

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
const call = (method: Method, path: string, cookies?: Cookies, body?: unknown) =>
  new ApiClient(app).request(method, path, {
    ...(cookies ? { cookies } : {}),
    ...(body === undefined ? {} : { body }),
  });
async function ok(method: Method, path: string, cookies?: Cookies, body?: unknown) {
  const r = await call(method, path, cookies, body);
  if (r.statusCode >= 300) throw new Error(`${method} ${path} ${r.statusCode} ${r.body}`);
  return r.statusCode === 204 ? null : r.json();
}

const entry = (name: string, extra: Record<string, unknown> = {}) => ({
  nameAr: `تطبيق ${name}`,
  nameEn: `App ${name}`,
  descriptionAr: null,
  descriptionEn: `About ${name}`,
  url: `/${name.toLowerCase()}/`,
  icon: 'phone',
  openInNewTab: false,
  status: 'active',
  sortOrder: 900,
  version: 0,
  ...extra,
});
const publicIds = async () =>
  ((await ok('GET', '/public/site/apps')).apps as { id: string }[]).map((a) => a.id);

describe('site apps menu (ADR-0117)', () => {
  it('lists the seeded apps to the public, active ones only, in order', async () => {
    const { apps } = (await ok('GET', '/public/site/apps')) as {
      apps: { nameEn: string; url: string; status?: string }[];
    };
    expect(apps.map((a) => a.url)).toEqual(['/manager/', '/pos/', '/store/', '/links/']);
    expect(apps[0]).not.toHaveProperty('status');
    const all = (await ok('GET', '/platform/site-apps', ops.support)).apps as {
      url: string;
      status: string;
    }[];
    expect(all.find((a) => a.status === 'hidden')?.url).toBe('/pricing');
  });

  it('lets editors add, edit, hide and delete entries; support may only read', async () => {
    expect((await call('GET', '/platform/site-apps')).statusCode).toBe(401);
    expect((await call('POST', '/platform/site-apps', ops.support, entry('X'))).statusCode).toBe(
      403,
    );
    const created = await ok('POST', '/platform/site-apps', ops.billing, entry('Ios'));
    expect(created).toMatchObject({ url: '/ios/', status: 'active', version: 1 });
    expect(await publicIds()).toContain(created.id);

    const stale = await call('PUT', `/platform/site-apps/${created.id}`, ops.super, entry('Ios'));
    expect(stale.json().code).toBe('VERSION_CONFLICT');
    const updated = await ok('PUT', `/platform/site-apps/${created.id}`, ops.super, {
      ...entry('Ios'),
      url: 'https://apps.apple.com/kw/app/arabat/id1',
      openInNewTab: true,
      status: 'hidden',
      version: created.version,
    });
    expect(updated).toMatchObject({
      url: 'https://apps.apple.com/kw/app/arabat/id1',
      openInNewTab: true,
      status: 'hidden',
      version: 2,
    });
    expect(await publicIds()).not.toContain(created.id);

    expect(
      (await call('DELETE', `/platform/site-apps/${created.id}`, ops.support)).statusCode,
    ).toBe(403);
    expect(await ok('DELETE', `/platform/site-apps/${created.id}`, ops.billing)).toBeNull();
    expect(
      (await call('DELETE', `/platform/site-apps/${created.id}`, ops.billing)).statusCode,
    ).toBe(404);
    const audit = await owner.query(
      `select action from audit_log where target_id = $1 order by occurred_at`,
      [created.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'site.app.created',
      'site.app.updated',
      'site.app.deleted',
    ]);
  });

  it('refuses addresses that are neither a path nor http(s)', async () => {
    for (const url of ['javascript:alert(1)', 'pos', 'ftp://x', '/a b']) {
      const r = await call('POST', '/platform/site-apps', ops.billing, entry('Bad', { url }));
      expect(r.statusCode, url).toBe(400);
    }
  });
});
