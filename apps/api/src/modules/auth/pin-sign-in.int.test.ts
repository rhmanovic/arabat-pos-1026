import { hash } from '@node-rs/argon2';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PIN_HASH_OPTIONS } from '../../kernel/crypto/pin.js';
import { DbFixtures, createCompany, sessionCookie } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

let app: NestFastifyApplication;
let owner: pg.Pool;
let db: DbFixtures;
let mailer: InMemoryMailer;

beforeAll(async () => {
  const prepared = await prepareIntegrationDatabase();
  owner = prepared.owner;
  db = new DbFixtures(owner);
  mailer = new InMemoryMailer();
  app = await createTestApp({ env: testEnv({ DATABASE_URL: prepared.runtimeUrl }), mailer });
});
afterAll(async () => {
  await app?.close();
  await owner?.end();
});

type Co = Awaited<ReturnType<typeof createCompany>>;
const PIN = '482913';

async function membershipOf(c: Co, email: string) {
  const r = await owner.query(
    `select m.id from memberships m join users u on u.id = m.user_id where u.email = $1 and m.merchant_id = $2`,
    [email, c.merchantId],
  );
  return r.rows[0].id as string;
}
/** The PIN the person chose through the e-mailed link (same argon2id hash as the tills). */
async function setPin(membershipId: string, pin: string) {
  const pinHash = await hash(pin, PIN_HASH_OPTIONS);
  await owner.query(`update memberships set pin_hash = $1, pin_set_at = now() where id = $2`, [
    pinHash,
    membershipId,
  ]);
}
async function link(c: Co, branchId: string) {
  const res = await c.client.request('POST', `/manager/pin-links/${branchId}`, {
    cookies: c.cookies,
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { key: string; url: string };
}
const branchOf = (c: Co, key: string) =>
  c.client.request('POST', '/auth/pos/pin-sign-in/branch', { body: { key } });
const signIn = (c: Co, key: string, membershipId: string, pin: string) =>
  c.client.request('POST', '/auth/pos/pin-sign-in', { body: { key, membershipId, pin } });

describe('browser POS sign-in with name + PIN (Plan A)', () => {
  it('lists the branch’s POS people behind a manager’s link and opens a POS session with the PIN', async () => {
    const c = await createCompany(app, db, mailer);
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const elsewhere = await c.hire([{ roleId: c.roles.cashier, branchId: c.second }], 'pos');
    const cashierId = await membershipOf(c, cashier.email);
    await setPin(cashierId, PIN);
    const { key, url } = await link(c, c.main);
    expect(url).toMatch(/\/pos\/pin-sign-in#[A-Za-z0-9_-]{43}$/);
    expect(
      (await c.client.request('GET', '/manager/pin-links', { cookies: c.cookies })).json(),
    ).toMatchObject({ branches: expect.arrayContaining([{ branchId: c.main, active: true }]) });

    const branch = (await branchOf(c, key)).json();
    expect(branch.branch).toMatchObject({ id: c.main, code: 'MAIN' });
    const ids = branch.staff.map((s: { membershipId: string }) => s.membershipId);
    expect(ids).toContain(cashierId);
    expect(ids).not.toContain(await membershipOf(c, elsewhere.email));
    expect(
      branch.staff.find((s: { membershipId: string }) => s.membershipId === cashierId),
    ).toEqual({ membershipId: cashierId, fullName: 'Employee', hasPin: true });
    expect(JSON.stringify(branch)).not.toContain('$argon2');

    const res = await signIn(c, key, cashierId, PIN);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'authenticated', interface: 'pos' });
    const me = await c.client.request('GET', '/auth/pos/me', {
      cookies: sessionCookie(res, 'pos'),
    });
    expect(me.json()).toMatchObject({ branch: { id: c.main } });
    const audit = await owner.query(
      `select action from audit_log where merchant_id = $1 and action like 'auth.pin_login%'`,
      [c.merchantId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['auth.pin_login.succeeded']);
  });

  it('locks a person after 3 wrong PINs, refuses people without a PIN and old or unknown links', async () => {
    const c = await createCompany(app, db, mailer);
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const noPin = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const cashierId = await membershipOf(c, cashier.email);
    await setPin(cashierId, PIN);
    const { key } = await link(c, c.main);

    for (let i = 0; i < 3; i++) {
      const wrong = await signIn(c, key, cashierId, '000000');
      expect(wrong.statusCode).toBe(401);
      expect(wrong.json().code).toBe('INVALID_CREDENTIALS');
    }
    // Locked now, even with the right PIN.
    const locked = await signIn(c, key, cashierId, PIN);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().code).toBe('RATE_LIMITED');

    const unset = await signIn(c, key, await membershipOf(c, noPin.email), PIN);
    expect(unset.json().code).toBe('PIN_NOT_SET');
    // Someone of another company, or of another branch, is not found behind this link.
    const other = await createCompany(app, db, mailer);
    const otherOwner = await membershipOf(other, other.email);
    expect((await signIn(c, key, otherOwner, PIN)).statusCode).toBe(401);

    // A new link replaces the old one; a removed link stops working.
    const fresh = await link(c, c.main);
    expect((await branchOf(c, key)).json().code).toBe('PIN_LINK_INVALID');
    expect((await branchOf(c, fresh.key)).statusCode).toBe(200);
    await c.client.request('DELETE', `/manager/pin-links/${c.main}`, { cookies: c.cookies });
    expect((await branchOf(c, fresh.key)).statusCode).toBe(404);
  });
});
