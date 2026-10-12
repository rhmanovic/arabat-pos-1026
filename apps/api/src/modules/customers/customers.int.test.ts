import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../database/database.service.js';
import { newId } from '../../kernel/ids.js';
import { DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
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
type Cookies = Co['cookies'];

async function setup() {
  const c = await createCompany(app, db, mailer);
  const p = (
    await c.client.request('POST', '/manager/products', {
      cookies: c.cookies,
      body: { nameEn: 'Juice', variants: [{ price: '0.250', cost: '0.100' }] },
    })
  ).json();
  const juice = p.variants[0].id as string;
  for (const branchId of [c.main, c.second])
    await c.client.request('POST', '/manager/inventory/adjustments', {
      cookies: c.cookies,
      body: {
        branchId,
        kind: 'opening',
        reason: 'opening',
        lines: [{ variantId: juice, quantity: '100' }],
      },
    });
  const methods = (
    await c.client.request('GET', '/manager/payment-methods', { cookies: c.cookies })
  ).json().methods as { id: string; kind: string }[];
  return { c, juice, cash: methods.find((m) => m.kind === 'cash')!.id };
}
type S = Awaited<ReturnType<typeof setup>>;

const call = (
  s: S,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
  cookies: Cookies = s.c.cookies,
) => s.c.client.request(method, path, { cookies, ...(body === undefined ? {} : { body }) });

/** A POS employee with an open shift at the branch's first register. */
async function cashier(s: S, roleId: string, branchId = s.c.main) {
  const emp = await s.c.hire([{ roleId, branchId }], 'pos');
  const registers = (await call(s, 'GET', `/manager/registers?branchId=${branchId}`)).json()
    .registers as { id: string }[];
  const shift = await call(
    s,
    'POST',
    '/pos/shifts',
    { registerId: registers[0]!.id, countedCash: '20.000', expectedCash: '0.000' },
    emp.cookies,
  );
  if (shift.statusCode !== 201) throw new Error(shift.body);
  return emp.cookies;
}

function sell(s: S, cookies: Cookies, quantity: string, total: string, extra = {}) {
  return call(
    s,
    'POST',
    '/pos/sales',
    {
      idempotencyKey: newId(),
      lines: [{ variantId: s.juice, quantity }],
      payments: [{ methodId: s.cash, amount: total }],
      expectedTotal: total,
      ...extra,
    },
    cookies,
  );
}

describe('customer profiles', () => {
  it('creates, normalizes, searches, edits, deactivates and keeps notes', async () => {
    const s = await setup();
    const created = await call(s, 'POST', '/manager/customers', {
      fullName: 'Fatima Al-Sabah',
      phone: '5555 1234',
      email: 'Fatima@Example.com',
      preferredLanguage: 'ar',
    });
    expect(created.statusCode).toBe(201);
    const fatima = created.json();
    expect(fatima).toMatchObject({
      code: 'C-000001',
      phone: '+96555551234',
      email: 'fatima@example.com',
      status: 'active',
      stats: { salesCount: 0, salesTotal: { amount: '0.000' }, lastPurchaseAt: null },
    });
    // The same number written differently is the same customer.
    const dup = await call(s, 'POST', '/manager/customers', {
      fullName: 'Someone else',
      phone: '00965-5555-1234',
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('DUPLICATE_PHONE');
    expect(
      (await call(s, 'POST', '/manager/customers', { fullName: 'X', phone: '12ab' })).statusCode,
    ).toBe(400);
    const ahmad = (
      await call(s, 'POST', '/manager/customers', {
        fullName: 'Ahmad Hassan',
        phone: '+971501234567',
      })
    ).json();
    expect(ahmad.code).toBe('C-000002');

    const search = async (q: string) =>
      (await call(s, 'GET', `/manager/customers?q=${encodeURIComponent(q)}`))
        .json()
        .customers.map((c: { code: string }) => c.code);
    expect(await search('fatima')).toEqual(['C-000001']);
    expect(await search('1234')).toEqual(expect.arrayContaining(['C-000001', 'C-000002']));
    expect(await search('5555')).toEqual(['C-000001']);
    expect(await search('c-000002')).toEqual(['C-000002']);
    expect(await search('%')).toEqual([]);

    const updated = await call(s, 'PATCH', `/manager/customers/${fatima.id}`, {
      fullName: 'Fatima Al-Sabah',
      phone: '55551234',
      email: null,
      address: 'Salmiya, Block 10',
      status: 'inactive',
      version: fatima.version,
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ status: 'inactive', email: null, version: 2 });
    const stale = await call(s, 'PATCH', `/manager/customers/${fatima.id}`, {
      fullName: 'Old',
      version: fatima.version,
    });
    expect(stale.statusCode).toBe(409);
    expect(
      (await call(s, 'GET', '/manager/customers?status=inactive')).json().customers,
    ).toHaveLength(1);

    await call(s, 'POST', `/manager/customers/${fatima.id}/notes`, { body: 'Prefers delivery' });
    const notes = (
      await call(s, 'POST', `/manager/customers/${fatima.id}/notes`, { body: 'Allergic to nuts' })
    ).json().notes;
    expect(notes.map((n: { body: string }) => n.body)).toEqual([
      'Allergic to nuts',
      'Prefers delivery',
    ]);

    // Personal data never lands in the audit log; notes are append-only.
    const audit = await owner.query(
      `select action, details::text from audit_log where merchant_id = $1 and target_type = 'customer' order by occurred_at`,
      [s.c.merchantId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'customer.created',
      'customer.created',
      'customer.deactivated',
      'customer.note_added',
      'customer.note_added',
    ]);
    expect(audit.rows.some((r) => /5555|fatima|nuts/i.test(r.details))).toBe(false);
    const database = app.get(DatabaseService);
    for (const statement of [
      sql`update customer_notes set body = 'x'`,
      sql`delete from customer_notes`,
      sql`delete from customers`,
    ])
      await expect(
        database.withMerchantTx(s.c.merchantId, (tx) => tx.execute(statement)),
      ).rejects.toThrow();
  });
});

describe('customers at the POS', () => {
  it('links customers to sales, keeps walk-in sales, refuses inactive customers and shows only basic data', async () => {
    const s = await setup();
    const till = await cashier(s, s.c.roles.cashier);
    // A cashier may create a basic profile at the till.
    const made = await call(
      s,
      'POST',
      '/pos/customers',
      { fullName: 'Noura', phone: '9999 0000' },
      till,
    );
    expect(made.statusCode).toBe(201);
    expect(Object.keys(made.json()).sort()).toEqual(['code', 'fullName', 'id', 'phone', 'status']);
    const noura = made.json();

    const found = (await call(s, 'GET', '/pos/customers?q=9999', undefined, till)).json().customers;
    expect(found).toEqual([noura]);

    const withCustomer = await sell(s, till, '2', '0.500', { customerId: noura.id });
    expect(withCustomer.statusCode).toBe(201);
    expect(withCustomer.json().customer).toEqual({
      id: noura.id,
      code: noura.code,
      fullName: 'Noura',
    });
    const receipt = (
      await call(s, 'GET', `/pos/sales/${withCustomer.json().id}/receipt`, undefined, till)
    ).json();
    expect(receipt.sale.customer.fullName).toBe('Noura');

    const walkIn = await sell(s, till, '1', '0.250');
    expect(walkIn.statusCode).toBe(201);
    expect(walkIn.json().customer).toBeNull();

    // Held cart keeps its customer.
    const held = await call(
      s,
      'POST',
      '/pos/orders',
      { lines: [{ variantId: s.juice, quantity: '1' }], customerId: noura.id, label: 'Noura' },
      till,
    );
    expect(held.statusCode).toBe(201);
    expect(held.json().customer).toMatchObject({ id: noura.id });

    // Deactivated customers cannot be used for new sales and disappear from the till search.
    const full = (await call(s, 'GET', `/manager/customers/${noura.id}`)).json();
    await call(s, 'PATCH', `/manager/customers/${noura.id}`, {
      fullName: 'Noura',
      phone: full.phone,
      status: 'inactive',
      version: full.version,
    });
    const refused = await sell(s, till, '1', '0.250', { customerId: noura.id });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('CUSTOMER_INACTIVE');
    expect(
      (await call(s, 'GET', '/pos/customers?q=Noura', undefined, till)).json().customers,
    ).toEqual([]);
    // Nothing was sold by the refused attempt.
    const sales = (await call(s, 'GET', '/manager/sales')).json();
    expect(sales.total).toBe(2);
    expect(sales.sales.map((x: { customerName: string | null }) => x.customerName).sort()).toEqual([
      'Noura',
      null,
    ]);
  });

  it('enforces customer permissions at the till', async () => {
    const s = await setup();
    const role = (
      await call(s, 'POST', '/manager/roles', {
        nameEn: 'Seller only',
        permissions: ['pos.access', 'shifts.operate', 'sales.create'],
      })
    ).json();
    const till = await cashier(s, role.id);
    const customer = (await call(s, 'POST', '/manager/customers', { fullName: 'Hidden' })).json();
    expect((await call(s, 'GET', '/pos/customers?q=Hid', undefined, till)).statusCode).toBe(403);
    expect((await call(s, 'POST', '/pos/customers', { fullName: 'New' }, till)).statusCode).toBe(
      403,
    );
    expect((await sell(s, till, '1', '0.250', { customerId: customer.id })).statusCode).toBe(403);
    expect((await sell(s, till, '1', '0.250')).statusCode).toBe(201);
    // A POS session is not a management session.
    expect((await call(s, 'GET', '/manager/customers', undefined, till)).statusCode).toBe(401);
  });
});

describe('customer history', () => {
  it('derives purchase history, refunds and spending exactly, limited to the viewer’s branches', async () => {
    const s = await setup();
    const customer = (await call(s, 'POST', '/manager/customers', { fullName: 'Khalid' })).json();
    const mainTill = await cashier(s, s.c.roles.supervisor);
    const secondTill = await cashier(s, s.c.roles.cashier, s.c.second);
    const a = (await sell(s, mainTill, '3', '0.750', { customerId: customer.id })).json();
    await sell(s, mainTill, '1', '0.250', { customerId: customer.id });
    await sell(s, secondTill, '4', '1.000', { customerId: customer.id });
    await sell(s, mainTill, '2', '0.500'); // walk-in, not the customer's
    const refund = await call(
      s,
      'POST',
      '/pos/refunds',
      {
        idempotencyKey: newId(),
        saleId: a.id,
        reason: 'changed_mind',
        lines: [{ position: 0, quantity: '1' }],
      },
      mainTill,
    );
    expect(refund.statusCode).toBe(201);

    const view = (await call(s, 'GET', `/manager/customers/${customer.id}`)).json();
    expect(view.stats).toMatchObject({
      salesCount: 3,
      salesTotal: { amount: '2.000' },
      refundsCount: 1,
      refundedTotal: { amount: '0.250' },
      netTotal: { amount: '1.750' },
      // 2.000 / 3 = 0.6666… → 0.667 (half-up)
      averageSale: { amount: '0.667' },
    });
    expect(view.stats.lastPurchaseAt).not.toBeNull();
    const history = (await call(s, 'GET', `/manager/customers/${customer.id}/sales`)).json();
    expect(history.total).toBe(3);
    expect(history.totals).toMatchObject({ amount: { amount: '2.000' }, net: { amount: '1.750' } });
    const refunds = (await call(s, 'GET', `/manager/customers/${customer.id}/refunds`)).json()
      .refunds;
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      receiptNumber: a.receiptNumber,
      total: { amount: '0.250' },
    });

    // An exchange's new sale stays with the same customer.
    const exchange = await call(
      s,
      'POST',
      '/pos/exchanges',
      {
        idempotencyKey: newId(),
        saleId: a.id,
        reason: 'changed_mind',
        returnLines: [{ position: 0, quantity: '1' }],
        lines: [{ variantId: s.juice, quantity: '1' }],
        payments: [],
        expectedTotal: '0.250',
      },
      mainTill,
    );
    expect(exchange.statusCode, exchange.body).toBe(201);
    expect((await call(s, 'GET', `/manager/customers/${customer.id}/sales`)).json().total).toBe(4);

    // A branch manager of the second branch sees the profile but only that branch's history.
    const branchManager = await s.c.hire(
      [{ roleId: s.c.roles.branch_manager, branchId: s.c.second }],
      'manager',
    );
    const scoped = (
      await call(s, 'GET', `/manager/customers/${customer.id}`, undefined, branchManager.cookies)
    ).json();
    expect(scoped.stats).toMatchObject({
      salesCount: 1,
      salesTotal: { amount: '1.000' },
      refundsCount: 0,
    });
    expect(
      (
        await call(
          s,
          'GET',
          `/manager/customers/${customer.id}/sales`,
          undefined,
          branchManager.cookies,
        )
      ).json().total,
    ).toBe(1);
    expect(
      (
        await call(
          s,
          'GET',
          `/manager/customers/${customer.id}/refunds`,
          undefined,
          branchManager.cookies,
        )
      ).json().refunds,
    ).toEqual([]);
  });
});

describe('tenant isolation', () => {
  it('never shows or links another merchant’s customers', async () => {
    const a = await setup();
    const b = await setup();
    const customer = (
      await call(a, 'POST', '/manager/customers', { fullName: 'Private', phone: '6000 0000' })
    ).json();
    expect((await call(b, 'GET', `/manager/customers/${customer.id}`)).statusCode).toBe(404);
    expect((await call(b, 'GET', '/manager/customers?q=Private')).json().customers).toEqual([]);
    expect(
      (
        await call(b, 'PATCH', `/manager/customers/${customer.id}`, {
          fullName: 'Hack',
          version: 1,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await call(b, 'POST', `/manager/customers/${customer.id}/notes`, { body: 'x' })).statusCode,
    ).toBe(404);
    // The same phone may exist at another merchant.
    expect(
      (await call(b, 'POST', '/manager/customers', { fullName: 'Other', phone: '6000 0000' }))
        .statusCode,
    ).toBe(201);
    const till = await cashier(b, b.c.roles.cashier);
    const sale = await sell(b, till, '1', '0.250', { customerId: customer.id });
    expect(sale.statusCode).toBe(404);
    const database = app.get(DatabaseService);
    const rows = await database.withMerchantTx(b.c.merchantId, (tx) =>
      tx.execute(sql`select id from customers where id = ${customer.id}`),
    );
    expect(rows.rows).toEqual([]);
  });
});
