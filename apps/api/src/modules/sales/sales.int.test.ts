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

/** A company with one product in stock at the main branch and payment method ids. */
async function store(stock = '10', price = '1.250', cost = '0.500') {
  const c = await createCompany(app, db, mailer);
  const product = (
    await c.client.request('POST', '/manager/products', {
      cookies: c.cookies,
      body: {
        nameEn: 'Karak tea',
        nameAr: 'شاي كرك',
        variants: [{ sku: `T-${newId().slice(-6)}`, price, cost, barcodes: [] }],
      },
    })
  ).json();
  const variantId = product.variants[0].id as string;
  await c.client.request('POST', '/manager/inventory/adjustments', {
    cookies: c.cookies,
    body: {
      branchId: c.main,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId, quantity: stock }],
    },
  });
  const methods = (
    await c.client.request('GET', '/manager/payment-methods', { cookies: c.cookies })
  ).json().methods as { id: string; kind: string; version: number }[];
  const cash = methods.find((m) => m.kind === 'cash')!.id;
  const card = methods.find((m) => m.kind === 'card')!;
  const registers = (
    await c.client.request('GET', `/manager/registers?branchId=${c.main}`, { cookies: c.cookies })
  ).json().registers as { id: string }[];
  return { c, variantId, productId: product.id as string, cash, card, register: registers[0]!.id };
}
type Store = Awaited<ReturnType<typeof store>>;

async function cashierWithShift(
  s: Store,
  role: keyof Co['roles'] = 'cashier',
  registerId = s.register,
) {
  const emp = await s.c.hire([{ roleId: s.c.roles[role], branchId: s.c.main }], 'pos');
  const opened = await s.c.client.request('POST', '/pos/shifts', {
    cookies: emp.cookies,
    body: { registerId, countedCash: '10.000', expectedCash: '0.000' },
  });
  if (opened.statusCode !== 201) throw new Error(opened.body);
  return { cookies: emp.cookies, shiftId: opened.json().id as string };
}

function checkout(s: Store, cookies: Cookies, body: Record<string, unknown>) {
  return s.c.client.request('POST', '/pos/sales', {
    cookies,
    body: { idempotencyKey: newId(), ...body },
  });
}

const line = (s: Store, quantity = '1', extra: Record<string, unknown> = {}) => ({
  variantId: s.variantId,
  quantity,
  ...extra,
});

async function onHand(s: Store) {
  const res = await s.c.client.request('GET', `/manager/inventory/variants/${s.variantId}`, {
    cookies: s.c.cookies,
  });
  return res.json().branches.find((b: { branchId: string }) => b.branchId === s.c.main)
    .onHand as string;
}

describe('checkout', () => {
  it('completes a cash sale: exact totals, change, receipt, one stock movement, shift cash and manager view', async () => {
    const s = await store();
    const { cookies, shiftId } = await cashierWithShift(s);
    const res = await checkout(s, cookies, {
      lines: [line(s, '2')],
      payments: [{ methodId: s.cash, amount: '2.500', tendered: '5' }],
      expectedTotal: '2.500',
    });
    expect(res.statusCode).toBe(201);
    const sale = res.json();
    expect(sale).toMatchObject({
      receiptNumber: 'MAIN-000001',
      shiftId,
      registerId: s.register,
      subtotal: { amount: '2.500' },
      total: { amount: '2.500' },
      paid: { amount: '2.500' },
      change: { amount: '2.500' },
      lines: [{ quantity: '2.000', unitPrice: { amount: '1.250' }, net: { amount: '2.500' } }],
      payments: [
        {
          kind: 'cash',
          amount: { amount: '2.500' },
          tendered: { amount: '5.000' },
          status: 'succeeded',
          verification: 'manual',
        },
      ],
    });
    // The POS never sees fees or costs.
    expect(res.body).not.toMatch(/"fee|"cost/);
    expect(await onHand(s)).toBe('8.000');
    const movements = await owner.query(
      `select movement_type, quantity::text, source_type, source_id from stock_movements
       where merchant_id = $1 and movement_type = 'sale'`,
      [s.c.merchantId],
    );
    expect(movements.rows).toEqual([
      { movement_type: 'sale', quantity: '-2.000', source_type: 'sale', source_id: sale.id },
    ]);

    const current = (await s.c.client.request('GET', '/pos/shifts/current', { cookies })).json()
      .shift;
    expect(current.summary).toMatchObject({
      cashSales: { amount: '2.500' },
      expectedCash: { amount: '12.500' },
    });

    const second = await checkout(s, cookies, {
      lines: [line(s)],
      payments: [{ methodId: s.cash, amount: '1.250' }],
      expectedTotal: '1.250',
    });
    expect(second.json().receiptNumber).toBe('MAIN-000002');
    const recent = (await s.c.client.request('GET', '/pos/sales/recent', { cookies })).json().sales;
    expect(recent.map((r: { receiptNumber: string }) => r.receiptNumber)).toEqual([
      'MAIN-000002',
      'MAIN-000001',
    ]);

    const receipt = (
      await s.c.client.request('GET', `/pos/sales/${sale.id}/receipt`, { cookies })
    ).json();
    expect(receipt).toMatchObject({
      branch: { nameEn: 'Main branch' },
      register: { code: 'R1' },
      sale: { receiptNumber: 'MAIN-000001' },
    });

    const list = (
      await s.c.client.request('GET', '/manager/sales', { cookies: s.c.cookies })
    ).json();
    expect(list.totals).toEqual({
      count: 2,
      amount: { amount: '3.750', currency: 'KWD' },
      refunded: { amount: '0.000', currency: 'KWD' },
      net: { amount: '3.750', currency: 'KWD' },
    });
    const detail = (
      await s.c.client.request('GET', `/manager/sales/${sale.id}`, { cookies: s.c.cookies })
    ).json();
    expect(detail).toMatchObject({ cost: { amount: '1.000' }, fees: { amount: '0.000' } });

    const audit = await owner.query(
      `select details->>'receiptNumber' as r from audit_log where merchant_id = $1 and action = 'sale.completed' order by occurred_at`,
      [s.c.merchantId],
    );
    expect(audit.rows.map((r) => r.r)).toEqual(['MAIN-000001', 'MAIN-000002']);
  });

  it('splits payments, stores fees per payment and posts linked balance entries', async () => {
    const s = await store('10', '10.000');
    const account = (
      await s.c.client.request('POST', '/manager/financial-accounts', {
        cookies: s.c.cookies,
        body: { nameEn: 'KNET clearing', kind: 'card_clearing' },
      })
    ).json();
    const cardFull = (
      await s.c.client.request('GET', '/manager/payment-methods', { cookies: s.c.cookies })
    )
      .json()
      .methods.find((m: { kind: string }) => m.kind === 'card');
    await s.c.client.request('PATCH', `/manager/payment-methods/${cardFull.id}`, {
      cookies: s.c.cookies,
      body: {
        ...cardFull,
        feeFixed: '0',
        feeType: 'percentage',
        feePercent: '1.75',
        financialAccountId: account.id,
      },
    });
    const { cookies } = await cashierWithShift(s);
    const res = await checkout(s, cookies, {
      lines: [line(s, '3')],
      payments: [
        { methodId: s.cash, amount: '7.333', tendered: '10' },
        { methodId: cardFull.id, amount: '22.667', reference: 'AUTH123' },
      ],
      expectedTotal: '30.000',
    });
    expect(res.statusCode).toBe(201);
    const detail = (
      await s.c.client.request('GET', `/manager/sales/${res.json().id}`, { cookies: s.c.cookies })
    ).json();
    // 1.75 % of 22.667 = 0.39667… → 0.397
    expect(detail.payments.map((p: { fee: { amount: string } }) => p.fee.amount)).toEqual([
      '0.000',
      '0.397',
    ]);
    expect(detail.fees.amount).toBe('0.397');
    expect(detail.change.amount).toBe('2.667');
    const accounts = (
      await s.c.client.request('GET', '/manager/financial-accounts', { cookies: s.c.cookies })
    ).json().accounts as { id: string; kind: string; balance: { amount: string } }[];
    // The card payment net of its fee lands in the linked balance…
    expect(accounts.find((x) => x.id === account.id)!.balance.amount).toBe('22.270');
    // …and the cash payment (net of change) in the drawer of the register that took it
    // (ADR-0090): 10.000 counted at opening + 7.333.
    const overview = (
      await s.c.client.request('GET', '/manager/cash/overview', { cookies: s.c.cookies })
    ).json();
    const main = overview.branches.find((b: { branchId: string }) => b.branchId === s.c.main);
    expect(main.registers[0].balance.amount).toBe('17.333');
    expect(main.treasury.balance.amount).toBe('0.000');
  });

  it('never creates two sales for retried or concurrent duplicates of one checkout', async () => {
    const s = await store('5');
    const { cookies } = await cashierWithShift(s);
    const body = {
      idempotencyKey: newId(),
      lines: [line(s, '2')],
      payments: [{ methodId: s.cash, amount: '2.500' }],
      expectedTotal: '2.500',
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => s.c.client.request('POST', '/pos/sales', { cookies, body })),
    );
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    expect(new Set(results.map((r) => r.json().id)).size).toBe(1);
    expect(await onHand(s)).toBe('3.000');
    const counts = await owner.query(
      `select (select count(*)::int from sales where merchant_id = $1) as sales,
              (select count(*)::int from payments where merchant_id = $1) as payments,
              (select count(*)::int from stock_movements where merchant_id = $1 and movement_type = 'sale') as moves`,
      [s.c.merchantId],
    );
    expect(counts.rows[0]).toEqual({ sales: 1, payments: 1, moves: 1 });
    const reuse = await s.c.client.request('POST', '/pos/sales', {
      cookies,
      body: {
        ...body,
        lines: [line(s, '1')],
        payments: [{ methodId: s.cash, amount: '1.250' }],
        expectedTotal: '1.250',
      },
    });
    expect(reuse.json().code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('sells the last unit exactly once when two registers check out concurrently', async () => {
    const s = await store('1');
    const r2 = (
      await s.c.client.request('POST', '/manager/registers', {
        cookies: s.c.cookies,
        body: { branchId: s.c.main, code: 'R2', nameEn: 'Register 2' },
      })
    ).json().id;
    const a = await cashierWithShift(s);
    const b = await cashierWithShift(s, 'cashier', r2);
    const body = {
      lines: [line(s)],
      payments: [{ methodId: s.cash, amount: '1.250' }],
      expectedTotal: '1.250',
    };
    const [x, y] = await Promise.all([checkout(s, a.cookies, body), checkout(s, b.cookies, body)]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([201, 409]);
    expect([x, y].find((r) => r.statusCode === 409)!.json().code).toBe('INSUFFICIENT_STOCK');
    expect(await onHand(s)).toBe('0.000');
    // The failed checkout left nothing behind (all-or-nothing).
    const counts = await owner.query(
      `select (select count(*)::int from sales where merchant_id = $1) as sales,
              (select count(*)::int from orders where merchant_id = $1) as orders,
              (select count(*)::int from payments where merchant_id = $1) as payments`,
      [s.c.merchantId],
    );
    expect(counts.rows[0]).toEqual({ sales: 1, orders: 1, payments: 1 });
  });

  it('refuses insufficient stock without side effects', async () => {
    const s = await store('2');
    const { cookies } = await cashierWithShift(s);
    const res = await checkout(s, cookies, {
      lines: [line(s, '3')],
      payments: [{ methodId: s.cash, amount: '3.750' }],
      expectedTotal: '3.750',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('INSUFFICIENT_STOCK');
    expect(await onHand(s)).toBe('2.000');
    const seq = await owner.query(
      'select count(*)::int as n from receipt_sequences where merchant_id = $1',
      [s.c.merchantId],
    );
    expect(seq.rows[0].n).toBe(0);
  });
});

describe('discounts, overrides and payments validation', () => {
  it('rejects invalid discounts and enforces the discount limit', async () => {
    const s = await store('20', '10.000');
    const { cookies } = await cashierWithShift(s);
    const base = { payments: [{ methodId: s.cash, amount: '10.000' }], expectedTotal: '10.000' };
    for (const discount of [
      { type: 'percent', value: '101' },
      { type: 'percent', value: '1.234' },
      { type: 'amount', value: '10.001' },
      { type: 'amount', value: '0.0001' },
      { type: 'amount', value: '-1' },
    ]) {
      const res = await checkout(s, cookies, { ...base, lines: [line(s, '1', { discount })] });
      expect(res.statusCode, JSON.stringify(discount)).toBe(400);
    }
    // Within the default 10 % limit
    const ok = await checkout(s, cookies, {
      lines: [line(s, '1', { discount: { type: 'percent', value: '10' } })],
      payments: [{ methodId: s.cash, amount: '9.000' }],
      expectedTotal: '9.000',
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().lineDiscounts.amount).toBe('1.000');
    // Above the limit (line and order level)
    const line15 = await checkout(s, cookies, {
      lines: [line(s, '1', { discount: { type: 'percent', value: '15' } })],
      payments: [{ methodId: s.cash, amount: '8.500' }],
      expectedTotal: '8.500',
    });
    expect(line15.json().code).toBe('DISCOUNT_LIMIT_EXCEEDED');
    const order = await checkout(s, cookies, {
      lines: [line(s, '1')],
      orderDiscount: { type: 'amount', value: '1.001' },
      payments: [{ methodId: s.cash, amount: '8.999' }],
      expectedTotal: '8.999',
    });
    expect(order.json().code).toBe('DISCOUNT_LIMIT_EXCEEDED');
    // A supervisor may exceed the limit.
    const sup = await cashierWithShift(
      s,
      'supervisor',
      (
        await s.c.client.request('POST', '/manager/registers', {
          cookies: s.c.cookies,
          body: { branchId: s.c.main, code: 'R3', nameEn: 'R3' },
        })
      ).json().id,
    );
    const big = await checkout(s, sup.cookies, {
      lines: [line(s, '1', { discount: { type: 'percent', value: '100' } })],
      payments: [],
      expectedTotal: '0',
    });
    expect(big.statusCode).toBe(201);
    expect(big.json().total.amount).toBe('0.000');
  });

  it('allows price overrides only with the permission, and audits them', async () => {
    const s = await store('20', '2.000');
    const cashier = await cashierWithShift(s);
    const denied = await checkout(s, cashier.cookies, {
      lines: [line(s, '1', { priceOverride: '1.500' })],
      payments: [{ methodId: s.cash, amount: '1.500' }],
      expectedTotal: '1.500',
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('PRICE_OVERRIDE_DENIED');
    const r2 = (
      await s.c.client.request('POST', '/manager/registers', {
        cookies: s.c.cookies,
        body: { branchId: s.c.main, code: 'R2', nameEn: 'R2' },
      })
    ).json().id;
    const sup = await cashierWithShift(s, 'supervisor', r2);
    const ok = await checkout(s, sup.cookies, {
      lines: [line(s, '2', { priceOverride: '1.500' })],
      payments: [{ methodId: s.cash, amount: '3.000' }],
      expectedTotal: '3.000',
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().lines[0]).toMatchObject({
      listUnitPrice: { amount: '2.000' },
      unitPrice: { amount: '1.500' },
      priceOverridden: true,
    });
    const audit = await owner.query(
      `select details->'priceOverrides' as o from audit_log where merchant_id = $1 and action = 'sale.completed'`,
      [s.c.merchantId],
    );
    expect(audit.rows[0].o).toEqual([{ variantId: s.variantId, from: '2.000', to: '1.500' }]);
  });

  it('refuses incorrect payment totals and changed prices', async () => {
    const s = await store('20', '1.000');
    const { cookies } = await cashierWithShift(s);
    const cases: [Record<string, unknown>[], string][] = [
      [[{ methodId: s.cash, amount: '0.999' }], 'PAYMENT_TOTAL_MISMATCH'],
      [[{ methodId: s.card.id, amount: '1.500' }], 'PAYMENT_TOTAL_MISMATCH'],
      [[{ methodId: s.cash, amount: '1.000', tendered: '0.500' }], 'PAYMENT_TOTAL_MISMATCH'],
      [[{ methodId: s.card.id, amount: '1.000', tendered: '2' }], 'PAYMENT_TOTAL_MISMATCH'],
      [[], 'PAYMENT_TOTAL_MISMATCH'],
      [[{ methodId: newId(), amount: '1.000' }], 'PAYMENT_METHOD_UNAVAILABLE'],
    ];
    for (const [pays, code] of cases) {
      const res = await checkout(s, cookies, {
        lines: [line(s)],
        payments: pays,
        expectedTotal: '1.000',
      });
      expect(res.json().code, JSON.stringify(pays)).toBe(code);
    }
    // The cashier's screen showed an old price.
    const stale = await checkout(s, cookies, {
      lines: [line(s)],
      payments: [{ methodId: s.cash, amount: '0.900' }],
      expectedTotal: '0.900',
    });
    expect(stale.json().code).toBe('TOTAL_CHANGED');
    // Gateway methods cannot complete a sale without verification (no gateway yet).
    const gw = (
      await s.c.client.request('POST', '/manager/payment-methods', {
        cookies: s.c.cookies,
        body: { kind: 'card', nameEn: 'Online card', gatewayProvider: 'tap' },
      })
    ).json();
    const unverified = await checkout(s, cookies, {
      lines: [line(s)],
      payments: [{ methodId: gw.id, amount: '1.000' }],
      expectedTotal: '1.000',
    });
    expect(unverified.json().code).toBe('PAYMENT_NOT_VERIFIED');
    expect(await onHand(s)).toBe('20.000');
  });

  it('keeps fils exact with fractional quantities and an order discount', async () => {
    const s = await store('20', '0.333');
    const sup = await cashierWithShift(s, 'supervisor');
    // 1.5 × 0.333 = 0.4995 → 0.500; 2 × 0.333 = 0.666; total 1.166; 10 % order discount = 0.117 (half-up 0.1166)
    const res = await checkout(s, sup.cookies, {
      lines: [line(s, '1.5'), line(s, '2')],
      orderDiscount: { type: 'percent', value: '10' },
      payments: [{ methodId: s.cash, amount: '1.049' }],
      expectedTotal: '1.049',
    });
    expect(res.statusCode).toBe(201);
    const sale = res.json();
    expect(sale).toMatchObject({
      subtotal: { amount: '1.166' },
      orderDiscount: { amount: '0.117' },
      total: { amount: '1.049' },
    });
    const sumNet = sale.lines.reduce(
      (t: bigint, l: { net: { amount: string } }) => t + BigInt(l.net.amount.replace('.', '')),
      0n,
    );
    expect(sumNet).toBe(1049n);
    expect(await onHand(s)).toBe('16.500');
  });
});

describe('context and restrictions', () => {
  it('requires an open shift and keeps sales to the session branch', async () => {
    const s = await store();
    const noShift = await s.c.hire([{ roleId: s.c.roles.cashier, branchId: s.c.main }], 'pos');
    const res = await checkout(s, noShift.cookies, {
      lines: [line(s)],
      payments: [{ methodId: s.cash, amount: '1.250' }],
      expectedTotal: '1.250',
    });
    expect(res.json().code).toBe('SHIFT_REQUIRED');

    // A product only sold at the second branch cannot be sold at main.
    const other = (
      await s.c.client.request('POST', '/manager/products', {
        cookies: s.c.cookies,
        body: {
          nameEn: 'Mall only',
          availableInAllBranches: false,
          branchIds: [s.c.second],
          variants: [{ price: '1.000' }],
        },
      })
    ).json();
    const { cookies } = await cashierWithShift(s);
    const unavailable = await checkout(s, cookies, {
      lines: [{ variantId: other.variants[0].id, quantity: '1' }],
      payments: [{ methodId: s.cash, amount: '1.000' }],
      expectedTotal: '1.000',
    });
    expect(unavailable.json().code).toBe('ITEM_UNAVAILABLE');

    const sale = (
      await checkout(s, cookies, {
        lines: [line(s)],
        payments: [{ methodId: s.cash, amount: '1.250' }],
        expectedTotal: '1.250',
      })
    ).json();
    // A cashier of another branch and a branch manager of another branch cannot read it.
    const atSecond = await s.c.hire([{ roleId: s.c.roles.cashier, branchId: s.c.second }], 'pos');
    expect(
      (
        await s.c.client.request('GET', `/pos/sales/${sale.id}/receipt`, {
          cookies: atSecond.cookies,
        })
      ).statusCode,
    ).toBe(404);
    const bm = await s.c.hire(
      [{ roleId: s.c.roles.branch_manager, branchId: s.c.second }],
      'manager',
    );
    expect(
      (await s.c.client.request('GET', `/manager/sales/${sale.id}`, { cookies: bm.cookies }))
        .statusCode,
    ).toBe(403);
    expect(
      (await s.c.client.request('GET', '/manager/sales', { cookies: bm.cookies })).json().total,
    ).toBe(0);
    // Cashiers cannot use the manager API.
    expect(
      (
        await s.c.client.request('GET', '/manager/sales', {
          cookies: { mgr_sid: cookies.pos_sid! },
        })
      ).statusCode,
    ).toBe(401);
    // Another merchant sees nothing.
    const x = await store();
    expect(
      (await x.c.client.request('GET', `/manager/sales/${sale.id}`, { cookies: x.c.cookies }))
        .statusCode,
    ).toBe(404);
  });

  it('suspends, resumes and completes a cart exactly once; sales are immutable', async () => {
    const s = await store();
    const { cookies } = await cashierWithShift(s);
    const suspended = await s.c.client.request('POST', '/pos/orders', {
      cookies,
      body: { lines: [line(s, '2')], label: 'Table 4' },
    });
    expect(suspended.statusCode).toBe(201);
    const list = (await s.c.client.request('GET', '/pos/orders/suspended', { cookies })).json()
      .orders;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ label: 'Table 4', lines: [{ quantity: '2.000' }] });
    const orderId = list[0].id;
    // Suspending reserves nothing.
    expect(await onHand(s)).toBe('10.000');
    const done = await checkout(s, cookies, {
      orderId,
      lines: [line(s, '2')],
      payments: [{ methodId: s.cash, amount: '2.500' }],
      expectedTotal: '2.500',
    });
    expect(done.statusCode).toBe(201);
    expect(done.json().orderId).toBe(orderId);
    const again = await checkout(s, cookies, {
      orderId,
      lines: [line(s, '2')],
      payments: [{ methodId: s.cash, amount: '2.500' }],
      expectedTotal: '2.500',
    });
    expect(again.json().code).toBe('ORDER_NOT_SUSPENDED');
    expect(
      (await s.c.client.request('GET', '/pos/orders/suspended', { cookies })).json().orders,
    ).toHaveLength(0);

    const database = app.get(DatabaseService);
    for (const statement of [
      sql`update sales set total_minor = 1`,
      sql`delete from payments`,
      sql`update sale_lines set net_minor = 0`,
      sql`update orders set status = 'suspended'`,
    ]) {
      await expect(
        database.withMerchantTx(s.c.merchantId, (tx) => tx.execute(statement)),
      ).rejects.toThrow();
    }
  });
});
