import { hash } from '@node-rs/argon2';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SecretBox } from '../../kernel/crypto/secret-box.js';
import { totpCode, totpStep } from '../../kernel/crypto/totp.js';
import { hashToken } from '../../kernel/crypto/tokens.js';
import { Mailer } from '../../kernel/mail/mailer.js';
import {
  ApiClient,
  DbFixtures,
  PASSWORD,
  registerOwner,
  sessionCookie,
  uniqueEmail,
} from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, TEST_MFA_KEY, createTestApp, testEnv } from '../../testing/test-app.js';
import { upsertOperator } from '../platform-admin/operators.js';
import { PasswordResetService } from './password-reset.service.js';

let app: NestFastifyApplication;
let owner: pg.Pool;
let db: DbFixtures;
let mailer: InMemoryMailer;
let passwordHash: string;

beforeAll(async () => {
  const prepared = await prepareIntegrationDatabase();
  owner = prepared.owner;
  db = new DbFixtures(owner);
  mailer = new InMemoryMailer();
  app = await createTestApp({ env: testEnv({ DATABASE_URL: prepared.runtimeUrl }), mailer });
  passwordHash = await hash(PASSWORD, { algorithm: 2 });
});

afterAll(async () => {
  await app?.close();
  await owner?.end();
});

const api = () => new ApiClient(app);

async function login(
  client: ApiClient,
  iface: 'manager' | 'pos',
  email: string,
  password = PASSWORD,
) {
  return client.request('POST', '/auth/login', { body: { interface: iface, email, password } });
}

describe('owner registration', () => {
  it('creates the merchant, main branch, owner membership, role templates and a manager session', async () => {
    const client = api();
    const email = uniqueEmail('Owner.Case');
    const res = await client.request('POST', '/auth/register', {
      body: {
        company: { nameAr: 'شركة الخليج', legalName: 'Gulf Trading Co. W.L.L.' },
        owner: { fullName: 'Fatima Owner', email: email.toUpperCase(), password: PASSWORD },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      status: 'authenticated',
      interface: 'manager',
      redirectTo: '/manager/',
    });

    const cookie = res.cookies.find((c) => c.name === 'mgr_sid')!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/api/v1' });

    const me = (
      await client.request('GET', '/auth/manager/me', { cookies: { mgr_sid: cookie.value } })
    ).json();
    expect(me).toMatchObject({
      interface: 'manager',
      realm: 'merchant',
      isOwner: true,
      actor: { email: email.toLowerCase(), fullName: 'Fatima Owner' },
      merchant: { nameAr: 'شركة الخليج', status: 'active' },
      availableInterfaces: ['manager', 'pos'],
      merchantCount: 1,
    });

    const merchantId = me.merchant.id;
    const rows = await db.inMerchant(merchantId, async (c) => ({
      merchant: (await c.query('select legal_name, default_currency, status from merchants')).rows,
      branches: (await c.query('select code, is_main from branches')).rows,
      memberships: (await c.query('select is_owner, status from memberships')).rows,
      roles: (await c.query('select template_key from roles order by template_key')).rows.map(
        (r) => r.template_key,
      ),
      audit: (await c.query(`select action from audit_log where action = 'merchant.registered'`))
        .rowCount,
    }));
    expect(rows).toEqual({
      merchant: [
        { legal_name: 'Gulf Trading Co. W.L.L.', default_currency: 'KWD', status: 'active' },
      ],
      branches: [{ code: 'MAIN', is_main: true }],
      memberships: [{ is_owner: true, status: 'active' }],
      roles: ['cashier', 'manager'],
      audit: 1,
    });
  });

  it('never stores the password or the session token in plain text', async () => {
    const client = api();
    const { email, cookies } = await registerOwner(client);
    const user = (await owner.query('select password_hash from users where email = $1', [email]))
      .rows[0];
    expect(user.password_hash).toMatch(/^\$argon2id\$/);
    expect(user.password_hash).not.toContain(PASSWORD);
    const stored = await owner.query(
      'select count(*)::int as n from sessions where token_hash = $1',
      [hashToken(cookies.mgr_sid!)],
    );
    expect(stored.rows[0].n).toBe(1);
    const plain = await owner.query(
      `select count(*)::int as n from sessions where encode(token_hash, 'escape') = $1`,
      [cookies.mgr_sid],
    );
    expect(plain.rows[0].n).toBe(0);
  });

  it('rejects an e-mail that is already registered (case-insensitive)', async () => {
    const client = api();
    const { email } = await registerOwner(client);
    const res = await client.request('POST', '/auth/register', {
      body: {
        company: { nameEn: 'Other' },
        owner: { fullName: 'X Y', email: email.toUpperCase(), password: PASSWORD },
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('validates the password policy and the company name', async () => {
    const res = await api().request('POST', '/auth/register', {
      body: { company: {}, owner: { fullName: 'A B', email: uniqueEmail('v'), password: 'short' } },
    });
    expect(res.statusCode).toBe(400);
    const paths = res.json().issues.map((i: { path: string }) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['company.nameAr', 'owner.password']));
  });
});

describe('sign-in', () => {
  it('signs the owner in to /manager with an explicit merchant context', async () => {
    const client = api();
    const { email, merchantId } = await registerOwner(client);
    const res = await login(client, 'manager', email);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'authenticated', interface: 'manager' });
    const me = (
      await client.request('GET', '/auth/manager/me', { cookies: sessionCookie(res, 'manager') })
    ).json();
    expect(me.merchant.id).toBe(merchantId);
  });

  it('gives the same answer for an unknown e-mail and a wrong password', async () => {
    const client = api();
    const { email } = await registerOwner(client);
    const wrong = await login(client, 'manager', email, 'Wrong-Password-1');
    const unknown = await login(client, 'manager', uniqueEmail('ghost'), 'Wrong-Password-1');
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    const strip = (body: Record<string, unknown>) => ({ ...body, requestId: undefined });
    expect(strip(wrong.json())).toEqual(strip(unknown.json()));
    expect(wrong.json().code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects disabled accounts only after the password is proven', async () => {
    const client = api();
    const { email } = await registerOwner(client);
    await owner.query(`update users set status = 'disabled' where email = $1`, [email]);
    expect((await login(client, 'manager', email, 'Wrong-Password-1')).json().code).toBe(
      'INVALID_CREDENTIALS',
    );
    const res = await login(client, 'manager', email);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('ACCOUNT_DISABLED');
  });

  it('routes a cashier to /pos and refuses /manager (BR-013)', async () => {
    const client = api();
    const { merchantId } = await registerOwner(client);
    const branchId = await db.mainBranch(merchantId);
    const cashier = await db.addEmployee(merchantId, { role: 'cashier', branchId, passwordHash });

    const manager = await login(client, 'manager', cashier.email);
    expect(manager.statusCode).toBe(403);
    expect(manager.json()).toMatchObject({
      code: 'INTERFACE_NOT_PERMITTED',
      availableInterfaces: ['pos'],
    });

    const pos = await login(client, 'pos', cashier.email);
    expect(pos.json()).toMatchObject({
      status: 'authenticated',
      interface: 'pos',
      redirectTo: '/pos/',
    });
    const me = (
      await client.request('GET', '/auth/pos/me', { cookies: sessionCookie(pos, 'pos') })
    ).json();
    expect(me).toMatchObject({
      isOwner: false,
      branch: { id: branchId },
      availableInterfaces: ['pos'],
    });
    expect(me.permissions).toEqual(['pos.access']);
  });

  it('does not let a manager use the POS until POS access is granted explicitly (BR-014)', async () => {
    const client = api();
    const { merchantId } = await registerOwner(client);
    const branchId = await db.mainBranch(merchantId);
    const manager = await db.addEmployee(merchantId, {
      role: 'manager',
      branchId: null,
      passwordHash,
    });

    expect((await login(client, 'manager', manager.email)).json().status).toBe('authenticated');
    const refused = await login(client, 'pos', manager.email);
    expect(refused.json()).toMatchObject({
      code: 'INTERFACE_NOT_PERMITTED',
      availableInterfaces: ['manager'],
    });

    await db.grantRole(merchantId, manager.membershipId, 'cashier', branchId);
    expect((await login(client, 'pos', manager.email)).json().status).toBe('authenticated');
  });

  it('asks a user with several merchants to choose one, then binds the session to it', async () => {
    const client = api();
    const a = await registerOwner(client, { nameAr: 'أ' });
    const b = await registerOwner(client, { nameAr: 'ب' });
    const shared = await db.addEmployee(a.merchantId, { role: 'manager', passwordHash });
    await db.addEmployee(b.merchantId, { role: 'manager', userId: shared.userId, passwordHash });

    const first = (await login(client, 'manager', shared.email)).json();
    expect(first.status).toBe('select_merchant');
    expect(first.merchants.map((m: { id: string }) => m.id).sort()).toEqual(
      [a.merchantId, b.merchantId].sort(),
    );

    const stranger = await registerOwner(client);
    const forbidden = await client.request('POST', '/auth/login/select', {
      body: { ticket: first.ticket, merchantId: stranger.merchantId },
    });
    expect(forbidden.statusCode).toBe(403);

    const chosen = await client.request('POST', '/auth/login/select', {
      body: { ticket: first.ticket, merchantId: b.merchantId },
    });
    expect(chosen.json().status).toBe('authenticated');
    const me = (
      await client.request('GET', '/auth/manager/me', { cookies: sessionCookie(chosen, 'manager') })
    ).json();
    expect(me).toMatchObject({ merchant: { id: b.merchantId }, merchantCount: 2 });

    const reused = await client.request('POST', '/auth/login/select', {
      body: { ticket: first.ticket, merchantId: a.merchantId },
    });
    expect(reused.statusCode).toBe(401);
    expect(reused.json().code).toBe('TICKET_INVALID');
  });

  it('asks a cashier with several POS branches to pick a branch', async () => {
    const client = api();
    const { merchantId } = await registerOwner(client);
    const main = await db.mainBranch(merchantId);
    const second = await db.addBranch(merchantId, 'B2');
    const cashier = await db.addEmployee(merchantId, {
      role: 'cashier',
      branchId: main,
      passwordHash,
    });
    await db.grantRole(merchantId, cashier.membershipId, 'cashier', second);

    const first = (await login(client, 'pos', cashier.email)).json();
    expect(first.status).toBe('select_merchant');
    expect(first.merchants[0].branches).toHaveLength(2);
    const missingBranch = await client.request('POST', '/auth/login/select', {
      body: { ticket: first.ticket, merchantId },
    });
    expect(missingBranch.statusCode).toBe(403);
    const ok = await client.request('POST', '/auth/login/select', {
      body: { ticket: first.ticket, merchantId, branchId: second },
    });
    const me = (
      await client.request('GET', '/auth/pos/me', { cookies: sessionCookie(ok, 'pos') })
    ).json();
    expect(me.branch.id).toBe(second);
  });
});

describe('sessions', () => {
  it('rejects protected APIs without a session or with a forged token', async () => {
    const client = api();
    for (const url of [
      '/auth/manager/me',
      '/auth/pos/me',
      '/auth/platform/me',
      '/manager/merchant',
      '/manager/branches',
    ]) {
      expect((await client.request('GET', url)).statusCode, url).toBe(401);
      expect(
        (
          await client.request('GET', url, {
            cookies: { mgr_sid: 'x'.repeat(43), pos_sid: 'y'.repeat(43) },
          })
        ).statusCode,
      ).toBe(401);
    }
  });

  it('logout revokes the session on the server', async () => {
    const client = api();
    const { cookies } = await registerOwner(client);
    expect((await client.request('POST', '/auth/manager/logout', { cookies })).statusCode).toBe(
      204,
    );
    expect((await client.request('GET', '/auth/manager/me', { cookies })).statusCode).toBe(401);
  });

  it('does not accept a session of one interface on another interface', async () => {
    const client = api();
    const { cookies } = await registerOwner(client);
    const asPos = { pos_sid: cookies.mgr_sid! };
    expect((await client.request('GET', '/auth/pos/me', { cookies: asPos })).statusCode).toBe(401);
    expect(
      (
        await client.request('GET', '/auth/platform/me', {
          cookies: { plat_sid: cookies.mgr_sid! },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('expires idle and absolute sessions', async () => {
    const client = api();
    const { cookies, userId } = await registerOwner(client);
    await owner.query(
      `update sessions set idle_expires_at = now() - interval '1 second' where user_id = $1`,
      [userId],
    );
    expect((await client.request('GET', '/auth/manager/me', { cookies })).statusCode).toBe(401);

    const again = sessionCookie(
      await login(
        client,
        'manager',
        (await owner.query('select email from users where id = $1', [userId])).rows[0].email,
      ),
      'manager',
    );
    await owner.query(
      `update sessions set expires_at = now() - interval '1 second' where user_id = $1 and revoked_at is null`,
      [userId],
    );
    expect((await client.request('GET', '/auth/manager/me', { cookies: again })).statusCode).toBe(
      401,
    );
  });

  it('ends sessions immediately when the membership is deactivated or the merchant suspended', async () => {
    const client = api();
    const { merchantId } = await registerOwner(client);
    const manager = await db.addEmployee(merchantId, { role: 'manager', passwordHash });
    const cookies = sessionCookie(await login(client, 'manager', manager.email), 'manager');
    expect((await client.request('GET', '/auth/manager/me', { cookies })).statusCode).toBe(200);
    await db.inMerchant(merchantId, (c) =>
      c.query(`update memberships set status = 'inactive' where id = $1`, [manager.membershipId]),
    );
    expect((await client.request('GET', '/auth/manager/me', { cookies })).statusCode).toBe(401);

    const other = await registerOwner(client);
    await db.inMerchant(other.merchantId, (c) =>
      c.query(`update merchants set status = 'suspended'`),
    );
    expect(
      (await client.request('GET', '/auth/manager/me', { cookies: other.cookies })).statusCode,
    ).toBe(401);
    expect((await login(client, 'manager', other.email)).json().code).toBe('NO_MERCHANT_ACCESS');
  });

  it('switches from /manager to /pos only when authorized', async () => {
    const client = api();
    const { cookies, merchantId } = await registerOwner(client);
    const res = await client.request('POST', '/auth/manager/switch-interface', {
      cookies,
      body: { target: 'pos' },
    });
    expect(res.json()).toMatchObject({ status: 'authenticated', interface: 'pos' });
    const posMe = (
      await client.request('GET', '/auth/pos/me', { cookies: sessionCookie(res, 'pos') })
    ).json();
    expect(posMe.branch.id).toBe(await db.mainBranch(merchantId));

    const manager = await db.addEmployee(merchantId, { role: 'manager', passwordHash });
    const managerCookies = sessionCookie(await login(client, 'manager', manager.email), 'manager');
    const refused = await client.request('POST', '/auth/manager/switch-interface', {
      cookies: managerCookies,
      body: { target: 'pos' },
    });
    expect(refused.json().code).toBe('INTERFACE_NOT_PERMITTED');
  });

  it('switches merchant only to merchants the user belongs to, revoking the old session', async () => {
    const client = api();
    const a = await registerOwner(client);
    const b = await registerOwner(client);
    expect(
      (
        await client.request('POST', '/auth/manager/switch-merchant', {
          cookies: a.cookies,
          body: { merchantId: b.merchantId },
        })
      ).statusCode,
    ).toBe(403);

    await db.addEmployee(b.merchantId, { role: 'manager', userId: a.userId, passwordHash });
    const switched = await client.request('POST', '/auth/manager/switch-merchant', {
      cookies: a.cookies,
      body: { merchantId: b.merchantId },
    });
    expect(switched.json().status).toBe('authenticated');
    const me = (
      await client.request('GET', '/auth/manager/me', {
        cookies: sessionCookie(switched, 'manager'),
      })
    ).json();
    expect(me.merchant.id).toBe(b.merchantId);
    expect(
      (await client.request('GET', '/auth/manager/me', { cookies: a.cookies })).statusCode,
    ).toBe(401);
  });
});

describe('password recovery', () => {
  it('answers identically for unknown and known e-mails, and resets with a single-use link', async () => {
    const client = api();
    const { email, cookies } = await registerOwner(client);
    const resets = app.get(PasswordResetService);

    const unknown = await client.request('POST', '/auth/password/forgot', {
      body: { email: uniqueEmail('nobody') },
    });
    const known = await client.request('POST', '/auth/password/forgot', { body: { email } });
    expect(unknown.statusCode).toBe(202);
    expect(known.statusCode).toBe(202);
    expect(unknown.json()).toEqual(known.json());
    await resets.drain();

    const mail = mailer.lastTo(email);
    expect(mail?.subject).toContain('Reset');
    const token = /token=([\w-]+)/.exec(mail!.text)![1]!;

    const newPassword = 'Brand-New-Pass-77';
    const done = await client.request('POST', '/auth/password/reset', {
      body: { token, password: newPassword },
    });
    expect(done.statusCode).toBe(200);
    expect((await client.request('GET', '/auth/manager/me', { cookies })).statusCode).toBe(401);
    expect((await login(client, 'manager', email)).statusCode).toBe(401);
    expect((await login(client, 'manager', email, newPassword)).statusCode).toBe(200);

    const reuse = await client.request('POST', '/auth/password/reset', {
      body: { token, password: 'Another-Pass-88' },
    });
    expect(reuse.json().code).toBe('RESET_TOKEN_INVALID');
  });

  it('rejects expired reset links', async () => {
    const client = api();
    const { email } = await registerOwner(client);
    await client.request('POST', '/auth/password/forgot', { body: { email } });
    await app.get(PasswordResetService).drain();
    const token = /token=([\w-]+)/.exec(mailer.lastTo(email)!.text)![1]!;
    await owner.query(
      `update password_reset_tokens set expires_at = now() - interval '1 second' where token_hash = $1`,
      [hashToken(token)],
    );
    const res = await client.request('POST', '/auth/password/reset', {
      body: { token, password: 'Brand-New-Pass-77' },
    });
    expect(res.json().code).toBe('RESET_TOKEN_INVALID');
  });
});

describe('rate limits', () => {
  it('locks an account after repeated failures, even for the correct password, with Retry-After', async () => {
    const client = api();
    const { email } = await registerOwner(client);
    for (let i = 0; i < 10; i++) {
      const attacker = api();
      expect((await login(attacker, 'manager', email, `Wrong-${i}-password`)).statusCode).toBe(401);
    }
    const blocked = await login(api(), 'manager', email);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('limits sign-in attempts per IP address', async () => {
    const client = api();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++)
      statuses.push(
        (await login(client, 'manager', uniqueEmail('ip'), 'Wrong-password-1')).statusCode,
      );
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

describe('platform operators', () => {
  const operatorEmail = uniqueEmail('operator');
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

  beforeAll(async () => {
    const client = await owner.connect();
    try {
      const { drizzle } = await import('drizzle-orm/node-postgres');
      await drizzle({ client, casing: 'snake_case' }).transaction((tx) =>
        upsertOperator(tx as never, {
          email: operatorEmail,
          fullName: 'Op',
          role: 'platform.super_admin',
          passwordHash,
          encryptionKey: TEST_MFA_KEY,
          totpSecret: secret,
        }),
      );
    } finally {
      client.release();
    }
  });

  it('stores the TOTP secret encrypted', async () => {
    const row = (
      await owner.query('select mfa_secret_enc from platform_operators where email = $1', [
        operatorEmail,
      ])
    ).rows[0];
    expect(row.mfa_secret_enc).not.toContain(secret);
    expect(new SecretBox(TEST_MFA_KEY).decrypt(row.mfa_secret_enc)).toBe(secret);
  });

  it('requires password and a valid, unused TOTP code', async () => {
    const client = api();
    const badPassword = await client.request('POST', '/auth/platform/login', {
      body: { email: operatorEmail, password: 'Wrong-Password-1' },
    });
    expect(badPassword.json().code).toBe('INVALID_CREDENTIALS');

    const step1 = (
      await client.request('POST', '/auth/platform/login', {
        body: { email: operatorEmail, password: PASSWORD },
      })
    ).json();
    expect(step1.status).toBe('mfa_required');
    const wrong = await client.request('POST', '/auth/platform/mfa', {
      body: { ticket: step1.ticket, code: '000000' },
    });
    expect(wrong.json().code).toBe('MFA_INVALID');

    const code = totpCode(secret, totpStep());
    const ok = await client.request('POST', '/auth/platform/mfa', {
      body: { ticket: step1.ticket, code },
    });
    expect(ok.json()).toMatchObject({ status: 'authenticated', interface: 'platform' });
    const cookies = sessionCookie(ok, 'platform');
    const me = (await client.request('GET', '/auth/platform/me', { cookies })).json();
    expect(me).toMatchObject({
      realm: 'platform',
      merchant: null,
      permissions: ['platform.super_admin'],
    });

    // The same code cannot be replayed.
    const again = (
      await client.request('POST', '/auth/platform/login', {
        body: { email: operatorEmail, password: PASSWORD },
      })
    ).json();
    const replay = await client.request('POST', '/auth/platform/mfa', {
      body: { ticket: again.ticket, code },
    });
    expect(replay.json().code).toBe('MFA_INVALID');

    // Realms are separate: the operator cookie does not open merchant APIs.
    expect(
      (
        await client.request('GET', '/manager/merchant', {
          cookies: { mgr_sid: cookies.plat_sid! },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('does not accept merchant sessions on platform endpoints', async () => {
    const client = api();
    const { cookies } = await registerOwner(client);
    expect(
      (
        await client.request('GET', '/auth/platform/me', {
          cookies: { plat_sid: cookies.mgr_sid! },
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe('CSRF origin check', () => {
  it('rejects state-changing requests from another origin', async () => {
    const res = await api().request('POST', '/auth/login', {
      headers: { origin: 'https://evil.example', host: 'localhost' },
      body: { interface: 'manager', email: 'a@b.cd', password: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('ORIGIN_REJECTED');
    const crossSite = await api().request('POST', '/auth/login', {
      headers: { 'sec-fetch-site': 'cross-site' },
      body: { interface: 'manager', email: 'a@b.cd', password: 'x' },
    });
    expect(crossSite.statusCode).toBe(403);
  });
});

void Mailer;
