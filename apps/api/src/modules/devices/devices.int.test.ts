import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbFixtures, PASSWORD, createCompany } from '../../testing/auth-fixtures.js';
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
  app = await createTestApp({
    env: testEnv({ DATABASE_URL: prepared.runtimeUrl, DATABASE_POOL_MAX: '20' }),
    mailer,
  });
});
afterAll(async () => {
  await app?.close();
  await owner?.end();
});

type Co = Awaited<ReturnType<typeof createCompany>>;

/** Registers a device at a branch with the owner's credentials; returns the 200 body. */
async function registerDevice(c: Co, branchId: string, name = 'Till Mac') {
  const res = await c.client.request('POST', '/device/register', {
    body: { email: c.email, password: PASSWORD, deviceName: name, branchId },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.status).toBe('registered');
  return body as {
    token: string;
    device: { id: string; registerId: string; registerCode: string; branchCode: string };
  };
}

const me = (c: Co, token: string | null) =>
  c.client.request('GET', '/device/me', {
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
  });

describe('device registration', () => {
  it('lists the branches first, then registers a device as a new register with a token', async () => {
    const c = await createCompany(app, db, mailer);
    const choose = await c.client.request('POST', '/device/register', {
      body: { email: c.email, password: PASSWORD, deviceName: 'Till Mac' },
    });
    expect(choose.statusCode).toBe(200);
    expect(choose.json()).toMatchObject({
      status: 'select_branch',
      merchants: [
        {
          id: c.merchantId,
          branches: expect.arrayContaining([expect.objectContaining({ id: c.main, code: 'MAIN' })]),
        },
      ],
    });

    const { token, device } = await registerDevice(c, c.main);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(device).toMatchObject({
      branchCode: 'MAIN',
      registerCode: expect.stringMatching(/^R\d+$/),
    });
    const stored = await owner.query(
      `select encode(token_hash, 'hex') as hash from pos_devices where id = $1`,
      [device.id],
    );
    expect(stored.rows[0].hash).not.toContain(token);
    // Its own register, with a cash drawer account.
    const reg = await owner.query(
      `select r.code, (select count(*)::int from financial_accounts a where a.register_id = r.id) as accounts
       from registers r where r.id = $1`,
      [device.registerId],
    );
    expect(reg.rows[0]).toEqual({ code: device.registerCode, accounts: 1 });

    const who = await me(c, token);
    expect(who.statusCode).toBe(200);
    expect(who.json()).toMatchObject({ id: device.id, registerCode: device.registerCode });
    const audit = await owner.query(`select action from audit_log where target_id = $1`, [
      device.id,
    ]);
    expect(audit.rows.map((r) => r.action)).toEqual(['device.registered']);
  });

  it('never reuses a register code, skipping codes manual registers use', async () => {
    const c = await createCompany(app, db, mailer);
    const first = await registerDevice(c, c.main, 'A');
    const n = Number(first.device.registerCode.slice(1));
    // A manager creates a register by hand with the next code.
    const manual = await c.client.request('POST', '/manager/registers', {
      cookies: c.cookies,
      body: {
        branchId: c.main,
        code: `R${n + 1}`,
        nameEn: 'Manual',
        nameAr: null,
        accessMode: 'branch',
        memberIds: [],
        defaultOpeningFloat: '0',
        discrepancyTolerance: '0',
      },
    });
    expect(manual.statusCode).toBe(201);
    const second = await registerDevice(c, c.main, 'B');
    expect(second.device.registerCode).toBe(`R${n + 2}`);
    // Revoking and registering again gives yet another code.
    await c.client.request('POST', `/manager/devices/${second.device.id}/revoke`, {
      cookies: c.cookies,
    });
    const third = await registerDevice(c, c.main, 'B');
    expect(third.device.registerCode).toBe(`R${n + 3}`);
    // Codes are per branch: the second branch counts from its own registers.
    const existing = await owner.query(`select code from registers where branch_id = $1`, [
      c.second,
    ]);
    const other = await registerDevice(c, c.second, 'C');
    expect(other.device.branchCode).toBe('B2');
    expect(existing.rows.map((r) => r.code)).not.toContain(other.device.registerCode);
    expect(Number(other.device.registerCode.slice(1))).toBeLessThan(n + 3);
  });

  it('refuses wrong passwords and people without registers.manage', async () => {
    const c = await createCompany(app, db, mailer);
    const wrong = await c.client.request('POST', '/device/register', {
      body: { email: c.email, password: 'wrong-password', deviceName: 'X', branchId: c.main },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().code).toBe('INVALID_CREDENTIALS');
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const denied = await c.client.request('POST', '/device/register', {
      body: { email: cashier.email, password: PASSWORD, deviceName: 'X', branchId: c.main },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('answers 401 without or with a wrong token, and DEVICE_REVOKED after removal', async () => {
    const c = await createCompany(app, db, mailer);
    const { token, device } = await registerDevice(c, c.main);
    expect((await me(c, null)).statusCode).toBe(401);
    expect((await me(c, 'A'.repeat(43))).statusCode).toBe(401);
    expect((await me(c, token)).statusCode).toBe(200);

    const list = await c.client.request('GET', '/manager/devices', { cookies: c.cookies });
    expect(list.json().devices).toEqual([
      expect.objectContaining({ id: device.id, online: true, revokedAt: null }),
    ]);
    const revoke = await c.client.request('POST', `/manager/devices/${device.id}/revoke`, {
      cookies: c.cookies,
    });
    expect(revoke.statusCode).toBe(204);
    const gone = await me(c, token);
    expect(gone.statusCode).toBe(401);
    expect(gone.json().code).toBe('DEVICE_REVOKED');
    expect(
      (await c.client.request('GET', '/manager/devices', { cookies: c.cookies })).json().devices[0],
    ).toMatchObject({ revokedAt: expect.any(String), online: false });
  });

  it('keeps a device register out of the browser till', async () => {
    const c = await createCompany(app, db, mailer);
    const { device } = await registerDevice(c, c.main);
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const regs = (
      await c.client.request('GET', '/pos/registers', { cookies: cashier.cookies })
    ).json();
    const ids = (Array.isArray(regs) ? regs : regs.registers).map((r: { id: string }) => r.id);
    expect(ids).not.toContain(device.registerId);
    const open = await c.client.request('POST', '/pos/shifts', {
      cookies: cashier.cookies,
      body: { registerId: device.registerId, countedCash: '0.000', expectedCash: '0.000' },
    });
    expect(open.statusCode).toBeGreaterThanOrEqual(400);
  });
});

describe('cashier PINs', () => {
  const setPin = (c: Co, membershipId: string, pin: string, cookies = c.cookies) =>
    c.client.request('PUT', `/manager/employees/${membershipId}/pin`, { cookies, body: { pin } });

  async function membershipOf(c: Co, email: string) {
    const r = await owner.query(
      `select m.id from memberships m join users u on u.id = m.user_id where u.email = $1 and m.merchant_id = $2`,
      [email, c.merchantId],
    );
    return r.rows[0].id as string;
  }

  it('stores only an argon2id hash (64 MiB, 3 passes) and shows when it was set', async () => {
    const c = await createCompany(app, db, mailer);
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const id = await membershipOf(c, cashier.email);
    const res = await setPin(c, id, '482913');
    expect(res.statusCode).toBe(204);
    const row = await owner.query(`select pin_hash, pin_set_at from memberships where id = $1`, [
      id,
    ]);
    expect(row.rows[0].pin_hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(row.rows[0].pin_hash).not.toContain('482913');
    const employee = (
      await c.client.request('GET', `/manager/employees/${id}`, { cookies: c.cookies })
    ).json();
    expect(employee.pinSetAt).toEqual(expect.any(String));
    expect(JSON.stringify(employee)).not.toContain('argon2');
    const audit = await owner.query(
      `select details from audit_log where action = 'employee.pin_set' and target_id = $1`,
      [id],
    );
    expect(JSON.stringify(audit.rows)).not.toContain('482913');
  });

  it('refuses short, repeated and straight-run PINs', async () => {
    const c = await createCompany(app, db, mailer);
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const id = await membershipOf(c, cashier.email);
    for (const pin of ['12345', '111111', '123456', '987654', '12a456'])
      expect((await setPin(c, id, pin)).statusCode).toBe(400);
  });

  it('lets only managers within their authority set other people’s PINs, anyone their own', async () => {
    const c = await createCompany(app, db, mailer);
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const cashierId = await membershipOf(c, cashier.email);
    const manager = await c.hire([{ roleId: c.roles.company_manager, branchId: null }], 'manager');
    const managerId = await membershipOf(c, manager.email);
    // A manager sets the cashier's PIN (within their authority, as for any employee change)
    // and their own; a cashier cannot set anyone else's.
    // Same anti-escalation rule as any employee change: the cashier template holds rights a
    // company manager lacks, so the owner sets it.
    expect((await setPin(c, cashierId, '582014', manager.cookies)).statusCode).toBe(403);
    expect((await setPin(c, cashierId, '582014')).statusCode).toBe(204);
    expect((await setPin(c, managerId, '730291', manager.cookies)).statusCode).toBe(204);
    const cashierManager = await c.client.request('PUT', `/manager/employees/${managerId}/pin`, {
      cookies: cashier.cookies,
      body: { pin: '730291' },
    });
    expect(cashierManager.statusCode).toBe(401);
    // Nobody below the owner sets the owner's PIN.
    const ownerId = await membershipOf(c, c.email);
    expect((await setPin(c, ownerId, '730291', manager.cookies)).statusCode).toBeGreaterThanOrEqual(
      403,
    );
  });
});
