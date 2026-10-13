import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

/** Follow-up of cash differences (BR-167, remediation R1.4). */
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

describe('cash variances', () => {
  it('lists every recorded difference from its source and records management follow-up', async () => {
    const c = await createCompany(app, db, mailer);
    const call = (
      method: 'GET' | 'POST',
      path: string,
      body?: unknown,
      cookies: Cookies = c.cookies,
    ) => c.client.request(method, path, { cookies, ...(body === undefined ? {} : { body }) });
    const [register] = (await call('GET', `/manager/registers?branchId=${c.main}`)).json()
      .registers as { id: string }[];
    // A supervisor closes 2.000 short (tolerance 0): a shift-close difference.
    const sup = await c.hire([{ roleId: c.roles.supervisor, branchId: c.main }], 'pos');
    const opened = await call(
      'POST',
      '/pos/shifts',
      { registerId: register!.id, countedCash: '50.000', expectedCash: '0.000' },
      sup.cookies,
    );
    expect(opened.statusCode).toBe(201);
    expect(
      (
        await call(
          'POST',
          '/pos/shifts/current/close',
          { countedCash: '48.000', version: opened.json().version, note: 'coins missing' },
          sup.cookies,
        )
      ).statusCode,
    ).toBe(201);
    // A second treasury count 5.000 below the book: a count difference.
    const treasuryId = await c.countTreasury(c.main, '100.000');
    expect(
      (
        await call('POST', `/manager/cash/accounts/${treasuryId}/counts`, {
          countedCash: '95.000',
          expectedCash: '100.000',
          note: 'recount',
        })
      ).statusCode,
    ).toBe(201);

    const open = (await call('GET', '/manager/cash/variances')).json();
    expect(open.openCount).toBe(2);
    const close = open.variances.find(
      (v: { sourceType: string }) => v.sourceType === 'shift_close',
    );
    const count = open.variances.find(
      (v: { sourceType: string }) => v.sourceType === 'account_count',
    );
    expect(close).toMatchObject({
      sourceId: opened.json().id,
      amount: { amount: '-2.000' },
      place: { kind: 'register' },
      sourceNote: 'coins missing',
      followup: null,
    });
    expect(typeof close.accountable).toBe('string');
    expect(count).toMatchObject({ amount: { amount: '-5.000' }, place: { kind: 'treasury' } });
    // The checklist counts them.
    expect((await call('GET', '/manager/merchant/controls')).json().openVariances).toBe(2);

    // A shift monitor may explain; settling or writing off needs cash custody.
    const bm = await c.hire([{ roleId: c.roles.branch_manager, branchId: c.main }], 'manager');
    const followup = (sourceType: string, sourceId: string, body: unknown, cookies: Cookies) =>
      call('POST', `/manager/cash/variances/${sourceType}/${sourceId}/followup`, body, cookies);
    expect(
      (
        await followup(
          'shift_close',
          close.sourceId,
          { status: 'settled', note: 'paid back' },
          bm.cookies,
        )
      ).statusCode,
    ).toBe(403);
    const explained = await followup(
      'shift_close',
      close.sourceId,
      { status: 'explained', note: 'change given wrongly' },
      bm.cookies,
    );
    expect(explained.statusCode).toBe(201);
    expect(explained.json().followup).toMatchObject({
      status: 'explained',
      note: 'change given wrongly',
    });
    const settled = await followup(
      'shift_close',
      close.sourceId,
      { status: 'settled', note: 'repaid' },
      c.cookies,
    );
    expect(settled.json().followup.status).toBe('settled');
    expect(
      (
        await followup(
          'shift_close',
          opened.json().id,
          { status: 'explained', note: 'x' },
          bm.cookies,
        )
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await followup(
          'account_count',
          '00000000-0000-7000-8000-000000000000',
          { status: 'explained', note: 'x' },
          c.cookies,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await followup('shift_close', close.sourceId, { status: 'explained', note: '' }, c.cookies))
        .statusCode,
    ).toBe(400);

    const resolved = (await call('GET', '/manager/cash/variances?status=resolved')).json();
    expect(resolved.variances).toHaveLength(1);
    expect((await call('GET', '/manager/cash/variances')).json().openCount).toBe(1);
    expect((await call('GET', '/manager/merchant/controls')).json().openVariances).toBe(1);
    expect(
      (await call('GET', '/manager/audit?action=variance')).json().total,
    ).toBeGreaterThanOrEqual(2);
    // Cashiers cannot see variances.
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    expect([401, 403]).toContain(
      (await call('GET', '/manager/cash/variances', undefined, cashier.cookies)).statusCode,
    );
  });
});
