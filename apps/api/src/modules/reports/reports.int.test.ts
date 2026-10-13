import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

/** Today in the merchant's zone (Asia/Kuwait, UTC+3, no DST). */
const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const minor = (m: { amount: string }) => BigInt(m.amount.replace('.', ''));
const sumOf = <T>(rows: T[], f: (r: T) => { amount: string }) =>
  rows.reduce((s, r) => s + minor(f(r)), 0n);
const fils = (v: bigint) => {
  const sign = v < 0n ? '-' : '';
  const a = v < 0n ? -v : v;
  return `${sign}${a / 1000n}.${String(a % 1000n).padStart(3, '0')}`;
};

async function setup() {
  const c = await createCompany(app, db, mailer);
  // The same person sells and refunds in these fixtures (own-sale rule tested in refunds-controls).
  await c.allowOwnSaleRefunds();
  const req = (
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    cookies = c.cookies,
  ) => c.client.request(method, path, { cookies, ...(body === undefined ? {} : { body }) });
  const drinks = (await req('POST', '/manager/categories', { nameEn: 'Drinks' })).json().id;
  const mk = async (nameEn: string, price: string, cost: string, categoryId?: string) =>
    (
      await req('POST', '/manager/products', {
        nameEn,
        ...(categoryId ? { categoryId } : {}),
        variants: [{ price, cost }],
      })
    ).json().variants[0].id as string;
  const tea = await mk('Tea', '1.000', '0.400', drinks);
  const cake = await mk('Cake', '0.333', '0.100');
  await req('POST', '/manager/inventory/adjustments', {
    branchId: c.main,
    kind: 'opening',
    reason: 'opening',
    lines: [
      { variantId: tea, quantity: '50', unitCost: '0.400' },
      { variantId: cake, quantity: '50', unitCost: '0.100' },
    ],
  });
  await req('POST', '/manager/inventory/adjustments', {
    branchId: c.second,
    kind: 'opening',
    reason: 'opening',
    lines: [{ variantId: tea, quantity: '20', unitCost: '0.400' }],
  });
  const methods = (await req('GET', '/manager/payment-methods')).json().methods as {
    id: string;
    kind: string;
    version: number;
    nameEn: string;
    financialAccountId: string;
  }[];
  const card = methods.find((m) => m.kind === 'card')!;
  const updated = await req('PATCH', `/manager/payment-methods/${card.id}`, {
    kind: 'card',
    nameEn: card.nameEn,
    feeType: 'percentage',
    feePercent: '1.5',
    financialAccountId: card.financialAccountId,
    version: card.version,
  });
  if (updated.statusCode !== 200) throw new Error(updated.body);
  return {
    c,
    req,
    tea,
    cake,
    cash: methods.find((m) => m.kind === 'cash')!.id,
    card: card.id,
  };
}
type S = Awaited<ReturnType<typeof setup>>;

async function till(s: S, branchId: string, role: keyof Co['roles'] = 'cashier') {
  const emp = await s.c.hire([{ roleId: s.c.roles[role], branchId }], 'pos');
  const registers = (await s.req('GET', `/manager/registers?branchId=${branchId}`)).json()
    .registers as { id: string }[];
  const shift = await s.req(
    'POST',
    '/pos/shifts',
    { registerId: registers[0]!.id, countedCash: '10.000', expectedCash: '0.000' },
    emp.cookies,
  );
  if (shift.statusCode !== 201) throw new Error(shift.body);
  return emp.cookies;
}

async function sell(s: S, cookies: Cookies, body: Record<string, unknown>) {
  const res = await s.req('POST', '/pos/sales', { idempotencyKey: newId(), ...body }, cookies);
  if (res.statusCode !== 201) throw new Error(res.body);
  return res.json() as { id: string; receiptNumber: string };
}

/** The shared scenario: 3 sales on two branches, one refund, cash movements, a short close. */
async function scenario() {
  const s = await setup();
  // Cash in/out needs cash.move (supervisors) and a counted treasury (ADR-0090).
  await s.c.countTreasury(s.c.main, '20.000');
  const a = await till(s, s.c.main, 'supervisor');
  const b = await till(s, s.c.second);
  const s1 = await sell(s, a, {
    lines: [{ variantId: s.tea, quantity: '3' }],
    payments: [{ methodId: s.cash, amount: '3.000' }],
    expectedTotal: '3.000',
  });
  // 2 × 0.333 + 1.000 = 1.666, minus 0.166 = 1.500 on card (1.5 % fee).
  const s2 = await sell(s, a, {
    lines: [
      { variantId: s.cake, quantity: '2' },
      { variantId: s.tea, quantity: '1' },
    ],
    orderDiscount: { type: 'amount', value: '0.166' },
    payments: [{ methodId: s.card, amount: '1.500', reference: 'K-1' }],
    expectedTotal: '1.500',
  });
  const s3 = await sell(s, b, {
    lines: [{ variantId: s.tea, quantity: '2' }],
    payments: [{ methodId: s.card, amount: '2.000', reference: 'K-2' }],
    expectedTotal: '2.000',
  });
  const refund = await s.req(
    'POST',
    '/pos/refunds',
    {
      idempotencyKey: newId(),
      saleId: s1.id,
      reason: 'changed_mind',
      lines: [{ position: 0, quantity: '1', restock: true }],
    },
    a,
  );
  if (refund.statusCode !== 201) throw new Error(refund.body);
  for (const m of [
    { kind: 'cash_in', amount: '5.000', reason: 'float_top_up' },
    { kind: 'cash_out', amount: '2.000', reason: 'safe_drop' },
  ])
    await s.req('POST', '/pos/shifts/current/cash-movements', m, a);
  const current = (await s.req('GET', '/pos/shifts/current', undefined, a)).json().shift;
  // Expected 10 + 3 − 1 + 5 − 2 = 15.000; counted 14.750 → short 0.250.
  const closed = await s.req(
    'POST',
    '/pos/shifts/current/close',
    { countedCash: '14.750', version: current.version, note: 'coins missing' },
    a,
  );
  if (closed.statusCode !== 201 && closed.statusCode !== 200) throw new Error(closed.body);
  return { ...s, a, b, s1, s2, s3 };
}

const q = (from: string, to = from, extra = '') => `?from=${from}&to=${to}${extra}`;

describe('sales report', () => {
  it('reconciles every breakdown with the source sales and refunds, exactly', async () => {
    const s = await scenario();
    const res = await s.req('GET', `/manager/reports/sales${q(today())}`);
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json();
    expect(r.summary).toEqual({
      saleCount: 3,
      itemsSold: '8.000',
      gross: { amount: '6.666', currency: 'KWD' },
      lineDiscounts: { amount: '0.000', currency: 'KWD' },
      orderDiscounts: { amount: '0.166', currency: 'KWD' },
      discounts: { amount: '0.166', currency: 'KWD' },
      netSales: { amount: '6.500', currency: 'KWD' },
      refundCount: 1,
      refunds: { amount: '1.000', currency: 'KWD' },
      netAfterRefunds: { amount: '5.500', currency: 'KWD' },
      averageSale: { amount: '2.167', currency: 'KWD' },
    });
    // Same figures as the sales history (source documents).
    const history = (await s.req('GET', `/manager/sales?from=${today()}&to=${today()}`)).json();
    expect(history.totals.amount.amount).toBe('6.500');
    expect(history.totals.refunded.amount).toBe('1.000');
    // Every breakdown adds up to the total.
    const net = 6500n;
    expect(sumOf(r.byBranch, (x: { netSales: { amount: string } }) => x.netSales)).toBe(net);
    expect(sumOf(r.byEmployee, (x: { netSales: { amount: string } }) => x.netSales)).toBe(net);
    expect(sumOf(r.byPaymentMethod, (x: { amount: { amount: string } }) => x.amount)).toBe(net);
    expect(sumOf(r.byProduct, (x: { netSales: { amount: string } }) => x.netSales)).toBe(net);
    expect(sumOf(r.byCategory, (x: { netSales: { amount: string } }) => x.netSales)).toBe(net);
    expect(sumOf(r.byDay, (x: { netSales: { amount: string } }) => x.netSales)).toBe(net);
    expect(sumOf(r.byHour, (x: { netSales: { amount: string } }) => x.netSales)).toBe(net);
    expect(sumOf(r.byBranch, (x: { refunds: { amount: string } }) => x.refunds)).toBe(1000n);
    expect(r.byHour).toHaveLength(24);
    expect(r.byDay).toEqual([
      {
        date: today(),
        saleCount: 3,
        netSales: expect.objectContaining({ amount: '6.500' }),
        refunds: expect.objectContaining({ amount: '1.000' }),
      },
    ]);
    const main = r.byBranch.find((x: { branchId: string }) => x.branchId === s.c.main);
    expect(main).toMatchObject({
      saleCount: 2,
      gross: { amount: '4.666' },
      discounts: { amount: '0.166' },
      netSales: { amount: '4.500' },
      refunds: { amount: '1.000' },
      netAfterRefunds: { amount: '3.500' },
    });
    expect(
      Object.fromEntries(
        r.byPaymentMethod.map((m: { kind: string; amount: { amount: string } }) => [
          m.kind,
          m.amount.amount,
        ]),
      ),
    ).toEqual({ cash: '3.000', card: '3.500' });
    const tea = r.byProduct.find((p: { variantId: string }) => p.variantId === s.tea);
    expect(tea).toMatchObject({
      quantity: '6.000',
      refundedQuantity: '1.000',
      refunds: { amount: '1.000' },
    });
    expect(r.byCategory.map((x: { nameEn: string | null }) => x.nameEn).sort()).toEqual(
      ['Drinks', null].sort(),
    );
    // Gross profit: 5.500 − (2.600 cost − 0.400 restocked) = 3.300; margin 60.0 %.
    expect(r.profit).toEqual({
      available: true,
      missingCostSales: 0,
      costOfSales: { amount: '2.600', currency: 'KWD' },
      restockedCost: { amount: '0.400', currency: 'KWD' },
      grossProfit: { amount: '3.300', currency: 'KWD' },
      marginPercent: '60.0',
    });
    // Previous period (yesterday) had nothing.
    expect(r.previous.saleCount).toBe(0);
    expect(r.previous.netSales.amount).toBe('0.000');

    // Employee filter: only cashier A's sales and refund.
    const employee = r.byEmployee.find(
      (e: { saleCount: number }) => e.saleCount === 2,
    ).membershipId;
    const own = (
      await s.req('GET', `/manager/reports/sales${q(today(), today(), `&employeeId=${employee}`)}`)
    ).json();
    expect(own.summary).toMatchObject({
      saleCount: 2,
      netSales: { amount: '4.500' },
      refunds: { amount: '1.000' },
    });
  });

  it('uses the merchant’s local day boundaries and compares with the previous period', async () => {
    const s = await setup();
    const a = await till(s, s.c.main);
    const sale = await sell(s, a, {
      lines: [{ variantId: s.tea, quantity: '1' }],
      payments: [{ methodId: s.cash, amount: '1.000' }],
      expectedTotal: '1.000',
    });
    // 2026-10-10 21:30 UTC is 2026-10-11 00:30 in Kuwait.
    await owner.query(
      `update sales set created_at = '2026-10-10T21:30:00Z' where id = $1 and merchant_id = $2`,
      [sale.id, s.c.merchantId],
    );
    const day = async (d: string) => (await s.req('GET', `/manager/reports/sales${q(d)}`)).json();
    expect((await day('2026-10-10')).summary.saleCount).toBe(0);
    const eleventh = await day('2026-10-11');
    expect(eleventh.summary.netSales.amount).toBe('1.000');
    expect(eleventh.byHour[0]).toMatchObject({ hour: 0, saleCount: 1 });
    const twelfth = await day('2026-10-12');
    expect(twelfth.period).toMatchObject({ previousFrom: '2026-10-11', previousTo: '2026-10-11' });
    expect(twelfth.previous.netSales.amount).toBe('1.000');
    // A 3-day period compares with the 3 days before it.
    const range = (
      await s.req('GET', `/manager/reports/sales${q('2026-10-12', '2026-10-14')}`)
    ).json();
    expect(range.period).toMatchObject({ previousFrom: '2026-10-09', previousTo: '2026-10-11' });
    expect(range.previous.saleCount).toBe(1);
    expect(range.byDay.map((d: { date: string }) => d.date)).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
    ]);
  });

  it('hides profit when a sold item has no cost', async () => {
    const s = await setup();
    const free = (
      await s.req('POST', '/manager/products', {
        nameEn: 'Service',
        type: 'service',
        trackInventory: false,
        variants: [{ price: '2.000' }],
      })
    ).json();
    const a = await till(s, s.c.main);
    await sell(s, a, {
      lines: [{ variantId: free.variants[0].id, quantity: '1' }],
      payments: [{ methodId: s.cash, amount: '2.000' }],
      expectedTotal: '2.000',
    });
    const r = (await s.req('GET', `/manager/reports/sales${q(today())}`)).json();
    expect(r.summary.netSales.amount).toBe('2.000');
    expect(r.profit).toMatchObject({ available: false, missingCostSales: 1, grossProfit: null });
  });
});

describe('payments, cash and shift reports', () => {
  it('reconciles collections, fees, cash and the shift drawer', async () => {
    const s = await scenario();
    const r = (await s.req('GET', `/manager/reports/payments${q(today())}`)).json();
    const card = r.collections.find((x: { kind: string }) => x.kind === 'card');
    const cash = r.collections.find((x: { kind: string }) => x.kind === 'cash');
    expect(cash).toMatchObject({
      count: 1,
      collected: { amount: '3.000' },
      refunded: { amount: '1.000' },
      net: { amount: '2.000' },
      fees: { amount: '0.000' },
    });
    expect(card).toMatchObject({
      count: 2,
      collected: { amount: '3.500' },
      refunded: { amount: '0.000' },
    });
    // Fees equal the fees stored on the sales.
    let fees = 0n;
    for (const sale of [s.s2, s.s3])
      fees += minor((await s.req('GET', `/manager/sales/${sale.id}`)).json().fees);
    expect(minor(card.fees)).toBe(fees);
    expect(fees).toBe(53n); // 0.0225 → 0.023 (half-up) + 0.030
    expect(r.totals).toMatchObject({
      collected: { amount: '6.500' },
      fees: { amount: fils(fees) },
      refunded: { amount: '1.000' },
      net: { amount: '5.500' },
      netAfterFees: { amount: fils(5500n - fees) },
      previousCollected: { amount: '0.000' },
    });
    expect(r.cash).toEqual({
      cashSales: { amount: '3.000', currency: 'KWD' },
      cashRefunds: { amount: '1.000', currency: 'KWD' },
      cashIn: { amount: '5.000', currency: 'KWD' },
      cashOut: { amount: '2.000', currency: 'KWD' },
      netCash: { amount: '5.000', currency: 'KWD' },
    });
    expect(r.refundAllocations).toEqual([
      expect.objectContaining({
        kind: 'cash',
        status: 'succeeded',
        count: 1,
        amount: expect.objectContaining({ amount: '1.000' }),
      }),
    ]);
    expect(sumOf(r.byDay, (d: { collected: { amount: string } }) => d.collected)).toBe(6500n);

    const shifts = (await s.req('GET', `/manager/reports/shifts${q(today())}`)).json();
    expect(shifts.shifts).toHaveLength(1);
    expect(shifts.shifts[0]).toMatchObject({
      openingFloat: { amount: '10.000' },
      cashSales: { amount: '3.000' },
      cashRefunds: { amount: '1.000' },
      cashIn: { amount: '5.000' },
      cashOut: { amount: '2.000' },
      expectedCash: { amount: '15.000' },
      countedCash: { amount: '14.750' },
      discrepancy: { amount: '-0.250' },
      outcome: 'short',
    });
    expect(shifts.totals).toMatchObject({
      shiftCount: 1,
      short: 1,
      totalShort: { amount: '-0.250' },
      netDiscrepancy: { amount: '-0.250' },
    });
    expect(shifts.registers[0]).toMatchObject({
      shiftCount: 1,
      expectedCash: { amount: '15.000' },
      countedCash: { amount: '14.750' },
    });
    // The drawer figures equal the shift's own record.
    const own = (await s.req('GET', `/manager/shifts/${shifts.shifts[0].id}`)).json();
    expect(own.summary.expectedCash.amount).toBe('15.000');
  });
});

describe('inventory and purchasing reports', () => {
  it('values stock and counts movements and quantities exactly', async () => {
    const s = await scenario();
    const r = (await s.req('GET', `/manager/reports/inventory${q(today())}`)).json();
    const main = r.valuation.find((v: { branchId: string }) => v.branchId === s.c.main);
    // Tea 50 − 3 − 1 + 1 (restocked) = 47 × 0.400; cake 48 × 0.100.
    expect(main).toMatchObject({
      trackedItems: 2,
      quantity: '95.000',
      value: { amount: '23.600' },
      unvaluedItems: 0,
    });
    const second = r.valuation.find((v: { branchId: string }) => v.branchId === s.c.second);
    expect(second).toMatchObject({ quantity: '18.000', value: { amount: '7.200' } });
    const levels = (await s.req('GET', `/manager/inventory/levels?branchId=${s.c.main}`)).json()
      .levels;
    expect(levels.find((l: { variantId: string }) => l.variantId === s.tea).onHand).toBe('47.000');
    const mv = Object.fromEntries(
      r.movements.map((m: { movementType: string }) => [m.movementType, m]),
    );
    expect(mv['opening']).toMatchObject({ count: 3, quantityIn: '120.000', quantityOut: '0.000' });
    expect(mv['sale']).toMatchObject({ quantityOut: '8.000' });
    expect(mv['refund']).toMatchObject({ quantityIn: '1.000' });
    expect(r.adjustments).toEqual([
      { kind: 'opening', reason: 'opening', documents: 2, quantity: '120.000' },
    ]);
    const tea = r.productQuantities.find((p: { variantId: string }) => p.variantId === s.tea);
    expect(tea).toMatchObject({
      sold: '6.000',
      returnedToStock: '1.000',
      returnedNotRestocked: '0.000',
      netSold: '5.000',
    });
  });

  it('summarises purchases, receipts and transfers from their documents', async () => {
    const s = await setup();
    const supplier = (await s.req('POST', '/manager/suppliers', { nameEn: 'Gulf Foods' })).json();
    const po = (
      await s.req('POST', '/manager/purchase-orders', {
        supplierId: supplier.id,
        branchId: s.c.main,
        lines: [{ variantId: s.tea, quantity: '10', unitCost: '0.450' }],
      })
    ).json();
    const sub = (
      await s.req('POST', `/manager/purchase-orders/${po.id}/submit`, { version: po.version })
    ).json();
    const appr = (
      await s.req('POST', `/manager/purchase-orders/${po.id}/approve`, { version: sub.version })
    ).json();
    await s.req('POST', `/manager/purchase-orders/${po.id}/receipts`, {
      idempotencyKey: newId(),
      lines: [{ position: 0, quantity: '4' }],
    });
    expect(appr.status).toBe('approved');
    const tr = (
      await s.req('POST', '/manager/transfers', {
        sourceBranchId: s.c.main,
        destinationBranchId: s.c.second,
        lines: [{ variantId: s.tea, quantity: '2' }],
      })
    ).json();
    const ap = (
      await s.req('POST', `/manager/transfers/${tr.id}/approve`, { version: tr.version })
    ).json();
    const sent = (
      await s.req('POST', `/manager/transfers/${tr.id}/dispatch`, {
        version: ap.version,
        lines: [{ position: 0, quantity: '2' }],
      })
    ).json();
    const got = await s.req('POST', `/manager/transfers/${tr.id}/receive`, {
      version: sent.version,
      note: 'one bag torn',
      lines: [{ position: 0, quantity: '1.5' }],
    });
    expect(got.statusCode, got.body).toBe(201);
    const unitCost = BigInt(sent.lines[0].unitCost.amount.replace('.', ''));

    const r = (await s.req('GET', `/manager/reports/purchasing${q(today())}`)).json();
    expect(r.summary).toEqual({
      ordersCreated: 1,
      orderedValue: { amount: '4.500', currency: 'KWD' },
      receipts: 1,
      receivedValue: { amount: '1.800', currency: 'KWD' },
      openOrders: 1,
      openValue: { amount: '2.700', currency: 'KWD' },
    });
    expect(r.bySupplier).toEqual([
      expect.objectContaining({
        nameEn: 'Gulf Foods',
        orders: 1,
        receipts: 1,
        receivedValue: expect.objectContaining({ amount: '1.800' }),
      }),
    ]);
    expect(r.receipts[0]).toMatchObject({ orderNumber: po.number, value: { amount: '1.800' } });
    expect(r.transfers).toEqual([
      expect.objectContaining({
        sourceBranchId: s.c.main,
        destinationBranchId: s.c.second,
        transfers: 1,
        dispatched: '2.000',
        received: '1.500',
        missing: '0.500',
        dispatchedValue: expect.objectContaining({ amount: fils(2n * unitCost) }),
        missingValue: expect.objectContaining({ amount: fils((unitCost + 1n) / 2n) }),
      }),
    ]);
  });
});

describe('report access', () => {
  it('limits branch managers to their branches and financial reports to financial roles', async () => {
    const s = await scenario();
    const bm = await s.c.hire(
      [{ roleId: s.c.roles.branch_manager, branchId: s.c.second }],
      'manager',
    );
    const own = await s.req('GET', `/manager/reports/sales${q(today())}`, undefined, bm.cookies);
    expect(own.statusCode).toBe(200);
    expect(own.json().summary).toMatchObject({
      saleCount: 1,
      netSales: { amount: '2.000' },
      refunds: { amount: '0.000' },
    });
    expect(own.json().byBranch.map((b: { branchId: string }) => b.branchId)).toEqual([s.c.second]);
    // No cost or profit without reports.financial.
    expect(own.json().profit).toBeNull();
    expect(
      (
        await s.req(
          'GET',
          `/manager/reports/sales${q(today(), today(), `&branchId=${s.c.main}`)}`,
          undefined,
          bm.cookies,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await s.req('GET', `/manager/reports/payments${q(today())}`, undefined, bm.cookies))
        .statusCode,
    ).toBe(403);
    expect(
      (await s.req('GET', `/manager/reports/shifts${q(today())}`, undefined, bm.cookies))
        .statusCode,
    ).toBe(403);
    const inv = (
      await s.req('GET', `/manager/reports/inventory${q(today())}`, undefined, bm.cookies)
    ).json();
    expect(inv.valuation.map((v: { branchId: string }) => v.branchId)).toEqual([s.c.second]);

    const cm = await s.c.hire([{ roleId: s.c.roles.company_manager, branchId: null }], 'manager');
    const consolidated = (
      await s.req('GET', `/manager/reports/sales${q(today())}`, undefined, cm.cookies)
    ).json();
    expect(consolidated.summary.netSales.amount).toBe('6.500');
    expect(consolidated.profit.available).toBe(true);
    expect(
      (await s.req('GET', `/manager/reports/payments${q(today())}`, undefined, cm.cookies))
        .statusCode,
    ).toBe(200);

    // A management user without report permissions sees nothing.
    const role = (
      await s.req('POST', '/manager/roles', {
        nameEn: 'Viewer',
        permissions: ['manager.access', 'sales.read'],
      })
    ).json();
    const viewer = await s.c.hire([{ roleId: role.id, branchId: null }], 'manager');
    for (const path of ['sales', 'payments', 'shifts', 'inventory', 'purchasing'])
      expect(
        (await s.req('GET', `/manager/reports/${path}${q(today())}`, undefined, viewer.cookies))
          .statusCode,
      ).toBe(403);
    // Cashier POS sessions are not management sessions.
    expect(
      (await s.req('GET', `/manager/reports/sales${q(today())}`, undefined, s.a)).statusCode,
    ).toBe(401);
  });

  it('blocks cross-merchant access and validates periods', async () => {
    const s = await scenario();
    const other = await setup();
    const foreign = await other.req(
      'GET',
      `/manager/reports/sales${q(today(), today(), `&branchId=${s.c.main}`)}`,
    );
    expect(foreign.statusCode).toBe(404);
    const own = (await other.req('GET', `/manager/reports/sales${q(today())}`)).json();
    expect(own.summary.saleCount).toBe(0);
    const emp = (await s.req('GET', `/manager/reports/sales${q(today())}`)).json().byEmployee[0]
      .membershipId;
    expect(
      (await other.req('GET', `/manager/reports/sales${q(today(), today(), `&employeeId=${emp}`)}`))
        .statusCode,
    ).toBe(404);
    expect(
      (await s.req('GET', `/manager/reports/sales${q('2026-10-12', '2026-10-01')}`)).statusCode,
    ).toBe(400);
    expect(
      (await s.req('GET', `/manager/reports/sales${q('2025-01-01', '2026-10-01')}`)).statusCode,
    ).toBe(400);
    expect(
      (await s.req('GET', `/manager/reports/sales?from=2026-13-01&to=2026-13-02`)).statusCode,
    ).toBe(400);
  });
});
