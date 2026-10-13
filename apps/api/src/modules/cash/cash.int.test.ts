import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../kernel/ids.js';
import { DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

/** Cash custody (ADR-0090): drawers, branch treasuries, counts and transfers. */
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

/** A company with a product in stock and its payment methods and main register. */
async function store() {
  const c = await createCompany(app, db, mailer);
  // These tests read drawer figures through cashier sessions: counts are not blind here.
  await c.showExpectedCash();
  const product = (
    await c.client.request('POST', '/manager/products', {
      cookies: c.cookies,
      body: {
        nameEn: 'Tea',
        variants: [{ sku: `T-${newId().slice(-6)}`, price: '1.000', cost: '0.400', barcodes: [] }],
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
      lines: [{ variantId, quantity: '100' }],
    },
  });
  const methods = (
    await c.client.request('GET', '/manager/payment-methods', { cookies: c.cookies })
  ).json().methods as { id: string; kind: string }[];
  const register = (
    await c.client.request('GET', `/manager/registers?branchId=${c.main}`, { cookies: c.cookies })
  ).json().registers[0].id as string;
  return {
    c,
    variantId,
    cash: methods.find((m) => m.kind === 'cash')!.id,
    card: methods.find((m) => m.kind === 'card')!.id,
    register,
  };
}
type Store = Awaited<ReturnType<typeof store>>;

function pos(s: Store, cookies: Cookies) {
  const call = (method: 'GET' | 'POST', path: string, body?: unknown) =>
    s.c.client.request(method, path, { cookies, ...(body === undefined ? {} : { body }) });
  return {
    registers: async () =>
      (await call('GET', '/pos/registers')).json().registers as {
        id: string;
        expectedCash: { amount: string };
        needsCount: boolean;
      }[],
    open: (countedCash: string, expectedCash: string, note?: string, registerId = s.register) =>
      call('POST', '/pos/shifts', { registerId, countedCash, expectedCash, note }),
    current: async () => (await call('GET', '/pos/shifts/current')).json().shift,
    cash: (body: Record<string, unknown>) =>
      call('POST', '/pos/shifts/current/cash-movements', body),
    close: (countedCash: string, version: number, note?: string) =>
      call('POST', '/pos/shifts/current/close', { countedCash, version, note }),
    sell: (methodId: string, quantity: string, amount: string) =>
      call('POST', '/pos/sales', {
        idempotencyKey: newId(),
        lines: [{ variantId: s.variantId, quantity }],
        payments: [{ methodId, amount, reference: methodId === s.cash ? null : 'T-1' }],
        expectedTotal: amount,
      }),
  };
}

async function staff(s: Store, role: keyof Co['roles'] = 'supervisor') {
  return (await s.c.hire([{ roleId: s.c.roles[role], branchId: s.c.main }], 'pos')).cookies;
}

async function overview(s: Store, cookies: Cookies = s.c.cookies) {
  return (await s.c.client.request('GET', '/manager/cash/overview', { cookies })).json();
}

async function mainBranch(s: Store) {
  const o = await overview(s);
  return o.branches.find((b: { branchId: string }) => b.branchId === s.c.main) as {
    treasury: { accountId: string; balance: { amount: string }; countedAt: string | null };
    registers: { accountId: string; registerId: string; balance: { amount: string } }[];
    total: { amount: string };
  };
}

function transfer(s: Store, body: Record<string, unknown>, cookies: Cookies = s.c.cookies) {
  return s.c.client.request('POST', '/manager/cash/transfers', {
    cookies,
    body: { idempotencyKey: newId(), ...body },
  });
}

async function entriesOf(accountId: string) {
  return (
    await owner.query(
      `select amount_minor::text as amount, entry_type, source_type, shift_id
         from financial_account_entries where account_id = $1 order by created_at, id`,
      [accountId],
    )
  ).rows as { amount: string; entry_type: string; source_type: string; shift_id: string | null }[];
}

describe('drawer balance across shifts', () => {
  it('opens by counting, keeps the cash in the drawer at close, and attributes differences', async () => {
    const s = await store();
    const one = pos(s, await staff(s, 'cashier'));
    // A new register has no verified count: the first opening sets its balance.
    const [reg] = await one.registers();
    expect(reg).toMatchObject({ expectedCash: { amount: '0.000' }, needsCount: true });
    const opened = await one.open('20.000', '0.000');
    expect(opened.statusCode).toBe(201);
    expect(opened.json().summary).toMatchObject({
      openingFloat: { amount: '20.000' },
      openingExpected: { amount: '0.000' },
      openingDiscrepancy: null,
      openingIsInitial: true,
      expectedCash: { amount: '20.000' },
    });
    // A cash sale goes to the drawer only; a card sale to the bank (minus fee), not the drawer.
    expect((await one.sell(s.cash, '3', '3.000')).statusCode).toBe(201);
    expect((await one.sell(s.card, '2', '2.000')).statusCode).toBe(201);
    let main = await mainBranch(s);
    expect(main.registers[0]!.balance.amount).toBe('23.000');
    expect(main.treasury.balance.amount).toBe('0.000');
    const shift = await one.current();
    expect(shift.summary.expectedCash.amount).toBe('23.000');
    // Closing short: the difference is booked on the shift; the counted cash stays.
    const closed = await one.close('22.500', shift.version, 'coins missing');
    expect(closed.json()).toMatchObject({
      discrepancy: { amount: '-0.500' },
      outcome: 'short',
    });
    main = await mainBranch(s);
    expect(main.registers[0]!.balance.amount).toBe('22.500');

    // The next cashier sees the carried balance; a stale figure is refused.
    const two = pos(s, await staff(s, 'cashier'));
    expect((await two.registers())[0]!.expectedCash.amount).toBe('22.500');
    expect((await two.open('22.500', '20.000')).json().code).toBe('EXPECTED_CHANGED');
    // A difference beyond tolerance needs a note, and is between shifts — not the new cashier's.
    expect((await two.open('22.000', '22.500')).statusCode).toBe(400);
    const second = await two.open('22.000', '22.500', 'found less at opening');
    expect(second.statusCode).toBe(201);
    expect(second.json().summary).toMatchObject({
      openingExpected: { amount: '22.500' },
      openingDiscrepancy: { amount: '-0.500' },
      openingIsInitial: false,
    });
    const drawer = main.registers[0]!.accountId;
    expect((await entriesOf(drawer)).map((e) => [e.source_type, e.amount])).toEqual([
      ['register_initial_count', '20000'],
      ['payment', '3000'],
      ['shift_close', '-500'],
      ['shift_open', '-500'],
    ]);
  });
});

describe('drops, top-ups and treasury', () => {
  it('moves cash between the drawer and the treasury without ever counting it twice', async () => {
    const s = await store();
    const p = pos(s, await staff(s));
    await p.open('10.000', '0.000');
    // Top-ups need a counted treasury holding the cash.
    expect(
      (await p.cash({ kind: 'cash_in', amount: '5', reason: 'float_top_up' })).json().code,
    ).toBe('TREASURY_NOT_COUNTED');
    await s.c.countTreasury(s.c.main, '50.000');
    expect(
      (await p.cash({ kind: 'cash_in', amount: '60', reason: 'float_top_up' })).json().code,
    ).toBe('INSUFFICIENT_TREASURY_CASH');
    expect(
      (await p.cash({ kind: 'cash_in', amount: '5', reason: 'float_top_up' })).statusCode,
    ).toBe(201);
    expect((await p.cash({ kind: 'cash_out', amount: '12', reason: 'safe_drop' })).statusCode).toBe(
      201,
    );
    // Exchanging notes for coins changes nothing.
    expect(
      (await p.cash({ kind: 'cash_in', amount: '20', reason: 'change_received' })).statusCode,
    ).toBe(201);
    const main = await mainBranch(s);
    expect(main.registers[0]!.balance.amount).toBe('3.000');
    expect(main.treasury.balance.amount).toBe('57.000');
    // Company cash = treasury + drawer: 50 counted + 10 counted, unchanged by the transfers.
    expect(main.total.amount).toBe('60.000');
    expect((await p.current()).summary.expectedCash.amount).toBe('3.000');
    const transfers = (
      await s.c.client.request('GET', '/manager/cash/transfers', { cookies: s.c.cookies })
    ).json();
    expect(transfers.transfers.map((t: { origin: string }) => t.origin)).toEqual([
      'pos_movement',
      'pos_movement',
    ]);
  });

  it('lets managers with cash custody transfer and count, within their branches only', async () => {
    const s = await store();
    await s.c.countTreasury(s.c.main, '30.000');
    const main = await mainBranch(s);
    const drawer = main.registers[0]!.accountId;
    const treasury = main.treasury.accountId;
    // No open shift: the drawer is topped up directly; then a shift sees it as expected cash.
    const key = newId();
    const [a, b] = await Promise.all([
      transfer(s, {
        fromAccountId: treasury,
        toAccountId: drawer,
        amount: '8',
        idempotencyKey: key,
      }),
      transfer(s, {
        fromAccountId: treasury,
        toAccountId: drawer,
        amount: '8',
        idempotencyKey: key,
      }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(a.json().id).toBe(b.json().id);
    expect((await mainBranch(s)).registers[0]!.balance.amount).toBe('8.000');
    // Not allowed: drawer to drawer, or to another branch's treasury.
    const other = (await overview(s)).branches.find(
      (x: { branchId: string }) => x.branchId === s.c.second,
    );
    expect(
      (
        await transfer(s, {
          fromAccountId: drawer,
          toAccountId: other.registers[0].accountId,
          amount: '1',
        })
      ).json().code,
    ).toBe('TRANSFER_NOT_ALLOWED');
    expect(
      (
        await transfer(s, {
          fromAccountId: drawer,
          toAccountId: other.treasury.accountId,
          amount: '1',
        })
      ).json().code,
    ).toBe('TRANSFER_NOT_ALLOWED');
    // A branch manager without cash.custody is refused; owners can grant it.
    const bm = await s.c.hire(
      [{ roleId: s.c.roles.branch_manager, branchId: s.c.main }],
      'manager',
    );
    expect((await overview(s, bm.cookies)).code).toBe('FORBIDDEN');
    // Parallel withdrawals never take the treasury below zero (30 − 8 = 22 left).
    const attempts = await Promise.all(
      Array.from({ length: 6 }, () =>
        transfer(s, { fromAccountId: treasury, toAccountId: drawer, amount: '5' }),
      ),
    );
    expect(attempts.filter((r) => r.statusCode === 201)).toHaveLength(4);
    expect(attempts.filter((r) => r.json().code === 'INSUFFICIENT_TREASURY_CASH')).toHaveLength(2);
    expect((await mainBranch(s)).total.amount).toBe('30.000');

    // A later count: the difference needs a note and becomes an adjustment.
    const t = (await mainBranch(s)).treasury;
    const count = (body: Record<string, unknown>) =>
      s.c.client.request('POST', `/manager/cash/accounts/${t.accountId}/counts`, {
        cookies: s.c.cookies,
        body,
      });
    expect((await count({ countedCash: '1.500', expectedCash: '1.000' })).json().code).toBe(
      'EXPECTED_CHANGED',
    );
    expect((await count({ countedCash: '1.500', expectedCash: '2.000' })).statusCode).toBe(400);
    expect(
      (await count({ countedCash: '1.500', expectedCash: '2.000', note: 'shortage' })).statusCode,
    ).toBe(201);
    expect((await mainBranch(s)).treasury.balance.amount).toBe('1.500');
  });

  it('records a manager transfer on the open shift so it keeps reconciling', async () => {
    const s = await store();
    const p = pos(s, await staff(s, 'cashier'));
    await p.open('10.000', '0.000');
    const main = await mainBranch(s);
    const res = await transfer(s, {
      fromAccountId: main.registers[0]!.accountId,
      toAccountId: main.treasury.accountId,
      amount: '4',
      note: 'mid-shift pickup',
    });
    expect(res.statusCode).toBe(201);
    const shift = await p.current();
    expect(shift.summary.expectedCash.amount).toBe('6.000');
    expect(shift.movements).toMatchObject([
      { kind: 'cash_out', reason: 'safe_drop', amount: { amount: '4.000' } },
    ]);
    // Cannot take more than the drawer holds.
    expect(
      (
        await transfer(s, {
          fromAccountId: main.registers[0]!.accountId,
          toAccountId: main.treasury.accountId,
          amount: '7',
        })
      ).json().code,
    ).toBe('INSUFFICIENT_CASH');
  });
});

describe('refunds and permissions', () => {
  it('pays a cash refund from the refunding shift’s drawer and keeps cashiers off cash moves', async () => {
    const s = await store();
    const seller = pos(s, await staff(s, 'cashier'));
    await seller.open('10.000', '0.000');
    const sale = (await seller.sell(s.cash, '4', '4.000')).json();
    // A second register at the branch refunds it.
    const r2 = (
      await s.c.client.request('POST', '/manager/registers', {
        cookies: s.c.cookies,
        body: { branchId: s.c.main, code: 'R2', nameEn: 'Register 2' },
      })
    ).json().id as string;
    const refunderCookies = await staff(s, 'cashier');
    const refunder = pos(s, refunderCookies);
    await refunder.open('5.000', '0.000', undefined, r2);
    const res = await s.c.client.request('POST', '/pos/refunds', {
      cookies: refunderCookies,
      body: {
        idempotencyKey: newId(),
        reason: 'changed_mind',
        saleId: sale.id,
        lines: [{ position: 0, quantity: '1' }],
      },
    });
    expect(res.statusCode).toBe(201);
    const main = await mainBranch(s);
    const balanceOf = (registerId: string) =>
      main.registers.find((r) => r.registerId === registerId)!.balance.amount;
    expect(balanceOf(s.register)).toBe('14.000');
    expect(balanceOf(r2)).toBe('4.000');
    // Cashiers record no cash in/out by default (ADR-0090).
    expect(
      (await refunder.cash({ kind: 'cash_out', amount: '1', reason: 'safe_drop' })).json().code,
    ).toBe('FORBIDDEN');
  });
});

describe('forced close', () => {
  it('distinguishes a counted forced close from one without a count', async () => {
    const s = await store();
    const p = pos(s, await staff(s, 'cashier'));
    await p.open('10.000', '0.000');
    const shiftId = (await p.current()).id as string;
    const force = (body: Record<string, unknown>) =>
      s.c.client.request('POST', `/manager/shifts/${shiftId}/force-close`, {
        cookies: s.c.cookies,
        body,
      });
    // Without a count: no difference booked; the drawer needs a count.
    const closed = await force({ note: 'cashier left', version: 1 });
    expect(closed.json()).toMatchObject({
      closeType: 'forced_uncounted',
      countedCash: null,
      discrepancy: null,
      outcome: null,
    });
    const next = pos(s, await staff(s, 'cashier'));
    expect((await next.registers())[0]).toMatchObject({
      expectedCash: { amount: '10.000' },
      needsCount: true,
    });
    // The difference found at the next count belongs to the forced shift, not the new cashier.
    const opened = await next.open('9.000', '10.000', 'one note missing');
    expect(opened.statusCode).toBe(201);
    const row = (
      await owner.query(
        `select opening_follows_shift_id, opening_discrepancy_minor::text as d, opening_is_initial
           from shifts where id = $1`,
        [opened.json().id],
      )
    ).rows[0];
    expect(row).toEqual({
      opening_follows_shift_id: shiftId,
      d: '-1000',
      opening_is_initial: false,
    });

    // With a count: a verified close, with its difference.
    const current = await next.current();
    const counted = await s.c.client.request('POST', `/manager/shifts/${current.id}/force-close`, {
      cookies: s.c.cookies,
      body: { countedCash: '9.250', note: 'closed for them', version: current.version },
    });
    expect(counted.json()).toMatchObject({
      closeType: 'forced',
      discrepancy: { amount: '0.250' },
    });
    expect((await mainBranch(s)).registers[0]!.balance.amount).toBe('9.250');
  });
});

describe('cutover', () => {
  it('archives the old cash account untouched and starts new balances from counts', async () => {
    const s = await store();
    const sup = await staff(s);
    const p = pos(s, sup);
    await p.open('10.000', '0.000');
    expect((await p.sell(s.cash, '2', '2.000')).statusCode).toBe(201);
    const shiftId = (await p.current()).id as string;
    // Rebuild the pre-ADR-0090 state: a merchant-wide cash account linked to the cash method,
    // with sales from two branches in it, and a shift open without custody accounts.
    await owner.query(`delete from financial_account_entries where merchant_id = $1`, [
      s.c.merchantId,
    ]);
    await owner.query(`delete from cash_transfers where merchant_id = $1`, [s.c.merchantId]);
    await owner.query(
      `delete from financial_accounts where merchant_id = $1 and kind in ('register', 'treasury')`,
      [s.c.merchantId],
    );
    const legacy = newId();
    await owner.query(
      `insert into financial_accounts (id, merchant_id, kind, name_ar, name_en)
       values ($1, $2, 'cash', 'الخزينة', 'Cash on hand')`,
      [legacy, s.c.merchantId],
    );
    await owner.query(
      `insert into financial_account_entries (id, merchant_id, account_id, amount_minor, entry_type, source_type, source_id)
       values ($1, $2, $3, 2000, 'payment', 'payment', $4), ($5, $2, $3, 7000, 'payment', 'payment', $6)`,
      [newId(), s.c.merchantId, legacy, newId(), newId(), newId()],
    );
    await owner.query(
      `update payment_methods set financial_account_id = $2 where merchant_id = $1 and kind = 'cash'`,
      [s.c.merchantId, legacy],
    );
    const paymentsBefore = (
      await owner.query(
        `select count(*)::int as n, sum(amount_minor)::text as t from payments where merchant_id = $1`,
        [s.c.merchantId],
      )
    ).rows[0];

    const run = async () =>
      (await owner.query(`select cash_custody_cutover($1) as done`, [s.c.merchantId])).rows[0].done;
    expect(await run()).toBe(true);
    expect(await run()).toBe(false);

    // The old account keeps every entry, is archived, and takes no new ones.
    const old = (
      await owner.query(`select status, name_ar from financial_accounts where id = $1`, [legacy])
    ).rows[0];
    expect(old).toEqual({ status: 'archived', name_ar: 'حساب النقد القديم' });
    expect(await entriesOf(legacy)).toHaveLength(2);
    await expect(
      owner.query(
        `insert into financial_account_entries (id, merchant_id, account_id, amount_minor, entry_type, source_type, source_id)
         values ($1, $2, $3, 100, 'payment', 'payment', $4)`,
        [newId(), s.c.merchantId, legacy, newId()],
      ),
    ).rejects.toThrow(/archived/);
    // New treasuries and drawers start at zero and uncounted; nothing was copied.
    const o = await overview(s);
    expect(o.branches).toHaveLength(2);
    for (const b of o.branches) {
      expect(b.treasury).toMatchObject({ balance: { amount: '0.000' }, countedAt: null });
      for (const r of b.registers)
        expect(r).toMatchObject({ balance: { amount: '0.000' }, needsCount: true });
    }
    // The shift open at cutover keeps its record-based expected cash (10 + 2 + 1)…
    expect((await p.sell(s.cash, '1', '1.000')).statusCode).toBe(201);
    const shift = await p.current();
    expect(shift.id).toBe(shiftId);
    expect(shift.summary.expectedCash.amount).toBe('13.000');
    const closed = await p.close('12.750', shift.version, 'legacy close');
    expect(closed.json()).toMatchObject({ discrepancy: { amount: '-0.250' } });
    // …and its count becomes the drawer's first verified balance.
    const after = await mainBranch(s);
    expect(after.registers[0]!.balance.amount).toBe('12.750');
    const next = pos(s, await staff(s, 'cashier'));
    expect((await next.registers())[0]).toMatchObject({
      expectedCash: { amount: '12.750' },
      needsCount: false,
    });
    // Sales history is untouched (only the new sale was added).
    const paymentsAfter = (
      await owner.query(
        `select count(*)::int as n, sum(amount_minor)::text as t from payments where merchant_id = $1`,
        [s.c.merchantId],
      )
    ).rows[0];
    expect(paymentsAfter.n).toBe(paymentsBefore.n + 1);
    expect(BigInt(paymentsAfter.t) - BigInt(paymentsBefore.t)).toBe(1000n);
  });
});

describe('ledger rules in the database', () => {
  it('rejects unbalanced transfers and register entries without the open shift', async () => {
    const s = await store();
    await s.c.countTreasury(s.c.main, '10.000');
    const main = await mainBranch(s);
    const client = await owner.connect();
    try {
      await client.query('begin');
      const id = newId();
      await client.query(
        `insert into cash_transfers (id, merchant_id, from_account_id, to_account_id, amount_minor, origin, created_by_user_id)
         values ($1, $2, $3, $4, 1000, 'manager', $5)`,
        [id, s.c.merchantId, main.treasury.accountId, main.registers[0]!.accountId, s.c.userId],
      );
      await client.query(
        `insert into financial_account_entries (id, merchant_id, account_id, amount_minor, entry_type, source_type, source_id)
         values ($1, $2, $3, -1000, 'transfer', 'cash_transfer', $4)`,
        [newId(), s.c.merchantId, main.treasury.accountId, id],
      );
      await expect(client.query('commit')).rejects.toThrow(/not balanced/);
    } finally {
      client.release();
    }
    // A register with an open shift only takes entries carrying that shift.
    const p = pos(s, await staff(s, 'cashier'));
    await p.open('5.000', '0.000');
    await expect(
      owner.query(
        `insert into financial_account_entries (id, merchant_id, account_id, amount_minor, entry_type, source_type, source_id)
         values ($1, $2, $3, 100, 'adjustment', 'test', $4)`,
        [newId(), s.c.merchantId, main.registers[0]!.accountId, newId()],
      ),
    ).rejects.toThrow(/open shift/);
  });
});
