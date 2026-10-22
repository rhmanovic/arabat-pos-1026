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
type Rec = Record<string, unknown>;
let seq = 0;

/**
 * A company with a published store (pay on receipt), drinks under a "Hot" category with a
 * "Tea" sub-category, a cake in a "Sweets" category and list, and a till with an open shift.
 */
async function setup() {
  const c = await createCompany(app, db, mailer);
  const req = (method: string, path: string, body?: unknown, cookies: Cookies | null = c.cookies) =>
    c.client.request(method as 'GET', path, {
      ...(cookies ? { cookies } : {}),
      ...(body === undefined ? {} : { body }),
    });
  const ok = async (method: string, path: string, body?: unknown, cookies?: Cookies | null) => {
    const r = await req(method, path, body, cookies === undefined ? c.cookies : cookies);
    if (r.statusCode >= 300) throw new Error(`${method} ${path} ${r.statusCode} ${r.body}`);
    return r.json();
  };
  const hot = await ok('POST', '/manager/categories', { nameEn: 'Hot' });
  const teaCat = await ok('POST', '/manager/categories', { nameEn: 'Tea', parentId: hot.id });
  const sweets = await ok('POST', '/manager/categories', { nameEn: 'Sweets' });
  const product = async (nameEn: string, categoryId: string, price: string, cost: string) => {
    const p = await ok('POST', '/manager/products', {
      nameEn,
      categoryId,
      trackInventory: false,
      variants: [{ sku: `S-${newId().slice(-8)}`, price, cost }],
    });
    return { id: p.id as string, variant: p.variants[0].id as string };
  };
  const karak = await product('Karak', teaCat.id, '1.250', '0.300');
  const coffee = await product('Coffee', hot.id, '2.000', '1.900');
  const cake = await product('Cake', sweets.id, '0.400', '0.100');
  const list = await ok('POST', '/manager/online/collections', { nameEn: 'Weekend' });
  await ok('PUT', '/manager/online/listings', {
    productIds: [cake.id],
    addToCollectionId: list.id,
  });
  const slug = `disc-${Date.now().toString(36)}-${(seq += 1)}`;
  await ok('PUT', '/manager/online/store', {
    slug,
    status: 'published',
    nameEn: 'Discount House',
    primaryColor: '#7c2d12',
    fulfillmentBranchId: c.main,
    pickupEnabled: true,
    deliveryEnabled: false,
    deliveryFee: '0.000',
    minimumOrder: '0.000',
    reservationMinutes: 30,
    payOnReceiptEnabled: true,
    version: 0,
  });
  const methods = (await ok('GET', '/manager/payment-methods')).methods as Rec[];
  const cash = methods.find((m) => m['kind'] === 'cash')!['id'] as string;
  const registers = (await ok('GET', `/manager/registers?branchId=${c.main}`)).registers as Rec[];
  const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
  await ok(
    'POST',
    '/pos/shifts',
    { registerId: registers[0]!['id'], countedCash: '10.000', expectedCash: '0.000' },
    cashier.cookies,
  );
  const discount = (body: Rec) => ok('POST', '/manager/discounts', body);
  return {
    c,
    req,
    ok,
    slug,
    hot: hot.id as string,
    teaCat: teaCat.id as string,
    list: list.id as string,
    karak,
    coffee,
    cake,
    cash,
    cashier: cashier.cookies,
    discount,
  };
}
type S = Awaited<ReturnType<typeof setup>>;

const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

/** The price the till shows now for a variant (catalog price or its offer in force). */
async function posPrice(s: S, variantId: string) {
  const catalog = await s.ok('GET', '/pos/catalog', undefined, s.cashier);
  const item = (catalog.items as Rec[]).find((i) => i['variantId'] === variantId)!;
  return item;
}

async function storeVariant(s: S, productId: string) {
  const r = await s.ok('GET', `/store/${s.slug}/products/${productId}`, undefined, null);
  return (r.variants as Rec[])[0]!;
}

describe('managing product discounts', () => {
  it('previews, creates, counts, schedules, pauses and archives; prices need the right', async () => {
    const s = await setup();
    // 10% on the "Hot" category covers its "Tea" sub-category; the coffee goes below cost.
    const body = {
      nameAr: 'خصم المشروبات',
      type: 'percentage',
      percent: '10',
      appliesTo: 'categories',
      targetIds: [s.hot],
    };
    const preview = await s.ok('POST', '/manager/discounts/preview', body);
    expect(preview).toMatchObject({ products: 2, unchanged: 0, belowCost: 1 });
    expect(preview.samples[0]).toMatchObject({
      nameEn: 'Coffee',
      price: { amount: '2.000' },
      discountedPrice: { amount: '1.800' },
      belowCost: true,
    });
    const created = await s.discount(body);
    expect(created).toMatchObject({ state: 'running', productCount: 2, pos: true, online: true });
    // An amount as large as a product's price leaves that product alone.
    const amount = await s.ok('POST', '/manager/discounts/preview', {
      nameEn: 'Half a dinar',
      type: 'amount',
      amount: '0.500',
      appliesTo: 'all',
    });
    expect(amount).toMatchObject({ products: 2, unchanged: 1 });
    // Scheduled, then paused, then archived (no more changes).
    const later = await s.discount({
      nameEn: 'Later',
      type: 'percentage',
      percent: '30',
      appliesTo: 'collections',
      targetIds: [s.list],
      startsAt: at(60),
    });
    expect(later).toMatchObject({ state: 'scheduled', productCount: 1 });
    const paused = await s.ok('POST', `/manager/discounts/${later.id}/status`, {
      status: 'paused',
    });
    expect(paused.state).toBe('paused');
    await s.ok('POST', `/manager/discounts/${later.id}/status`, { status: 'archived' });
    const refused = await s.req('PUT', `/manager/discounts/${later.id}`, { ...body, nameEn: 'x' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('DISCOUNT_ARCHIVED');
    const list = await s.ok('GET', '/manager/discounts');
    expect(list.discounts.map((d: Rec) => [d['nameEn'] ?? d['nameAr'], d['state']])).toEqual([
      ['خصم المشروبات', 'running'],
      ['Later', 'archived'],
    ]);
    // A target from elsewhere, a 100% discount and no channel are refused.
    expect(
      (await s.req('POST', '/manager/discounts', { ...body, targetIds: [newId()] })).statusCode,
    ).toBe(400);
    expect(
      (await s.req('POST', '/manager/discounts', { ...body, percent: '100' })).statusCode,
    ).toBe(400);
    expect(
      (await s.req('POST', '/manager/discounts', { ...body, pos: false, online: false }))
        .statusCode,
    ).toBe(400);
    // A store manager without the right to manage prices sees discounts but cannot change them.
    const role = await s.ok('POST', '/manager/roles', {
      nameEn: 'Online editor',
      permissions: ['manager.access', 'online.manage'],
    });
    const editor = await s.c.hire([{ roleId: role.id, branchId: null }], 'manager');
    expect((await s.req('GET', '/manager/discounts', undefined, editor.cookies)).statusCode).toBe(
      200,
    );
    expect((await s.req('POST', '/manager/discounts', body, editor.cookies)).statusCode).toBe(403);
    const audit = await owner.query(
      `select action from audit_log where merchant_id = $1 and action like 'catalog.discount%' order by occurred_at`,
      [s.c.merchantId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'catalog.discount_created',
      'catalog.discount_created',
      'catalog.discount_status_changed',
      'catalog.discount_status_changed',
    ]);
  });
});

describe('the point of sale', () => {
  it('sells at the largest discount in force and records the regular price', async () => {
    const s = await setup();
    const tenth = await s.discount({
      nameEn: 'Hot 10%',
      type: 'percentage',
      percent: '10',
      appliesTo: 'categories',
      targetIds: [s.hot],
    });
    const quarter = await s.discount({
      nameEn: 'Karak 0.250 off',
      type: 'amount',
      amount: '0.250',
      appliesTo: 'products',
      targetIds: [s.karak.id],
    });
    // Online only, and a future one: neither lowers the till's price now.
    await s.discount({
      nameEn: 'Web',
      type: 'percentage',
      percent: '50',
      appliesTo: 'all',
      pos: false,
    });
    await s.discount({
      nameEn: 'Tomorrow',
      type: 'percentage',
      percent: '60',
      appliesTo: 'all',
      startsAt: at(24 * 60),
    });
    const karak = await posPrice(s, s.karak.variant);
    expect(karak['price']).toMatchObject({ amount: '1.250' });
    expect((karak['offers'] as Rec[]).map((o) => (o['price'] as Rec)['amount'])).toEqual([
      '1.125',
      '1.000',
      '0.500',
    ]);
    // The cashier sees 1.000 (0.250 off beats 10%) and 1.800 for the coffee.
    const sale = await s.ok(
      'POST',
      '/pos/sales',
      {
        idempotencyKey: newId(),
        lines: [
          { variantId: s.karak.variant, quantity: '2' },
          // The cashier's own 10% comes on top of the discounted price, within the limit.
          {
            variantId: s.coffee.variant,
            quantity: '1',
            discount: { type: 'percent', value: '10' },
          },
          { variantId: s.cake.variant, quantity: '1' },
        ],
        payments: [{ methodId: s.cash, amount: '4.020', tendered: '5' }],
        expectedTotal: '4.020',
      },
      s.cashier,
    );
    expect(sale.lines).toMatchObject([
      {
        listUnitPrice: { amount: '1.000' },
        regularUnitPrice: { amount: '1.250' },
        unitPrice: { amount: '1.000' },
        priceOverridden: false,
        net: { amount: '2.000' },
      },
      {
        listUnitPrice: { amount: '1.800' },
        regularUnitPrice: { amount: '2.000' },
        lineDiscount: { amount: '0.180' },
        net: { amount: '1.620' },
      },
      { listUnitPrice: { amount: '0.400' }, regularUnitPrice: null },
    ]);
    const rows = await owner.query(
      `select product_discount_id from sale_lines where sale_id = $1 order by position`,
      [sale.id],
    );
    expect(rows.rows.map((r) => r.product_discount_id)).toEqual([quarter.id, tenth.id, null]);
    // A paused discount stops at once: the till's total for the same cart changes.
    await s.ok('POST', `/manager/discounts/${quarter.id}/status`, { status: 'paused' });
    const stale = await s.req(
      'POST',
      '/pos/sales',
      {
        idempotencyKey: newId(),
        lines: [{ variantId: s.karak.variant, quantity: '1' }],
        payments: [{ methodId: s.cash, amount: '1.000', tendered: '1' }],
        expectedTotal: '1.000',
      },
      s.cashier,
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('TOTAL_CHANGED');
    expect((await posPrice(s, s.karak.variant))['offers']).toHaveLength(2);
  });
});

describe('the online store', () => {
  it('shows the old price and orders at the new one; codes skip discounted items unless they stack', async () => {
    const s = await setup();
    const weekend = await s.discount({
      nameEn: 'Weekend',
      type: 'percentage',
      percent: '25',
      appliesTo: 'collections',
      targetIds: [s.list],
      endsAt: at(48 * 60),
    });
    await s.discount({
      nameEn: 'Till only',
      type: 'percentage',
      percent: '50',
      appliesTo: 'all',
      online: false,
    });
    const cake = await storeVariant(s, s.cake.id);
    expect(cake).toMatchObject({
      price: { amount: '0.300' },
      regularPrice: { amount: '0.400' },
      discountEndsAt: weekend.endsAt,
    });
    expect(await storeVariant(s, s.karak.id)).toMatchObject({
      price: { amount: '1.250' },
      regularPrice: null,
    });
    // A 10% code: off the karak only (the cake is already discounted).
    const promo = await s.ok('POST', '/manager/online/promotions', {
      nameEn: 'Ten',
      kind: 'code',
      code: 'TEN',
      discountType: 'percentage',
      percent: '10',
    });
    const cart = {
      lines: [
        { variantId: s.cake.variant, quantity: '2' },
        { variantId: s.karak.variant, quantity: '1' },
      ],
      fulfillment: 'pickup',
      promotionCode: 'TEN',
    };
    const quote = await s.ok('POST', `/store/${s.slug}/quote`, cart, null);
    expect(quote).toMatchObject({
      subtotal: { amount: '1.850' },
      discount: { amount: '0.125' },
      total: { amount: '1.725' },
    });
    // Only discounted items in the cart: the code does not apply.
    const onlyCake = await s.ok(
      'POST',
      `/store/${s.slug}/quote`,
      { ...cart, lines: [cart.lines[0]] },
      null,
    );
    expect(onlyCake).toMatchObject({ discount: { amount: '0.000' }, codeIssue: 'no_match' });
    // The same code set to stack takes 10% off the discounted price too.
    await s.ok('PUT', `/manager/online/promotions/${promo.id}`, {
      nameEn: 'Ten',
      kind: 'code',
      code: 'TEN',
      discountType: 'percentage',
      percent: '10',
      stacksWithDiscounts: true,
      version: promo.version,
    });
    const stacked = await s.ok('POST', `/store/${s.slug}/quote`, cart, null);
    expect(stacked).toMatchObject({ discount: { amount: '0.185' }, total: { amount: '1.665' } });
    // The order records the regular price and the discount on its lines.
    const order = await s.ok(
      'POST',
      `/store/${s.slug}/checkout`,
      {
        idempotencyKey: newId(),
        ...cart,
        customer: { name: 'Noor', phone: '6000 2222', email: null },
        paymentMethodId: null,
        expectedTotal: '1.665',
      },
      null,
    );
    const lines = await owner.query(
      `select unit_price_minor::text as price, regular_unit_price_minor::text as regular, product_discount_id
       from online_order_lines l join online_orders o on o.id = l.order_id
       where o.number = $1 and o.merchant_id = $2 order by l.position`,
      [order.order.number, s.c.merchantId],
    );
    expect(lines.rows).toEqual([
      { price: '300', regular: '400', product_discount_id: weekend.id },
      { price: '1250', regular: null, product_discount_id: null },
    ]);
  });
});
