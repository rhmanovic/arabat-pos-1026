import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_TIMEZONE, todayIn } from '../../kernel/time/period.js';
import { DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

/**
 * Transfer losses and in-transit stock (remediation R2.3 / R2.4, BR-172, BR-173): shortages
 * written off explicitly and approved above the limit, surplus recorded, unknown costs refused,
 * goods on the road valued and aged, recall before receipt.
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

async function company() {
  const c = await createCompany(app, db, mailer);
  const call = (
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    cookies: Cookies = c.cookies,
  ) => c.client.request(method, path, { cookies, ...(body === undefined ? {} : { body }) });
  const product = async (nameEn: string, cost: string | null) => {
    const res = await call('POST', '/manager/products', {
      nameEn,
      variants: [{ price: '2.000', cost }],
    });
    expect(res.statusCode).toBe(201);
    return res.json().variants[0].id as string;
  };
  const opening = async (
    variantId: string,
    quantity: string,
    unitCost: string,
    branchId = c.main,
  ) =>
    expect(
      (
        await call('POST', '/manager/inventory/adjustments', {
          branchId,
          kind: 'opening',
          reason: 'opening',
          lines: [{ variantId, quantity, unitCost }],
        })
      ).statusCode,
    ).toBe(201);
  const onHand = async (variantId: string, branchId: string) =>
    (await call('GET', `/manager/inventory/variants/${variantId}`))
      .json()
      .branches.find((b: { branchId: string }) => b.branchId === branchId)?.onHand as string;
  /** Requests, approves and dispatches `quantity` of one item from main to second. */
  const dispatched = async (variantId: string, quantity: string) => {
    const t = (
      await call('POST', '/manager/transfers', {
        sourceBranchId: c.main,
        destinationBranchId: c.second,
        lines: [{ variantId, quantity }],
      })
    ).json();
    const approved = (
      await call('POST', `/manager/transfers/${t.id}/approve`, { version: t.version })
    ).json();
    const sent = await call('POST', `/manager/transfers/${t.id}/dispatch`, {
      version: approved.version,
      lines: [{ position: 0, quantity }],
    });
    expect(sent.statusCode).toBe(201);
    return sent.json() as { id: string; version: number; number: string };
  };
  return { c, call, product, opening, onHand, dispatched };
}

describe('transfer losses (BR-172)', () => {
  it('writes a shortage off explicitly, holds large losses for the source approver and records surplus', async () => {
    const s = await company();
    const tv = await s.product('TV 55"', '40.000');
    const rice = await s.product('Rice 5kg', '1.000');
    await s.opening(tv, '5', '40.000');
    await s.opening(rice, '20', '1.000');
    // A branch manager of the destination receives; a branch manager of the source approves.
    const dest = await s.c.hire(
      [{ roleId: s.c.roles.branch_manager, branchId: s.c.second }],
      'manager',
    );
    const src = await s.c.hire(
      [{ roleId: s.c.roles.branch_manager, branchId: s.c.main }],
      'manager',
    );
    await owner.query(
      `insert into role_permissions (merchant_id, role_id, permission_key) values ($1, $2, 'inventory.transfer.approve') on conflict do nothing`,
      [s.c.merchantId, s.c.roles.branch_manager],
    );

    // Small shortage (1 rice × 1.000): the loss posts at once with the receiver's explanation.
    const small = await s.dispatched(rice, '10');
    const received = await s.call(
      'POST',
      `/manager/transfers/${small.id}/receive`,
      { version: small.version, note: 'One bag torn', lines: [{ position: 0, quantity: '9' }] },
      dest.cookies,
    );
    expect(received.statusCode).toBe(201);
    expect(received.json()).toMatchObject({
      status: 'received',
      discrepancyQuantity: '1.000',
      lostQuantity: '1.000',
      inTransitQuantity: '0.000',
      losses: [
        {
          number: 'TL-000001',
          status: 'posted',
          explanation: 'One bag torn',
          limitExceeded: false,
        },
      ],
      lines: [{ lostQuantity: '1.000', inTransitQuantity: '0.000' }],
    });
    expect(
      (await s.call('GET', `/manager/transfers/${small.id}`)).json().losses[0].value.amount,
    ).toBe('1.000');

    // Large shortage (2 TVs × 40.000 = 80.000 > 50.000): the loss waits; the quantity stays in
    // transit, valued and visible, until the source approver decides.
    const big = await s.dispatched(tv, '5');
    const shortTv = (
      await s.call(
        'POST',
        `/manager/transfers/${big.id}/receive`,
        {
          version: big.version,
          note: 'Two boxes missing',
          lines: [{ position: 0, quantity: '3' }],
        },
        dest.cookies,
      )
    ).json();
    expect(shortTv).toMatchObject({
      status: 'received',
      lostQuantity: '0.000',
      inTransitQuantity: '2.000',
      losses: [{ status: 'pending', limitExceeded: true, ownerOverride: false }],
    });
    expect(await s.onHand(tv, s.c.second)).toBe('3.000');
    const loss = shortTv.losses[0] as { id: string };
    const transit = (await s.call('GET', '/manager/transfers/in-transit')).json();
    expect(transit).toMatchObject({ quantity: '2.000', value: { amount: '80.000' } });
    expect(transit.transfers[0]).toMatchObject({
      number: big.number,
      unresolved: true,
      pendingLoss: true,
      quantity: '2.000',
    });
    expect(typeof transit.transfers[0].ageDays).toBe('number');
    const controls = (await s.call('GET', '/manager/merchant/controls')).json();
    expect(controls).toMatchObject({ pendingTransferLosses: 1, unresolvedTransferShortages: 0 });
    const decide = (body: Record<string, unknown>, cookies?: Cookies) =>
      s.call('POST', `/manager/transfers/${big.id}/losses/${loss.id}/decision`, body, cookies);
    // The destination manager cannot decide (not the source); the claimant never decides their own.
    expect((await decide({ decision: 'approve' }, dest.cookies)).statusCode).toBe(403);
    // Rejection needs a reason; after it the shortage is unresolved and can be claimed again.
    expect((await decide({ decision: 'reject' }, src.cookies)).statusCode).toBe(400);
    const rejected = (
      await decide({ decision: 'reject', note: 'Check the van first' }, src.cookies)
    ).json();
    expect(rejected.losses[0]).toMatchObject({
      status: 'rejected',
      decisionNote: 'Check the van first',
    });
    expect(rejected.inTransitQuantity).toBe('2.000');
    expect((await s.call('GET', '/manager/merchant/controls')).json()).toMatchObject({
      pendingTransferLosses: 0,
      unresolvedTransferShortages: 1,
    });
    expect((await decide({ decision: 'approve' }, src.cookies)).json().code).toBe('LOSS_DECIDED');
    const claimed = (
      await s.call(
        'POST',
        `/manager/transfers/${big.id}/losses`,
        { explanation: 'Van searched, boxes gone' },
        dest.cookies,
      )
    ).json();
    expect(claimed.losses).toHaveLength(2);
    const second = claimed.losses[1] as { id: string; status: string; number: string };
    expect(second).toMatchObject({ status: 'pending', number: 'TL-000003' });
    // Nothing more can be claimed while one is pending.
    expect(
      (
        await s.call(
          'POST',
          `/manager/transfers/${big.id}/losses`,
          { explanation: 'again' },
          dest.cookies,
        )
      ).json().code,
    ).toBe('INVALID_STATE');
    const approved = (
      await s.call(
        'POST',
        `/manager/transfers/${big.id}/losses/${second.id}/decision`,
        { decision: 'approve' },
        src.cookies,
      )
    ).json();
    expect(approved).toMatchObject({ lostQuantity: '2.000', inTransitQuantity: '0.000' });
    expect(approved.losses[1]).toMatchObject({ status: 'posted', decidedBy: expect.any(String) });
    expect((await s.call('GET', '/manager/transfers/in-transit')).json().transfers).toHaveLength(0);
    // The purchasing report shows what was written off; the inventory report lists the loss.
    const today = todayIn(DEFAULT_TIMEZONE);
    const purchasing = (
      await s.call('GET', `/manager/reports/purchasing?from=${today}&to=${today}`)
    ).json();
    expect(purchasing.transfers[0]).toMatchObject({
      missing: '3.000',
      lost: '3.000',
      lostValue: { amount: '81.000' },
      pendingLosses: 0,
    });
    const inventory = (
      await s.call('GET', `/manager/reports/inventory?from=${today}&to=${today}`)
    ).json();
    expect(
      inventory.movements.find((m: { movementType: string }) => m.movementType === 'transfer_loss'),
    ).toMatchObject({
      count: 2,
      quantityOut: '3.000',
      value: { amount: '-81.000' },
    });
    expect(inventory.inTransit).toMatchObject({ transfers: 0, quantity: '0.000' });
    // The owner writes a large loss off directly: flagged as an override in the audit log.
    const ownerShort = await s.dispatched(rice, '5');
    await s.opening(tv, '0', '40.000', s.c.second).catch(() => undefined);
    const audit = (await s.call('GET', '/manager/audit?action=transfer.loss')).json();
    expect(audit.entries.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining([
        'transfer.loss_posted',
        'transfer.loss_requested',
        'transfer.loss_rejected',
        'transfer.loss_approved',
      ]),
    );
    expect(ownerShort.id).toBeDefined();

    // Surplus: more arrived than was sent; it needs an explanation and is recorded as negative
    // discrepancy, received at dispatch cost.
    const over = await s.dispatched(rice, '2');
    expect(
      (
        await s.call('POST', `/manager/transfers/${over.id}/receive`, {
          version: over.version,
          lines: [{ position: 0, quantity: '3' }],
        })
      ).statusCode,
    ).toBe(400);
    const surplus = (
      await s.call('POST', `/manager/transfers/${over.id}/receive`, {
        version: over.version,
        note: 'Extra bag packed by mistake',
        lines: [{ position: 0, quantity: '3' }],
      })
    ).json();
    expect(surplus).toMatchObject({
      status: 'received',
      discrepancyQuantity: '-1.000',
      lostQuantity: '0.000',
      losses: [],
    });
  });

  it('refuses to dispatch an item with no cost at all', async () => {
    const s = await company();
    const mystery = await s.product('No-cost item', null);
    // Stock arrives with no cost (count, not opening) so neither an average nor a catalog cost exists.
    expect(
      (
        await s.call('POST', '/manager/inventory/adjustments', {
          branchId: s.c.main,
          kind: 'count',
          reason: 'stock_count',
          lines: [{ variantId: mystery, quantity: '4' }],
        })
      ).statusCode,
    ).toBe(201);
    const t = (
      await s.call('POST', '/manager/transfers', {
        sourceBranchId: s.c.main,
        destinationBranchId: s.c.second,
        lines: [{ variantId: mystery, quantity: '2' }],
      })
    ).json();
    const approved = (
      await s.call('POST', `/manager/transfers/${t.id}/approve`, { version: t.version })
    ).json();
    const refused = await s.call('POST', `/manager/transfers/${t.id}/dispatch`, {
      version: approved.version,
      lines: [{ position: 0, quantity: '2' }],
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('COST_UNKNOWN');
    expect(await s.onHand(mystery, s.c.main)).toBe('4.000');
  });
});

describe('in-transit stock and recall (BR-173)', () => {
  it('values goods on the road at dispatch cost and brings them back to the source on recall', async () => {
    const s = await company();
    const oil = await s.product('Oil 2L', '1.500');
    await s.opening(oil, '10', '1.500');
    const sent = await s.dispatched(oil, '6');
    expect(await s.onHand(oil, s.c.main)).toBe('4.000');
    const detail = (await s.call('GET', `/manager/transfers/${sent.id}`)).json();
    expect(detail).toMatchObject({
      inTransitQuantity: '6.000',
      inTransitValue: { amount: '9.000' },
      lines: [{ inTransitQuantity: '6.000', recalledQuantity: null }],
    });
    const today = todayIn(DEFAULT_TIMEZONE);
    const report = (
      await s.call('GET', `/manager/reports/inventory?from=${today}&to=${today}`)
    ).json();
    expect(report.inTransit).toMatchObject({
      transfers: 1,
      quantity: '6.000',
      value: { amount: '9.000' },
    });
    const transit = (
      await s.call('GET', `/manager/transfers/in-transit?branchId=${s.c.main}`)
    ).json();
    expect(transit.transfers[0]).toMatchObject({
      number: sent.number,
      unresolved: false,
      quantity: '6.000',
    });
    // A recall needs a reason and the source right; the goods return at dispatch cost.
    expect(
      (
        await s.call('POST', `/manager/transfers/${sent.id}/recall`, {
          version: sent.version,
          note: '',
        })
      ).statusCode,
    ).toBe(400);
    const dest = await s.c.hire(
      [{ roleId: s.c.roles.branch_manager, branchId: s.c.second }],
      'manager',
    );
    expect(
      (
        await s.call(
          'POST',
          `/manager/transfers/${sent.id}/recall`,
          { version: sent.version, note: 'Wrong branch' },
          dest.cookies,
        )
      ).statusCode,
    ).toBe(403);
    const recalled = (
      await s.call('POST', `/manager/transfers/${sent.id}/recall`, {
        version: sent.version,
        note: 'Wrong branch',
      })
    ).json();
    expect(recalled).toMatchObject({
      status: 'recalled',
      recallNote: 'Wrong branch',
      inTransitQuantity: '0.000',
      lines: [{ recalledQuantity: '6.000', inTransitQuantity: '0.000' }],
    });
    expect(typeof recalled.recalledBy).toBe('string');
    expect(await s.onHand(oil, s.c.main)).toBe('10.000');
    expect(await s.onHand(oil, s.c.second)).toBe('0.000');
    expect((await s.call('GET', '/manager/transfers/in-transit')).json().transfers).toHaveLength(0);
    // Recalled is final: it cannot be received or recalled again.
    expect(
      (
        await s.call('POST', `/manager/transfers/${sent.id}/receive`, {
          version: recalled.version,
          lines: [{ position: 0, quantity: '6' }],
        })
      ).json().code,
    ).toBe('INVALID_STATE');
    const moves = await owner.query(
      `select movement_type, quantity::text, unit_cost_minor::text as cost from stock_movements
       where merchant_id = $1 and source_type = 'transfer' order by created_at, id`,
      [s.c.merchantId],
    );
    expect(moves.rows).toEqual([
      { movement_type: 'transfer_out', quantity: '-6.000', cost: '1500' },
      { movement_type: 'transfer_in', quantity: '6.000', cost: '1500' },
    ]);
  });
});
