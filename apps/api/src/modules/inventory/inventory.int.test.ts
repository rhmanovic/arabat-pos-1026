import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../database/database.service.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';
import { StockLedgerService } from './stock-ledger.service.js';

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

async function product(
  c: Co,
  overrides: Record<string, unknown> = {},
  cost: string | null = '1.000',
) {
  const res = await c.client.request('POST', '/manager/products', {
    cookies: c.cookies,
    body: {
      nameEn: `Item ${Math.random().toString(36).slice(2, 7)}`,
      variants: [{ price: '2.000', cost }],
      ...overrides,
    },
  });
  if (res.statusCode !== 201) throw new Error(res.body);
  const p = res.json();
  return { productId: p.id as string, variantId: p.variants[0].id as string };
}

function adjust(c: Co, body: Record<string, unknown>, cookies = c.cookies) {
  return c.client.request('POST', '/manager/inventory/adjustments', { cookies, body });
}

async function onHand(c: Co, variantId: string, branchId = c.main) {
  const res = await c.client.request('GET', `/manager/inventory/variants/${variantId}`, {
    cookies: c.cookies,
  });
  return res.json().branches.find((b: { branchId: string }) => b.branchId === branchId)
    ?.onHand as string;
}

/** The ledger must always explain the balance exactly. */
async function assertLedgerConsistent(merchantId: string) {
  const { rows } = await owner.query(
    `select l.branch_id, l.variant_id, l.on_hand::text,
            coalesce((select sum(m.quantity) from stock_movements m
                      where m.branch_id = l.branch_id and m.variant_id = l.variant_id), 0)::numeric(14,3)::text as ledger
     from stock_levels l where l.merchant_id = $1`,
    [merchantId],
  );
  for (const r of rows) expect(r.on_hand, `${r.variant_id}`).toBe(r.ledger);
}

describe('stock documents', () => {
  it('sets opening stock with cost, then increases, decreases and counts with exact quantities', async () => {
    const c = await company();
    const { variantId } = await product(c);

    const opening = await adjust(c, {
      branchId: c.main,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId, quantity: '10', unitCost: '1.000' }],
    });
    expect(opening.statusCode).toBe(201);
    expect(opening.json().lines[0]).toMatchObject({
      quantity: '10.000',
      previousOnHand: '0.000',
      delta: '10.000',
      newOnHand: '10.000',
      unitCost: { amount: '1.000', currency: 'KWD' },
    });

    // A second opening is refused once the item has history.
    const again = await adjust(c, {
      branchId: c.main,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId, quantity: '1' }],
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('OPENING_STOCK_EXISTS');

    // Increase 10 @ 2.000 → weighted average 1.500.
    expect(
      (
        await adjust(c, {
          branchId: c.main,
          kind: 'increase',
          reason: 'found',
          lines: [{ variantId, quantity: '10', unitCost: '2.000' }],
        })
      ).statusCode,
    ).toBe(201);
    // Decrease 2.5 (fractional quantities are exact).
    const dec = await adjust(c, {
      branchId: c.main,
      kind: 'decrease',
      reason: 'damaged',
      lines: [{ variantId, quantity: '2.5' }],
    });
    expect(dec.statusCode).toBe(201);
    expect(dec.json().lines[0]).toMatchObject({
      delta: '-2.500',
      newOnHand: '17.500',
      unitCost: { amount: '1.500' },
    });

    // Count 15 → delta −2.5 computed under the lock.
    const count = await adjust(c, {
      branchId: c.main,
      kind: 'count',
      reason: 'stock_count',
      lines: [{ variantId, quantity: '15' }],
    });
    expect(count.json().lines[0]).toMatchObject({
      previousOnHand: '17.500',
      delta: '-2.500',
      newOnHand: '15.000',
    });
    // A count that matches records the document but no movement.
    const same = await adjust(c, {
      branchId: c.main,
      kind: 'count',
      reason: 'stock_count',
      lines: [{ variantId, quantity: '15' }],
    });
    expect(same.json().lines[0].delta).toBe('0.000');

    expect(await onHand(c, variantId)).toBe('15.000');
    const level = (
      await c.client.request('GET', `/manager/inventory/levels?branchId=${c.main}`, {
        cookies: c.cookies,
      })
    ).json();
    expect(level.levels[0]).toMatchObject({
      onHand: '15.000',
      avgCost: { amount: '1.500' },
      value: { amount: '22.500' },
      status: 'in_stock',
    });

    const history = (
      await c.client.request('GET', `/manager/inventory/movements?variantId=${variantId}`, {
        cookies: c.cookies,
      })
    ).json();
    expect(history.total).toBe(4);
    expect(history.movements.map((m: { movementType: string }) => m.movementType)).toEqual([
      'count',
      'adjustment',
      'adjustment',
      'opening',
    ]);
    expect(history.movements[0]).toMatchObject({ quantity: '-2.500', balanceAfter: '15.000' });
    expect(history.movements[3].createdBy.fullName).toBeTruthy();
    await assertLedgerConsistent(c.merchantId);

    const audit = await owner.query(
      `select count(*)::int as n from audit_log where merchant_id = $1 and action = 'inventory.adjusted'`,
      [c.merchantId],
    );
    expect(audit.rows[0].n).toBe(5);
  });

  it('rejects invalid quantities, reasons and services without changing anything', async () => {
    const c = await company();
    const { variantId } = await product(c);
    const service = await product(c, { type: 'service', trackInventory: false });
    const cases: Record<string, unknown>[] = [
      { kind: 'increase', reason: 'found', lines: [{ variantId, quantity: '1.0005' }] },
      { kind: 'increase', reason: 'found', lines: [{ variantId, quantity: '0' }] },
      { kind: 'increase', reason: 'found', lines: [{ variantId, quantity: '-1' }] },
      { kind: 'increase', reason: 'found', lines: [{ variantId, quantity: '1e2' }] },
      { kind: 'increase', reason: 'damaged', lines: [{ variantId, quantity: '1' }] },
      { kind: 'decrease', reason: 'other', lines: [{ variantId, quantity: '1' }] },
      { kind: 'decrease', reason: 'lost', lines: [{ variantId, quantity: '1', unitCost: '1' }] },
      {
        kind: 'increase',
        reason: 'found',
        lines: [
          { variantId, quantity: '1' },
          { variantId, quantity: '2' },
        ],
      },
    ];
    for (const body of cases) {
      const res = await adjust(c, { branchId: c.main, ...body });
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    const svc = await adjust(c, {
      branchId: c.main,
      kind: 'increase',
      reason: 'found',
      lines: [{ variantId: service.variantId, quantity: '1' }],
    });
    expect(svc.statusCode).toBe(409);
    expect(svc.json().code).toBe('NOT_STOCK_TRACKED');
    const { rows } = await owner.query(
      'select count(*)::int as n from stock_movements where merchant_id = $1',
      [c.merchantId],
    );
    expect(rows[0].n).toBe(0);
  });

  it('never oversells by default; the merchant can explicitly allow negative stock', async () => {
    const c = await company();
    const a = await product(c);
    const b = await product(c);
    await adjust(c, {
      branchId: c.main,
      kind: 'opening',
      reason: 'opening',
      lines: [
        { variantId: a.variantId, quantity: '5' },
        { variantId: b.variantId, quantity: '1' },
      ],
    });
    // One short line rejects the whole document (all-or-nothing).
    const short = await adjust(c, {
      branchId: c.main,
      kind: 'decrease',
      reason: 'lost',
      lines: [
        { variantId: a.variantId, quantity: '2' },
        { variantId: b.variantId, quantity: '3' },
      ],
    });
    expect(short.statusCode).toBe(409);
    expect(short.json().code).toBe('INSUFFICIENT_STOCK');
    expect(short.json().issues[0]).toMatchObject({
      path: 'lines.1',
      message: 'available=1.000 requested=3.000',
    });
    expect(await onHand(c, a.variantId)).toBe('5.000');

    const settings = (
      await c.client.request('GET', '/manager/inventory/settings', { cookies: c.cookies })
    ).json();
    expect(settings).toMatchObject({
      allowNegativeStock: false,
      costingMethod: 'weighted_average',
    });
    const updated = await c.client.request('PUT', '/manager/inventory/settings', {
      cookies: c.cookies,
      body: { allowNegativeStock: true, version: settings.version },
    });
    expect(updated.statusCode).toBe(200);
    const stale = await c.client.request('PUT', '/manager/inventory/settings', {
      cookies: c.cookies,
      body: { allowNegativeStock: false, version: settings.version },
    });
    expect(stale.statusCode).toBe(409);

    expect(
      (
        await adjust(c, {
          branchId: c.main,
          kind: 'decrease',
          reason: 'lost',
          lines: [{ variantId: b.variantId, quantity: '3' }],
        })
      ).statusCode,
    ).toBe(201);
    expect(await onHand(c, b.variantId)).toBe('-2.000');
    const neg = (
      await c.client.request('GET', `/manager/inventory/levels?branchId=${c.main}&stock=out`, {
        cookies: c.cookies,
      })
    ).json();
    expect(neg.levels.map((l: { status: string }) => l.status)).toEqual(['negative']);
    await assertLedgerConsistent(c.merchantId);
  });

  it('is idempotent: a retried request with the same key applies once', async () => {
    const c = await company();
    const { variantId } = await product(c);
    const body = {
      branchId: c.main,
      kind: 'increase',
      reason: 'found',
      idempotencyKey: newId(),
      lines: [{ variantId, quantity: '3' }],
    };
    const results = await Promise.all([adjust(c, body), adjust(c, body), adjust(c, body)]);
    const ids = new Set(results.map((r) => r.json().id));
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    expect(ids.size).toBe(1);
    expect(await onHand(c, variantId)).toBe('3.000');
    const reuse = await adjust(c, { ...body, lines: [{ variantId, quantity: '4' }] });
    expect(reuse.statusCode).toBe(409);
    expect(reuse.json().code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('serializes concurrent decreases: never below zero, never a lost update', async () => {
    const c = await company();
    const { variantId } = await product(c);
    await adjust(c, {
      branchId: c.main,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId, quantity: '10' }],
    });
    const attempts = await Promise.all(
      Array.from({ length: 16 }, () =>
        adjust(c, {
          branchId: c.main,
          kind: 'decrease',
          reason: 'damaged',
          lines: [{ variantId, quantity: '1' }],
        }),
      ),
    );
    const ok = attempts.filter((r) => r.statusCode === 201).length;
    const refused = attempts.filter((r) => r.json().code === 'INSUFFICIENT_STOCK').length;
    expect(ok).toBe(10);
    expect(refused).toBe(6);
    expect(await onHand(c, variantId)).toBe('0.000');

    // Concurrent increases on two items in opposite line order: no deadlock, no lost update.
    const other = await product(c);
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        adjust(c, {
          branchId: c.main,
          kind: 'increase',
          reason: 'found',
          lines:
            i % 2
              ? [
                  { variantId, quantity: '1' },
                  { variantId: other.variantId, quantity: '2' },
                ]
              : [
                  { variantId: other.variantId, quantity: '2' },
                  { variantId, quantity: '1' },
                ],
        }),
      ),
    ).then((rs) => rs.forEach((r) => expect(r.statusCode, r.body).toBe(201)));
    expect(await onHand(c, variantId)).toBe('12.000');
    expect(await onHand(c, other.variantId)).toBe('24.000');
    await assertLedgerConsistent(c.merchantId);
  });

  it('keeps balances per branch', async () => {
    const c = await company();
    const { variantId } = await product(c);
    await adjust(c, {
      branchId: c.main,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId, quantity: '4' }],
    });
    await adjust(c, {
      branchId: c.second,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId, quantity: '6' }],
    });
    const stock = (
      await c.client.request('GET', `/manager/inventory/variants/${variantId}`, {
        cookies: c.cookies,
      })
    ).json();
    expect(stock.total).toBe('10.000');
    const all = (
      await c.client.request('GET', '/manager/inventory/levels', { cookies: c.cookies })
    ).json();
    expect(all.levels[0]).toMatchObject({
      branchId: null,
      onHand: '10.000',
      value: { amount: '10.000' },
    });
  });
});

describe('thresholds, summary and valuation', () => {
  it('flags low and out-of-stock items and values stock at average cost', async () => {
    const c = await company();
    const low = await product(c, { nameEn: 'A low' }, '0.333');
    const out = await product(c, { nameEn: 'B out' });
    const fine = await product(c, { nameEn: 'C fine' }, null);
    await adjust(c, {
      branchId: c.main,
      kind: 'opening',
      reason: 'opening',
      lines: [
        { variantId: low.variantId, quantity: '1.5' },
        { variantId: fine.variantId, quantity: '50' },
      ],
    });
    expect(
      (
        await c.client.request('PUT', '/manager/inventory/thresholds', {
          cookies: c.cookies,
          body: { branchId: c.main, variantId: low.variantId, threshold: '2' },
        })
      ).statusCode,
    ).toBe(204);

    const summary = (
      await c.client.request('GET', `/manager/inventory/summary?branchId=${c.main}`, {
        cookies: c.cookies,
      })
    ).json();
    // 1.5 × 0.333 = 0.4995 → 0.500 (half-up); the item without cost is reported as unvalued.
    expect(summary).toMatchObject({
      trackedVariants: 3,
      lowStock: 1,
      outOfStock: 1,
      totalValue: { amount: '0.500', currency: 'KWD' },
      unvaluedVariants: 1,
      costingMethod: 'weighted_average',
    });
    const lowList = (
      await c.client.request('GET', `/manager/inventory/levels?branchId=${c.main}&stock=low`, {
        cookies: c.cookies,
      })
    ).json();
    expect(lowList.levels).toHaveLength(1);
    expect(lowList.levels[0]).toMatchObject({
      variantId: low.variantId,
      status: 'low',
      lowStockThreshold: '2.000',
    });
    const outList = (
      await c.client.request('GET', `/manager/inventory/levels?branchId=${c.main}&stock=out`, {
        cookies: c.cookies,
      })
    ).json();
    expect(outList.levels.map((l: { variantId: string }) => l.variantId)).toEqual([out.variantId]);
    const search = (
      await c.client.request('GET', `/manager/inventory/levels?branchId=${c.main}&q=fine`, {
        cookies: c.cookies,
      })
    ).json();
    expect(search.levels.map((l: { variantId: string }) => l.variantId)).toEqual([fine.variantId]);
  });
});

describe('permissions and isolation', () => {
  it('limits a branch manager to their branch and hides costs from roles without cost rights', async () => {
    const c = await company();
    const { variantId } = await product(c);
    const bm = await c.hire([{ roleId: c.roles.branch_manager, branchId: c.main }], 'manager');
    const atSecond = await adjust(
      c,
      {
        branchId: c.second,
        kind: 'increase',
        reason: 'found',
        lines: [{ variantId, quantity: '1' }],
      },
      bm.cookies,
    );
    expect(atSecond.statusCode).toBe(403);
    const atMain = await adjust(
      c,
      {
        branchId: c.main,
        kind: 'increase',
        reason: 'found',
        lines: [{ variantId, quantity: '1' }],
      },
      bm.cookies,
    );
    expect(atMain.statusCode).toBe(201);
    expect(
      (
        await c.client.request('GET', `/manager/inventory/levels?branchId=${c.second}`, {
          cookies: bm.cookies,
        })
      ).statusCode,
    ).toBe(403);
    // Without a branch the list covers only the branches they may read.
    const mine = (
      await c.client.request('GET', '/manager/inventory/variants/' + variantId, {
        cookies: bm.cookies,
      })
    ).json();
    expect(mine.branches.map((b: { branchId: string }) => b.branchId)).toEqual([c.main]);
    // Entering costs needs the price permission.
    const withCost = await adjust(
      c,
      {
        branchId: c.main,
        kind: 'increase',
        reason: 'found',
        lines: [{ variantId, quantity: '1', unitCost: '1.000' }],
      },
      bm.cookies,
    );
    expect(withCost.statusCode).toBe(403);
    // Settings are merchant-wide.
    expect(
      (
        await c.client.request('PUT', '/manager/inventory/settings', {
          cookies: bm.cookies,
          body: { allowNegativeStock: true, version: 1 },
        })
      ).statusCode,
    ).toBe(403);

    // A stock clerk role (no price or inventory-report rights) never sees costs or values.
    const role = (
      await c.client.request('POST', '/manager/roles', {
        cookies: c.cookies,
        body: { nameEn: 'Stock clerk', permissions: ['manager.access', 'inventory.read'] },
      })
    ).json();
    const clerk = await c.hire([{ roleId: role.id, branchId: c.main }], 'manager');
    const view = await c.client.request('GET', `/manager/inventory/levels?branchId=${c.main}`, {
      cookies: clerk.cookies,
    });
    expect(view.statusCode).toBe(200);
    expect(view.json().costVisible).toBe(false);
    expect(view.body).not.toContain('avgCost');
    const summary = (
      await c.client.request('GET', `/manager/inventory/summary?branchId=${c.main}`, {
        cookies: clerk.cookies,
      })
    ).json();
    expect(summary.totalValue).toBeUndefined();
    expect(
      (
        await adjust(
          c,
          {
            branchId: c.main,
            kind: 'increase',
            reason: 'found',
            lines: [{ variantId, quantity: '1' }],
          },
          clerk.cookies,
        )
      ).statusCode,
    ).toBe(403);
  });

  it('gives cashiers availability at their branch only and no management access', async () => {
    const c = await company();
    const { variantId } = await product(c);
    await adjust(c, {
      branchId: c.main,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId, quantity: '3' }],
    });
    await adjust(c, {
      branchId: c.second,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId, quantity: '9' }],
    });
    const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
    const res = await c.client.request(
      'GET',
      `/pos/inventory/availability?variantIds=${variantId}`,
      {
        cookies: cashier.cookies,
      },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      branchId: c.main,
      allowNegativeStock: false,
      items: [{ variantId, onHand: '3.000', status: 'in_stock' }],
    });
    expect(res.body).not.toContain('cost');
    expect(
      (
        await c.client.request('POST', '/manager/inventory/adjustments', {
          cookies: { mgr_sid: cashier.cookies.pos_sid! },
          body: {},
        })
      ).statusCode,
    ).toBe(401);
  });

  it('never reads or changes another merchant’s stock', async () => {
    const a = await company();
    const b = await company();
    const { variantId } = await product(a);
    await adjust(a, {
      branchId: a.main,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId, quantity: '3' }],
    });
    // b uses a's variant at its own branch, and a's branch.
    const cross = await adjust(b, {
      branchId: b.main,
      kind: 'increase',
      reason: 'found',
      lines: [{ variantId, quantity: '1' }],
    });
    expect(cross.statusCode).toBe(409);
    expect(
      (
        await adjust(b, {
          branchId: a.main,
          kind: 'increase',
          reason: 'found',
          lines: [{ variantId, quantity: '1' }],
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await b.client.request('GET', `/manager/inventory/variants/${variantId}`, {
          cookies: b.cookies,
        })
      ).statusCode,
    ).toBe(404);
    const bList = (
      await b.client.request('GET', '/manager/inventory/movements', { cookies: b.cookies })
    ).json();
    expect(bList.total).toBe(0);
    expect(await onHand(a, variantId)).toBe('3.000');
  });
});

describe('ledger engine (used by sales, refunds, transfers)', () => {
  it('skips untracked items, applies sale-like movements atomically and rolls back on failure', async () => {
    const c = await company();
    const goods = await product(c);
    const service = await product(c, { type: 'service', trackInventory: false });
    await adjust(c, {
      branchId: c.main,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId: goods.variantId, quantity: '2', unitCost: '0.750' }],
    });
    const ledger = app.get(StockLedgerService);
    const database = app.get(DatabaseService);
    const saleId = newId();
    const applied = await database.withMerchantTx(c.merchantId, (tx) =>
      ledger.apply(
        tx,
        {
          merchantId: c.merchantId,
          branchId: c.main,
          movementType: 'sale',
          sourceType: 'sale',
          sourceId: saleId,
          userId: null,
        },
        [
          { variantId: goods.variantId, mode: 'delta', quantityMilli: -1000n },
          { variantId: service.variantId, mode: 'delta', quantityMilli: -1000n },
        ],
      ),
    );
    expect(applied.map((a) => a.tracked)).toEqual([true, false]);
    expect(applied[0]).toMatchObject({ balanceMilli: 1000n, unitCostMinor: 750n });

    // A failure later in the same transaction rolls the stock change back.
    await expect(
      database.withMerchantTx(c.merchantId, async (tx) => {
        await ledger.apply(
          tx,
          {
            merchantId: c.merchantId,
            branchId: c.main,
            movementType: 'sale',
            sourceType: 'sale',
            sourceId: newId(),
            userId: null,
          },
          [{ variantId: goods.variantId, mode: 'delta', quantityMilli: -1000n }],
        );
        throw new Error('payment failed');
      }),
    ).rejects.toThrow('payment failed');
    expect(await onHand(c, goods.variantId)).toBe('1.000');

    // 'deny' overrides a permissive merchant policy (e.g. transfers).
    await owner.query(
      'insert into inventory_settings (merchant_id, allow_negative_stock) values ($1, true)',
      [c.merchantId],
    );
    await expect(
      database.withMerchantTx(c.merchantId, (tx) =>
        ledger.apply(
          tx,
          {
            merchantId: c.merchantId,
            branchId: c.main,
            movementType: 'transfer_out',
            sourceType: 'transfer',
            sourceId: newId(),
            userId: null,
            negative: 'deny',
          },
          [{ variantId: goods.variantId, mode: 'delta', quantityMilli: -5000n }],
        ),
      ),
    ).rejects.toBeInstanceOf(AppError);

    const movements = await owner.query(
      `select movement_type, quantity::text, source_id from stock_movements
       where merchant_id = $1 and source_type = 'sale'`,
      [c.merchantId],
    );
    expect(movements.rows).toEqual([
      { movement_type: 'sale', quantity: '-1.000', source_id: saleId },
    ]);
    await assertLedgerConsistent(c.merchantId);
  });

  it('refuses to update or delete ledger rows (append-only)', async () => {
    const c = await company();
    const { variantId } = await product(c);
    await adjust(c, {
      branchId: c.main,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId, quantity: '1' }],
    });
    const database = app.get(DatabaseService);
    await expect(
      database.withMerchantTx(c.merchantId, (tx) =>
        tx.execute(sql`update stock_movements set quantity = 100`),
      ),
    ).rejects.toThrow();
    await expect(
      database.withMerchantTx(c.merchantId, (tx) => tx.execute(sql`delete from stock_movements`)),
    ).rejects.toThrow();
  });
});
