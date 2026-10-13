import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

/** Merchant audit log (BR-163, remediation R1 / FND-101). */
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
type Cookies = Co['cookies'];

/** A local day of the merchant (Asia/Kuwait, UTC+3), offset in days from today. */
function kuwaitDay(offsetDays: number) {
  return new Date(Date.now() + 3 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function changeSettings(c: Co, blindCashCount: boolean) {
  const current = (
    await c.client.request('GET', '/manager/sales-settings', { cookies: c.cookies })
  ).json();
  const res = await c.client.request('PUT', '/manager/sales-settings', {
    cookies: c.cookies,
    body: {
      maxDiscountPercent: current.maxDiscountPercent,
      refundWindowDays: current.refundWindowDays,
      refundApprovalLimit: current.refundApprovalLimit.amount,
      blindCashCount,
      cashOutOtherLimit: current.cashOutOtherLimit.amount,
      cashOutOtherShiftLimit: current.cashOutOtherShiftLimit.amount,
      maxRegisterTolerance: current.maxRegisterTolerance.amount,
      version: current.version,
    },
  });
  expect(res.statusCode).toBe(200);
}

function audit(c: Co, query = '', cookies: Cookies = c.cookies) {
  return c.client.request('GET', `/manager/audit${query ? `?${query}` : ''}`, { cookies });
}

describe('merchant audit log', () => {
  it('lets holders of audit.read review their own company events, filtered, and nobody else', async () => {
    const a = await createCompany(app, db, mailer);
    const b = await createCompany(app, db, mailer);
    await changeSettings(a, false);
    await changeSettings(b, false);

    // The owner reads the event with who, what, when and the before/after values.
    const mine = audit(a, 'action=settings_updated');
    expect((await mine).statusCode).toBe(200);
    const body = (await mine).json();
    expect(body.total).toBe(1);
    expect(body.entries[0]).toMatchObject({
      action: 'sales.settings_updated',
      actorType: 'user',
      targetType: 'merchant',
      targetId: a.merchantId,
      details: { blindCashCount: { from: true, to: false } },
    });
    expect(typeof body.entries[0].actorName).toBe('string');
    expect(body.entries[0].actorName.length).toBeGreaterThan(0);
    expect(body.actions).toContain('sales.settings_updated');

    // Another company's events never appear, with or without filters.
    const all = (await audit(a, 'pageSize=100')).json();
    expect(all.total).toBeGreaterThan(1);
    for (const e of all.entries) expect(e.targetId).not.toBe(b.merchantId);
    expect(
      all.entries.filter((e: { action: string }) => e.action === 'sales.settings_updated'),
    ).toHaveLength(1);

    // Periods are the merchant's local days; a type filter narrows by record type.
    expect((await audit(a, `from=${kuwaitDay(1)}`)).json().total).toBe(0);
    expect((await audit(a, `to=${kuwaitDay(-1)}`)).json().total).toBe(0);
    expect((await audit(a, `from=${kuwaitDay(0)}&to=${kuwaitDay(0)}`)).json().total).toBe(
      all.total,
    );
    const merchantsOnly = (await audit(a, 'targetType=merchant')).json();
    expect(merchantsOnly.total).toBeGreaterThan(0);
    for (const e of merchantsOnly.entries) expect(e.targetType).toBe('merchant');
    expect((await audit(a, 'pageSize=500')).statusCode).toBe(400);
    const paged = (await audit(a, 'page=2&pageSize=1')).json();
    expect(paged.entries).toHaveLength(1);
    expect(paged.page).toBe(2);

    // Company managers hold the right; branch managers and cashiers do not.
    const cm = await a.hire([{ roleId: a.roles.company_manager, branchId: null }], 'manager');
    expect((await audit(a, '', cm.cookies)).statusCode).toBe(200);
    const bm = await a.hire([{ roleId: a.roles.branch_manager, branchId: a.main }], 'manager');
    expect((await audit(a, '', bm.cookies)).statusCode).toBe(403);
    const cashier = await a.hire([{ roleId: a.roles.cashier, branchId: a.main }], 'pos');
    expect([401, 403]).toContain((await audit(a, '', cashier.cookies)).statusCode);
  });
});
