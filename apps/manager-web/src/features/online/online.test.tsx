import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { i18n } from '../../i18n/index.js';
import { routes } from '../../routes.js';
import { nextActions } from './OnlineStorePage.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const money = (amount: string) => ({ amount, currency: 'KWD' });
const BRANCH = '0190a000-0000-7000-8000-0000000000b1';
const ORDER_ID = '0190a000-0000-7000-8000-0000000000f1';
const summary = {
  id: ORDER_ID,
  number: 'W-000007',
  status: 'paid',
  fulfillment: 'pickup',
  customerName: 'Sara',
  subtotal: money('2.500'),
  deliveryFee: money('0.000'),
  total: money('2.500'),
  createdAt: '2026-10-12T08:00:00.000Z',
  paymentMode: 'gateway',
  confirmedAt: null,
  paidAt: '2026-10-12T08:01:00.000Z',
  reservedUntil: '2026-10-12T08:15:00.000Z',
  trackingToken: 'tok',
  paymentUrl: null,
  branchId: BRANCH,
  customerPhone: '+96550000001',
  customerEmail: null,
  deliveryAddress: null,
  note: null,
  customerId: null,
  saleId: '0190a000-0000-7000-8000-0000000000c1',
  receiptNumber: 'MAIN-000042',
  paymentMethod: { nameEn: 'Card', nameAr: 'بطاقة', provider: 'mock' },
  paymentReference: null,
  statusNote: null,
  version: 2,
};
const detail = {
  ...summary,
  lines: [
    {
      position: 1,
      variantId: 'v1',
      productId: 'p1',
      nameEn: 'Coffee beans',
      nameAr: null,
      variantNameEn: null,
      variantNameAr: null,
      sku: 'CB',
      quantity: '2.000',
      unitPrice: money('1.250'),
      lineTotal: money('2.500'),
    },
  ],
  payments: [
    {
      id: 'pay1',
      provider: 'mock',
      providerReference: 'mock_1',
      status: 'succeeded',
      amount: money('2.500'),
      failureReason: null,
      createdAt: '2026-10-12T08:00:00.000Z',
      completedAt: '2026-10-12T08:01:00.000Z',
    },
  ],
  timeline: [
    { status: 'pending_payment', at: '2026-10-12T08:00:00.000Z' },
    { status: 'paid', at: '2026-10-12T08:01:00.000Z' },
  ],
};
const store = {
  slug: 'demo',
  status: 'draft',
  nameEn: 'Demo',
  nameAr: null,
  taglineEn: null,
  taglineAr: null,
  announcementEn: null,
  announcementAr: null,
  primaryColor: '#0f766e',
  contactPhone: null,
  contactEmail: null,
  fulfillmentBranchId: null,
  pickupEnabled: true,
  deliveryEnabled: false,
  deliveryFee: money('0.000'),
  minimumOrder: money('0.000'),
  reservationMinutes: 15,
  payOnReceiptEnabled: true,
  paymentMethods: [
    { id: 'm1', nameEn: 'Card', nameAr: null, provider: 'mock', ready: true },
    { id: 'm2', nameEn: 'KNET', nameAr: null, provider: 'tap', ready: false },
  ],
  url: 'http://localhost:5176/store/demo',
  version: 0,
};
const branches = {
  branches: [
    {
      id: BRANCH,
      code: 'MAIN',
      nameEn: 'Main',
      nameAr: 'الرئيسي',
      isMain: true,
      status: 'active',
      phone: null,
      address: null,
      receiptHeader: null,
      receiptFooter: null,
      timezone: 'Asia/Kuwait',
      version: 1,
      employeeCount: 1,
      createdAt: '2026-10-01T08:00:00.000Z',
    },
  ],
};

describe('online order actions', () => {
  it('offers only the steps that fit the fulfilment method', () => {
    expect(nextActions({ status: 'paid', fulfillment: 'pickup' })).toEqual([
      'preparing',
      'ready',
      'completed',
    ]);
    expect(nextActions({ status: 'preparing', fulfillment: 'delivery' })).toEqual([
      'out_for_delivery',
      'completed',
    ]);
    expect(nextActions({ status: 'needs_attention', fulfillment: 'pickup' })).toEqual(['cancel']);
    expect(nextActions({ status: 'completed', fulfillment: 'pickup' })).toEqual([]);
    expect(nextActions({ status: 'expired', fulfillment: 'pickup' })).toEqual([]);
  });

  it('lets staff confirm, record the payment and cancel a pay-on-receipt order', () => {
    const unpaid = { paymentMode: 'on_receipt' as const, saleId: null };
    expect(nextActions({ status: 'placed', fulfillment: 'pickup', ...unpaid })).toEqual([
      'confirm',
      'mark_paid',
      'cancel',
    ]);
    // Unpaid: every step but completion; paid: the usual steps only.
    expect(nextActions({ status: 'ready', fulfillment: 'pickup', ...unpaid })).toEqual([
      'mark_paid',
      'cancel',
    ]);
    expect(
      nextActions({ status: 'confirmed', fulfillment: 'delivery', ...unpaid, saleId: 's1' }),
    ).toEqual(['preparing', 'out_for_delivery', 'completed']);
  });
});

describe('online store page', () => {
  it('lists orders and moves one forward with its version', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.orders']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        'GET /manager/online/orders': () => ({
          status: 200,
          body: { orders: [summary], total: 1, page: 1, pageSize: 25, counts: { paid: 1 } },
        }),
        [`GET /manager/online/orders/${ORDER_ID}`]: () => ({ status: 200, body: detail }),
        [`POST /manager/online/orders/${ORDER_ID}/action`]: () => ({
          status: 200,
          body: { ...detail, status: 'preparing', version: 3 },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/online', fetch });
    // Without online.manage only the orders tab exists.
    expect(screen.queryByRole('button', { name: 'Store settings' })).not.toBeInTheDocument();
    await user.click(await screen.findByText('W-000007'));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Coffee beans')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Sale MAIN-000042' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Out for delivery' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Start preparing' }));
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.method === 'POST')?.body).toEqual({
        action: 'preparing',
        note: null,
        version: 2,
      }),
    );
  });

  it('records the payment of a pay-on-receipt order with a till tender', async () => {
    const user = userEvent.setup();
    const placed = {
      ...detail,
      status: 'placed',
      paymentMode: 'on_receipt',
      paidAt: null,
      reservedUntil: null,
      saleId: null,
      receiptNumber: null,
      paymentMethod: null,
      payments: [],
      timeline: [{ status: 'placed', at: '2026-10-12T08:00:00.000Z' }],
    };
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.orders']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        'GET /manager/online/orders': () => ({
          status: 200,
          body: { orders: [placed], total: 1, page: 1, pageSize: 25, counts: { placed: 1 } },
        }),
        [`GET /manager/online/orders/${ORDER_ID}`]: () => ({ status: 200, body: placed }),
        'GET /manager/online/tenders': () => ({
          status: 200,
          body: {
            tenders: [
              { id: 'cash', nameEn: 'Cash', nameAr: 'نقد', kind: 'cash', requiresReference: false },
              { id: 'knet', nameEn: 'KNET', nameAr: null, kind: 'card', requiresReference: true },
            ],
          },
        }),
        [`POST /manager/online/orders/${ORDER_ID}/action`]: () => ({
          status: 200,
          body: { ...placed, status: 'confirmed', saleId: 's1', receiptNumber: 'MAIN-000043' },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/online', fetch });
    expect(await screen.findByText('Unpaid')).toBeInTheDocument();
    await user.click(screen.getByText('W-000007'));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: 'Record payment' }));
    const pay = await screen.findByRole('dialog', { name: 'Record payment for W-000007' });
    // A card tender needs its reference before the button is enabled.
    await user.selectOptions(await within(pay).findByLabelText('Received with'), 'knet');
    expect(within(pay).getByRole('button', { name: 'Record payment' })).toBeDisabled();
    await user.type(within(pay).getByLabelText('Reference'), 'K-778');
    await user.click(within(pay).getByRole('button', { name: 'Record payment' }));
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.method === 'POST')?.body).toEqual({
        action: 'mark_paid',
        paymentMethodId: 'knet',
        reference: 'K-778',
        note: null,
        version: 2,
      }),
    );
  });

  it('checks a new store address while typing and offers free alternatives', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage', 'branches.read']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        'GET /manager/online/orders': () => ({
          status: 200,
          body: { orders: [], total: 0, page: 1, pageSize: 25, counts: {} },
        }),
        'GET /manager/online/store': () => ({ status: 200, body: store }),
        'GET /manager/online/store/slug-availability': () => ({
          status: 200,
          body: {
            slug: 'saffron',
            available: false,
            reason: 'taken',
            suggestions: ['saffron-store', 'saffron-2'],
          },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/online', fetch });
    await user.click(await screen.findByRole('button', { name: 'Store settings' }));
    const slug = await screen.findByLabelText('Store address');
    await user.clear(slug);
    await user.type(slug, 'saffron');
    expect(await screen.findByText('Taken by another store or link page.')).toBeInTheDocument();
    expect(screen.getByTestId('store-url-preview')).toHaveTextContent(
      'http://localhost:5176/store/saffron',
    );
    await user.click(screen.getByRole('button', { name: 'saffron-store' }));
    expect(slug).toHaveValue('saffron-store');
    expect(fetch.calls.find((c) => c.path.includes('slug-availability'))?.query).toBe(
      'slug=saffron',
    );
  });

  it('saves store settings and shows which gateways are connected', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage', 'branches.read']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        'GET /manager/online/orders': () => ({
          status: 200,
          body: { orders: [], total: 0, page: 1, pageSize: 25, counts: {} },
        }),
        'GET /manager/online/store': () => ({ status: 200, body: store }),
        'PUT /manager/online/store': (body) => ({
          status: 200,
          body: { ...store, ...(body as object), version: 1 },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/online', fetch });
    await user.click(await screen.findByRole('button', { name: 'Store settings' }));
    expect(
      await screen.findByText('Not connected (needs approval and credentials)'),
    ).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), 'published');
    await user.selectOptions(screen.getByLabelText('Fulfilment branch'), BRANCH);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
        slug: 'demo',
        status: 'published',
        fulfillmentBranchId: BRANCH,
        deliveryFee: '0.000',
        reservationMinutes: 15,
        payOnReceiptEnabled: true,
        version: 0,
      }),
    );
  });

  it('lists selected products in the store', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        'GET /manager/online/orders': () => ({
          status: 200,
          body: { orders: [], total: 0, page: 1, pageSize: 25, counts: {} },
        }),
        'GET /manager/online/listings': () => ({
          status: 200,
          body: {
            products: [
              {
                productId: 'p1',
                nameEn: 'Coffee beans',
                nameAr: null,
                listed: false,
                variants: 1,
                price: money('1.250'),
              },
            ],
          },
        }),
        'PUT /manager/online/listings': () => ({ status: 200, body: { products: [] } }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/online', fetch });
    await user.click(await screen.findByRole('button', { name: 'Products online' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Coffee beans' }));
    await user.click(screen.getByRole('button', { name: 'List online (1)' }));
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.method === 'PUT')?.body).toEqual({
        productIds: ['p1'],
        listed: true,
      }),
    );
  });
});
