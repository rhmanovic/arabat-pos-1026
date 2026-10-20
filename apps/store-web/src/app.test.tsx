import { createApiClient } from '@arabat/api-client';
import { flattenKeys } from '@arabat/i18n';
import { createQueryClient } from '@arabat/web-core';
import { fakeApiFetch, type FakeRoute } from '@arabat/web-core/testing';
import { render, screen, waitFor, within } from '@testing-library/react';
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
  categories: [],
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
  deliveryFee: kwd('1.500'),
  total: kwd('4.000'),
  createdAt: '2026-10-12T10:00:00.000Z',
  paymentMode: 'gateway',
  paidAt: null,
  reservedUntil: '2026-10-12T10:15:00.000Z',
  trackingToken: 'tok123',
  paymentUrl: 'http://localhost/store/pay/mock_abc?return=x',
  timeline: [{ status: 'pending_payment', at: '2026-10-12T10:00:00.000Z' }],
};

function renderStore(path: string, routesMap: Record<string, FakeRoute> = {}) {
  const fetch = fakeApiFetch({
    routes: {
      'GET /store/demo': () => ({ status: 200, body: STORE }),
      'GET /store/demo/products': () => ({ status: 200, body: PRODUCTS }),
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
    const call = fetch.calls.find((c) => c.method === 'POST')!;
    expect(call.body).toMatchObject({
      lines: [{ variantId: COFFEE_V, quantity: '2' }],
      fulfillment: 'delivery',
      deliveryAddress: 'Block 1, Street 2',
      paymentMethodId: STORE.paymentMethods[0]!.id,
      expectedTotal: '4.000',
    });
    expect(localStorage.getItem('arabat.cart.demo')).toBe('[]');
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
    expect(fetch.calls.find((c) => c.method === 'POST')!.body).toMatchObject({
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
    await waitFor(() => expect(fetch.calls.filter((c) => c.method === 'POST')).toHaveLength(2));
    const [a, b] = fetch.calls.filter((c) => c.method === 'POST');
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
