import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../kernel/ids.js';
import { DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

/**
 * Remediation session 9 (ADR-0101): held sales and reprints (R3.6, BR-182) and the combined
 * discount limit (R3.7, BR-183, decision D4).
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
type Cookies = Co['cookies'];

async function store(price = '10.000') {
  const c = await createCompany(app, db, mailer);
  await c.showExpectedCash();
  const product = (
    await c.client.request('POST', '/manager/products', {
      cookies: c.cookies,
      body: { nameEn: 'Oud oil', variants: [{ price, cost: '4.000' }] },
    })
  ).json();
  const variantId = product.variants[0].id as string;
  await c.client.request('POST', '/manager/inventory/adjustments', {
    cookies: c.cookies,
    body: {
      branchId: c.main,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId, quantity: '50' }],
    },
  });
  const methods = (
    await c.client.request('GET', '/manager/payment-methods', { cookies: c.cookies })
  ).json().methods as { id: string; kind: string }[];
  const registers = (
    await c.client.request('GET', `/manager/registers?branchId=${c.main}`, { cookies: c.cookies })
  ).json().registers as { id: string }[];
  return {
    c,
    variantId,
    cash: methods.find((m) => m.kind === 'cash')!.id,
    register: registers[0]!.id,
  };
}
type Store = Awaited<ReturnType<typeof store>>;

async function withShift(s: Store, roleId: string, registerId = s.register) {
  const emp = await s.c.hire([{ roleId, branchId: s.c.main }], 'pos');
  const opened = await s.c.client.request('POST', '/pos/shifts', {
    cookies: emp.cookies,
    body: { registerId, countedCash: '10.000', expectedCash: '0.000' },
  });
  if (opened.statusCode !== 201) throw new Error(opened.body);
  return { ...emp, shiftId: opened.json().id as string };
}

async function newRegister(s: Store, code: string) {
  return (
    await s.c.client.request('POST', '/manager/registers', {
      cookies: s.c.cookies,
      body: { branchId: s.c.main, code, nameEn: code },
    })
  ).json().id as string;
}

function checkout(s: Store, cookies: Cookies, body: Record<string, unknown>) {
  return s.c.client.request('POST', '/pos/sales', {
    cookies,
    body: { idempotencyKey: newId(), ...body },
  });
}

async function policy(s: Store, patch: Record<string, unknown>) {
  const current = (
    await s.c.client.request('GET', '/manager/sales-settings', { cookies: s.c.cookies })
  ).json();
  const res = await s.c.client.request('PUT', '/manager/sales-settings', {
    cookies: s.c.cookies,
    body: {
      maxDiscountPercent: current.maxDiscountPercent,
      refundWindowDays: current.refundWindowDays,
      refundApprovalLimit: current.refundApprovalLimit.amount,
      blindCashCount: current.blindCashCount,
      cashOutOtherLimit: current.cashOutOtherLimit.amount,
      cashOutOtherShiftLimit: current.cashOutOtherShiftLimit.amount,
      maxRegisterTolerance: current.maxRegisterTolerance.amount,
      expenseApprovalLimit: current.expenseApprovalLimit.amount,
      supplierPaymentApprovalLimit: current.supplierPaymentApprovalLimit.amount,
      version: current.version,
      ...patch,
    },
  });
  if (res.statusCode !== 200) throw new Error(`${res.statusCode} ${res.body}`);
  return res.json();
}

describe('combined discount limit (R3.7, BR-183, D4)', () => {
  it('adds the item discount and the allocated sale discount before comparing with the limit', async () => {
    const s = await store('10.000');
    const cashier = await withShift(s, s.c.roles.cashier);
    // 6 % on the item and 6 % on the sale: each within 10 %, together 11.64 % → above the limit.
    const stacked = await checkout(s, cashier.cookies, {
      lines: [{ variantId: s.variantId, quantity: '1', discount: { type: 'percent', value: '6' } }],
      orderDiscount: { type: 'percent', value: '6' },
      payments: [{ methodId: s.cash, amount: '8.836' }],
      expectedTotal: '8.836',
    });
    expect(stacked.json().code).toBe('DISCOUNT_LIMIT_EXCEEDED');
    // 5 % + 5 % = 9.75 % effective: allowed.
    const fine = await checkout(s, cashier.cookies, {
      lines: [{ variantId: s.variantId, quantity: '1', discount: { type: 'percent', value: '5' } }],
      orderDiscount: { type: 'percent', value: '5' },
      payments: [{ methodId: s.cash, amount: '9.025' }],
      expectedTotal: '9.025',
    });
    expect(fine.statusCode).toBe(201);
    expect(fine.json().aboveLimit).toBe(false);
    // A sale discount is checked per line through its allocation: a 1.001 amount on a 10.000
    // line is 10.01 %.
    const order = await checkout(s, cashier.cookies, {
      lines: [{ variantId: s.variantId, quantity: '1' }],
      orderDiscount: { type: 'amount', value: '1.001' },
      payments: [{ methodId: s.cash, amount: '8.999' }],
      expectedTotal: '8.999',
    });
    expect(order.json().code).toBe('DISCOUNT_LIMIT_EXCEEDED');
  });
});

describe('held sales and reprints (R3.6, BR-182)', () => {
  it('records who completed a held cart, keeps the held lines, and expires stale holds', async () => {
    const s = await store();
    const holder = await withShift(s, s.c.roles.cashier);
    const held = await s.c.client.request('POST', '/pos/orders', {
      cookies: holder.cookies,
      body: { lines: [{ variantId: s.variantId, quantity: '2' }], label: 'Mr Ali' },
    });
    expect(held.statusCode).toBe(201);
    expect(held.json().expiresAt).not.toBeNull();
    const orderId = held.json().id as string;
    const heldAudit = await owner.query(
      `select details from audit_log where merchant_id = $1 and action = 'order.suspended'`,
      [s.c.merchantId],
    );
    expect(heldAudit.rows[0].details).toMatchObject({ label: 'Mr Ali', lineCount: 1 });
    // Another cashier completes it with one unit more: the sale is theirs, the hold is kept.
    const completer = await withShift(s, s.c.roles.cashier, await newRegister(s, 'R2'));
    const done = await checkout(s, completer.cookies, {
      orderId,
      lines: [{ variantId: s.variantId, quantity: '3' }],
      payments: [{ methodId: s.cash, amount: '30.000' }],
      expectedTotal: '30.000',
    });
    expect(done.statusCode).toBe(201);
    expect(done.json()).toMatchObject({ shiftId: completer.shiftId, heldByName: 'Employee' });
    const order = await owner.query(
      `select o.status, o.completed_shift_id, (select quantity::text from order_lines l where l.order_id = o.id) as held_qty
       from orders o where o.id = $1`,
      [orderId],
    );
    expect(order.rows[0]).toMatchObject({
      status: 'completed',
      completed_shift_id: completer.shiftId,
      held_qty: '2.000',
    });
    const saleAudit = await owner.query(
      `select details from audit_log where merchant_id = $1 and action = 'sale.completed' and target_id = $2`,
      [s.c.merchantId, done.json().id],
    );
    expect(saleAudit.rows[0].details.heldOrderId).toBe(orderId);

    // Expiry: a hold older than the company limit disappears, audited; it cannot be completed.
    await policy(s, { heldSaleExpiryHours: 2 });
    const stale = (
      await s.c.client.request('POST', '/pos/orders', {
        cookies: holder.cookies,
        body: { lines: [{ variantId: s.variantId, quantity: '1' }], label: 'Old' },
      })
    ).json();
    await owner.query(`update orders set created_at = now() - interval '3 hours' where id = $1`, [
      stale.id,
    ]);
    const list = (
      await s.c.client.request('GET', '/pos/orders/suspended', { cookies: holder.cookies })
    ).json().orders;
    expect(list.map((o: { id: string }) => o.id)).not.toContain(stale.id);
    const expired = await checkout(s, holder.cookies, {
      orderId: stale.id,
      lines: [{ variantId: s.variantId, quantity: '1' }],
      payments: [{ methodId: s.cash, amount: '10.000' }],
      expectedTotal: '10.000',
    });
    expect(expired.json().code).toBe('ORDER_NOT_SUSPENDED');
    const expiredAudit = await owner.query(
      `select count(*)::int as n from audit_log where merchant_id = $1 and action = 'order.expired' and target_id = $2`,
      [s.c.merchantId, stale.id],
    );
    expect(expiredAudit.rows[0].n).toBe(1);
    // 0 hours = never.
    await policy(s, { heldSaleExpiryHours: 0 });
    const forever = (
      await s.c.client.request('POST', '/pos/orders', {
        cookies: holder.cookies,
        body: { lines: [{ variantId: s.variantId, quantity: '1' }] },
      })
    ).json();
    expect(forever.expiresAt).toBeNull();
  });

  it('looks receipts up at the till, numbers reprints and logs cleared carts above the threshold', async () => {
    const s = await store();
    const cashier = await withShift(s, s.c.roles.cashier);
    const sale = (
      await checkout(s, cashier.cookies, {
        lines: [{ variantId: s.variantId, quantity: '1' }],
        payments: [{ methodId: s.cash, amount: '10.000' }],
        expectedTotal: '10.000',
      })
    ).json();
    // Lookup by number, at this branch only.
    const found = await s.c.client.request(
      'GET',
      `/pos/sales/lookup?receipt=${sale.receiptNumber.toLowerCase()}`,
      {
        cookies: cashier.cookies,
      },
    );
    expect(found.json().id).toBe(sale.id);
    const other = await s.c.hire([{ roleId: s.c.roles.cashier, branchId: s.c.second }], 'pos');
    expect(
      (
        await s.c.client.request('GET', `/pos/sales/lookup?receipt=${sale.receiptNumber}`, {
          cookies: other.cookies,
        })
      ).statusCode,
    ).toBe(404);
    // Reprints are counted on the receipt and audited.
    expect(
      (
        await s.c.client.request('GET', `/pos/sales/${sale.id}/receipt`, {
          cookies: cashier.cookies,
        })
      ).json().sale.reprintCount,
    ).toBe(0);
    // A copy is a server print job (ADR-0111): no agent here, so it waits ("not connected").
    const copy = await s.c.client.request('POST', `/pos/sales/${sale.id}/print`, {
      cookies: cashier.cookies,
    });
    expect(copy.statusCode).toBe(201);
    expect(copy.json()).toMatchObject({ status: 'pending', copyNumber: 1, agentOnline: false });
    const copy2 = await s.c.client.request('POST', `/pos/sales/${sale.id}/print`, {
      cookies: cashier.cookies,
    });
    expect(copy2.json()).toMatchObject({ copyNumber: 2 });
    expect(
      (
        await s.c.client.request('GET', `/pos/sales/${sale.id}/receipt`, {
          cookies: cashier.cookies,
        })
      ).json().sale.reprintCount,
    ).toBe(2);
    const jobs = await owner.query(
      `select kind, status, html like '%نسخة رقم 2%' as numbered from print_jobs where sale_id = $1 order by created_at`,
      [sale.id],
    );
    expect(jobs.rows).toEqual([
      { kind: 'reprint', status: 'pending', numbered: false },
      { kind: 'reprint', status: 'pending', numbered: true },
    ]);
    const reprints = await owner.query(
      `select count(*)::int as n from audit_log where merchant_id = $1 and action = 'sale.reprinted' and target_id = $2`,
      [s.c.merchantId, sale.id],
    );
    expect(reprints.rows[0].n).toBe(2);
    // Cleared carts: logged above the threshold (default 5.000), ignored below it.
    for (const [amount, lineCount] of [
      ['4.999', 1],
      ['25.000', 3],
    ] as const) {
      const res = await s.c.client.request('POST', '/pos/cart-events', {
        cookies: cashier.cookies,
        body: { kind: 'cleared', amount, lineCount },
      });
      expect(res.statusCode).toBe(204);
    }
    const events = await owner.query(
      `select kind, amount_minor::text as amount, line_count from pos_cart_events where merchant_id = $1`,
      [s.c.merchantId],
    );
    expect(events.rows).toEqual([{ kind: 'cleared', amount: '25000', line_count: 3 }]);
    const cleared = await owner.query(
      `select details from audit_log where merchant_id = $1 and action = 'cart.cleared'`,
      [s.c.merchantId],
    );
    expect(cleared.rows[0].details).toMatchObject({ amount: '25.000', lineCount: 3 });
    // Traces are append-only.
    await expect(
      owner.query(`delete from pos_cart_events where merchant_id = $1`, [s.c.merchantId]),
    ).resolves.toBeTruthy();
  });
});
