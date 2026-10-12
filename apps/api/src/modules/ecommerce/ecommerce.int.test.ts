import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createHmac } from 'node:crypto';
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
const SECRET = 'integration-mock-gateway-secret';

beforeAll(async () => {
  const prepared = await prepareIntegrationDatabase();
  owner = prepared.owner;
  db = new DbFixtures(owner);
  mailer = new InMemoryMailer();
  app = await createTestApp({
    env: testEnv({
      DATABASE_URL: prepared.runtimeUrl,
      DATABASE_POOL_MAX: '20',
      PAYMENT_MOCK_SECRET: SECRET,
    }),
    mailer,
  });
});
afterAll(async () => {
  await app?.close();
  await owner?.end();
});

type Co = Awaited<ReturnType<typeof createCompany>>;
type Cookies = Co['cookies'];
let seq = 0;

async function setup() {
  const c = await createCompany(app, db, mailer);
  const req = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    body?: unknown,
    cookies: Cookies | undefined = c.cookies,
  ) =>
    c.client.request(method, path, {
      ...(cookies ? { cookies } : {}),
      ...(body === undefined ? {} : { body }),
    });
  const ok = async (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    body?: unknown,
    cookies: Cookies | undefined = c.cookies,
  ) => {
    const r = await req(method, path, body, cookies);
    if (r.statusCode >= 300) throw new Error(`${method} ${path} ${r.statusCode} ${r.body}`);
    return r.json();
  };
  const teaProduct = await ok('POST', '/manager/products', {
    nameEn: 'Saffron tea',
    variants: [{ sku: 'TEA', price: '1.250', cost: '0.400' }],
  });
  const tea = teaProduct.variants[0];
  const mug = await ok('POST', '/manager/products', {
    nameEn: 'Gift card',
    type: 'service',
    trackInventory: false,
    variants: [{ sku: 'GIFT', price: '5.000' }],
  });
  const hidden = await ok('POST', '/manager/products', {
    nameEn: 'Staff only',
    variants: [{ sku: 'HID', price: '9.000' }],
  });
  await ok('POST', '/manager/inventory/adjustments', {
    branchId: c.main,
    kind: 'opening',
    reason: 'opening',
    lines: [{ variantId: tea.id, quantity: '5', unitCost: '0.400' }],
  });
  const methods = (await ok('GET', '/manager/payment-methods')).methods as Record<
    string,
    unknown
  >[];
  const card = methods.find((m) => m['kind'] === 'card')!;
  const online = await ok('PATCH', `/manager/payment-methods/${card['id'] as string}`, {
    kind: 'card',
    nameEn: 'Online card (test)',
    availableOnline: true,
    gatewayProvider: 'mock',
    feeType: 'percentage',
    feePercent: '2',
    version: card['version'],
  });
  const slug = `shop-${Date.now().toString(36)}-${(seq += 1)}`;
  await ok('PUT', '/manager/online/listings', {
    productIds: [teaProduct.id, mug.id],
    listed: true,
  });
  await ok('PUT', '/manager/online/store', {
    slug,
    status: 'published',
    nameEn: 'Saffron House',
    primaryColor: '#7c2d12',
    fulfillmentBranchId: c.main,
    pickupEnabled: true,
    deliveryEnabled: true,
    deliveryFee: '0.500',
    minimumOrder: '1.000',
    reservationMinutes: 30,
    version: 0,
  });
  return {
    c,
    req,
    ok,
    slug,
    teaProduct: teaProduct.id as string,
    tea: tea.id as string,
    gift: mug.variants[0].id as string,
    hidden: hidden.variants[0].id as string,
    method: online.id as string,
    cash: methods.find((m) => m['kind'] === 'cash')!['id'] as string,
  };
}
/** Delivers a provider notification signed like the mock gateway (exact bytes). */
function notify(s: S, payload: Record<string, unknown>, signature?: string) {
  const body = JSON.stringify(payload);
  return s.c.client.request('POST', '/webhooks/payments/mock', {
    body,
    headers: {
      'content-type': 'application/json',
      'x-mock-signature': signature ?? createHmac('sha256', SECRET).update(body).digest('hex'),
    },
  });
}
type S = Awaited<ReturnType<typeof setup>>;

const pub = (s: S, method: 'GET' | 'POST', path: string, body?: unknown) =>
  s.req(method, `/store/${s.slug}${path}`, body, undefined);

function checkout(s: S, overrides: Record<string, unknown> = {}) {
  return pub(s, 'POST', '/checkout', {
    idempotencyKey: newId(),
    lines: [{ variantId: s.tea, quantity: '2' }],
    fulfillment: 'delivery',
    customer: { name: 'Mariam', phone: '6000 1111', email: 'mariam@example.com' },
    deliveryAddress: 'Block 3, Street 10, Salmiya',
    paymentMethodId: s.method,
    expectedTotal: '3.000',
    ...overrides,
  });
}

/** The provider reference of the order's open attempt (from the payment URL). */
const referenceOf = (order: { paymentUrl: string }) => /\/pay\/([^?]+)/.exec(order.paymentUrl)![1]!;

async function onHand(s: S, variantId = s.tea) {
  const r = await s.ok('GET', `/manager/inventory/variants/${variantId}`);
  return r.branches.find((b: { branchId: string }) => b.branchId === s.c.main)?.onHand as string;
}

async function till(s: S) {
  const emp = await s.c.hire([{ roleId: s.c.roles.cashier, branchId: s.c.main }], 'pos');
  const registers = (await s.ok('GET', `/manager/registers?branchId=${s.c.main}`)).registers as {
    id: string;
  }[];
  await s.ok(
    'POST',
    '/pos/shifts',
    { registerId: registers[0]!.id, openingFloat: '10.000' },
    emp.cookies,
  );
  return emp.cookies;
}

const count = async (sql: string, params: unknown[]) =>
  Number((await owner.query(sql, params)).rows[0].n);

describe('storefront', () => {
  it('shows only listed, available products of a published store and isolates merchants', async () => {
    const s = await setup();
    const store = (await pub(s, 'GET', '')).json();
    expect(store).toMatchObject({
      nameEn: 'Saffron House',
      acceptingOrders: true,
      deliveryFee: { amount: '0.500' },
    });
    expect(store.paymentMethods.map((m: { provider: string }) => m.provider)).toEqual(['mock']);
    const products = (await pub(s, 'GET', '/products')).json().products;
    expect(products.map((p: { nameEn: string }) => p.nameEn).sort()).toEqual([
      'Gift card',
      'Saffron tea',
    ]);
    const tea = products.find((p: { nameEn: string }) => p.nameEn === 'Saffron tea');
    expect(tea.variants[0]).toMatchObject({
      price: { amount: '1.250' },
      available: true,
      maxQuantity: 5,
    });
    // Unlisted products cannot be bought.
    const hidden = await checkout(s, {
      lines: [{ variantId: s.hidden, quantity: '1' }],
      expectedTotal: '9.500',
    });
    expect(hidden.json().code).toBe('ITEM_UNAVAILABLE');
    expect((await s.req('GET', '/store/no-such-store', undefined, undefined)).statusCode).toBe(404);
    // A draft store is not public.
    const other = await setup();
    const st = await other.ok('GET', '/manager/online/store');
    await other.ok('PUT', '/manager/online/store', {
      ...st,
      ...{ deliveryFee: st.deliveryFee.amount, minimumOrder: st.minimumOrder.amount },
      status: 'draft',
    });
    expect((await pub(other, 'GET', '')).statusCode).toBe(404);
    // The other merchant's product ids do not exist in this store.
    expect((await pub(s, 'GET', `/products/${other.teaProduct}`)).statusCode).toBe(404);
  });
});

describe('online checkout and payments', () => {
  it('reserves stock against the POS, takes a test payment once and records an online sale', async () => {
    const s = await setup();
    const key = newId();
    const placed = await checkout(s, { idempotencyKey: key });
    expect(placed.statusCode, placed.body).toBe(201);
    const order = placed.json().order;
    expect(order).toMatchObject({
      number: 'W-000001',
      status: 'pending_payment',
      subtotal: { amount: '2.500' },
      deliveryFee: { amount: '0.500' },
      total: { amount: '3.000' },
    });
    expect(order.paymentUrl).toMatch(/\/store\/pay\/mock_[0-9a-f]+/);
    // Retrying the same checkout returns the same order; the key cannot be reused for another basket.
    expect((await checkout(s, { idempotencyKey: key })).json().order.number).toBe('W-000001');
    expect(
      (
        await checkout(s, {
          idempotencyKey: key,
          lines: [{ variantId: s.tea, quantity: '1' }],
          expectedTotal: '1.750',
        })
      ).json().code,
    ).toBe('IDEMPOTENCY_CONFLICT');
    // Price check and minimum order.
    expect((await checkout(s, { expectedTotal: '2.999' })).json().code).toBe('TOTAL_CHANGED');
    expect(
      (
        await checkout(s, {
          lines: [{ variantId: s.tea, quantity: '0.5' }],
          expectedTotal: '1.125',
        })
      ).json().code,
    ).toBe('INVALID_QUANTITY');

    // 5 on hand, 2 reserved: the POS can sell 3 but not 4; the store shows 3 left.
    const pos = await till(s);
    const sell = (q: string, total: string) =>
      s.req(
        'POST',
        '/pos/sales',
        {
          idempotencyKey: newId(),
          lines: [{ variantId: s.tea, quantity: q }],
          payments: [{ methodId: s.cash, amount: total }],
          expectedTotal: total,
        },
        pos,
      );
    expect((await sell('4', '5.000')).json().code).toBe('INSUFFICIENT_STOCK');
    expect(
      (await pub(s, 'GET', '/products'))
        .json()
        .products.find((p: { nameEn: string }) => p.nameEn === 'Saffron tea').variants[0]
        .maxQuantity,
    ).toBe(3);
    expect((await sell('3', '3.750')).statusCode).toBe(201);
    // Nothing left to reserve for a new online order.
    expect(
      (
        await checkout(s, { lines: [{ variantId: s.tea, quantity: '1' }], expectedTotal: '1.750' })
      ).json().code,
    ).toBe('INSUFFICIENT_STOCK');
    expect(await onHand(s)).toBe('2.000');

    // The customer pays on the test page.
    const ref = referenceOf(order);
    const page = (await s.req('GET', `/payments/mock/${ref}`, undefined, undefined)).json();
    expect(page).toMatchObject({
      orderNumber: 'W-000001',
      amount: { amount: '3.000' },
      status: 'initiated',
    });
    const done = (
      await s.req('POST', `/payments/mock/${ref}`, { outcome: 'succeeded' }, undefined)
    ).json();
    expect(done.status).toBe('succeeded');
    const tracked = (await pub(s, 'GET', `/orders/${order.trackingToken}`)).json();
    expect(tracked).toMatchObject({ status: 'paid', paymentUrl: null });
    expect(tracked.timeline.map((t: { status: string }) => t.status)).toEqual([
      'pending_payment',
      'paid',
    ]);

    // One online sale: items + delivery fee, gateway payment with the provider reference and fee.
    const sales = await owner.query(
      `select s.id, s.channel, s.total_minor::text as total, s.fees_minor::text as fees, s.shift_id, p.verification, p.reference
       from sales s join payments p on p.sale_id = s.id where s.merchant_id = $1 and s.channel = 'online'`,
      [s.c.merchantId],
    );
    expect(sales.rows).toHaveLength(1);
    expect(sales.rows[0]).toMatchObject({
      channel: 'online',
      total: '3000',
      fees: '60',
      shift_id: null,
      verification: 'gateway',
      reference: ref,
    });
    const sale = await s.ok('GET', `/manager/sales/${sales.rows[0].id}`);
    expect(sale.lines.map((l: { nameEn: string }) => l.nameEn)).toEqual([
      'Saffron tea',
      'Delivery fee',
    ]);
    expect(await onHand(s)).toBe('0.000');
    expect(
      await count(
        `select count(*) as n from stock_reservations where merchant_id = $1 and status = 'consumed'`,
        [s.c.merchantId],
      ),
    ).toBe(1);

    // The same notification again (provider retry) changes nothing; forged ones are refused.
    const event = {
      id: 'evt_retry_1',
      reference: ref,
      status: 'succeeded',
      amount: '3000',
      currency: 'KWD',
      failureReason: null,
    };
    expect((await notify(s, event)).json()).toMatchObject({
      duplicate: false,
      outcome: 'already_settled',
    });
    expect((await notify(s, event)).json()).toMatchObject({ duplicate: true });
    expect((await notify(s, event, 'f'.repeat(64))).statusCode).toBe(401);
    // A body altered after signing fails verification.
    const signed = createHmac('sha256', SECRET).update(JSON.stringify(event)).digest('hex');
    expect((await notify(s, { ...event, amount: '1' }, signed)).statusCode).toBe(401);
    expect(
      await count(`select count(*) as n from sales where merchant_id = $1 and channel = 'online'`, [
        s.c.merchantId,
      ]),
    ).toBe(1);

    // Reports and the sales list keep POS and online apart.
    const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
    const report = await s.ok('GET', `/manager/reports/sales?from=${today}&to=${today}`);
    expect(report.byChannel).toEqual([
      { channel: 'pos', saleCount: 1, netSales: { amount: '3.750', currency: 'KWD' } },
      { channel: 'online', saleCount: 1, netSales: { amount: '3.000', currency: 'KWD' } },
    ]);
    expect(report.summary.netSales.amount).toBe('6.750');
    const onlineSales = await s.ok('GET', '/manager/sales?channel=online');
    expect(onlineSales.sales).toEqual([
      expect.objectContaining({ channel: 'online', customerName: 'Mariam' }),
    ]);
    const payments = await s.ok('GET', `/manager/reports/payments?from=${today}&to=${today}`);
    expect(payments.collections.find((x: { kind: string }) => x.kind === 'card')).toMatchObject({
      collected: { amount: '3.000' },
      fees: { amount: '0.060' },
    });

    // The manager fulfils it; the customer sees the steps.
    const listed = await s.ok('GET', '/manager/online/orders');
    expect(listed.counts).toMatchObject({ paid: 1 });
    let managed = await s.ok('GET', `/manager/online/orders/${listed.orders[0].id}`);
    expect(managed).toMatchObject({
      status: 'paid',
      receiptNumber: expect.stringMatching(/^MAIN-/),
      customerPhone: '6000 1111',
    });
    expect(
      (
        await s.req('POST', `/manager/online/orders/${managed.id}/action`, {
          action: 'ready',
          version: managed.version,
        })
      ).json().code,
    ).toBe('INVALID_STATE');
    managed = await s.ok('POST', `/manager/online/orders/${managed.id}/action`, {
      action: 'preparing',
      version: managed.version,
    });
    managed = await s.ok('POST', `/manager/online/orders/${managed.id}/action`, {
      action: 'out_for_delivery',
      version: managed.version,
    });
    expect(
      (
        await s.req('POST', `/manager/online/orders/${managed.id}/action`, {
          action: 'cancel',
          version: managed.version,
        })
      ).json().code,
    ).toBe('INVALID_STATE');
    const completed = await s.ok('POST', `/manager/online/orders/${managed.id}/action`, {
      action: 'completed',
      version: managed.version,
    });
    expect(completed.status).toBe('completed');
    expect(
      (await pub(s, 'GET', `/orders/${order.trackingToken}`))
        .json()
        .timeline.map((t: { status: string }) => t.status),
    ).toEqual(['pending_payment', 'paid', 'preparing', 'out_for_delivery', 'completed']);
    // The customer profile was created from the checkout.
    const customers = await s.ok('GET', '/manager/customers?q=Mariam');
    expect(customers.customers[0]).toMatchObject({
      phone: '+96560001111',
      stats: { salesCount: 1 },
    });
  });

  it('handles declined, cancelled, wrong-amount and expired payments, and late payments', async () => {
    const s = await setup();
    // Declined: the order fails and the stock is released.
    const declined = (await checkout(s)).json().order;
    await s.req(
      'POST',
      `/payments/mock/${referenceOf(declined)}`,
      { outcome: 'failed' },
      undefined,
    );
    expect((await pub(s, 'GET', `/orders/${declined.trackingToken}`)).json().status).toBe(
      'payment_failed',
    );
    expect(
      await count(
        `select count(*) as n from stock_reservations where merchant_id = $1 and status = 'active'`,
        [s.c.merchantId],
      ),
    ).toBe(0);
    // Cancelled on the payment page.
    const cancelled = (await checkout(s)).json().order;
    await s.req(
      'POST',
      `/payments/mock/${referenceOf(cancelled)}`,
      { outcome: 'cancelled' },
      undefined,
    );
    expect((await pub(s, 'GET', `/orders/${cancelled.trackingToken}`)).json().status).toBe(
      'cancelled',
    );

    // A signed notification with a different amount never creates a sale.
    const odd = (await checkout(s)).json().order;
    const r = await notify(s, {
      id: 'evt_odd',
      reference: referenceOf(odd),
      status: 'succeeded',
      amount: '1',
      currency: 'KWD',
      failureReason: null,
    });
    expect(r.json().outcome).toBe('amount_mismatch');
    const oddOrder = (await s.ok('GET', '/manager/online/orders?status=needs_attention')).orders;
    expect(oddOrder.map((o: { number: string }) => o.number)).toEqual([odd.number]);

    // Expiry: past the reservation, reconciliation expires the order and frees the stock.
    const late = (await checkout(s)).json().order;
    expect(
      (await pub(s, 'GET', '/products'))
        .json()
        .products.find((p: { nameEn: string }) => p.nameEn === 'Saffron tea').variants[0]
        .maxQuantity,
    ).toBe(3);
    await owner.query(
      `update online_orders set reserved_until = now() - interval '1 minute' where merchant_id = $1 and number = $2`,
      [s.c.merchantId, late.number],
    );
    await owner.query(
      `update stock_reservations set expires_at = now() - interval '1 minute' where merchant_id = $1 and online_order_id = (select id from online_orders where merchant_id = $1 and number = $2)`,
      [s.c.merchantId, late.number],
    );
    expect(await s.ok('POST', '/manager/online/reconcile')).toMatchObject({ expired: 1 });
    expect((await pub(s, 'GET', `/orders/${late.trackingToken}`)).json().status).toBe('expired');
    expect(
      (await pub(s, 'GET', '/products'))
        .json()
        .products.find((p: { nameEn: string }) => p.nameEn === 'Saffron tea').variants[0]
        .maxQuantity,
    ).toBe(5);
    // The provider still confirms the old attempt: with stock still there, the order completes.
    expect(
      (
        await notify(s, {
          id: 'evt_late',
          reference: referenceOf(late),
          status: 'succeeded',
          amount: '3000',
          currency: 'KWD',
          failureReason: null,
        })
      ).json().outcome,
    ).toBe('paid');
    expect((await pub(s, 'GET', `/orders/${late.trackingToken}`)).json().status).toBe('paid');
    expect(await onHand(s)).toBe('3.000');

    // A late payment when the stock is gone: recorded, flagged, no sale, nothing oversold.
    const gone = (await checkout(s)).json().order;
    await owner.query(
      `update online_orders set reserved_until = now() - interval '1 minute' where merchant_id = $1 and number = $2`,
      [s.c.merchantId, gone.number],
    );
    await owner.query(
      `update stock_reservations set expires_at = now() - interval '1 minute' where merchant_id = $1 and status = 'active'`,
      [s.c.merchantId],
    );
    await s.ok('POST', '/manager/online/reconcile');
    const pos = await till(s);
    expect(
      (
        await s.req(
          'POST',
          '/pos/sales',
          {
            idempotencyKey: newId(),
            lines: [{ variantId: s.tea, quantity: '3' }],
            payments: [{ methodId: s.cash, amount: '3.750' }],
            expectedTotal: '3.750',
          },
          pos,
        )
      ).statusCode,
    ).toBe(201);
    const flagged = await notify(s, {
      id: 'evt_gone',
      reference: referenceOf(gone),
      status: 'succeeded',
      amount: '3000',
      currency: 'KWD',
      failureReason: null,
    });
    expect(flagged.json().outcome).toBe('needs_attention');
    expect((await pub(s, 'GET', `/orders/${gone.trackingToken}`)).json().status).toBe(
      'needs_attention',
    );
    expect(await onHand(s)).toBe('0.000');
    expect(
      await count(`select count(*) as n from sales where merchant_id = $1 and channel = 'online'`, [
        s.c.merchantId,
      ]),
    ).toBe(1);
    // The manager resolves it (refund at the provider) by cancelling.
    const flaggedOrder = (
      await s.ok('GET', '/manager/online/orders?status=needs_attention')
    ).orders.find((o: { number: string }) => o.number === gone.number);
    expect(
      (
        await s.req('POST', `/manager/online/orders/${flaggedOrder.id}/action`, {
          action: 'cancel',
          note: 'Refunded at the gateway',
          version: flaggedOrder.version,
        })
      ).statusCode,
    ).toBe(200);
  });

  it('refuses unconfigured gateways, closed stores and unauthorised managers', async () => {
    const s = await setup();
    // A Tap method is not ready (no approved credentials): hidden and refused.
    const tap = await s.ok('POST', '/manager/payment-methods', {
      kind: 'custom',
      nameEn: 'Tap',
      availableOnline: true,
      gatewayProvider: 'tap',
    });
    expect(
      (await pub(s, 'GET', '')).json().paymentMethods.map((m: { provider: string }) => m.provider),
    ).toEqual(['mock']);
    expect((await checkout(s, { paymentMethodId: tap.id })).json().code).toBe(
      'GATEWAY_NOT_CONFIGURED',
    );
    const store = await s.ok('GET', '/manager/online/store');
    expect(
      store.paymentMethods.find((m: { provider: string }) => m.provider === 'tap'),
    ).toMatchObject({ ready: false });
    // Paused: browsing yes, ordering no.
    await s.ok('PUT', '/manager/online/store', {
      ...store,
      deliveryFee: store.deliveryFee.amount,
      minimumOrder: store.minimumOrder.amount,
      status: 'paused',
    });
    expect((await pub(s, 'GET', '')).json().acceptingOrders).toBe(false);
    expect((await checkout(s)).json().code).toBe('STORE_CLOSED');
    // The slug is unique across merchants.
    const other = await setup();
    const os = await other.ok('GET', '/manager/online/store');
    expect(
      (
        await other.req('PUT', '/manager/online/store', {
          ...os,
          deliveryFee: os.deliveryFee.amount,
          minimumOrder: os.minimumOrder.amount,
          slug: s.slug,
        })
      ).json().code,
    ).toBe('DUPLICATE_CODE');
    // Branch managers: no store settings; online orders of other branches are invisible.
    const bm = await s.c.hire(
      [{ roleId: s.c.roles.branch_manager, branchId: s.c.second }],
      'manager',
    );
    expect((await s.req('GET', '/manager/online/store', undefined, bm.cookies)).statusCode).toBe(
      403,
    );
    const ownStore = await s.ok('GET', '/manager/online/store');
    await s.ok('PUT', '/manager/online/store', {
      ...ownStore,
      deliveryFee: ownStore.deliveryFee.amount,
      minimumOrder: ownStore.minimumOrder.amount,
      status: 'published',
    });
    const placed = (await checkout(s)).json().order;
    expect((await s.ok('GET', '/manager/online/orders', undefined, bm.cookies)).orders).toEqual([]);
    const id = (await s.ok('GET', '/manager/online/orders')).orders.find(
      (o: { number: string }) => o.number === placed.number,
    ).id;
    expect(
      (await s.req('GET', `/manager/online/orders/${id}`, undefined, bm.cookies)).statusCode,
    ).toBe(404);
    // Another merchant cannot see or act on it.
    expect((await other.req('GET', `/manager/online/orders/${id}`)).statusCode).toBe(404);
    expect(
      (await s.req('GET', `/store/${os.slug}/orders/${placed.trackingToken}`, undefined, undefined))
        .statusCode,
    ).toBe(404);
  });
});
