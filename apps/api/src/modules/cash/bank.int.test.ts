import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../kernel/ids.js';
import { DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

/** Deposits in transit and bank reconciliation (BR-168, remediation R1.3). */
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

async function company() {
  const c = await createCompany(app, db, mailer);
  const call = (
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    cookies: Cookies = c.cookies,
  ) => c.client.request(method, path, { cookies, ...(body === undefined ? {} : { body }) });
  const banks = (await call('GET', '/manager/cash/bank-accounts')).json().accounts as {
    id: string;
  }[];
  const treasuryId = await c.countTreasury(c.main, '100.000');
  const overview = async () => (await call('GET', '/manager/cash/overview')).json();
  const treasuryBalance = async () =>
    (await overview()).branches.find((b: { branchId: string }) => b.branchId === c.main).treasury
      .balance.amount as string;
  const accounts = async () =>
    (await call('GET', '/manager/financial-accounts')).json().accounts as {
      id: string;
      kind: string;
      status: string;
      balance: { amount: string };
      unreconciledEntries: number;
      lastReconciledAt: string | null;
      version: number;
    }[];
  const bankBalance = async () => (await accounts()).find((a) => a.id === banks[0]!.id)!;
  return {
    c,
    call,
    bank: banks[0]!.id,
    treasuryId,
    overview,
    treasuryBalance,
    accounts,
    bankBalance,
  };
}

describe('deposits in transit', () => {
  it('holds a deposit until a second person confirms it, with a mandatory slip number', async () => {
    const s = await company();
    const deposit = (body: Record<string, unknown>, cookies?: Cookies) =>
      s.call(
        'POST',
        '/manager/cash/deposits',
        {
          fromAccountId: s.treasuryId,
          bankAccountId: s.bank,
          amount: '40.000',
          idempotencyKey: newId(),
          ...body,
        },
        cookies,
      );
    // No slip number, no deposit.
    expect((await deposit({ reference: '' })).statusCode).toBe(400);
    const made = await deposit({ reference: 'SLIP-1' });
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({
      origin: 'deposit',
      reference: 'SLIP-1',
      to: { kind: 'deposit_transit' },
    });
    // The treasury fell; the bank did not rise yet; the overview shows the amount in transit.
    expect(await s.treasuryBalance()).toBe('60.000');
    expect((await s.bankBalance()).balance.amount).toBe('0.000');
    const o = await s.overview();
    expect(o.depositsInTransitTotal.amount).toBe('40.000');
    expect(o.total.amount).toBe('60.000');
    const pending = (await s.call('GET', '/manager/cash/deposits/pending')).json();
    expect(pending.total.amount).toBe('40.000');
    expect(pending.deposits).toHaveLength(1);
    expect(pending.deposits[0]).toMatchObject({
      id: made.json().id,
      reference: 'SLIP-1',
      bank: { id: s.bank },
      from: { kind: 'treasury' },
      branchId: s.c.main,
    });
    expect((await s.call('GET', '/manager/merchant/controls')).json().depositsInTransit).toBe(1);

    // A treasurer who did not make the deposit confirms it; the cash reaches the bank.
    const treasurerRole = (await s.call('GET', '/manager/roles'))
      .json()
      .roles.find((r: { templateKey: string | null }) => r.templateKey === 'treasurer') as {
      id: string;
    };
    const treasurer = await s.c.hire([{ roleId: treasurerRole.id, branchId: null }], 'manager');
    const settle = (id: string, body: Record<string, unknown>, cookies?: Cookies) =>
      s.call('POST', `/manager/cash/deposits/${id}/settle`, body, cookies);
    // ... but not a deposit of their own, unless they are the owner.
    const own = await deposit({ reference: 'SLIP-2', amount: '5.000' }, treasurer.cookies);
    expect(own.statusCode).toBe(201);
    expect(
      (await settle(own.json().id, { decision: 'confirm' }, treasurer.cookies)).statusCode,
    ).toBe(403);
    const confirmed = await settle(
      made.json().id,
      { decision: 'confirm', reference: 'STMT-77' },
      treasurer.cookies,
    );
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json()).toMatchObject({
      origin: 'deposit_confirmation',
      reference: 'STMT-77',
      from: { kind: 'deposit_transit' },
      to: { accountId: s.bank, kind: 'bank' },
      branchId: s.c.main,
    });
    expect((await s.bankBalance()).balance.amount).toBe('40.000');
    // Settled once only.
    expect((await settle(made.json().id, { decision: 'confirm' })).json().code).toBe(
      'DEPOSIT_SETTLED',
    );
    // The owner settles the treasurer's deposit as a return: it goes back to the treasury,
    // with a reason.
    expect((await settle(own.json().id, { decision: 'return' })).statusCode).toBe(400);
    const returned = await settle(own.json().id, {
      decision: 'return',
      note: 'Bank closed, cash brought back',
    });
    expect(returned.statusCode).toBe(201);
    expect(returned.json()).toMatchObject({ origin: 'deposit_return', to: { kind: 'treasury' } });
    expect(await s.treasuryBalance()).toBe('60.000');
    expect((await s.overview()).depositsInTransitTotal.amount).toBe('0.000');
    expect((await s.call('GET', '/manager/cash/deposits/pending')).json().deposits).toHaveLength(0);
    // The owner confirming their own deposit is an audited override.
    const ownerOwn = await deposit({ reference: 'SLIP-3', amount: '1.000' });
    expect((await settle(ownerOwn.json().id, { decision: 'confirm' })).statusCode).toBe(201);
    const audit = (await s.call('GET', '/manager/audit?action=deposit.confirmed')).json();
    expect(audit.total).toBe(2);
    expect(
      audit.entries.some((e: { details: { ownerOverride?: boolean } }) => e.details.ownerOverride),
    ).toBe(true);
    // Cash custody without the deposit right sees none of this.
    const custodian = await s.c.hire(
      [{ roleId: s.c.roles.branch_manager, branchId: s.c.main }],
      'manager',
    );
    expect(
      (await s.call('GET', '/manager/cash/deposits/pending', undefined, custodian.cookies))
        .statusCode,
    ).toBe(403);
  });

  it('routes POS deposits through transit too and needs the slip number', async () => {
    const s = await company();
    await owner.query(
      `insert into role_permissions (merchant_id, role_id, permission_key) values ($1, $2, 'cash.deposit')`,
      [s.c.merchantId, s.c.roles.supervisor],
    );
    const sup = await s.c.hire([{ roleId: s.c.roles.supervisor, branchId: s.c.main }], 'pos');
    const [register] = (await s.call('GET', `/manager/registers?branchId=${s.c.main}`)).json()
      .registers as { id: string }[];
    expect(
      (
        await s.call(
          'POST',
          '/pos/shifts',
          { registerId: register!.id, countedCash: '30.000', expectedCash: '0.000' },
          sup.cookies,
        )
      ).statusCode,
    ).toBe(201);
    const move = (body: Record<string, unknown>) =>
      s.call(
        'POST',
        '/pos/shifts/current/cash-movements',
        {
          kind: 'cash_out',
          reason: 'bank_deposit',
          amount: '12.000',
          bankAccountId: s.bank,
          ...body,
        },
        sup.cookies,
      );
    expect((await move({})).statusCode).toBe(400);
    const moved = await move({ receiptReference: 'SLIP-POS-1' });
    expect(moved.statusCode).toBe(201);
    expect(moved.json().summary.expectedCash.amount).toBe('18.000');
    expect((await s.bankBalance()).balance.amount).toBe('0.000');
    const pending = (await s.call('GET', '/manager/cash/deposits/pending')).json();
    expect(pending.deposits).toHaveLength(1);
    expect(pending.deposits[0]).toMatchObject({
      reference: 'SLIP-POS-1',
      from: { kind: 'register' },
      amount: { amount: '12.000' },
    });
    // The owner confirms the cashier's deposit; the bank rises.
    expect(
      (
        await s.call('POST', `/manager/cash/deposits/${pending.deposits[0].id}/settle`, {
          decision: 'confirm',
        })
      ).statusCode,
    ).toBe(201);
    expect((await s.bankBalance()).balance.amount).toBe('12.000');
  });
});

describe('bank reconciliation', () => {
  it('ticks entries against the statement, explains differences and guards deactivation', async () => {
    const s = await company();
    const deposit = async (amount: string, reference: string) => {
      const made = await s.call('POST', '/manager/cash/deposits', {
        fromAccountId: s.treasuryId,
        bankAccountId: s.bank,
        amount,
        reference,
        idempotencyKey: newId(),
      });
      expect(made.statusCode).toBe(201);
      return made.json().id as string;
    };
    const treasurerRole = (await s.call('GET', '/manager/roles'))
      .json()
      .roles.find((r: { templateKey: string | null }) => r.templateKey === 'treasurer') as {
      id: string;
    };
    const treasurer = await s.c.hire([{ roleId: treasurerRole.id, branchId: s.c.main }], 'manager');
    for (const [amount, slip] of [
      ['10.000', 'A'],
      ['20.000', 'B'],
      ['30.000', 'C'],
    ] as const) {
      const id = await deposit(amount, slip);
      expect(
        (
          await s.call(
            'POST',
            `/manager/cash/deposits/${id}/settle`,
            { decision: 'confirm' },
            treasurer.cookies,
          )
        ).statusCode,
      ).toBe(201);
    }
    const state = () =>
      s.call(
        'GET',
        `/manager/cash/bank-accounts/${s.bank}/reconciliation`,
        undefined,
        treasurer.cookies,
      );
    let st = (await state()).json();
    expect(st.bookBalance.amount).toBe('60.000');
    expect(st.clearedBalance.amount).toBe('0.000');
    expect(st.unreconciled).toHaveLength(3);
    expect(st.unreconciled[0].reference).toBe('A');
    expect(st.last).toBeNull();
    expect((await s.bankBalance()).unreconciledEntries).toBe(3);

    const reconcile = (body: Record<string, unknown>, cookies: Cookies = treasurer.cookies) =>
      s.call('POST', `/manager/cash/bank-accounts/${s.bank}/reconciliations`, body, cookies);
    const ids = st.unreconciled.map((e: { id: string }) => e.id) as string[];
    // Two deposits on the statement, 30.000 cleared: the statement says 30.000 → balanced.
    const first = await reconcile({
      statementDate: '2026-10-10',
      statementBalance: '30.000',
      entryIds: ids.slice(0, 2),
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      statementBalance: { amount: '30.000' },
      clearedBalance: { amount: '30.000' },
      bookBalance: { amount: '60.000' },
      difference: { amount: '0.000' },
      itemCount: 2,
    });
    st = (await state()).json();
    expect(st.unreconciled).toHaveLength(1);
    expect(st.clearedBalance.amount).toBe('30.000');
    expect(st.last.id).toBe(first.json().id);
    // An entry cannot be ticked twice, nor an entry of another account.
    expect(
      (
        await reconcile({
          statementDate: '2026-10-11',
          statementBalance: '60.000',
          entryIds: [ids[0]],
        })
      ).statusCode,
    ).toBe(400);
    // The bank shows 59.500 against 60.000 cleared: the difference needs an explanation.
    const unexplained = await reconcile({
      statementDate: '2026-10-11',
      statementBalance: '59.500',
      entryIds: [ids[2]],
    });
    expect(unexplained.statusCode).toBe(400);
    expect(unexplained.json().issues[0].path).toBe('note');
    const explained = await reconcile({
      statementDate: '2026-10-11',
      statementBalance: '59.500',
      entryIds: [ids[2]],
      note: 'Bank fee 0.500 not booked yet',
    });
    expect(explained.statusCode).toBe(201);
    expect(explained.json().difference.amount).toBe('-0.500');
    st = (await state()).json();
    expect(st.unreconciled).toHaveLength(0);
    expect(st.history).toHaveLength(2);
    expect((await s.bankBalance()).lastReconciledAt).not.toBeNull();
    expect((await s.call('GET', '/manager/audit?action=bank.reconciled')).json().total).toBe(2);

    // A bank account with a balance cannot be switched off; neither can one with
    // unreconciled entries or a deposit in transit.
    const account = await s.bankBalance();
    const deactivate = async () =>
      s.call('PATCH', `/manager/financial-accounts/${s.bank}`, {
        nameEn: 'Bank – NBK',
        kind: 'bank',
        status: 'inactive',
        version: (await s.bankBalance()).version,
      });
    expect((await deactivate()).json().code).toBe('ACCOUNT_IN_USE');
    expect(account.status).toBe('active');
    // A fresh bank account with nothing on it can be deactivated.
    const created = await s.call('POST', '/manager/financial-accounts', {
      nameEn: 'Bank – KFH',
      kind: 'bank',
    });
    expect(created.statusCode).toBe(201);
    const idle = created.json() as { id: string; version: number };
    expect(
      (
        await s.call('PATCH', `/manager/financial-accounts/${idle.id}`, {
          nameEn: 'Bank – KFH',
          kind: 'bank',
          status: 'inactive',
          version: idle.version,
        })
      ).statusCode,
    ).toBe(200);
    // But not once a deposit towards it is in transit.
    const kfh = await s.call('POST', '/manager/financial-accounts', {
      nameEn: 'Bank – Gulf',
      kind: 'bank',
    });
    const gulf = kfh.json() as { id: string; version: number };
    expect(
      (
        await s.call('POST', '/manager/cash/deposits', {
          fromAccountId: s.treasuryId,
          bankAccountId: gulf.id,
          amount: '1.000',
          reference: 'G-1',
          idempotencyKey: newId(),
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await s.call('PATCH', `/manager/financial-accounts/${gulf.id}`, {
          nameEn: 'Bank – Gulf',
          kind: 'bank',
          status: 'inactive',
          version: gulf.version,
        })
      ).json().code,
    ).toBe('ACCOUNT_IN_USE');
    // Reconciliation is a bank matter: a cashier never sees it.
    const cashier = await s.c.hire([{ roleId: s.c.roles.cashier, branchId: s.c.main }], 'pos');
    expect([401, 403]).toContain(
      (
        await s.call(
          'GET',
          `/manager/cash/bank-accounts/${s.bank}/reconciliation`,
          undefined,
          cashier.cookies,
        )
      ).statusCode,
    );
  });
});
