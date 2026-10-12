import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totpCode, totpStep } from '../../kernel/crypto/totp.js';
import { ApiClient } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { TEST_MFA_KEY, createTestApp, testEnv } from '../../testing/test-app.js';
import { bootstrapFirstOperator } from './bootstrap-operator.js';

let owner: pg.Pool;
let app: NestFastifyApplication;

beforeAll(async () => {
  const prepared = await prepareIntegrationDatabase();
  owner = prepared.owner;
  app = await createTestApp({ env: testEnv({ DATABASE_URL: prepared.runtimeUrl }) });
});

afterAll(async () => {
  await app?.close();
  await owner?.end();
});

const bootstrap = (email: string) =>
  drizzle({ client: owner, casing: 'snake_case' }).transaction((tx) =>
    bootstrapFirstOperator(tx as never, {
      email,
      fullName: 'Platform owner',
      encryptionKey: TEST_MFA_KEY,
    }),
  );

describe('first platform operator bootstrap (hosted start)', () => {
  it('creates one super admin who can sign in, then never runs again', async () => {
    const created = await bootstrap('Owner@Example.com');
    expect(created?.email).toBe('owner@example.com');

    const api = new ApiClient(app);
    const step1 = await api.request('POST', '/auth/platform/login', {
      body: { email: created!.email, password: created!.password },
    });
    expect(step1.statusCode).toBe(200);
    const done = await api.request('POST', '/auth/platform/mfa', {
      body: { ticket: step1.json().ticket, code: totpCode(created!.totpSecret, totpStep()) },
    });
    expect(done.statusCode).toBe(200);

    const { rows } = await owner.query('select email, platform_role from platform_operators');
    expect(rows).toEqual([{ email: 'owner@example.com', platform_role: 'platform.super_admin' }]);

    // An existing operator is never re-keyed, and no second operator is added.
    expect(await bootstrap('owner@example.com')).toBeNull();
    expect(await bootstrap('other@example.com')).toBeNull();
    expect((await owner.query('select count(*)::int as n from platform_operators')).rows[0].n).toBe(
      1,
    );
  });
});
