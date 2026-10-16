import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashToken } from '../../kernel/crypto/tokens.js';
import {
  ApiClient,
  DbFixtures,
  PASSWORD,
  registerOwner,
  sessionCookie,
  uniqueEmail,
} from '../../testing/auth-fixtures.js';
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

type Cookies = Record<string, string>;
const api = () => new ApiClient(app);

async function roleId(client: ApiClient, cookies: Cookies, templateKey: string): Promise<string> {
  const roles = (await client.request('GET', '/manager/roles', { cookies })).json().roles as {
    id: string;
    templateKey: string;
  }[];
  return roles.find((r) => r.templateKey === templateKey)!.id;
}

async function login(
  client: ApiClient,
  iface: 'manager' | 'pos',
  email: string,
  password = PASSWORD,
) {
  return client.request('POST', '/auth/login', { body: { interface: iface, email, password } });
}

function inviteToken(email: string): string {
  const mail = [...mailer.outbox].reverse().find((m) => m.to === email);
  if (!mail) throw new Error(`no invitation e-mail for ${email}`);
  return /token=([\w-]+)/.exec(mail.text)![1]!;
}

async function invite(client: ApiClient, cookies: Cookies, body: Record<string, unknown>) {
  return client.request('POST', '/manager/employees/invitations', { cookies, body });
}

/** Owner + main branch + a second branch, with role ids. */
async function company() {
  const client = api();
  const o = await registerOwner(client);
  const main = await db.mainBranch(o.merchantId);
  const second = (
    await client.request('POST', '/manager/branches', {
      cookies: o.cookies,
      body: { code: 'B2', nameEn: 'Second', nameAr: 'الثاني' },
    })
  ).json().id as string;
  const roles = {
    company_manager: await roleId(client, o.cookies, 'company_manager'),
    branch_manager: await roleId(client, o.cookies, 'branch_manager'),
    supervisor: await roleId(client, o.cookies, 'supervisor'),
    cashier: await roleId(client, o.cookies, 'cashier'),
  };
  return { client, ...o, main, second, roles };
}

/** Invites and accepts; returns the employee's sign-in e-mail. */
async function hire(
  c: Awaited<ReturnType<typeof company>>,
  assignments: { roleId: string; branchId: string | null }[],
  by: Cookies = c.cookies,
) {
  const email = uniqueEmail('emp');
  const res = await invite(c.client, by, { email, fullName: 'New Employee', assignments });
  if (res.statusCode !== 201) throw new Error(`invite failed ${res.statusCode} ${res.body}`);
  const accepted = await c.client.request('POST', '/auth/invitations/accept', {
    body: { token: inviteToken(email), password: PASSWORD },
  });
  if (accepted.statusCode !== 200) throw new Error(`accept failed ${accepted.body}`);
  return email;
}

describe('employee invitations', () => {
  it('lets the owner invite a cashier who sets their own password and signs in to the POS only', async () => {
    const c = await company();
    const email = uniqueEmail('cashier');
    const res = await invite(c.client, c.cookies, {
      email,
      fullName: 'Sara Cashier',
      jobTitle: 'Cashier',
      assignments: [{ roleId: c.roles.cashier, branchId: c.main }],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      email,
      status: 'pending',
      assignments: [{ roleId: c.roles.cashier, branchId: c.main }],
    });
    // The response never contains a token or password.
    expect(res.body).not.toMatch(/token|password/i);

    const token = inviteToken(email);
    // The e-mail sets the password on the POS and gives the register's everyday address.
    const mail = [...mailer.outbox].reverse().find((m) => m.to === email)!;
    expect(mail.text).toMatch(/\/pos\/accept-invite\?token=/);
    expect(mail.text).toContain('نقطة البيع (الكاشير)');
    expect(mail.html).toContain('/pos/accept-invite?token=');
    const preview = (
      await c.client.request('POST', '/auth/invitations/preview', { body: { token } })
    ).json();
    expect(preview).toMatchObject({
      email,
      fullName: 'Sara Cashier',
      existingAccount: false,
      merchant: { nameAr: 'شركة اختبار' },
    });

    const weak = await c.client.request('POST', '/auth/invitations/accept', {
      body: { token, password: 'short' },
    });
    expect(weak.statusCode).toBe(400);
    const accepted = await c.client.request('POST', '/auth/invitations/accept', {
      body: { token, password: PASSWORD },
    });
    expect(accepted.json()).toEqual({ status: 'accepted', availableInterfaces: ['pos'] });

    const reuse = await c.client.request('POST', '/auth/invitations/accept', {
      body: { token, password: PASSWORD },
    });
    expect(reuse.json().code).toBe('INVITATION_INVALID');

    expect((await login(c.client, 'manager', email)).json().code).toBe('INTERFACE_NOT_PERMITTED');
    const pos = await login(c.client, 'pos', email);
    expect(pos.json().status).toBe('authenticated');
    const me = (
      await c.client.request('GET', '/auth/pos/me', { cookies: sessionCookie(pos, 'pos') })
    ).json();
    expect(me.branch.id).toBe(c.main);

    // Cashier sessions cannot reach management APIs.
    const posCookie = sessionCookie(pos, 'pos');
    for (const url of [
      '/manager/employees',
      '/manager/branches',
      '/manager/roles',
      '/manager/merchant',
    ]) {
      expect(
        (await c.client.request('GET', url, { cookies: { mgr_sid: posCookie.pos_sid! } }))
          .statusCode,
        url,
      ).toBe(401);
    }

    const list = (
      await c.client.request('GET', '/manager/employees', { cookies: c.cookies })
    ).json();
    expect(list.employees.find((e: { email: string }) => e.email === email)).toMatchObject({
      status: 'active',
      jobTitle: 'Cashier',
      manageable: true,
    });
    expect(list.invitations.find((i: { email: string }) => i.email === email)).toBeUndefined();
  });

  it('requires an existing account to confirm with its own password', async () => {
    const a = await company();
    const b = await company();
    const res = await invite(b.client, b.cookies, {
      email: a.email,
      fullName: 'Owner A',
      assignments: [{ roleId: b.roles.cashier, branchId: b.main }],
    });
    expect(res.statusCode).toBe(201);
    const token = inviteToken(a.email);
    expect(
      (await b.client.request('POST', '/auth/invitations/preview', { body: { token } })).json()
        .existingAccount,
    ).toBe(true);
    const wrong = await b.client.request('POST', '/auth/invitations/accept', {
      body: { token, password: 'Wrong-Password-9' },
    });
    expect(wrong.json().code).toBe('INVALID_CREDENTIALS');
    const ok = await b.client.request('POST', '/auth/invitations/accept', {
      body: { token, password: PASSWORD },
    });
    expect(ok.json().status).toBe('accepted');
    // A now works in two companies' POS: sign-in asks which one.
    expect((await login(a.client, 'pos', a.email)).json().status).toBe('select_merchant');
  });

  it('rejects expired and revoked invitations and duplicate members', async () => {
    const c = await company();
    const email = uniqueEmail('exp');
    await invite(c.client, c.cookies, {
      email,
      fullName: 'X',
      assignments: [{ roleId: c.roles.cashier, branchId: c.main }],
    });
    const token = inviteToken(email);
    await owner.query(
      `update invitations set expires_at = now() - interval '1 second' where token_hash = $1`,
      [hashToken(token)],
    );
    expect(
      (
        await c.client.request('POST', '/auth/invitations/accept', {
          body: { token, password: PASSWORD },
        })
      ).json().code,
    ).toBe('INVITATION_INVALID');

    const email2 = uniqueEmail('rev');
    const inv = (
      await invite(c.client, c.cookies, {
        email: email2,
        fullName: 'Y',
        assignments: [{ roleId: c.roles.cashier, branchId: c.main }],
      })
    ).json();
    expect(
      (
        await c.client.request('POST', `/manager/employees/invitations/${inv.id}/revoke`, {
          cookies: c.cookies,
          body: {},
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await c.client.request('POST', '/auth/invitations/accept', {
          body: { token: inviteToken(email2), password: PASSWORD },
        })
      ).json().code,
    ).toBe('INVITATION_INVALID');

    const dup = await invite(c.client, c.cookies, {
      email: c.email,
      fullName: 'Me',
      assignments: [{ roleId: c.roles.cashier, branchId: c.main }],
    });
    expect(dup.json().code).toBe('ALREADY_MEMBER');
  });

  it('cannot be accepted without the token: there is no self-join endpoint', async () => {
    const res = await api().request('POST', '/auth/invitations/accept', {
      body: { token: 'x'.repeat(43), password: PASSWORD },
    });
    expect(res.json().code).toBe('INVITATION_INVALID');
  });
});

describe('anti-escalation', () => {
  it('lets a branch manager hire cashiers only at their branch and only with rights they hold', async () => {
    const c = await company();
    // A branch manager at main who is also allowed to sell there (so may grant cashier rights there).
    const bmEmail = await hire(c, [
      { roleId: c.roles.branch_manager, branchId: c.main },
      { roleId: c.roles.cashier, branchId: c.main },
    ]);
    const bm = sessionCookie(await login(c.client, 'manager', bmEmail), 'manager');

    const atMain = await invite(c.client, bm, {
      email: uniqueEmail('c1'),
      fullName: 'C1',
      assignments: [{ roleId: c.roles.cashier, branchId: c.main }],
    });
    expect(atMain.statusCode).toBe(201);

    const atSecond = await invite(c.client, bm, {
      email: uniqueEmail('c2'),
      fullName: 'C2',
      assignments: [{ roleId: c.roles.cashier, branchId: c.second }],
    });
    expect(atSecond.statusCode).toBe(403);
    expect(atSecond.json().code).toBe('PRIVILEGE_ESCALATION');

    const supervisor = await invite(c.client, bm, {
      email: uniqueEmail('s'),
      fullName: 'S',
      assignments: [{ roleId: c.roles.supervisor, branchId: c.main }],
    });
    expect(supervisor.json().code).toBe('PRIVILEGE_ESCALATION');

    const companyWide = await invite(c.client, bm, {
      email: uniqueEmail('cm'),
      fullName: 'CM',
      assignments: [{ roleId: c.roles.company_manager, branchId: null }],
    });
    expect(companyWide.json().code).toBe('PRIVILEGE_ESCALATION');

    // Cannot create branches or roles (merchant-level rights).
    expect(
      (
        await c.client.request('POST', '/manager/branches', {
          cookies: bm,
          body: { code: 'X1', nameEn: 'X' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await c.client.request('POST', '/manager/roles', {
          cookies: bm,
          body: { nameEn: 'Mine', permissions: [] },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('shows a branch manager only their branch and its employees', async () => {
    const c = await company();
    const atSecondEmail = await hire(c, [{ roleId: c.roles.cashier, branchId: c.second }]);
    const atMainEmail = await hire(c, [{ roleId: c.roles.cashier, branchId: c.main }]);
    const bmEmail = await hire(c, [{ roleId: c.roles.branch_manager, branchId: c.main }]);
    const bm = sessionCookie(await login(c.client, 'manager', bmEmail), 'manager');

    const branches = (await c.client.request('GET', '/manager/branches', { cookies: bm }))
      .json()
      .branches.map((b: { id: string }) => b.id);
    expect(branches).toEqual([c.main]);
    expect(
      (await c.client.request('GET', `/manager/branches/${c.second}`, { cookies: bm })).statusCode,
    ).toBe(403);

    const emails = (await c.client.request('GET', '/manager/employees', { cookies: bm }))
      .json()
      .employees.map((e: { email: string }) => e.email);
    expect(emails).toContain(atMainEmail);
    expect(emails).not.toContain(atSecondEmail);
    expect(emails).not.toContain(c.email); // the owner is not a branch employee
  });

  it('protects the owner and more privileged employees from lesser managers', async () => {
    const c = await company();
    const cmEmail = await hire(c, [{ roleId: c.roles.company_manager, branchId: null }]);
    const cm = sessionCookie(await login(c.client, 'manager', cmEmail), 'manager');
    const list = (await c.client.request('GET', '/manager/employees', { cookies: cm })).json()
      .employees as {
      membershipId: string;
      isOwner: boolean;
      email: string;
      manageable: boolean;
    }[];
    const ownerRow = list.find((e) => e.isOwner)!;
    const self = list.find((e) => e.email === cmEmail)!;
    expect(ownerRow.manageable).toBe(false);
    expect(self.manageable).toBe(false);

    const deactivateOwner = await c.client.request(
      'POST',
      `/manager/employees/${ownerRow.membershipId}/status`,
      { cookies: cm, body: { status: 'inactive' } },
    );
    expect(deactivateOwner.json().code).toBe('PRIVILEGE_ESCALATION');
    // No self-promotion: a manager cannot change their own roles.
    const selfPromote = await c.client.request(
      'PUT',
      `/manager/employees/${self.membershipId}/assignments`,
      {
        cookies: cm,
        body: {
          assignments: [
            { roleId: c.roles.company_manager, branchId: null },
            { roleId: c.roles.cashier, branchId: null },
          ],
        },
      },
    );
    expect(selfPromote.statusCode).toBe(403);

    // The company manager holds no POS rights, so cannot grant them.
    const cashierInvite = await invite(c.client, cm, {
      email: uniqueEmail('z'),
      fullName: 'Z',
      assignments: [{ roleId: c.roles.cashier, branchId: c.main }],
    });
    expect(cashierInvite.json()).toMatchObject({ code: 'PRIVILEGE_ESCALATION' });
    expect(cashierInvite.json().detail).toContain('pos.access');
  });

  it('limits role editing to permissions the editor holds', async () => {
    const c = await company();
    const cmEmail = await hire(c, [{ roleId: c.roles.company_manager, branchId: null }]);
    const cm = sessionCookie(await login(c.client, 'manager', cmEmail), 'manager');

    const created = await c.client.request('POST', '/manager/roles', {
      cookies: cm,
      body: {
        nameEn: 'Stock clerk',
        permissions: ['manager.access', 'inventory.read', 'inventory.adjust'],
      },
    });
    expect(created.statusCode).toBe(201);
    const escalate = await c.client.request('PATCH', `/manager/roles/${created.json().id}`, {
      cookies: cm,
      body: {
        nameEn: 'Stock clerk',
        permissions: ['manager.access', 'pos.access'],
        version: created.json().version,
      },
    });
    expect(escalate.json().code).toBe('PRIVILEGE_ESCALATION');

    const roles = (await c.client.request('GET', '/manager/roles', { cookies: cm })).json()
      .roles as { templateKey: string; editable: boolean }[];
    expect(roles.find((r) => r.templateKey === 'cashier')!.editable).toBe(false); // contains pos.access
    expect(roles.find((r) => r.templateKey === 'company_manager')!.editable).toBe(true);

    const unknown = await c.client.request('POST', '/manager/roles', {
      cookies: c.cookies,
      body: { nameEn: 'Bad', permissions: ['root.everything'] },
    });
    expect(unknown.statusCode).toBe(400);
  });

  it('owner manages roles: create, update with version check, refuse deleting a role in use', async () => {
    const c = await company();
    const created = (
      await c.client.request('POST', '/manager/roles', {
        cookies: c.cookies,
        body: { nameAr: 'محاسب', permissions: ['manager.access', 'reports.financial'] },
      })
    ).json();
    const updated = await c.client.request('PATCH', `/manager/roles/${created.id}`, {
      cookies: c.cookies,
      body: {
        nameAr: 'محاسب أول',
        permissions: ['manager.access', 'reports.financial', 'reports.sales'],
        version: created.version,
      },
    });
    expect(updated.json()).toMatchObject({
      nameAr: 'محاسب أول',
      permissions: ['manager.access', 'reports.financial', 'reports.sales'],
    });
    const stale = await c.client.request('PATCH', `/manager/roles/${created.id}`, {
      cookies: c.cookies,
      body: { nameAr: 'x', permissions: [], version: created.version },
    });
    expect(stale.json().code).toBe('VERSION_CONFLICT');

    await hire(c, [{ roleId: created.id, branchId: c.main }]);
    expect(
      (
        await c.client.request('DELETE', `/manager/roles/${created.id}`, { cookies: c.cookies })
      ).json().code,
    ).toBe('ROLE_IN_USE');
    expect(
      (
        await c.client.request('DELETE', `/manager/roles/${c.roles.supervisor}`, {
          cookies: c.cookies,
        })
      ).statusCode,
    ).toBe(204);
  });
});

describe('employee lifecycle', () => {
  it('deactivation ends sessions immediately; role changes apply on the next request', async () => {
    const c = await company();
    const email = await hire(c, [{ roleId: c.roles.branch_manager, branchId: c.main }]);
    const session = sessionCookie(await login(c.client, 'manager', email), 'manager');
    const list = (
      await c.client.request('GET', '/manager/employees', { cookies: c.cookies })
    ).json().employees as { email: string; membershipId: string }[];
    const membershipId = list.find((e) => e.email === email)!.membershipId;

    // Downgrade to cashier: the manager session stops working (no manager.access any more).
    const changed = await c.client.request(
      'PUT',
      `/manager/employees/${membershipId}/assignments`,
      {
        cookies: c.cookies,
        body: { assignments: [{ roleId: c.roles.cashier, branchId: c.main }] },
      },
    );
    expect(changed.statusCode).toBe(200);
    expect(
      (await c.client.request('GET', '/auth/manager/me', { cookies: session })).statusCode,
    ).toBe(401);

    const pos = sessionCookie(await login(c.client, 'pos', email), 'pos');
    const off = await c.client.request('POST', `/manager/employees/${membershipId}/status`, {
      cookies: c.cookies,
      body: { status: 'inactive' },
    });
    expect(off.json().status).toBe('inactive');
    expect((await c.client.request('GET', '/auth/pos/me', { cookies: pos })).statusCode).toBe(401);
    expect((await login(c.client, 'pos', email)).json().code).toBe('NO_MERCHANT_ACCESS');

    await c.client.request('POST', `/manager/employees/${membershipId}/status`, {
      cookies: c.cookies,
      body: { status: 'active' },
    });
    expect((await login(c.client, 'pos', email)).json().status).toBe('authenticated');
  });

  it('edits the employee profile and sends password resets without exposing passwords', async () => {
    const c = await company();
    const email = await hire(c, [{ roleId: c.roles.cashier, branchId: c.main }]);
    const id = (
      (await c.client.request('GET', '/manager/employees', { cookies: c.cookies })).json()
        .employees as { email: string; membershipId: string }[]
    ).find((e) => e.email === email)!.membershipId;
    const updated = await c.client.request('PATCH', `/manager/employees/${id}`, {
      cookies: c.cookies,
      body: { jobTitle: 'Senior cashier', phone: '+965 5000 0000', employeeCode: 'E-7' },
    });
    expect(updated.json()).toMatchObject({ jobTitle: 'Senior cashier', employeeCode: 'E-7' });
    expect(updated.body).not.toMatch(/password/i);

    const before = mailer.outbox.length;
    const reset = await c.client.request('POST', `/manager/employees/${id}/password-reset`, {
      cookies: c.cookies,
      body: {},
    });
    expect(reset.statusCode).toBe(202);
    const { PasswordResetService } = await import('../auth/password-reset.service.js');
    await app.get(PasswordResetService).drain();
    expect(mailer.outbox.length).toBe(before + 1);
    expect(mailer.outbox.at(-1)!.to).toBe(email);
    expect(JSON.stringify(reset.json())).not.toContain('token');
  });
});

describe('branches', () => {
  it('creates, edits with optimistic locking, and rejects duplicate codes', async () => {
    const c = await company();
    const created = (
      await c.client.request('POST', '/manager/branches', {
        cookies: c.cookies,
        body: {
          code: 'jahra',
          nameAr: 'الجهراء',
          phone: '+965 2222',
          receiptFooter: 'شكراً لزيارتكم',
        },
      })
    ).json();
    expect(created).toMatchObject({
      code: 'JAHRA',
      nameAr: 'الجهراء',
      status: 'active',
      isMain: false,
      receiptFooter: 'شكراً لزيارتكم',
    });
    const dup = await c.client.request('POST', '/manager/branches', {
      cookies: c.cookies,
      body: { code: 'JAHRA', nameEn: 'Other' },
    });
    expect(dup.json().code).toBe('DUPLICATE_CODE');
    const edited = await c.client.request('PATCH', `/manager/branches/${created.id}`, {
      cookies: c.cookies,
      body: { ...created, nameEn: 'Jahra', version: created.version },
    });
    expect(edited.json()).toMatchObject({ nameEn: 'Jahra', version: created.version + 1 });
    const stale = await c.client.request('PATCH', `/manager/branches/${created.id}`, {
      cookies: c.cookies,
      body: { ...created, version: created.version },
    });
    expect(stale.json().code).toBe('VERSION_CONFLICT');
    const invalid = await c.client.request('POST', '/manager/branches', {
      cookies: c.cookies,
      body: { code: 'bad code!', nameEn: '' },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('deactivating a branch removes POS access there; the main branch stays active', async () => {
    const c = await company();
    const email = await hire(c, [
      { roleId: c.roles.cashier, branchId: c.main },
      { roleId: c.roles.cashier, branchId: c.second },
    ]);
    const first = (await login(c.client, 'pos', email)).json();
    expect(first.status).toBe('select_merchant');
    const atSecond = await c.client.request('POST', '/auth/login/select', {
      body: { ticket: first.ticket, merchantId: c.merchantId, branchId: c.second },
    });
    const pos = sessionCookie(atSecond, 'pos');

    expect(
      (
        await c.client.request('POST', `/manager/branches/${c.main}/status`, {
          cookies: c.cookies,
          body: { status: 'inactive' },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await c.client.request('POST', `/manager/branches/${c.second}/status`, {
          cookies: c.cookies,
          body: { status: 'inactive' },
        })
      ).json().status,
    ).toBe('inactive');
    expect((await c.client.request('GET', '/auth/pos/me', { cookies: pos })).statusCode).toBe(401);
    // Only the remaining branch is offered now, so sign-in completes directly.
    expect((await login(c.client, 'pos', email)).json().status).toBe('authenticated');
  });

  it('switches the POS branch only to authorized branches', async () => {
    const c = await company();
    const email = await hire(c, [
      { roleId: c.roles.cashier, branchId: c.main },
      { roleId: c.roles.cashier, branchId: c.second },
    ]);
    const first = (await login(c.client, 'pos', email)).json();
    const pos = sessionCookie(
      await c.client.request('POST', '/auth/login/select', {
        body: { ticket: first.ticket, merchantId: c.merchantId, branchId: c.main },
      }),
      'pos',
    );
    const switched = await c.client.request('POST', '/auth/pos/switch-branch', {
      cookies: pos,
      body: { branchId: c.second },
    });
    const me = (
      await c.client.request('GET', '/auth/pos/me', { cookies: sessionCookie(switched, 'pos') })
    ).json();
    expect(me.branch.id).toBe(c.second);

    const third = (
      await c.client.request('POST', '/manager/branches', {
        cookies: c.cookies,
        body: { code: 'B3', nameEn: 'Third' },
      })
    ).json().id;
    const denied = await c.client.request('POST', '/auth/pos/switch-branch', {
      cookies: sessionCookie(switched, 'pos'),
      body: { branchId: third },
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe('cross-merchant isolation', () => {
  it('never reads or uses another merchant’s employees, roles or branches', async () => {
    const a = await company();
    const b = await company();
    const bEmployee = await hire(b, [{ roleId: b.roles.cashier, branchId: b.main }]);
    const bMember = (
      (await b.client.request('GET', '/manager/employees', { cookies: b.cookies })).json()
        .employees as { email: string; membershipId: string }[]
    ).find((e) => e.email === bEmployee)!.membershipId;

    expect(
      (await a.client.request('GET', `/manager/employees/${bMember}`, { cookies: a.cookies }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await a.client.request('POST', `/manager/employees/${bMember}/status`, {
          cookies: a.cookies,
          body: { status: 'inactive' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await a.client.request('GET', `/manager/branches/${b.main}`, { cookies: a.cookies }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await a.client.request('PATCH', `/manager/roles/${b.roles.cashier}`, {
          cookies: a.cookies,
          body: { nameEn: 'x', permissions: [], version: 1 },
        })
      ).statusCode,
    ).toBe(404);

    // Using another merchant's role or branch in an invitation fails.
    const foreignRole = await invite(a.client, a.cookies, {
      email: uniqueEmail('f'),
      fullName: 'F',
      assignments: [{ roleId: b.roles.cashier, branchId: a.main }],
    });
    expect(foreignRole.statusCode).toBe(404);
    const foreignBranch = await invite(a.client, a.cookies, {
      email: uniqueEmail('g'),
      fullName: 'G',
      assignments: [{ roleId: a.roles.cashier, branchId: b.main }],
    });
    expect(foreignBranch.statusCode).toBe(404);

    const aList = (
      await a.client.request('GET', '/manager/employees', { cookies: a.cookies })
    ).json();
    expect(aList.employees.map((e: { email: string }) => e.email)).not.toContain(bEmployee);
    const aBranches = (await a.client.request('GET', '/manager/branches', { cookies: a.cookies }))
      .json()
      .branches.map((x: { id: string }) => x.id);
    expect(aBranches).not.toContain(b.main);
  });

  it('enforces isolation in the database for invitations and assignments', async () => {
    const a = await company();
    const b = await company();
    await invite(b.client, b.cookies, {
      email: uniqueEmail('rls'),
      fullName: 'R',
      assignments: [{ roleId: b.roles.cashier, branchId: b.main }],
    });
    const runtime = new (await import('pg')).default.Pool({
      connectionString: process.env['TEST_DATABASE_URL'],
      max: 1,
    });
    try {
      const client = await runtime.connect();
      await client.query('begin');
      await client.query(`select set_config('app.merchant_id', $1, true)`, [a.merchantId]);
      const visible = await client.query(
        'select merchant_id from invitations union all select merchant_id from role_assignments union all select merchant_id from roles',
      );
      expect(visible.rows.every((r) => r.merchant_id === a.merchantId)).toBe(true);
      await expect(
        client.query(
          'insert into branches (id, merchant_id, code, name_en) values (gen_random_uuid(), $1, $2, $3)',
          [b.merchantId, 'EVIL', 'Evil'],
        ),
      ).rejects.toThrow(/row-level security/);
      await client.query('rollback');
      client.release();
    } finally {
      await runtime.end();
    }
  });
});
