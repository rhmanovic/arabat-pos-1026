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
    open: (registerId: string, openingFloat = '50.000') =>
      call('POST', '/pos/shifts', { registerId, openingFloat }),
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
    expect(accountsA.map((x) => [x.kind, x.nameEn])).toEqual([
      ['cash', 'Cash on hand'],
      ['bank', 'Bank account 1'],
      ['bank', 'Bank account 2'],
    ]);
    const accountOf = (name: string) => accountsA.find((x) => x.nameEn === name)!.id;
    expect(
      listA.methods.map((m: { financialAccountId: string | null }) => m.financialAccountId),
    ).toEqual([
      accountOf('Cash on hand'),
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
    const created = await c.client.request('POST', '/manager/payment-methods', {
      cookies: c.cookies,
      body: {
        kind: 'custom',
        nameEn: 'Talabat Pay',
        feeType: 'fixed_plus_percentage',
        feeFixed: '0.050',
        feePercent: '2.75',
        availableOnline: true,
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
        body: { kind: 'custom', nameEn: 'Bad', ...bad },
      });
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
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
    await owner.query(`delete from financial_accounts where merchant_id = $1`, [c.merchantId]);
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
    expect(await run()).toEqual({ accounts: 3, added: 3, linked: 3 });
    const list = async () =>
      (await c.client.request('GET', '/manager/payment-methods', { cookies: c.cookies })).json()
        .methods as { nameEn: string; financialAccountId: string | null; version: number }[];
    const methods = await list();
    // The renamed KNET is kept (not re-added); every method now settles into a balance.
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
    expect(methods.every((m) => m.financialAccountId !== null)).toBe(true);
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
    expect(res.body).not.toContain('fee');
  });
});

describe('registers and shifts', () => {
  it('runs a full shift: open, cash in/out, close with exact reconciliation and audit', async () => {
    const c = await company();
    const [register] = await registersAt(c, c.main);
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
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
    const tooMuch = await p.cash({ kind: 'cash_out', amount: '40.156', reason: 'bank_deposit' });
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
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
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
