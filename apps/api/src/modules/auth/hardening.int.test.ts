import { hash } from '@node-rs/argon2';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateTotpSecret, totpCode, totpStep } from '../../kernel/crypto/totp.js';
import {
  ApiClient,
  DbFixtures,
  PASSWORD,
  createCompany,
  uniqueEmail,
} from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, TEST_MFA_KEY, createTestApp, testEnv } from '../../testing/test-app.js';
import { upsertOperator } from '../platform-admin/operators.js';

/** Regression tests for the findings of the final audit (Prompt 18). */
let app: NestFastifyApplication;
let owner: pg.Pool;
let runtime: pg.Pool;
let db: DbFixtures;
let mailer: InMemoryMailer;
let passwordHash: string;

beforeAll(async () => {
  const prepared = await prepareIntegrationDatabase();
  owner = prepared.owner;
  runtime = new pg.Pool({ connectionString: prepared.runtimeUrl, max: 2 });
  db = new DbFixtures(owner);
  mailer = new InMemoryMailer();
  app = await createTestApp({ env: testEnv({ DATABASE_URL: prepared.runtimeUrl }), mailer });
  passwordHash = await hash(PASSWORD, { algorithm: 2 });
});
afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await owner?.end();
});

describe('client IP', () => {
  it('ignores a client-supplied X-Forwarded-For unless a proxy is configured', async () => {
    const client = new ApiClient(app);
    const email = uniqueEmail('xff');
    await client.request('POST', '/auth/login', {
      headers: { 'x-forwarded-for': '6.6.6.6' },
      body: { interface: 'manager', email, password: 'Wrong-Password-1' },
    });
    const row = (
      await owner.query(
        `select ip from audit_log where action = 'auth.login.failed' and details->>'email' = $1`,
        [email],
      )
    ).rows[0];
    expect(row.ip).toBe(client.ip);
  });
});

describe('platform TOTP', () => {
  it('limits wrong codes per operator, whatever the IP or ticket', async () => {
    const email = uniqueEmail('op');
    const secret = generateTotpSecret();
    const c = await owner.connect();
    try {
      const { drizzle } = await import('drizzle-orm/node-postgres');
      await drizzle({ client: c, casing: 'snake_case' }).transaction((tx) =>
        upsertOperator(tx as never, {
          email,
          fullName: 'Op',
          role: 'platform.super_admin',
          passwordHash,
          encryptionKey: TEST_MFA_KEY,
          totpSecret: secret,
        }),
      );
    } finally {
      c.release();
    }
    const attempt = async (code: string) => {
      const client = new ApiClient(app); // a new IP every time
      const step1 = (
        await client.request('POST', '/auth/platform/login', {
          body: { email, password: PASSWORD },
        })
      ).json();
      return client.request('POST', '/auth/platform/mfa', { body: { ticket: step1.ticket, code } });
    };
    const wrong = totpCode(secret, totpStep() + 5);
    for (let i = 0; i < 5; i += 1) expect((await attempt(wrong)).json().code).toBe('MFA_INVALID');
    // Even the right code is refused now: no unlimited guessing with fresh tickets and IPs.
    expect((await attempt(totpCode(secret, totpStep()))).statusCode).toBe(429);
  });
});

describe('POS screen lock', () => {
  it('locks the session server-side until the same user enters the password', async () => {
    const c = await createCompany(app, db, mailer);
    const pos = await c.ownerPos(c.main);
    const api = (method: 'GET' | 'POST', path: string, body?: unknown) =>
      c.client.request(method, path, { cookies: pos, ...(body === undefined ? {} : { body }) });
    expect((await api('GET', '/pos/registers')).statusCode).toBe(200);
    expect((await api('POST', '/auth/pos/lock', {})).statusCode).toBe(204);
    for (const path of ['/auth/pos/me', '/pos/registers']) {
      const r = await api('GET', path);
      expect(r.statusCode).toBe(401);
      expect(r.json().code).toBe('SESSION_LOCKED');
    }
    expect(
      (await api('POST', '/auth/pos/unlock', { password: 'Not-The-Password-1' })).json().code,
    ).toBe('INVALID_CREDENTIALS');
    expect((await api('POST', '/auth/pos/unlock', { password: PASSWORD })).statusCode).toBe(204);
    expect((await api('GET', '/pos/registers')).statusCode).toBe(200);
    // Locking and unlocking are audited.
    const actions = (
      await owner.query(
        `select action from audit_log where merchant_id = $1 and action like 'auth.pos.%' order by occurred_at`,
        [c.merchantId],
      )
    ).rows.map((r) => r.action);
    expect(actions).toEqual(['auth.pos.locked', 'auth.pos.unlocked']);

    // Five wrong passwords end the session: a full sign-in is needed.
    await api('POST', '/auth/pos/lock', {});
    for (let i = 0; i < 4; i += 1)
      expect(
        (await api('POST', '/auth/pos/unlock', { password: `Wrong-${i}-Password` })).json().code,
      ).toBe('INVALID_CREDENTIALS');
    expect(
      (await api('POST', '/auth/pos/unlock', { password: 'Wrong-5-Password' })).json().code,
    ).toBe('UNAUTHENTICATED');
    expect((await api('POST', '/auth/pos/unlock', { password: PASSWORD })).statusCode).toBe(401);
    expect((await api('GET', '/pos/registers')).json().code).toBe('UNAUTHENTICATED');
  });

  it('lets someone else end a locked session', async () => {
    const c = await createCompany(app, db, mailer);
    const pos = await c.ownerPos(c.main);
    await c.client.request('POST', '/auth/pos/lock', { cookies: pos, body: {} });
    expect(
      (await c.client.request('POST', '/auth/pos/lock/sign-out', { cookies: pos, body: {} }))
        .statusCode,
    ).toBe(204);
    expect(
      (
        await c.client.request('POST', '/auth/pos/unlock', {
          cookies: pos,
          body: { password: PASSWORD },
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe('platform database guards', () => {
  it('refuses platform summaries and operator changes to the runtime role', async () => {
    const client = await runtime.connect();
    try {
      for (const q of [
        'select * from platform_merchants(null, null, 10, 0)',
        'select * from platform_overview()',
        'select * from platform_audit(null, null, 10, 0)',
        'select * from platform_plan_counts()',
      ])
        await expect(client.query(q)).rejects.toThrow(/operator context/);
      await expect(
        client.query(
          `insert into platform_operators (id, email, password_hash, full_name, platform_role, mfa_secret_enc)
           values (gen_random_uuid(), 'evil@x.test', 'x', 'Evil', 'platform.super_admin', 'x')`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        client.query(`update platform_operators set platform_role = 'platform.super_admin'`),
      ).rejects.toThrow(/permission denied/);
      // With an operator context the summaries answer.
      await client.query('begin');
      await client.query(`select set_config('app.operator_id', gen_random_uuid()::text, true)`);
      expect((await client.query('select * from platform_overview()')).rows).toHaveLength(1);
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});
