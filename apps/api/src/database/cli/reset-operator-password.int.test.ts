import { hash } from '@node-rs/argon2';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateTotpSecret, totpCode, totpStep } from '../../kernel/crypto/totp.js';
import { ApiClient, PASSWORD, sessionCookie } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { TEST_MFA_KEY, createTestApp, testEnv } from '../../testing/test-app.js';
import { resetOperatorPassword, upsertOperator } from '../../modules/platform-admin/operators.js';

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

const db = () => drizzle({ client: owner, casing: 'snake_case' });
/** `stepOffset`: a code already used is refused (replay protection), so later sign-ins use the next one. */
async function signIn(email: string, password: string, secret: string, stepOffset = 0) {
  const api = new ApiClient(app);
  const step1 = await api.request('POST', '/auth/platform/login', { body: { email, password } });
  if (step1.statusCode !== 200) return { status: step1.statusCode, cookies: null };
  const done = await api.request('POST', '/auth/platform/mfa', {
    body: { ticket: step1.json().ticket, code: totpCode(secret, totpStep() + stepOffset) },
  });
  return {
    status: done.statusCode,
    cookies: done.statusCode === 200 ? sessionCookie(done, 'platform') : null,
  };
}

describe('operator password reset (CLI)', () => {
  it('replaces only the password: the same authenticator still works, old sessions end', async () => {
    const email = 'reset.me@example.com';
    const secret = generateTotpSecret();
    await db().transaction(async (tx) =>
      upsertOperator(tx as never, {
        email,
        fullName: 'Owner',
        role: 'platform.super_admin',
        passwordHash: await hash(PASSWORD, { algorithm: 2 }),
        encryptionKey: TEST_MFA_KEY,
        totpSecret: secret,
      }),
    );
    const before = await signIn(email, PASSWORD, secret);
    expect(before.status).toBe(200);
    const mfaBefore = (
      await owner.query('select mfa_secret_enc from platform_operators where email = $1', [email])
    ).rows[0].mfa_secret_enc;

    const newPassword = 'Brand-New-Password-7';
    const result = await db().transaction(async (tx) =>
      resetOperatorPassword(tx as never, {
        email: ' Reset.Me@Example.com ',
        passwordHash: await hash(newPassword, { algorithm: 2 }),
      }),
    );
    expect(result).not.toBeNull();

    // The old session is ended; the old password no longer works; the authenticator is the same.
    const me = await new ApiClient(app).request('GET', '/auth/platform/me', {
      cookies: before.cookies!,
    });
    expect(me.statusCode).toBe(401);
    expect((await signIn(email, PASSWORD, secret)).status).toBe(401);
    expect((await signIn(email, newPassword, secret, 1)).status).toBe(200);
    const row = (
      await owner.query(
        'select mfa_secret_enc, platform_role, status from platform_operators where email = $1',
        [email],
      )
    ).rows[0];
    expect(row).toEqual({
      mfa_secret_enc: mfaBefore,
      platform_role: 'platform.super_admin',
      status: 'active',
    });
    const audit = await owner.query(
      `select action, details from audit_log where target_id = $1 and action = 'platform.operator.password_reset'`,
      [result!.id],
    );
    expect(audit.rows).toEqual([
      { action: 'platform.operator.password_reset', details: { via: 'cli', mfaKept: true } },
    ]);
  });

  it('changes nothing for an unknown e-mail', async () => {
    const result = await db().transaction((tx) =>
      resetOperatorPassword(tx as never, { email: 'nobody@example.com', passwordHash: 'x' }),
    );
    expect(result).toBeNull();
  });
});
