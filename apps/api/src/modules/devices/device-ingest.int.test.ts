import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../kernel/ids.js';
import { DbFixtures, PASSWORD, createCompany } from '../../testing/auth-fixtures.js';
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
type Rec = Record<string, unknown>;

/** A company with a registered device at the main branch, a cashier and two products. */
async function setup() {
  const c = await createCompany(app, db, mailer);
  const product = async (nameEn: string, price: string, trackInventory: boolean) => {
    const res = await c.client.request('POST', '/manager/products', {
      cookies: c.cookies,
      body: {
        nameEn,
        nameAr: nameEn,
        trackInventory,
        variants: [
          {
            sku: `SKU-${Math.random().toString(36).slice(2, 8)}`,
            price,
            cost: '0.100',
            barcodes: [],
          },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().variants[0].id as string;
  };
  const tea = await product('Tea', '0.250', false);
  const cup = await product('Cup', '1.000', true);
  const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
  const reg = await register(c, c.main);
  const snap = (await sync(reg.token, 'GET')).json();
  const cash = snap.paymentMethods.find((m: { kind: string }) => m.kind === 'cash').id as string;
  const membership = await owner.query(
    `select m.id from memberships m join users u on u.id = m.user_id where u.email = $1`,
    [cashier.email],
  );
  return {
    c,
    tea,
    cup,
    cash,
    ...reg,
    cashierId: membership.rows[0].id as string,
    prefix: `MAIN-${reg.device.registerCode}-`,
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function register(c: Co, branchId: string) {
  const res = await c.client.request('POST', '/device/register', {
    body: { email: c.email, password: PASSWORD, deviceName: 'Till', branchId, role: 'secondary' },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as {
    token: string;
    device: { id: string; registerId: string; registerCode: string };
  };
}

function sync(token: string, method: 'GET' | 'POST', records?: Rec[]) {
  return app.inject({
    method,
    url: '/api/v1/device/sync',
    headers: { authorization: `Bearer ${token}` },
    ...(records ? { payload: { records } } : {}),
  });
}

const at = (minutesFromNow: number) => new Date(Date.now() + minutesFromNow * 60_000).toISOString();

function openShift(s: Setup, id = newId(), occurredAt = at(-30)): Rec {
  return {
    kind: 'shift_open',
    id,
    occurredAt,
    membershipId: s.cashierId,
    countedCashMinor: '0',
    note: null,
  };
}

/** Two teas at 0.250 with 10 % off the first line, paid in cash with 1.000 tendered. */
function sale(s: Setup, shiftId: string, n: number, extra: Rec = {}): Rec {
  return {
    kind: 'sale',
    id: newId(),
    occurredAt: at(-20),
    membershipId: s.cashierId,
    shiftId,
    receiptNumber: `${s.prefix}${String(n).padStart(6, '0')}`,
    catalogVersion: '2026-10-17T00:00:00.000Z',
    lines: [
      {
        variantId: s.tea,
        quantity: '2',
        listUnitPriceMinor: '250',
        unitPriceMinor: '250',
        priceOverrideReason: null,
        discount: { type: 'percent', value: '10' },
        grossMinor: '500',
        lineDiscountMinor: '50',
        orderDiscountMinor: '0',
        netMinor: '450',
      },
    ],
    orderDiscount: null,
    subtotalMinor: '500',
    lineDiscountsMinor: '50',
    orderDiscountMinor: '0',
    totalMinor: '450',
    payments: [
      {
        id: newId(),
        methodId: s.cash,
        amountMinor: '450',
        tenderedMinor: '1000',
        changeMinor: '550',
        feeMinor: '0',
        reference: null,
      },
    ],
    aboveLimit: false,
    zeroTotalReason: null,
    override: null,
    ...extra,
  };
}

const drawerBalance = async (registerId: string) =>
  (
    await owner.query(
      `select coalesce(sum(e.amount_minor), 0)::text as b from financial_account_entries e
       join financial_accounts a on a.id = e.account_id where a.register_id = $1`,
      [registerId],
    )
  ).rows[0].b as string;

describe('sync upload', () => {
  it('ingests a whole offline session through the ledger, exactly once', async () => {
    const s = await setup();
    const shiftId = newId();
    const theSale = sale(s, shiftId, 1);
    const movement = {
      kind: 'cash_movement',
      id: newId(),
      occurredAt: at(-15),
      membershipId: s.cashierId,
      shiftId,
      direction: 'cash_out',
      amountMinor: '100',
      note: 'Ice',
    };
    const refund = {
      kind: 'refund',
      id: newId(),
      occurredAt: at(-10),
      membershipId: s.cashierId,
      shiftId,
      saleId: theSale['id'],
      lines: [{ position: 0, quantity: '1' }],
      reason: 'changed_mind',
      note: null,
      payback: [
        {
          paymentId: (theSale['payments'] as Rec[])[0]!['id'],
          amountMinor: '225',
          reference: null,
        },
      ],
      // A cashier refunding their own sale needed a second person at the till.
      approval: { approverMembershipId: await ownerMembership(s), reasons: ['own_sale'] },
    };
    const close = {
      kind: 'shift_close',
      id: newId(),
      occurredAt: at(-5),
      membershipId: s.cashierId,
      shiftId,
      countedCashMinor: '125',
      note: null,
    };
    const batch = [openShift(s, shiftId), theSale, movement, refund, close];
    const res = await sync(s.token, 'POST', batch);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results.map((r: Rec) => [r['kind'], r['status'], r['code']])).toEqual([
      ['shift_open', 'accepted', null],
      ['sale', 'accepted', null],
      ['cash_movement', 'accepted', null],
      ['refund', 'accepted', null],
      ['shift_close', 'accepted', null],
    ]);
    expect(body.results[3].result.refundNumber).toBe(`${s.prefix}000001-R1`);
    const refundRow = (
      await owner.query(
        `select status, completed_at, decided_by_user_id from refunds where id = $1`,
        [refund['id']],
      )
    ).rows[0];
    expect(refundRow.status).toBe('completed');
    expect(new Date(refundRow.completed_at).toISOString()).toBe(refund['occurredAt']);
    expect(refundRow.decided_by_user_id).not.toBeNull();
    expect(body.results[4].result).toMatchObject({ discrepancyMinor: '0', outcome: 'balanced' });

    // The sale keeps the device's id, number and time; cash went through the drawer.
    const row = (
      await owner.query(
        `select receipt_number, total_minor::text, created_at, register_id from sales where id = $1`,
        [theSale['id']],
      )
    ).rows[0];
    expect(row).toMatchObject({
      receipt_number: `${s.prefix}000001`,
      total_minor: '450',
      register_id: s.device.registerId,
    });
    expect(new Date(row.created_at).toISOString()).toBe(theSale['occurredAt']);
    expect(await drawerBalance(s.device.registerId)).toBe('125'); // 450 − 100 − 225
    const shift = (
      await owner.query(
        `select status, closed_at, discrepancy_minor::text from shifts where id = $1`,
        [shiftId],
      )
    ).rows[0];
    expect(shift).toMatchObject({ status: 'closed', discrepancy_minor: '0' });
    // The device prints its own receipts: no server print job (gap A).
    expect(
      (
        await owner.query(`select count(*)::int as n from print_jobs where sale_id = $1`, [
          theSale['id'],
        ])
      ).rows[0].n,
    ).toBe(0);
    const audit = await owner.query(
      `select action, details->>'deviceId' as device from audit_log where target_id = $1`,
      [theSale['id']],
    );
    expect(audit.rows).toEqual([{ action: 'sale.completed', device: s.device.id }]);

    // The same batch again: every record is a duplicate and nothing moves twice.
    const again = (await sync(s.token, 'POST', batch)).json();
    expect(again.results.map((r: Rec) => r['status'])).toEqual(Array(5).fill('duplicate'));
    expect(again.results[3].result.refundNumber).toBe(`${s.prefix}000001-R1`);
    expect(await drawerBalance(s.device.registerId)).toBe('125');
    // The same id with different content is refused, not applied.
    const changed = (await sync(s.token, 'POST', [{ ...movement, amountMinor: '200' }])).json();
    expect(changed.results[0]).toMatchObject({ status: 'refused', code: 'IDEMPOTENCY_CONFLICT' });
    // The server's view of the device's counter for a reinstall.
    const snap = (await sync(s.token, 'GET')).json();
    expect(snap.counters.lastReceiptNumber).toBe(`${s.prefix}000001`);
  });

  it('refuses what cannot be a valid sale, keeps it, and accepts it once it is fixed upstream', async () => {
    const s = await setup();
    const shiftId = newId();
    const early = sale(s, shiftId, 1); // before its shift was uploaded
    const wrongTotal = sale(s, shiftId, 2, { totalMinor: '400' });
    const wrongNumber = sale(s, shiftId, 3, { receiptNumber: 'MAIN-000003' });
    const otherRegister = sale(s, shiftId, 4, { receiptNumber: 'MAIN-R99-000004' });
    const unknown = sale(s, shiftId, 5);
    (unknown['lines'] as Rec[])[0]!['variantId'] = newId();
    const res = (
      await sync(s.token, 'POST', [
        early,
        openShift(s, shiftId),
        wrongTotal,
        wrongNumber,
        otherRegister,
        unknown,
      ])
    ).json();
    expect(res.results.map((r: Rec) => [r['status'], r['code']])).toEqual([
      ['refused', 'SHIFT_REQUIRED'],
      ['accepted', null],
      ['refused', 'TOTALS_MISMATCH'],
      ['refused', 'RECEIPT_NUMBER_INVALID'],
      ['refused', 'RECEIPT_NUMBER_INVALID'],
      ['refused', 'UNKNOWN_VARIANT'],
    ]);
    const kept = await owner.query(
      `select id, status, error_code from device_records where merchant_id = $1 and status = 'refused'`,
      [s.c.merchantId],
    );
    expect(kept.rows).toHaveLength(5);
    const open = await owner.query(
      `select record_id from device_exceptions where merchant_id = $1 and kind = 'refused' and resolved_at is null`,
      [s.c.merchantId],
    );
    expect(open.rows.map((r) => r.record_id)).toContain(early['id']);
    // Sent again now that its shift exists: accepted, and its refusal is settled.
    const retry = (await sync(s.token, 'POST', [early])).json();
    expect(retry.results[0]).toMatchObject({ status: 'accepted' });
    const settled = await owner.query(
      `select resolved_at from device_exceptions where record_id = $1 and kind = 'refused'`,
      [early['id']],
    );
    expect(settled.rows[0].resolved_at).not.toBeNull();
    // A number already used is refused (gap-free per device, unique per company).
    const twice = (await sync(s.token, 'POST', [sale(s, shiftId, 1)])).json();
    expect(twice.results[0]).toMatchObject({ status: 'refused', code: 'RECEIPT_NUMBER_TAKEN' });
  });

  it('accepts stock going negative and flags it, flags a wrong clock, and prints only on request', async () => {
    const s = await setup();
    await s.c.client.request('POST', '/manager/print-agents', {
      cookies: s.c.cookies,
      body: { name: 'Back office' },
    });
    const shiftId = newId();
    const cup = (n: number, extra: Rec = {}) =>
      sale(s, shiftId, n, {
        lines: [
          {
            variantId: s.cup,
            quantity: '1',
            listUnitPriceMinor: '1000',
            unitPriceMinor: '1000',
            priceOverrideReason: null,
            discount: null,
            grossMinor: '1000',
            lineDiscountMinor: '0',
            orderDiscountMinor: '0',
            netMinor: '1000',
          },
        ],
        subtotalMinor: '1000',
        lineDiscountsMinor: '0',
        totalMinor: '1000',
        payments: [
          {
            id: newId(),
            methodId: s.cash,
            amountMinor: '1000',
            tenderedMinor: '1000',
            changeMinor: '0',
            feeMinor: '0',
            reference: null,
          },
        ],
        ...extra,
      });
    const noStock = cup(1);
    const future = cup(2, { occurredAt: at(60), requestRemotePrint: true });
    const res = (await sync(s.token, 'POST', [openShift(s, shiftId), noStock, future])).json();
    expect(res.results.map((r: Rec) => [r['status'], r['clockSkew']])).toEqual([
      ['accepted', false],
      ['accepted', false],
      ['accepted', true],
    ]);
    const level = await owner.query(
      `select on_hand::text from stock_levels where variant_id = $1 and branch_id = $2`,
      [s.cup, s.c.main],
    );
    expect(level.rows[0].on_hand).toMatch(/^-2(\.0+)?$/);
    const exceptions = await owner.query(
      `select kind, record_id, details from device_exceptions where merchant_id = $1 order by kind, created_at`,
      [s.c.merchantId],
    );
    expect(exceptions.rows.map((e) => [e.kind, e.record_id])).toEqual([
      ['clock_skew', future['id']],
      ['negative_stock', noStock['id']],
      ['negative_stock', future['id']],
    ]);
    expect(exceptions.rows[1].details).toMatchObject({
      variantId: s.cup,
      receiptNumber: `${s.prefix}000001`,
    });
    const jobs = await owner.query(`select sale_id from print_jobs where merchant_id = $1`, [
      s.c.merchantId,
    ]);
    expect(jobs.rows.map((j) => j.sale_id)).toEqual([future['id']]);
    // A refund without a pay-back split takes the suggested one (all cash here).
    const back = (
      await sync(s.token, 'POST', [
        {
          kind: 'refund',
          id: newId(),
          occurredAt: at(-1),
          membershipId: s.cashierId,
          shiftId,
          saleId: noStock['id'],
          lines: [{ position: 0, quantity: '1' }],
          reason: 'changed_mind',
          note: null,
          payback: [],
          approval: { approverMembershipId: await ownerMembership(s), reasons: ['own_sale'] },
        },
      ])
    ).json();
    expect(back.results[0]).toMatchObject({ status: 'accepted', result: { totalMinor: '1000' } });
    expect(await drawerBalance(s.device.registerId)).toBe('1000');
  });

  it('refunds only the device’s own sales and refuses people without POS access', async () => {
    const s = await setup();
    const other = await register(s.c, s.c.main);
    const shiftA = newId();
    const theSale = sale(s, shiftA, 1);
    expect(
      (await sync(s.token, 'POST', [openShift(s, shiftA), theSale]))
        .json()
        .results.map((r: Rec) => r['status']),
    ).toEqual(['accepted', 'accepted']);
    // The device B shift needs another person (one open shift per person).
    const ownerId = await ownerMembership(s);
    const shiftB = newId();
    const res = (
      await sync(other.token, 'POST', [
        { ...openShift(s, shiftB), membershipId: ownerId },
        {
          kind: 'refund',
          id: newId(),
          occurredAt: at(-1),
          membershipId: ownerId,
          shiftId: shiftB,
          saleId: theSale['id'],
          lines: [{ position: 0, quantity: '1' }],
          reason: 'changed_mind',
          note: null,
          payback: [],
          approval: null,
        },
        // A shift of device A uploaded by device B.
        { ...sale(s, shiftA, 2), receiptNumber: `MAIN-${other.device.registerCode}-000002` },
      ])
    ).json();
    expect(res.results.map((r: Rec) => [r['status'], r['code']])).toEqual([
      ['accepted', null],
      ['refused', 'NOT_OWN_SALE'],
      ['refused', 'WRONG_DEVICE'],
    ]);
    // A person who may not use the POS at this branch.
    const elsewhere = await s.c.hire([{ roleId: s.c.roles.cashier, branchId: s.c.second }], 'pos');
    const m = await owner.query(
      `select m.id from memberships m join users u on u.id = m.user_id where u.email = $1`,
      [elsewhere.email],
    );
    const denied = (
      await sync(s.token, 'POST', [{ ...openShift(s), membershipId: m.rows[0].id }])
    ).json();
    expect(denied.results[0]).toMatchObject({ status: 'refused', code: 'MEMBER_NOT_ALLOWED' });
    // Malformed records are refused one by one.
    const bad = (
      await sync(s.token, 'POST', [{ kind: 'sale', id: newId(), occurredAt: 'x' }])
    ).json();
    expect(bad.results[0]).toMatchObject({ status: 'refused', code: 'VALIDATION_FAILED' });
  });

  it('answers 401 without a valid device token', async () => {
    const res = await sync('C'.repeat(43), 'POST', [
      { kind: 'sale', id: newId(), occurredAt: at(0) },
    ]);
    expect(res.statusCode).toBe(401);
  });
});

async function ownerMembership(s: Setup) {
  const r = await owner.query(`select id from memberships where merchant_id = $1 and is_owner`, [
    s.c.merchantId,
  ]);
  return r.rows[0].id as string;
}

describe('device exceptions for managers', () => {
  it('lists open exceptions with what happened, counts them on the dashboard, and resolves them', async () => {
    const s = await setup();
    const shiftId = newId();
    const bad = sale(s, shiftId, 9, { totalMinor: '1' });
    await sync(s.token, 'POST', [
      openShift(s, shiftId),
      bad,
      sale(s, shiftId, 1, { occurredAt: at(30) }),
    ]);
    const list = await s.c.client.request('GET', '/manager/device-exceptions', {
      cookies: s.c.cookies,
    });
    expect(list.statusCode).toBe(200);
    const items = list.json().exceptions as Rec[];
    expect(items.map((e) => e['kind']).sort()).toEqual(['clock_skew', 'refused']);
    const refused = items.find((e) => e['kind'] === 'refused')!;
    expect(refused).toMatchObject({
      recordId: bad['id'],
      recordKind: 'sale',
      registerCode: s.device.registerCode,
      details: { code: 'TOTALS_MISMATCH' },
      payload: expect.objectContaining({ receiptNumber: bad['receiptNumber'] }),
    });
    const controls = await s.c.client.request('GET', '/manager/merchant/controls', {
      cookies: s.c.cookies,
    });
    expect(controls.json().openDeviceExceptions).toBe(2);

    const resolve = await s.c.client.request(
      'POST',
      `/manager/device-exceptions/${refused['id']}/resolve`,
      { cookies: s.c.cookies, body: { note: 'Re-entered online' } },
    );
    expect(resolve.statusCode).toBe(204);
    const done = (
      await s.c.client.request('GET', '/manager/device-exceptions?status=resolved', {
        cookies: s.c.cookies,
      })
    ).json().exceptions;
    expect(done).toEqual([
      expect.objectContaining({ id: refused['id'], resolutionNote: 'Re-entered online' }),
    ]);
    expect(
      (
        await s.c.client.request('POST', `/manager/device-exceptions/${refused['id']}/resolve`, {
          cookies: s.c.cookies,
          body: { note: 'again' },
        })
      ).statusCode,
    ).toBe(409);
    // Cashiers do not see them.
    const cashier = await s.c.hire([{ roleId: s.c.roles.cashier, branchId: s.c.main }], 'pos');
    expect(
      (await s.c.client.request('GET', '/manager/device-exceptions', { cookies: cashier.cookies }))
        .statusCode,
    ).toBe(401);
  });
});
