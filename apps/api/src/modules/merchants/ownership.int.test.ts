import { hash } from '@node-rs/argon2';
import type { PlatformRole } from '@arabat/permissions';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateTotpSecret, totpCode, totpStep } from '../../kernel/crypto/totp.js';
import {
  ApiClient,
  DbFixtures,
  PASSWORD,
  createCompany,
  sessionCookie,
  uniqueEmail,
} from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, TEST_MFA_KEY, createTestApp, testEnv } from '../../testing/test-app.js';
import { upsertOperator } from '../platform-admin/operators.js';

/** Remediation session 12, R5.2 (BR-020): ownership transfer by the owner or the platform; emergency freeze. */
let app: NestFastifyApplication;
let owner: pg.Pool;
let db: DbFixtures;
let mailer: InMemoryMailer;
let passwordHash: string;
type Cookies = Record<string, string>;

beforeAll(async () => {
  const prepared = await prepareIntegrationDatabase();
  owner = prepared.owner;
  db = new DbFixtures(owner);
  mailer = new InMemoryMailer();
  passwordHash = await hash(PASSWORD);
  app = await createTestApp({
    env: testEnv({ DATABASE_URL: prepared.runtimeUrl, DATABASE_POOL_MAX: '20' }),
    mailer,
  });
});
afterAll(async () => {
  await app?.close();
  await owner?.end();
});

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

type Co = Awaited<ReturnType<typeof createCompany>>;
const req = (
  c: Co,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  cookies: Cookies = c.cookies,
) => c.client.request(method, path, { cookies, ...(body === undefined ? {} : { body }) });

describe('ownership transfer and freeze (R5.2)', () => {
  it('owner names a member with the password, the member confirms with the e-mailed code', async () => {
    const c = await createCompany(app, db, mailer);
    const cm = await c.hire([{ roleId: c.roles.company_manager, branchId: null }], 'manager');
    const cmId = (await req(c, 'GET', '/manager/employees'))
      .json()
      .employees.find((e: { email: string }) => e.email === cm.email).membershipId as string;
    // Only the owner, and only with their password.
    expect(
      (
        await req(
          c,
          'POST',
          '/manager/merchant/ownership-transfers',
          { toMembershipId: cmId, password: PASSWORD },
          cm.cookies,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await req(c, 'POST', '/manager/merchant/ownership-transfers', {
          toMembershipId: cmId,
          password: 'wrong-password-1',
        })
      ).statusCode,
    ).toBe(401);
    const started = await req(c, 'POST', '/manager/merchant/ownership-transfers', {
      toMembershipId: cmId,
      password: PASSWORD,
    });
    expect(started.statusCode, started.body).toBe(202);
    expect(started.json().pendingOwnershipTransfer).toMatchObject({
      toMembershipId: cmId,
      toName: 'Employee',
      forMe: false,
    });
    const mail = [...mailer.outbox].reverse().find((m) => m.to === cm.email)!;
    expect(mail.subject).toMatch(/ownership/);
    const token = mail.text
      .split('\n')
      .find((l) => /^[A-Za-z0-9_-]{20,}$/.test(l.trim()))!
      .trim();
    // The named member sees it as theirs; a wrong code or another member is refused.
    const mine = (await req(c, 'GET', '/manager/merchant', undefined, cm.cookies)).json();
    expect(mine.pendingOwnershipTransfer.forMe).toBe(true);
    expect(
      (
        await req(
          c,
          'POST',
          '/manager/merchant/ownership-transfers/accept',
          { token: 'not-the-token-at-all-0000' },
          cm.cookies,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (await req(c, 'POST', '/manager/merchant/ownership-transfers/accept', { token })).statusCode,
    ).toBe(400);
    const accepted = await req(
      c,
      'POST',
      '/manager/merchant/ownership-transfers/accept',
      { token },
      cm.cookies,
    );
    expect(accepted.statusCode, accepted.body).toBe(200);
    // The new owner holds everything; the old owner's session ended and they are a plain member.
    const me = (await req(c, 'GET', '/auth/manager/me', undefined, cm.cookies)).json();
    expect(me.isOwner).toBe(true);
    expect((await req(c, 'GET', '/auth/manager/me')).statusCode).toBe(401);
    const old = c.client.request('POST', '/auth/login', {
      body: { interface: 'manager', email: c.email, password: PASSWORD },
    });
    expect((await old).statusCode).toBe(403);
    const employees = (await req(c, 'GET', '/manager/employees', undefined, cm.cookies)).json()
      .employees as { email: string; isOwner: boolean }[];
    expect(employees.find((e) => e.email === cm.email)!.isOwner).toBe(true);
    expect(employees.find((e) => e.email === c.email)!.isOwner).toBe(false);
    const audit = (
      await req(c, 'GET', '/manager/audit?action=merchant.ownership', undefined, cm.cookies)
    ).json().entries as { action: string; details: Record<string, unknown> }[];
    expect(audit.map((e) => e.action)).toEqual([
      'merchant.ownership_transferred',
      'merchant.ownership_transfer.started',
    ]);
    expect(audit[0]!.details).toMatchObject({ initiatedBy: 'owner', toMembershipId: cmId });
    expect(mailer.outbox.filter((m) => /ownership/.test(m.subject)).length).toBeGreaterThanOrEqual(
      3,
    );
    expect(
      (await req(c, 'GET', '/manager/merchant', undefined, cm.cookies)).json()
        .pendingOwnershipTransfer,
    ).toBeNull();
  });

  it('the owner can cancel a pending transfer; a second one replaces the first', async () => {
    const c = await createCompany(app, db, mailer);
    const a = await c.hire([{ roleId: c.roles.company_manager, branchId: null }], 'manager');
    const b = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const ids = Object.fromEntries(
      (
        (await req(c, 'GET', '/manager/employees')).json().employees as {
          email: string;
          membershipId: string;
        }[]
      ).map((e) => [e.email, e.membershipId]),
    );
    await req(c, 'POST', '/manager/merchant/ownership-transfers', {
      toMembershipId: ids[a.email],
      password: PASSWORD,
    });
    const second = await req(c, 'POST', '/manager/merchant/ownership-transfers', {
      toMembershipId: ids[b.email],
      password: PASSWORD,
    });
    expect(second.json().pendingOwnershipTransfer.toMembershipId).toBe(ids[b.email]);
    const cancelled = await req(c, 'DELETE', '/manager/merchant/ownership-transfers');
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json().pendingOwnershipTransfer).toBeNull();
    expect((await req(c, 'DELETE', '/manager/merchant/ownership-transfers')).statusCode).toBe(400);
    const rows = await owner.query(
      `select status from ownership_transfers where merchant_id = $1 order by created_at`,
      [c.merchantId],
    );
    expect(rows.rows.map((r) => r.status)).toEqual(['cancelled', 'cancelled']);
  });

  it('the platform can freeze and release the owner and transfer ownership with a reason', async () => {
    const c = await createCompany(app, db, mailer);
    const cm = await c.hire([{ roleId: c.roles.company_manager, branchId: null }], 'manager');
    const cmId = (await req(c, 'GET', '/manager/employees'))
      .json()
      .employees.find((e: { email: string }) => e.email === cm.email).membershipId as string;
    const support = await operator('platform.support');
    const admin = await operator('platform.super_admin');
    const api = new ApiClient(app);
    const detail = (
      await api.request('GET', `/platform/merchants/${c.merchantId}`, { cookies: support })
    ).json();
    expect(detail.ownerFrozenAt).toBeNull();
    expect(detail.members.map((m: { isOwner: boolean }) => m.isOwner)).toEqual([true, false]);
    // Freeze: the owner's session ends, sign-in is refused, employees keep working.
    const frozen = await api.request('POST', `/platform/merchants/${c.merchantId}/owner-freeze`, {
      cookies: support,
      body: { reason: 'Owner reported a stolen phone', version: detail.version },
    });
    expect(frozen.statusCode, frozen.body).toBe(200);
    expect(frozen.json().ownerFrozenReason).toBe('Owner reported a stolen phone');
    expect((await req(c, 'GET', '/auth/manager/me')).statusCode).toBe(401);
    const refused = await c.client.request('POST', '/auth/login', {
      body: { interface: 'manager', email: c.email, password: PASSWORD },
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('OWNER_FROZEN');
    expect((await req(c, 'GET', '/auth/manager/me', undefined, cm.cookies)).statusCode).toBe(200);
    expect(
      (
        await api.request('POST', `/platform/merchants/${c.merchantId}/owner-freeze`, {
          cookies: support,
          body: { reason: 'again', version: frozen.json().version },
        })
      ).statusCode,
    ).toBe(409);
    const released = await api.request(
      'POST',
      `/platform/merchants/${c.merchantId}/owner-release`,
      {
        cookies: support,
        body: { reason: 'Identity verified by phone', version: frozen.json().version },
      },
    );
    expect(released.statusCode, released.body).toBe(200);
    expect(released.json().ownerFrozenAt).toBeNull();
    const back = await c.client.request('POST', '/auth/login', {
      body: { interface: 'manager', email: c.email, password: PASSWORD },
    });
    expect(back.statusCode).toBe(200);
    // Transfer by the platform: super admin only, reason recorded, both notified.
    expect(
      (
        await api.request('POST', `/platform/merchants/${c.merchantId}/ownership-transfer`, {
          cookies: support,
          body: {
            toMembershipId: cmId,
            reason: 'Owner deceased',
            version: released.json().version,
          },
        })
      ).statusCode,
    ).toBe(403);
    const transferred = await api.request(
      'POST',
      `/platform/merchants/${c.merchantId}/ownership-transfer`,
      {
        cookies: admin,
        body: {
          toMembershipId: cmId,
          reason: 'Court order 12/2026',
          version: released.json().version,
        },
      },
    );
    expect(transferred.statusCode, transferred.body).toBe(200);
    expect(transferred.json().owner.email).toBe(cm.email);
    expect((await req(c, 'GET', '/auth/manager/me', undefined, cm.cookies)).json().isOwner).toBe(
      true,
    );
    const audit = (
      await req(c, 'GET', '/manager/audit?action=ownership_transferred', undefined, cm.cookies)
    ).json().entries as { action: string; details: Record<string, unknown> }[];
    expect(audit.map((e) => e.action)).toEqual([
      'platform.merchant.ownership_transferred',
      'merchant.ownership_transferred',
    ]);
    expect(audit[1]!.details).toMatchObject({
      initiatedBy: 'platform',
      reason: 'Court order 12/2026',
    });
    expect(
      mailer.outbox.filter((m) => m.to === c.email && /ownership/.test(m.subject)),
    ).toHaveLength(1);
  });
});
