import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

async function setup({ enable = true } = {}) {
  const c = await createCompany(app, db, mailer);
  const req = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    body?: unknown,
    cookies = c.cookies,
  ) => c.client.request(method, path, { cookies, ...(body === undefined ? {} : { body }) });
  const ok = async (
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    cookies = c.cookies,
  ) => {
    const r = await req(method, path, body, cookies);
    if (r.statusCode >= 300) throw new Error(`${method} ${path} ${r.statusCode} ${r.body}`);
    return r.json();
  };
  if (enable)
    await ok('PUT', '/manager/restaurant/settings', {
      enabled: true,
      autoSendOnPayment: true,
      version: 0,
    });
  const food = (await ok('POST', '/manager/categories', { nameEn: 'Food' })).id;
  const drinks = (await ok('POST', '/manager/categories', { nameEn: 'Drinks' })).id;
  const product = async (body: Record<string, unknown>) =>
    (await ok('POST', '/manager/products', body)).variants[0].id as string;
  const bun = await product({ nameEn: 'Bun', variants: [{ price: '0.200', cost: '0.100' }] });
  const patty = await product({ nameEn: 'Patty', variants: [{ price: '1.000', cost: '0.500' }] });
  const cheese = await product({
    nameEn: 'Cheese slice',
    variants: [{ price: '0.100', cost: '0.050' }],
  });
  const cola = await product({
    nameEn: 'Cola',
    categoryId: drinks,
    variants: [{ price: '0.500', cost: '0.150' }],
  });
  const burgerProduct = await ok('POST', '/manager/products', {
    nameEn: 'Burger',
    categoryId: food,
    trackInventory: false,
    variants: [{ price: '2.000' }],
  });
  const burger = burgerProduct.variants[0].id as string;
  await ok('POST', '/manager/inventory/adjustments', {
    branchId: c.main,
    kind: 'opening',
    reason: 'opening',
    lines: [
      { variantId: bun, quantity: '50', unitCost: '0.100' },
      { variantId: patty, quantity: '50', unitCost: '0.500' },
      { variantId: cheese, quantity: '100', unitCost: '0.050' },
      { variantId: cola, quantity: '50', unitCost: '0.150' },
    ],
  });
  const doneness = await ok('POST', '/manager/restaurant/modifier-groups', {
    nameEn: 'Doneness',
    minSelect: 1,
    maxSelect: 1,
    modifiers: [{ nameEn: 'Medium' }, { nameEn: 'Well done' }],
  });
  const addons = await ok('POST', '/manager/restaurant/modifier-groups', {
    nameEn: 'Add-ons',
    minSelect: 0,
    maxSelect: 3,
    modifiers: [
      {
        nameEn: 'Extra cheese',
        price: '0.250',
        componentVariantId: cheese,
        componentQuantity: '2',
      },
      { nameEn: 'Bacon', price: '0.500' },
    ],
  });
  await ok('PUT', `/manager/restaurant/menu/${burgerProduct.id}`, {
    modifierGroupIds: [doneness.id, addons.id],
    recipes: [
      {
        variantId: burger,
        components: [
          { componentVariantId: bun, quantity: '1' },
          { componentVariantId: patty, quantity: '1' },
        ],
      },
    ],
  });
  const area = (await ok('POST', '/manager/restaurant/areas', { branchId: c.main, nameEn: 'Hall' }))
    .areas[0].id;
  for (const code of ['T1', 'T2', 'T3'])
    await ok('POST', '/manager/restaurant/tables', { areaId: area, code, seats: 4 });
  await ok('POST', '/manager/restaurant/stations', {
    branchId: c.main,
    nameEn: 'Kitchen',
    isDefault: true,
  });
  const layout = await ok('POST', '/manager/restaurant/stations', {
    branchId: c.main,
    nameEn: 'Bar',
    categoryIds: [drinks],
  });
  const methods = (await ok('GET', '/manager/payment-methods')).methods as {
    id: string;
    kind: string;
  }[];
  const mod = (g: { modifiers: { id: string; nameEn: string }[] }, name: string) =>
    g.modifiers.find((m) => m.nameEn === name)!.id;
  return {
    c,
    req,
    ok,
    bun,
    patty,
    cheese,
    cola,
    burger,
    burgerProductId: burgerProduct.id as string,
    medium: mod(doneness, 'Medium'),
    extraCheese: mod(addons, 'Extra cheese'),
    bacon: mod(addons, 'Bacon'),
    tables: Object.fromEntries(
      (layout.tables as { id: string; code: string }[]).map((t) => [t.code, t.id]),
    ) as Record<string, string>,
    stations: Object.fromEntries(
      (layout.stations as { id: string; nameEn: string }[]).map((s) => [s.nameEn, s.id]),
    ) as Record<string, string>,
    cash: methods.find((m) => m.kind === 'cash')!.id,
    card: methods.find((m) => m.kind === 'card')!.id,
  };
}
type S = Awaited<ReturnType<typeof setup>>;

async function staff(s: S, role: keyof Co['roles'] | 'kitchen', shift = true) {
  const roles = (await s.ok('GET', '/manager/roles')).roles as {
    id: string;
    templateKey: string;
  }[];
  const emp = await s.c.hire(
    [{ roleId: roles.find((r) => r.templateKey === role)!.id, branchId: s.c.main }],
    'pos',
  );
  if (shift) {
    // Each till person gets their own register.
    const reg = (
      await s.ok('POST', '/manager/registers', {
        branchId: s.c.main,
        code: `R${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        nameEn: 'Till',
      })
    ).id as string;
    const opened = await s.req(
      'POST',
      '/pos/shifts',
      { registerId: reg, countedCash: '20.000', expectedCash: '0.000' },
      emp.cookies,
    );
    if (opened.statusCode !== 201) throw new Error(opened.body);
  }
  return emp.cookies;
}

async function onHand(s: S, variantId: string) {
  const r = await s.ok('GET', `/manager/inventory/variants/${variantId}`);
  return r.branches.find((b: { branchId: string }) => b.branchId === s.c.main)?.onHand as string;
}

const count = async (sql: string, params: unknown[]) =>
  Number((await owner.query(sql, params)).rows[0].n);

describe('restaurant orders', () => {
  it('runs a table from order to kitchen to a split bill, with exact money and stock', async () => {
    const s = await setup();
    const cashier = await staff(s, 'cashier');
    const kitchen = await staff(s, 'kitchen', false);
    const pos = (m: 'GET' | 'POST', p: string, b?: unknown, ck: Cookies = cashier) =>
      s.req(m, p, b, ck);

    const open = await pos('POST', '/pos/restaurant/orders', {
      orderType: 'dine_in',
      tableId: s.tables['T1'],
      guests: 2,
    });
    expect(open.statusCode, open.body).toBe(201);
    let order = open.json();
    expect(order).toMatchObject({
      orderType: 'dine_in',
      tableCode: 'T1',
      status: 'open',
      number: 'R-000001',
    });
    expect(
      (
        await pos('POST', '/pos/restaurant/orders', {
          orderType: 'dine_in',
          tableId: s.tables['T1'],
        })
      ).json().code,
    ).toBe('TABLE_OCCUPIED');

    // Required doneness missing; a modifier from another item.
    const bad = await pos('POST', `/pos/restaurant/orders/${order.id}/items`, {
      version: order.version,
      items: [{ variantId: s.burger, quantity: '1', modifierIds: [s.extraCheese] }],
    });
    expect(bad.json().code).toBe('MODIFIER_INVALID');
    const foreign = await pos('POST', `/pos/restaurant/orders/${order.id}/items`, {
      version: order.version,
      items: [{ variantId: s.cola, quantity: '1', modifierIds: [s.bacon] }],
    });
    expect(foreign.json().code).toBe('MODIFIER_INVALID');

    const added = await pos('POST', `/pos/restaurant/orders/${order.id}/items`, {
      version: order.version,
      items: [
        {
          variantId: s.burger,
          quantity: '2',
          modifierIds: [s.medium, s.extraCheese],
          note: 'no onions',
        },
        { variantId: s.cola, quantity: '1' },
      ],
    });
    expect(added.statusCode, added.body).toBe(201);
    order = added.json();
    // 2 × (2.000 + 0.250) + 0.500 = 5.000
    expect(order.due.amount).toBe('5.000');
    expect(order.items[0]).toMatchObject({
      unitPrice: { amount: '2.250' },
      lineTotal: { amount: '4.500' },
      kitchenStatus: 'pending',
      note: 'no onions',
    });
    // A stale version is refused (two tablets editing the same table).
    expect(
      (
        await pos('POST', `/pos/restaurant/orders/${order.id}/items`, {
          version: 1,
          items: [{ variantId: s.cola, quantity: '1' }],
        })
      ).statusCode,
    ).toBe(409);

    // Send: burgers to the kitchen, cola to the bar; sending again creates nothing.
    order = (await pos('POST', `/pos/restaurant/orders/${order.id}/send`)).json();
    expect(order.items.map((i: { kitchenStatus: string }) => i.kitchenStatus)).toEqual([
      'queued',
      'queued',
    ]);
    await pos('POST', `/pos/restaurant/orders/${order.id}/send`);
    expect(
      await count('select count(*) as n from kitchen_tickets where merchant_id = $1', [
        s.c.merchantId,
      ]),
    ).toBe(2);
    // Nothing leaves stock before payment.
    expect(await onHand(s, s.bun)).toBe('50.000');
    expect(await onHand(s, s.cola)).toBe('50.000');

    // Kitchen display: tickets per station with notes and modifiers.
    const board = await s.ok(
      'GET',
      `/pos/kitchen/tickets?stationId=${s.stations['Kitchen']}`,
      undefined,
      kitchen,
    );
    expect(board.tickets).toHaveLength(1);
    const ticket = board.tickets[0];
    expect(ticket).toMatchObject({ orderType: 'dine_in', tableCode: 'T1', status: 'new' });
    expect(ticket.items[0]).toMatchObject({ quantity: '2.000', note: 'no onions' });
    expect(ticket.items[0].modifiers.map((m: { nameEn: string }) => m.nameEn).sort()).toEqual([
      'Extra cheese',
      'Medium',
    ]);
    let t = await s.ok(
      'POST',
      `/pos/kitchen/tickets/${ticket.id}/status`,
      { status: 'preparing', version: ticket.version },
      kitchen,
    );
    expect(t.startedAt).not.toBeNull();
    t = await s.ok(
      'POST',
      `/pos/kitchen/tickets/${ticket.id}/status`,
      { status: 'ready', version: t.version },
      kitchen,
    );
    t = await s.ok(
      'POST',
      `/pos/kitchen/tickets/${ticket.id}/status`,
      { status: 'completed', version: t.version },
      kitchen,
    );
    expect(t).toMatchObject({ status: 'completed' });
    expect(t.readyAt).not.toBeNull();
    expect(t.completedAt).not.toBeNull();
    // A late duplicate tap changes nothing; the kitchen never creates sales or payments.
    const again = await s.ok(
      'POST',
      `/pos/kitchen/tickets/${ticket.id}/status`,
      { status: 'ready', version: 1 },
      kitchen,
    );
    expect(again.status).toBe('completed');
    expect(
      await count('select count(*) as n from sales where merchant_id = $1', [s.c.merchantId]),
    ).toBe(0);
    expect(
      await count('select count(*) as n from payments where merchant_id = $1', [s.c.merchantId]),
    ).toBe(0);
    expect(
      (
        await pos('POST', `/pos/kitchen/tickets/${ticket.id}/status`, {
          status: 'ready',
          version: 1,
        })
      ).statusCode,
    ).toBe(403);

    // More drinks for the same table later.
    order = (
      await pos('POST', `/pos/restaurant/orders/${order.id}/items`, {
        version: (await s.ok('GET', `/pos/restaurant/orders/${order.id}`, undefined, cashier))
          .version,
        items: [{ variantId: s.cola, quantity: '1' }],
      })
    ).json();
    order = (await pos('POST', `/pos/restaurant/orders/${order.id}/send`)).json();
    expect(
      await count('select count(*) as n from kitchen_tickets where merchant_id = $1', [
        s.c.merchantId,
      ]),
    ).toBe(3);
    expect(order.due.amount).toBe('5.500');

    // Split bill 1: the burgers, cash.
    const burgers = order.items
      .filter((i: { variantId: string }) => i.variantId === s.burger)
      .map((i: { id: string }) => i.id);
    const colas = order.items
      .filter((i: { variantId: string }) => i.variantId === s.cola)
      .map((i: { id: string }) => i.id);
    const quote = (
      await pos('POST', `/pos/restaurant/orders/${order.id}/quote`, { itemIds: burgers })
    ).json();
    expect(quote.total.amount).toBe('4.500');
    const key = newId();
    const bill1 = await pos('POST', `/pos/restaurant/orders/${order.id}/pay`, {
      idempotencyKey: key,
      itemIds: burgers,
      payments: [{ methodId: s.cash, amount: '4.500', tendered: '5.000' }],
      expectedTotal: '4.500',
    });
    expect(bill1.statusCode, bill1.body).toBe(201);
    const sale1 = bill1.json().sale;
    expect(sale1).toMatchObject({
      total: { amount: '4.500' },
      change: { amount: '0.500' },
      serviceType: 'dine_in',
      restaurantOrderId: order.id,
    });
    expect(sale1.lines[0]).toMatchObject({ unitPrice: { amount: '2.250' }, quantity: '2.000' });
    expect(sale1.lines[0].modifiers.map((m: { nameEn: string }) => m.nameEn).sort()).toEqual([
      'Extra cheese',
      'Medium',
    ]);
    expect(bill1.json().order.status).toBe('open');
    // The same request again returns the same bill; paying the burgers again is refused.
    const replay = await pos('POST', `/pos/restaurant/orders/${order.id}/pay`, {
      idempotencyKey: key,
      itemIds: burgers,
      payments: [{ methodId: s.cash, amount: '4.500', tendered: '5.000' }],
      expectedTotal: '4.500',
    });
    expect(replay.json().sale.id).toBe(sale1.id);
    const twice = await pos('POST', `/pos/restaurant/orders/${order.id}/pay`, {
      idempotencyKey: newId(),
      itemIds: burgers,
      payments: [{ methodId: s.cash, amount: '4.500' }],
      expectedTotal: '4.500',
    });
    expect(twice.json().code).toBe('ITEM_ALREADY_PAID');

    // Split bill 2: the colas, split between card and cash.
    const bill2 = await pos('POST', `/pos/restaurant/orders/${order.id}/pay`, {
      idempotencyKey: newId(),
      itemIds: colas,
      payments: [
        { methodId: s.card, amount: '0.400', reference: 'AUTH1' },
        { methodId: s.cash, amount: '0.600' },
      ],
      expectedTotal: '1.000',
    });
    expect(bill2.statusCode, bill2.body).toBe(201);
    const closed = bill2.json().order;
    expect(closed).toMatchObject({
      status: 'closed',
      paid: { amount: '5.500' },
      due: { amount: '0.000' },
    });
    expect(closed.bills).toHaveLength(2);
    // Revenue = the two bills, exactly once.
    const sales = await owner.query(
      `select count(*)::int as n, sum(total_minor)::text as total from sales where merchant_id = $1 and restaurant_order_id = $2`,
      [s.c.merchantId, order.id],
    );
    expect(sales.rows[0]).toEqual({ n: 2, total: '5500' });
    const pays = await owner.query(
      `select sum(amount_minor)::text as total from payments where merchant_id = $1`,
      [s.c.merchantId],
    );
    expect(pays.rows[0].total).toBe('5500');

    // Stock moved once, at payment: recipe and modifier ingredients, not the burger itself.
    expect(await onHand(s, s.bun)).toBe('48.000');
    expect(await onHand(s, s.patty)).toBe('48.000');
    expect(await onHand(s, s.cheese)).toBe('96.000');
    expect(await onHand(s, s.cola)).toBe('48.000');
    // Cost: burger 0.100 + 0.500 + 2 × 0.050 = 0.700 each.
    const cost = await owner.query(`select cost_minor::text as c from sales where id = $1`, [
      sale1.id,
    ]);
    expect(cost.rows[0].c).toBe('1400');

    // The table is free again; the manager sees the restaurant sales.
    const floor = await s.ok('GET', '/pos/restaurant/floor', undefined, cashier);
    expect(floor.areas[0].tables.find((x: { code: string }) => x.code === 'T1').order).toBeNull();
    const list = await s.ok('GET', '/manager/sales?serviceType=dine_in');
    expect(list.totals.amount.amount).toBe('5.500');
    expect(list.sales.every((x: { serviceType: string }) => x.serviceType === 'dine_in')).toBe(
      true,
    );
    const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
    const report = await s.ok('GET', `/manager/reports/sales?from=${today}&to=${today}`);
    expect(report.summary.netSales.amount).toBe('5.500');
    expect(report.byServiceType).toEqual([
      expect.objectContaining({
        serviceType: 'dine_in',
        saleCount: 2,
        netSales: expect.objectContaining({ amount: '5.500' }),
      }),
    ]);
  });

  it('moves, merges and cancels without creating revenue; waste is deducted once', async () => {
    const s = await setup();
    const cashier = await staff(s, 'cashier');
    const supervisor = await staff(s, 'supervisor');
    const pos = (m: 'GET' | 'POST', p: string, b?: unknown, ck: Cookies = cashier) =>
      s.req(m, p, b, ck);
    const a = (
      await pos('POST', '/pos/restaurant/orders', { orderType: 'dine_in', tableId: s.tables['T1'] })
    ).json();
    let b = (
      await pos('POST', '/pos/restaurant/orders', { orderType: 'dine_in', tableId: s.tables['T2'] })
    ).json();
    await pos('POST', `/pos/restaurant/orders/${a.id}/items`, {
      version: a.version,
      items: [{ variantId: s.burger, quantity: '1', modifierIds: [s.medium] }],
    });
    b = (
      await pos('POST', `/pos/restaurant/orders/${b.id}/items`, {
        version: b.version,
        items: [{ variantId: s.cola, quantity: '2' }],
      })
    ).json();

    expect(
      (
        await pos('POST', `/pos/restaurant/orders/${b.id}/move`, {
          version: b.version,
          tableId: s.tables['T1'],
        })
      ).json().code,
    ).toBe('TABLE_OCCUPIED');
    b = (
      await pos('POST', `/pos/restaurant/orders/${b.id}/move`, {
        version: b.version,
        tableId: s.tables['T3'],
      })
    ).json();
    expect(b.tableCode).toBe('T3');

    const current = await s.ok('GET', `/pos/restaurant/orders/${a.id}`, undefined, cashier);
    const merged = await pos('POST', `/pos/restaurant/orders/${a.id}/merge`, {
      version: current.version,
      sourceOrderId: b.id,
    });
    expect(merged.statusCode, merged.body).toBe(201);
    expect(merged.json().items.map((i: { variantId: string }) => i.variantId)).toEqual([
      s.burger,
      s.cola,
    ]);
    expect(merged.json().due.amount).toBe('3.000');
    expect(
      (
        await owner.query(`select status, merged_into_id from restaurant_orders where id = $1`, [
          b.id,
        ])
      ).rows[0],
    ).toEqual({ status: 'merged', merged_into_id: a.id });
    const floor = await s.ok('GET', '/pos/restaurant/floor', undefined, cashier);
    expect(
      floor.areas[0].tables
        .filter((x: { order: unknown }) => x.order !== null)
        .map((x: { code: string }) => x.code),
    ).toEqual(['T1']);

    // Cancel the unsent cola: no stock effect.
    const colaItem = merged.json().items[1].id;
    await pos('POST', `/pos/restaurant/orders/${a.id}/items/${colaItem}/cancel`, {
      reason: 'changed mind',
    });
    expect(await onHand(s, s.cola)).toBe('50.000');
    // The burger was prepared: a cashier cannot void it; a supervisor records it as waste.
    await pos('POST', `/pos/restaurant/orders/${a.id}/send`);
    const burgerItem = merged.json().items[0].id;
    expect(
      (
        await pos('POST', `/pos/restaurant/orders/${a.id}/items/${burgerItem}/cancel`, {
          reason: 'dropped',
          waste: true,
        })
      ).statusCode,
    ).toBe(403);
    const voided = await pos(
      'POST',
      `/pos/restaurant/orders/${a.id}/items/${burgerItem}/cancel`,
      { reason: 'dropped', waste: true },
      supervisor,
    );
    expect(voided.statusCode, voided.body).toBe(201);
    expect(voided.json().items[0]).toMatchObject({ kitchenStatus: 'cancelled', wasted: true });
    expect(await onHand(s, s.bun)).toBe('49.000');
    expect(await onHand(s, s.patty)).toBe('49.000');
    const moves = await owner.query(
      `select movement_type, reason from stock_movements where merchant_id = $1 and source_type = 'restaurant_item'`,
      [s.c.merchantId],
    );
    expect(moves.rows).toEqual([
      { movement_type: 'adjustment', reason: 'restaurant_waste' },
      { movement_type: 'adjustment', reason: 'restaurant_waste' },
    ]);
    expect(
      (await owner.query(`select status from kitchen_tickets where order_id = $1`, [a.id])).rows[0]
        .status,
    ).toBe('cancelled');
    // Cancelled items are final.
    expect(
      (
        await pos(
          'POST',
          `/pos/restaurant/orders/${a.id}/items/${burgerItem}/cancel`,
          { reason: 'x' },
          supervisor,
        )
      ).statusCode,
    ).toBe(409);
    // Nothing was ever sold; the empty order can be cancelled.
    expect(
      await count('select count(*) as n from sales where merchant_id = $1', [s.c.merchantId]),
    ).toBe(0);
    const latest = await s.ok('GET', `/pos/restaurant/orders/${a.id}`, undefined, cashier);
    expect(
      (await pos('POST', `/pos/restaurant/orders/${a.id}/cancel`, { version: latest.version }))
        .statusCode,
    ).toBe(204);

    // An order with a paid bill cannot be merged away.
    const c1 = (
      await pos('POST', '/pos/restaurant/orders', { orderType: 'takeaway', label: 'Ali' })
    ).json();
    const c2 = (
      await pos('POST', '/pos/restaurant/orders', { orderType: 'takeaway', label: 'Sara' })
    ).json();
    const withItems = (
      await pos('POST', `/pos/restaurant/orders/${c2.id}/items`, {
        version: c2.version,
        items: [
          { variantId: s.cola, quantity: '1' },
          { variantId: s.cola, quantity: '1' },
        ],
      })
    ).json();
    await pos('POST', `/pos/restaurant/orders/${c2.id}/pay`, {
      idempotencyKey: newId(),
      itemIds: [withItems.items[0].id],
      payments: [{ methodId: s.cash, amount: '0.500' }],
      expectedTotal: '0.500',
    });
    const c1v = (await s.ok('GET', `/pos/restaurant/orders/${c1.id}`, undefined, cashier)).version;
    expect(
      (
        await pos('POST', `/pos/restaurant/orders/${c1.id}/merge`, {
          version: c1v,
          sourceOrderId: c2.id,
        })
      ).json().code,
    ).toBe('INVALID_STATE');
    // Takeaway: the paid item went to the bar automatically.
    const after = await s.ok('GET', `/pos/restaurant/orders/${c2.id}`, undefined, cashier);
    expect(after.items.map((i: { kitchenStatus: string }) => i.kitchenStatus)).toEqual([
      'queued',
      'queued',
    ]);
  });

  it('never bills the same items twice under concurrency', async () => {
    const s = await setup();
    const one = await staff(s, 'cashier');
    const two = await staff(s, 'cashier');
    const order = (
      await s.req('POST', '/pos/restaurant/orders', { orderType: 'takeaway' }, one)
    ).json();
    const full = (
      await s.req(
        'POST',
        `/pos/restaurant/orders/${order.id}/items`,
        { version: order.version, items: [{ variantId: s.cola, quantity: '3' }] },
        one,
      )
    ).json();
    const body = () => ({
      idempotencyKey: newId(),
      itemIds: [full.items[0].id],
      payments: [{ methodId: s.cash, amount: '1.500' }],
      expectedTotal: '1.500',
    });
    const results = await Promise.all([
      s.req('POST', `/pos/restaurant/orders/${order.id}/pay`, body(), one),
      s.req('POST', `/pos/restaurant/orders/${order.id}/pay`, body(), two),
      s.req('POST', `/pos/restaurant/orders/${order.id}/pay`, body(), one),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409, 409]);
    expect(
      await count('select count(*) as n from sales where merchant_id = $1', [s.c.merchantId]),
    ).toBe(1);
    expect(await onHand(s, s.cola)).toBe('47.000');
  });
});

describe('restaurant access and configuration', () => {
  it('enforces the module switch, roles, branch scope and tenant isolation', async () => {
    const off = await setup({ enable: false });
    const offCashier = await staff(off, 'cashier');
    expect((await off.req('GET', '/pos/restaurant/floor', undefined, offCashier)).json().code).toBe(
      'MODULE_DISABLED',
    );
    expect(
      (
        await off.req('POST', '/pos/restaurant/orders', { orderType: 'takeaway' }, offCashier)
      ).json().code,
    ).toBe('MODULE_DISABLED');

    const s = await setup();
    const kitchen = await staff(s, 'kitchen', false);
    expect(
      (await s.req('POST', '/pos/restaurant/orders', { orderType: 'takeaway' }, kitchen))
        .statusCode,
    ).toBe(403);
    expect((await s.req('GET', '/pos/kitchen/tickets', undefined, kitchen)).statusCode).toBe(200);
    const cashier = await staff(s, 'cashier');
    const order = (
      await s.req('POST', '/pos/restaurant/orders', { orderType: 'takeaway' }, cashier)
    ).json();

    // Branch manager: tables at their branch only; merchant-wide config is not theirs.
    const bm = await s.c.hire(
      [{ roleId: s.c.roles.branch_manager, branchId: s.c.second }],
      'manager',
    );
    const area2 = await s.req(
      'POST',
      '/manager/restaurant/areas',
      { branchId: s.c.second, nameEn: 'Terrace' },
      bm.cookies,
    );
    expect(area2.statusCode).toBe(201);
    expect(
      (
        await s.req(
          'POST',
          '/manager/restaurant/areas',
          { branchId: s.c.main, nameEn: 'X' },
          bm.cookies,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await s.req(
          'POST',
          '/manager/restaurant/modifier-groups',
          { nameEn: 'G', modifiers: [{ nameEn: 'm' }] },
          bm.cookies,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await s.req(
          'PUT',
          '/manager/restaurant/settings',
          { enabled: false, autoSendOnPayment: true, version: 1 },
          bm.cookies,
        )
      ).statusCode,
    ).toBe(403);
    // Another merchant's item id cannot be referenced (foreign keys ignore RLS; audit fix).
    const stranger = await setup();
    const foreign = await s.req('POST', '/manager/restaurant/modifier-groups', {
      nameEn: 'Foreign',
      modifiers: [{ nameEn: 'x', componentVariantId: stranger.cola, componentQuantity: '1' }],
    });
    expect(foreign.statusCode).toBe(400);
    // A recipe on a stock-tracked item would deduct twice: refused.
    const colaProduct = (await s.ok('GET', `/manager/inventory/variants/${s.cola}`)).productId;
    const recipe = await s.req('PUT', `/manager/restaurant/menu/${colaProduct}`, {
      modifierGroupIds: [],
      recipes: [
        { variantId: s.cola, components: [{ componentVariantId: s.cheese, quantity: '1' }] },
      ],
    });
    expect(recipe.statusCode).toBe(409);
    // Duplicate table code at a branch.
    const layout = await s.ok('GET', `/manager/restaurant/layout?branchId=${s.c.main}`);
    expect(
      (
        await s.req('POST', '/manager/restaurant/tables', {
          areaId: layout.areas[0].id,
          code: 't1',
        })
      ).json().code,
    ).toBe('DUPLICATE_CODE');

    // Another merchant sees nothing.
    const other = await setup();
    const otherCashier = await staff(other, 'cashier');
    expect(
      (await other.req('GET', `/pos/restaurant/orders/${order.id}`, undefined, otherCashier))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await other.req(
          'POST',
          '/pos/restaurant/orders',
          { orderType: 'dine_in', tableId: s.tables['T1'] },
          otherCashier,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await other.req('PUT', `/manager/restaurant/menu/${s.burgerProductId}`, {
          modifierGroupIds: [],
          recipes: [],
        })
      ).statusCode,
    ).toBe(404);
  });
});
