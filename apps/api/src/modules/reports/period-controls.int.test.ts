import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../kernel/ids.js';
import { DbFixtures, createCompany, sessionCookie } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

/**
 * Remediation session 10: one cut-off rule (R4.1), gross profit with an uncosted share and the
 * online row (R4.3), report access log, dashboard KPIs and the configurable activity review
 * (R4.4), and the supplier statement (R4.5).
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

const KUWAIT_OFFSET_MS = 3 * 3600_000;
/** Today in the merchant's zone (Asia/Kuwait, UTC+3, no DST). */
const today = () => new Date(Date.now() + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
const shift = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** The instant at which the Kuwait local day `date` starts. */
const kuwaitDayStart = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - KUWAIT_OFFSET_MS);
const minutes = (n: number) => n * 60_000;

async function setup() {
  const c = await createCompany(app, db, mailer);
  await c.allowOwnSaleRefunds();
  const req = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    path: string,
    body?: unknown,
    cookies = c.cookies,
  ) => c.client.request(method, path, { cookies, ...(body === undefined ? {} : { body }) });
  const mk = async (nameEn: string, price: string, cost: string | null) =>
    (
      await req('POST', '/manager/products', {
        nameEn,
        ...(cost === null ? { type: 'service', trackInventory: false } : {}),
        variants: [{ price, ...(cost === null ? {} : { cost }) }],
      })
    ).json().variants[0].id as string;
  const tea = await mk('Tea', '1.000', '0.400');
  const gift = await mk('Gift wrap', '2.000', null);
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
  const card = methods.find((m) => m.kind === 'card')!.id;
  /** Updates the company policy keeping every other field as it is. */
  const policy = async (patch: Record<string, unknown>) => {
    const cur = (await req('GET', '/manager/sales-settings')).json();
    const res = await req('PUT', '/manager/sales-settings', {
      maxDiscountPercent: cur.maxDiscountPercent,
      refundWindowDays: cur.refundWindowDays,
      refundApprovalLimit: cur.refundApprovalLimit.amount,
      blindCashCount: cur.blindCashCount,
      cashOutOtherLimit: cur.cashOutOtherLimit.amount,
      cashOutOtherShiftLimit: cur.cashOutOtherShiftLimit.amount,
      maxRegisterTolerance: cur.maxRegisterTolerance.amount,
      expenseApprovalLimit: cur.expenseApprovalLimit.amount,
      supplierPaymentApprovalLimit: cur.supplierPaymentApprovalLimit.amount,
      version: cur.version,
      ...patch,
    });
    if (res.statusCode !== 200) throw new Error(res.body);
    return res.json();
  };
  const till = async (branchId: string, role: keyof Co['roles'] = 'supervisor') => {
    const emp = await c.hire([{ roleId: c.roles[role], branchId }], 'pos');
    const registers = (await req('GET', `/manager/registers?branchId=${branchId}`)).json()
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
  const sell = async (cookies: Cookies, body: Record<string, unknown>) => {
    const res = await req('POST', '/pos/sales', { idempotencyKey: newId(), ...body }, cookies);
    if (res.statusCode !== 201) throw new Error(res.body);
    return res.json() as { id: string; receiptNumber: string };
  };
  const refund = async (cookies: Cookies, saleId: string, quantity = '1') => {
    const res = await req(
      'POST',
      '/pos/refunds',
      {
        idempotencyKey: newId(),
        saleId,
        reason: 'changed_mind',
        lines: [{ position: 0, quantity, restock: true }],
      },
      cookies,
    );
    if (res.statusCode !== 201) throw new Error(res.body);
    return res.json() as { id: string; status: string };
  };
  const audit = async (action: string) =>
    (await req('GET', `/manager/audit?action=${action}`)).json().entries as {
      action: string;
      details: Record<string, unknown>;
    }[];
  return { c, req, tea, gift, cash, card, policy, till, sell, refund, audit };
}

const q = (from: string, to = from) => `?from=${from}&to=${to}`;

describe('one cut-off rule (R4.1)', () => {
  it('cuts lists, statements and reports on the same local days and counts refunds on their completion day', async () => {
    const s = await setup();
    const d0 = today();
    const d1 = shift(d0, -1);
    const treasury = await s.c.countTreasury(s.c.main, '20.000');
    const a = await s.till(s.c.main);
    const s1 = await s.sell(a, {
      lines: [{ variantId: s.tea, quantity: '3' }],
      payments: [{ methodId: s.cash, amount: '3.000' }],
      expectedTotal: '3.000',
    });
    const s2 = await s.sell(a, {
      lines: [{ variantId: s.tea, quantity: '2' }],
      payments: [{ methodId: s.card, amount: '2.000', reference: 'K-1' }],
      expectedTotal: '2.000',
    });
    // s2 was rung up yesterday 23:30 Kuwait time; its refund is completed today.
    await owner.query(`update sales set created_at = $2 where id = $1`, [
      s2.id,
      new Date(kuwaitDayStart(d0).getTime() - minutes(30)),
    ]);
    const r = await s.refund(a, s2.id, '1');
    expect(r.status).toBe('completed');
    // An expense paid today 01:30 Kuwait time (still yesterday in UTC).
    const expense = await s.req('POST', '/manager/cash/disbursements', {
      branchId: s.c.main,
      kind: 'expense',
      category: 'utilities',
      amount: '2.000',
      idempotencyKey: newId(),
      description: 'Electricity',
    });
    expect(expense.statusCode, expense.body).toBe(201);
    const early = new Date(kuwaitDayStart(d0).getTime() + minutes(90));
    await owner.query(`update cash_disbursements set created_at = $2 where id = $1`, [
      expense.json().id,
      early,
    ]);
    await owner.query(
      `update financial_account_entries set created_at = $2 where source_type = 'cash_disbursement' and source_id = $1`,
      [expense.json().id, early],
    );
    // The treasury's opening count happened yesterday.
    await owner.query(
      `update financial_account_entries set created_at = $2 where account_id = $1 and entry_type <> 'expense'`,
      [treasury, new Date(kuwaitDayStart(d0).getTime() - minutes(60))],
    );

    // Sales history today: one sale, and the refund completed today even though its sale
    // belongs to yesterday; net equals the report.
    const listToday = (await s.req('GET', `/manager/sales${q(d0)}`)).json();
    expect(listToday.totals).toEqual({
      count: 1,
      amount: { amount: '3.000', currency: 'KWD' },
      refunded: { amount: '1.000', currency: 'KWD' },
      net: { amount: '2.000', currency: 'KWD' },
    });
    expect(listToday.sales.map((x: { id: string }) => x.id)).toEqual([s1.id]);
    const report = (await s.req('GET', `/manager/reports/sales${q(d0)}`)).json();
    expect(report.summary.netAfterRefunds.amount).toBe('2.000');
    expect(report.summary.refunds.amount).toBe('1.000');
    // Yesterday: the sale, no refund (it was not completed yesterday).
    const listYesterday = (await s.req('GET', `/manager/sales${q(d1)}`)).json();
    expect(listYesterday.totals).toMatchObject({
      count: 1,
      amount: { amount: '2.000' },
      refunded: { amount: '0.000' },
      net: { amount: '2.000' },
    });
    expect(listYesterday.sales[0].refunded.amount).toBe('1.000'); // per sale, informative

    // Refund register by business date, with totals over every match.
    const regToday = (await s.req('GET', `/manager/refunds${q(d0)}`)).json();
    expect(regToday.total).toBe(1);
    expect(regToday.totals).toEqual({
      count: 1,
      completedCount: 1,
      amount: { amount: '1.000', currency: 'KWD' },
    });
    expect((await s.req('GET', `/manager/refunds${q(d1)}`)).json().total).toBe(0);

    // Disbursements and variances cut on local days, not UTC days.
    const disbToday = (await s.req('GET', `/manager/cash/disbursements${q(d0)}`)).json();
    expect(disbToday.total).toBe(1);
    expect((await s.req('GET', `/manager/cash/disbursements${q(d1)}`)).json().total).toBe(0);
    expect(
      (await s.req('GET', `/manager/cash/variances?status=all&from=${d0}&to=${d0}`)).statusCode,
    ).toBe(200);

    // Statement with a period: balance brought forward, the day's movements, closing balance.
    const stmt = (await s.req('GET', `/manager/cash/accounts/${treasury}/entries${q(d0)}`)).json();
    expect(stmt.period).toEqual({ from: d0, to: d0, timezone: 'Asia/Kuwait' });
    expect(stmt.openingBalance.amount).toBe('20.000');
    expect(stmt.totalIn.amount).toBe('0.000');
    expect(stmt.totalOut.amount).toBe('2.000');
    expect(stmt.closingBalance.amount).toBe('18.000');
    expect(stmt.total).toBe(1);
    expect(stmt.entries[0]).toMatchObject({ entryType: 'expense', balance: { amount: '18.000' } });
    const whole = (await s.req('GET', `/manager/cash/accounts/${treasury}/entries`)).json();
    expect(whole.period).toBeNull();
    expect(whole.openingBalance.amount).toBe('0.000');
    expect(whole.closingBalance.amount).toBe('18.000');
    expect(whole.total).toBe(2);
    expect(
      (await s.req('GET', `/manager/cash/accounts/${treasury}/entries${q(d1)}`)).json(),
    ).toMatchObject({
      openingBalance: { amount: '0.000' },
      totalIn: { amount: '20.000' },
      closingBalance: { amount: '20.000' },
      total: 1,
    });
  });

  it('sets the time zone once at registration and audits any later change', async () => {
    const s = await setup();
    const profile = (await s.req('GET', '/manager/merchant')).json();
    expect(profile.timezone).toBe('Asia/Kuwait');
    expect(profile.timezoneChangedAt).toBeNull();
    const body = {
      version: profile.version,
      nameEn: profile.nameEn,
      nameAr: profile.nameAr,
      legalName: profile.legalName,
      commercialRegistrationNo: profile.commercialRegistrationNo,
      contactEmail: profile.contactEmail,
      contactPhone: profile.contactPhone,
      defaultLanguage: profile.defaultLanguage,
    };
    // Unknown zone refused; a profile save without the field leaves it alone.
    expect(
      (await s.req('PATCH', '/manager/merchant', { ...body, timezone: 'Mars/Olympus' })).statusCode,
    ).toBe(400);
    const same = (
      await s.req('PATCH', '/manager/merchant', { ...body, legalName: 'Co WLL' })
    ).json();
    expect(same.timezone).toBe('Asia/Kuwait');
    expect(same.timezoneChangedAt).toBeNull();
    expect(await s.audit('merchant.timezone_changed')).toHaveLength(0);
    const changed = (
      await s.req('PATCH', '/manager/merchant', {
        ...body,
        version: same.version,
        timezone: 'Asia/Dubai',
      })
    ).json();
    expect(changed.timezone).toBe('Asia/Dubai');
    expect(changed.timezoneChangedAt).not.toBeNull();
    const entries = await s.audit('merchant.timezone_changed');
    expect(entries).toHaveLength(1);
    expect(entries[0]!.details).toEqual({ from: 'Asia/Kuwait', to: 'Asia/Dubai' });
    // Reports now cut on Dubai days.
    expect((await s.req('GET', `/manager/reports/sales${q(today())}`)).json().period.timezone).toBe(
      'Asia/Dubai',
    );

    // Registration takes the zone once.
    const email = `tz-${newId()}@example.com`;
    const reg = await s.c.client.request('POST', '/auth/register', {
      body: {
        company: { nameEn: 'Riyadh Co', timezone: 'Asia/Riyadh' },
        owner: { fullName: 'Owner', email, password: 'Owner-Pass-2026' },
      },
    });
    expect(reg.statusCode, reg.body).toBe(201);
    const me = await s.c.client.request('GET', '/manager/merchant', {
      cookies: sessionCookie(reg, 'manager'),
    });
    expect(me.json().timezone).toBe('Asia/Riyadh');
    expect(
      (
        await s.c.client.request('POST', '/auth/register', {
          body: {
            company: { nameEn: 'Bad Co', timezone: 'Nowhere/Land' },
            owner: {
              fullName: 'Owner',
              email: `bad-${newId()}@example.com`,
              password: 'Owner-Pass-2026',
            },
          },
        })
      ).statusCode,
    ).toBe(400);
  });
});

describe('profit, dashboard, access log and activity review (R4.3, R4.4)', () => {
  it('shows gross profit with the uncosted share, an online row, today’s KPIs, and logs report access', async () => {
    const s = await setup();
    const d0 = today();
    const a = await s.till(s.c.main);
    const teaSale = await s.sell(a, {
      lines: [{ variantId: s.tea, quantity: '1' }],
      payments: [{ methodId: s.cash, amount: '1.000' }],
      expectedTotal: '1.000',
    });
    await s.sell(a, {
      lines: [{ variantId: s.gift, quantity: '1' }],
      payments: [{ methodId: s.cash, amount: '2.000' }],
      expectedTotal: '2.000',
    });
    // Gross profit on the costed part only; the uncosted share is shown, not hidden.
    const r = (await s.req('GET', `/manager/reports/sales${q(d0)}`)).json();
    expect(r.profit).toEqual({
      available: false,
      missingCostSales: 1,
      uncostedSales: { amount: '2.000', currency: 'KWD' },
      uncostedSharePercent: '66.7',
      costOfSales: { amount: '0.400', currency: 'KWD' },
      restockedCost: { amount: '0.000', currency: 'KWD' },
      grossProfit: { amount: '0.600', currency: 'KWD' },
      marginPercent: '60.0',
    });
    // No online sales: no "online" row (the row itself is covered by the e-commerce suite).
    expect(r.byEmployee.map((e: { membershipId: string }) => e.membershipId)).not.toContain(
      'online',
    );

    // Dashboard KPIs: today and yesterday in the merchant's zone, open shifts, in scope.
    const kpi = (await s.req('GET', '/manager/reports/today')).json();
    expect(kpi).toMatchObject({
      date: d0,
      timezone: 'Asia/Kuwait',
      today: {
        saleCount: 2,
        netSales: { amount: '3.000' },
        refundCount: 0,
        netAfterRefunds: { amount: '3.000' },
      },
      yesterday: { saleCount: 0, netSales: { amount: '0.000' } },
      openShifts: 1,
      hasSales: true,
    });
    // Only holders of reports.sales see the figures (a cashier's session is refused).
    expect((await s.req('GET', '/manager/reports/today', undefined, a)).statusCode).toBe(401);
    const fresh = await createCompany(app, db, mailer);
    expect(
      (
        await fresh.client.request('GET', '/manager/reports/today', { cookies: fresh.cookies })
      ).json().hasSales,
    ).toBe(false);

    // Report access is audited: views with their period and scope, exports with their rows.
    const views = await s.audit('report.viewed');
    expect(views.length).toBeGreaterThanOrEqual(1);
    expect(views[0]!.details).toMatchObject({ report: 'sales', from: d0, to: d0 });
    expect(
      (
        await s.req('POST', '/manager/reports/exports', {
          report: 'sales',
          section: 'byProduct',
          from: d0,
          to: d0,
          rows: 2,
        })
      ).statusCode,
    ).toBe(204);
    const exports = await s.audit('report.exported');
    expect(exports).toHaveLength(1);
    expect(exports[0]!.details).toMatchObject({ report: 'sales', section: 'byProduct', rows: 2 });

    // Unusual-activity review: threshold and default window are company policy.
    await s.refund(a, teaSale.id, '1'); // 1.000 refunded on 3.000 sold = 33.33 %
    let activity = (await s.req('GET', '/manager/refunds/activity')).json();
    expect(activity.flagThresholdPercent).toBe('10');
    expect(activity.period).toEqual({ from: shift(d0, -29), to: d0, timezone: 'Asia/Kuwait' });
    expect(activity.byEmployee[0]).toMatchObject({ refundRate: '33.33', flagged: true });
    const saved = await s.policy({ unusualRefundRatePercent: '50', unusualActivityDays: 7 });
    expect(saved).toMatchObject({ unusualRefundRatePercent: '50', unusualActivityDays: 7 });
    activity = (await s.req('GET', '/manager/refunds/activity')).json();
    expect(activity.flagThresholdPercent).toBe('50');
    expect(activity.period.from).toBe(shift(d0, -6));
    expect(activity.byEmployee[0].flagged).toBe(false);
    // Explicit dates win over the window.
    activity = (
      await s.req('GET', `/manager/refunds/activity?from=${shift(d0, -1)}&to=${d0}`)
    ).json();
    expect(activity.period).toMatchObject({ from: shift(d0, -1), to: d0 });
    const policyAudit = await s.audit('sales.settings_updated');
    expect(policyAudit[0]!.details).toMatchObject({
      unusualRefundRatePercent: { from: '10', to: '50' },
      unusualActivityDays: { from: 30, to: 7 },
    });
  });
});

describe('supplier statement (R4.5)', () => {
  it('lists goods received against cash paid with the running difference and a period', async () => {
    const s = await setup();
    const d0 = today();
    await s.c.countTreasury(s.c.main, '50.000');
    const supplierId = (
      await s.req('POST', '/manager/suppliers', { code: 'GF', nameEn: 'Gulf Foods' })
    ).json().id as string;
    const po = (
      await s.req('POST', '/manager/purchase-orders', {
        supplierId,
        branchId: s.c.main,
        lines: [{ variantId: s.tea, quantity: '10', unitCost: '0.400' }],
      })
    ).json();
    const submitted = (
      await s.req('POST', `/manager/purchase-orders/${po.id}/submit`, { version: po.version })
    ).json();
    await s.req('POST', `/manager/purchase-orders/${po.id}/approve`, {
      version: submitted.version,
    });
    const receipt = await s.req('POST', `/manager/purchase-orders/${po.id}/receipts`, {
      idempotencyKey: newId(),
      supplierReference: 'INV-9',
      lines: [{ position: 0, quantity: '10' }],
    });
    expect(receipt.statusCode, receipt.body).toBe(201);
    const pay = async (amount: string) => {
      const res = await s.req('POST', '/manager/cash/disbursements', {
        branchId: s.c.main,
        kind: 'supplier_payment',
        supplierId,
        purchaseOrderId: po.id,
        amount,
        idempotencyKey: newId(),
      });
      expect(res.statusCode, res.body).toBe(201);
      return res.json() as { id: string; number: string };
    };
    const p1 = await pay('1.500');
    const reversed = await s.req('POST', `/manager/cash/disbursements/${p1.id}/reverse`, {
      reason: 'paid twice',
      idempotencyKey: newId(),
    });
    expect(reversed.statusCode, reversed.body).toBe(201);
    const p2 = await pay('1.000');

    const stmt = (await s.req('GET', `/manager/suppliers/${supplierId}/statement`)).json();
    expect(stmt.supplier).toMatchObject({ id: supplierId, nameEn: 'Gulf Foods' });
    expect(stmt.period).toBeNull();
    expect(stmt.openingBalance.amount).toBe('0.000');
    expect(stmt.totals).toEqual({
      received: { amount: '4.000', currency: 'KWD' },
      paid: { amount: '2.500', currency: 'KWD' },
      reversed: { amount: '1.500', currency: 'KWD' },
      closingBalance: { amount: '3.000', currency: 'KWD' },
    });
    expect(
      stmt.lines.map((l: Record<string, { amount: string } | string>) => [
        l['kind'],
        (l['received'] as { amount: string }).amount,
        (l['paid'] as { amount: string }).amount,
        (l['balance'] as { amount: string }).amount,
      ]),
    ).toEqual([
      ['payment', '0.000', '1.000', '3.000'],
      ['reversal', '0.000', '-1.500', '4.000'],
      ['payment', '0.000', '1.500', '2.500'],
      ['receipt', '4.000', '0.000', '4.000'],
    ]);
    expect(stmt.lines[3]).toMatchObject({ reference: 'INV-9', orderNumber: po.number });
    expect(stmt.lines[0]).toMatchObject({ document: p2.number, orderNumber: po.number });

    // A period brings the balance forward.
    const tomorrow = shift(d0, 1);
    const later = (
      await s.req('GET', `/manager/suppliers/${supplierId}/statement${q(tomorrow)}`)
    ).json();
    expect(later.period).toEqual({ from: tomorrow, to: tomorrow, timezone: 'Asia/Kuwait' });
    expect(later.lines).toEqual([]);
    expect(later.openingBalance.amount).toBe('3.000');
    expect(later.totals.closingBalance.amount).toBe('3.000');
    const todayOnly = (
      await s.req('GET', `/manager/suppliers/${supplierId}/statement${q(d0)}`)
    ).json();
    expect(todayOnly.openingBalance.amount).toBe('0.000');
    expect(todayOnly.lines).toHaveLength(4);

    // Branch scope: a manager of the other branch sees none of these lines.
    const other = await s.c.hire(
      [{ roleId: s.c.roles.branch_manager, branchId: s.c.second }],
      'manager',
    );
    const scoped = await s.req(
      'GET',
      `/manager/suppliers/${supplierId}/statement`,
      undefined,
      other.cookies,
    );
    expect(scoped.statusCode, scoped.body).toBe(200);
    expect(scoped.json().lines).toEqual([]);
    expect(scoped.json().totals.closingBalance.amount).toBe('0.000');
    expect((await s.req('GET', `/manager/suppliers/${newId()}/statement`)).statusCode).toBe(404);
  });
});
