import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createHmac } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../kernel/ids.js';
import { DbFixtures, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';
import { OrderNotificationsService } from './order-notifications.service.js';
import { StoreAccountsService } from './store-accounts.service.js';

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

/** A company with a published store; `gateway: false` leaves it without any online method. */
async function setup({ gateway = true } = {}) {
  const c = await createCompany(app, db, mailer);
  const req = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    cookies: Cookies | undefined = c.cookies,
  ) =>
    c.client.request(method, path, {
      ...(cookies ? { cookies } : {}),
      ...(body === undefined ? {} : { body }),
    });
  const ok = async (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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
  const online = gateway
    ? await ok('PATCH', `/manager/payment-methods/${card['id'] as string}`, {
        kind: 'card',
        nameEn: 'Online card (test)',
        availableOnline: true,
        gatewayProvider: 'mock',
        feeType: 'percentage',
        feePercent: '2',
        financialAccountId: card['financialAccountId'],
        version: card['version'],
      })
    : null;
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
    method: (online?.id as string | undefined) ?? null,
    cash: methods.find((m) => m['kind'] === 'cash')!['id'] as string,
    card: card['id'] as string,
    cardAccount: card['financialAccountId'] as string,
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
    { registerId: registers[0]!.id, countedCash: '10.000', expectedCash: '0.000' },
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
    // Sales by employee carry the online store as its own row, so the breakdown adds up (BR-185).
    expect(
      report.byEmployee.find((e: { membershipId: string }) => e.membershipId === 'online'),
    ).toMatchObject({ saleCount: 1, netSales: { amount: '3.000' }, refunds: { amount: '0.000' } });
    expect(
      report.byEmployee.reduce(
        (t: number, e: { netSales: { amount: string } }) => t + Number(e.netSales.amount) * 1000,
        0,
      ),
    ).toBe(6750);
    expect(report.summary.netSales.amount).toBe('6.750');
    // The delivery fee is a zero-cost service: profit stays available and exact (audit fix).
    // Cost: 3 + 2 teas at 0.400 = 2.000; profit 6.750 − 2.000 = 4.750.
    expect(report.profit).toMatchObject({
      available: true,
      missingCostSales: 0,
      costOfSales: { amount: '2.000' },
      grossProfit: { amount: '4.750' },
    });
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
    const bank = (await s.ok('GET', '/manager/financial-accounts')).accounts[0].id as string;
    const tap = await s.ok('POST', '/manager/payment-methods', {
      kind: 'custom',
      nameEn: 'Tap',
      availableOnline: true,
      gatewayProvider: 'tap',
      financialAccountId: bank,
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

describe('audit regressions (Prompt 18)', () => {
  const pickup = (s: S, key = newId()) =>
    checkout(s, {
      idempotencyKey: key,
      lines: [{ variantId: s.tea, quantity: '1' }],
      fulfillment: 'pickup',
      deliveryAddress: null,
      expectedTotal: '1.250',
    });
  const managed = async (s: S, number: string) =>
    (await s.ok('GET', '/manager/online/orders')).orders.find(
      (o: { number: string }) => o.number === number,
    );
  const succeeded = (ref: string, id: string) => ({
    id,
    reference: ref,
    status: 'succeeded',
    amount: '1250',
    currency: 'KWD',
    failureReason: null,
  });

  it('records a payment that succeeds after the order was cancelled or failed', async () => {
    const s = await setup();
    // Cancelled by the merchant while the customer was still paying.
    const a = (await pickup(s)).json().order;
    const order = await managed(s, a.number);
    await s.ok('POST', `/manager/online/orders/${order.id}/action`, {
      action: 'cancel',
      version: order.version,
    });
    expect((await notify(s, succeeded(referenceOf(a), 'evt_late_1'))).json()).toMatchObject({
      outcome: 'needs_attention',
    });
    const after = await s.ok('GET', `/manager/online/orders/${order.id}`);
    expect(after).toMatchObject({ status: 'needs_attention', saleId: null });
    expect(after.payments[0]).toMatchObject({ status: 'succeeded' });
    // A failure reported first, then the money arrives anyway.
    const b = (await pickup(s)).json().order;
    await notify(s, { ...succeeded(referenceOf(b), 'evt_fail_1'), status: 'failed' });
    expect((await managed(s, b.number)).status).toBe('payment_failed');
    expect((await notify(s, succeeded(referenceOf(b), 'evt_late_2'))).json().outcome).toBe(
      'needs_attention',
    );
    expect((await managed(s, b.number)).status).toBe('needs_attention');
    // Neither became a sale (no stock was held any more); both are flagged for a refund.
    expect(
      await count(`select count(*) as n from sales where merchant_id = $1`, [s.c.merchantId]),
    ).toBe(0);
  });

  it('runs POS sales and online payments for the same item concurrently without errors', async () => {
    const s = await setup();
    const pos = await till(s);
    const orders = [];
    for (let i = 0; i < 3; i += 1) orders.push((await pickup(s)).json().order);
    // 5 on hand, 3 reserved: 2 left for the till; all five finish at the same time.
    const results = await Promise.all([
      ...orders.map((o, i) => notify(s, succeeded(referenceOf(o), `evt_race_${i}`))),
      ...[0, 1].map(() =>
        s.req(
          'POST',
          '/pos/sales',
          {
            idempotencyKey: newId(),
            lines: [{ variantId: s.tea, quantity: '1' }],
            payments: [{ methodId: s.cash, amount: '1.250' }],
            expectedTotal: '1.250',
          },
          pos,
        ),
      ),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 201, 201]);
    expect(await onHand(s, s.tea)).toBe('0.000');
    expect(
      await count(`select count(*) as n from sales where merchant_id = $1`, [s.c.merchantId]),
    ).toBe(5);
  });
});

// ---------------------------------------------------------------- pay on receipt, store address (ADR-0118)
const treasuryOf = async (s: S) => {
  const o = await s.ok('GET', '/manager/cash/overview');
  return o.branches.find((b: { branchId: string }) => b.branchId === s.c.main).treasury.balance
    .amount as string;
};
const act = (s: S, id: string, body: Record<string, unknown>) =>
  s.req('POST', `/manager/online/orders/${id}/action`, body);

describe('pay on receipt (ADR-0118)', () => {
  it('publishes without a gateway, takes an unpaid order, holds no stock and records cash into the treasury', async () => {
    const s = await setup({ gateway: false });
    const front = (await pub(s, 'GET', '')).json();
    expect(front).toMatchObject({ acceptingOrders: true, paymentMethods: [], payOnReceipt: true });

    // Nothing is reserved for an unpaid order: the store still offers all 5 and the POS may sell them.
    const placed = await checkout(s, {
      paymentMethodId: null,
      fulfillment: 'pickup',
      deliveryAddress: null,
      expectedTotal: '2.500',
    });
    expect(placed.statusCode, placed.body).toBe(201);
    const order = placed.json().order;
    expect(order).toMatchObject({
      status: 'placed',
      paymentMode: 'on_receipt',
      paidAt: null,
      reservedUntil: null,
      paymentUrl: null,
      total: { amount: '2.500' },
    });
    expect(
      await count(`select count(*) as n from stock_reservations where merchant_id = $1`, [
        s.c.merchantId,
      ]),
    ).toBe(0);
    expect(
      (await pub(s, 'GET', '/products'))
        .json()
        .products.find((p: { nameEn: string }) => p.nameEn === 'Saffron tea').variants[0]
        .maxQuantity,
    ).toBe(5);
    // Only what is free right now can be ordered.
    expect(
      (
        await checkout(s, {
          paymentMethodId: null,
          lines: [{ variantId: s.tea, quantity: '6' }],
          expectedTotal: '8.000',
        })
      ).json().code,
    ).toBe('INSUFFICIENT_STOCK');

    // Staff confirm it; it cannot complete unpaid; a card tender needs its reference.
    const listed = await s.ok('GET', '/manager/online/orders');
    expect(listed.counts).toMatchObject({ placed: 1 });
    let managed = await s.ok('GET', `/manager/online/orders/${listed.orders[0].id}`);
    expect(managed).toMatchObject({ paymentMethod: null, saleId: null, confirmedAt: null });
    expect(
      (await act(s, managed.id, { action: 'preparing', version: managed.version })).json().code,
    ).toBe('INVALID_STATE');
    managed = (await act(s, managed.id, { action: 'confirm', version: managed.version })).json();
    expect(managed).toMatchObject({ status: 'confirmed', confirmedAt: expect.any(String) });
    expect(
      (await act(s, managed.id, { action: 'completed', version: managed.version })).json().code,
    ).toBe('ORDER_UNPAID');
    expect(
      (
        await act(s, managed.id, {
          action: 'mark_paid',
          paymentMethodId: s.card,
          version: managed.version,
        })
      ).json().code,
    ).toBe('REFERENCE_REQUIRED');
    const tenders = (await s.ok('GET', '/manager/online/tenders')).tenders as {
      kind: string;
      requiresReference: boolean;
    }[];
    expect(tenders.map((t) => [t.kind, t.requiresReference])).toEqual(
      expect.arrayContaining([
        ['cash', false],
        ['card', true],
      ]),
    );

    // Cash on hand-over: the sale exists now, stock is deducted, the treasury holds the cash.
    expect(await treasuryOf(s)).toBe('0.000');
    managed = (
      await act(s, managed.id, {
        action: 'mark_paid',
        paymentMethodId: s.cash,
        version: managed.version,
      })
    ).json();
    expect(managed).toMatchObject({
      status: 'confirmed',
      saleId: expect.any(String),
      receiptNumber: expect.stringMatching(/^MAIN-/),
      paidAt: expect.any(String),
      paymentMethod: { nameEn: expect.any(String) },
    });
    expect(await onHand(s)).toBe('3.000');
    expect(await treasuryOf(s)).toBe('2.500');
    const sale = await owner.query(
      `select s.channel, s.total_minor::text as total, p.verification, p.method_kind, p.reference, p.shift_id
       from sales s join payments p on p.sale_id = s.id where s.id = $1`,
      [managed.saleId],
    );
    expect(sale.rows[0]).toMatchObject({
      channel: 'online',
      total: '2500',
      verification: 'manual',
      method_kind: 'cash',
      reference: null,
      shift_id: null,
    });
    // Paid: not twice, not cancelled in place; it completes through the usual steps.
    expect(
      (
        await act(s, managed.id, {
          action: 'mark_paid',
          paymentMethodId: s.cash,
          version: managed.version,
        })
      ).json().code,
    ).toBe('INVALID_STATE');
    expect(
      (await act(s, managed.id, { action: 'cancel', version: managed.version })).json().code,
    ).toBe('INVALID_STATE');
    managed = (await act(s, managed.id, { action: 'ready', version: managed.version })).json();
    managed = (await act(s, managed.id, { action: 'completed', version: managed.version })).json();
    expect(managed.status).toBe('completed');
    expect(
      (await pub(s, 'GET', `/orders/${order.trackingToken}`))
        .json()
        .timeline.map((t: { status: string }) => t.status),
    ).toEqual(['placed', 'confirmed', 'paid', 'ready', 'completed']);
    expect(
      await count(
        `select count(*) as n from audit_log where merchant_id = $1 and action = 'online.order_mark_paid'`,
        [s.c.merchantId],
      ),
    ).toBe(1);
  });

  it('settles a card tender with its reference, cancels unpaid orders in place and respects the store switch', async () => {
    const s = await setup({ gateway: false });
    const order = (await checkout(s, { paymentMethodId: null })).json().order;
    const id = (await s.ok('GET', '/manager/online/orders')).orders[0].id as string;
    let managed = await s.ok('GET', `/manager/online/orders/${id}`);
    managed = (
      await act(s, id, {
        action: 'mark_paid',
        paymentMethodId: s.card,
        reference: 'K-778',
        version: managed.version,
      })
    ).json();
    expect(managed).toMatchObject({ status: 'confirmed', paymentReference: 'K-778' });
    const paid = await owner.query(
      `select p.reference, p.financial_account_id, p.verification,
              (select sum(amount_minor)::text from financial_account_entries e where e.source_id = p.id) as posted
       from payments p where p.sale_id = $1`,
      [managed.saleId],
    );
    expect(paid.rows[0]).toMatchObject({
      reference: 'K-778',
      financial_account_id: s.cardAccount,
      verification: 'manual',
      posted: '3000',
    });
    expect(await treasuryOf(s)).toBe('0.000');
    expect((await pub(s, 'GET', `/orders/${order.trackingToken}`)).json()).toMatchObject({
      status: 'confirmed',
      paidAt: expect.any(String),
    });

    // An unpaid order is cancelled in place at any step before completion.
    await checkout(s, { paymentMethodId: null });
    const second = (await s.ok('GET', '/manager/online/orders?status=placed')).orders[0];
    let o2 = (await act(s, second.id, { action: 'confirm', version: second.version })).json();
    o2 = (await act(s, o2.id, { action: 'preparing', version: o2.version })).json();
    o2 = (await act(s, o2.id, { action: 'cancel', note: 'No answer', version: o2.version })).json();
    expect(o2).toMatchObject({ status: 'cancelled', statusNote: 'No answer', saleId: null });

    // Switched off: a store with no gateway cannot be published, and checkout needs a method.
    const store = await s.ok('GET', '/manager/online/store');
    const body = {
      ...store,
      deliveryFee: store.deliveryFee.amount,
      minimumOrder: store.minimumOrder.amount,
      payOnReceiptEnabled: false,
    };
    expect((await s.req('PUT', '/manager/online/store', body)).json().code).toBe(
      'NO_PAYMENT_OPTION',
    );
    const withGateway = await setup();
    const gs = await withGateway.ok('GET', '/manager/online/store');
    await withGateway.ok('PUT', '/manager/online/store', {
      ...gs,
      deliveryFee: gs.deliveryFee.amount,
      minimumOrder: gs.minimumOrder.amount,
      payOnReceiptEnabled: false,
    });
    expect((await pub(withGateway, 'GET', '')).json().payOnReceipt).toBe(false);
    expect((await checkout(withGateway, { paymentMethodId: null })).json().code).toBe(
      'PAYMENT_METHOD_REQUIRED',
    );
  });
});

describe('store defaults', () => {
  it('proposes the main branch as fulfilment branch so a one-branch store publishes at once', async () => {
    const c = await createCompany(app, db, mailer);
    const store = (
      await c.client.request('GET', '/manager/online/store', { cookies: c.cookies })
    ).json();
    expect(store).toMatchObject({ status: 'draft', fulfillmentBranchId: c.main });
    const published = await c.client.request('PUT', '/manager/online/store', {
      cookies: c.cookies,
      body: {
        ...store,
        slug: `one-${Date.now().toString(36)}`,
        status: 'published',
        nameAr: 'بقالة',
        deliveryFee: store.deliveryFee.amount,
        minimumOrder: store.minimumOrder.amount,
      },
    });
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json()).toMatchObject({ status: 'published', fulfillmentBranchId: c.main });
  });
});

describe('store address (ADR-0118)', () => {
  const availability = (s: S, slug: string) =>
    s.ok('GET', `/manager/online/store/slug-availability?slug=${encodeURIComponent(slug)}`);
  const saveSlug = async (s: S, slug: string) => {
    const store = await s.ok('GET', '/manager/online/store');
    return s.req('PUT', '/manager/online/store', {
      ...store,
      deliveryFee: store.deliveryFee.amount,
      minimumOrder: store.minimumOrder.amount,
      slug,
    });
  };

  it('checks availability across stores and link pages, keeps the old address after a rename and limits renames', async () => {
    const s = await setup();
    const other = await setup();
    expect(await availability(s, s.slug)).toMatchObject({ available: true, reason: null });
    expect(await availability(s, 'pay')).toMatchObject({ available: false, reason: 'reserved' });
    expect(await availability(s, 'Bad Name!')).toMatchObject({
      available: false,
      reason: 'invalid',
    });
    const taken = await availability(other, s.slug);
    expect(taken).toMatchObject({ available: false, reason: 'taken' });
    expect(taken.suggestions.length).toBeGreaterThan(0);
    expect(taken.suggestions).not.toContain(s.slug);
    // A link page of another business holds its address against stores too.
    const linkSlug = `links-${s.slug}`;
    await other.ok('PUT', '/manager/link-page', {
      slug: linkSlug,
      status: 'published',
      titleEn: 'Other',
      titleAr: null,
      bioAr: null,
      bioEn: null,
      themeColor: '#7c2d12',
      buttonStyle: 'pill',
      background: 'light',
      version: 0,
    });
    expect(await availability(s, linkSlug)).toMatchObject({ available: false, reason: 'taken' });
    expect((await saveSlug(s, linkSlug)).json().code).toBe('DUPLICATE_CODE');

    // Renaming: the old address still opens the store (and tells the current one) for 90 days,
    // nobody else can take it meanwhile, and a second rename the same day is refused.
    const renamed = `${s.slug}-new`;
    expect((await saveSlug(s, renamed)).statusCode).toBe(200);
    expect((await pub(s, 'GET', '')).json().slug).toBe(renamed);
    expect((await pub(s, 'GET', '/products')).statusCode).toBe(200);
    expect((await s.req('GET', `/store/${renamed}`, undefined, undefined)).json().slug).toBe(
      renamed,
    );
    expect(await availability(other, s.slug)).toMatchObject({ available: false, reason: 'taken' });
    expect((await saveSlug(other, s.slug)).json().code).toBe('DUPLICATE_CODE');
    expect(await availability(s, `${s.slug}-again`)).toMatchObject({
      available: false,
      reason: 'rename_limit',
    });
    expect((await saveSlug(s, `${s.slug}-again`)).json().code).toBe('RENAME_LIMIT');
    // Saving without changing the address is not a rename.
    expect((await saveSlug(s, renamed)).statusCode).toBe(200);
    expect(
      await count(`select count(*) as n from online_store_slug_history where merchant_id = $1`, [
        s.c.merchantId,
      ]),
    ).toBe(1);
    expect(
      await count(
        `select count(*) as n from audit_log where merchant_id = $1 and action = 'online.store_renamed'`,
        [s.c.merchantId],
      ),
    ).toBe(1);
    // Once the old address expires it is free again and no longer answers.
    await owner.query(
      `update online_store_slug_history set expires_at = now() - interval '1 minute' where merchant_id = $1`,
      [s.c.merchantId],
    );
    expect((await pub(s, 'GET', '')).statusCode).toBe(404);
    expect(await availability(other, s.slug)).toMatchObject({ available: true });
  });
});

// ---------------------------------------------------------------- merchandising (ADR-0121)
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
function multipart(data: Buffer, filename = 'photo.png', type = 'image/png') {
  const boundary = '----arabat' + Math.random().toString(16).slice(2);
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return {
    body,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}
const upload = (s: S, path: string, data = png) =>
  s.c.client.request('POST', path, { cookies: s.c.cookies, ...multipart(data) });

describe('merchandising (ADR-0121)', () => {
  it('keeps the catalog as the source and lets the store add its own title, order, categories and cap', async () => {
    const s = await setup({ gateway: false });
    // Listings carry the catalog name, images and position; new listings go to the end.
    let listings = (await s.ok('GET', '/manager/online/listings')).products as Record<
      string,
      unknown
    >[];
    const listed = listings.filter((p) => p['listed']);
    expect(listed.map((p) => p['nameEn'])).toEqual(['Gift card', 'Saffron tea']);
    expect(listed.map((p) => p['position'])).toEqual([0, 1]);
    expect(listed[0]).toMatchObject({
      featured: false,
      maxPerOrder: null,
      onlineCategoryId: null,
      images: [],
    });

    // A store category with a picture; a catalog product put in it with the store's own title.
    const drinks = await s.ok('POST', '/manager/online/categories', {
      nameAr: 'مشروبات',
      nameEn: 'Drinks',
    });
    expect(drinks).toMatchObject({
      position: 0,
      status: 'active',
      imageUrl: null,
      productCount: 0,
    });
    const withImage = (await upload(s, `/manager/online/categories/${drinks.id}/image`)).json();
    expect(withImage.imageUrl).toMatch(/\/manager\/online\/categories\/.*\/image\?v=2$/);
    expect(
      (await upload(s, `/manager/online/categories/${drinks.id}/image`, Buffer.from('nope')))
        .statusCode,
    ).toBe(415);
    await s.ok('PUT', `/manager/online/listings/${s.teaProduct}`, {
      titleEn: 'Saffron tea, 50 g tin',
      titleAr: 'شاي زعفران',
      descriptionEn: 'Store says: brewed daily',
      descriptionAr: null,
      featured: true,
      maxPerOrder: 2,
      onlineCategoryId: drinks.id,
    });
    expect(
      (
        await s.req('PUT', `/manager/online/listings/${s.hidden}`, {
          titleEn: null,
          titleAr: null,
          descriptionEn: null,
          descriptionAr: null,
          featured: false,
          maxPerOrder: null,
          onlineCategoryId: null,
        })
      ).statusCode,
    ).toBe(404);
    // Display order: every listed product exactly once.
    const giftProduct = listed.find((p) => p['nameEn'] === 'Gift card')!['productId'] as string;
    expect(
      (await s.req('PUT', '/manager/online/listings/order', { productIds: [s.teaProduct] })).json()
        .code,
    ).toBe('VALIDATION_FAILED');
    listings = (
      await s.ok('PUT', '/manager/online/listings/order', {
        productIds: [s.teaProduct, giftProduct],
      })
    ).products as Record<string, unknown>[];
    expect(listings.filter((p) => p['listed']).map((p) => p['nameEn'])).toEqual([
      'Saffron tea',
      'Gift card',
    ]);
    expect((await s.ok('GET', '/manager/online/categories')).categories[0].productCount).toBe(1);

    // The storefront: the store's title and description win, the category navigation is the
    // store's own, the category picture is public, featured and position come through, and
    // the per-order cap bounds the offered quantity (5 on hand, cap 2).
    const front = (await pub(s, 'GET', '')).json();
    expect(front).toMatchObject({ categorySource: 'online', logoUrl: null, bannerUrl: null });
    expect(front.categories).toEqual([
      expect.objectContaining({
        id: drinks.id,
        nameEn: 'Drinks',
        imageUrl: expect.stringContaining(`/store/${s.slug}/categories/${drinks.id}/image`),
      }),
    ]);
    expect(
      (
        await s.req(
          'GET',
          front.categories[0].imageUrl.replace('/api/v1', ''),
          undefined,
          undefined,
        )
      ).statusCode,
    ).toBe(200);
    const products = (await pub(s, 'GET', '/products')).json().products;
    expect(products.map((p: { nameEn: string }) => p.nameEn)).toEqual([
      'Saffron tea, 50 g tin',
      'Gift card',
    ]);
    expect(products[0]).toMatchObject({
      nameAr: 'شاي زعفران',
      descriptionEn: 'Store says: brewed daily',
      categoryId: drinks.id,
      featured: true,
      position: 0,
      images: [],
    });
    expect(products[0].variants[0].maxQuantity).toBe(2);
    expect(products[1]).toMatchObject({ categoryId: null, featured: false, position: 1 });
    // Ordering 3 of a capped product is refused.
    expect(
      (
        await checkout(s, {
          paymentMethodId: null,
          lines: [{ variantId: s.tea, quantity: '3' }],
          expectedTotal: '4.250',
        })
      ).json().code,
    ).toBe('INSUFFICIENT_STOCK');

    // Hidden category: the product stays in the store without a category. Deleting it keeps the product.
    await s.ok('PUT', `/manager/online/categories/${drinks.id}`, {
      nameAr: 'مشروبات',
      nameEn: 'Drinks',
      status: 'hidden',
      version: 2,
    });
    expect((await pub(s, 'GET', '')).json().categories).toEqual([]);
    expect((await pub(s, 'GET', '/products')).json().products[0].categoryId).toBeNull();
    const afterDelete = await s.ok('DELETE', `/manager/online/categories/${drinks.id}`);
    expect(afterDelete.categories).toEqual([]);
    expect((await pub(s, 'GET', '')).json().categorySource).toBe('pos');
    expect((await pub(s, 'GET', '/products')).json().products[0].nameEn).toBe(
      'Saffron tea, 50 g tin',
    );

    // Logo and banner: uploaded through the console, public on the storefront, removable.
    const withLogo = (await upload(s, '/manager/online/store/logo')).json();
    expect(withLogo.logoUrl).toMatch(/\/manager\/online\/store\/logo\?v=/);
    const banner = (await upload(s, '/manager/online/store/banner')).json();
    expect(banner.bannerUrl).toMatch(/\/manager\/online\/store\/banner\?v=/);
    const branded = (await pub(s, 'GET', '')).json();
    expect(branded.logoUrl).toContain(`/store/${s.slug}/logo?v=`);
    expect(
      (await s.req('GET', branded.logoUrl.replace('/api/v1', ''), undefined, undefined)).headers[
        'content-type'
      ],
    ).toBe('image/png');
    expect(
      (await s.req('GET', branded.bannerUrl.replace('/api/v1', ''), undefined, undefined))
        .statusCode,
    ).toBe(200);
    await s.ok('DELETE', '/manager/online/store/logo');
    expect((await pub(s, 'GET', '')).json().logoUrl).toBeNull();
    expect((await s.req('GET', `/store/${s.slug}/logo`, undefined, undefined)).statusCode).toBe(
      404,
    );
    // Another merchant cannot read this store's category picture through its own console.
    const other = await setup({ gateway: false });
    expect(
      (await other.req('GET', `/manager/online/categories/${drinks.id}/image`)).statusCode,
    ).toBe(404);
  });

  it('hides sold-out products when the store says so', async () => {
    const s = await setup({ gateway: false });
    const store = await s.ok('GET', '/manager/online/store');
    expect(store.hideOutOfStock).toBe(false);
    // Sell the 5 teas at the till; the store then has nothing to offer for tea.
    const pos = await till(s);
    expect(
      (
        await s.req(
          'POST',
          '/pos/sales',
          {
            idempotencyKey: newId(),
            lines: [{ variantId: s.tea, quantity: '5' }],
            payments: [{ methodId: s.cash, amount: '6.250' }],
            expectedTotal: '6.250',
          },
          pos,
        )
      ).statusCode,
    ).toBe(201);
    let products = (await pub(s, 'GET', '/products')).json().products;
    expect(
      products.find((p: { nameEn: string }) => p.nameEn === 'Saffron tea').variants[0].available,
    ).toBe(false);
    await s.ok('PUT', '/manager/online/store', {
      ...store,
      deliveryFee: store.deliveryFee.amount,
      minimumOrder: store.minimumOrder.amount,
      hideOutOfStock: true,
    });
    products = (await pub(s, 'GET', '/products')).json().products;
    expect(products.map((p: { nameEn: string }) => p.nameEn)).toEqual(['Gift card']);
    expect((await pub(s, 'GET', `/products/${s.teaProduct}`)).statusCode).toBe(404);
  });
});

describe('fulfilment (ADR-0123)', () => {
  const drain = () => app.get(OrderNotificationsService).drain();

  it('picks the delivery area at checkout, charges its fee and minimum, and offers free delivery', async () => {
    const s = await setup({ gateway: false });
    // No area yet: the flat store fee applies as before.
    expect((await pub(s, 'GET', '')).json()).toMatchObject({
      deliveryAreas: [],
      defaultBranchId: s.c.main,
      scheduling: { enabled: false, slotMinutes: 30 },
    });
    const salmiya = await s.ok('POST', '/manager/online/delivery-areas', {
      nameAr: 'السالمية',
      nameEn: 'Salmiya',
      fee: '1.000',
      minimumOrder: '2.000',
      freeDeliveryFrom: '10.000',
      estimatedMinutes: 45,
    });
    expect(salmiya).toMatchObject({ position: 0, active: true, branchId: null, version: 1 });
    const hawally = await s.ok('POST', '/manager/online/delivery-areas', {
      nameEn: 'Hawally',
      fee: '0.750',
      branchId: s.c.second,
    });
    // Inactive areas and areas served by an inactive branch are not offered.
    await s.ok('PUT', `/manager/online/delivery-areas/${hawally.id}`, {
      nameEn: 'Hawally',
      fee: '0.750',
      branchId: s.c.second,
      active: false,
      version: hawally.version,
    });
    const front = (await pub(s, 'GET', '')).json();
    expect(front.deliveryAreas).toEqual([
      expect.objectContaining({
        id: salmiya.id,
        nameEn: 'Salmiya',
        fee: { amount: '1.000', currency: 'KWD' },
        freeDeliveryFrom: { amount: '10.000', currency: 'KWD' },
        estimatedMinutes: 45,
        branchId: s.c.main,
      }),
    ]);
    // Delivery without an area is refused; the area's fee replaces the flat one.
    const noArea = await checkout(s, { paymentMethodId: null, expectedTotal: '3.000' });
    expect(noArea.statusCode).toBe(400);
    expect(noArea.json().issues[0]).toMatchObject({ path: 'deliveryAreaId', code: 'required' });
    const below = await checkout(s, {
      paymentMethodId: null,
      deliveryAreaId: salmiya.id,
      lines: [{ variantId: s.tea, quantity: '1' }],
      expectedTotal: '2.250',
    });
    expect(below.json().code).toBe('MINIMUM_ORDER');
    const order = (
      await checkout(s, {
        paymentMethodId: null,
        deliveryAreaId: salmiya.id,
        expectedTotal: '3.500',
      })
    ).json().order;
    expect(order).toMatchObject({
      deliveryFee: { amount: '1.000', currency: 'KWD' },
      total: { amount: '3.500', currency: 'KWD' },
      deliveryAreaName: 'السالمية',
      scheduledFor: null,
      branch: { nameEn: 'Main branch' },
    });
    // At or above the threshold the delivery is free.
    const big = (
      await checkout(s, {
        paymentMethodId: null,
        deliveryAreaId: salmiya.id,
        lines: [{ variantId: s.gift, quantity: '2' }],
        expectedTotal: '10.000',
      })
    ).json().order;
    expect(big.deliveryFee.amount).toBe('0.000');
    const manager = await s.ok('GET', `/manager/online/orders?status=placed`);
    expect(manager.orders.map((o: { deliveryAreaId: string | null }) => o.deliveryAreaId)).toEqual([
      salmiya.id,
      salmiya.id,
    ]);
    // Deleting the area keeps the orders (their snapshot) and returns to the flat fee.
    expect(
      (await s.ok('DELETE', `/manager/online/delivery-areas/${salmiya.id}`)).areas,
    ).toHaveLength(1);
    expect(
      (await s.ok('GET', `/manager/online/orders/${manager.orders[0].id}`)).deliveryAreaName,
    ).toBe('السالمية');
    await s.ok('PUT', `/manager/online/delivery-areas/order`, { ids: [hawally.id] });
    expect((await checkout(s, { paymentMethodId: null, expectedTotal: '3.000' })).statusCode).toBe(
      201,
    );
    await drain();
  });

  it('serves pickup from several branches with their own stock and hours, and books time slots', async () => {
    const s = await setup({ gateway: false });
    // The second branch gets stock of the tea and joins the store; the main one keeps serving.
    await s.ok('POST', '/manager/inventory/adjustments', {
      branchId: s.c.second,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId: s.tea, quantity: '1', unitCost: '0.400' }],
    });
    const always = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
    const open = Object.fromEntries(
      Object.keys(always).map((d) => [d, [{ open: '00:00', close: '24:00' }]]),
    );
    await s.ok('PUT', `/manager/online/branches/${s.c.main}`, {
      pickupEnabled: true,
      deliveryEnabled: true,
    });
    const second = await s.ok('PUT', `/manager/online/branches/${s.c.second}`, {
      pickupEnabled: true,
      deliveryEnabled: false,
      preparationMinutes: 60,
      hours: open,
    });
    expect(second).toMatchObject({ nameEn: 'Second', position: 1, hours: open, version: 1 });
    // Both branches hold stock of the tea, but the gift card is sold everywhere and the tea
    // has one unit at the second branch only.
    const front = (await pub(s, 'GET', '')).json();
    expect(front.branches.map((b: { id: string; openNow: boolean }) => [b.id, b.openNow])).toEqual([
      [s.c.main, true],
      [s.c.second, true],
    ]);
    const atSecond = (await pub(s, 'GET', `/products?branch=${s.c.second}`)).json().products;
    expect(
      atSecond.find((p: { productId: string }) => p.productId === s.teaProduct).variants[0],
    ).toMatchObject({
      available: true,
      maxQuantity: 1,
    });
    // Ordering two at the second branch fails on its stock; one succeeds and is prepared there.
    const tooMany = await checkout(s, {
      paymentMethodId: null,
      fulfillment: 'pickup',
      branchId: s.c.second,
      deliveryAddress: null,
      expectedTotal: '2.500',
    });
    expect(tooMany.json().code).toBe('INSUFFICIENT_STOCK');
    const order = (
      await checkout(s, {
        paymentMethodId: null,
        fulfillment: 'pickup',
        branchId: s.c.second,
        deliveryAddress: null,
        lines: [{ variantId: s.tea, quantity: '1' }],
        expectedTotal: '1.250',
      })
    ).json().order;
    expect(order.branch).toMatchObject({ nameEn: 'Second' });
    expect((await s.ok('GET', `/manager/online/orders?status=placed`)).orders[0].branchId).toBe(
      s.c.second,
    );
    // A branch closed today refuses orders now, unless a slot is chosen.
    await s.ok('PUT', `/manager/online/branches/${s.c.second}`, {
      pickupEnabled: true,
      deliveryEnabled: false,
      preparationMinutes: 60,
      hours: always,
      version: second.version,
    });
    const closed = await checkout(s, {
      paymentMethodId: null,
      fulfillment: 'pickup',
      branchId: s.c.second,
      deliveryAddress: null,
      lines: [{ variantId: s.gift, quantity: '1' }],
      expectedTotal: '5.000',
    });
    expect(closed.json().code).toBe('OUTSIDE_HOURS');
    expect((await pub(s, 'GET', `/slots?branch=${s.c.main}`)).json().slots).toEqual([]);
    // Scheduling on: the main branch (always open) offers 30-minute slots, one order per slot.
    const store = await s.ok('GET', '/manager/online/store');
    await s.ok('PUT', '/manager/online/store', {
      ...store,
      deliveryFee: store.deliveryFee.amount,
      minimumOrder: store.minimumOrder.amount,
      schedulingEnabled: true,
      slotMinutes: 30,
      slotCapacity: 1,
    });
    const slots = (await pub(s, 'GET', `/slots?branch=${s.c.main}`)).json().slots as {
      start: string;
      end: string;
      available: boolean;
    }[];
    expect(slots.length).toBeGreaterThan(40);
    expect(new Date(slots[0]!.end).getTime() - new Date(slots[0]!.start).getTime()).toBe(
      30 * 60_000,
    );
    expect(slots.every((x) => x.available)).toBe(true);
    const pick = slots[3]!;
    const scheduled = (
      await checkout(s, {
        paymentMethodId: null,
        fulfillment: 'pickup',
        deliveryAddress: null,
        scheduledFor: pick.start,
        lines: [{ variantId: s.gift, quantity: '1' }],
        expectedTotal: '5.000',
      })
    ).json().order;
    expect(scheduled.scheduledFor).toBe(pick.start);
    expect((await pub(s, 'GET', `/slots?branch=${s.c.main}`)).json().slots[3]).toMatchObject({
      start: pick.start,
      available: false,
    });
    const full = await checkout(s, {
      paymentMethodId: null,
      fulfillment: 'pickup',
      deliveryAddress: null,
      scheduledFor: pick.start,
      lines: [{ variantId: s.gift, quantity: '1' }],
      expectedTotal: '5.000',
    });
    expect(full.json().code).toBe('SLOT_FULL');
    const odd = await checkout(s, {
      paymentMethodId: null,
      fulfillment: 'pickup',
      deliveryAddress: null,
      scheduledFor: new Date(new Date(pick.start).getTime() + 7 * 60_000).toISOString(),
      lines: [{ variantId: s.gift, quantity: '1' }],
      expectedTotal: '5.000',
    });
    expect(odd.statusCode).toBe(400);
    await drain();
  });

  it('e-mails the shopper and the store, and prints the packing slip when the order is confirmed', async () => {
    const s = await setup({ gateway: false });
    const store = await s.ok('GET', '/manager/online/store');
    await s.ok('PUT', '/manager/online/store', {
      ...store,
      deliveryFee: store.deliveryFee.amount,
      minimumOrder: store.minimumOrder.amount,
      contactEmail: 'shop@example.com',
    });
    const agent = await s.ok('POST', '/manager/print-agents', {
      name: 'Kitchen',
      branchId: s.c.main,
    });
    expect(agent.token).toBeTruthy();
    const before = mailer.outbox.length;
    const order = (await checkout(s, { paymentMethodId: null, expectedTotal: '3.000' })).json()
      .order;
    await drain();
    const sent = mailer.outbox.slice(before);
    expect(sent.map((m) => [m.to, m.subject])).toEqual([
      ['mariam@example.com', `استلمنا طلبك ${order.number} | Order ${order.number} received`],
      ['shop@example.com', `طلب جديد ${order.number} | New order ${order.number}`],
    ]);
    expect(sent[0]!.text).toContain(`/store/${s.slug}/orders/${order.trackingToken}`);
    expect(sent[0]!.text).toContain('Block 3, Street 10, Salmiya');
    expect(sent[1]!.text).toContain('/online/orders');
    // Nothing printed yet: the slip goes to the branch when the order is confirmed.
    const [{ id }] = (await s.ok('GET', '/manager/online/orders?status=placed')).orders;
    expect(
      await count('select count(*)::int as n from print_jobs where online_order_id = $1', [id]),
    ).toBe(0);
    await s.ok('POST', `/manager/online/orders/${id}/action`, { action: 'confirm', version: 1 });
    const jobs = (
      await owner.query('select kind, sale_id, html from print_jobs where online_order_id = $1', [
        id,
      ])
    ).rows as { kind: string; sale_id: string | null; html: string }[];
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'online_order', sale_id: null });
    expect(jobs[0]!.html).toContain(order.number);
    expect(jobs[0]!.html).toContain('Block 3, Street 10, Salmiya');
    expect(jobs[0]!.html).toContain('يُحصّل عند التسليم');
    await drain();
    expect(mailer.outbox.at(-1)).toMatchObject({
      to: 'mariam@example.com',
      subject: `تم تأكيد طلبك ${order.number} | Order ${order.number} confirmed`,
    });
    // The agent sees the slip as a pending job (no sale behind it).
    const pending = (
      await s.c.client.request('GET', '/print-agent/jobs/pending', {
        headers: { authorization: `Bearer ${agent.token}` },
      })
    ).json();
    expect(pending.jobs ?? pending).toEqual(
      expect.arrayContaining([expect.objectContaining({ orderUuid: null })]),
    );
    // Later steps notify too; the final one when completed after payment.
    await s.ok('POST', `/manager/online/orders/${id}/action`, {
      action: 'out_for_delivery',
      version: 2,
    });
    await drain();
    expect(mailer.outbox.at(-1)!.subject).toContain(`Order ${order.number} is on its way`);
  });

  it('hands a pickup order over at the till: paid with the shift tenders, cash into the drawer', async () => {
    const s = await setup({ gateway: false });
    const order = (
      await checkout(s, {
        paymentMethodId: null,
        fulfillment: 'pickup',
        deliveryAddress: null,
        expectedTotal: '2.500',
      })
    ).json().order;
    const cashier = await till(s);
    const list = (await s.ok('GET', '/pos/online-orders', undefined, cashier)).orders;
    expect(list).toEqual([
      expect.objectContaining({
        number: order.number,
        status: 'placed',
        paid: false,
        total: { amount: '2.500', currency: 'KWD' },
        lines: [expect.objectContaining({ nameEn: 'Saffron tea', quantity: '2.000' })],
        version: 1,
      }),
    ]);
    const id = list[0].id as string;
    // A wrong total is refused; the right one with cash and change creates the sale.
    expect(
      (
        await s.req(
          'POST',
          `/pos/online-orders/${id}/pay`,
          {
            idempotencyKey: newId(),
            payments: [{ methodId: s.cash, amount: '2.000', tendered: null, reference: null }],
            expectedTotal: '2.000',
            version: 1,
          },
          cashier,
        )
      ).json().code,
    ).toBe('TOTAL_CHANGED');
    const key = newId();
    const body = {
      idempotencyKey: key,
      payments: [
        { methodId: s.cash, amount: '1.500', tendered: '2.000', reference: null },
        { methodId: s.card, amount: '1.000', tendered: null, reference: 'A1' },
      ],
      expectedTotal: '2.500',
      version: 1,
    };
    const sale = await s.ok('POST', `/pos/online-orders/${id}/pay`, body, cashier);
    expect(sale).toMatchObject({
      channel: 'online',
      total: { amount: '2.500', currency: 'KWD' },
      change: { amount: '0.500', currency: 'KWD' },
    });
    expect(sale.shiftId).toBeTruthy();
    // Retrying the same request returns the same sale; a new key is refused (already paid).
    expect((await s.ok('POST', `/pos/online-orders/${id}/pay`, body, cashier)).id).toBe(sale.id);
    expect(
      (
        await s.req(
          'POST',
          `/pos/online-orders/${id}/pay`,
          { ...body, idempotencyKey: newId() },
          cashier,
        )
      ).statusCode,
    ).toBe(409);
    const done = await s.ok('GET', `/manager/online/orders/${id}`);
    expect(done).toMatchObject({
      status: 'completed',
      saleId: sale.id,
      receiptNumber: sale.receiptNumber,
    });
    expect(await onHand(s)).toBe('3.000');
    // The drawer holds the opening float plus the cash net of change; the card went to its account.
    const current = (await s.ok('GET', '/pos/shifts/current', undefined, cashier)).shift;
    expect(current.expectedCash ?? current.expected?.amount ?? current).toBeDefined();
    const [row] = (
      await owner.query(
        `select sum(case when p.method_kind = 'cash' then p.amount_minor else 0 end)::text as cash,
                sum(case when p.method_kind = 'card' then p.amount_minor else 0 end)::text as card
         from payments p where p.sale_id = $1 and p.shift_id is not null`,
        [sale.id],
      )
    ).rows as { cash: string; card: string }[];
    expect(row).toEqual({ cash: '1500', card: '1000' });
    expect((await s.ok('GET', '/pos/online-orders', undefined, cashier)).orders).toEqual([]);
    // A paid (gateway or console) order is handed over without a payment.
    const second = (
      await checkout(s, {
        paymentMethodId: null,
        fulfillment: 'pickup',
        deliveryAddress: null,
        lines: [{ variantId: s.gift, quantity: '1' }],
        expectedTotal: '5.000',
      })
    ).json().order;
    const [placed] = (await s.ok('GET', '/manager/online/orders?status=placed')).orders;
    expect(placed.number).toBe(second.number);
    await s.ok('POST', `/manager/online/orders/${placed.id}/action`, {
      action: 'mark_paid',
      paymentMethodId: s.cash,
      version: 1,
    });
    const [waiting] = (await s.ok('GET', '/pos/online-orders', undefined, cashier)).orders;
    expect(waiting).toMatchObject({ id: placed.id, paid: true, status: 'confirmed' });
    expect(
      (
        await s.req('POST', `/pos/online-orders/${placed.id}/complete`, { version: 1 }, cashier)
      ).json().code,
    ).toBe('VERSION_CONFLICT');
    const handed = await s.ok(
      'POST',
      `/pos/online-orders/${placed.id}/complete`,
      { version: waiting.version },
      cashier,
    );
    expect(handed.status).toBe('completed');
    await drain();
  });
});

describe('shopper accounts (ADR-0124)', () => {
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const acct = (
    s: S,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    token: string | null,
    body?: unknown,
  ) =>
    s.c.client.request(method, `/store/${s.slug}/account${path}`, {
      ...(body === undefined ? {} : { body }),
      ...(token ? { headers: auth(token) } : {}),
    });

  it('registers a shopper on the till customer by phone, signs in, keeps addresses and lists own orders', async () => {
    const s = await setup({ gateway: false });
    // A guest order earlier created the customer by phone; the account attaches to it.
    const guest = (
      await checkout(s, {
        paymentMethodId: null,
        customer: { name: 'Mariam', phone: '6000 1111', email: null },
        expectedTotal: '3.000',
      })
    ).json().order;
    expect(guest.number).toBe('W-000001');
    const weak = await acct(s, 'POST', '/register', null, {
      fullName: 'Mariam A.',
      phone: '6000 1111',
      email: 'mariam@example.com',
      password: 'short',
    });
    expect(weak.statusCode).toBe(400);
    const registered = await acct(s, 'POST', '/register', null, {
      fullName: 'Mariam A.',
      phone: '6000 1111',
      email: 'Mariam@Example.com',
      password: 'Shopper-Pass-2026',
    });
    expect(registered.statusCode).toBe(201);
    const { token, account } = registered.json();
    expect(token).toMatch(/^st_/);
    expect(account).toMatchObject({ fullName: 'Mariam A.', email: 'mariam@example.com' });
    expect(
      await count('select count(*)::int as n from customers where merchant_id = $1', [
        s.c.merchantId,
      ]),
    ).toBe(1);
    // Same e-mail or phone again is refused.
    expect(
      (
        await acct(s, 'POST', '/register', null, {
          fullName: 'X',
          phone: '6000 1111',
          email: 'other@example.com',
          password: 'Shopper-Pass-2026',
        })
      ).json().code,
    ).toBe('PHONE_TAKEN');
    expect(
      (
        await acct(s, 'POST', '/register', null, {
          fullName: 'X',
          phone: '6000 9999',
          email: 'mariam@example.com',
          password: 'Shopper-Pass-2026',
        })
      ).json().code,
    ).toBe('EMAIL_TAKEN');
    // The account's orders include the guest order placed with the same phone.
    const mine = (await acct(s, 'GET', '/orders', token)).json();
    expect(
      mine.orders.map((o: { number: string; lineCount: number }) => [o.number, o.lineCount]),
    ).toEqual([['W-000001', 1]]);
    // Addresses: add, default, update, delete.
    const area = await s.ok('POST', '/manager/online/delivery-areas', {
      nameEn: 'Salmiya',
      fee: '1.000',
    });
    let view = (
      await acct(s, 'POST', '/addresses', token, {
        label: 'Home',
        deliveryAreaId: area.id,
        address: 'Block 3',
        isDefault: true,
      })
    ).json();
    expect(view.addresses).toEqual([
      expect.objectContaining({ label: 'Home', deliveryAreaId: area.id, isDefault: true }),
    ]);
    view = (
      await acct(s, 'POST', '/addresses', token, {
        label: 'Work',
        address: 'Office 9',
        isDefault: true,
      })
    ).json();
    expect(
      view.addresses.map((a: { label: string; isDefault: boolean }) => [a.label, a.isDefault]),
    ).toEqual([
      ['Work', true],
      ['Home', false],
    ]);
    view = (await acct(s, 'DELETE', `/addresses/${view.addresses[1].id}`, token)).json();
    expect(view.addresses).toHaveLength(1);
    // A signed-in checkout belongs to the account and may keep its address.
    const placed = (
      await s.c.client.request('POST', `/store/${s.slug}/checkout`, {
        headers: auth(token),
        body: {
          idempotencyKey: newId(),
          lines: [{ variantId: s.gift, quantity: '1' }],
          fulfillment: 'delivery',
          customer: { name: 'Mariam A.', phone: '6000 1111', email: 'mariam@example.com' },
          deliveryAddress: 'Block 7, Hawally',
          deliveryAreaId: area.id,
          saveAddress: true,
          paymentMethodId: null,
          expectedTotal: '6.000',
        },
      })
    ).json().order;
    expect(placed.number).toBe('W-000002');
    const after = (await acct(s, 'GET', '', token)).json();
    expect(after.addresses.map((a: { address: string }) => a.address)).toEqual([
      'Office 9',
      'Block 7, Hawally',
    ]);
    expect((await acct(s, 'GET', '/orders', token)).json().orders).toHaveLength(2);
    // Profile and password; the old token of other sessions is revoked by a password change.
    const second = (
      await acct(s, 'POST', '/login', null, {
        email: 'mariam@example.com',
        password: 'Shopper-Pass-2026',
      })
    ).json().token;
    expect(
      (await acct(s, 'PUT', '', token, { fullName: 'Mariam Ali', phone: '6000 1111' })).json()
        .account.fullName,
    ).toBe('Mariam Ali');
    expect(
      (await acct(s, 'PUT', '/password', token, { current: 'wrong', next: 'Another-Pass-2026' }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await acct(s, 'PUT', '/password', token, {
          current: 'Shopper-Pass-2026',
          next: 'Another-Pass-2026',
        })
      ).statusCode,
    ).toBe(204);
    expect((await acct(s, 'GET', '', second)).statusCode).toBe(401);
    expect((await acct(s, 'GET', '', token)).statusCode).toBe(200);
    // Logout ends the session; a wrong password is refused without saying which part.
    expect((await acct(s, 'POST', '/logout', token)).statusCode).toBe(204);
    expect((await acct(s, 'GET', '', token)).statusCode).toBe(401);
    expect(
      (
        await acct(s, 'POST', '/login', null, {
          email: 'mariam@example.com',
          password: 'Shopper-Pass-2026',
        })
      ).json().code,
    ).toBe('INVALID_CREDENTIALS');
    expect(
      (
        await acct(s, 'POST', '/login', null, {
          email: 'mariam@example.com',
          password: 'Another-Pass-2026',
        })
      ).statusCode,
    ).toBe(200);
    // Another store cannot use this token.
    const other = await setup({ gateway: false });
    expect(
      (
        await other.c.client.request('GET', `/store/${other.slug}/account`, {
          headers: auth(token),
        })
      ).statusCode,
    ).toBe(401);
  });

  it('resets a forgotten password by e-mail and refuses accounts when the store turned them off', async () => {
    const s = await setup({ gateway: false });
    const { token } = (
      await acct(s, 'POST', '/register', null, {
        fullName: 'Dana',
        phone: '6000 2222',
        email: 'dana@example.com',
        password: 'Shopper-Pass-2026',
      })
    ).json();
    const before = mailer.outbox.length;
    expect(
      (await acct(s, 'POST', '/forgot', null, { email: 'nobody@example.com' })).statusCode,
    ).toBe(204);
    expect((await acct(s, 'POST', '/forgot', null, { email: 'dana@example.com' })).statusCode).toBe(
      204,
    );
    await app.get(StoreAccountsService).drain();
    const sent = mailer.outbox.slice(before);
    expect(sent).toHaveLength(1);
    const reset = new RegExp(`/store/${s.slug}/account/reset/([A-Za-z0-9_-]+)`).exec(
      sent[0]!.text,
    )![1]!;
    expect(
      (
        await acct(s, 'POST', '/reset', null, {
          token: 'nope-nope-nope',
          password: 'Fresh-Pass-2026',
        })
      ).json().code,
    ).toBe('RESET_TOKEN_INVALID');
    expect(
      (await acct(s, 'POST', '/reset', null, { token: reset, password: 'Fresh-Pass-2026' }))
        .statusCode,
    ).toBe(204);
    expect(
      (await acct(s, 'POST', '/reset', null, { token: reset, password: 'Fresh-Pass-2026' }))
        .statusCode,
    ).toBe(400);
    expect((await acct(s, 'GET', '', token)).statusCode).toBe(401);
    expect(
      (
        await acct(s, 'POST', '/login', null, {
          email: 'dana@example.com',
          password: 'Fresh-Pass-2026',
        })
      ).statusCode,
    ).toBe(200);
    const store = await s.ok('GET', '/manager/online/store');
    await s.ok('PUT', '/manager/online/store', {
      ...store,
      deliveryFee: store.deliveryFee.amount,
      minimumOrder: store.minimumOrder.amount,
      accountsEnabled: false,
    });
    expect((await pub(s, 'GET', '')).json().accountsEnabled).toBe(false);
    expect(
      (
        await acct(s, 'POST', '/register', null, {
          fullName: 'X',
          phone: '6000 3333',
          email: 'x@example.com',
          password: 'Shopper-Pass-2026',
        })
      ).json().code,
    ).toBe('ACCOUNTS_DISABLED');
  });
});

describe('promotions (ADR-0125)', () => {
  const quote = (s: S, body: Record<string, unknown>) =>
    pub(s, 'POST', '/quote', {
      lines: [{ variantId: s.tea, quantity: '2' }],
      fulfillment: 'delivery',
      ...body,
    });

  it('applies a code or the best automatic offer, counts uses and records the discount on the sale', async () => {
    const s = await setup({ gateway: false });
    const ten = await s.ok('POST', '/manager/online/promotions', {
      nameEn: 'Ten off',
      kind: 'code',
      code: 'ten10',
      discountType: 'percentage',
      percent: '10',
      minimumOrder: '2.000',
      maxUses: 2,
      maxUsesPerCustomer: 1,
    });
    expect(ten).toMatchObject({ code: 'TEN10', percent: '10.00', usesCount: 0, status: 'active' });
    expect(
      (
        await s.req('POST', '/manager/online/promotions', {
          nameEn: 'Dup',
          code: 'TEN10',
          discountType: 'fixed',
          amount: '1.000',
        })
      ).json().code,
    ).toBe('DUPLICATE_CODE');
    const freeShip = await s.ok('POST', '/manager/online/promotions', {
      nameEn: 'Free delivery over 2',
      kind: 'automatic',
      discountType: 'free_delivery',
      minimumOrder: '2.000',
    });
    const gift = await s.ok('POST', '/manager/online/promotions', {
      nameEn: 'Gift cards 1 KWD off',
      kind: 'automatic',
      discountType: 'fixed',
      amount: '1.000',
      appliesTo: 'product',
      targetIds: [
        s.teaProduct === s.teaProduct
          ? (await s.ok('GET', '/manager/online/listings')).products.find(
              (p: { nameEn: string }) => p.nameEn === 'Gift card',
            ).productId
          : '',
      ],
    });
    // Tea 2 × 1.250 = 2.500 delivered: the automatic free delivery beats nothing else (the gift
    // offer does not match); the code gives 0.250 and wins when entered.
    let q = (await quote(s, {})).json();
    expect(q).toMatchObject({
      subtotal: { amount: '2.500' },
      discount: { amount: '0.000' },
      deliveryFee: { amount: '0.000' },
      total: { amount: '2.500' },
      promotion: { nameEn: 'Free delivery over 2' },
      codeIssue: null,
    });
    q = (await quote(s, { promotionCode: 'ten10' })).json();
    expect(q).toMatchObject({
      discount: { amount: '0.250' },
      deliveryFee: { amount: '0.500' },
      total: { amount: '2.750' },
      promotion: { code: 'TEN10' },
    });
    expect((await quote(s, { promotionCode: 'NOPE' })).json()).toMatchObject({
      codeIssue: 'unknown',
      promotion: { nameEn: 'Free delivery over 2' },
    });
    expect(
      (
        await quote(s, { promotionCode: 'TEN10', lines: [{ variantId: s.tea, quantity: '1' }] })
      ).json().codeIssue,
    ).toBe('minimum');
    // The gift card offer applies to the gift product only.
    q = (
      await quote(s, { lines: [{ variantId: s.gift, quantity: '1' }], fulfillment: 'pickup' })
    ).json();
    expect(q).toMatchObject({
      discount: { amount: '1.000' },
      total: { amount: '4.000' },
      promotion: { nameEn: 'Gift cards 1 KWD off' },
    });
    // Checkout with the code: the order carries the discount, the use is counted.
    const wrongTotal = await checkout(s, {
      paymentMethodId: null,
      promotionCode: 'TEN10',
      expectedTotal: '3.000',
    });
    expect(wrongTotal.json().code).toBe('TOTAL_CHANGED');
    const order = (
      await checkout(s, { paymentMethodId: null, promotionCode: 'TEN10', expectedTotal: '2.750' })
    ).json().order;
    expect(order).toMatchObject({
      discount: { amount: '0.250' },
      deliveryFee: { amount: '0.500' },
      total: { amount: '2.750' },
      promotion: { code: 'TEN10', name: 'Ten off' },
    });
    expect(
      (await s.ok('GET', '/manager/online/promotions')).promotions.find(
        (p: { id: string }) => p.id === ten.id,
      ).usesCount,
    ).toBe(1);
    // The same shopper may not use it again (per customer 1); another shopper may, then it is used up.
    expect(
      (
        await checkout(s, { paymentMethodId: null, promotionCode: 'TEN10', expectedTotal: '2.750' })
      ).json().issues[0],
    ).toMatchObject({ path: 'promotionCode', code: 'customer_limit' });
    const second = (
      await checkout(s, {
        paymentMethodId: null,
        promotionCode: 'TEN10',
        customer: { name: 'Noor', phone: '6000 5555', email: null },
        expectedTotal: '2.750',
      })
    ).json().order;
    expect(second.number).toBe('W-000002');
    expect(
      (
        await checkout(s, {
          paymentMethodId: null,
          promotionCode: 'TEN10',
          customer: { name: 'Omar', phone: '6000 6666', email: null },
          expectedTotal: '2.750',
        })
      ).json().issues[0].code,
    ).toBe('used_up');
    // Recording the payment creates the sale with the order discount spread over its lines.
    const [placed] = (await s.ok('GET', '/manager/online/orders?status=placed')).orders.filter(
      (o: { number: string }) => o.number === order.number,
    );
    const paid = await s.ok('POST', `/manager/online/orders/${placed.id}/action`, {
      action: 'mark_paid',
      paymentMethodId: s.cash,
      version: 1,
    });
    const sale = await s.ok('GET', `/manager/sales/${paid.saleId}`);
    expect(sale).toMatchObject({
      subtotal: { amount: '3.000' },
      orderDiscount: { amount: '0.250' },
      total: { amount: '2.750' },
    });
    // A used promotion is paused, not deleted; an unused one is deleted.
    expect(
      (await s.ok('DELETE', `/manager/online/promotions/${ten.id}`)).promotions.find(
        (p: { id: string }) => p.id === ten.id,
      ).status,
    ).toBe('paused');
    expect(
      (await s.ok('DELETE', `/manager/online/promotions/${gift.id}`)).promotions.map(
        (p: { id: string }) => p.id,
      ),
    ).toEqual([ten.id, freeShip.id]);
    await app.get(OrderNotificationsService).drain();
  });
});

describe('store design (ADR-0128)', () => {
  it('saves a draft, publishes it, serves its pictures and keeps shoppers on the published one', async () => {
    const s = await setup({ gateway: false });
    // Nothing designed yet: the legacy layout, also for shoppers.
    const first = await s.ok('GET', '/manager/online/design');
    expect(first).toMatchObject({ version: 0, published: null, dirty: false });
    expect(first.suggestedTemplate).toBe('retail');
    expect(first.draft.pages.home.map((x: { type: string }) => x.type)).toEqual([
      'banner',
      'catalog',
    ]);
    const legacy = (await pub(s, 'GET', '/design')).json().design;
    expect(legacy.pages.home.map((x: { type: string }) => x.type)).toEqual(['banner', 'catalog']);

    // A picture for the slider.
    const asset = (await upload(s, '/manager/online/design/assets')).json();
    expect(asset).toMatchObject({ contentType: 'image/png', bytes: png.length });
    expect(
      (await upload(s, '/manager/online/design/assets', Buffer.from('not an image'))).statusCode,
    ).toBe(415);

    const design = structuredClone(first.draft);
    design.template = 'retail';
    design.header = { ...design.header, layout: 'centered', background: 'brand' };
    design.navbar = {
      style: 'pills',
      items: [
        { id: 'n1', label: { en: 'Shop', ar: 'تسوق' }, link: { kind: 'page', page: 'products' } },
      ],
    };
    design.footer = {
      style: 'columns',
      showPoweredBy: true,
      blocks: [
        {
          id: 'about',
          type: 'about',
          title: { en: 'About', ar: null },
          text: { en: 'Since 1990', ar: null },
          links: [],
        },
      ],
    };
    design.social = { ...design.social, instagram: 'saffron.house', whatsapp: '+96550000000' };
    design.pages.home = [
      {
        id: 'hero',
        type: 'slider',
        variant: 'full',
        autoplay: true,
        visible: true,
        slides: [
          {
            id: 's1',
            imageId: asset.id,
            title: { en: 'Eid offers', ar: 'عروض العيد' },
            subtitle: { en: null, ar: null },
            button: { en: null, ar: null },
            link: { kind: 'page', page: 'products' },
          },
        ],
      },
      { id: 'video', type: 'video', url: 'https://youtu.be/dQw4w9WgXcQ' },
      { id: 'catalog', type: 'catalog' },
    ];
    const saved = await s.ok('PUT', '/manager/online/design', { design, version: 0 });
    expect(saved).toMatchObject({ version: 1, dirty: true, published: null });
    expect(saved.draft.pages.home[1]).toMatchObject({
      type: 'video',
      variant: 'contained',
      aspect: 'landscape',
    });
    // Shoppers still see the legacy layout until it is published.
    expect((await pub(s, 'GET', '/design')).json().design.pages.home[0].type).toBe('banner');

    // Refused: stale version, an unknown picture, a script link, a products page without a list.
    expect((await s.req('PUT', '/manager/online/design', { design, version: 0 })).json().code).toBe(
      'VERSION_CONFLICT',
    );
    const ghost = structuredClone(design);
    ghost.pages.home[0].slides[0].imageId = newId();
    expect(
      (await s.req('PUT', '/manager/online/design', { design: ghost, version: 1 })).statusCode,
    ).toBe(400);
    const script = structuredClone(design);
    script.navbar.items[0].link = { kind: 'url', url: 'javascript:alert(1)' };
    expect(
      (await s.req('PUT', '/manager/online/design', { design: script, version: 1 })).statusCode,
    ).toBe(400);
    const empty = structuredClone(design);
    empty.pages.products = [];
    expect(
      (await s.req('PUT', '/manager/online/design', { design: empty, version: 1 })).statusCode,
    ).toBe(400);
    const badVideo = structuredClone(design);
    badVideo.pages.home[1].url = 'https://example.com/movie.mp4';
    expect(
      (await s.req('PUT', '/manager/online/design', { design: badVideo, version: 1 })).statusCode,
    ).toBe(400);

    // Published: shoppers get the design and its picture (cached for a year).
    const published = await s.ok('POST', '/manager/online/design/publish', { version: 1 });
    expect(published).toMatchObject({ version: 2, dirty: false });
    expect(published.publishedAt).toBeTruthy();
    const live = (await pub(s, 'GET', '/design')).json().design;
    expect(live.pages.home.map((x: { type: string }) => x.type)).toEqual([
      'slider',
      'video',
      'catalog',
    ]);
    expect(live.header).toMatchObject({ layout: 'centered', background: 'brand' });
    expect(live.social.instagram).toBe('saffron.house');
    const picture = await pub(s, 'GET', `/assets/${asset.id}`);
    expect(picture.statusCode).toBe(200);
    expect(picture.headers['content-type']).toBe('image/png');
    expect(picture.headers['cache-control']).toContain('immutable');

    // A picture in use cannot be deleted; an unused one can.
    expect((await s.req('DELETE', `/manager/online/design/assets/${asset.id}`)).json().code).toBe(
      'ASSET_IN_USE',
    );
    const spare = (await upload(s, '/manager/online/design/assets')).json();
    expect(
      (await s.ok('DELETE', `/manager/online/design/assets/${spare.id}`)).assets.map(
        (a: { id: string }) => a.id,
      ),
    ).toEqual([asset.id]);

    // Discarding a later edit returns the draft to what is published.
    const edited = structuredClone(live);
    edited.pages.home = edited.pages.home.filter((x: { type: string }) => x.type !== 'video');
    await s.ok('PUT', '/manager/online/design', { design: edited, version: 2 });
    const back = await s.ok('POST', '/manager/online/design/discard', { version: 3 });
    expect(back.dirty).toBe(false);
    expect(back.draft.pages.home).toHaveLength(3);

    // Audit trail of the design.
    const actions = (
      await owner.query(
        `select action from audit_log where merchant_id = $1 and action like 'online.design%' order by occurred_at`,
        [s.c.merchantId],
      )
    ).rows.map((r: { action: string }) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'online.design_asset_added',
        'online.design_saved',
        'online.design_published',
        'online.design_asset_removed',
        'online.design_discarded',
      ]),
    );

    // Others: a branch manager has no online.manage; another company sees nothing of it.
    const bm = await s.c.hire(
      [{ roleId: s.c.roles.branch_manager, branchId: s.c.main }],
      'manager',
    );
    expect((await s.req('GET', '/manager/online/design', undefined, bm.cookies)).statusCode).toBe(
      403,
    );
    const other = await setup({ gateway: false });
    expect(
      (await other.req('GET', `/manager/online/design/assets/${asset.id}/file`)).statusCode,
    ).toBe(404);
    expect((await pub(other, 'GET', `/assets/${asset.id}`)).statusCode).toBe(404);
    expect((await other.ok('GET', '/manager/online/design')).version).toBe(0);
  });

  it('previews a draft store through the console and suggests the restaurant template', async () => {
    const s = await setup({ gateway: false });
    const current = await s.ok('GET', '/manager/online/store');
    await s.ok('PUT', '/manager/online/store', {
      ...current,
      deliveryFee: current.deliveryFee.amount,
      minimumOrder: current.minimumOrder.amount,
      status: 'draft',
    });
    await upload(s, '/manager/online/store/logo');
    // Hidden from shoppers, visible to its owner in the preview, with console picture links.
    expect((await pub(s, 'GET', '')).statusCode).toBe(404);
    const preview = await s.ok('GET', '/manager/online/preview/storefront');
    expect(preview.slug).toBe(s.slug);
    expect(preview.logoUrl).toMatch(/^\/api\/v1\/manager\/online\/store\/logo\?v=/);
    const products = (await s.ok('GET', '/manager/online/preview/products')).products;
    expect(products.map((p: { nameEn: string }) => p.nameEn).sort()).toEqual([
      'Gift card',
      'Saffron tea',
    ]);
    expect((await s.ok('GET', `/manager/online/preview/products/${s.teaProduct}`)).nameEn).toBe(
      'Saffron tea',
    );
    expect((await s.c.client.request('GET', '/manager/online/preview/storefront')).statusCode).toBe(
      401,
    );

    // A company running the restaurant module is offered the restaurant template.
    await db.inMerchant(s.c.merchantId, (client) =>
      client.query(
        `insert into restaurant_settings (merchant_id, enabled) values ($1, true)
         on conflict (merchant_id) do update set enabled = true`,
        [s.c.merchantId],
      ),
    );
    expect((await s.ok('GET', '/manager/online/design')).suggestedTemplate).toBe('restaurant');
  });
});
