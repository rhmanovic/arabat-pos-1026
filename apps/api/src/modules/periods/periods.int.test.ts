import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../database/database.service.js';
import { newId } from '../../kernel/ids.js';
import { DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

/** Remediation session 11: period close pack and the lock on document dates (R4.2, BR-189, BR-190). */
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

const KUWAIT = 3 * 3600_000;
const today = () => new Date(Date.now() + KUWAIT).toISOString().slice(0, 10);
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const monthOf = (date: string) => date.slice(0, 7);
/** Noon Kuwait time on the 15th of the month `period`. */
const midMonth = (period: string) => new Date(Date.parse(`${period}-15T12:00:00Z`) - KUWAIT);

async function setup() {
  const c = await createCompany(app, db, mailer);
  await c.allowOwnSaleRefunds();
  const req = (
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    cookies = c.cookies,
  ) => c.client.request(method, path, { cookies, ...(body === undefined ? {} : { body }) });
  const tea = (
    await req('POST', '/manager/products', {
      nameEn: 'Tea',
      variants: [{ price: '1.000', cost: '0.400' }],
    })
  ).json().variants[0].id as string;
  await req('POST', '/manager/inventory/adjustments', {
    branchId: c.main,
    kind: 'opening',
    reason: 'opening',
    lines: [{ variantId: tea, quantity: '50', unitCost: '0.400' }],
  });
  const methods = (await req('GET', '/manager/payment-methods')).json().methods as {
    id: string;
    kind: string;
  }[];
  const cash = methods.find((m) => m.kind === 'cash')!.id;
  const till = async () => {
    const emp = await c.hire([{ roleId: c.roles.supervisor, branchId: c.main }], 'pos');
    const registers = (await req('GET', `/manager/registers?branchId=${c.main}`)).json()
      .registers as { id: string }[];
    const opened = await req(
      'POST',
      '/pos/shifts',
      { registerId: registers[0]!.id, countedCash: '10.000', expectedCash: '0.000' },
      emp.cookies,
    );
    if (opened.statusCode !== 201) throw new Error(opened.body);
    return emp.cookies;
  };
  const sell = async (cookies: Cookies, quantity: string) => {
    const res = await req(
      'POST',
      '/pos/sales',
      {
        idempotencyKey: newId(),
        lines: [{ variantId: tea, quantity }],
        payments: [{ methodId: cash, amount: `${quantity}.000` }],
        expectedTotal: `${quantity}.000`,
      },
      cookies,
    );
    if (res.statusCode !== 201) throw new Error(res.body);
    return res.json() as { id: string };
  };
  const audit = async (action: string) =>
    (await req('GET', `/manager/audit?action=${action}`)).json().entries as {
      action: string;
      details: Record<string, unknown>;
    }[];
  return { c, req, tea, cash, till, sell, audit };
}

describe('period close (R4.2)', () => {
  it('closes months in order with a stored pack, refuses the current month and a second close', async () => {
    const s = await setup();
    const d0 = today();
    const cur = monthOf(d0);
    const prev = monthOf(shift(`${cur}-01`, -1));
    const older = monthOf(shift(`${prev}-01`, -1));
    // The company has existed for three months; one sale was rung up in the middle of last month.
    await owner.query(`update merchants set created_at = $2 where id = $1`, [
      s.c.merchantId,
      midMonth(older),
    ]);
    const a = await s.till();
    const old = await s.sell(a, '3');
    await s.sell(a, '2');
    await owner.query(`update sales set created_at = $2 where id = $1`, [old.id, midMonth(prev)]);
    await owner.query(`update payments set created_at = $2 where sale_id = $1`, [
      old.id,
      midMonth(prev),
    ]);

    const list = (await s.req('GET', '/manager/periods')).json();
    expect(list.timezone).toBe('Asia/Kuwait');
    expect(
      list.periods.map((p: { period: string; status: string }) => [p.period, p.status]),
    ).toEqual([
      [cur, 'current'],
      [prev, 'open'],
      [older, 'closable'],
    ]);

    // The pack of an open month is computed live.
    const preview = (await s.req('GET', `/manager/periods/${prev}`)).json();
    expect(preview).toMatchObject({
      period: prev,
      from: `${prev}-01`,
      status: 'open',
      closedAt: null,
      sales: { saleCount: 1, netSales: { amount: '3.000' }, netAfterRefunds: { amount: '3.000' } },
      documents: { sales: 1, refunds: 0, receipts: 0 },
      cash: { total: { amount: '0.000' } },
      stock: { closingValue: { amount: '0.000' } },
    });
    expect(preview.collections).toEqual([
      expect.objectContaining({ kind: 'cash', collected: { amount: '3.000', currency: 'KWD' } }),
    ]);
    expect(preview.profit).toMatchObject({ available: true, grossProfit: { amount: '1.800' } });

    // Months close in order: last month waits for the one before it.
    const early = await s.req('POST', `/manager/periods/${prev}/close`, { note: 'too early' });
    expect(early.statusCode).toBe(409);
    expect(early.json().code).toBe('PERIOD_NOT_CLOSABLE');
    expect((await s.req('POST', `/manager/periods/${cur}/close`, {})).statusCode).toBe(409);
    const first = await s.req('POST', `/manager/periods/${older}/close`, { note: 'nothing yet' });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toMatchObject({
      status: 'closed',
      sales: { saleCount: 0 },
      note: 'nothing yet',
    });
    const closed = (await s.req('POST', `/manager/periods/${prev}/close`, {})).json();
    expect(closed).toMatchObject({
      status: 'closed',
      closedBy: 'Owner Test',
      sales: { saleCount: 1, netSales: { amount: '3.000' } },
      documents: { sales: 1 },
    });
    expect(closed.closedAt).not.toBeNull();
    // Stored, not recomputed: a later backdated change does not move the pack.
    const again = (await s.req('GET', `/manager/periods/${prev}`)).json();
    expect(again.computedAt).toBe(closed.computedAt);
    expect((await s.req('POST', `/manager/periods/${prev}/close`, {})).json().code).toBe(
      'PERIOD_NOT_CLOSABLE',
    );
    const after = (await s.req('GET', '/manager/periods')).json();
    expect(after.periods.map((p: { status: string }) => p.status)).toEqual([
      'current',
      'closed',
      'closed',
    ]);
    const entries = await s.audit('period.closed');
    expect(entries).toHaveLength(2);
    expect(entries[0]!.details).toMatchObject({ period: prev, netSales: '3.000' });
    // The row is immutable for the application role.
    const database = app.get(DatabaseService);
    await expect(
      database.withMerchantTx(s.c.merchantId, (tx) =>
        tx.execute(sql`delete from period_closes where period = ${prev}`),
      ),
    ).rejects.toThrow();
    await expect(
      database.withMerchantTx(s.c.merchantId, (tx) =>
        tx.execute(sql`update period_closes set note = 'x' where period = ${prev}`),
      ),
    ).rejects.toThrow();
  });

  it('needs company-wide report rights to read a pack and the closing right to close', async () => {
    const s = await setup();
    const d0 = today();
    const cur = monthOf(d0);
    const older = monthOf(shift(shift(`${cur}-01`, -1).slice(0, 7) + '-01', -1));
    await owner.query(`update merchants set created_at = $2 where id = $1`, [
      s.c.merchantId,
      midMonth(older),
    ]);
    const branchManager = await s.c.hire(
      [{ roleId: s.c.roles.branch_manager, branchId: s.c.main }],
      'manager',
    );
    // No financial reports for a branch manager: no period list at all.
    expect(
      (await s.req('GET', '/manager/periods', undefined, branchManager.cookies)).statusCode,
    ).toBe(403);
    expect(
      (await s.req('GET', `/manager/periods/${older}`, undefined, branchManager.cookies))
        .statusCode,
    ).toBe(403);
    expect(
      (await s.req('POST', `/manager/periods/${older}/close`, {}, branchManager.cookies))
        .statusCode,
    ).toBe(403);
    const companyManager = await s.c.hire(
      [{ roleId: s.c.roles.company_manager, branchId: null }],
      'manager',
    );
    const closed = await s.req(
      'POST',
      `/manager/periods/${older}/close`,
      {},
      companyManager.cookies,
    );
    expect(closed.statusCode, closed.body).toBe(201);
    expect(closed.json().closedBy).toBe('Employee');
    expect((await s.req('GET', '/manager/periods/2026-13')).statusCode).toBe(400);
  });

  it('gives purchasing documents a bounded business date and refuses dates in a closed month', async () => {
    const s = await setup();
    const d0 = today();
    const supplierId = (await s.req('POST', '/manager/suppliers', { nameEn: 'Gulf Foods' })).json()
      .id as string;
    const order = async (body: Record<string, unknown> = {}) =>
      s.req('POST', '/manager/purchase-orders', {
        supplierId,
        branchId: s.c.main,
        lines: [{ variantId: s.tea, quantity: '10', unitCost: '0.400' }],
        ...body,
      });
    // Default: today in the merchant's zone; a date a few days back is kept and audited.
    const plain = (await order()).json();
    expect(plain.documentDate).toBe(d0);
    const back = (await order({ documentDate: shift(d0, -3) })).json();
    expect(back.documentDate).toBe(shift(d0, -3));
    const created = await s.audit('purchase_order.created');
    expect(created[0]!.details).toMatchObject({ number: back.number, documentDate: shift(d0, -3) });
    expect(created[1]!.details).not.toHaveProperty('documentDate');
    // Bounds: never ahead, at most 7 days back.
    expect((await order({ documentDate: shift(d0, 1) })).statusCode).toBe(400);
    expect((await order({ documentDate: shift(d0, -10) })).statusCode).toBe(400);
    // Receipts: delivery date beside the posting time.
    const submitted = (
      await s.req('POST', `/manager/purchase-orders/${back.id}/submit`, { version: back.version })
    ).json();
    const approved = (
      await s.req('POST', `/manager/purchase-orders/${back.id}/approve`, {
        version: submitted.version,
      })
    ).json();
    const received = await s.req('POST', `/manager/purchase-orders/${back.id}/receipts`, {
      idempotencyKey: newId(),
      receivedOn: shift(d0, -2),
      lines: [{ position: 0, quantity: '4' }],
    });
    expect(received.statusCode, received.body).toBe(201);
    expect(received.json().receipts[0]).toMatchObject({ receivedOn: shift(d0, -2) });
    expect(approved.version).toBeGreaterThan(0);
    expect(
      (
        await s.req('POST', `/manager/purchase-orders/${back.id}/receipts`, {
          idempotencyKey: newId(),
          receivedOn: shift(d0, 2),
          lines: [{ position: 0, quantity: '1' }],
        })
      ).statusCode,
    ).toBe(400);
    // The lock: once a month is closed, nothing can be dated inside it. The current month is
    // closed here directly in the database (the API refuses to close a month that has not ended).
    const cur = monthOf(d0);
    await owner.query(
      `insert into period_closes (id, merchant_id, period, from_date, to_date, timezone, closed_by_user_id, pack)
       values ($1, $2, $3, $4, $5, 'Asia/Kuwait', $6, '{}'::jsonb)`,
      [newId(), s.c.merchantId, cur, `${cur}-01`, shift(`${cur}-01`, 40), s.c.userId],
    );
    try {
      const locked = await order();
      expect(locked.statusCode).toBe(409);
      expect(locked.json().code).toBe('PERIOD_CLOSED');
      const lockedReceipt = await s.req('POST', `/manager/purchase-orders/${back.id}/receipts`, {
        idempotencyKey: newId(),
        lines: [{ position: 0, quantity: '1' }],
      });
      expect(lockedReceipt.json().code).toBe('PERIOD_CLOSED');
      // Sales and refunds are stamped with the posting time and are never backdated: unaffected.
      const a = await s.till();
      await s.sell(a, '1');
    } finally {
      await owner.query(`delete from period_closes where merchant_id = $1`, [s.c.merchantId]);
    }
  });
});
