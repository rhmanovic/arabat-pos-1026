import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../kernel/ids.js';
import { DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

/** Cash custody phase C: cash by type, expenses report, discrepancy sections (ADR-0090/0091). */
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

const days = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const period = `from=${days(-1)}&to=${days(1)}`;

describe('cash reports', () => {
  it('splits cash by type, reports expenses, and attributes every kind of difference', async () => {
    const c = await createCompany(app, db, mailer);
    const call = (method: 'GET' | 'POST', path: string, body?: unknown, cookies = c.cookies) =>
      c.client.request(method, path, { cookies, ...(body === undefined ? {} : { body }) });
    const product = (
      await call('POST', '/manager/products', {
        nameEn: 'Tea',
        variants: [{ sku: `T-${newId().slice(-6)}`, price: '1.000', cost: '0.400', barcodes: [] }],
      })
    ).json();
    await call('POST', '/manager/inventory/adjustments', {
      branchId: c.main,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId: product.variants[0].id, quantity: '100' }],
    });
    const methods = (await call('GET', '/manager/payment-methods')).json().methods as {
      id: string;
      kind: string;
    }[];
    const register = (await call('GET', `/manager/registers?branchId=${c.main}`)).json()
      .registers[0].id as string;
    const supplier = (await call('POST', '/manager/suppliers', { nameEn: 'Dairy Co' })).json()
      .id as string;
    const bank = (await call('GET', '/manager/cash/bank-accounts')).json().accounts[0].id as string;
    await c.countTreasury(c.main, '100.000');

    // Shift 1: sale, drop, top-up, expense, supplier payment, correction; closes 0.250 short.
    const a = await c.hire([{ roleId: c.roles.supervisor, branchId: c.main }], 'pos');
    expect(
      (
        await call(
          'POST',
          '/pos/shifts',
          { registerId: register, countedCash: '20.000', expectedCash: '0.000' },
          a.cookies,
        )
      ).statusCode,
    ).toBe(201);
    const move = (body: Record<string, unknown>) =>
      call('POST', '/pos/shifts/current/cash-movements', body, a.cookies);
    expect(
      (
        await call(
          'POST',
          '/pos/sales',
          {
            idempotencyKey: newId(),
            lines: [{ variantId: product.variants[0].id, quantity: '2' }],
            payments: [{ methodId: methods.find((m) => m.kind === 'cash')!.id, amount: '2.000' }],
            expectedTotal: '2.000',
          },
          a.cookies,
        )
      ).statusCode,
    ).toBe(201);
    for (const body of [
      { kind: 'cash_out', reason: 'safe_drop', amount: '5.000' },
      { kind: 'cash_in', reason: 'float_top_up', amount: '3.000' },
      { kind: 'cash_out', reason: 'petty_expense', amount: '1.000', category: 'cleaning' },
      { kind: 'cash_out', reason: 'supplier_payment', amount: '2.000', supplierId: supplier },
      { kind: 'cash_out', reason: 'correction', amount: '0.500', note: 'miscount' },
      { kind: 'cash_in', reason: 'change_received', amount: '7.000' },
    ])
      expect((await move(body)).statusCode).toBe(201);
    // Drawer: 20 + 2 − 5 + 3 − 1 − 2 − 0.5 = 16.500; counted 16.250.
    const shift1 = (await call('GET', '/pos/shifts/current', undefined, a.cookies)).json().shift;
    expect(
      (
        await call(
          'POST',
          '/pos/shifts/current/close',
          { countedCash: '16.250', version: shift1.version, note: 'short' },
          a.cookies,
        )
      ).statusCode,
    ).toBe(201);

    // Treasury: an expense reversed, a deposit, cash sent to and received at the other branch.
    const utilities = (
      await call('POST', '/manager/cash/disbursements', {
        branchId: c.main,
        kind: 'expense',
        category: 'utilities',
        amount: '4.000',
        idempotencyKey: newId(),
      })
    ).json();
    await call('POST', `/manager/cash/disbursements/${utilities.id}/reverse`, {
      reason: 'wrong branch',
      idempotencyKey: newId(),
    });
    const treasury = (await call('GET', '/manager/cash/overview'))
      .json()
      .branches.find((b: { branchId: string }) => b.branchId === c.main).treasury
      .accountId as string;
    await call('POST', '/manager/cash/deposits', {
      fromAccountId: treasury,
      bankAccountId: bank,
      amount: '10.000',
      idempotencyKey: newId(),
    });
    const sent = (
      await call('POST', '/manager/cash/branch-transfers', {
        fromBranchId: c.main,
        toBranchId: c.second,
        amount: '6.000',
        idempotencyKey: newId(),
      })
    ).json();
    await call('POST', `/manager/cash/branch-transfers/${sent.id}/receive`, {
      receivedAmount: '6.000',
      version: sent.version,
    });

    // Shift 2 opens 1.000 over (between shifts), then is force-closed without a count; the
    // manager's count later finds 2.000 missing, which belongs to shift 2.
    const b = await c.hire([{ roleId: c.roles.supervisor, branchId: c.main }], 'pos');
    expect(
      (
        await call(
          'POST',
          '/pos/shifts',
          {
            registerId: register,
            countedCash: '17.250',
            expectedCash: '16.250',
            note: 'found a dinar',
          },
          b.cookies,
        )
      ).statusCode,
    ).toBe(201);
    const shift2 = (await call('GET', '/pos/shifts/current', undefined, b.cookies)).json().shift;
    await call('POST', `/manager/shifts/${shift2.id}/force-close`, {
      note: 'went home',
      version: shift2.version,
    });
    const drawer = (await call('GET', '/manager/cash/overview'))
      .json()
      .branches.find((x: { branchId: string }) => x.branchId === c.main).registers[0];
    expect(drawer.balance.amount).toBe('17.250');
    expect(
      (
        await call('POST', `/manager/cash/accounts/${drawer.accountId}/counts`, {
          countedCash: '15.250',
          expectedCash: '17.250',
          note: 'two dinars missing',
        })
      ).statusCode,
    ).toBe(201);

    // Payments report: cash by type.
    const payments = (await call('GET', `/manager/reports/payments?${period}`)).json();
    expect(payments.custody).toEqual({
      cashSales: { amount: '2.000', currency: 'KWD' },
      cashRefunds: { amount: '0.000', currency: 'KWD' },
      drops: { amount: '5.000', currency: 'KWD' },
      topUps: { amount: '3.000', currency: 'KWD' },
      deposits: { amount: '10.000', currency: 'KWD' },
      expenses: { amount: '1.000', currency: 'KWD' },
      supplierPayments: { amount: '2.000', currency: 'KWD' },
      corrections: { amount: '-0.500', currency: 'KWD' },
      // −0.250 at close, +1.000 between shifts, −2.000 at the manager's count.
      countDifferences: { amount: '-1.250', currency: 'KWD' },
      // Treasury 100 and the drawer's first count 20.
      openingCounts: { amount: '120.000', currency: 'KWD' },
      branchTransfers: { amount: '0.000', currency: 'KWD' },
    });
    // Per branch: the main branch sent 6.
    const mainOnly = (
      await call('GET', `/manager/reports/payments?${period}&branchId=${c.main}`)
    ).json();
    expect(mainOnly.custody.branchTransfers.amount).toBe('-6.000');

    // Expenses report: reversals netted, by category, supplier and source.
    const expenses = (await call('GET', `/manager/reports/expenses?${period}`)).json();
    expect(expenses.totals).toMatchObject({
      expenses: { amount: '1.000' },
      supplierPayments: { amount: '2.000' },
      total: { amount: '3.000' },
    });
    expect(expenses.byCategory).toEqual(
      expect.arrayContaining([
        { category: 'cleaning', count: 1, net: { amount: '1.000', currency: 'KWD' } },
        { category: 'utilities', count: 0, net: { amount: '0.000', currency: 'KWD' } },
      ]),
    );
    expect(expenses.bySupplier).toEqual([
      expect.objectContaining({
        supplierId: supplier,
        count: 1,
        net: expect.objectContaining({ amount: '2.000' }),
      }),
    ]);
    expect(expenses.bySource).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'register',
          net: expect.objectContaining({ amount: '3.000' }),
        }),
        expect.objectContaining({
          source: 'treasury',
          net: expect.objectContaining({ amount: '0.000' }),
        }),
      ]),
    );
    // By merchant-local day (the UTC date may differ): one day holds the 1.000.
    expect(
      expenses.byDay
        .map((d: { expenses: { amount: string } }) => d.expenses.amount)
        .filter((a: string) => a !== '0.000'),
    ).toEqual(['1.000']);

    // Discrepancies: by close type, between shifts, and found after an uncounted close.
    const report = (await call('GET', '/manager/shifts/discrepancies')).json();
    expect(report.totals).toMatchObject({ shifts: 2, uncounted: 1, short: 1, balanced: 0 });
    expect(report.byCloseType).toEqual(
      expect.arrayContaining([
        { closeType: 'normal', shifts: 1, net: { amount: '-0.250', currency: 'KWD' } },
        { closeType: 'forced_uncounted', shifts: 1, net: { amount: '0.000', currency: 'KWD' } },
      ]),
    );
    expect(report.betweenShifts).toEqual([
      expect.objectContaining({
        registerId: register,
        openings: 1,
        net: { amount: '1.000', currency: 'KWD' },
      }),
    ]);
    expect(report.afterUncounted).toEqual([
      expect.objectContaining({
        shiftId: shift2.id,
        difference: { amount: '-2.000', currency: 'KWD' },
      }),
    ]);

    // Shifts report: the uncounted close is neither balanced nor a difference.
    const shifts = (await call('GET', `/manager/reports/shifts?${period}`)).json();
    expect(shifts.shifts.map((s: { outcome: string }) => s.outcome).sort()).toEqual([
      'short',
      'uncounted',
    ]);
    expect(shifts.totals).toMatchObject({ shiftCount: 2, balanced: 0, short: 1 });
  });
});
