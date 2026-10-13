import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../database/database.service.js';
import { newId } from '../../kernel/ids.js';
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

type Co = Awaited<ReturnType<typeof createCompany>>;
type Cookies = Co['cookies'];

async function setup() {
  const c = await createCompany(app, db, mailer);
  const product = async (nameEn: string, cost = '1.000') =>
    (
      await c.client.request('POST', '/manager/products', {
        cookies: c.cookies,
        body: { nameEn, variants: [{ price: '2.000', cost }] },
      })
    ).json().variants[0].id as string;
  const rice = await product('Rice 5kg');
  const oil = await product('Oil 1L');
  const supplier = (
    await c.client.request('POST', '/manager/suppliers', {
      cookies: c.cookies,
      body: {
        code: 'SUP1',
        nameEn: 'Gulf Foods',
        contactName: 'Ali',
        phone: '+965 1234 5678',
        email: 'Orders@Gulf.example',
      },
    })
  ).json();
  return { c, rice, oil, supplierId: supplier.id as string };
}
type S = Awaited<ReturnType<typeof setup>>;

const req = (
  s: S,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
  cookies: Cookies = s.c.cookies,
) => s.c.client.request(method, path, { cookies, ...(body === undefined ? {} : { body }) });

async function onHand(s: S, variantId: string, branchId: string) {
  const r = await req(s, 'GET', `/manager/inventory/variants/${variantId}`);
  return r.json().branches.find((b: { branchId: string }) => b.branchId === branchId)
    ?.onHand as string;
}

async function approvedOrder(
  s: S,
  lines = [{ variantId: s.rice, quantity: '10', unitCost: '1.500' }],
) {
  const po = (
    await req(s, 'POST', '/manager/purchase-orders', {
      supplierId: s.supplierId,
      branchId: s.c.main,
      lines,
    })
  ).json();
  const submitted = (
    await req(s, 'POST', `/manager/purchase-orders/${po.id}/submit`, { version: po.version })
  ).json();
  const approved = (
    await req(s, 'POST', `/manager/purchase-orders/${po.id}/approve`, {
      version: submitted.version,
    })
  ).json();
  return approved;
}

describe('suppliers', () => {
  it('creates, edits, deactivates suppliers and shows their purchase history', async () => {
    const s = await setup();
    const list = (await req(s, 'GET', '/manager/suppliers')).json().suppliers;
    expect(list[0]).toMatchObject({
      code: 'SUP1',
      email: 'orders@gulf.example',
      status: 'active',
      orderCount: 0,
    });
    const dup = await req(s, 'POST', '/manager/suppliers', { code: 'sup1', nameEn: 'Copy' });
    expect(dup.json().code).toBe('DUPLICATE_CODE');
    const po = await approvedOrder(s);
    await req(s, 'POST', `/manager/purchase-orders/${po.id}/receipts`, {
      idempotencyKey: newId(),
      lines: [{ position: 0, quantity: '4' }],
    });
    const after = (await req(s, 'GET', '/manager/suppliers')).json().suppliers[0];
    expect(after).toMatchObject({ orderCount: 1, purchasedTotal: { amount: '6.000' } });
    const history = (
      await req(s, 'GET', `/manager/purchase-orders?supplierId=${s.supplierId}`)
    ).json();
    expect(history.orders.map((o: { number: string }) => o.number)).toEqual(['PO-000001']);
    const inactive = await req(s, 'PATCH', `/manager/suppliers/${s.supplierId}`, {
      ...after,
      status: 'inactive',
      version: after.version,
    });
    expect(inactive.json().status).toBe('inactive');
    const blocked = await req(s, 'POST', '/manager/purchase-orders', {
      supplierId: s.supplierId,
      branchId: s.c.main,
      lines: [{ variantId: s.rice, quantity: '1', unitCost: '1' }],
    });
    expect(blocked.json().code).toBe('SUPPLIER_INACTIVE');
  });
});

describe('purchase orders', () => {
  it('runs draft → submitted → approved → partial → full receipt with exact stock and average cost', async () => {
    const s = await setup();
    const po = (
      await req(s, 'POST', '/manager/purchase-orders', {
        supplierId: s.supplierId,
        branchId: s.c.main,
        expectedDate: '2026-11-01',
        lines: [
          { variantId: s.rice, quantity: '10', unitCost: '1.500' },
          { variantId: s.oil, quantity: '2.5', unitCost: '0.333' },
        ],
      })
    ).json();
    expect(po).toMatchObject({ number: 'PO-000001', status: 'draft', total: { amount: '15.833' } });
    // Receiving a draft is refused; edits are allowed only as a draft.
    expect(
      (
        await req(s, 'POST', `/manager/purchase-orders/${po.id}/receipts`, {
          idempotencyKey: newId(),
          lines: [{ position: 0, quantity: '1' }],
        })
      ).json().code,
    ).toBe('INVALID_STATE');
    const edited = (
      await req(s, 'PATCH', `/manager/purchase-orders/${po.id}`, {
        supplierId: s.supplierId,
        branchId: s.c.main,
        lines: [
          { variantId: s.rice, quantity: '10', unitCost: '1.500' },
          { variantId: s.oil, quantity: '3', unitCost: '0.333' },
        ],
        version: po.version,
      })
    ).json();
    expect(edited.total.amount).toBe('15.999');
    const submitted = (
      await req(s, 'POST', `/manager/purchase-orders/${po.id}/submit`, { version: edited.version })
    ).json();
    expect(submitted.status).toBe('submitted');
    expect(
      (
        await req(s, 'PATCH', `/manager/purchase-orders/${po.id}`, {
          supplierId: s.supplierId,
          branchId: s.c.main,
          lines: [{ variantId: s.rice, quantity: '1', unitCost: '1' }],
          version: submitted.version,
        })
      ).json().code,
    ).toBe('INVALID_STATE');
    const approved = (
      await req(s, 'POST', `/manager/purchase-orders/${po.id}/approve`, {
        version: submitted.version,
      })
    ).json();
    expect(approved).toMatchObject({ status: 'approved', approvedBy: expect.any(String) });

    // Opening stock 10 @ 1.000, then receive 4 @ 1.500 → average (10 + 6) / 14 = 1.143
    await req(s, 'POST', '/manager/inventory/adjustments', {
      branchId: s.c.main,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId: s.rice, quantity: '10', unitCost: '1.000' }],
    });
    const first = (
      await req(s, 'POST', `/manager/purchase-orders/${po.id}/receipts`, {
        idempotencyKey: newId(),
        supplierReference: 'INV-77',
        lines: [{ position: 0, quantity: '4' }],
      })
    ).json();
    expect(first.status).toBe('partially_received');
    expect(first.lines[0]).toMatchObject({ receivedQuantity: '4.000', remainingQuantity: '6.000' });
    expect(await onHand(s, s.rice, s.c.main)).toBe('14.000');
    const level = (
      await req(s, 'GET', `/manager/inventory/levels?branchId=${s.c.main}&q=rice`)
    ).json().levels[0];
    expect(level.avgCost.amount).toBe('1.143');

    // Over-receiving is refused; the remaining quantities complete the order.
    expect(
      (
        await req(s, 'POST', `/manager/purchase-orders/${po.id}/receipts`, {
          idempotencyKey: newId(),
          lines: [{ position: 0, quantity: '6.001' }],
        })
      ).json().code,
    ).toBe('RECEIVE_EXCEEDS_ORDER');
    const done = (
      await req(s, 'POST', `/manager/purchase-orders/${po.id}/receipts`, {
        idempotencyKey: newId(),
        lines: [
          { position: 0, quantity: '6' },
          { position: 1, quantity: '3' },
        ],
      })
    ).json();
    expect(done).toMatchObject({ status: 'received', receivedValue: { amount: '15.999' } });
    expect(done.receipts.map((r: { number: string }) => r.number)).toEqual([
      'GR-000001',
      'GR-000002',
    ]);
    expect(await onHand(s, s.rice, s.c.main)).toBe('20.000');
    expect(await onHand(s, s.oil, s.c.main)).toBe('3.000');
    const moves = await owner.query(
      `select count(*)::int as n from stock_movements where merchant_id = $1 and movement_type = 'purchase_receipt'`,
      [s.c.merchantId],
    );
    expect(moves.rows[0].n).toBe(3);
    // Final orders cannot change.
    expect(
      (
        await req(s, 'POST', `/manager/purchase-orders/${po.id}/cancel`, { version: done.version })
      ).json().code,
    ).toBe('INVALID_STATE');
  });

  it('never duplicates stock for retried or concurrent deliveries', async () => {
    const s = await setup();
    const po = await approvedOrder(s);
    const body = { idempotencyKey: newId(), lines: [{ position: 0, quantity: '3' }] };
    const retries = await Promise.all(
      Array.from({ length: 4 }, () =>
        req(s, 'POST', `/manager/purchase-orders/${po.id}/receipts`, body),
      ),
    );
    expect(retries.every((r) => r.statusCode === 201)).toBe(true);
    expect(await onHand(s, s.rice, s.c.main)).toBe('3.000');
    // Different deliveries racing for the remaining 7: at most what is open is received.
    const race = await Promise.all(
      Array.from({ length: 4 }, () =>
        req(s, 'POST', `/manager/purchase-orders/${po.id}/receipts`, {
          idempotencyKey: newId(),
          lines: [{ position: 0, quantity: '3' }],
        }),
      ),
    );
    expect(race.filter((r) => r.statusCode === 201)).toHaveLength(2);
    expect(race.filter((r) => r.json().code === 'RECEIVE_EXCEEDS_ORDER')).toHaveLength(2);
    expect(await onHand(s, s.rice, s.c.main)).toBe('9.000');
    const order = (await req(s, 'GET', `/manager/purchase-orders/${po.id}`)).json();
    expect(order.lines[0]).toMatchObject({ receivedQuantity: '9.000', remainingQuantity: '1.000' });
  });

  it('applies cancellation and closing rules', async () => {
    const s = await setup();
    const draft = (
      await req(s, 'POST', '/manager/purchase-orders', {
        supplierId: s.supplierId,
        branchId: s.c.main,
        lines: [{ variantId: s.rice, quantity: '1', unitCost: '1' }],
      })
    ).json();
    expect(
      (
        await req(s, 'POST', `/manager/purchase-orders/${draft.id}/cancel`, {
          version: draft.version,
          reason: 'Duplicate',
        })
      ).json().status,
    ).toBe('cancelled');
    const po = await approvedOrder(s);
    const partial = (
      await req(s, 'POST', `/manager/purchase-orders/${po.id}/receipts`, {
        idempotencyKey: newId(),
        lines: [{ position: 0, quantity: '2' }],
      })
    ).json();
    expect(
      (
        await req(s, 'POST', `/manager/purchase-orders/${po.id}/cancel`, {
          version: partial.version,
        })
      ).json().code,
    ).toBe('INVALID_STATE');
    expect(
      (
        await req(s, 'POST', `/manager/purchase-orders/${po.id}/close`, {
          version: partial.version,
        })
      ).statusCode,
    ).toBe(400);
    const closed = (
      await req(s, 'POST', `/manager/purchase-orders/${po.id}/close`, {
        version: partial.version,
        reason: 'Supplier out of stock',
      })
    ).json();
    expect(closed).toMatchObject({ status: 'closed', closeReason: 'Supplier out of stock' });
    expect(
      (
        await req(s, 'POST', `/manager/purchase-orders/${po.id}/receipts`, {
          idempotencyKey: newId(),
          lines: [{ position: 0, quantity: '1' }],
        })
      ).json().code,
    ).toBe('INVALID_STATE');
    expect(await onHand(s, s.rice, s.c.main)).toBe('2.000');
  });

  it('enforces purchasing permissions per branch and separation of duties', async () => {
    const s = await setup();
    // Branch manager of the second branch: may read and manage only there.
    const bm = await s.c.hire(
      [{ roleId: s.c.roles.branch_manager, branchId: s.c.second }],
      'manager',
    );
    const atMain = await req(
      s,
      'POST',
      '/manager/purchase-orders',
      {
        supplierId: s.supplierId,
        branchId: s.c.main,
        lines: [{ variantId: s.rice, quantity: '1', unitCost: '1' }],
      },
      bm.cookies,
    );
    expect(atMain.statusCode).toBe(403);
    const own = (
      await req(
        s,
        'POST',
        '/manager/purchase-orders',
        {
          supplierId: s.supplierId,
          branchId: s.c.second,
          lines: [{ variantId: s.rice, quantity: '1', unitCost: '1' }],
        },
        bm.cookies,
      )
    ).json();
    const sub = (
      await req(
        s,
        'POST',
        `/manager/purchase-orders/${own.id}/submit`,
        { version: own.version },
        bm.cookies,
      )
    ).json();
    // Branch managers cannot approve orders at all (no purchasing.approve in their template).
    const bmApprove = await req(
      s,
      'POST',
      `/manager/purchase-orders/${own.id}/approve`,
      { version: sub.version },
      bm.cookies,
    );
    expect(bmApprove.statusCode).toBe(403);
    // A company manager may approve, but never their own order.
    const cm = await s.c.hire([{ roleId: s.c.roles.company_manager, branchId: null }], 'manager');
    const cmPo = (
      await req(
        s,
        'POST',
        '/manager/purchase-orders',
        {
          supplierId: s.supplierId,
          branchId: s.c.main,
          lines: [{ variantId: s.rice, quantity: '1', unitCost: '1' }],
        },
        cm.cookies,
      )
    ).json();
    const cmSub = (
      await req(
        s,
        'POST',
        `/manager/purchase-orders/${cmPo.id}/submit`,
        { version: cmPo.version },
        cm.cookies,
      )
    ).json();
    const self = await req(
      s,
      'POST',
      `/manager/purchase-orders/${cmPo.id}/approve`,
      { version: cmSub.version },
      cm.cookies,
    );
    expect(self.json().code).toBe('SELF_APPROVAL');
    expect(
      (
        await req(s, 'POST', `/manager/purchase-orders/${own.id}/approve`, { version: sub.version })
      ).json().status,
    ).toBe('approved');
    const mainPo = await approvedOrder(s);
    expect(
      (await req(s, 'GET', `/manager/purchase-orders/${mainPo.id}`, undefined, bm.cookies))
        .statusCode,
    ).toBe(403);
    expect(
      (await req(s, 'GET', '/manager/purchase-orders', undefined, bm.cookies))
        .json()
        .orders.map((o: { id: string }) => o.id),
    ).toEqual([own.id]);
    // Supervisors (no purchasing rights) and cashiers are rejected.
    const sup = await s.c.hire([{ roleId: s.c.roles.supervisor, branchId: s.c.main }], 'pos');
    expect(
      (
        await req(s, 'GET', '/manager/purchase-orders', undefined, {
          mgr_sid: sup.cookies.pos_sid!,
        })
      ).statusCode,
    ).toBe(401);
    // Services and other merchants' items cannot be purchased.
    const svc = (
      await req(s, 'POST', '/manager/products', {
        nameEn: 'Delivery',
        type: 'service',
        trackInventory: false,
        variants: [{ price: '1' }],
      })
    ).json();
    expect(
      (
        await req(s, 'POST', '/manager/purchase-orders', {
          supplierId: s.supplierId,
          branchId: s.c.main,
          lines: [{ variantId: svc.variants[0].id, quantity: '1', unitCost: '1' }],
        })
      ).json().code,
    ).toBe('NOT_STOCK_TRACKED');
    const other = await setup();
    expect(
      (
        await req(other, 'POST', '/manager/purchase-orders', {
          supplierId: s.supplierId,
          branchId: other.c.main,
          lines: [{ variantId: other.rice, quantity: '1', unitCost: '1' }],
        })
      ).statusCode,
    ).toBe(404);
    expect((await req(other, 'GET', `/manager/purchase-orders/${mainPo.id}`)).statusCode).toBe(404);
  });
});

describe('transfers', () => {
  async function stocked() {
    const s = await setup();
    await req(s, 'POST', '/manager/inventory/adjustments', {
      branchId: s.c.main,
      kind: 'opening',
      reason: 'opening',
      lines: [
        { variantId: s.rice, quantity: '10', unitCost: '1.200' },
        { variantId: s.oil, quantity: '5', unitCost: '0.500' },
      ],
    });
    return s;
  }

  it('requests, approves, dispatches (in transit), receives with a discrepancy and reconciles', async () => {
    const s = await stocked();
    const t = (
      await req(s, 'POST', '/manager/transfers', {
        sourceBranchId: s.c.main,
        destinationBranchId: s.c.second,
        lines: [
          { variantId: s.rice, quantity: '6' },
          { variantId: s.oil, quantity: '2' },
        ],
      })
    ).json();
    expect(t).toMatchObject({ number: 'TR-000001', status: 'requested' });
    expect(
      (
        await req(s, 'POST', `/manager/transfers/${t.id}/dispatch`, {
          version: t.version,
          lines: [{ position: 0, quantity: '6' }],
        })
      ).json().code,
    ).toBe('INVALID_STATE');
    const approved = (
      await req(s, 'POST', `/manager/transfers/${t.id}/approve`, { version: t.version })
    ).json();
    // Dispatch more than requested is refused; dispatching 5 rice and 2 oil.
    expect(
      (
        await req(s, 'POST', `/manager/transfers/${t.id}/dispatch`, {
          version: approved.version,
          lines: [{ position: 0, quantity: '7' }],
        })
      ).json().code,
    ).toBe('RECEIVE_EXCEEDS_ORDER');
    const sent = (
      await req(s, 'POST', `/manager/transfers/${t.id}/dispatch`, {
        version: approved.version,
        lines: [
          { position: 0, quantity: '5' },
          { position: 1, quantity: '2' },
        ],
      })
    ).json();
    expect(sent).toMatchObject({
      status: 'in_transit',
      lines: [
        { dispatchedQuantity: '5.000', unitCost: { amount: '1.200' } },
        { dispatchedQuantity: '2.000' },
      ],
    });
    expect(await onHand(s, s.rice, s.c.main)).toBe('5.000');
    expect(await onHand(s, s.rice, s.c.second)).toBe('0.000');
    // Cancel after dispatch is refused; dispatch twice is refused.
    expect(
      (await req(s, 'POST', `/manager/transfers/${t.id}/cancel`, { version: sent.version })).json()
        .code,
    ).toBe('INVALID_STATE');
    expect(
      (
        await req(s, 'POST', `/manager/transfers/${t.id}/dispatch`, {
          version: sent.version,
          lines: [{ position: 0, quantity: '1' }],
        })
      ).json().code,
    ).toBe('INVALID_STATE');
    // Receiving less needs a note; over-receiving is a surplus that needs one too.
    expect(
      (
        await req(s, 'POST', `/manager/transfers/${t.id}/receive`, {
          version: sent.version,
          lines: [
            { position: 0, quantity: '4' },
            { position: 1, quantity: '2' },
          ],
        })
      ).statusCode,
    ).toBe(400);
    // Receiving more than was sent is a surplus: allowed, but only with an explanation (BR-172).
    expect(
      (
        await req(s, 'POST', `/manager/transfers/${t.id}/receive`, {
          version: sent.version,
          lines: [{ position: 0, quantity: '6' }],
        })
      ).statusCode,
    ).toBe(400);
    const received = (
      await req(s, 'POST', `/manager/transfers/${t.id}/receive`, {
        version: sent.version,
        note: 'One bag torn',
        lines: [
          { position: 0, quantity: '4' },
          { position: 1, quantity: '2' },
        ],
      })
    ).json();
    expect(received).toMatchObject({
      status: 'received',
      discrepancyQuantity: '1.000',
      discrepancyNote: 'One bag torn',
      // The shortage is written off explicitly (BR-172): 1 × 1.200 is within the limit.
      lostQuantity: '1.000',
      inTransitQuantity: '0.000',
      losses: [{ status: 'posted', explanation: 'One bag torn' }],
      lines: [{ discrepancyQuantity: '1.000' }, { discrepancyQuantity: '0.000' }],
    });
    expect(await onHand(s, s.rice, s.c.second)).toBe('4.000');
    const level = (
      await req(s, 'GET', `/manager/inventory/levels?branchId=${s.c.second}&q=rice`)
    ).json().levels[0];
    expect(level.avgCost.amount).toBe('1.200');
    // Movement history links both sides to the transfer.
    const moves = await owner.query(
      `select branch_id, movement_type, quantity::text from stock_movements
       where merchant_id = $1 and source_type = 'transfer' and variant_id = $2 order by created_at, id`,
      [s.c.merchantId, s.rice],
    );
    expect(moves.rows).toEqual([
      { branch_id: s.c.main, movement_type: 'transfer_out', quantity: '-5.000' },
      { branch_id: s.c.second, movement_type: 'transfer_in', quantity: '4.000' },
    ]);
    // Total stock: 10 − 5 (sent) + 4 (arrived) = 9; 1 written off as discrepancy.
    const all = (await req(s, 'GET', `/manager/inventory/variants/${s.rice}`)).json();
    expect(all.total).toBe('9.000');
    // Final transfers cannot change.
    const database = app.get(DatabaseService);
    await expect(
      database.withMerchantTx(s.c.merchantId, (tx) =>
        tx.execute(sql`update stock_transfers set status = 'in_transit'`),
      ),
    ).rejects.toThrow();
  });

  it('never dispatches more than the source holds, even with a permissive negative-stock policy', async () => {
    const s = await stocked();
    await owner.query(
      `insert into inventory_settings (merchant_id, allow_negative_stock) values ($1, true)`,
      [s.c.merchantId],
    );
    const t = (
      await req(s, 'POST', '/manager/transfers', {
        sourceBranchId: s.c.main,
        destinationBranchId: s.c.second,
        lines: [{ variantId: s.oil, quantity: '8' }],
      })
    ).json();
    const a = (
      await req(s, 'POST', `/manager/transfers/${t.id}/approve`, { version: t.version })
    ).json();
    const res = await req(s, 'POST', `/manager/transfers/${t.id}/dispatch`, {
      version: a.version,
      lines: [{ position: 0, quantity: '8' }],
    });
    expect(res.json().code).toBe('INSUFFICIENT_STOCK');
    expect(await onHand(s, s.oil, s.c.main)).toBe('5.000');
    // Two dispatches of the same transfer racing: one wins.
    const t2 = (
      await req(s, 'POST', '/manager/transfers', {
        sourceBranchId: s.c.main,
        destinationBranchId: s.c.second,
        lines: [{ variantId: s.oil, quantity: '3' }],
      })
    ).json();
    const a2 = (
      await req(s, 'POST', `/manager/transfers/${t2.id}/approve`, { version: t2.version })
    ).json();
    const race = await Promise.all(
      [0, 1].map(() =>
        req(s, 'POST', `/manager/transfers/${t2.id}/dispatch`, {
          version: a2.version,
          lines: [{ position: 0, quantity: '3' }],
        }),
      ),
    );
    expect(race.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(await onHand(s, s.oil, s.c.main)).toBe('2.000');
  });

  it('enforces branch-level transfer permissions', async () => {
    const s = await stocked();
    const bmSecond = await s.c.hire(
      [{ roleId: s.c.roles.branch_manager, branchId: s.c.second }],
      'manager',
    );
    // The destination may request…
    const t = (
      await req(
        s,
        'POST',
        '/manager/transfers',
        {
          sourceBranchId: s.c.main,
          destinationBranchId: s.c.second,
          lines: [{ variantId: s.rice, quantity: '2' }],
        },
        bmSecond.cookies,
      )
    ).json();
    expect(t.status).toBe('requested');
    // …but cannot approve or dispatch for the source.
    expect(
      (
        await req(
          s,
          'POST',
          `/manager/transfers/${t.id}/approve`,
          { version: t.version },
          bmSecond.cookies,
        )
      ).statusCode,
    ).toBe(403);
    const a = (
      await req(s, 'POST', `/manager/transfers/${t.id}/approve`, { version: t.version })
    ).json();
    expect(
      (
        await req(
          s,
          'POST',
          `/manager/transfers/${t.id}/dispatch`,
          { version: a.version, lines: [{ position: 0, quantity: '2' }] },
          bmSecond.cookies,
        )
      ).statusCode,
    ).toBe(403);
    const sent = (
      await req(s, 'POST', `/manager/transfers/${t.id}/dispatch`, {
        version: a.version,
        lines: [{ position: 0, quantity: '2' }],
      })
    ).json();
    // A manager of the source alone cannot receive at the destination.
    const bmMain = await s.c.hire(
      [{ roleId: s.c.roles.branch_manager, branchId: s.c.main }],
      'manager',
    );
    expect(
      (
        await req(
          s,
          'POST',
          `/manager/transfers/${t.id}/receive`,
          { version: sent.version, lines: [{ position: 0, quantity: '2' }] },
          bmMain.cookies,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await req(
          s,
          'POST',
          `/manager/transfers/${t.id}/receive`,
          { version: sent.version, lines: [{ position: 0, quantity: '2' }] },
          bmSecond.cookies,
        )
      ).json().status,
    ).toBe('received');
    // Neither branch manager may move stock between two branches they don't manage.
    const third = (
      await req(s, 'POST', '/manager/branches', { code: 'B3', nameEn: 'Third' })
    ).json().id;
    expect(
      (
        await req(
          s,
          'POST',
          '/manager/transfers',
          {
            sourceBranchId: third,
            destinationBranchId: s.c.main,
            lines: [{ variantId: s.rice, quantity: '1' }],
          },
          bmSecond.cookies,
        )
      ).statusCode,
    ).toBe(403);
    // Other merchants see nothing.
    const other = await setup();
    expect((await req(other, 'GET', `/manager/transfers/${t.id}`)).statusCode).toBe(404);
    const audit = await owner.query(
      `select action from audit_log where merchant_id = $1 and target_id = $2 order by occurred_at, id`,
      [s.c.merchantId, t.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'transfer.requested',
      'transfer.approved',
      'transfer.dispatched',
      'transfer.received',
    ]);
  });
});
