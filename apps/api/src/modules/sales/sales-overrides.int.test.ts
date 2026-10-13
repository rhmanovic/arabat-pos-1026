import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../kernel/ids.js';
import { DbFixtures, PASSWORD, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

/**
 * Remediation session 8 (ADR-0100): supervisor overrides on the cashier's till (R3.1, BR-177),
 * price-change bounds and above-limit flags (R3.2, BR-178) and zero-total sales (R3.3, BR-179).
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

/** A company with one product (list 10.000, cost 6.000, 20 in stock) and the cash method. */
async function store(price = '10.000', cost = '6.000') {
  const c = await createCompany(app, db, mailer);
  await c.showExpectedCash();
  const product = (
    await c.client.request('POST', '/manager/products', {
      cookies: c.cookies,
      body: {
        nameEn: 'Oud oil',
        nameAr: 'دهن عود',
        variants: [{ sku: `OUD-${newId().slice(-6)}`, price, cost, barcodes: [] }],
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
      lines: [{ variantId, quantity: '20' }],
    },
  });
  const methods = (
    await c.client.request('GET', '/manager/payment-methods', { cookies: c.cookies })
  ).json().methods as { id: string; kind: string }[];
  const cash = methods.find((m) => m.kind === 'cash')!.id;
  const registers = (
    await c.client.request('GET', `/manager/registers?branchId=${c.main}`, { cookies: c.cookies })
  ).json().registers as { id: string }[];
  return { c, variantId, cash, register: registers[0]!.id };
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

async function role(s: Store, nameEn: string, permissions: string[]) {
  const res = await s.c.client.request('POST', '/manager/roles', {
    cookies: s.c.cookies,
    body: { nameEn, permissions },
  });
  if (res.statusCode !== 201) throw new Error(res.body);
  return res.json().id as string;
}

function checkout(s: Store, cookies: Cookies, body: Record<string, unknown>) {
  return s.c.client.request('POST', '/pos/sales', {
    cookies,
    body: { idempotencyKey: newId(), ...body },
  });
}

const line = (s: Store, extra: Record<string, unknown> = {}, quantity = '1') => ({
  variantId: s.variantId,
  quantity,
  ...extra,
});

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

describe('supervisor override on the cashier’s till (R3.1, BR-177)', () => {
  it('lends a supervisor’s rights to one sale that stays on the cashier’s shift, audited and reported', async () => {
    const s = await store();
    const cashier = await withShift(s, s.c.roles.cashier);
    // The supervisor is a member of the company but has no shift of their own.
    const supervisor = await s.c.hire(
      [{ roleId: s.c.roles.supervisor, branchId: s.c.main }],
      'pos',
    );
    const cart = {
      lines: [line(s, { discount: { type: 'percent', value: '15' } })],
      payments: [{ methodId: s.cash, amount: '8.500' }],
      expectedTotal: '8.500',
    };
    expect((await checkout(s, cashier.cookies, cart)).json().code).toBe('DISCOUNT_LIMIT_EXCEEDED');

    // Wrong password, the cashier themself, and a colleague with nothing more to lend are refused.
    const wrong = await s.c.client.request('POST', '/pos/overrides', {
      cookies: cashier.cookies,
      body: { email: supervisor.email, password: 'not-the-password' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().code).toBe('INVALID_CREDENTIALS');
    const self = await s.c.client.request('POST', '/pos/overrides', {
      cookies: cashier.cookies,
      body: { email: cashier.email, password: PASSWORD },
    });
    expect(self.json().code).toBe('OVERRIDE_SELF');
    const peer = await s.c.hire([{ roleId: s.c.roles.cashier, branchId: s.c.main }], 'pos');
    const nothing = await s.c.client.request('POST', '/pos/overrides', {
      cookies: cashier.cookies,
      body: { email: peer.email, password: PASSWORD },
    });
    expect(nothing.json().code).toBe('OVERRIDE_NOT_ALLOWED');

    const grant = await s.c.client.request('POST', '/pos/overrides', {
      cookies: cashier.cookies,
      body: { email: supervisor.email, password: PASSWORD, note: 'loyal customer' },
    });
    expect(grant.statusCode).toBe(201);
    expect(grant.json()).toMatchObject({
      approverName: 'Employee',
      permissions: ['sales.discount.override_limit', 'sales.price_override', 'sales.zero_total'],
    });
    const overrideId = grant.json().id as string;

    // Another cashier cannot spend this grant.
    const otherCashier = await withShift(s, s.c.roles.cashier, await newRegister(s, 'R2'));
    expect((await checkout(s, otherCashier.cookies, { ...cart, overrideId })).json().code).toBe(
      'OVERRIDE_INVALID',
    );

    const sale = await checkout(s, cashier.cookies, { ...cart, overrideId });
    expect(sale.statusCode).toBe(201);
    expect(sale.json()).toMatchObject({
      shiftId: cashier.shiftId,
      cashierName: 'Employee',
      total: { amount: '8.500' },
      aboveLimit: true,
      discountLimitPercent: '10',
      override: {
        id: overrideId,
        approverName: 'Employee',
        kinds: ['sales.discount.override_limit'],
        note: 'loyal customer',
      },
    });
    // The cash went into the cashier's drawer, not a supervisor's.
    const shift = (
      await s.c.client.request('GET', '/pos/shifts/current', { cookies: cashier.cookies })
    ).json().shift;
    expect(shift.summary.cashSales.amount).toBe('8.500');

    // Single use: the same grant cannot pay a second sale.
    expect((await checkout(s, cashier.cookies, { ...cart, overrideId })).json().code).toBe(
      'OVERRIDE_INVALID',
    );

    // Audit: the grant by the supervisor and the sale by the cashier naming the override.
    const audit = await owner.query(
      `select action, actor_id, details from audit_log where merchant_id = $1
       and action in ('sale.override_granted', 'sale.completed', 'sale.override_refused') order by occurred_at`,
      [s.c.merchantId],
    );
    const granted = audit.rows.find((r) => r.action === 'sale.override_granted');
    expect(granted.details).toMatchObject({
      permissions: ['sales.discount.override_limit', 'sales.price_override', 'sales.zero_total'],
      note: 'loyal customer',
    });
    expect(granted.actor_id).not.toBe(
      audit.rows.find((r) => r.action === 'sale.completed').actor_id,
    );
    expect(audit.rows.find((r) => r.action === 'sale.completed').details).toMatchObject({
      aboveLimit: true,
      discountLimitPercent: '10',
      override: { id: overrideId, kinds: ['sales.discount.override_limit'] },
    });
    expect(audit.rows.filter((r) => r.action === 'sale.override_refused')).toHaveLength(2);

    // Manager views: flagged in the history, filterable, and counted per employee.
    const list = (
      await s.c.client.request('GET', '/manager/sales?flag=supervised', { cookies: s.c.cookies })
    ).json();
    expect(list.total).toBe(1);
    expect(list.sales[0].flags).toEqual(['above_limit', 'supervised']);
    expect(
      (
        await s.c.client.request('GET', '/manager/sales?flag=zero_total', { cookies: s.c.cookies })
      ).json().total,
    ).toBe(0);
    const today = new Date().toISOString().slice(0, 10);
    const report = (
      await s.c.client.request('GET', `/manager/reports/sales?from=${today}&to=${today}`, {
        cookies: s.c.cookies,
      })
    ).json();
    expect(report.byEmployee).toHaveLength(1);
    expect(report.byEmployee[0]).toMatchObject({
      saleCount: 1,
      aboveLimitSales: 1,
      supervisedSales: 1,
      priceOverrides: 0,
      zeroTotalSales: 0,
    });
  });

  it('expires, and the owner can authorise as well', async () => {
    const s = await store();
    const cashier = await withShift(s, s.c.roles.cashier);
    const ownerEmail = (
      await owner.query(
        'select u.email from users u join memberships m on m.user_id = u.id where m.merchant_id = $1 and m.is_owner',
        [s.c.merchantId],
      )
    ).rows[0].email as string;
    const grant = await s.c.client.request('POST', '/pos/overrides', {
      cookies: cashier.cookies,
      body: { email: ownerEmail, password: PASSWORD },
    });
    expect(grant.statusCode).toBe(201);
    expect(grant.json().permissions).toEqual([
      'sales.discount.override_limit',
      'sales.price_override',
      'sales.zero_total',
    ]);
    // Age the grant (the consumption trigger guards every update, so it is paused for this).
    await owner.query(
      `begin; alter table sale_overrides disable trigger sale_overrides_use;
       update sale_overrides set expires_at = now() - interval '1 second' where id = '${grant.json().id}';
       alter table sale_overrides enable trigger sale_overrides_use; commit;`,
    );
    const late = await checkout(s, cashier.cookies, {
      lines: [line(s, { discount: { type: 'percent', value: '15' } })],
      payments: [{ methodId: s.cash, amount: '8.500' }],
      expectedTotal: '8.500',
      overrideId: grant.json().id,
    });
    expect(late.json().code).toBe('OVERRIDE_INVALID');
  });
});

describe('price-change bounds and above-limit flags (R3.2, BR-178)', () => {
  it('needs a reason, stays within the floor, ceiling and cost, and counts the gap as a discount', async () => {
    const s = await store('10.000', '6.000');
    const sup = await withShift(s, s.c.roles.supervisor);
    const pay = (amount: string) => ({
      payments: [{ methodId: s.cash, amount }],
      expectedTotal: amount,
    });
    // No reason.
    const noReason = await checkout(s, sup.cookies, {
      lines: [line(s, { priceOverride: '9.500' })],
      ...pay('9.500'),
    });
    expect(noReason.statusCode).toBe(400);
    expect(noReason.json().code).toBe('REASON_REQUIRED');
    // Default floor 50 % and ceiling 200 % of the list price; never below cost.
    for (const price of ['4.999', '20.001', '5.999']) {
      const res = await checkout(s, sup.cookies, {
        lines: [line(s, { priceOverride: price, priceOverrideReason: 'test' })],
        ...pay(price),
      });
      expect(res.json().code, price).toBe('PRICE_OUT_OF_BOUNDS');
    }
    // Within the limit: not flagged.
    const small = await checkout(s, sup.cookies, {
      lines: [line(s, { priceOverride: '9.500', priceOverrideReason: 'scratched box' })],
      ...pay('9.500'),
    });
    expect(small.statusCode).toBe(201);
    expect(small.json()).toMatchObject({ aboveLimit: false, discountLimitPercent: '10' });
    expect(small.json().lines[0].priceOverrideReason).toBe('scratched box');
    // A 40 % cut is above the limit: the supervisor may, the sale is flagged.
    const deep = await checkout(s, sup.cookies, {
      lines: [line(s, { priceOverride: '6.000', priceOverrideReason: 'clearance' })],
      ...pay('6.000'),
    });
    expect(deep.statusCode).toBe(201);
    expect(deep.json().aboveLimit).toBe(true);

    // A role that may change prices but not exceed the limit cannot hide a discount in a price.
    const pricer = await role(s, 'Pricer', [
      'pos.access',
      'sales.create',
      'shifts.operate',
      'catalog.read',
      'sales.price_override',
    ]);
    const p = await withShift(s, pricer, await newRegister(s, 'R2'));
    const hidden = await checkout(s, p.cookies, {
      lines: [line(s, { priceOverride: '8.000', priceOverrideReason: 'friend' })],
      ...pay('8.000'),
    });
    expect(hidden.json().code).toBe('DISCOUNT_LIMIT_EXCEEDED');
    const fair = await checkout(s, p.cookies, {
      lines: [line(s, { priceOverride: '9.000', priceOverrideReason: 'price match' })],
      ...pay('9.000'),
    });
    expect(fair.statusCode).toBe(201);
    expect(fair.json().aboveLimit).toBe(false);

    // The owner may relax the bounds: below cost allowed, no floor; the ceiling still holds.
    const relaxed = await policy(s, {
      priceOverrideFloorPercent: null,
      priceOverrideBelowCost: true,
      priceOverrideCeilingPercent: '150',
    });
    expect(relaxed).toMatchObject({
      priceOverrideFloorPercent: null,
      priceOverrideCeilingPercent: '150',
      priceOverrideBelowCost: true,
    });
    const belowCost = await checkout(s, sup.cookies, {
      lines: [line(s, { priceOverride: '3.000', priceOverrideReason: 'expiring' })],
      ...pay('3.000'),
    });
    expect(belowCost.statusCode).toBe(201);
    expect(
      (
        await checkout(s, sup.cookies, {
          lines: [line(s, { priceOverride: '15.001', priceOverrideReason: 'x' })],
          ...pay('15.001'),
        })
      ).json().code,
    ).toBe('PRICE_OUT_OF_BOUNDS');
    // The floor may not exceed the ceiling.
    await expect(policy(s, { priceOverrideFloorPercent: '160' })).rejects.toThrow(/400/);
    // POS reads the bounds with the policy.
    const posPolicy = (
      await s.c.client.request('GET', '/pos/sales/settings', { cookies: sup.cookies })
    ).json();
    expect(posPolicy).toMatchObject({
      priceOverrideFloorPercent: null,
      priceOverrideCeilingPercent: '150',
    });
    // Flagged sales are listed and counted.
    const list = (
      await s.c.client.request('GET', '/manager/sales?flag=price_override', {
        cookies: s.c.cookies,
      })
    ).json();
    expect(list.total).toBe(4);
    expect(
      (
        await s.c.client.request('GET', '/manager/sales?flag=above_limit', { cookies: s.c.cookies })
      ).json().total,
    ).toBe(2);
  });
});

describe('zero-total sales (R3.3, BR-179)', () => {
  it('require a dedicated right and a reason, and are listed as unusual', async () => {
    const s = await store();
    // Above-limit discounts without the zero-total right: a free sale is refused.
    const discounter = await role(s, 'Discounter', [
      'pos.access',
      'sales.create',
      'shifts.operate',
      'catalog.read',
      'sales.discount',
      'sales.discount.override_limit',
    ]);
    const d = await withShift(s, discounter);
    const free = {
      lines: [line(s, { discount: { type: 'percent', value: '100' } })],
      payments: [],
      expectedTotal: '0',
    };
    expect((await checkout(s, d.cookies, free)).json().code).toBe('ZERO_TOTAL_DENIED');
    // A zero price is a 100 % discount too (and falls below the floor): refused as well.
    const sup = await withShift(s, s.c.roles.supervisor, await newRegister(s, 'R2'));
    expect(
      (
        await checkout(s, sup.cookies, {
          lines: [line(s, { priceOverride: '0', priceOverrideReason: 'gift' })],
          payments: [],
          expectedTotal: '0',
        })
      ).json().code,
    ).toBe('PRICE_OUT_OF_BOUNDS');
    // The supervisor may, with a reason.
    const noReason = await checkout(s, sup.cookies, free);
    expect(noReason.json().code).toBe('REASON_REQUIRED');
    const done = await checkout(s, sup.cookies, {
      ...free,
      zeroTotalReason: 'tester for the stand',
    });
    expect(done.statusCode).toBe(201);
    expect(done.json()).toMatchObject({
      total: { amount: '0.000' },
      zeroTotalReason: 'tester for the stand',
      aboveLimit: true,
      payments: [],
    });
    // The cashier gets it through a supervisor override: the kinds name both rights.
    const cashier = await withShift(s, s.c.roles.cashier, await newRegister(s, 'R3'));
    const grant = await s.c.client.request('POST', '/pos/overrides', {
      cookies: cashier.cookies,
      body: { email: sup.email, password: PASSWORD },
    });
    expect(grant.statusCode).toBe(201);
    const viaOverride = await checkout(s, cashier.cookies, {
      ...free,
      zeroTotalReason: 'tester for the stand',
      overrideId: grant.json().id,
    });
    expect(viaOverride.statusCode).toBe(201);
    expect(viaOverride.json().override.kinds).toEqual([
      'sales.discount.override_limit',
      'sales.zero_total',
    ]);
    // Unusual-activity views.
    const list = (
      await s.c.client.request('GET', '/manager/sales?flag=zero_total', { cookies: s.c.cookies })
    ).json();
    expect(list.total).toBe(2);
    expect(list.sales.map((x: { flags: string[] }) => x.flags).sort()).toEqual([
      ['zero_total', 'above_limit'],
      ['zero_total', 'above_limit', 'supervised'],
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const report = (
      await s.c.client.request('GET', `/manager/reports/sales?from=${today}&to=${today}`, {
        cookies: s.c.cookies,
      })
    ).json();
    const zero = report.byEmployee.reduce(
      (t: number, e: { zeroTotalSales: number }) => t + e.zeroTotalSales,
      0,
    );
    expect(zero).toBe(2);
    // The database itself refuses a free POS sale without a reason.
    await expect(
      owner.query(
        `update sales set zero_total_reason = null where merchant_id = $1 and total_minor = 0`,
        [s.c.merchantId],
      ),
    ).rejects.toThrow(/sales_zero_total_reason/);
  });
});
