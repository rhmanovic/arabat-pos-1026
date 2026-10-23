import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../database/database.service.js';
import { newId } from '../../kernel/ids.js';
import { ensureDefaultPaymentSetup } from '../payments/merchant-defaults.js';
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

const company = () => createCompany(app, db, mailer);
type Co = Awaited<ReturnType<typeof company>>;
type Cookies = Co['cookies'];

async function registersAt(c: Co, branchId: string) {
  const res = await c.client.request('GET', `/manager/registers?branchId=${branchId}`, {
    cookies: c.cookies,
  });
  return res.json().registers as { id: string; code: string; version: number }[];
}

function pos(c: Co, cookies: Cookies) {
  const call = (method: 'GET' | 'POST', path: string, body?: unknown) =>
    c.client.request(method, path, { cookies, ...(body === undefined ? {} : { body }) });
  return {
    registers: () => call('GET', '/pos/registers'),
    current: () => call('GET', '/pos/shifts/current'),
    open: (registerId: string, countedCash = '50.000', expectedCash = '0.000') =>
      call('POST', '/pos/shifts', { registerId, countedCash, expectedCash }),
    cash: (body: Record<string, unknown>) =>
      call('POST', '/pos/shifts/current/cash-movements', body),
    close: (body: Record<string, unknown>) => call('POST', '/pos/shifts/current/close', body),
  };
}

describe('payment methods', () => {
  it('gives every new merchant its own default methods and a register per branch', async () => {
    const a = await company();
    const b = await company();
    const listA = (
      await a.client.request('GET', '/manager/payment-methods', { cookies: a.cookies })
    ).json();
    // ADR-0089: cash, KNET, Visa/Mastercard, payment link and WAMD, each settling into a
    // default financial account (cash on hand, bank 1, bank 2), without fees.
    expect(listA.methods.map((m: { kind: string; nameEn: string }) => [m.kind, m.nameEn])).toEqual([
      ['cash', 'Cash'],
      ['card', 'Card (KNET)'],
      ['card', 'Visa / Mastercard'],
      ['custom', 'Payment link'],
      ['bank_transfer', 'WAMD'],
    ]);
    const accountsA = (
      await a.client.request('GET', '/manager/financial-accounts', { cookies: a.cookies })
    ).json().accounts as { id: string; kind: string; nameEn: string }[];
    // Cash settles into register drawers (ADR-0090); only banks are listed here.
    expect(accountsA.map((x) => [x.kind, x.nameEn])).toEqual([
      ['bank', 'Bank account 1'],
      ['bank', 'Bank account 2'],
    ]);
    const accountOf = (name: string) => accountsA.find((x) => x.nameEn === name)!.id;
    expect(
      listA.methods.map((m: { financialAccountId: string | null }) => m.financialAccountId),
    ).toEqual([
      null,
      accountOf('Bank account 1'),
      accountOf('Bank account 2'),
      accountOf('Bank account 1'),
      accountOf('Bank account 1'),
    ]);
    expect(listA.methods.every((m: { feeType: string }) => m.feeType === 'none')).toBe(true);
    expect(listA.methods.every((m: { gatewayLive: boolean }) => m.gatewayLive === false)).toBe(
      true,
    );
    // a's change never affects b
    const cash = listA.methods[0];
    await a.client.request('PATCH', `/manager/payment-methods/${cash.id}`, {
      cookies: a.cookies,
      body: { ...cash, feeFixed: cash.feeFixed.amount, nameEn: 'Cash KWD', version: cash.version },
    });
    const listB = (
      await b.client.request('GET', '/manager/payment-methods', { cookies: b.cookies })
    ).json();
    expect(listB.methods[0].nameEn).toBe('Cash');
    expect(
      (
        await b.client.request('PATCH', `/manager/payment-methods/${cash.id}`, {
          cookies: b.cookies,
          body: { kind: 'cash', nameEn: 'x', version: 2 },
        })
      ).statusCode,
    ).toBe(404);
    // New branches get a register too.
    expect(await registersAt(a, a.main)).toHaveLength(1);
    expect(await registersAt(a, a.second)).toHaveLength(1);
  });

  it('stores fees exactly, rejects invalid ones and keeps one cash method', async () => {
    const c = await company();
    const bank = (
      await c.client.request('GET', '/manager/financial-accounts', { cookies: c.cookies })
    ).json().accounts[0].id as string;
    // Every non-cash method needs a settlement account (BR-181).
    const homeless = await c.client.request('POST', '/manager/payment-methods', {
      cookies: c.cookies,
      body: { kind: 'custom', nameEn: 'Nowhere' },
    });
    expect(homeless.statusCode).toBe(400);
    const created = await c.client.request('POST', '/manager/payment-methods', {
      cookies: c.cookies,
      body: {
        kind: 'custom',
        nameEn: 'Talabat Pay',
        feeType: 'fixed_plus_percentage',
        feeFixed: '0.050',
        feePercent: '2.75',
        availableOnline: true,
        financialAccountId: bank,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      feeType: 'fixed_plus_percentage',
      feeFixed: { amount: '0.050', currency: 'KWD' },
      feePercent: '2.75',
      availableOnline: true,
    });
    // Unused fee parts are stored as zero.
    const pct = await c.client.request('POST', '/manager/payment-methods', {
      cookies: c.cookies,
      body: {
        kind: 'card',
        nameEn: 'Visa',
        feeType: 'percentage',
        feeFixed: '1.000',
        feePercent: '1.5',
        financialAccountId: bank,
      },
    });
    expect(pct.json().feeFixed.amount).toBe('0.000');
    for (const bad of [
      { feeType: 'percentage', feePercent: '101' },
      { feeType: 'percentage', feePercent: '1.2345' },
      { feeType: 'fixed', feeFixed: '0.0005' },
      { feeType: 'fixed', feeFixed: '-1' },
    ]) {
      const res = await c.client.request('POST', '/manager/payment-methods', {
        cookies: c.cookies,
        body: { kind: 'custom', nameEn: 'Bad', financialAccountId: bank, ...bad },
      });
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
    // Cash carries no fee (FND-412).
    const cashMethod = (
      await c.client.request('GET', '/manager/payment-methods', { cookies: c.cookies })
    )
      .json()
      .methods.find((m: { kind: string }) => m.kind === 'cash');
    const cashFee = await c.client.request('PATCH', `/manager/payment-methods/${cashMethod.id}`, {
      cookies: c.cookies,
      body: {
        kind: 'cash',
        nameEn: 'Cash',
        feeType: 'fixed',
        feeFixed: '0.100',
        version: cashMethod.version,
      },
    });
    expect(cashFee.statusCode).toBe(400);
    const secondCash = await c.client.request('POST', '/manager/payment-methods', {
      cookies: c.cookies,
      body: { kind: 'cash', nameEn: 'More cash' },
    });
    expect(secondCash.statusCode).toBe(409);
    const gatewayOnCash = await c.client.request('POST', '/manager/payment-methods', {
      cookies: c.cookies,
      body: { kind: 'cash', nameEn: 'Cash', gatewayProvider: 'tap' },
    });
    expect(gatewayOnCash.statusCode).toBe(400);
  });

  it('links a method to an internal balance of the same merchant only', async () => {
    const a = await company();
    const b = await company();
    const account = (
      await a.client.request('POST', '/manager/financial-accounts', {
        cookies: a.cookies,
        body: { nameEn: 'KNET clearing', kind: 'card_clearing' },
      })
    ).json();
    expect(account.balance).toEqual({ amount: '0.000', currency: 'KWD' });
    const ok = await a.client.request('POST', '/manager/payment-methods', {
      cookies: a.cookies,
      body: { kind: 'card', nameEn: 'KNET 2', financialAccountId: account.id },
    });
    expect(ok.json().financialAccountId).toBe(account.id);
    const cross = await b.client.request('POST', '/manager/payment-methods', {
      cookies: b.cookies,
      body: { kind: 'card', nameEn: 'Steal', financialAccountId: account.id },
    });
    expect(cross.statusCode).toBe(404);
    // Balances come only from the append-only entries.
    await owner.query(
      `insert into financial_account_entries (id, merchant_id, account_id, amount_minor, entry_type, source_type, source_id)
       values ($1, $2, $3, 12345, 'payment', 'test', $4), ($5, $2, $3, -345, 'fee', 'test', $4)`,
      [newId(), a.merchantId, account.id, newId(), newId()],
    );
    const accounts = (
      await a.client.request('GET', '/manager/financial-accounts', { cookies: a.cookies })
    ).json().accounts as { id: string; balance: { amount: string } }[];
    expect(accounts.find((x) => x.id === account.id)!.balance.amount).toBe('12.000');
  });

  it('gives an existing merchant the default payment setup once, keeping what it has', async () => {
    const c = await company();
    // Recreate a merchant from before ADR-0089: no internal balances, three unlinked methods.
    await owner.query(
      `update payment_methods set financial_account_id = null where merchant_id = $1`,
      [c.merchantId],
    );
    await owner.query(
      `delete from financial_accounts where merchant_id = $1 and kind not in ('register', 'treasury')`,
      [c.merchantId],
    );
    await owner.query(
      `delete from payment_methods where merchant_id = $1 and kind in ('custom', 'bank_transfer')
         or merchant_id = $1 and name_en = 'Visa / Mastercard'`,
      [c.merchantId],
    );
    await owner.query(
      `update payment_methods set name_en = 'KNET terminal' where merchant_id = $1 and kind = 'card'`,
      [c.merchantId],
    );
    await owner.query(
      `insert into payment_methods (id, merchant_id, kind, name_en) values ($1, $2, 'bank_transfer', 'Bank transfer')`,
      [newId(), c.merchantId],
    );
    const database = app.get(DatabaseService);
    const run = () =>
      database.withMerchantTx(c.merchantId, (tx) => ensureDefaultPaymentSetup(tx, c.merchantId));
    expect(await run()).toEqual({ accounts: 2, added: 3, linked: 2 });
    const list = async () =>
      (await c.client.request('GET', '/manager/payment-methods', { cookies: c.cookies })).json()
        .methods as { nameEn: string; financialAccountId: string | null; version: number }[];
    const methods = await list();
    // The renamed KNET is kept (not re-added); every non-cash method now settles into a bank
    // account, and cash into the register drawers (ADR-0090).
    expect(methods.map((m) => m.nameEn).sort()).toEqual(
      [
        'Bank transfer',
        'Cash',
        'KNET terminal',
        'Payment link',
        'Visa / Mastercard',
        'WAMD',
      ].sort(),
    );
    expect(
      methods.filter((m) => m.nameEn !== 'Cash').every((m) => m.financialAccountId !== null),
    ).toBe(true);
    expect(methods.find((m) => m.nameEn === 'Cash')!.financialAccountId).toBeNull();
    // Once set up, later runs (every deploy) change nothing, even after the owner renames.
    const wamd = methods.find((m) => m.nameEn === 'WAMD')!;
    await owner.query(`update payment_methods set name_en = 'Instant transfer' where id = $1`, [
      (wamd as unknown as { id: string }).id,
    ]);
    expect(await run()).toEqual({ accounts: 0, added: 0, linked: 0 });
    expect(await list()).toHaveLength(6);
  });

  it('requires payments.settings and shows cashiers only active POS methods without fees', async () => {
    const c = await company();
    const bm = await c.hire([{ roleId: c.roles.branch_manager, branchId: c.main }], 'manager');
    expect(
      (await c.client.request('GET', '/manager/payment-methods', { cookies: bm.cookies }))
        .statusCode,
    ).toBe(403);
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const res = await c.client.request('GET', '/pos/payment-methods', { cookies: cashier.cookies });
    expect(res.statusCode).toBe(200);
    expect(res.json().methods.map((m: { kind: string }) => m.kind)).toEqual([
      'cash',
      'card',
      'card',
      'custom',
      'bank_transfer',
    ]);
    // No fee field reaches the till (field names only: a random id may contain "fee").
    for (const method of res.json().methods as Record<string, unknown>[])
      expect(Object.keys(method).filter((key) => /fee/i.test(key))).toEqual([]);
  });
});

describe('registers and shifts', () => {
  it('runs a full shift: open, cash in/out, close with exact reconciliation and audit', async () => {
    const c = await company();
    const [register] = await registersAt(c, c.main);
    await c.countTreasury(c.main, '100.000');
    // Cashiers no longer move cash by default (ADR-0090); supervisors do.
    const cashier = await c.hire([{ roleId: c.roles.supervisor, branchId: c.main }], 'pos');
    const p = pos(c, cashier.cookies);
    expect((await p.current()).json().shift).toBeNull();
    // Cash movements need an open shift.
    expect(
      (await p.cash({ kind: 'cash_in', amount: '1', reason: 'float_top_up' })).json().code,
    ).toBe('SHIFT_REQUIRED');

    const opened = await p.open(register!.id, '50.250');
    expect(opened.statusCode).toBe(201);
    expect(opened.json().summary.expectedCash.amount).toBe('50.250');

    expect(
      (await p.cash({ kind: 'cash_in', amount: '10.005', reason: 'float_top_up' })).statusCode,
    ).toBe(201);
    expect(
      (await p.cash({ kind: 'cash_out', amount: '20.100', reason: 'safe_drop' })).statusCode,
    ).toBe(201);
    // Cannot take out more cash than the drawer holds.
    const tooMuch = await p.cash({ kind: 'cash_out', amount: '40.156', reason: 'safe_drop' });
    expect(tooMuch.json().code).toBe('INSUFFICIENT_CASH');
    // "other" needs a note; wrong reason for the direction is refused.
    expect((await p.cash({ kind: 'cash_out', amount: '1', reason: 'other' })).statusCode).toBe(400);
    expect((await p.cash({ kind: 'cash_in', amount: '1', reason: 'safe_drop' })).statusCode).toBe(
      400,
    );
    expect(
      (await p.cash({ kind: 'cash_in', amount: '0', reason: 'float_top_up' })).statusCode,
    ).toBe(400);

    const current = (await p.current()).json().shift;
    expect(current.summary).toMatchObject({
      openingFloat: { amount: '50.250' },
      cashIn: { amount: '10.005' },
      cashOut: { amount: '20.100' },
      expectedCash: { amount: '40.155' },
    });
    expect(current.movements).toHaveLength(2);

    // Denomination count must add up.
    const wrongCount = await p.close({
      countedCash: '40.000',
      breakdown: [{ value: '20.000', count: 1 }],
      version: current.version,
    });
    expect(wrongCount.json().code).toBe('INVALID_BREAKDOWN');
    const closed = await p.close({
      countedCash: '40.000',
      breakdown: [
        { value: '20.000', count: 1 },
        { value: '10.000', count: 1 },
        { value: '5.000', count: 2 },
      ],
      note: 'Short by coins',
      version: current.version,
    });
    expect(closed.statusCode).toBe(201);
    expect(closed.json()).toMatchObject({
      status: 'closed',
      closeType: 'normal',
      countedCash: { amount: '40.000' },
      discrepancy: { amount: '-0.155' },
      outcome: 'short',
    });
    expect((await p.current()).json().shift).toBeNull();

    // The closed record is permanent, even for the database role of the application.
    const database = app.get(DatabaseService);
    await expect(
      database.withMerchantTx(c.merchantId, (tx) =>
        tx.execute(sql`update shifts set counted_cash_minor = 40155, discrepancy_minor = 0`),
      ),
    ).rejects.toThrow();
    await expect(
      database.withMerchantTx(c.merchantId, (tx) => tx.execute(sql`delete from cash_movements`)),
    ).rejects.toThrow();
    const audit = await owner.query(
      `select action from audit_log where merchant_id = $1 and action like 'shift.%' order by occurred_at, id`,
      [c.merchantId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'shift.opened',
      'shift.cash_in',
      'shift.cash_out',
      'shift.closed',
    ]);

    // Manager sees it in monitoring and in the discrepancy report.
    const list = (
      await c.client.request('GET', `/manager/shifts?branchId=${c.main}&outcome=short`, {
        cookies: c.cookies,
      })
    ).json();
    expect(list.total).toBe(1);
    const report = (
      await c.client.request('GET', '/manager/shifts/discrepancies', { cookies: c.cookies })
    ).json();
    expect(report.totals).toMatchObject({
      shifts: 1,
      short: 1,
      totalShort: { amount: '0.155' },
      net: { amount: '-0.155' },
    });
    expect(report.byEmployee[0].employeeName).toBe('Employee');
  });

  it('enforces one employee per register and one open shift per employee, even under concurrency', async () => {
    const c = await company();
    const [register] = await registersAt(c, c.main);
    const one = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const two = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const results = await Promise.all([
      pos(c, one.cookies).open(register!.id),
      pos(c, two.cookies).open(register!.id),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.statusCode === 409)!.json().code).toBe('REGISTER_BUSY');

    const winner = results[0]!.statusCode === 201 ? one : two;
    const other = await c.client.request('POST', '/manager/registers', {
      cookies: c.cookies,
      body: { branchId: c.main, code: 'R2', nameEn: 'Register 2' },
    });
    expect(other.statusCode).toBe(201);
    const second = await pos(c, winner.cookies).open(other.json().id);
    expect(second.json().code).toBe('SHIFT_ALREADY_OPEN');

    const list = (await pos(c, winner.cookies).registers()).json().registers;
    expect(list.map((r: { availability: string }) => r.availability)).toEqual(['mine', 'free']);
  });

  it('serializes concurrent cash-outs so the drawer never goes below zero', async () => {
    const c = await company();
    const [register] = await registersAt(c, c.main);
    await c.countTreasury(c.main, '0.000');
    const cashier = await c.hire([{ roleId: c.roles.supervisor, branchId: c.main }], 'pos');
    const p = pos(c, cashier.cookies);
    await p.open(register!.id, '10.000');
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        p.cash({ kind: 'cash_out', amount: '3.000', reason: 'safe_drop' }),
      ),
    );
    expect(attempts.filter((r) => r.statusCode === 201)).toHaveLength(3);
    expect((await p.current()).json().shift.summary.expectedCash.amount).toBe('1.000');
    // Idempotent retry records once.
    const key = newId();
    await Promise.all([
      p.cash({ kind: 'cash_in', amount: '2.000', reason: 'float_top_up', idempotencyKey: key }),
      p.cash({ kind: 'cash_in', amount: '2.000', reason: 'float_top_up', idempotencyKey: key }),
    ]);
    expect((await p.current()).json().shift.summary.expectedCash.amount).toBe('3.000');
  });

  it('limits restricted registers to their members and registers to their branch', async () => {
    const c = await company();
    const allowed = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const denied = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const atSecond = await c.hire([{ roleId: c.roles.cashier, branchId: c.second }], 'pos');
    const employees = (
      await c.client.request('GET', '/manager/employees', { cookies: c.cookies })
    ).json().employees as { membershipId: string; email: string }[];
    const allowedId = employees.find((e) => e.email === allowed.email)!.membershipId;
    const restricted = await c.client.request('POST', '/manager/registers', {
      cookies: c.cookies,
      body: {
        branchId: c.main,
        code: 'VIP',
        nameEn: 'VIP till',
        accessMode: 'restricted',
        memberIds: [allowedId],
      },
    });
    expect(restricted.statusCode).toBe(201);
    const id = restricted.json().id as string;

    const deniedRes = await pos(c, denied.cookies).open(id);
    expect(deniedRes.json().code).toBe('REGISTER_ACCESS_DENIED');
    expect(
      (await pos(c, denied.cookies).registers()).json().registers.map((r: { id: string }) => r.id),
    ).not.toContain(id);
    // A cashier of another branch cannot even see it.
    expect((await pos(c, atSecond.cookies).open(id)).statusCode).toBe(404);
    expect((await pos(c, allowed.cookies).open(id)).statusCode).toBe(201);

    // Inactive registers cannot be used; one with an open shift cannot be deactivated.
    const busy = await c.client.request('POST', `/manager/registers/${id}/status`, {
      cookies: c.cookies,
      body: { status: 'inactive' },
    });
    expect(busy.json().code).toBe('REGISTER_BUSY');
  });

  it('lets only managers with registers.manage force-close, with a note, and keeps branch scoping', async () => {
    const c = await company();
    const [register] = await registersAt(c, c.main);
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const shift = (await pos(c, cashier.cookies).open(register!.id, '5.000')).json();

    const bmSecond = await c.hire(
      [{ roleId: c.roles.branch_manager, branchId: c.second }],
      'manager',
    );
    expect(
      (await c.client.request('GET', `/manager/shifts/${shift.id}`, { cookies: bmSecond.cookies }))
        .statusCode,
    ).toBe(403);
    const mainList = await c.client.request('GET', `/manager/shifts?branchId=${c.main}`, {
      cookies: bmSecond.cookies,
    });
    expect(mainList.statusCode).toBe(403);
    const visible = (
      await c.client.request('GET', '/manager/shifts', { cookies: bmSecond.cookies })
    ).json();
    expect(visible.total).toBe(0);

    const noNote = await c.client.request('POST', `/manager/shifts/${shift.id}/force-close`, {
      cookies: c.cookies,
      body: { countedCash: '5.000', version: shift.version },
    });
    expect(noNote.statusCode).toBe(400);
    const forced = await c.client.request('POST', `/manager/shifts/${shift.id}/force-close`, {
      cookies: c.cookies,
      body: { countedCash: '5.000', note: 'Cashier went home', version: shift.version },
    });
    expect(forced.json()).toMatchObject({
      closeType: 'forced',
      outcome: 'balanced',
      closedByName: expect.any(String),
    });
    // Closing twice is refused.
    const again = await c.client.request('POST', `/manager/shifts/${shift.id}/force-close`, {
      cookies: c.cookies,
      body: { countedCash: '5.000', note: 'again', version: forced.json().version },
    });
    expect(again.json().code).toBe('SHIFT_CLOSED');

    // Cashiers have no management access.
    expect(
      (
        await c.client.request('GET', '/manager/shifts', {
          cookies: { mgr_sid: cashier.cookies.pos_sid! },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('applies the register tolerance captured at closing time', async () => {
    const c = await company();
    const [register] = await registersAt(c, c.main);
    const full = (
      await c.client.request('GET', `/manager/registers?branchId=${c.main}`, { cookies: c.cookies })
    ).json().registers[0];
    await c.client.request('PATCH', `/manager/registers/${register!.id}`, {
      cookies: c.cookies,
      body: {
        branchId: c.main,
        code: full.code,
        nameEn: full.nameEn,
        nameAr: full.nameAr,
        discrepancyTolerance: '0.250',
        version: full.version,
      },
    });
    const ownerPos = await c.ownerPos(c.main);
    const p = pos(c, ownerPos);
    const shift = (await p.open(register!.id, '1.000')).json();
    const closed = (await p.close({ countedCash: '1.200', version: shift.version })).json();
    expect(closed).toMatchObject({ discrepancy: { amount: '0.200' }, outcome: 'balanced' });
  });
});

describe('blind cash counts (BR-162)', () => {
  async function settings(c: Co, blindCashCount: boolean) {
    const current = (
      await c.client.request('GET', '/manager/sales-settings', { cookies: c.cookies })
    ).json();
    const res = await c.client.request('PUT', '/manager/sales-settings', {
      cookies: c.cookies,
      body: {
        maxDiscountPercent: current.maxDiscountPercent,
        refundWindowDays: current.refundWindowDays,
        refundApprovalLimit: current.refundApprovalLimit.amount,
        blindCashCount,
        cashOutOtherLimit: current.cashOutOtherLimit.amount,
        cashOutOtherShiftLimit: current.cashOutOtherShiftLimit.amount,
        maxRegisterTolerance: current.maxRegisterTolerance.amount,
        expenseApprovalLimit: current.expenseApprovalLimit.amount,
        supplierPaymentApprovalLimit: current.supplierPaymentApprovalLimit.amount,
        version: current.version,
      },
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it('hides drawer figures from cashiers until they count, not from supervisors, and can be switched off', async () => {
    const c = await company();
    const [register] = await registersAt(c, c.main);
    expect((await settings(c, true)).blindCashCount).toBe(true);
    const cashierCookies = async () =>
      (await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos')).cookies;
    const open = (cookies: Cookies, body: Record<string, unknown>) =>
      c.client.request('POST', '/pos/shifts', {
        cookies,
        body: { registerId: register!.id, ...body },
      });

    // The cashier is shown no balance and needs no "expected" figure to open.
    const oneCookies = await cashierCookies();
    const one = pos(c, oneCookies);
    expect((await one.registers()).json().registers[0]).toMatchObject({
      expectedCash: null,
      blindCount: true,
      needsCount: true,
    });
    const opened = await open(oneCookies, { countedCash: '20.000' });
    expect(opened.statusCode).toBe(201);
    expect(opened.json()).toMatchObject({
      summary: null,
      blindCount: true,
      openingDiscrepancy: null,
    });
    expect((await one.current()).json().shift.summary).toBeNull();

    // A supervisor monitors shifts (shifts.view_all): the figures stay visible to them.
    const sup = pos(
      c,
      (await c.hire([{ roleId: c.roles.supervisor, branchId: c.main }], 'pos')).cookies,
    );
    expect((await sup.registers()).json().registers[0]).toMatchObject({
      expectedCash: { amount: '20.000' },
      blindCount: false,
      availability: 'occupied',
    });

    // Closing reveals expected, counted and the difference — after the count.
    const closed = await one.close({ countedCash: '19.500', version: opened.json().version });
    expect(closed.statusCode).toBe(201);
    expect(closed.json()).toMatchObject({
      summary: { expectedCash: { amount: '20.000' } },
      countedCash: { amount: '19.500' },
      discrepancy: { amount: '-0.500' },
      outcome: 'short',
    });

    // The next cashier cannot know there is a difference: it is booked between shifts
    // without a note and revealed to them once recorded.
    const twoCookies = await cashierCookies();
    const two = pos(c, twoCookies);
    const second = await open(twoCookies, { countedCash: '19.000' });
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({
      summary: null,
      blindCount: true,
      openingDiscrepancy: { amount: '-0.500' },
    });
    // The manager's view of the same shift carries the full figures.
    const managed = (
      await c.client.request('GET', `/manager/shifts/${second.json().id}`, {
        cookies: c.cookies,
      })
    ).json();
    expect(managed.summary).toMatchObject({
      openingExpected: { amount: '19.500' },
      openingDiscrepancy: { amount: '-0.500' },
      expectedCash: { amount: '19.000' },
    });

    // The owner switches the policy off: cashiers see the figures and must count against them.
    await settings(c, false);
    expect((await two.current()).json().shift).toMatchObject({
      blindCount: false,
      summary: { expectedCash: { amount: '19.000' } },
    });
    expect(
      (await two.close({ countedCash: '19.000', version: second.json().version })).json().outcome,
    ).toBe('balanced');
    const threeCookies = await cashierCookies();
    const three = pos(c, threeCookies);
    expect((await three.registers()).json().registers[0]).toMatchObject({
      expectedCash: { amount: '19.000' },
      blindCount: false,
    });
    expect((await open(threeCookies, { countedCash: '18.000' })).statusCode).toBe(400);
    expect(
      (await open(threeCookies, { countedCash: '18.000', expectedCash: '17.000' })).json().code,
    ).toBe('EXPECTED_CHANGED');
    expect(
      (await open(threeCookies, { countedCash: '18.000', expectedCash: '19.000' })).statusCode,
    ).toBe(400);
    expect(
      (
        await open(threeCookies, {
          countedCash: '18.000',
          expectedCash: '19.000',
          note: 'one dinar short at opening',
        })
      ).statusCode,
    ).toBe(201);
  });
});

describe('cash-out controls (BR-164)', () => {
  async function policy(c: Co, patch: Record<string, unknown>) {
    const current = (
      await c.client.request('GET', '/manager/sales-settings', { cookies: c.cookies })
    ).json();
    const res = await c.client.request('PUT', '/manager/sales-settings', {
      cookies: c.cookies,
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
    expect(res.statusCode).toBe(200);
    return res.json();
  }
  const audit = async (c: Co, action: string) =>
    (
      await c.client.request('GET', `/manager/audit?action=${action}`, { cookies: c.cookies })
    ).json().entries as { action: string; details: Record<string, unknown> }[];

  it('corrections reverse only a posted "other" movement of the shift, up to what is left', async () => {
    const c = await company();
    const [register] = await registersAt(c, c.main);
    const sup = pos(
      c,
      (await c.hire([{ roleId: c.roles.supervisor, branchId: c.main }], 'pos')).cookies,
    );
    await sup.open(register!.id, '50.000');
    const other = await sup.cash({
      kind: 'cash_in',
      amount: '4.000',
      reason: 'other',
      note: 'found',
    });
    expect(other.statusCode).toBe(201);
    const otherId = other.json().movements.at(-1).id as string;
    const drop = await sup.cash({ kind: 'cash_out', amount: '10.000', reason: 'safe_drop' });
    const dropId = drop.json().movements.at(-1).id as string;
    // A correction names the movement, goes the opposite way, and explains itself.
    expect(
      (await sup.cash({ kind: 'cash_out', amount: '1', reason: 'correction' })).statusCode,
    ).toBe(400);
    expect(
      (
        await sup.cash({
          kind: 'cash_in',
          amount: '1.000',
          reason: 'correction',
          correctsMovementId: otherId,
          note: 'same way',
        })
      ).statusCode,
    ).toBe(400);
    // Drops are reversed by a top-up, not by a correction.
    expect(
      (
        await sup.cash({
          kind: 'cash_in',
          amount: '1.000',
          reason: 'correction',
          correctsMovementId: dropId,
          note: 'oops',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await sup.cash({
          kind: 'cash_out',
          amount: '4.500',
          reason: 'correction',
          correctsMovementId: otherId,
          note: 'too much',
        })
      ).statusCode,
    ).toBe(400);
    const first = await sup.cash({
      kind: 'cash_out',
      amount: '3.000',
      reason: 'correction',
      correctsMovementId: otherId,
      note: 'typed 4 instead of 1',
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().movements.at(-1)).toMatchObject({
      reason: 'correction',
      status: 'posted',
      correctsMovementId: otherId,
    });
    // Only 1.000 is left to correct.
    expect(
      (
        await sup.cash({
          kind: 'cash_out',
          amount: '1.001',
          reason: 'correction',
          correctsMovementId: otherId,
          note: 'again',
        })
      ).statusCode,
    ).toBe(400);
    expect((await sup.current()).json().shift.summary.expectedCash.amount).toBe('41.000');
  });

  it('holds "other" cash-outs above the company limit for a manager, except for the owner', async () => {
    const c = await company();
    const [register] = await registersAt(c, c.main);
    await policy(c, { cashOutOtherLimit: '5.000', cashOutOtherShiftLimit: '8.000' });
    const supCookies = (await c.hire([{ roleId: c.roles.supervisor, branchId: c.main }], 'pos'))
      .cookies;
    const sup = pos(c, supCookies);
    const opened = await sup.open(register!.id, '100.000');
    // Within the limit: posted at once.
    expect(
      (await sup.cash({ kind: 'cash_out', amount: '4.000', reason: 'other', note: 'taxi' }))
        .json()
        .movements.at(-1).status,
    ).toBe('posted');
    // Above the per-movement limit: pending, drawer figure unchanged.
    const big = await sup.cash({
      kind: 'cash_out',
      amount: '6.000',
      reason: 'other',
      note: 'repair',
    });
    expect(big.statusCode).toBe(201);
    const pending = big.json().movements.at(-1);
    expect(pending).toMatchObject({ status: 'pending', limitExceeded: true, ownerOverride: false });
    expect(big.json().summary.expectedCash.amount).toBe('96.000');
    // The per-shift total counts posted and pending: 4 + 6 + 3 > 8 → pending too.
    const third = await sup.cash({
      kind: 'cash_out',
      amount: '3.000',
      reason: 'other',
      note: 'more',
    });
    expect(third.json().movements.at(-1).status).toBe('pending');
    expect(await audit(c, 'cash_out_requested')).toHaveLength(2);
    // The cashier cannot close while a request is open, but may withdraw it.
    expect(
      (await sup.close({ countedCash: '96.000', version: opened.json().version })).json().code,
    ).toBe('PENDING_MOVEMENTS');
    const withdrawn = await c.client.request(
      'POST',
      `/pos/shifts/current/cash-movements/${third.json().movements.at(-1).id}/withdraw`,
      { cookies: supCookies, body: {} },
    );
    expect(withdrawn.statusCode).toBe(201);
    expect(withdrawn.json().movements.at(-1).status).toBe('withdrawn');
    // Nobody approves their own request; a company manager does, and the cash leaves then.
    const shiftId = opened.json().id as string;
    const decide = (cookies: Cookies, body: Record<string, unknown>) =>
      c.client.request('POST', `/manager/shifts/${shiftId}/movements/${pending.id}/decision`, {
        cookies,
        body,
      });
    const supManager = (
      await c.hire([{ roleId: c.roles.branch_manager, branchId: c.main }], 'manager')
    ).cookies;
    expect((await decide(supCookies, { decision: 'approve' })).statusCode).toBe(401);
    expect((await decide(supManager, { decision: 'reject' })).statusCode).toBe(400);
    const approved = await decide(supManager, { decision: 'approve', note: 'repair confirmed' });
    expect(approved.statusCode).toBe(201);
    const row = approved.json().movements.find((m: { id: string }) => m.id === pending.id);
    expect(row).toMatchObject({ status: 'posted', decisionNote: 'repair confirmed' });
    expect(typeof row.decidedBy).toBe('string');
    expect(approved.json().summary.expectedCash.amount).toBe('90.000');
    expect((await decide(supManager, { decision: 'approve' })).json().code).toBe(
      'MOVEMENT_DECIDED',
    );
    expect((await audit(c, 'cash_out_approved'))[0]!.details).toMatchObject({
      movementId: pending.id,
    });

    // The owner posts directly: the exception is flagged on the movement and in the audit log.
    const ownerPos = pos(c, await c.ownerPos(c.main));
    const [, second] = await registersAt(c, c.main).then(async (rs) =>
      rs.length > 1
        ? rs
        : [
            rs[0],
            (
              await c.client.request('POST', '/manager/registers', {
                cookies: c.cookies,
                body: { branchId: c.main, code: 'R2', nameEn: 'R2' },
              })
            ).json(),
          ],
    );
    await ownerPos.open(second!.id, '50.000');
    const own = await ownerPos.cash({
      kind: 'cash_out',
      amount: '20.000',
      reason: 'other',
      note: 'owner',
    });
    expect(own.json().movements.at(-1)).toMatchObject({
      status: 'posted',
      limitExceeded: true,
      ownerOverride: true,
    });
    expect((await audit(c, 'shift.cash_out'))[0]!.details).toMatchObject({
      limitExceeded: true,
      ownerOverride: true,
    });

    // A forced close rejects what is still pending.
    const again = await sup.cash({
      kind: 'cash_out',
      amount: '7.000',
      reason: 'other',
      note: 'late',
    });
    expect(again.json().movements.at(-1).status).toBe('pending');
    const forced = await c.client.request('POST', `/manager/shifts/${shiftId}/force-close`, {
      cookies: c.cookies,
      body: { note: 'went home', version: again.json().version },
    });
    expect(forced.statusCode).toBe(201);
    expect(
      forced.json().movements.filter((m: { status: string }) => m.status === 'rejected'),
    ).toHaveLength(1);
  });

  it('caps register tolerance by the company maximum and asks for a note on a visible difference', async () => {
    const c = await company();
    const [register] = await registersAt(c, c.main);
    await policy(c, { maxRegisterTolerance: '0.500' });
    const save = (discrepancyTolerance: string) =>
      c.client.request('PATCH', `/manager/registers/${register!.id}`, {
        cookies: c.cookies,
        body: {
          branchId: c.main,
          code: register!.code,
          nameEn: 'Register 1',
          discrepancyTolerance,
          version: register!.version,
        },
      });
    expect((await save('0.750')).statusCode).toBe(400);
    expect((await save('0.500')).statusCode).toBe(200);
    // A supervisor sees the expected figure, so a difference beyond the tolerance needs a note.
    const sup = pos(
      c,
      (await c.hire([{ roleId: c.roles.supervisor, branchId: c.main }], 'pos')).cookies,
    );
    const opened = await sup.open(register!.id, '30.000');
    expect(
      (await sup.close({ countedCash: '29.000', version: opened.json().version })).statusCode,
    ).toBe(400);
    expect(
      (await sup.close({ countedCash: '29.600', version: opened.json().version })).json().outcome,
    ).toBe('balanced');
  });
});

describe('disbursement approvals at the till (BR-166)', () => {
  it('holds an expense above the limit with its details until a manager approves it', async () => {
    const c = await company();
    const [register] = await registersAt(c, c.main);
    const sup = pos(
      c,
      (await c.hire([{ roleId: c.roles.supervisor, branchId: c.main }], 'pos')).cookies,
    );
    const opened = await sup.open(register!.id, '100.000');
    // Above 20.000 the receipt reference is required and the payment waits.
    expect(
      (
        await sup.cash({
          kind: 'cash_out',
          amount: '25.000',
          reason: 'petty_expense',
          category: 'supplies',
        })
      ).statusCode,
    ).toBe(400);
    const held = await sup.cash({
      kind: 'cash_out',
      amount: '25.000',
      reason: 'petty_expense',
      category: 'supplies',
      receiptReference: 'R-77',
      note: 'shelves',
    });
    expect(held.statusCode).toBe(201);
    const m = held.json().movements.at(-1);
    expect(m).toMatchObject({ status: 'pending', limitExceeded: true });
    expect(held.json().summary.expectedCash.amount).toBe('100.000');
    // Approval posts the expense with the category and reference that were kept.
    const approved = await c.client.request(
      'POST',
      `/manager/shifts/${opened.json().id}/movements/${m.id}/decision`,
      { cookies: c.cookies, body: { decision: 'approve', note: 'ok' } },
    );
    expect(approved.statusCode).toBe(201);
    expect(approved.json().summary.expectedCash.amount).toBe('75.000');
    const list = (
      await c.client.request('GET', `/manager/cash/disbursements?branchId=${c.main}`, {
        cookies: c.cookies,
      })
    ).json();
    expect(list.disbursements[0]).toMatchObject({
      kind: 'expense',
      category: 'supplies',
      receiptReference: 'R-77',
      amount: { amount: '25.000' },
      source: { kind: 'register' },
    });
  });
});
