import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DbFixtures,
  PASSWORD,
  createCompany,
  sessionCookie,
  uniqueEmail,
} from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

/**
 * Remediation session 12, R5.4 (BR-192, BR-193): self-service password change and sessions,
 * manager "end sessions" and "clear lock", invitation grants re-checked at acceptance, dormant
 * grants confirmed on branch reactivation, lock-out notice to the account holder.
 */
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

const req = (
  c: Co,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  path: string,
  body?: unknown,
  cookies = c.cookies,
) => c.client.request(method, path, { cookies, ...(body === undefined ? {} : { body }) });

async function login(c: Co, email: string, password: string, iface: 'manager' | 'pos' = 'manager') {
  return c.client.request('POST', '/auth/login', { body: { interface: iface, email, password } });
}

describe('account hygiene (R5.4)', () => {
  it('changes the password with the current one, ends the other sessions and lists / revokes sessions', async () => {
    const c = await createCompany(app, db, mailer);
    // A second manager session of the owner.
    const second = sessionCookie(await login(c, c.email, PASSWORD), 'manager');
    let list = (await req(c, 'GET', '/auth/manager/sessions')).json();
    expect(list.sessions).toHaveLength(2);
    expect(list.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    // The other session can be ended by id; a stranger's id is not found.
    const other = list.sessions.find((s: { current: boolean }) => !s.current);
    expect((await req(c, 'DELETE', `/auth/manager/sessions/${other.id}`)).statusCode).toBe(204);
    expect((await req(c, 'GET', '/auth/manager/me', undefined, second)).statusCode).toBe(401);
    expect((await req(c, 'DELETE', `/auth/manager/sessions/${other.id}`)).statusCode).toBe(404);
    // Wrong current password refused; the new one must differ.
    expect(
      (
        await req(c, 'POST', '/auth/manager/password', {
          currentPassword: 'nope-nope-nope',
          newPassword: 'Brand-New-Pass-9',
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await req(c, 'POST', '/auth/manager/password', {
          currentPassword: PASSWORD,
          newPassword: PASSWORD,
        })
      ).statusCode,
    ).toBe(400);
    const third = sessionCookie(await login(c, c.email, PASSWORD), 'manager');
    const changed = await req(c, 'POST', '/auth/manager/password', {
      currentPassword: PASSWORD,
      newPassword: 'Brand-New-Pass-9',
    });
    expect(changed.statusCode, changed.body).toBe(200);
    // The old cookie is dead, the reply carries a fresh one, every other session ended.
    const fresh = sessionCookie(changed, 'manager');
    expect((await req(c, 'GET', '/auth/manager/me', undefined, c.cookies)).statusCode).toBe(401);
    expect((await req(c, 'GET', '/auth/manager/me', undefined, third)).statusCode).toBe(401);
    expect((await req(c, 'GET', '/auth/manager/me', undefined, fresh)).statusCode).toBe(200);
    expect((await login(c, c.email, PASSWORD)).statusCode).toBe(401);
    expect((await login(c, c.email, 'Brand-New-Pass-9')).statusCode).toBe(200);
    list = (await req(c, 'GET', '/auth/manager/sessions', undefined, fresh)).json();
    expect(list.sessions).toHaveLength(2);
    const ended = (await req(c, 'POST', '/auth/manager/sessions/revoke-others', {}, fresh)).json();
    expect(ended.ended).toBe(1);
    const audit = (await req(c, 'GET', '/manager/audit?action=auth.', undefined, fresh)).json()
      .entries as { action: string }[];
    expect(audit.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        'auth.password_changed',
        'auth.session_revoked',
        'auth.sessions_revoked_others',
      ]),
    );
  });

  it('lets a manager end an employee’s sessions and clear a sign-in lock; the lock-out is e-mailed', async () => {
    const c = await createCompany(app, db, mailer);
    const emp = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const membershipId = (await req(c, 'GET', '/manager/employees'))
      .json()
      .employees.find((e: { email: string }) => e.email === emp.email).membershipId as string;
    expect((await req(c, 'GET', '/auth/pos/me', undefined, emp.cookies)).statusCode).toBe(200);
    const ended = await req(c, 'POST', `/manager/employees/${membershipId}/sessions/revoke`, {});
    expect(ended.statusCode, ended.body).toBe(200);
    expect(ended.json().ended).toBe(1);
    expect((await req(c, 'GET', '/auth/pos/me', undefined, emp.cookies)).statusCode).toBe(401);
    // Ten wrong passwords lock the account; the holder is told once; the manager clears it.
    for (let i = 0; i < 10; i++) {
      expect((await login(c, emp.email, 'wrong-password-' + i, 'pos')).statusCode).toBe(401);
    }
    expect((await login(c, emp.email, PASSWORD, 'pos')).statusCode).toBe(429);
    const notices = mailer.outbox.filter(
      (m) => m.to === emp.email && /temporarily locked/.test(m.subject),
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]!.text).toContain('15 minutes');
    expect((await req(c, 'POST', `/manager/employees/${membershipId}/unlock`, {})).statusCode).toBe(
      204,
    );
    expect((await login(c, emp.email, PASSWORD, 'pos')).statusCode).toBe(200);
    const audit = (await req(c, 'GET', '/manager/audit?action=employee.')).json().entries as {
      action: string;
    }[];
    expect(audit.map((e) => e.action)).toEqual(
      expect.arrayContaining(['employee.sessions_revoked', 'employee.login_unlocked']),
    );
  });

  it('re-checks invitation grants against the inviter’s current authority at acceptance', async () => {
    const c = await createCompany(app, db, mailer);
    // A branch manager at the main branch invites a supervisor at the main branch.
    // (A branch manager alone holds no POS rights, so the inviter also holds the supervisor role.)
    const bm = await c.hire(
      [
        { roleId: c.roles.branch_manager, branchId: c.main },
        { roleId: c.roles.supervisor, branchId: c.main },
      ],
      'manager',
    );
    const email = uniqueEmail('late');
    const invited = await req(
      c,
      'POST',
      '/manager/employees/invitations',
      {
        email,
        fullName: 'Late Joiner',
        assignments: [{ roleId: c.roles.supervisor, branchId: c.main }],
      },
      bm.cookies,
    );
    expect(invited.statusCode, invited.body).toBe(201);
    const mail = [...mailer.outbox].reverse().find((m) => m.to === email)!;
    const token = /token=([\w-]+)/.exec(mail.text)![1]!;
    // Meanwhile the inviter is moved to the second branch: no authority at the main branch any more.
    const bmId = (await req(c, 'GET', '/manager/employees'))
      .json()
      .employees.find((e: { email: string }) => e.email === bm.email).membershipId as string;
    await req(c, 'PUT', `/manager/employees/${bmId}/assignments`, {
      assignments: [
        { roleId: c.roles.branch_manager, branchId: c.second },
        { roleId: c.roles.supervisor, branchId: c.second },
      ],
    });
    const accepted = await c.client.request('POST', '/auth/invitations/accept', {
      body: { token, password: PASSWORD },
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    // Member created, grant dropped and recorded.
    const member = (await req(c, 'GET', '/manager/employees'))
      .json()
      .employees.find((e: { email: string }) => e.email === email);
    expect(member.assignments).toEqual([]);
    const entry = (await req(c, 'GET', '/manager/audit?action=employee.invitation_accepted')).json()
      .entries[0];
    expect(entry.details).toMatchObject({
      grantsApplied: 0,
      droppedGrants: [{ branchId: c.main, reason: 'inviter_authority' }],
    });
    // Deactivating an inviter revokes their pending invitations.
    const email2 = uniqueEmail('late2');
    expect(
      (
        await req(
          c,
          'POST',
          '/manager/employees/invitations',
          {
            email: email2,
            fullName: 'Second Joiner',
            assignments: [{ roleId: c.roles.cashier, branchId: c.second }],
          },
          bm.cookies,
        )
      ).statusCode,
    ).toBe(201);
    const off = await req(c, 'POST', `/manager/employees/${bmId}/status`, { status: 'inactive' });
    expect([200, 201], off.body).toContain(off.statusCode);
    const pending = (await req(c, 'GET', '/manager/employees'))
      .json()
      .invitations.filter(
        (i: { email: string; status: string }) => i.email === email2 && i.status === 'pending',
      );
    expect(pending).toHaveLength(0);
    const deactivated = (await req(c, 'GET', '/manager/audit?action=employee.deactivated')).json()
      .entries[0];
    expect(deactivated.details).toMatchObject({ invitationsRevoked: 1 });
  });

  it('lists dormant grants on branch reactivation and keeps or clears them on request', async () => {
    const c = await createCompany(app, db, mailer);
    const emp = await c.hire([{ roleId: c.roles.cashier, branchId: c.second }], 'pos');
    const branch = (await req(c, 'GET', `/manager/branches/${c.second}`)).json();
    expect([200, 201]).toContain(
      (await req(c, 'POST', `/manager/branches/${c.second}/status`, { status: 'inactive' }))
        .statusCode,
    );
    // Reactivation without a decision lists the grants that would revive.
    const blocked = await req(c, 'POST', `/manager/branches/${c.second}/status`, {
      status: 'active',
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('GRANTS_NEED_CONFIRMATION');
    expect(blocked.json().issues).toEqual([
      expect.objectContaining({ path: 'dormantGrants', message: 'Employee — Cashier' }),
    ]);
    // Clearing them leaves the member without a role at the branch; the entry says so.
    const cleared = await req(c, 'POST', `/manager/branches/${c.second}/status`, {
      status: 'active',
      dormantGrants: 'clear',
    });
    expect([200, 201], cleared.body).toContain(cleared.statusCode);
    const member = (await req(c, 'GET', '/manager/employees'))
      .json()
      .employees.find((e: { email: string }) => e.email === emp.email);
    expect(member.assignments).toEqual([]);
    const activated = (await req(c, 'GET', '/manager/audit?action=branch.activated')).json()
      .entries[0];
    expect(activated.details).toMatchObject({
      clearedGrants: [{ name: 'Employee', role: 'Cashier' }],
    });
    // Keeping them: grant again, deactivate, reactivate with 'keep'.
    await req(c, 'PUT', `/manager/employees/${member.membershipId}/assignments`, {
      assignments: [{ roleId: c.roles.cashier, branchId: c.second }],
    });
    await req(c, 'POST', `/manager/branches/${c.second}/status`, { status: 'inactive' });
    const kept = await req(c, 'POST', `/manager/branches/${c.second}/status`, {
      status: 'active',
      dormantGrants: 'keep',
    });
    expect([200, 201], kept.body).toContain(kept.statusCode);
    expect(
      (await req(c, 'GET', `/manager/employees/${member.membershipId}`)).json().assignments,
    ).toHaveLength(1);
    expect(
      (await req(c, 'GET', '/manager/audit?action=branch.activated')).json().entries[0].details,
    ).toMatchObject({ revivedGrants: [{ name: 'Employee', role: 'Cashier' }] });
    // Branch edits carry before / after values (BR-191).
    const edited = await req(c, 'PATCH', `/manager/branches/${c.second}`, {
      code: branch.code,
      nameEn: 'Second branch',
      nameAr: branch.nameAr,
      phone: '22334455',
      address: null,
      receiptHeader: null,
      receiptFooter: null,
      version: (await req(c, 'GET', `/manager/branches/${c.second}`)).json().version,
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(
      (await req(c, 'GET', '/manager/audit?action=branch.updated')).json().entries[0].details,
    ).toMatchObject({
      changes: {
        nameEn: { from: 'Second', to: 'Second branch' },
        phone: { from: null, to: '22334455' },
      },
    });
  });
});
