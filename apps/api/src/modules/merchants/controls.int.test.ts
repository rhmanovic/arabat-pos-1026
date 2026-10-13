import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

/** Treasurer role and the internal-control checklist (BR-165, remediation R1.6). */
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

describe('internal controls checklist', () => {
  it('ships a least-privilege Treasurer role and reports what weakens control', async () => {
    const c = await createCompany(app, db, mailer);
    const roles = (await c.client.request('GET', '/manager/roles', { cookies: c.cookies })).json()
      .roles as { id: string; templateKey: string | null; permissions: string[] }[];
    const treasurer = roles.find((r) => r.templateKey === 'treasurer');
    expect(treasurer).toBeDefined();
    expect(treasurer!.permissions).toEqual(
      expect.arrayContaining(['manager.access', 'cash.custody', 'cash.deposit', 'shifts.view_all']),
    );
    for (const key of ['sales.create', 'pos.access', 'employees.manage', 'catalog.manage'])
      expect(treasurer!.permissions).not.toContain(key);

    const checklist = () =>
      c.client.request('GET', '/manager/merchant/controls', { cookies: c.cookies });
    // A fresh company: only the owner holds custody; no member is without a role.
    let list = (await checklist()).json();
    expect(list).toMatchObject({
      treasurerAssigned: false,
      membersWithoutRoles: [],
      registersAboveTolerance: [],
      pendingCashMovements: 0,
    });

    // A cashier whose only role is removed is flagged; a treasurer clears the custody warning.
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const members = (
      await c.client.request('GET', '/manager/employees', { cookies: c.cookies })
    ).json().employees as { membershipId: string; email: string }[];
    const member = members.find((m) => m.email === cashier.email)!;
    expect(
      (
        await c.client.request('PUT', `/manager/employees/${member.membershipId}/assignments`, {
          cookies: c.cookies,
          body: { assignments: [] },
        })
      ).statusCode,
    ).toBe(200);
    list = (await checklist()).json();
    expect(list.membersWithoutRoles).toHaveLength(1);
    expect(list.treasurerAssigned).toBe(false);
    await c.hire([{ roleId: treasurer!.id, branchId: c.main }], 'manager');
    list = (await checklist()).json();
    expect(list.treasurerAssigned).toBe(true);

    // A register whose tolerance exceeds the company maximum is listed.
    const settings = (
      await c.client.request('GET', '/manager/sales-settings', { cookies: c.cookies })
    ).json();
    const [register] = (
      await c.client.request('GET', `/manager/registers?branchId=${c.main}`, { cookies: c.cookies })
    ).json().registers as { id: string; code: string; version: number }[];
    expect(
      (
        await c.client.request('PATCH', `/manager/registers/${register!.id}`, {
          cookies: c.cookies,
          body: {
            branchId: c.main,
            code: register!.code,
            nameEn: 'R1',
            discrepancyTolerance: '0.900',
            version: register!.version,
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await c.client.request('PUT', '/manager/sales-settings', {
          cookies: c.cookies,
          body: {
            maxDiscountPercent: settings.maxDiscountPercent,
            refundWindowDays: settings.refundWindowDays,
            refundApprovalLimit: settings.refundApprovalLimit.amount,
            blindCashCount: settings.blindCashCount,
            cashOutOtherLimit: settings.cashOutOtherLimit.amount,
            cashOutOtherShiftLimit: settings.cashOutOtherShiftLimit.amount,
            maxRegisterTolerance: '0.250',
            version: settings.version,
          },
        })
      ).statusCode,
    ).toBe(200);
    list = (await checklist()).json();
    expect(list.registersAboveTolerance).toHaveLength(1);
    expect(list.registersAboveTolerance[0].tolerance.amount).toBe('0.900');

    // Only holders of the company-settings right see the checklist.
    expect(
      (
        await c.client.request('GET', '/manager/merchant/controls', {
          cookies: (await c.hire([{ roleId: c.roles.branch_manager, branchId: c.main }], 'manager'))
            .cookies,
        })
      ).statusCode,
    ).toBe(403);
  });
});
