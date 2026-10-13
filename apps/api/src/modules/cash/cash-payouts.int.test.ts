import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../kernel/ids.js';
import { DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

/**
 * Cash custody phase B (ADR-0091): expenses and supplier payments (real outflows), bank
 * deposits, and branch-to-branch transfers through the in-transit account.
 */
let app: NestFastifyApplication;
let owner: pg.Pool;
let db: DbFixtures;
let mailer: InMemoryMailer;
let runtimeUrl: string;

beforeAll(async () => {
  const prepared = await prepareIntegrationDatabase();
  owner = prepared.owner;
  runtimeUrl = prepared.runtimeUrl;
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

async function company() {
  const c = await createCompany(app, db, mailer);
  const register = (
    await c.client.request('GET', `/manager/registers?branchId=${c.main}`, { cookies: c.cookies })
  ).json().registers[0].id as string;
  const banks = (
    await c.client.request('GET', '/manager/cash/bank-accounts', { cookies: c.cookies })
  ).json().accounts as { id: string }[];
  const supplier = await newSupplier(c, 'Al Watan Trading');
  return { c, register, bank: banks[0]!.id, supplier };
}
type Company = Awaited<ReturnType<typeof company>>;

async function newSupplier(c: Co, nameEn: string) {
  const res = await c.client.request('POST', '/manager/suppliers', {
    cookies: c.cookies,
    body: { nameEn },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

const call = (
  s: Company,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  cookies?: Cookies,
) =>
  s.c.client.request(method, path, {
    cookies: cookies ?? s.c.cookies,
    ...(body === undefined ? {} : { body }),
  });

async function overview(s: Company) {
  return (await call(s, 'GET', '/manager/cash/overview')).json() as {
    branches: {
      branchId: string;
      treasury: { accountId: string; balance: { amount: string } };
      registers: { accountId: string; balance: { amount: string } }[];
    }[];
    inTransitTotal: { amount: string };
    depositsInTransitTotal: { amount: string };
    total: { amount: string };
  };
}
async function treasury(s: Company, branchId: string) {
  const o = await overview(s);
  return o.branches.find((b) => b.branchId === branchId)!.treasury;
}
async function drawer(s: Company) {
  const o = await overview(s);
  return o.branches.find((b) => b.branchId === s.c.main)!.registers[0]!;
}
async function balanceOf(accountId: string) {
  const { rows } = await owner.query(
    `select coalesce(sum(amount_minor), 0)::text as b from financial_account_entries
      where account_id = $1`,
    [accountId],
  );
  return rows[0].b as string;
}

/** A supervisor at the main branch with an open shift counted at `cash`. */
async function shiftWith(s: Company, cash: string, extra: string[] = []) {
  const hired = await s.c.hire([{ roleId: s.c.roles.supervisor, branchId: s.c.main }], 'pos');
  for (const key of extra)
    await owner.query(
      `insert into role_permissions (merchant_id, role_id, permission_key)
       values ($1, $2, $3) on conflict do nothing`,
      [s.c.merchantId, s.c.roles.supervisor, key],
    );
  const opened = await call(
    s,
    'POST',
    '/pos/shifts',
    { registerId: s.register, countedCash: cash, expectedCash: '0.000' },
    hired.cookies,
  );
  expect(opened.statusCode).toBe(201);
  return {
    cookies: hired.cookies,
    move: (body: Record<string, unknown>) =>
      call(s, 'POST', '/pos/shifts/current/cash-movements', body, hired.cookies),
  };
}

describe('expenses and supplier payments', () => {
  it('pays from the drawer at the POS as real outflows, not transfers', async () => {
    const s = await company();
    const shift = await shiftWith(s, '50.000');
    const expense = await shift.move({
      kind: 'cash_out',
      reason: 'petty_expense',
      amount: '3.500',
      category: 'cleaning',
      receiptReference: 'R-77',
    });
    expect(expense.statusCode).toBe(201);
    // A category is required; "other" needs a description.
    expect(
      (await shift.move({ kind: 'cash_out', reason: 'petty_expense', amount: '1.000' })).statusCode,
    ).toBe(400);
    expect(
      (
        await shift.move({
          kind: 'cash_out',
          reason: 'petty_expense',
          amount: '1.000',
          category: 'other',
        })
      ).statusCode,
    ).toBe(400);
    // A supplier payment names the supplier.
    expect(
      (await shift.move({ kind: 'cash_out', reason: 'supplier_payment', amount: '1.000' }))
        .statusCode,
    ).toBe(400);
    const paid = await shift.move({
      kind: 'cash_out',
      reason: 'supplier_payment',
      amount: '10.000',
      supplierId: s.supplier,
      note: 'Invoice 4411',
    });
    expect(paid.statusCode).toBe(201);
    expect((await drawer(s)).balance.amount).toBe('36.500');

    const list = (await call(s, 'GET', '/manager/cash/disbursements')).json();
    expect(list.total).toBe(2);
    expect(list.netTotal.amount).toBe('13.500');
    const exp = list.disbursements.find((d: { kind: string }) => d.kind === 'expense');
    expect(exp).toMatchObject({
      category: 'cleaning',
      receiptReference: 'R-77',
      source: { kind: 'register' },
      amount: { amount: '3.500' },
    });
    expect(exp.number).toMatch(/^EX-/);
    const expenses = (await call(s, 'GET', '/manager/cash/disbursements?kind=expense')).json();
    expect(expenses.netTotal.amount).toBe('3.500');

    // Ledger: expense / supplier_payment entries, never transfers; no cash_transfers row.
    const { rows } = await owner.query(
      `select entry_type, amount_minor::text as a from financial_account_entries
        where source_type = 'cash_disbursement' and merchant_id = $1 order by amount_minor`,
      [s.c.merchantId],
    );
    expect(rows).toEqual([
      { entry_type: 'supplier_payment', a: '-10000' },
      { entry_type: 'expense', a: '-3500' },
    ]);
    const transfers = await owner.query(
      `select count(*)::int as n from cash_transfers where merchant_id = $1`,
      [s.c.merchantId],
    );
    expect(transfers.rows[0].n).toBe(0);

    // The supplier page shows the payment.
    const sp = (await call(s, 'GET', `/manager/suppliers/${s.supplier}/payments`)).json();
    expect(sp.totalPaid.amount).toBe('10.000');
    expect(sp.payments[0]).toMatchObject({
      description: 'Invoice 4411',
      shiftId: expect.any(String),
    });

    // A reversal puts the cash back in the drawer (with the open shift) and nets the totals.
    const reversed = await call(s, 'POST', `/manager/cash/disbursements/${exp.id}/reverse`, {
      reason: 'Entered twice',
      idempotencyKey: newId(),
    });
    expect(reversed.statusCode).toBe(201);
    expect(reversed.json()).toMatchObject({ reversesId: exp.id, amount: { amount: '3.500' } });
    expect((await drawer(s)).balance.amount).toBe('40.000');
    const again = await call(s, 'POST', `/manager/cash/disbursements/${exp.id}/reverse`, {
      reason: 'again',
      idempotencyKey: newId(),
    });
    expect(again.json().code).toBe('INVALID_STATE');
    const after = (await call(s, 'GET', '/manager/cash/disbursements?kind=expense')).json();
    expect(after.netTotal.amount).toBe('0.000');
    expect(after.disbursements.find((d: { id: string }) => d.id === exp.id).reversedById).toBe(
      reversed.json().id,
    );
    // The drawer cannot pay more than it holds.
    const tooMuch = await shift.move({
      kind: 'cash_out',
      reason: 'petty_expense',
      amount: '40.001',
      category: 'supplies',
    });
    expect(tooMuch.json().code).toBe('INSUFFICIENT_CASH');
  });

  it('pays from a treasury in the manager, with a purchase order of the same supplier', async () => {
    const s = await company();
    const pay = (body: Record<string, unknown>) =>
      call(s, 'POST', '/manager/cash/disbursements', {
        branchId: s.c.main,
        idempotencyKey: newId(),
        ...body,
      });
    // Not counted yet: nothing leaves the treasury.
    expect(
      (await pay({ kind: 'expense', category: 'utilities', amount: '5.000' })).json().code,
    ).toBe('TREASURY_NOT_COUNTED');
    await s.c.countTreasury(s.c.main, '100.000');
    const key = newId();
    const first = await call(s, 'POST', '/manager/cash/disbursements', {
      branchId: s.c.main,
      kind: 'expense',
      category: 'utilities',
      amount: '5.000',
      description: 'Electricity',
      idempotencyKey: key,
    });
    expect(first.statusCode).toBe(201);
    const replay = await call(s, 'POST', '/manager/cash/disbursements', {
      branchId: s.c.main,
      kind: 'expense',
      category: 'utilities',
      amount: '5.000',
      description: 'Electricity',
      idempotencyKey: key,
    });
    expect(replay.json().id).toBe(first.json().id);
    expect((await treasury(s, s.c.main)).balance.amount).toBe('95.000');

    // Purchase orders: only one of this supplier, and not a draft.
    const product = (
      await call(s, 'POST', '/manager/products', {
        nameEn: 'Flour',
        variants: [{ sku: `F-${newId().slice(-6)}`, price: '1.000', cost: '0.500', barcodes: [] }],
      })
    ).json();
    const order = (
      await call(s, 'POST', '/manager/purchase-orders', {
        supplierId: s.supplier,
        branchId: s.c.main,
        lines: [{ variantId: product.variants[0].id, quantity: '10', unitCost: '0.500' }],
      })
    ).json();
    const draft = await pay({
      kind: 'supplier_payment',
      supplierId: s.supplier,
      purchaseOrderId: order.id,
      amount: '5.000',
    });
    expect(draft.json().code).toBe('INVALID_STATE');
    await call(s, 'POST', `/manager/purchase-orders/${order.id}/submit`, {
      version: order.version,
    });
    const other = await newSupplier(s.c, 'Other supplier');
    const wrong = await pay({
      kind: 'supplier_payment',
      supplierId: other,
      purchaseOrderId: order.id,
      amount: '5.000',
    });
    expect(wrong.statusCode).toBe(400);
    const ok = await pay({
      kind: 'supplier_payment',
      supplierId: s.supplier,
      purchaseOrderId: order.id,
      amount: '5.000',
      receiptReference: 'INV-9',
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({
      number: expect.stringMatching(/^SP-/),
      purchaseOrder: { id: order.id },
      source: { kind: 'treasury' },
    });
    expect((await treasury(s, s.c.main)).balance.amount).toBe('90.000');
    // An inactive supplier is not paid.
    await owner.query(`update suppliers set status = 'inactive' where id = $1`, [other]);
    expect(
      (await pay({ kind: 'supplier_payment', supplierId: other, amount: '1.000' })).json().code,
    ).toBe('SUPPLIER_INACTIVE');
    // Treasury cannot pay more than it holds.
    expect(
      (
        await pay({
          kind: 'expense',
          category: 'supplies',
          amount: '90.001',
          receiptReference: 'R-big',
        })
      ).json().code,
    ).toBe('INSUFFICIENT_TREASURY_CASH');
  });

  it('needs cash custody, and the records are append-only', async () => {
    const s = await company();
    await s.c.countTreasury(s.c.main, '20.000');
    const manager = await s.c.hire(
      [{ roleId: s.c.roles.branch_manager, branchId: s.c.main }],
      'manager',
    );
    const denied = await call(
      s,
      'POST',
      '/manager/cash/disbursements',
      {
        branchId: s.c.main,
        kind: 'expense',
        category: 'supplies',
        amount: '1.000',
        idempotencyKey: newId(),
      },
      manager.cookies,
    );
    expect(denied.statusCode).toBe(403);
    const made = (
      await call(s, 'POST', '/manager/cash/disbursements', {
        branchId: s.c.main,
        kind: 'expense',
        category: 'supplies',
        amount: '1.000',
        idempotencyKey: newId(),
      })
    ).json();
    const runtime = new pg.Pool({ connectionString: runtimeUrl, max: 1 });
    try {
      await expect(
        runtime.query(`update cash_disbursements set amount_minor = 1 where id = $1`, [made.id]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        runtime.query(`delete from cash_disbursements where id = $1`, [made.id]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await runtime.end();
    }
    // A disbursement without its ledger entry fails at commit.
    await expect(
      owner.query(
        `insert into cash_disbursements (id, merchant_id, number, branch_id, source_account_id,
           kind, category, amount_minor, created_by_user_id)
         select gen_random_uuid(), merchant_id, 'EX-X', branch_id, source_account_id, 'expense',
                'supplies', 1000, created_by_user_id from cash_disbursements where id = $1`,
        [made.id],
      ),
    ).rejects.toThrow(/not posted/);
  });
});

describe('bank deposits', () => {
  it('needs cash.deposit even with cash.move, and moves drawer cash into the bank', async () => {
    const s = await company();
    const shift = await shiftWith(s, '30.000');
    const body = {
      kind: 'cash_out',
      reason: 'bank_deposit',
      amount: '12.000',
      bankAccountId: s.bank,
      receiptReference: 'SLIP-POS',
    };
    expect((await shift.move(body)).statusCode).toBe(403);
    expect(
      (await call(s, 'GET', '/pos/cash/bank-accounts', undefined, shift.cookies)).statusCode,
    ).toBe(403);
    await owner.query(
      `insert into role_permissions (merchant_id, role_id, permission_key) values ($1, $2, 'cash.deposit')`,
      [s.c.merchantId, s.c.roles.supervisor],
    );
    const banks = (
      await call(s, 'GET', '/pos/cash/bank-accounts', undefined, shift.cookies)
    ).json();
    expect(banks.accounts.map((a: { id: string }) => a.id)).toContain(s.bank);
    expect((await shift.move(body)).statusCode).toBe(201);
    expect((await drawer(s)).balance.amount).toBe('18.000');
    // The cash waits in "deposits in transit" until a second person confirms it (BR-168).
    expect(await balanceOf(s.bank)).toBe('0');
    expect((await overview(s)).depositsInTransitTotal.amount).toBe('12.000');
    // The register is no longer the bank: a register account is refused as a deposit target.
    const wrong = await shift.move({ ...body, bankAccountId: (await drawer(s)).accountId });
    expect(wrong.statusCode).toBe(400);
  });

  it('deposits from a treasury in the manager', async () => {
    const s = await company();
    await s.c.countTreasury(s.c.main, '80.000');
    const t = await treasury(s, s.c.main);
    const deposit = await call(s, 'POST', '/manager/cash/deposits', {
      fromAccountId: t.accountId,
      bankAccountId: s.bank,
      amount: '50.000',
      reference: 'SLIP-1',
      idempotencyKey: newId(),
    });
    expect(deposit.statusCode).toBe(201);
    expect(deposit.json()).toMatchObject({
      origin: 'deposit',
      reference: 'SLIP-1',
      to: { kind: 'deposit_transit' },
    });
    expect((await treasury(s, s.c.main)).balance.amount).toBe('30.000');
    // Company cash fell by the deposit: it is on its way to the bank (BR-168).
    expect(await balanceOf(s.bank)).toBe('0');
    expect((await overview(s)).total.amount).toBe('30.000');
    expect((await overview(s)).depositsInTransitTotal.amount).toBe('50.000');
    const tooMuch = await call(s, 'POST', '/manager/cash/deposits', {
      fromAccountId: t.accountId,
      bankAccountId: s.bank,
      amount: '30.001',
      reference: 'SLIP-2',
      idempotencyKey: newId(),
    });
    expect(tooMuch.json().code).toBe('INSUFFICIENT_TREASURY_CASH');
    // Cash custody alone does not allow deposits.
    const custodian = await s.c.hire(
      [{ roleId: s.c.roles.branch_manager, branchId: s.c.main }],
      'manager',
    );
    await owner.query(
      `insert into role_permissions (merchant_id, role_id, permission_key) values ($1, $2, 'cash.custody')`,
      [s.c.merchantId, s.c.roles.branch_manager],
    );
    const denied = await call(
      s,
      'POST',
      '/manager/cash/deposits',
      {
        fromAccountId: t.accountId,
        bankAccountId: s.bank,
        amount: '1.000',
        reference: 'SLIP-3',
        idempotencyKey: newId(),
      },
      custodian.cookies,
    );
    expect(denied.statusCode).toBe(403);
  });
});

describe('branch-to-branch transfers', () => {
  it('sends through in transit, receives with a difference, and keeps company cash whole', async () => {
    const s = await company();
    await s.c.countTreasury(s.c.main, '100.000');
    await s.c.countTreasury(s.c.second, '0.000');
    const sent = await call(s, 'POST', '/manager/cash/branch-transfers', {
      fromBranchId: s.c.main,
      toBranchId: s.c.second,
      amount: '40.000',
      note: 'Weekend float',
      idempotencyKey: newId(),
    });
    expect(sent.statusCode).toBe(201);
    const t = sent.json();
    expect(t).toMatchObject({ status: 'in_transit', number: expect.stringMatching(/^CT-/) });
    let o = await overview(s);
    expect(o.inTransitTotal.amount).toBe('40.000');
    expect(o.total.amount).toBe('100.000');
    expect((await treasury(s, s.c.main)).balance.amount).toBe('60.000');

    // A different count needs a note; the difference is booked on the transfer.
    const noNote = await call(s, 'POST', `/manager/cash/branch-transfers/${t.id}/receive`, {
      receivedAmount: '39.500',
      version: t.version,
    });
    expect(noNote.statusCode).toBe(400);
    const received = await call(s, 'POST', `/manager/cash/branch-transfers/${t.id}/receive`, {
      receivedAmount: '39.500',
      note: 'Half dinar short',
      version: t.version,
    });
    expect(received.statusCode).toBe(201);
    expect(received.json()).toMatchObject({
      status: 'received',
      amountReceived: { amount: '39.500' },
      difference: { amount: '-0.500' },
    });
    o = await overview(s);
    expect(o.inTransitTotal.amount).toBe('0.000');
    expect(o.total.amount).toBe('99.500');
    expect((await treasury(s, s.c.second)).balance.amount).toBe('39.500');
    const { rows } = await owner.query(
      `select coalesce(sum(amount_minor), 0)::text as b from financial_account_entries e
        join financial_accounts a on a.id = e.account_id
        where a.merchant_id = $1 and a.kind = 'in_transit'`,
      [s.c.merchantId],
    );
    expect(rows[0].b).toBe('0');
    // Received once only.
    const twice = await call(s, 'POST', `/manager/cash/branch-transfers/${t.id}/receive`, {
      receivedAmount: '39.500',
      note: 'x',
      version: t.version + 1,
    });
    expect(twice.json().code).toBe('INVALID_STATE');
    // Status only moves forward, even in the database.
    await expect(
      owner.query(`update cash_branch_transfers set status = 'in_transit' where id = $1`, [t.id]),
    ).rejects.toThrow(/cannot move/);
  });

  it('cancels back to the sender, scopes receiving to the destination branch', async () => {
    const s = await company();
    await s.c.countTreasury(s.c.main, '50.000');
    const send = () =>
      call(s, 'POST', '/manager/cash/branch-transfers', {
        fromBranchId: s.c.main,
        toBranchId: s.c.second,
        amount: '20.000',
        idempotencyKey: newId(),
      });
    const t = (await send()).json();
    // A custodian of the main branch only cannot receive at the second branch.
    const mainOnly = await s.c.hire(
      [{ roleId: s.c.roles.branch_manager, branchId: s.c.main }],
      'manager',
    );
    await owner.query(
      `insert into role_permissions (merchant_id, role_id, permission_key) values ($1, $2, 'cash.custody')`,
      [s.c.merchantId, s.c.roles.branch_manager],
    );
    const foreign = await call(
      s,
      'POST',
      `/manager/cash/branch-transfers/${t.id}/receive`,
      { receivedAmount: '20.000', version: t.version },
      mainOnly.cookies,
    );
    expect(foreign.statusCode).toBe(403);
    const cancelled = await call(s, 'POST', `/manager/cash/branch-transfers/${t.id}/cancel`, {
      note: 'Driver not available',
      version: t.version,
    });
    expect(cancelled.json()).toMatchObject({
      status: 'cancelled',
      cancelNote: 'Driver not available',
    });
    expect((await treasury(s, s.c.main)).balance.amount).toBe('50.000');
    expect((await overview(s)).inTransitTotal.amount).toBe('0.000');
    // More than the treasury holds is refused; the list shows both directions.
    const big = await call(s, 'POST', '/manager/cash/branch-transfers', {
      fromBranchId: s.c.main,
      toBranchId: s.c.second,
      amount: '50.001',
      idempotencyKey: newId(),
    });
    expect(big.json().code).toBe('INSUFFICIENT_TREASURY_CASH');
    const list = (
      await call(s, 'GET', `/manager/cash/branch-transfers?branchId=${s.c.second}`)
    ).json();
    expect(list.total).toBe(1);
    // In-transit legs are allowed only for branch transfers (database rule).
    const { rows } = await owner.query(
      `select a.id as transit, t.id as treasury from financial_accounts a, financial_accounts t
        where a.merchant_id = $1 and a.kind = 'in_transit' and t.merchant_id = $1
          and t.kind = 'treasury' and t.branch_id = $2`,
      [s.c.merchantId, s.c.main],
    );
    await expect(
      owner.query(
        `insert into cash_transfers (id, merchant_id, from_account_id, to_account_id, amount_minor,
           origin, created_by_user_id)
         values (gen_random_uuid(), $1, $2, $3, 1000, 'manager', $4)`,
        [s.c.merchantId, rows[0].treasury, rows[0].transit, s.c.userId],
      ),
    ).rejects.toThrow(/not allowed/);
  });
});

describe('disbursement approvals (BR-166)', () => {
  async function treasurers(s: Company) {
    const roles = (
      await s.c.client.request('GET', '/manager/roles', { cookies: s.c.cookies })
    ).json().roles as { id: string; templateKey: string | null }[];
    const role = roles.find((r) => r.templateKey === 'treasurer')!.id;
    const a = await s.c.hire([{ roleId: role, branchId: s.c.main }], 'manager');
    const b = await s.c.hire([{ roleId: role, branchId: s.c.main }], 'manager');
    return { a: a.cookies, b: b.cookies };
  }
  const audit = async (s: Company, action: string) =>
    (await call(s, 'GET', `/manager/audit?action=${action}`)).json().entries as {
      details: Record<string, unknown>;
    }[];

  it('holds treasury payments above the limit for a second custody holder; the owner pays with a recorded exception', async () => {
    const s = await company();
    await s.c.countTreasury(s.c.main, '300.000');
    const { a, b } = await treasurers(s);
    const expense = (amount: string, extra: Record<string, unknown> = {}) => ({
      branchId: s.c.main,
      kind: 'expense',
      category: 'maintenance',
      amount,
      idempotencyKey: newId(),
      ...extra,
    });
    // Within the limit (20.000): paid at once by a treasurer.
    expect(
      (await call(s, 'POST', '/manager/cash/disbursements', expense('15.000'), a)).statusCode,
    ).toBe(201);
    // Above it: a receipt reference is required, and a non-owner cannot pay directly.
    expect(
      (await call(s, 'POST', '/manager/cash/disbursements', expense('25.000'), a)).statusCode,
    ).toBe(400);
    expect(
      (
        await call(
          s,
          'POST',
          '/manager/cash/disbursements',
          expense('25.000', { receiptReference: 'R-1' }),
          a,
        )
      ).json().code,
    ).toBe('APPROVAL_REQUIRED');
    const req = await call(
      s,
      'POST',
      '/manager/cash/payout-requests',
      expense('25.000', { receiptReference: 'R-1', description: 'AC repair' }),
      a,
    );
    expect(req.statusCode).toBe(201);
    expect(req.json()).toMatchObject({ status: 'pending', amount: { amount: '25.000' } });
    expect((await treasury(s, s.c.main)).balance.amount).toBe('285.000');
    const pending = (
      await call(s, 'GET', `/manager/cash/payout-requests?branchId=${s.c.main}`, undefined, b)
    ).json();
    expect(pending.requests.map((r: { id: string }) => r.id)).toContain(req.json().id);
    // Nobody approves their own request; rejecting needs a reason; another treasurer approves.
    const decide = (id: string, body: Record<string, unknown>, cookies: Cookies) =>
      call(s, 'POST', `/manager/cash/payout-requests/${id}/decision`, body, cookies);
    expect((await decide(req.json().id, { decision: 'approve' }, a)).statusCode).toBe(403);
    expect((await decide(req.json().id, { decision: 'reject' }, b)).statusCode).toBe(400);
    const approved = await decide(
      req.json().id,
      { decision: 'approve', note: 'seen the invoice' },
      b,
    );
    expect(approved.statusCode).toBe(201);
    expect(approved.json()).toMatchObject({ status: 'approved', decisionNote: 'seen the invoice' });
    expect(approved.json().disbursementId).toBeTruthy();
    expect((await treasury(s, s.c.main)).balance.amount).toBe('260.000');
    expect((await audit(s, 'payout_request.approved'))[0]!.details).toMatchObject({
      amount: '25.000',
    });
    expect((await decide(req.json().id, { decision: 'approve' }, b)).json().code).toBe(
      'MOVEMENT_DECIDED',
    );
    // Withdrawal by the requester only; rejection with a reason.
    const second = (
      await call(
        s,
        'POST',
        '/manager/cash/payout-requests',
        expense('22.000', { receiptReference: 'R-2' }),
        a,
      )
    ).json();
    expect(
      (await call(s, 'POST', `/manager/cash/payout-requests/${second.id}/withdraw`, {}, b))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(s, 'POST', `/manager/cash/payout-requests/${second.id}/withdraw`, {}, a)).json()
        .status,
    ).toBe('withdrawn');
    const third = (
      await call(
        s,
        'POST',
        '/manager/cash/payout-requests',
        expense('30.000', { receiptReference: 'R-3' }),
        a,
      )
    ).json();
    expect(
      (await decide(third.id, { decision: 'reject', note: 'not ours' }, b)).json().status,
    ).toBe('rejected');
    expect((await treasury(s, s.c.main)).balance.amount).toBe('260.000');
    // The owner pays directly: flagged in the audit log as an override.
    const own = await call(
      s,
      'POST',
      '/manager/cash/disbursements',
      expense('40.000', { receiptReference: 'R-4' }),
    );
    expect(own.statusCode).toBe(201);
    expect((await audit(s, 'cash.disbursement.created'))[0]!.details).toMatchObject({
      limitExceeded: true,
      ownerOverride: true,
    });
    // The dashboard checklist counts what still waits.
    const fourth = await call(
      s,
      'POST',
      '/manager/cash/payout-requests',
      expense('21.000', { receiptReference: 'R-5' }),
      a,
    );
    expect(fourth.statusCode).toBe(201);
    expect((await call(s, 'GET', '/manager/merchant/controls')).json().pendingPayoutRequests).toBe(
      1,
    );
  });

  it('refuses paying a purchase order beyond its value unless the owner confirms it, and shows paid to date', async () => {
    const s = await company();
    await s.c.countTreasury(s.c.main, '100.000');
    const { b } = await treasurers(s);
    const product = (
      await call(s, 'POST', '/manager/products', {
        nameEn: 'Sugar',
        variants: [{ sku: `S-${newId().slice(-6)}`, price: '1.000', cost: '0.500', barcodes: [] }],
      })
    ).json();
    const order = (
      await call(s, 'POST', '/manager/purchase-orders', {
        supplierId: s.supplier,
        branchId: s.c.main,
        lines: [{ variantId: product.variants[0].id, quantity: '10', unitCost: '0.500' }],
      })
    ).json();
    await call(s, 'POST', `/manager/purchase-orders/${order.id}/submit`, {
      version: order.version,
    });
    const pay = (amount: string, extra: Record<string, unknown> = {}, cookies?: Cookies) =>
      call(
        s,
        'POST',
        '/manager/cash/disbursements',
        {
          branchId: s.c.main,
          kind: 'supplier_payment',
          supplierId: s.supplier,
          purchaseOrderId: order.id,
          amount,
          idempotencyKey: newId(),
          ...extra,
        },
        cookies,
      );
    expect((await pay('4.000')).statusCode).toBe(201);
    // Order value 5.000, paid 4.000: 2.000 more would overpay.
    expect((await pay('2.000')).json().code).toBe('ORDER_OVERPAID');
    expect((await pay('2.000', { confirmOverpayment: true }, b)).json().code).toBe(
      'ORDER_OVERPAID',
    );
    const confirmed = await pay('2.000', { confirmOverpayment: true });
    expect(confirmed.statusCode).toBe(201);
    expect((await audit(s, 'cash.disbursement.created'))[0]!.details).toMatchObject({
      overpaymentConfirmed: true,
    });
    const detail = (await call(s, 'GET', `/manager/purchase-orders/${order.id}`)).json();
    expect(detail.total.amount).toBe('5.000');
    expect(detail.paidToDate.amount).toBe('6.000');
    // A reversal reduces paid to date.
    await call(s, 'POST', `/manager/cash/disbursements/${confirmed.json().id}/reverse`, {
      reason: 'paid twice',
      idempotencyKey: newId(),
    });
    expect(
      (await call(s, 'GET', `/manager/purchase-orders/${order.id}`)).json().paidToDate.amount,
    ).toBe('4.000');
  });
});
