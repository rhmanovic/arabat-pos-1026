import { createApiClient } from '@arabat/api-client';
import { type DesignSection, newSection, templateDesign } from '@arabat/contracts';
import { flattenKeys } from '@arabat/i18n';
import { createQueryClient } from '@arabat/web-core';
import { fakeApiFetch, type FakeRoute } from '@arabat/web-core/testing';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n, resources } from './i18n/index.js';
import { StoreRoot } from './root.js';
import { routes } from './routes.js';

const kwd = (amount: string) => ({ amount, currency: 'KWD' });
const STORE = {
  slug: 'demo',
  nameEn: 'Demo Shop',
  nameAr: 'متجر تجريبي',
  taglineEn: 'Fresh daily',
  taglineAr: null,
  announcementEn: null,
  announcementAr: null,
  primaryColor: '#0f766e',
  contactPhone: null,
  contactEmail: null,
  acceptingOrders: true,
  pickupEnabled: true,
  deliveryEnabled: true,
  deliveryFee: kwd('1.500'),
  minimumOrder: kwd('2.000'),
  paymentMethods: [
    {
      id: '0190a000-0000-7000-8000-0000000000aa',
      nameEn: 'Card',
      nameAr: 'بطاقة',
      provider: 'mock',
    },
  ],
  payOnReceipt: true,
  logoUrl: null,
  bannerUrl: null,
  categorySource: 'pos',
  categories: [],
  branches: [
    {
      id: '0190a000-0000-7000-8000-0000000000b1',
      nameEn: 'Main branch',
      nameAr: 'الفرع الرئيسي',
      address: 'Salem Al-Mubarak St.',
      phone: '+96522223333',
      pickupEnabled: true,
      deliveryEnabled: true,
      preparationMinutes: 0,
      hours: null,
      openNow: true,
    },
  ],
  defaultBranchId: '0190a000-0000-7000-8000-0000000000b1',
  deliveryAreas: [],
  scheduling: { enabled: false, slotMinutes: 30 },
  timezone: 'Asia/Kuwait',
  accountsEnabled: true,
};
const COFFEE = '0190a000-0000-7000-8000-000000000001';
const COFFEE_V = '0190a000-0000-7000-8000-000000000011';
const MUG = '0190a000-0000-7000-8000-000000000002';
const PRODUCTS = {
  products: [
    {
      productId: COFFEE,
      nameEn: 'Coffee beans',
      nameAr: 'حبوب قهوة',
      descriptionEn: 'Medium roast',
      descriptionAr: null,
      categoryId: null,
      imageUrl: null,
      images: [],
      featured: false,
      position: 0,
      variants: [
        {
          variantId: COFFEE_V,
          nameEn: null,
          nameAr: null,
          sku: 'CB',
          price: kwd('1.250'),
          available: true,
          maxQuantity: 3,
        },
      ],
    },
    {
      productId: MUG,
      nameEn: 'Mug',
      nameAr: 'كوب',
      descriptionEn: null,
      descriptionAr: null,
      categoryId: null,
      imageUrl: null,
      images: [],
      featured: false,
      position: 1,
      variants: [
        {
          variantId: '0190a000-0000-7000-8000-000000000022',
          nameEn: null,
          nameAr: null,
          sku: 'MG',
          price: kwd('4.000'),
          available: false,
          maxQuantity: 0,
        },
      ],
    },
  ],
};
const ORDER = {
  number: 'W-000001',
  status: 'pending_payment',
  fulfillment: 'delivery',
  customerName: 'Sara',
  lines: [
    {
      position: 1,
      variantId: COFFEE_V,
      productId: COFFEE,
      nameEn: 'Coffee beans',
      nameAr: 'حبوب قهوة',
      variantNameEn: null,
      variantNameAr: null,
      sku: 'CB',
      quantity: '2.000',
      unitPrice: kwd('1.250'),
      lineTotal: kwd('2.500'),
    },
  ],
  subtotal: kwd('2.500'),
  discount: kwd('0.000'),
  promotion: null,
  deliveryFee: kwd('1.500'),
  total: kwd('4.000'),
  createdAt: '2026-10-12T10:00:00.000Z',
  paymentMode: 'gateway',
  paidAt: null,
  reservedUntil: '2026-10-12T10:15:00.000Z',
  trackingToken: 'tok123',
  scheduledFor: null,
  deliveryAreaName: null,
  deliveryArea: null,
  branch: { nameEn: 'Main branch', nameAr: null, address: 'Salem Al-Mubarak St.', phone: null },
  paymentUrl: 'http://localhost/store/pay/mock_abc?return=x',
  timeline: [{ status: 'pending_payment', at: '2026-10-12T10:00:00.000Z' }],
};

/** What the API's quote would answer for a cart (no promotion; the area's fee or the flat one). */
type Area = {
  id: string;
  fee: { amount: string; currency: string };
  freeDeliveryFrom: { amount: string; currency: string } | null;
};
function quoteFor(body: unknown, areas: Area[] = []) {
  const q = body as {
    lines: { variantId: string; quantity: string }[];
    fulfillment: string;
    deliveryAreaId: string | null;
  };
  const subtotal = q.lines.reduce((sum, l) => {
    const variant = PRODUCTS.products
      .flatMap((p) => p.variants)
      .find((v) => v.variantId === l.variantId)!;
    return sum + Number(variant.price.amount) * Number(l.quantity);
  }, 0);
  const area = areas.find((a) => a.id === q.deliveryAreaId) ?? null;
  const fee =
    q.fulfillment !== 'delivery'
      ? 0
      : areas.length > 0
        ? area === null
          ? 0
          : area.freeDeliveryFrom !== null && subtotal >= Number(area.freeDeliveryFrom.amount)
            ? 0
            : Number(area.fee.amount)
        : Number(STORE.deliveryFee.amount);
  const money = (n: number) => ({ amount: n.toFixed(3), currency: 'KWD' });
  return {
    status: 200,
    body: {
      subtotal: money(subtotal),
      discount: money(0),
      deliveryFee: money(fee),
      total: money(subtotal + fee),
      promotion: null,
      codeIssue: null,
    },
  };
}

function renderStore(path: string, routesMap: Record<string, FakeRoute> = {}) {
  const fetch = fakeApiFetch({
    routes: {
      'GET /store/demo': () => ({ status: 200, body: STORE }),
      'GET /store/demo/products': () => ({ status: 200, body: PRODUCTS }),
      'POST /store/demo/quote': (body) => quoteFor(body),
      ...routesMap,
    },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  render(
    <StoreRoot i18n={i18n} api={createApiClient({ fetch })} queryClient={queryClient}>
      <RouterProvider router={router} />
    </StoreRoot>,
  );
  return { fetch, router };
}

const assign = vi.fn();
beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
  assign.mockReset();
  vi.stubGlobal('location', { ...window.location, assign, origin: 'http://localhost' });
});
afterEach(() => vi.unstubAllGlobals());

describe('storefront', () => {
  it('lists online products and marks sold-out ones', async () => {
    renderStore('/demo');
    expect(await screen.findByText('Demo Shop')).toBeInTheDocument();
    const mug = (await screen.findByText('Mug')).closest('a')!;
    expect(within(mug).getByText('Sold out')).toBeInTheDocument();
    expect(screen.getByText('KWD 1.250')).toBeInTheDocument();
  });

  it('shows the banner, logo, featured products and category pictures, and sorts by price', async () => {
    const user = userEvent.setup();
    const CAT = '0190a000-0000-7000-8000-0000000000c9';
    renderStore('/demo', {
      'GET /store/demo': () => ({
        status: 200,
        body: {
          ...STORE,
          logoUrl: '/api/v1/store/demo/logo?v=3',
          bannerUrl: '/api/v1/store/demo/banner?v=3',
          categorySource: 'online',
          categories: [
            {
              id: CAT,
              nameEn: 'Drinks',
              nameAr: 'مشروبات',
              imageUrl: '/api/v1/store/demo/categories/x/image?v=1',
            },
          ],
        },
      }),
      'GET /store/demo/products': () => ({
        status: 200,
        body: {
          products: [
            { ...PRODUCTS.products[0]!, featured: true, categoryId: CAT, position: 1 },
            { ...PRODUCTS.products[1]!, position: 0 },
          ],
        },
      }),
    });
    expect(await screen.findByTestId('store-banner')).toHaveAttribute(
      'src',
      '/api/v1/store/demo/banner?v=3',
    );
    expect(screen.getByTestId('store-logo')).toBeInTheDocument();
    const featured = await screen.findByRole('region', { name: 'Featured' });
    expect(within(featured).getByText('Coffee beans')).toBeInTheDocument();
    expect(within(featured).queryByText('Mug')).toBeNull();
    // Store order puts the mug (position 0) first in the full grid; price sorting reorders.
    const grid = () => within(screen.getByTestId('product-grid')).getAllByRole('listitem');
    expect(grid()[0]).toHaveTextContent('Mug');
    await user.selectOptions(screen.getByLabelText('Sort'), 'priceAsc');
    expect(grid()[0]).toHaveTextContent('Coffee beans');
    // The category chip carries its picture and filters the grid.
    const chip = screen.getByRole('button', { name: 'Drinks' });
    expect(chip.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/categories/'),
    );
    await user.click(chip);
    expect(screen.queryByText('Mug')).toBeNull();
    expect(document.title).toBe('Demo Shop');
  });

  it('shows the picture gallery and shares the product link', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText }, share: undefined });
    renderStore(`/demo/products/${COFFEE}`, {
      'GET /store/demo/products': () => ({
        status: 200,
        body: {
          products: [
            {
              ...PRODUCTS.products[0]!,
              imageUrl: '/img/1',
              images: ['/img/1', '/img/2'],
              descriptionEn: 'Store says: roasted today',
            },
          ],
        },
      }),
    });
    expect(await screen.findByTestId('product-image')).toHaveAttribute('src', '/img/1');
    await user.click(screen.getByRole('button', { name: 'Picture 2' }));
    expect(screen.getByTestId('product-image')).toHaveAttribute('src', '/img/2');
    expect(screen.getByText('Store says: roasted today')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/demo/products/')),
    );
    expect(document.title).toBe('Coffee beans · Demo Shop');
  });

  it('adds to the cart, caps the quantity at the offered maximum and prices exactly', async () => {
    const user = userEvent.setup();
    const { router } = renderStore(`/demo/products/${COFFEE}`);
    await user.click(await screen.findByRole('button', { name: 'Add to cart' }));
    expect(await screen.findByText('Cart (1)')).toBeInTheDocument();
    await router.navigate('/demo/cart');
    const plus = await screen.findByRole('button', { name: 'Increase quantity of Coffee beans' });
    await user.click(plus);
    await user.click(plus);
    expect(plus).toBeDisabled(); // maxQuantity 3
    // Line total and subtotal: 3 × 1.250, no float drift.
    expect(screen.getAllByText('KWD 3.750')).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem('arabat.cart.demo')!)).toEqual([
      { variantId: COFFEE_V, productId: COFFEE, quantity: 3 },
    ]);
  });

  it('blocks checkout below the minimum order', async () => {
    localStorage.setItem(
      'arabat.cart.demo',
      JSON.stringify([{ variantId: COFFEE_V, productId: COFFEE, quantity: 1 }]),
    );
    renderStore('/demo/cart');
    expect(await screen.findByText('The minimum order is KWD 2.000.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Checkout' })).toBeDisabled();
  });

  it('submits checkout with the total shown and sends the shopper to the payment page', async () => {
    localStorage.setItem(
      'arabat.cart.demo',
      JSON.stringify([{ variantId: COFFEE_V, productId: COFFEE, quantity: 2 }]),
    );
    const user = userEvent.setup();
    const { fetch } = renderStore('/demo/checkout', {
      'POST /store/demo/checkout': () => ({ status: 201, body: { order: ORDER } }),
    });
    await user.click(await screen.findByRole('radio', { name: /Delivery/ }));
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('KWD 4.000');
    await user.click(screen.getByRole('button', { name: 'Place order and pay' }));
    expect(await screen.findAllByText('Required')).toHaveLength(3);
    await user.type(screen.getByLabelText('Full name'), 'Sara');
    await user.type(screen.getByLabelText('Phone'), '+96550000001');
    await user.type(screen.getByLabelText('Delivery address'), 'Block 1, Street 2');
    await user.click(screen.getByRole('button', { name: 'Place order and pay' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(ORDER.paymentUrl));
    const call = fetch.calls.find((c) => c.method === 'POST' && c.path === '/store/demo/checkout')!;
    expect(call.body).toMatchObject({
      lines: [{ variantId: COFFEE_V, quantity: '2' }],
      fulfillment: 'delivery',
      deliveryAddress: 'Block 1, Street 2',
      paymentMethodId: STORE.paymentMethods[0]!.id,
      expectedTotal: '4.000',
    });
    expect(localStorage.getItem('arabat.cart.demo')).toBe('[]');
  });

  it('picks the delivery area with its fee, delivers free above the threshold and books a time slot', async () => {
    localStorage.setItem(
      'arabat.cart.demo',
      JSON.stringify([{ variantId: COFFEE_V, productId: COFFEE, quantity: 2 }]),
    );
    const user = userEvent.setup();
    const areas = [
      {
        id: '0190a000-0000-7000-8000-0000000000e1',
        nameEn: 'Salmiya',
        nameAr: 'السالمية',
        fee: kwd('1.000'),
        minimumOrder: kwd('0.000'),
        freeDeliveryFrom: null,
        estimatedMinutes: 45,
        branchId: STORE.defaultBranchId,
      },
      {
        id: '0190a000-0000-7000-8000-0000000000e2',
        nameEn: 'Hawally',
        nameAr: 'حولي',
        fee: kwd('0.750'),
        minimumOrder: kwd('0.000'),
        freeDeliveryFrom: kwd('2.000'),
        estimatedMinutes: null,
        branchId: STORE.defaultBranchId,
      },
    ];
    const slots = [
      { start: '2026-10-13T08:00:00.000Z', end: '2026-10-13T08:30:00.000Z', available: true },
      { start: '2026-10-13T08:30:00.000Z', end: '2026-10-13T09:00:00.000Z', available: false },
      { start: '2026-10-13T09:00:00.000Z', end: '2026-10-13T09:30:00.000Z', available: true },
    ];
    const placed = {
      ...ORDER,
      status: 'placed',
      paymentMode: 'on_receipt',
      paymentUrl: null,
      scheduledFor: slots[2]!.start,
      deliveryAreaName: 'Hawally',
      deliveryArea: null,
    };
    const { fetch } = renderStore('/demo/checkout', {
      'GET /store/demo': () => ({
        status: 200,
        body: {
          ...STORE,
          paymentMethods: [],
          deliveryAreas: areas,
          scheduling: { enabled: true, slotMinutes: 30 },
        },
      }),
      'GET /store/demo/slots': () => ({ status: 200, body: { slots } }),
      'POST /store/demo/quote': (body) => quoteFor(body, areas),
      'POST /store/demo/checkout': () => ({ status: 201, body: { order: placed } }),
      'GET /store/demo/orders/tok123': () => ({ status: 200, body: placed }),
    });
    await user.click(await screen.findByRole('radio', { name: 'Delivery' }));
    // No area yet: nothing is charged and the order cannot be placed.
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('KWD 2.500');
    await user.type(screen.getByLabelText('Full name'), 'Sara');
    await user.type(screen.getByLabelText('Phone'), '+96550000001');
    await user.type(screen.getByLabelText('Delivery address'), 'Block 1');
    await user.click(screen.getByRole('button', { name: 'Place order' }));
    expect(await screen.findByText('Required')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Delivery area'), areas[0]!.id);
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('KWD 3.500');
    // Hawally is free from 2.000: the subtotal of 2.500 qualifies.
    await user.selectOptions(screen.getByLabelText('Delivery area'), areas[1]!.id);
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('KWD 2.500');
    expect(screen.getByText(/Free delivery for orders of KWD 2.000/)).toBeInTheDocument();
    // A time instead of "as soon as possible": only available slots are offered.
    await user.click(screen.getByRole('radio', { name: 'Choose a time' }));
    const slot = await screen.findByLabelText('Time');
    expect(within(slot).getAllByRole('option')).toHaveLength(2);
    await user.selectOptions(slot, slots[2]!.start);
    await user.click(screen.getByRole('button', { name: 'Place order' }));
    expect(await screen.findByTestId('order-status')).toHaveTextContent('Received');
    expect(
      fetch.calls.find((c) => c.method === 'POST' && c.path === '/store/demo/checkout')!.body,
    ).toMatchObject({
      fulfillment: 'delivery',
      deliveryAreaId: areas[1]!.id,
      scheduledFor: slots[2]!.start,
      expectedTotal: '2.500',
    });
    expect(screen.getByTestId('order-wanted')).toHaveTextContent('Requested time');
  });

  it('lets the shopper pick the pickup branch and loads that branch’s products', async () => {
    const user = userEvent.setup();
    const second = {
      ...STORE.branches[0]!,
      id: '0190a000-0000-7000-8000-0000000000b2',
      nameEn: 'Mall branch',
      address: 'The Avenues',
    };
    const { fetch } = renderStore('/demo', {
      'GET /store/demo': () => ({
        status: 200,
        body: { ...STORE, branches: [STORE.branches[0]!, second] },
      }),
    });
    expect(await screen.findByText('Coffee beans')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Branch'), second.id);
    await waitFor(() =>
      expect(
        fetch.calls.some(
          (c) => c.path === '/store/demo/products' && c.query === `branch=${second.id}`,
        ),
      ).toBe(true),
    );
    expect(localStorage.getItem('arabat.store.demo.branch')).toBe(second.id);
  });

  it('places an order to pay on delivery without a gateway and shows the tracking page', async () => {
    localStorage.setItem(
      'arabat.cart.demo',
      JSON.stringify([{ variantId: COFFEE_V, productId: COFFEE, quantity: 2 }]),
    );
    const user = userEvent.setup();
    const placed = {
      ...ORDER,
      status: 'placed',
      paymentMode: 'on_receipt',
      reservedUntil: null,
      paymentUrl: null,
      timeline: [{ status: 'placed', at: '2026-10-12T10:00:00.000Z' }],
    };
    const { fetch } = renderStore('/demo/checkout', {
      'GET /store/demo': () => ({ status: 200, body: { ...STORE, paymentMethods: [] } }),
      'POST /store/demo/checkout': () => ({ status: 201, body: { order: placed } }),
      'GET /store/demo/orders/tok123': () => ({ status: 200, body: placed }),
    });
    await user.click(await screen.findByRole('radio', { name: /Delivery/ }));
    expect(screen.getByRole('radio', { name: 'Pay on delivery' })).toBeChecked();
    await user.type(screen.getByLabelText('Full name'), 'Sara');
    await user.type(screen.getByLabelText('Phone'), '+96550000001');
    await user.type(screen.getByLabelText('Delivery address'), 'Block 1, Street 2');
    await user.click(screen.getByRole('button', { name: 'Place order' }));
    expect(await screen.findByTestId('order-status')).toHaveTextContent('Received');
    expect(screen.getByText(/pay the driver when your order is delivered/)).toBeInTheDocument();
    expect(
      fetch.calls.find((c) => c.method === 'POST' && c.path === '/store/demo/checkout')!.body,
    ).toMatchObject({
      paymentMethodId: null,
      expectedTotal: '4.000',
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it('moves a visitor of a former store address to the current one', async () => {
    const { router } = renderStore('/old-name/cart', {
      'GET /store/old-name': () => ({ status: 200, body: STORE }),
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/demo/cart'));
    expect(await screen.findByText('Demo Shop')).toBeInTheDocument();
  });

  it('renews the idempotency key after a refused checkout', async () => {
    localStorage.setItem(
      'arabat.cart.demo',
      JSON.stringify([{ variantId: COFFEE_V, productId: COFFEE, quantity: 2 }]),
    );
    const user = userEvent.setup();
    const { fetch } = renderStore('/demo/checkout', {
      'POST /store/demo/checkout': () => ({
        status: 409,
        body: { type: 'x', title: 'x', status: 409, code: 'TOTAL_CHANGED' },
      }),
    });
    await user.type(await screen.findByLabelText('Full name'), 'Sara');
    await user.type(screen.getByLabelText('Phone'), '+96550000001');
    await user.click(screen.getByRole('button', { name: 'Place order and pay' }));
    expect(
      await screen.findByText('Prices changed. Review the sale and try again.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Place order and pay' }));
    await waitFor(() =>
      expect(
        fetch.calls.filter((c) => c.method === 'POST' && c.path === '/store/demo/checkout'),
      ).toHaveLength(2),
    );
    const [a, b] = fetch.calls.filter(
      (c) => c.method === 'POST' && c.path === '/store/demo/checkout',
    );
    expect((a!.body as { idempotencyKey: string }).idempotencyKey).not.toBe(
      (b!.body as { idempotencyKey: string }).idempotencyKey,
    );
    expect(assign).not.toHaveBeenCalled();
  });

  it('tracks an order by its token', async () => {
    renderStore('/demo/orders/tok123', {
      'GET /store/demo/orders/tok123': () => ({ status: 200, body: { ...ORDER, status: 'paid' } }),
    });
    expect(await screen.findByTestId('order-status')).toHaveTextContent('Paid');
    expect(screen.getByText('Order W-000001')).toBeInTheDocument();
    expect(screen.getByText('KWD 4.000')).toBeInTheDocument();
  });

  it('settles a sandbox payment and only returns to same-site addresses', async () => {
    const user = userEvent.setup();
    const payment = {
      paymentId: 'p1',
      merchantName: 'Demo Shop',
      orderNumber: 'W-000001',
      amount: kwd('4.000'),
      status: 'initiated',
      returnUrl: 'http://localhost/store/demo/orders/tok123',
    };
    const { fetch } = renderStore('/pay/mock_abc?return=https://evil.example/steal', {
      'GET /payments/mock/mock_abc': () => ({ status: 200, body: payment }),
      'POST /payments/mock/mock_abc': () => ({
        status: 200,
        body: { ...payment, status: 'succeeded' },
      }),
    });
    expect(
      await screen.findByText('Sandbox gateway — no real money is charged.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pay (test success)' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(payment.returnUrl));
    expect(fetch.calls.find((c) => c.method === 'POST')!.body).toEqual({ outcome: 'succeeded' });
  });

  it('signs a shopper in and lists the orders of the account', async () => {
    const user = userEvent.setup();
    const account = {
      id: '0190a000-0000-7000-8000-0000000000d1',
      fullName: 'Sara',
      phone: '+96550000001',
      email: 'sara@example.com',
      createdAt: '2026-10-01T08:00:00.000Z',
    };
    let token: string | null = null;
    const { fetch } = renderStore('/demo/account', {
      'POST /store/demo/account/login': () => {
        token = 'st_secret';
        return { status: 200, body: { token, account } };
      },
      'GET /store/demo/account': () =>
        token
          ? { status: 200, body: { account, addresses: [] } }
          : { status: 401, body: { status: 401, code: 'UNAUTHENTICATED' } },
      'GET /store/demo/account/orders': () => ({
        status: 200,
        body: {
          orders: [
            {
              ...ORDER,
              lines: undefined,
              timeline: undefined,
              status: 'completed',
              lineCount: 1,
            },
          ],
        },
      }),
    });
    await user.type(await screen.findByLabelText('E-mail'), 'sara@example.com');
    await user.type(screen.getByLabelText('Password'), 'secret-pass');
    await user.click(screen.getAllByRole('button', { name: 'Sign in' }).at(-1)!);
    expect(await screen.findByText('Hello, Sara')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'W-000001' })).toBeInTheDocument();
    expect(localStorage.getItem('arabat.store.demo.token')).toBe('st_secret');
    expect(
      fetch.calls.find((c) => c.method === 'POST' && c.path === '/store/demo/account/login')!.body,
    ).toEqual({ email: 'sara@example.com', password: 'secret-pass' });
    expect(screen.getByRole('link', { name: 'My account' })).toBeInTheDocument();
  });

  it('prefills the checkout of a signed-in shopper and applies a promotion code', async () => {
    localStorage.setItem('arabat.store.demo.token', 'st_secret');
    localStorage.setItem(
      'arabat.cart.demo',
      JSON.stringify([{ variantId: COFFEE_V, productId: COFFEE, quantity: 2 }]),
    );
    const user = userEvent.setup();
    const account = {
      id: '0190a000-0000-7000-8000-0000000000d1',
      fullName: 'Sara',
      phone: '+96550000001',
      email: 'sara@example.com',
      createdAt: '2026-10-01T08:00:00.000Z',
    };
    const home = {
      id: '0190a000-0000-7000-8000-0000000000d2',
      label: 'Home',
      deliveryAreaId: null,
      address: 'Block 1, Street 2',
      isDefault: true,
    };
    const { fetch } = renderStore('/demo/checkout', {
      'GET /store/demo/account': () => ({ status: 200, body: { account, addresses: [home] } }),
      'POST /store/demo/quote': (body) => {
        const base = quoteFor(body);
        const code = (body as { promotionCode: string | null }).promotionCode;
        if (code === 'TEN')
          return {
            status: 200,
            body: {
              ...base.body,
              discount: kwd('0.250'),
              total: kwd('3.750'),
              promotion: { code: 'TEN', nameEn: 'Ten percent', nameAr: null },
            },
          };
        if (code) return { status: 200, body: { ...base.body, codeIssue: 'unknown' } };
        return base;
      },
      'POST /store/demo/checkout': () => ({
        status: 201,
        body: {
          order: {
            ...ORDER,
            discount: kwd('0.250'),
            promotion: { code: 'TEN', name: 'Ten percent' },
            total: kwd('3.750'),
          },
        },
      }),
    });
    await user.click(await screen.findByRole('radio', { name: /Delivery/ }));
    await waitFor(() => expect(screen.getByLabelText('Full name')).toHaveValue('Sara'));
    expect(screen.getByLabelText('Phone')).toHaveValue('+96550000001');
    expect(screen.getByLabelText('Delivery address')).toHaveValue('Block 1, Street 2');
    expect(screen.getByLabelText('Saved address')).toHaveValue(home.id);
    await user.type(screen.getByLabelText('Promotion code'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByTestId('promo-issue')).toHaveTextContent('This code does not exist.');
    await user.clear(screen.getByLabelText('Promotion code'));
    await user.type(screen.getByLabelText('Promotion code'), 'ten');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await screen.findByTestId('promo-applied')).toHaveTextContent('Ten percent applied.');
    expect(screen.getByTestId('checkout-discount')).toHaveTextContent('KWD 0.250');
    expect(screen.getByTestId('checkout-total')).toHaveTextContent('KWD 3.750');
    await user.click(screen.getByRole('button', { name: 'Place order and pay' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(ORDER.paymentUrl));
    expect(
      fetch.calls.find((c) => c.method === 'POST' && c.path === '/store/demo/checkout')!.body,
    ).toMatchObject({
      customer: { name: 'Sara', phone: '+96550000001', email: 'sara@example.com' },
      deliveryAddress: 'Block 1, Street 2',
      promotionCode: 'TEN',
      saveAddress: false,
      expectedTotal: '3.750',
    });
  });

  it('renders a published retail design: navigation, slider, video, footer and the three pages', async () => {
    const user = userEvent.setup();
    const DRINKS = '0190a000-0000-7000-8000-0000000000c1';
    const design = templateDesign('retail');
    design.navbar = {
      style: 'pills',
      items: [
        { id: 'n1', label: { en: 'Shop all', ar: null }, link: { kind: 'page', page: 'products' } },
        {
          id: 'n2',
          label: { en: 'Drinks', ar: null },
          link: { kind: 'category', categoryId: DRINKS },
        },
        {
          id: 'n3',
          label: { en: 'Blog', ar: null },
          link: { kind: 'url', url: 'https://blog.example.com' },
        },
      ],
    };
    design.social = { ...design.social, instagram: 'demo.shop' };
    design.pages.home = [
      ...design.pages.home,
      {
        ...newSection('video', 'clip'),
        url: 'https://youtu.be/dQw4w9WgXcQ',
        title: { en: 'Our story', ar: null },
      } as DesignSection,
      {
        ...newSection('text', 'about'),
        title: { en: 'Roasted in Kuwait', ar: null },
        body: { en: 'Since 1990', ar: null },
      } as DesignSection,
    ];
    renderStore('/demo', {
      'GET /store/demo': () => ({
        status: 200,
        body: {
          ...STORE,
          categories: [{ id: DRINKS, nameEn: 'Drinks', nameAr: null, imageUrl: null }],
        },
      }),
      'GET /store/demo/products': () => ({
        status: 200,
        body: {
          products: PRODUCTS.products.map((p, i) => ({
            ...p,
            categoryId: i === 0 ? DRINKS : null,
            featured: i === 0,
          })),
        },
      }),
      'GET /store/demo/design': () => ({ status: 200, body: { design } }),
    });
    // Slider placeholder (no picture yet) with its button, features, categories, products.
    expect(await screen.findByText('New arrivals')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Shop now' })).toHaveAttribute(
      'href',
      '/demo/products',
    );
    expect(screen.getByText('Fast delivery')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Shop by category' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Featured' })).toBeInTheDocument();
    expect(screen.getByTestId('video-embed')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    );
    expect(screen.getByText('Since 1990')).toBeInTheDocument();
    // Navigation items: a page, a category and an outside link (new tab).
    const header = screen.getByTestId('store-header');
    expect(within(header).getByRole('link', { name: 'Drinks' })).toHaveAttribute(
      'href',
      `/demo/products?category=${DRINKS}`,
    );
    expect(within(header).getByRole('link', { name: 'Blog' })).toHaveAttribute('target', '_blank');
    // Footer columns with the social block.
    const footer = screen.getByTestId('store-footer');
    expect(within(footer).getByRole('link', { name: 'Instagram' })).toHaveAttribute(
      'href',
      'https://instagram.com/demo.shop',
    );
    expect(within(footer).getByText('Powered by Arabat')).toBeInTheDocument();
    // The products page holds the catalog; the categories page the category tiles.
    await user.click(within(header).getByRole('link', { name: 'Shop all' }));
    expect(await screen.findByTestId('product-grid')).toBeInTheDocument();
    expect(screen.getByLabelText('Sort')).toBeInTheDocument();
    await user.click(within(header).getByRole('link', { name: 'Drinks' }));
    await waitFor(() =>
      expect(within(screen.getByTestId('product-grid')).queryByText('Mug')).toBeNull(),
    );
    expect(
      within(screen.getByTestId('product-grid')).getByText('Coffee beans'),
    ).toBeInTheDocument();
  });

  it('shows a restaurant menu grouped by category and adds a dish with one tap', async () => {
    const user = userEvent.setup();
    const HOT = '0190a000-0000-7000-8000-0000000000c2';
    renderStore('/demo', {
      'GET /store/demo': () => ({
        status: 200,
        body: {
          ...STORE,
          categories: [{ id: HOT, nameEn: 'Hot drinks', nameAr: 'مشروبات ساخنة', imageUrl: null }],
        },
      }),
      'GET /store/demo/products': () => ({
        status: 200,
        body: { products: PRODUCTS.products.map((p) => ({ ...p, categoryId: HOT })) },
      }),
      'GET /store/demo/design': () => ({
        status: 200,
        body: { design: templateDesign('restaurant') },
      }),
    });
    expect(await screen.findByText('Fresh from our kitchen')).toBeInTheDocument();
    expect(screen.getByText('Open now')).toBeInTheDocument();
    const menu = await screen.findByRole('region', { name: 'Menu' });
    expect(within(menu).getByRole('heading', { name: 'Hot drinks' })).toBeInTheDocument();
    expect(within(menu).getByText('Medium roast')).toBeInTheDocument();
    await user.click(
      within(menu).getByRole('button', { name: 'Add one Coffee beans to the cart' }),
    );
    expect(await screen.findByRole('link', { name: 'Cart (1)' })).toBeInTheDocument();
    // A sold-out dish has no quick add.
    expect(within(menu).queryByRole('button', { name: 'Add one Mug to the cart' })).toBeNull();
  });

  it('previews the draft inside the console frame and follows the editor live', async () => {
    window.name = 'arabat-design-preview';
    try {
      const draft = templateDesign('retail');
      const { fetch } = renderStore('/demo', {
        'GET /manager/online/preview/storefront': () => ({ status: 200, body: STORE }),
        'GET /manager/online/preview/products': () => ({ status: 200, body: PRODUCTS }),
        'GET /manager/online/design': () => ({
          status: 200,
          body: {
            draft,
            published: null,
            publishedAt: null,
            dirty: true,
            suggestedTemplate: 'retail',
            version: 1,
          },
        }),
      });
      expect(await screen.findByText('New arrivals')).toBeInTheDocument();
      expect(
        screen.getByText('Preview: what shoppers will see once you publish'),
      ).toBeInTheDocument();
      // Nothing was asked of the public store API.
      expect(fetch.calls.some((c) => c.path.startsWith('/store/'))).toBe(false);
      const edited = structuredClone(draft);
      const slider = edited.pages.home[0] as Extract<DesignSection, { type: 'slider' }>;
      slider.slides[0]!.title = { en: 'Eid sale', ar: null };
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'arabat:design', design: edited },
            origin: window.location.origin,
            source: window,
          }),
        );
      });
      expect(await screen.findByText('Eid sale')).toBeInTheDocument();
      // A message from another origin is ignored.
      act(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'arabat:design', design: draft },
            origin: 'https://evil.example',
            source: window,
          }),
        );
      });
      expect(screen.getByText('Eid sale')).toBeInTheDocument();
    } finally {
      window.name = '';
    }
  });

  it('defines the same translation keys in Arabic and English', () => {
    expect(flattenKeys(resources.ar).sort()).toEqual(flattenKeys(resources.en).sort());
  });
});

describe('link page', () => {
  const LINK = '0190a000-0000-7000-8000-0000000000d1';
  const PAGE = {
    slug: 'demo',
    titleAr: 'متجر تجريبي',
    titleEn: 'Demo Shop',
    bioAr: null,
    bioEn: 'Fresh daily',
    themeColor: '#0f766e',
    buttonStyle: 'pill',
    background: 'dark',
    buttonVariant: 'fill',
    buttonTextColor: null,
    backgroundColor: null,
    backgroundColor2: null,
    textColor: null,
    font: 'default',
    animation: 'fade-up',
    avatarUrl: null,
    items: [
      {
        id: LINK,
        kind: 'instagram',
        labelAr: 'إنستقرام',
        labelEn: 'Follow us',
        emoji: '📸',
        effect: 'pulse',
        url: 'https://instagram.com/demo',
      },
    ],
  };

  it('shows the links in the visitor language and counts an open', async () => {
    const user = userEvent.setup();
    const beacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon });
    renderStore('/links/demo', { 'GET /public/links/demo': () => ({ status: 200, body: PAGE }) });
    expect(await screen.findByRole('heading', { name: 'Demo Shop' })).toBeInTheDocument();
    expect(screen.getByText('Fresh daily')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Follow us' });
    expect(link).toHaveAttribute('href', 'https://instagram.com/demo');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    // The emoji replaces the icon; the effect is applied to the button.
    expect(within(link).getByText('📸')).toBeInTheDocument();
    expect(link).toHaveClass('lp-fx-pulse');
    link.addEventListener('click', (e) => e.preventDefault());
    await user.click(link);
    expect(beacon).toHaveBeenCalledWith(`/api/v1/public/links/demo/items/${LINK}/click`);
    // One globe button switches the language; its name is the language it switches to.
    expect(screen.queryByRole('radiogroup')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'العربية' }));
    expect(await screen.findByRole('link', { name: 'إنستقرام' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument();
  });

  it('answers not found for an unpublished page', async () => {
    renderStore('/links/missing', {
      'GET /public/links/missing': () => ({
        status: 404,
        body: {
          type: 'urn:arabat:error:not_found',
          title: 'Not found',
          status: 404,
          code: 'NOT_FOUND',
        },
      }),
    });
    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });
});
