import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../kernel/ids.js';
import { DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

/**
 * Valuation as at a date, roll-forward, cost precision and custody of returned goods
 * (remediation R2.6 / R2.7 / R2.8, BR-174 to BR-176).
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

/** Today in the merchant's zone (Asia/Kuwait, UTC+3, no DST). */
const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() + 3 * 3600_000 - 86_400_000).toISOString().slice(0, 10);

async function company() {
  const c = await createCompany(app, db, mailer);
  const call = (
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    cookies: Cookies = c.cookies,
  ) => c.client.request(method, path, { cookies, ...(body === undefined ? {} : { body }) });
  const product = async (nameEn: string, cost: string | null, price = '2.000') => {
    const res = await call('POST', '/manager/products', {
      nameEn,
      variants: [{ price, cost }],
    });
    expect(res.statusCode).toBe(201);
    return res.json().variants[0].id as string;
  };
  const adjust = async (body: Record<string, unknown>) => {
    const res = await call('POST', '/manager/inventory/adjustments', {
      branchId: c.main,
      idempotencyKey: newId(),
      ...body,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  };
  const level = async (variantId: string) =>
    (await call('GET', `/manager/inventory/variants/${variantId}`))
      .json()
      .branches.find((b: { branchId: string }) => b.branchId === c.main) as {
      onHand: string;
      avgCost: { amount: string } | null;
      value: { amount: string };
    };
  const report = async (from = today(), to = today()) =>
    (
      await call('GET', `/manager/reports/inventory?from=${from}&to=${to}&branchId=${c.main}`)
    ).json();
  return { c, call, product, adjust, level, report };
}

describe('cost precision and negative cost basis (BR-174)', () => {
  it('keeps fractions of a fils in the average, values negatives at their basis and reconciles the ledger', async () => {
    const s = await company();
    // Spice by the gram: 1 kg at 2.500 KWD = 2.5 fils per gram; the average keeps the half fils.
    const spice = await s.product('Saffron (g)', null, '0.010');
    await s.adjust({
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId: spice, quantity: '1000', unitCost: '0.003' }],
    });
    // 1000 g @ 0.003 + 1000 g @ 0.002 → 2.5 fils per gram exactly (displayed as 0.003).
    await s.adjust({
      kind: 'increase',
      reason: 'found',
      lines: [{ variantId: spice, quantity: '1000', unitCost: '0.002' }],
    });
    let lvl = await s.level(spice);
    expect(lvl.avgCost!.amount).toBe('0.003');
    expect(lvl.value.amount).toBe('5.000');
    const { rows } = await owner.query(
      `select avg_cost_micro::text as micro from stock_levels where merchant_id = $1 and variant_id = $2`,
      [s.c.merchantId, spice],
    );
    expect(rows[0].micro).toBe('2500');
    // 400 g out leaves at 2.5 fils each: value 1.000, not 1.200.
    const out = await s.adjust({
      kind: 'decrease',
      reason: 'internal_use',
      lines: [{ variantId: spice, quantity: '400' }],
    });
    expect(out.value.amount).toBe('1.000');
    lvl = await s.level(spice);
    expect(lvl.value.amount).toBe('4.000');

    // Negative stock keeps its cost basis: −5 at 1.000 then 10 at 2.000 → 5 at 3.000.
    const rice = await s.product('Rice', '1.000');
    const settings = (await s.call('GET', '/manager/inventory/settings')).json();
    expect(
      (
        await s.call('PUT', '/manager/inventory/settings', {
          allowNegativeStock: true,
          version: settings.version,
        })
      ).statusCode,
    ).toBe(200);
    await s.adjust({
      kind: 'decrease',
      reason: 'internal_use',
      lines: [{ variantId: rice, quantity: '5' }],
    });
    lvl = await s.level(rice);
    expect(lvl).toMatchObject({ onHand: '-5.000', value: { amount: '-5.000' } });
    await s.adjust({
      kind: 'increase',
      reason: 'received_other',
      lines: [{ variantId: rice, quantity: '10', unitCost: '2.000' }],
    });
    lvl = await s.level(rice);
    expect(lvl).toMatchObject({
      onHand: '5.000',
      avgCost: { amount: '3.000' },
      value: { amount: '15.000' },
    });
    // The roll-forward closes: Σ movement values (−5 + 20 = 15) = closing value, rounding 0.
    const r = await s.report();
    const riceMoves = r.rollForward.total.movements as {
      movementType: string;
      value: { amount: string };
    }[];
    expect(r.rollForward.total.rounding.amount).toBe('0.000');
    expect(r.rollForward.total.closing.value.amount).toBe('19.000');
    // Adjustments: +2.000 (spice found) − 1.000 (spice used) − 5.000 + 20.000 (rice) = 16.000.
    expect(riceMoves.find((m) => m.movementType === 'adjustment')!.value.amount).toBe('16.000');
    // Items without any cost are listed with a way to fix them.
    const mystery = await s.product('Mystery', null);
    await s.adjust({
      kind: 'count',
      reason: 'stock_count',
      lines: [{ variantId: mystery, quantity: '3' }],
    });
    const after = await s.report();
    expect(after.unvalued).toEqual([
      expect.objectContaining({ variantId: mystery, branchId: s.c.main, onHand: '3.000' }),
    ]);
    expect(after.valuation[0].unvaluedItems).toBe(1);
  });
});

describe('valuation as at a date and roll-forward (BR-176)', () => {
  it('reconstructs opening and closing stock from the ledger and shows reserved quantities', async () => {
    const s = await company();
    const tea = await s.product('Tea', '0.400');
    await s.adjust({
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId: tea, quantity: '50', unitCost: '0.400' }],
    });
    // Back-date the opening to yesterday so the period has an opening balance.
    await owner.query(
      `update stock_movements set created_at = created_at - interval '1 day' where merchant_id = $1`,
      [s.c.merchantId],
    );
    await s.adjust({
      kind: 'increase',
      reason: 'found',
      lines: [{ variantId: tea, quantity: '10', unitCost: '0.700' }],
    });
    await s.adjust({
      kind: 'decrease',
      reason: 'damaged',
      lines: [{ variantId: tea, quantity: '12' }],
    });
    // Yesterday closed at 50 × 0.400 = 20.000; today opens there and closes at 48 × 0.450 = 21.600.
    const past = await s.report(yesterday(), yesterday());
    expect(past.asAt).toMatchObject({
      date: yesterday(),
      total: { quantity: '50.000', value: { amount: '20.000' } },
    });
    expect(past.rollForward.total).toMatchObject({
      opening: { quantity: '0.000', value: { amount: '0.000' } },
      closing: { quantity: '50.000', value: { amount: '20.000' } },
      rounding: { amount: '0.000' },
    });
    const now = await s.report();
    expect(now.asAt.total).toEqual({
      quantity: '48.000',
      value: { amount: '21.600', currency: 'KWD' },
    });
    expect(now.rollForward.total).toMatchObject({
      opening: { quantity: '50.000', value: { amount: '20.000' } },
      closing: { quantity: '48.000', value: { amount: '21.600' } },
      rounding: { amount: '0.000' },
    });
    const moves = Object.fromEntries(
      (
        now.rollForward.total.movements as {
          movementType: string;
          quantity: string;
          value: { amount: string };
        }[]
      ).map((m) => [m.movementType, m]),
    );
    // +10 @ 0.700 = 7.000; −12 @ 0.450 = −5.400; 20 + 7 − 5.4 = 21.6.
    expect(moves['adjustment']).toMatchObject({ quantity: '-2.000', value: { amount: '1.600' } });
    expect(now.valuation[0].value.amount).toBe('21.600');
    expect(now.reservedQuantity).toBe('0.000');
    // An unpaid online order holds 4: shown as reserved, without changing the balance.
    const cash = (await s.call('GET', '/manager/payment-methods'))
      .json()
      .methods.find((m: { kind: string }) => m.kind === 'cash').id as string;
    const orderId = newId();
    await owner.query(
      `insert into online_orders (id, merchant_id, number, branch_id, fulfillment, customer_name, customer_phone,
         subtotal_minor, delivery_fee_minor, total_minor, payment_method_id, tracking_token, idempotency_key,
         request_hash, reserved_until)
       values ($1, $2, 'W-TEST-1', $3, 'pickup', 'Test Customer', '+96550000000', 4000, 0, 4000, $4, $5, $6, 'h',
               now() + interval '1 hour')`,
      [orderId, s.c.merchantId, s.c.main, cash, newId(), newId()],
    );
    await owner.query(
      `insert into stock_reservations (id, merchant_id, branch_id, variant_id, online_order_id, quantity, expires_at)
       values ($1, $2, $3, $4, $5, 4, now() + interval '1 hour')`,
      [newId(), s.c.merchantId, s.c.main, tea, orderId],
    );
    const reserved = await s.report();
    expect(reserved.reservedQuantity).toBe('4.000');
    expect(reserved.stock.find((x: { variantId: string }) => x.variantId === tea)).toMatchObject({
      onHand: '48.000',
      reserved: '4.000',
    });
    // A branch manager without cost rights still gets quantities; costs stay hidden elsewhere.
    expect(
      (await s.call('GET', `/manager/inventory/levels?branchId=${s.c.main}`)).json().levels[0]
        .onHand,
    ).toBe('48.000');
  });
});

describe('custody of returned goods (BR-175)', () => {
  it('keeps damaged returns out of stock by default, records them and lets them be disposed of once', async () => {
    const s = await company();
    const lamp = await s.product('Desk lamp', '4.000', '10.000');
    await s.adjust({
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId: lamp, quantity: '5', unitCost: '4.000' }],
    });
    // "Customer return (outside POS)" is no longer an increase reason.
    expect(
      (
        await s.call('POST', '/manager/inventory/adjustments', {
          branchId: s.c.main,
          kind: 'increase',
          reason: 'customer_return',
          lines: [{ variantId: lamp, quantity: '1' }],
        })
      ).statusCode,
    ).toBe(400);
    const pos = await s.c.ownerPos(s.c.main);
    const [register] = (await s.call('GET', `/manager/registers?branchId=${s.c.main}`)).json()
      .registers as { id: string }[];
    expect(
      (
        await s.call(
          'POST',
          '/pos/shifts',
          { registerId: register!.id, countedCash: '100.000', expectedCash: '0.000' },
          pos,
        )
      ).statusCode,
    ).toBe(201);
    const cash = (await s.call('GET', '/manager/payment-methods'))
      .json()
      .methods.find((m: { kind: string }) => m.kind === 'cash').id as string;
    const sale = await s.call(
      'POST',
      '/pos/sales',
      {
        idempotencyKey: newId(),
        lines: [{ variantId: lamp, quantity: '2' }],
        payments: [{ methodId: cash, amount: '20.000' }],
        expectedTotal: '20.000',
      },
      pos,
    );
    expect(sale.statusCode).toBe(201);
    expect((await s.level(lamp)).onHand).toBe('3.000');
    // A damaged return: restock not sent → kept out of stock; the custody record is created.
    const refund = await s.call(
      'POST',
      '/pos/refunds',
      {
        idempotencyKey: newId(),
        saleId: sale.json().id,
        reason: 'damaged',
        lines: [{ position: 0, quantity: '1' }],
      },
      pos,
    );
    expect(refund.statusCode).toBe(201);
    expect(refund.json().status).toBe('completed');
    expect((await s.level(lamp)).onHand).toBe('3.000');
    const held = (await s.call('GET', '/manager/inventory/damaged-returns')).json();
    expect(held.heldCount).toBe(1);
    expect(held.returns[0]).toMatchObject({
      refundNumber: refund.json().refundNumber,
      variantId: lamp,
      quantity: '1.000',
      reason: 'damaged',
      status: 'held',
      unitCost: { amount: '4.000' },
    });
    // A "changed mind" return goes back to stock by default: no custody record.
    const back = await s.call(
      'POST',
      '/pos/refunds',
      {
        idempotencyKey: newId(),
        saleId: sale.json().id,
        reason: 'changed_mind',
        lines: [{ position: 0, quantity: '1' }],
      },
      pos,
    );
    expect(back.statusCode).toBe(201);
    expect((await s.level(lamp)).onHand).toBe('4.000');
    expect((await s.call('GET', '/manager/inventory/damaged-returns')).json().heldCount).toBe(1);
    // Disposal needs the adjust right at the branch and a note; it happens once.
    const id = held.returns[0].id as string;
    const cashier = await s.c.hire([{ roleId: s.c.roles.cashier, branchId: s.c.main }], 'pos');
    expect([401, 403]).toContain(
      (
        await s.call(
          'POST',
          `/manager/inventory/damaged-returns/${id}/dispose`,
          { note: 'x' },
          cashier.cookies,
        )
      ).statusCode,
    );
    expect(
      (await s.call('POST', `/manager/inventory/damaged-returns/${id}/dispose`, { note: '' }))
        .statusCode,
    ).toBe(400);
    const disposed = await s.call('POST', `/manager/inventory/damaged-returns/${id}/dispose`, {
      note: 'Returned to supplier for credit',
    });
    expect(disposed.statusCode).toBe(201);
    expect(disposed.json()).toMatchObject({
      status: 'disposed',
      disposalNote: 'Returned to supplier for credit',
      disposedBy: expect.any(String),
    });
    expect(
      (
        await s.call('POST', `/manager/inventory/damaged-returns/${id}/dispose`, { note: 'again' })
      ).json().code,
    ).toBe('INVALID_STATE');
    expect(
      (await s.call('GET', '/manager/inventory/damaged-returns?status=all')).json().heldCount,
    ).toBe(0);
    expect((await s.call('GET', '/manager/audit?action=damaged_return')).json().total).toBe(1);
  });
});
