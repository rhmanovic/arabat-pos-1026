import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../kernel/ids.js';
import { DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

/**
 * Stock integrity controls (remediation R2.1 / R2.2 / R2.5, BR-169 to BR-171): adjustment
 * approvals above the company limit, document numbers, counts that acknowledge movements,
 * and guards on master data that would hide a balance.
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
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    path: string,
    body?: unknown,
    cookies: Cookies = c.cookies,
  ) => c.client.request(method, path, { cookies, ...(body === undefined ? {} : { body }) });
  const product = async (nameEn: string, cost = '1.000') => {
    const res = await call('POST', '/manager/products', {
      nameEn,
      variants: [{ sku: `S-${Math.random().toString(36).slice(2, 7)}`, price: '2.000', cost }],
    });
    expect(res.statusCode).toBe(201);
    const p = res.json();
    return {
      productId: p.id as string,
      variantId: p.variants[0].id as string,
      sku: p.variants[0].sku as string,
      version: p.version as number,
    };
  };
  const adjust = (body: Record<string, unknown>, cookies?: Cookies) =>
    call(
      'POST',
      '/manager/inventory/adjustments',
      { branchId: c.main, idempotencyKey: newId(), ...body },
      cookies,
    );
  const onHand = async (variantId: string, branchId = c.main) =>
    (await call('GET', `/manager/inventory/variants/${variantId}`))
      .json()
      .branches.find((b: { branchId: string }) => b.branchId === branchId)?.onHand as string;
  const bm = await c.hire([{ roleId: c.roles.branch_manager, branchId: c.main }], 'manager');
  return { c, call, product, adjust, onHand, bm };
}

describe('stock adjustment approvals (BR-169)', () => {
  it('numbers documents, holds documents above the limit for a second person and lets the owner override', async () => {
    const s = await company();
    const { variantId } = await s.product('Rice 5kg');
    // Opening stock is the initial load: never held, numbered first.
    const opening = await s.adjust({
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId, quantity: '100', unitCost: '1.000' }],
    });
    expect(opening.statusCode).toBe(201);
    expect(opening.json()).toMatchObject({
      number: 'ADJ-000001',
      status: 'posted',
      value: { amount: '100.000' },
      limitExceeded: false,
    });
    // 10 × 1.000 = 10.000 KWD at cost: within the 50.000 default, posted at once.
    const small = await s.adjust(
      { kind: 'decrease', reason: 'damaged', lines: [{ variantId, quantity: '10' }] },
      s.bm.cookies,
    );
    expect(small.statusCode).toBe(201);
    expect(small.json()).toMatchObject({
      number: 'ADJ-000002',
      status: 'posted',
      value: { amount: '10.000' },
    });
    expect(await s.onHand(variantId)).toBe('90.000');
    // 60 × 1.000 = 60.000 KWD: waits for a second person; nothing moves.
    const held = await s.adjust(
      { kind: 'decrease', reason: 'theft', lines: [{ variantId, quantity: '60' }] },
      s.bm.cookies,
    );
    expect(held.statusCode).toBe(201);
    expect(held.json()).toMatchObject({
      number: 'ADJ-000003',
      status: 'pending',
      limitExceeded: true,
      ownerOverride: false,
      value: { amount: '60.000' },
      lines: [{ previousOnHand: '90.000', delta: '-60.000', newOnHand: '30.000' }],
    });
    expect(await s.onHand(variantId)).toBe('90.000');
    const pendingId = held.json().id as string;
    const pendingList = (
      await s.call('GET', '/manager/inventory/adjustments?status=pending')
    ).json();
    expect(pendingList.adjustments.map((a: { id: string }) => a.id)).toEqual([pendingId]);
    expect((await s.call('GET', '/manager/merchant/controls')).json().pendingAdjustments).toBe(1);
    const movements = (
      await s.call('GET', `/manager/inventory/movements?variantId=${variantId}`)
    ).json();
    expect(movements.total).toBe(2);

    const decide = (id: string, body: Record<string, unknown>, cookies?: Cookies) =>
      s.call('POST', `/manager/inventory/adjustments/${id}/decision`, body, cookies);
    // Nobody approves their own document; a cashier has no say at all.
    expect((await decide(pendingId, { decision: 'approve' }, s.bm.cookies)).statusCode).toBe(403);
    const cashier = await s.c.hire([{ roleId: s.c.roles.cashier, branchId: s.c.main }], 'pos');
    expect([401, 403]).toContain(
      (await decide(pendingId, { decision: 'approve' }, cashier.cookies)).statusCode,
    );
    // The owner approves: the movements post now, attributed to the requester.
    const approved = await decide(pendingId, { decision: 'approve' });
    expect(approved.statusCode).toBe(201);
    expect(approved.json()).toMatchObject({
      status: 'posted',
      decidedBy: expect.any(String),
      lines: [{ previousOnHand: '90.000', delta: '-60.000', newOnHand: '30.000' }],
    });
    expect(await s.onHand(variantId)).toBe('30.000');
    expect((await decide(pendingId, { decision: 'reject', note: 'x' })).json().code).toBe(
      'ADJUSTMENT_DECIDED',
    );
    const posted = (
      await s.call('GET', `/manager/inventory/movements?variantId=${variantId}`)
    ).json();
    expect(posted.total).toBe(3);
    expect(posted.movements[0].createdBy.fullName).toBe(
      (await s.call('GET', '/manager/employees'))
        .json()
        .employees.find((e: { email: string }) => e.email === s.bm.email).fullName,
    );

    // A second request (55 found × 1.000 average) is withdrawn by its requester; a third is
    // rejected with a reason.
    const withdrawn = (
      await s.adjust(
        { kind: 'increase', reason: 'found', lines: [{ variantId, quantity: '55' }] },
        s.bm.cookies,
      )
    ).json();
    expect(withdrawn.status).toBe('pending');
    expect(
      (await s.call('POST', `/manager/inventory/adjustments/${withdrawn.id}/withdraw`, {}))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await s.call(
          'POST',
          `/manager/inventory/adjustments/${withdrawn.id}/withdraw`,
          {},
          s.bm.cookies,
        )
      ).json().status,
    ).toBe('withdrawn');
    const rejected = (
      await s.adjust(
        { kind: 'increase', reason: 'found', lines: [{ variantId, quantity: '56' }] },
        s.bm.cookies,
      )
    ).json();
    expect((await decide(rejected.id, { decision: 'reject' })).statusCode).toBe(400);
    expect(
      (await decide(rejected.id, { decision: 'reject', note: 'Recount first' })).json(),
    ).toMatchObject({ status: 'rejected', decisionNote: 'Recount first' });
    expect(await s.onHand(variantId)).toBe('30.000');

    // The owner posts above the limit directly; the exception is recorded.
    const override = await s.adjust({
      kind: 'increase',
      reason: 'found',
      lines: [{ variantId, quantity: '60' }],
    });
    expect(override.json()).toMatchObject({
      status: 'posted',
      limitExceeded: true,
      ownerOverride: true,
      value: { amount: '60.000' },
    });
    expect(await s.onHand(variantId)).toBe('90.000');
    const audit = (await s.call('GET', '/manager/audit?action=inventory.adjust')).json();
    const actions = audit.entries.map((e: { action: string }) => e.action);
    for (const a of [
      'inventory.adjustment_requested',
      'inventory.adjustment_approved',
      'inventory.adjustment_withdrawn',
      'inventory.adjustment_rejected',
    ])
      expect(actions).toContain(a);
    expect(
      audit.entries.find(
        (e: { action: string; details: { ownerOverride?: boolean } }) =>
          e.action === 'inventory.adjusted' && e.details.ownerOverride,
      ),
    ).toBeDefined();

    // The limit is company policy: at 5.000 KWD a 6 × 1.000 decrease waits too; an increase by
    // someone without the price right is valued at the current average, never a typed cost.
    const settings = (await s.call('GET', '/manager/sales-settings')).json();
    expect(settings.adjustmentApprovalLimit.amount).toBe('50.000');
    expect(
      (
        await s.call('PUT', '/manager/sales-settings', {
          maxDiscountPercent: settings.maxDiscountPercent,
          refundWindowDays: settings.refundWindowDays,
          refundApprovalLimit: settings.refundApprovalLimit.amount,
          blindCashCount: settings.blindCashCount,
          cashOutOtherLimit: settings.cashOutOtherLimit.amount,
          cashOutOtherShiftLimit: settings.cashOutOtherShiftLimit.amount,
          maxRegisterTolerance: settings.maxRegisterTolerance.amount,
          expenseApprovalLimit: settings.expenseApprovalLimit.amount,
          supplierPaymentApprovalLimit: settings.supplierPaymentApprovalLimit.amount,
          adjustmentApprovalLimit: '5.000',
          version: settings.version,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await s.call('GET', '/manager/inventory/settings')).json().adjustmentApprovalLimit.amount,
    ).toBe('5.000');
    const sixAtAverage = await s.adjust(
      { kind: 'increase', reason: 'found', lines: [{ variantId, quantity: '6' }] },
      s.bm.cookies,
    );
    expect(sixAtAverage.json()).toMatchObject({ status: 'pending', value: { amount: '6.000' } });
    expect(
      (
        await s.adjust(
          {
            kind: 'increase',
            reason: 'found',
            lines: [{ variantId, quantity: '1', unitCost: '9.000' }],
          },
          s.bm.cookies,
        )
      ).statusCode,
    ).toBe(403);
  });
});

describe('blind counts with movement acknowledgement (BR-170)', () => {
  it('reports stock that moved since the sheet was started until the counter confirms', async () => {
    const s = await company();
    const { variantId } = await s.product('Sugar 1kg', '0.300');
    await s.adjust({
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId, quantity: '50', unitCost: '0.300' }],
    });
    const pause = () => new Promise((resolve) => setTimeout(resolve, 60));
    await pause();
    const startedAt = new Date().toISOString();
    await pause();
    // A sale-like decrease lands while the branch manager is counting.
    await s.adjust({ kind: 'decrease', reason: 'damaged', lines: [{ variantId, quantity: '2' }] });
    const count = (extra: Record<string, unknown>) =>
      s.adjust(
        { kind: 'count', reason: 'stock_count', lines: [{ variantId, quantity: '47' }], ...extra },
        s.bm.cookies,
      );
    const moved = await count({ startedAt });
    expect(moved.statusCode).toBe(409);
    expect(moved.json().code).toBe('STOCK_MOVED_SINCE_COUNT');
    expect(moved.json().issues[0]).toMatchObject({ path: 'lines.0', code: 'moved_since_count' });
    expect(moved.json().issues[0].message).toContain('net=-2.000');
    expect(await s.onHand(variantId)).toBe('48.000');
    // Acknowledged: the count posts against the balance as it is now (48 → 47).
    const confirmed = await count({ startedAt, acknowledgeMovements: true });
    expect(confirmed.statusCode).toBe(201);
    expect(confirmed.json()).toMatchObject({
      status: 'posted',
      movementsAcknowledged: true,
      lines: [{ previousOnHand: '48.000', delta: '-1.000', newOnHand: '47.000' }],
    });
    // Without a start time the count is an ordinary document; the policy is readable by
    // anyone who may read stock.
    expect(
      (await s.call('GET', '/manager/inventory/settings', undefined, s.bm.cookies)).json()
        .blindStockCount,
    ).toBe(true);
  });
});

describe('guards on master data that would hide a balance (BR-171)', () => {
  it('refuses to untrack, archive or deactivate while stock or cash remains, and allows it once settled', async () => {
    const s = await company();
    const p = await s.product('Oil 2L', '1.500');
    await s.adjust({
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId: p.variantId, quantity: '4', unitCost: '1.500' }],
    });
    const product = async () => (await s.call('GET', `/manager/products/${p.productId}`)).json();
    const patch = (body: Record<string, unknown>) =>
      s.call('PATCH', `/manager/products/${p.productId}`, body);
    const base = async () => {
      const current = await product();
      return {
        nameEn: current.nameEn,
        variants: [{ id: p.variantId, sku: p.sku, price: '2.000', cost: '1.500' }],
        version: current.version,
      };
    };
    // Tracking off, service, archive, dropping the variant: all refused while 4 are on hand.
    for (const change of [{ trackInventory: false }, { type: 'service', trackInventory: false }]) {
      const res = await patch({ ...(await base()), ...change });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('STOCK_ON_HAND');
      expect(res.json().detail).toContain('4.000');
    }
    const dropped = await patch({
      ...(await base()),
      variants: [{ sku: 'NEW-1', price: '2.000', cost: '1.500' }],
    });
    expect(dropped.json().code).toBe('STOCK_ON_HAND');
    const archive = () =>
      s.call('POST', `/manager/products/${p.productId}/status`, { status: 'archived' });
    expect((await archive()).json().code).toBe('STOCK_ON_HAND');
    expect((await product()).status).toBe('active');
    // Written off to zero: the product can be archived, and once archived it can still be
    // counted or written off (never increased).
    await s.adjust({
      kind: 'decrease',
      reason: 'expired',
      lines: [{ variantId: p.variantId, quantity: '4' }],
    });
    expect((await archive()).json().status).toBe('archived');
    expect(
      (
        await s.adjust({
          kind: 'count',
          reason: 'stock_count',
          lines: [{ variantId: p.variantId, quantity: '0' }],
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await s.adjust({
          kind: 'increase',
          reason: 'found',
          lines: [{ variantId: p.variantId, quantity: '1' }],
        })
      ).json().code,
    ).toBe('NOT_STOCK_TRACKED');

    // A branch with stock cannot be deactivated; neither with cash; then it can.
    const q = await s.product('Flour 1kg', '0.500');
    await s.adjust({
      branchId: s.c.second,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId: q.variantId, quantity: '3', unitCost: '0.500' }],
    });
    const deactivate = () =>
      s.call('POST', `/manager/branches/${s.c.second}/status`, { status: 'inactive' });
    let refused = await deactivate();
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('BRANCH_IN_USE');
    expect(refused.json().issues.map((i: { path: string }) => i.path)).toEqual(['stock']);
    await s.adjust({
      branchId: s.c.second,
      kind: 'decrease',
      reason: 'lost',
      lines: [{ variantId: q.variantId, quantity: '3' }],
    });
    await s.c.countTreasury(s.c.second, '10.000');
    refused = await deactivate();
    expect(refused.json().issues.map((i: { path: string }) => i.path)).toEqual(['cash']);
    // Cash sent back to the main branch is in transit until received: still in use.
    await s.c.countTreasury(s.c.main, '0.000');
    const sent = (
      await s.call('POST', '/manager/cash/branch-transfers', {
        fromBranchId: s.c.second,
        toBranchId: s.c.main,
        amount: '10.000',
        idempotencyKey: newId(),
      })
    ).json();
    expect(sent.status).toBe('in_transit');
    refused = await deactivate();
    expect(refused.json().issues.map((i: { path: string }) => i.path)).toEqual(['cashTransfers']);
    expect(
      (
        await s.call('POST', `/manager/cash/branch-transfers/${sent.id}/receive`, {
          receivedAmount: '10.000',
          version: sent.version,
        })
      ).statusCode,
    ).toBe(201);
    expect((await deactivate()).json().status).toBe('inactive');
  });
});
