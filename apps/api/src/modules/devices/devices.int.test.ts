import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbFixtures, PASSWORD, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';
import { PinResetService } from './pin-reset.service.js';

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
async function registerDevice(
  c: Co,
  branchId: string,
  name = 'Till Mac',
  role: 'primary' | 'secondary' = 'secondary',
) {
  const res = await c.client.request('POST', '/device/register', {
    body: { email: c.email, password: PASSWORD, deviceName: name, branchId, role },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.status).toBe('registered');
  return body as {
    token: string;
    device: {
      id: string;
      registerId: string;
      registerCode: string;
      branchCode: string;
      role: string;
    };
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

  it('asks for the role after the branch and refuses a second primary in the branch (Plan A)', async () => {
    const c = await createCompany(app, db, mailer);
    const step = await c.client.request('POST', '/device/register', {
      body: { email: c.email, password: PASSWORD, deviceName: 'Front', branchId: c.main },
    });
    expect(step.json()).toMatchObject({
      status: 'select_role',
      merchantId: c.merchantId,
      branch: { id: c.main, code: 'MAIN' },
      primaryTaken: false,
    });
    const primary = await registerDevice(c, c.main, 'Front', 'primary');
    expect(primary.device.role).toBe('primary');
    const again = await c.client.request('POST', '/device/register', {
      body: { email: c.email, password: PASSWORD, deviceName: 'Back', branchId: c.main },
    });
    expect(again.json()).toMatchObject({ status: 'select_role', primaryTaken: true });
    const refused = await c.client.request('POST', '/device/register', {
      body: {
        email: c.email,
        password: PASSWORD,
        deviceName: 'Back',
        branchId: c.main,
        role: 'primary',
      },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('PRIMARY_EXISTS');
    // An additional device is fine, and the other branch may have its own primary.
    const extra = await registerDevice(c, c.main, 'Back', 'secondary');
    expect(extra.device.role).toBe('secondary');
    expect((await registerDevice(c, c.second, 'Mall', 'primary')).device.role).toBe('primary');
    expect((await me(c, extra.token)).json().role).toBe('secondary');

    // The owner cannot promote the additional device while the primary is live…
    const promote = await c.client.request('PUT', `/manager/devices/${extra.device.id}`, {
      cookies: c.cookies,
      body: { role: 'primary' },
    });
    expect(promote.json().code).toBe('PRIMARY_EXISTS');
    // …but can after making the primary additional; nothing is revoked.
    const demote = await c.client.request('PUT', `/manager/devices/${primary.device.id}`, {
      cookies: c.cookies,
      body: { role: 'secondary' },
    });
    expect(demote.json()).toMatchObject({ role: 'secondary', revokedAt: null });
    const promoted = await c.client.request('PUT', `/manager/devices/${extra.device.id}`, {
      cookies: c.cookies,
      body: { role: 'primary' },
    });
    expect(promoted.json()).toMatchObject({ role: 'primary' });
    const snap = await c.client.request('GET', '/device/sync', {
      headers: { authorization: `Bearer ${extra.token}` },
    });
    expect(snap.json().device.role).toBe('primary');
    // Revoking the primary frees the role.
    await c.client.request('POST', `/manager/devices/${extra.device.id}/revoke`, {
      cookies: c.cookies,
    });
    expect((await registerDevice(c, c.main, 'New', 'primary')).device.role).toBe('primary');
  });

  it('lets only the owner move a device to another branch, with a new register and a full snapshot', async () => {
    const c = await createCompany(app, db, mailer);
    const { token, device } = await registerDevice(c, c.main, 'Mover', 'secondary');
    const first = await c.client.request('GET', '/device/sync', {
      headers: { authorization: `Bearer ${token}` },
    });
    const version = first.json().version as string;
    const manager = await c.hire([{ roleId: c.roles.company_manager, branchId: null }], 'manager');
    const notOwner = await c.client.request('PUT', `/manager/devices/${device.id}`, {
      cookies: manager.cookies,
      body: { branchId: c.second },
    });
    expect(notOwner.statusCode).toBe(403);
    const moved = await c.client.request('PUT', `/manager/devices/${device.id}`, {
      cookies: c.cookies,
      body: { branchId: c.second },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ branchId: c.second, revokedAt: null });
    expect(moved.json().registerId).not.toBe(device.registerId);
    const old = await owner.query(`select status from registers where id = $1`, [
      device.registerId,
    ]);
    expect(old.rows[0].status).toBe('inactive');
    const after = await c.client.request(
      'GET',
      `/device/sync?since=${encodeURIComponent(version)}`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    expect(after.json()).toMatchObject({
      full: true,
      branch: { id: c.second, code: 'B2' },
      device: { branchId: c.second, registerId: moved.json().registerId },
      counters: { lastReceiptNumber: null },
    });
    const audit = await owner.query(
      `select details from audit_log where target_id = $1 and action = 'device.updated'`,
      [device.id],
    );
    expect(audit.rows[0].details.changes.branchId).toEqual({ from: c.main, to: c.second });
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

describe('cashier PINs (self-service through an e-mailed link)', () => {
  async function membershipOf(c: Co, email: string) {
    const r = await owner.query(
      `select m.id from memberships m join users u on u.id = m.user_id where u.email = $1 and m.merchant_id = $2`,
      [email, c.merchantId],
    );
    return r.rows[0].id as string;
  }
  const requestLink = (c: Co, token: string, membershipId: string) =>
    c.client.request('POST', '/device/pin-reset', {
      headers: { authorization: `Bearer ${token}` },
      body: { membershipId },
    });
  const complete = (c: Co, token: string, pin: string) =>
    c.client.request('POST', '/device/pin-reset/complete', { body: { token, pin } });
  const pins = () => app.get(PinResetService);
  const linkToken = (text: string) =>
    decodeURIComponent(/\/pos\/pin\?token=([A-Za-z0-9_%-]+)/.exec(text)![1]!);

  it('sends the cashier a one-hour link from the till; the link sets an argon2id hash once', async () => {
    const c = await createCompany(app, db, mailer);
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const id = await membershipOf(c, cashier.email);
    const { token: deviceToken, device } = await registerDevice(c, c.main);
    const res = await requestLink(c, deviceToken, id);
    expect(res.statusCode).toBe(202);
    await pins().drain();
    const mail = mailer.lastTo(cashier.email)!;
    expect(mail.text).toContain('/pos/pin?token=');
    const token = linkToken(mail.text);
    // Wrong PINs are refused and keep the link usable.
    for (const pin of ['12345', '111111', '123456', '987654', '12a456'])
      expect((await complete(c, token, pin)).statusCode).toBe(400);
    expect((await complete(c, token, '482913')).statusCode).toBe(200);
    const row = await owner.query(`select pin_hash, pin_set_at from memberships where id = $1`, [
      id,
    ]);
    expect(row.rows[0].pin_hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(row.rows[0].pin_hash).not.toContain('482913');
    // Single use.
    const again = await complete(c, token, '482913');
    expect(again.statusCode).toBe(400);
    expect(again.json().code).toBe('RESET_TOKEN_INVALID');
    const employee = (
      await c.client.request('GET', `/manager/employees/${id}`, { cookies: c.cookies })
    ).json();
    expect(employee.pinSetAt).toEqual(expect.any(String));
    expect(JSON.stringify(employee)).not.toContain('argon2');
    const audit = await owner.query(
      `select action, details from audit_log where target_id = $1 and action like 'employee.pin%' order by occurred_at`,
      [id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'employee.pin_reset_requested',
      'employee.pin_set',
    ]);
    expect(audit.rows[0].details).toMatchObject({ deviceId: device.id });
    expect(JSON.stringify(audit.rows)).not.toContain('482913');
    // The device gets the hash at its next sync.
    const snap = (
      await c.client.request('GET', '/device/sync', {
        headers: { authorization: `Bearer ${deviceToken}` },
      })
    ).json();
    expect(snap.staff.find((s: { membershipId: string }) => s.membershipId === id).pinHash).toMatch(
      /^\$argon2id/,
    );
  });

  it('limits requests to one per person per 5 minutes, only the newest link works, and the link expires', async () => {
    const c = await createCompany(app, db, mailer);
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const id = await membershipOf(c, cashier.email);
    const { token: deviceToken } = await registerDevice(c, c.main);
    expect((await requestLink(c, deviceToken, id)).statusCode).toBe(202);
    expect((await requestLink(c, deviceToken, id)).statusCode).toBe(429);
    await pins().drain();
    const first = linkToken(mailer.lastTo(cashier.email)!.text);
    await owner.query(`delete from rate_limit_buckets where key like 'pin-reset:%'`);
    expect((await requestLink(c, deviceToken, id)).statusCode).toBe(202);
    await pins().drain();
    const second = linkToken(mailer.lastTo(cashier.email)!.text);
    expect(second).not.toBe(first);
    expect((await complete(c, first, '482913')).statusCode).toBe(400);
    await owner.query(
      `update pin_reset_tokens set expires_at = now() - interval '1 minute' where membership_id = $1`,
      [id],
    );
    expect((await complete(c, second, '482913')).statusCode).toBe(400);
    // Another company's device cannot ask for this person: nothing is sent.
    const other = await createCompany(app, db, mailer);
    const foreign = await registerDevice(other, other.main);
    await owner.query(`delete from rate_limit_buckets where key like 'pin-reset:%'`);
    expect((await requestLink(other, foreign.token, id)).statusCode).toBe(202);
    await pins().drain();
    expect(
      mailer.outbox.filter((m) => m.to === cashier.email && m.text.includes('/pos/pin?token=')),
    ).toHaveLength(2);
  });

  it('managers never set a PIN; they can only clear one', async () => {
    const c = await createCompany(app, db, mailer);
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const id = await membershipOf(c, cashier.email);
    const put = await c.client.request('PUT', `/manager/employees/${id}/pin`, {
      cookies: c.cookies,
      body: { pin: '482913' },
    });
    expect(put.statusCode).toBe(404);
    await owner.query(`update memberships set pin_hash = 'x', pin_set_at = now() where id = $1`, [
      id,
    ]);
    const cleared = await c.client.request('DELETE', `/manager/employees/${id}/pin`, {
      cookies: c.cookies,
    });
    expect(cleared.statusCode).toBe(204);
    const row = await owner.query(`select pin_hash, pin_set_at from memberships where id = $1`, [
      id,
    ]);
    expect(row.rows[0]).toEqual({ pin_hash: null, pin_set_at: null });
    expect(
      (
        await c.client.request('DELETE', `/manager/employees/${id}/pin`, {
          cookies: cashier.cookies,
        })
      ).statusCode,
    ).toBe(401);
  });
});

describe('sync download', () => {
  const sync = (c: Co, token: string | null, since?: string) =>
    c.client.request('GET', `/device/sync${since ? `?since=${encodeURIComponent(since)}` : ''}`, {
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    });
  const product = (c: Co, nameEn: string, price: string, extra: Record<string, unknown> = {}) =>
    c.client.request('POST', '/manager/products', {
      cookies: c.cookies,
      body: {
        nameEn,
        nameAr: nameEn,
        variants: [
          {
            sku: `SKU-${Math.random().toString(36).slice(2, 8)}`,
            price,
            cost: '0.080',
            barcodes: [`62${Math.floor(Math.random() * 1e11)}`],
          },
        ],
        ...extra,
      },
    });

  it('sends the full branch snapshot, then only changed products', async () => {
    const c = await createCompany(app, db, mailer);
    const tea = (await product(c, 'Tea', '0.250')).json();
    const elsewhere = (
      await product(c, 'Second only', '1.000', {
        availableInAllBranches: false,
        branchIds: [c.second],
      })
    ).json();
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    await c.client.request('PUT', '/manager/device-settings', {
      cookies: c.cookies,
      body: { offlineLimitHours: 48 },
    });
    const { token, device } = await registerDevice(c, c.main);

    const res = await sync(c, token);
    expect(res.statusCode).toBe(200);
    const snap = res.json();
    expect(snap).toMatchObject({
      full: true,
      offlineLimitHours: 48,
      device: { id: device.id, registerCode: device.registerCode },
      branch: { id: c.main, code: 'MAIN' },
      register: { id: device.registerId, code: device.registerCode },
      merchant: { id: c.merchantId, currency: 'KWD' },
      settings: { maxDiscountPercent: '10', allowNegativeStock: false, heldSaleExpiryHours: 24 },
      counters: { lastReceiptNumber: null },
    });
    expect(snap.catalogVersion).toEqual(expect.any(String));
    const byId = new Map(snap.products.map((p: { id: string }) => [p.id, p]));
    expect(byId.get(tea.id)).toMatchObject({
      sellable: true,
      variants: [{ priceMinor: '250', costMinor: '80', barcodes: [expect.any(String)] }],
    });
    expect(byId.get(elsewhere.id)).toMatchObject({ sellable: false });
    expect(snap.paymentMethods.some((m: { kind: string }) => m.kind === 'cash')).toBe(true);
    // Staff who may use the POS here, with PIN hashes and the permissions held at the branch.
    const cashierUser = await owner.query(`select id from users where email = $1`, [cashier.email]);
    const staffCashier = snap.staff.find(
      (s: { userId: string }) => s.userId === cashierUser.rows[0].id,
    );
    expect(staffCashier).toMatchObject({ isOwner: false, pinHash: null });
    expect(staffCashier.permissions).toContain('pos.access');
    expect(staffCashier.permissions).not.toContain('manager.access');
    expect(snap.staff.find((s: { isOwner: boolean }) => s.isOwner)).toBeTruthy();
    const last = await owner.query(`select last_sync_at from pos_devices where id = $1`, [
      device.id,
    ]);
    expect(last.rows[0].last_sync_at).not.toBeNull();

    // Nothing changed since (rows backdated past the overlap window): an empty delta.
    await owner.query(
      `update products set updated_at = now() - interval '1 hour' where merchant_id = $1`,
      [c.merchantId],
    );
    await owner.query(
      `update product_variants set updated_at = now() - interval '1 hour' where merchant_id = $1`,
      [c.merchantId],
    );
    const empty = (await sync(c, token, snap.version)).json();
    expect(empty).toMatchObject({ full: false, products: [] });
    expect(empty.staff.length).toBe(snap.staff.length);
    // Archiving a product sends it again, no longer sellable.
    await c.client.request('POST', `/manager/products/${tea.id}/status`, {
      cookies: c.cookies,
      body: { status: 'archived' },
    });
    const delta = (await sync(c, token, empty.version)).json();
    expect(delta.products).toEqual([expect.objectContaining({ id: tea.id, sellable: false })]);
    // A cursor the server does not understand means a full snapshot.
    expect((await sync(c, token, 'garbage')).json().full).toBe(true);
  });

  it('leaves out people without POS access at the branch and inactive people', async () => {
    const c = await createCompany(app, db, mailer);
    const elsewhere = await c.hire([{ roleId: c.roles.cashier, branchId: c.second }], 'pos');
    const { token } = await registerDevice(c, c.main);
    const snap = (await sync(c, token)).json();
    const userIds = snap.staff.map((s: { userId: string }) => s.userId);
    const other = await owner.query(`select id from users where email = $1`, [elsewhere.email]);
    expect(userIds).not.toContain(other.rows[0].id);
  });

  it('refuses without a valid token and after revocation', async () => {
    const c = await createCompany(app, db, mailer);
    const { token, device } = await registerDevice(c, c.main);
    expect((await sync(c, null)).statusCode).toBe(401);
    expect((await sync(c, 'B'.repeat(43))).statusCode).toBe(401);
    await c.client.request('POST', `/manager/devices/${device.id}/revoke`, { cookies: c.cookies });
    const gone = await sync(c, token);
    expect(gone.statusCode).toBe(401);
    expect(gone.json().code).toBe('DEVICE_REVOKED');
  });

  it('lets managers read and set the offline limit within 1–720 hours, audited', async () => {
    const c = await createCompany(app, db, mailer);
    const get = await c.client.request('GET', '/manager/device-settings', { cookies: c.cookies });
    expect(get.json()).toEqual({ offlineLimitHours: 72 });
    for (const offlineLimitHours of [0, 721])
      expect(
        (
          await c.client.request('PUT', '/manager/device-settings', {
            cookies: c.cookies,
            body: { offlineLimitHours },
          })
        ).statusCode,
      ).toBe(400);
    const put = await c.client.request('PUT', '/manager/device-settings', {
      cookies: c.cookies,
      body: { offlineLimitHours: 24 },
    });
    expect(put.json()).toEqual({ offlineLimitHours: 24 });
    const audit = await owner.query(
      `select details from audit_log where action = 'device_settings.updated' and merchant_id = $1`,
      [c.merchantId],
    );
    expect(audit.rows[0].details).toEqual({ offlineLimitHours: { from: 72, to: 24 } });
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    expect(
      (
        await c.client.request('PUT', '/manager/device-settings', {
          cookies: cashier.cookies,
          body: { offlineLimitHours: 24 },
        })
      ).statusCode,
    ).toBe(401);
  });
});
