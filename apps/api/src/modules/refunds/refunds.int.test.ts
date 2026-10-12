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
  const mk = async (nameEn: string, price: string, cost: string) => {
    const p = (
      await c.client.request('POST', '/manager/products', {
        cookies: c.cookies,
        body: { nameEn, variants: [{ price, cost }] },
      })
    ).json();
    return p.variants[0].id as string;
  };
  const tea = await mk('Tea', '1.000', '0.400');
  const cake = await mk('Cake', '0.333', '0.100');
  await c.client.request('POST', '/manager/inventory/adjustments', {
    cookies: c.cookies,
    body: {
      branchId: c.main,
      kind: 'opening',
      reason: 'opening',
      lines: [
        { variantId: tea, quantity: '50' },
        { variantId: cake, quantity: '50' },
      ],
    },
  });
  const methods = (
    await c.client.request('GET', '/manager/payment-methods', { cookies: c.cookies })
  ).json().methods as {
    id: string;
    kind: string;
  }[];
  const registers = (
    await c.client.request('GET', `/manager/registers?branchId=${c.main}`, { cookies: c.cookies })
  ).json().registers as { id: string }[];
  return {
    c,
    tea,
    cake,
    cash: methods.find((m) => m.kind === 'cash')!.id,
    card: methods.find((m) => m.kind === 'card')!.id,
    register: registers[0]!.id,
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function staff(s: Setup, role: keyof Co['roles'], code: string, float = '50.000') {
  const emp = await s.c.hire([{ roleId: s.c.roles[role], branchId: s.c.main }], 'pos');
  const reg =
    code === 'R1'
      ? s.register
      : (
          await s.c.client.request('POST', '/manager/registers', {
            cookies: s.c.cookies,
            body: { branchId: s.c.main, code, nameEn: code },
          })
        ).json().id;
  const shift = await s.c.client.request('POST', '/pos/shifts', {
    cookies: emp.cookies,
    body: { registerId: reg, openingFloat: float },
  });
  if (shift.statusCode !== 201) throw new Error(shift.body);
  return { cookies: emp.cookies, shiftId: shift.json().id as string, email: emp.email };
}

async function sell(
  s: Setup,
  cookies: Cookies,
  lines: { variantId: string; quantity: string }[],
  payments: unknown[],
  total: string,
  extra = {},
) {
  const res = await s.c.client.request('POST', '/pos/sales', {
    cookies,
    body: { idempotencyKey: newId(), lines, payments, expectedTotal: total, ...extra },
  });
  if (res.statusCode !== 201) throw new Error(res.body);
  return res.json() as { id: string; receiptNumber: string };
}

function refund(s: Setup, cookies: Cookies, body: Record<string, unknown>) {
  return s.c.client.request('POST', '/pos/refunds', {
    cookies,
    body: { idempotencyKey: newId(), reason: 'changed_mind', ...body },
  });
}

async function onHand(s: Setup, variantId: string) {
  const res = await s.c.client.request('GET', `/manager/inventory/variants/${variantId}`, {
    cookies: s.c.cookies,
  });
  return res.json().branches.find((b: { branchId: string }) => b.branchId === s.c.main)
    .onHand as string;
}

describe('refunds', () => {
  it('refunds part of a sale, then the rest, to the exact cent and never more', async () => {
    const s = await setup();
    const cashier = await staff(s, 'cashier', 'R1');
    // 3 × 0.333 = 0.999
    const sale = await sell(
      s,
      cashier.cookies,
      [{ variantId: s.cake, quantity: '3' }],
      [{ methodId: s.cash, amount: '0.999' }],
      '0.999',
    );
    const lookup = (
      await s.c.client.request(
        'GET',
        `/pos/refunds/lookup?receipt=${sale.receiptNumber.toLowerCase()}`,
        { cookies: cashier.cookies },
      )
    ).json();
    expect(lookup).toMatchObject({
      refundable: { amount: '0.999' },
      withinWindow: true,
      voidable: true,
      lines: [{ refundableQuantity: '3.000' }],
    });

    const preview = (
      await s.c.client.request('POST', '/pos/refunds/preview', {
        cookies: cashier.cookies,
        body: { saleId: sale.id, lines: [{ position: 0, quantity: '1' }] },
      })
    ).json();
    expect(preview).toMatchObject({
      total: { amount: '0.333' },
      approvalRequired: false,
      allocation: [{ kind: 'cash', amount: { amount: '0.333' } }],
    });

    const one = await refund(s, cashier.cookies, {
      saleId: sale.id,
      lines: [{ position: 0, quantity: '1' }],
    });
    expect(one.statusCode).toBe(201);
    expect(one.json()).toMatchObject({
      status: 'completed',
      kind: 'refund',
      total: { amount: '0.333' },
      refundNumber: `${sale.receiptNumber}-R1`,
    });
    const two = await refund(s, cashier.cookies, {
      saleId: sale.id,
      lines: [{ position: 0, quantity: '1' }],
    });
    expect(two.json().total.amount).toBe('0.333');
    const three = await refund(s, cashier.cookies, {
      saleId: sale.id,
      lines: [{ position: 0, quantity: '1' }],
    });
    // Cumulative rounding: 0.333 + 0.333 + 0.333 = 0.999 exactly.
    expect(three.json().total.amount).toBe('0.333');
    const more = await refund(s, cashier.cookies, {
      saleId: sale.id,
      lines: [{ position: 0, quantity: '0.001' }],
    });
    expect(more.json().code).toBe('REFUND_EXCEEDS_SALE');

    expect(await onHand(s, s.cake)).toBe('50.000');
    const shift = (
      await s.c.client.request('GET', '/pos/shifts/current', { cookies: cashier.cookies })
    ).json().shift;
    expect(shift.summary).toMatchObject({
      cashSales: { amount: '0.999' },
      cashRefunds: { amount: '0.999' },
      expectedCash: { amount: '50.000' },
    });
    const detail = (
      await s.c.client.request('GET', `/manager/sales/${sale.id}`, { cookies: s.c.cookies })
    ).json();
    expect(detail.refunded.amount).toBe('0.999');
    const list = (
      await s.c.client.request('GET', '/manager/sales', { cookies: s.c.cookies })
    ).json();
    expect(list.totals).toMatchObject({
      amount: { amount: '0.999' },
      refunded: { amount: '0.999' },
      net: { amount: '0.000' },
    });
    const audit = await owner.query(
      `select count(*)::int as n from audit_log where merchant_id = $1 and action = 'refund.completed'`,
      [s.c.merchantId],
    );
    expect(audit.rows[0].n).toBe(3);
  });

  it('allocates split-payment refunds to the original tenders and refuses wrong allocations', async () => {
    const s = await setup();
    const cashier = await staff(s, 'cashier', 'R1');
    const sale = await sell(
      s,
      cashier.cookies,
      [{ variantId: s.tea, quantity: '10' }],
      [
        { methodId: s.card, amount: '7.000', reference: 'A1' },
        { methodId: s.cash, amount: '3.000' },
      ],
      '10.000',
    );
    const lookup = (
      await s.c.client.request('GET', `/pos/refunds/lookup?receipt=${sale.receiptNumber}`, {
        cookies: cashier.cookies,
      })
    ).json();
    const cardPay = lookup.payments.find((p: { kind: string }) => p.kind === 'card').paymentId;
    const cashPay = lookup.payments.find((p: { kind: string }) => p.kind === 'cash').paymentId;
    // Suggested: proportional 70 / 30
    const suggested = await refund(s, cashier.cookies, {
      saleId: sale.id,
      lines: [{ position: 0, quantity: '1' }],
    });
    expect(
      suggested
        .json()
        .payments.map((p: { kind: string; amount: { amount: string } }) => [
          p.kind,
          p.amount.amount,
        ]),
    ).toEqual([
      ['card', '0.700'],
      ['cash', '0.300'],
    ]);
    // Over a single tender, or not adding up, is refused.
    for (const allocation of [
      [{ paymentId: cashPay, amount: '5.000' }],
      [{ paymentId: cardPay, amount: '0.500' }],
      [{ paymentId: newId(), amount: '1.000' }],
    ]) {
      const bad = await refund(s, cashier.cookies, {
        saleId: sale.id,
        lines: [{ position: 0, quantity: '1' }],
        allocation,
      });
      expect(bad.json().code, JSON.stringify(allocation)).toBe('REFUND_ALLOCATION_INVALID');
    }
    // A chosen allocation within each tender works; the remaining card refundable shrinks.
    const chosen = await refund(s, cashier.cookies, {
      saleId: sale.id,
      lines: [{ position: 0, quantity: '2' }],
      allocation: [{ paymentId: cardPay, amount: '2.000', reference: 'REF-9' }],
    });
    expect(chosen.statusCode).toBe(201);
    const after = (
      await s.c.client.request('GET', `/pos/refunds/lookup?receipt=${sale.receiptNumber}`, {
        cookies: cashier.cookies,
      })
    ).json();
    expect(
      after.payments.map((p: { refundable: { amount: string } }) => p.refundable.amount),
    ).toEqual(['4.300', '2.700']);
  });

  it('restocks only what is returned to stock, at the original cost', async () => {
    const s = await setup();
    const cashier = await staff(s, 'cashier', 'R1');
    const sale = await sell(
      s,
      cashier.cookies,
      [
        { variantId: s.tea, quantity: '4' },
        { variantId: s.cake, quantity: '2' },
      ],
      [{ methodId: s.cash, amount: '4.666' }],
      '4.666',
    );
    expect(await onHand(s, s.tea)).toBe('46.000');
    const res = await refund(s, cashier.cookies, {
      saleId: sale.id,
      reason: 'defective',
      lines: [
        { position: 0, quantity: '2', restock: false },
        { position: 1, quantity: '1', restock: true },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(await onHand(s, s.tea)).toBe('46.000');
    expect(await onHand(s, s.cake)).toBe('49.000');
    const moves = await owner.query(
      `select variant_id, quantity::text, unit_cost_minor::text from stock_movements where merchant_id = $1 and movement_type = 'refund'`,
      [s.c.merchantId],
    );
    expect(moves.rows).toEqual([{ variant_id: s.cake, quantity: '1.000', unit_cost_minor: '100' }]);
  });

  it('requires approval above the limit, enforces who may approve and pays out on approval', async () => {
    const s = await setup();
    const cashier = await staff(s, 'cashier', 'R1');
    const sale = await sell(
      s,
      cashier.cookies,
      [{ variantId: s.tea, quantity: '30' }],
      [{ methodId: s.cash, amount: '30.000' }],
      '30.000',
    );
    // Default limit 20.000: a 25.000 refund needs approval.
    const pending = await refund(s, cashier.cookies, {
      saleId: sale.id,
      lines: [{ position: 0, quantity: '25' }],
    });
    expect(pending.json()).toMatchObject({
      status: 'pending_approval',
      approvalReasons: ['over_limit'],
    });
    expect(await onHand(s, s.tea)).toBe('20.000');
    // The pending request reserves the quantity.
    const extra = await refund(s, cashier.cookies, {
      saleId: sale.id,
      lines: [{ position: 0, quantity: '6' }],
    });
    expect(extra.json().code).toBe('REFUND_EXCEEDS_SALE');
    // Cashiers cannot approve; a branch manager of another branch cannot either.
    expect(
      (
        await s.c.client.request('POST', `/manager/refunds/${pending.json().id}/approve`, {
          cookies: { mgr_sid: cashier.cookies.pos_sid! },
          body: {},
        })
      ).statusCode,
    ).toBe(401);
    const bmSecond = await s.c.hire(
      [{ roleId: s.c.roles.branch_manager, branchId: s.c.second }],
      'manager',
    );
    expect(
      (
        await s.c.client.request('POST', `/manager/refunds/${pending.json().id}/approve`, {
          cookies: bmSecond.cookies,
          body: {},
        })
      ).statusCode,
    ).toBe(403);
    // A supervisor approves at the till; cash leaves the requester's drawer.
    const supervisor = await staff(s, 'supervisor', 'R2');
    const approved = await s.c.client.request('POST', `/pos/refunds/${pending.json().id}/approve`, {
      cookies: supervisor.cookies,
      body: { note: 'ok' },
    });
    expect(approved.json()).toMatchObject({ status: 'completed', decidedBy: 'Employee' });
    expect(await onHand(s, s.tea)).toBe('45.000');
    const drawer = (
      await s.c.client.request('GET', '/pos/shifts/current', { cookies: cashier.cookies })
    ).json().shift.summary;
    expect(drawer).toMatchObject({
      cashRefunds: { amount: '25.000' },
      expectedCash: { amount: '55.000' },
    });
    const again = await s.c.client.request('POST', `/pos/refunds/${pending.json().id}/approve`, {
      cookies: supervisor.cookies,
      body: {},
    });
    expect(again.json().code).toBe('REFUND_NOT_PENDING');

    // Rejection releases the reservation.
    const p2 = await refund(s, cashier.cookies, {
      saleId: sale.id,
      lines: [{ position: 0, quantity: '5' }],
    });
    // 5.000 is within the limit → completes directly
    expect(p2.json().status).toBe('completed');
  });

  it('rejects and cancels pending requests; nobody approves their own request', async () => {
    const s = await setup();
    const cashier = await staff(s, 'cashier', 'R1');
    const sale = await sell(
      s,
      cashier.cookies,
      [{ variantId: s.tea, quantity: '30' }],
      [{ methodId: s.cash, amount: '30.000' }],
      '30.000',
    );
    const p1 = (
      await refund(s, cashier.cookies, {
        saleId: sale.id,
        lines: [{ position: 0, quantity: '21' }],
      })
    ).json();
    const rejected = await s.c.client.request('POST', `/manager/refunds/${p1.id}/reject`, {
      cookies: s.c.cookies,
      body: { note: 'No receipt' },
    });
    expect(rejected.json()).toMatchObject({ status: 'rejected', decisionNote: 'No receipt' });
    const p2 = (
      await refund(s, cashier.cookies, {
        saleId: sale.id,
        lines: [{ position: 0, quantity: '21' }],
      })
    ).json();
    expect(p2.status).toBe('pending_approval');
    const cancelled = await s.c.client.request('POST', `/pos/refunds/${p2.id}/cancel`, {
      cookies: cashier.cookies,
      body: {},
    });
    expect(cancelled.json().status).toBe('cancelled');
    // A supervisor's own large refund needs no approval (they hold refunds.approve).
    const supervisor = await staff(s, 'supervisor', 'R2', '100.000');
    const big = await refund(s, supervisor.cookies, {
      saleId: sale.id,
      lines: [{ position: 0, quantity: '25' }],
    });
    expect(big.json().status).toBe('completed');
    // Self-approval is blocked.
    const sale2 = await sell(
      s,
      supervisor.cookies,
      [{ variantId: s.tea, quantity: '1' }],
      [{ methodId: s.cash, amount: '1.000' }],
      '1.000',
    );
    await owner.query(
      `insert into sales_settings (merchant_id, refund_approval_limit_minor) values ($1, 0)
       on conflict (merchant_id) do update set refund_approval_limit_minor = 0`,
      [s.c.merchantId],
    );
    const own = (
      await refund(s, cashier.cookies, {
        saleId: sale2.id,
        lines: [{ position: 0, quantity: '1' }],
      })
    ).json();
    expect(own.status).toBe('pending_approval');
    // The requester cannot approve (no refunds.approve) …
    const cashierAsApprover = await s.c.client.request('POST', `/pos/refunds/${own.id}/approve`, {
      cookies: cashier.cookies,
      body: {},
    });
    expect(cashierAsApprover.statusCode).toBe(403);
    // … and even after being promoted, nobody approves their own request.
    const employees = (
      await s.c.client.request('GET', '/manager/employees', { cookies: s.c.cookies })
    ).json().employees as {
      membershipId: string;
      email: string;
    }[];
    const membershipId = employees.find((e) => e.email === cashier.email)!.membershipId;
    await s.c.client.request('PUT', `/manager/employees/${membershipId}/assignments`, {
      cookies: s.c.cookies,
      body: { assignments: [{ roleId: s.c.roles.supervisor, branchId: s.c.main }] },
    });
    const self = await s.c.client.request('POST', `/pos/refunds/${own.id}/approve`, {
      cookies: cashier.cookies,
      body: {},
    });
    expect(self.json().code).toBe('SELF_APPROVAL');
  });

  it('is safe against duplicate and concurrent refund requests', async () => {
    const s = await setup();
    const cashier = await staff(s, 'cashier', 'R1');
    const sale = await sell(
      s,
      cashier.cookies,
      [{ variantId: s.tea, quantity: '2' }],
      [{ methodId: s.cash, amount: '2.000' }],
      '2.000',
    );
    const body = {
      idempotencyKey: newId(),
      reason: 'changed_mind',
      saleId: sale.id,
      lines: [{ position: 0, quantity: '1' }],
    };
    const same = await Promise.all(
      Array.from({ length: 4 }, () =>
        s.c.client.request('POST', '/pos/refunds', { cookies: cashier.cookies, body }),
      ),
    );
    expect(new Set(same.map((r) => r.json().id)).size).toBe(1);
    // Two cashiers on different shifts racing for the last unit: exactly one succeeds.
    const other = await staff(s, 'cashier', 'R2');
    const race = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        refund(s, i % 2 ? other.cookies : cashier.cookies, {
          saleId: sale.id,
          lines: [{ position: 0, quantity: '1' }],
        }),
      ),
    );
    expect(race.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(race.filter((r) => r.json().code === 'REFUND_EXCEEDS_SALE')).toHaveLength(3);
    const total = await owner.query(
      `select coalesce(sum(total_minor), 0)::text as t from refunds where merchant_id = $1 and status = 'completed'`,
      [s.c.merchantId],
    );
    expect(total.rows[0].t).toBe('2000');
    expect(await onHand(s, s.tea)).toBe('50.000');
  });

  it('refuses cash refunds the drawer cannot cover, and needs an open shift', async () => {
    const s = await setup();
    const cashier = await staff(s, 'cashier', 'R1', '0');
    const sale = await sell(
      s,
      cashier.cookies,
      [{ variantId: s.tea, quantity: '5' }],
      [{ methodId: s.cash, amount: '5.000' }],
      '5.000',
    );
    await s.c.client.request('POST', '/pos/shifts/current/cash-movements', {
      cookies: cashier.cookies,
      body: { kind: 'cash_out', amount: '4.000', reason: 'safe_drop' },
    });
    const res = await refund(s, cashier.cookies, {
      saleId: sale.id,
      lines: [{ position: 0, quantity: '2' }],
    });
    expect(res.json().code).toBe('INSUFFICIENT_CASH');
    const noShift = await s.c.hire([{ roleId: s.c.roles.cashier, branchId: s.c.main }], 'pos');
    expect(
      (
        await refund(s, noShift.cookies, {
          saleId: sale.id,
          lines: [{ position: 0, quantity: '1' }],
        })
      ).json().code,
    ).toBe('SHIFT_REQUIRED');
  });

  it('keeps gateway refunds processing until verified', async () => {
    const s = await setup();
    const cashier = await staff(s, 'cashier', 'R1');
    const sale = await sell(
      s,
      cashier.cookies,
      [{ variantId: s.tea, quantity: '2' }],
      [{ methodId: s.card, amount: '2.000' }],
      '2.000',
    );
    // Simulate an online (gateway-verified) payment; real gateways arrive in Prompt 16.
    await owner.query(`update payments set verification = 'gateway' where sale_id = $1`, [sale.id]);
    const res = (
      await refund(s, cashier.cookies, { saleId: sale.id, lines: [{ position: 0, quantity: '1' }] })
    ).json();
    expect(res).toMatchObject({
      status: 'processing',
      completedAt: null,
      payments: [{ status: 'pending', verification: 'gateway' }],
    });
    // Still reserved: the second unit is the only refundable one.
    expect(
      (
        await refund(s, cashier.cookies, {
          saleId: sale.id,
          lines: [{ position: 0, quantity: '2' }],
        })
      ).json().code,
    ).toBe('REFUND_EXCEEDS_SALE');
  });
});

describe('voids and exchanges', () => {
  it('voids a sale of the open shift once; other shifts cannot void it', async () => {
    const s = await setup();
    const cashier = await staff(s, 'cashier', 'R1');
    const sale = await sell(
      s,
      cashier.cookies,
      [{ variantId: s.tea, quantity: '3' }],
      [{ methodId: s.cash, amount: '3.000' }],
      '3.000',
    );
    // Cashiers lack sales.void; supervisors have it.
    const denied = await s.c.client.request('POST', `/pos/sales/${sale.id}/void`, {
      cookies: cashier.cookies,
      body: { idempotencyKey: newId(), reason: 'cashier_error' },
    });
    expect(denied.statusCode).toBe(403);
    const sup = await staff(s, 'supervisor', 'R2');
    const supSale = await sell(
      s,
      sup.cookies,
      [{ variantId: s.tea, quantity: '2' }],
      [{ methodId: s.cash, amount: '2.000' }],
      '2.000',
    );
    const otherShift = await s.c.client.request('POST', `/pos/sales/${sale.id}/void`, {
      cookies: sup.cookies,
      body: { idempotencyKey: newId(), reason: 'cashier_error' },
    });
    expect(otherShift.json().code).toBe('NOT_VOIDABLE');
    const voided = await s.c.client.request('POST', `/pos/sales/${supSale.id}/void`, {
      cookies: sup.cookies,
      body: { idempotencyKey: newId(), reason: 'customer_cancelled' },
    });
    expect(voided.json()).toMatchObject({
      kind: 'void',
      status: 'completed',
      total: { amount: '2.000' },
    });
    expect(await onHand(s, s.tea)).toBe('47.000');
    const twice = await s.c.client.request('POST', `/pos/sales/${supSale.id}/void`, {
      cookies: sup.cookies,
      body: { idempotencyKey: newId(), reason: 'customer_cancelled' },
    });
    expect(twice.json().code).toBe('NOT_VOIDABLE');
  });

  it('exchanges items: credit pays the new sale, difference paid or refunded, stock consistent', async () => {
    const s = await setup();
    const cashier = await staff(s, 'cashier', 'R1');
    const sale = await sell(
      s,
      cashier.cookies,
      [{ variantId: s.tea, quantity: '2' }],
      [{ methodId: s.card, amount: '2.000' }],
      '2.000',
    );
    // Return 1 tea (1.000 credit), take 4 cakes (1.332): 0.332 still due in cash.
    const up = await s.c.client.request('POST', '/pos/exchanges', {
      cookies: cashier.cookies,
      body: {
        idempotencyKey: newId(),
        saleId: sale.id,
        reason: 'wrong_item',
        returnLines: [{ position: 0, quantity: '1' }],
        lines: [{ variantId: s.cake, quantity: '4' }],
        payments: [{ methodId: s.cash, amount: '0.332' }],
        expectedTotal: '1.332',
      },
    });
    expect(up.statusCode).toBe(201);
    const { refund: r1, sale: s1 } = up.json();
    expect(r1).toMatchObject({
      kind: 'exchange',
      status: 'completed',
      total: { amount: '1.000' },
      exchangeCredit: { amount: '1.000' },
    });
    expect(
      s1.payments
        .map((p: { kind: string; amount: { amount: string } }) => [p.kind, p.amount.amount])
        .sort(),
    ).toEqual([
      ['cash', '0.332'],
      ['exchange', '1.000'],
    ]);
    expect(await onHand(s, s.tea)).toBe('49.000');
    expect(await onHand(s, s.cake)).toBe('46.000');

    // Return the remaining tea (1.000) for one cake (0.333): 0.667 back to the card.
    const down = await s.c.client.request('POST', '/pos/exchanges', {
      cookies: cashier.cookies,
      body: {
        idempotencyKey: newId(),
        saleId: sale.id,
        reason: 'changed_mind',
        returnLines: [{ position: 0, quantity: '1' }],
        lines: [{ variantId: s.cake, quantity: '1' }],
        payments: [],
        expectedTotal: '0.333',
      },
    });
    expect(down.statusCode).toBe(201);
    expect(
      down
        .json()
        .refund.payments.map((p: { kind: string; amount: { amount: string } }) => [
          p.kind,
          p.amount.amount,
        ])
        .sort(),
    ).toEqual([
      ['card', '0.667'],
      ['exchange', '0.333'],
    ]);
    // Nothing left to return on the original sale.
    const lookup = (
      await s.c.client.request('GET', `/pos/refunds/lookup?receipt=${sale.receiptNumber}`, {
        cookies: cashier.cookies,
      })
    ).json();
    expect(lookup.refundable.amount).toBe('0.000');
    // Wrong difference payments are refused atomically (no refund recorded).
    const before = await owner.query(
      'select count(*)::int as n from refunds where merchant_id = $1',
      [s.c.merchantId],
    );
    const sale2 = await sell(
      s,
      cashier.cookies,
      [{ variantId: s.tea, quantity: '1' }],
      [{ methodId: s.cash, amount: '1.000' }],
      '1.000',
    );
    const bad = await s.c.client.request('POST', '/pos/exchanges', {
      cookies: cashier.cookies,
      body: {
        idempotencyKey: newId(),
        saleId: sale2.id,
        reason: 'wrong_item',
        returnLines: [{ position: 0, quantity: '1' }],
        lines: [{ variantId: s.cake, quantity: '6' }],
        payments: [],
        expectedTotal: '1.998',
      },
    });
    expect(bad.json().code).toBe('PAYMENT_TOTAL_MISMATCH');
    const after = await owner.query(
      'select count(*)::int as n from refunds where merchant_id = $1',
      [s.c.merchantId],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('keeps refund records final and shows unusual activity to managers', async () => {
    const s = await setup();
    const cashier = await staff(s, 'cashier', 'R1');
    const sale = await sell(
      s,
      cashier.cookies,
      [{ variantId: s.tea, quantity: '2' }],
      [{ methodId: s.cash, amount: '2.000' }],
      '2.000',
    );
    const r = (
      await refund(s, cashier.cookies, { saleId: sale.id, lines: [{ position: 0, quantity: '1' }] })
    ).json();
    const database = app.get(DatabaseService);
    for (const statement of [
      sql`update refunds set status = 'pending_approval'`,
      sql`update refund_lines set quantity = 5`,
      sql`delete from refunds`,
      sql`update refund_payments set amount_minor = 1`,
    ]) {
      await expect(
        database.withMerchantTx(s.c.merchantId, (tx) => tx.execute(statement)),
      ).rejects.toThrow();
    }
    const list = (
      await s.c.client.request('GET', '/manager/refunds', { cookies: s.c.cookies })
    ).json();
    expect(list.refunds.map((x: { id: string }) => x.id)).toEqual([r.id]);
    const activity = (
      await s.c.client.request('GET', '/manager/refunds/activity', { cookies: s.c.cookies })
    ).json();
    expect(activity.byEmployee[0]).toMatchObject({
      sales: 1,
      refunds: 1,
      refundAmount: { amount: '1.000' },
      refundRate: '50.00',
      flagged: true,
    });
    // Another merchant sees nothing.
    const other = await setup();
    expect(
      (
        await other.c.client.request('GET', `/manager/refunds/${r.id}`, {
          cookies: other.c.cookies,
        })
      ).statusCode,
    ).toBe(404);
  });
});
