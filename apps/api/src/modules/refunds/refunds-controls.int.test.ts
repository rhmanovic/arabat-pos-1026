import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../kernel/ids.js';
import { DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

/**
 * Remediation session 9 (ADR-0101): refund segregation (R3.4, BR-180) and non-cash tender
 * hygiene with the per-method fee policy (R3.5, BR-181, decision D6).
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

async function setup() {
  const c = await createCompany(app, db, mailer);
  await c.showExpectedCash();
  const p = (
    await c.client.request('POST', '/manager/products', {
      cookies: c.cookies,
      body: { nameEn: 'Tea', variants: [{ price: '1.000', cost: '0.400' }] },
    })
  ).json();
  const tea = p.variants[0].id as string;
  await c.client.request('POST', '/manager/inventory/adjustments', {
    cookies: c.cookies,
    body: {
      branchId: c.main,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId: tea, quantity: '100' }],
    },
  });
  const methods = (
    await c.client.request('GET', '/manager/payment-methods', { cookies: c.cookies })
  ).json().methods as { id: string; kind: string; version: number; financialAccountId: string }[];
  const registers = (
    await c.client.request('GET', `/manager/registers?branchId=${c.main}`, { cookies: c.cookies })
  ).json().registers as { id: string }[];
  return {
    c,
    tea,
    cash: methods.find((m) => m.kind === 'cash')!.id,
    card: methods.find((m) => m.kind === 'card')!,
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
    body: { registerId: reg, countedCash: float, expectedCash: '0.000' },
  });
  if (shift.statusCode !== 201) throw new Error(shift.body);
  return { cookies: emp.cookies, shiftId: shift.json().id as string, email: emp.email };
}

async function sell(
  s: Setup,
  cookies: Cookies,
  quantity: string,
  payments: unknown[],
  total: string,
) {
  const res = await s.c.client.request('POST', '/pos/sales', {
    cookies,
    body: {
      idempotencyKey: newId(),
      lines: [{ variantId: s.tea, quantity }],
      payments,
      expectedTotal: total,
    },
  });
  if (res.statusCode !== 201) throw new Error(res.body);
  return res.json() as {
    id: string;
    receiptNumber: string;
    payments: { id: string; kind: string }[];
  };
}

function refund(s: Setup, cookies: Cookies, body: Record<string, unknown>) {
  return s.c.client.request('POST', '/pos/refunds', {
    cookies,
    body: { idempotencyKey: newId(), reason: 'changed_mind', ...body },
  });
}

async function policy(s: Setup, patch: Record<string, unknown>) {
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

describe('refund segregation (R3.4, BR-180)', () => {
  it('holds refunds of the requester’s own sales, even for approvers; the owner overrides, audited', async () => {
    const s = await setup();
    const cashier = await staff(s, 'cashier', 'R1');
    const sale = await sell(
      s,
      cashier.cookies,
      '3',
      [{ methodId: s.cash, amount: '3.000' }],
      '3.000',
    );
    // Preview says why it waits; the customer contact is kept with the request.
    const preview = (
      await s.c.client.request('POST', '/pos/refunds/preview', {
        cookies: cashier.cookies,
        body: { saleId: sale.id, lines: [{ position: 0, quantity: '1' }] },
      })
    ).json();
    expect(preview).toMatchObject({ approvalRequired: true, approvalReasons: ['own_sale'] });
    const own = await refund(s, cashier.cookies, {
      saleId: sale.id,
      lines: [{ position: 0, quantity: '1' }],
      customerContact: '+965 9999 0000',
    });
    expect(own.json()).toMatchObject({
      status: 'pending_approval',
      approvalReasons: ['own_sale'],
      customerContact: '+965 9999 0000',
      ownerOverride: false,
    });
    // A supervisor refunding their own sale waits too (FND-502)…
    const sup = await staff(s, 'supervisor', 'R2');
    const supSale = await sell(
      s,
      sup.cookies,
      '2',
      [{ methodId: s.cash, amount: '2.000' }],
      '2.000',
    );
    const supOwn = await refund(s, sup.cookies, {
      saleId: supSale.id,
      lines: [{ position: 0, quantity: '1' }],
    });
    expect(supOwn.json().status).toBe('pending_approval');
    // …but may approve the cashier's request, which pays from the cashier's drawer.
    const approved = await s.c.client.request('POST', `/pos/refunds/${own.json().id}/approve`, {
      cookies: sup.cookies,
      body: { note: 'customer present' },
    });
    expect(approved.json().status).toBe('completed');
    // The owner completes their own refund directly, flagged and audited as an override.
    const ownerPos = await s.c.ownerPos(s.c.main);
    const r3 = await s.c.client.request('POST', '/manager/registers', {
      cookies: s.c.cookies,
      body: { branchId: s.c.main, code: 'R3', nameEn: 'R3' },
    });
    expect(
      (
        await s.c.client.request('POST', '/pos/shifts', {
          cookies: ownerPos,
          body: { registerId: r3.json().id, countedCash: '20.000', expectedCash: '0.000' },
        })
      ).statusCode,
    ).toBe(201);
    const ownerSale = await sell(
      s,
      ownerPos,
      '1',
      [{ methodId: s.cash, amount: '1.000' }],
      '1.000',
    );
    const ownerRefund = await refund(s, ownerPos, {
      saleId: ownerSale.id,
      lines: [{ position: 0, quantity: '1' }],
    });
    expect(ownerRefund.json()).toMatchObject({
      status: 'completed',
      approvalReasons: ['own_sale'],
      ownerOverride: true,
    });
    const audit = await owner.query(
      `select details from audit_log where merchant_id = $1 and action = 'refund.completed' and target_id = $2`,
      [s.c.merchantId, ownerRefund.json().id],
    );
    expect(audit.rows[0].details).toMatchObject({
      ownerOverride: true,
      approvalReasons: ['own_sale'],
    });
    // The activity report counts refunds of own sales per employee.
    const activity = (
      await s.c.client.request('GET', '/manager/refunds/activity', { cookies: s.c.cookies })
    ).json();
    const cashierRow = activity.byEmployee.find(
      (e: { sales: number; refunds: number }) => e.refunds === 1 && e.sales === 1,
    );
    expect(cashierRow.ownSaleRefunds).toBe(1);
    // The owner may switch the rule off.
    await policy(s, { refundOwnSalesNeedApproval: false });
    const direct = await refund(s, cashier.cookies, {
      saleId: sale.id,
      lines: [{ position: 0, quantity: '1' }],
    });
    expect(direct.json().status).toBe('completed');
  });

  it('pays exchange credit back to the original tenders and lets the approver pay from their own shift', async () => {
    const s = await setup();
    await policy(s, { refundOwnSalesNeedApproval: false });
    const cashier = await staff(s, 'cashier', 'R1');
    const sale = await sell(
      s,
      cashier.cookies,
      '2',
      [{ methodId: s.card.id, amount: '2.000', reference: 'K-1' }],
      '2.000',
    );
    // Exchange: return both teas (2.000 credit) for one tea (1.000): 1.000 back to the card.
    const exchange = await s.c.client.request('POST', '/pos/exchanges', {
      cookies: cashier.cookies,
      body: {
        idempotencyKey: newId(),
        saleId: sale.id,
        reason: 'wrong_item',
        returnLines: [{ position: 0, quantity: '2' }],
        lines: [{ variantId: s.tea, quantity: '1' }],
        payments: [],
        expectedTotal: '1.000',
      },
    });
    expect(exchange.statusCode).toBe(201);
    const newSale = exchange.json().sale as { id: string };
    // Refunding the exchanged sale: the credit goes back to the card, never to cash (FND-504).
    const back = await refund(s, cashier.cookies, {
      saleId: newSale.id,
      lines: [{ position: 0, quantity: '1' }],
    });
    expect(back.statusCode).toBe(201);
    expect(
      back
        .json()
        .payments.map((p: { kind: string; amount: { amount: string } }) => [
          p.kind,
          p.amount.amount,
        ]),
    ).toEqual([['card', '1.000']]);
    const bank = await owner.query(
      `select coalesce(sum(amount_minor), 0)::text as balance from financial_account_entries where account_id = $1`,
      [s.card.financialAccountId],
    );
    // 2.000 collected − 1.000 back on the exchange − 1.000 back on the refund.
    expect(bank.rows[0].balance).toBe('0');
    const drawer = (
      await s.c.client.request('GET', '/pos/shifts/current', { cookies: cashier.cookies })
    ).json().shift.summary;
    expect(drawer.cashRefunds.amount).toBe('0.000');

    // A pending request survives the requester's shift close (FND-509).
    await policy(s, { refundOwnSalesNeedApproval: true });
    const sale2 = await sell(
      s,
      cashier.cookies,
      '5',
      [{ methodId: s.cash, amount: '5.000' }],
      '5.000',
    );
    const pending = await refund(s, cashier.cookies, {
      saleId: sale2.id,
      lines: [{ position: 0, quantity: '5' }],
    });
    expect(pending.json().status).toBe('pending_approval');
    const closed = await s.c.client.request('POST', '/pos/shifts/current/close', {
      cookies: cashier.cookies,
      body: { countedCash: '55.000', version: 1 },
    });
    expect(closed.statusCode).toBe(201);
    // A manager without a shift cannot pay the cash part…
    const fromManager = await s.c.client.request(
      'POST',
      `/manager/refunds/${pending.json().id}/approve`,
      {
        cookies: s.c.cookies,
        body: {},
      },
    );
    expect(fromManager.json().code).toBe('SHIFT_REQUIRED');
    // …the supervisor at the till pays it from their own drawer.
    const sup = await staff(s, 'supervisor', 'R2', '30.000');
    const approved = await s.c.client.request('POST', `/pos/refunds/${pending.json().id}/approve`, {
      cookies: sup.cookies,
      body: { note: 'paid from R2' },
    });
    expect(approved.json().status).toBe('completed');
    const supDrawer = (
      await s.c.client.request('GET', '/pos/shifts/current', { cookies: sup.cookies })
    ).json().shift.summary;
    expect(supDrawer).toMatchObject({
      cashRefunds: { amount: '5.000' },
      expectedCash: { amount: '25.000' },
    });
    const audit = await owner.query(
      `select details from audit_log where merchant_id = $1 and action = 'refund.approved'`,
      [s.c.merchantId],
    );
    expect(audit.rows[0].details.paidFromShiftId).toBe(sup.shiftId);
  });
});

describe('non-cash tender hygiene (R3.5, BR-181, D6)', () => {
  it('requires references and settlement accounts, keeps or reverses fees per method, and lists unreferenced tenders', async () => {
    const s = await setup();
    await policy(s, { refundOwnSalesNeedApproval: false });
    const cashier = await staff(s, 'cashier', 'R1');
    // Reference required on card tenders by default; the owner may switch it off.
    const noRef = await s.c.client.request('POST', '/pos/sales', {
      cookies: cashier.cookies,
      body: {
        idempotencyKey: newId(),
        lines: [{ variantId: s.tea, quantity: '1' }],
        payments: [{ methodId: s.card.id, amount: '1.000' }],
        expectedTotal: '1.000',
      },
    });
    expect(noRef.json().code).toBe('REFERENCE_REQUIRED');
    // A 2 % fee that the provider gives back on refunds.
    const reverse = await s.c.client.request('PATCH', `/manager/payment-methods/${s.card.id}`, {
      cookies: s.c.cookies,
      body: {
        kind: 'card',
        nameEn: 'Card (KNET)',
        feeType: 'percentage',
        feePercent: '2',
        financialAccountId: s.card.financialAccountId,
        refundFeePolicy: 'reverse',
        version: s.card.version,
      },
    });
    expect(reverse.statusCode).toBe(200);
    expect(reverse.json().refundFeePolicy).toBe('reverse');
    const sale = await sell(
      s,
      cashier.cookies,
      '10',
      [{ methodId: s.card.id, amount: '10.000', reference: 'K-9' }],
      '10.000',
    );
    const paymentId = sale.payments.find((p) => p.kind === 'card')!.id;
    // Card pay-backs need a reference too…
    const noRefBack = await refund(s, cashier.cookies, {
      saleId: sale.id,
      lines: [{ position: 0, quantity: '5' }],
      allocation: [{ paymentId, amount: '5.000' }],
    });
    expect(noRefBack.json().code).toBe('REFERENCE_REQUIRED');
    const preview = (
      await s.c.client.request('POST', '/pos/refunds/preview', {
        cookies: cashier.cookies,
        body: { saleId: sale.id, lines: [{ position: 0, quantity: '5' }] },
      })
    ).json();
    expect(preview.allocation[0].referenceRequired).toBe(true);
    // …and half the fee (0.200 on 10.000 → 0.100 on 5.000) comes back with the money.
    const half = await refund(s, cashier.cookies, {
      saleId: sale.id,
      lines: [{ position: 0, quantity: '5' }],
      allocation: [{ paymentId, amount: '5.000', reference: 'REV-1' }],
    });
    expect(half.statusCode).toBe(201);
    expect(half.json().payments[0]).toMatchObject({
      kind: 'card',
      reference: 'REV-1',
      feeReversed: { amount: '0.100' },
    });
    const bank = await owner.query(
      `select entry_type, amount_minor::text as amount from financial_account_entries where account_id = $1 order by created_at, entry_type`,
      [s.card.financialAccountId],
    );
    expect(bank.rows.map((r) => [r.entry_type, r.amount])).toEqual([
      ['fee', '-200'],
      ['payment', '10000'],
      ['fee', '100'],
      ['refund', '-5000'],
    ]);
    // The payments report shows the reversal and the net after fees.
    const today = new Date().toISOString().slice(0, 10);
    const report = (
      await s.c.client.request('GET', `/manager/reports/payments?from=${today}&to=${today}`, {
        cookies: s.c.cookies,
      })
    ).json();
    expect(report.totals).toMatchObject({
      collected: { amount: '10.000' },
      fees: { amount: '0.200' },
      feesReversed: { amount: '0.100' },
      refunded: { amount: '5.000' },
      netAfterFees: { amount: '4.900' },
    });
    expect(report.unreferenced).toMatchObject({ count: 0 });
    // With the switch off a reference may be omitted, and such tenders are listed for review.
    await policy(s, { requireTenderReference: false });
    await sell(s, cashier.cookies, '1', [{ methodId: s.card.id, amount: '1.000' }], '1.000');
    const after = (
      await s.c.client.request('GET', `/manager/reports/payments?from=${today}&to=${today}`, {
        cookies: s.c.cookies,
      })
    ).json();
    expect(after.unreferenced).toMatchObject({ count: 1, amount: { amount: '1.000' } });
    expect(after.unreferenced.items[0]).toMatchObject({
      kind: 'payment',
      amount: { amount: '1.000' },
    });
    // A method whose account was never set cannot take money (FND-304 / FND-506).
    await owner.query(`update payment_methods set financial_account_id = null where id = $1`, [
      s.card.id,
    ]);
    const homeless = await s.c.client.request('POST', '/pos/sales', {
      cookies: cashier.cookies,
      body: {
        idempotencyKey: newId(),
        lines: [{ variantId: s.tea, quantity: '1' }],
        payments: [{ methodId: s.card.id, amount: '1.000', reference: 'x' }],
        expectedTotal: '1.000',
      },
    });
    expect(homeless.json().code).toBe('SETTLEMENT_ACCOUNT_REQUIRED');
  });
});
