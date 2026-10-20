import { legacyDesign } from '@arabat/contracts';
import { flattenKeys } from '@arabat/i18n';
import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { managerUrl } from './app/context.js';
import { nextActions } from './features/shared.js';
import { i18n, resources } from './i18n/index.js';
import { routes } from './routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset['theme'];
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
  discount: money('0.000'),
  promotion: null,
  deliveryFee: money('0.000'),
  total: money('2.500'),
  createdAt: '2026-10-12T08:00:00.000Z',
  paymentMode: 'gateway',
  confirmedAt: null,
  paidAt: '2026-10-12T08:01:00.000Z',
  reservedUntil: '2026-10-12T08:15:00.000Z',
  trackingToken: 'tok',
  scheduledFor: null,
  deliveryAreaName: null,
  deliveryArea: null,
  deliveryAreaId: null,
  branch: { nameEn: 'Main branch', nameAr: null, address: null, phone: null },
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
  logoUrl: null,
  bannerUrl: null,
  hideOutOfStock: false,
  hours: null,
  schedulingEnabled: false,
  slotMinutes: 30,
  slotCapacity: null,
  notifyEmail: true,
  accountsEnabled: true,
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
const emptyOrders = { orders: [], total: 0, page: 1, pageSize: 25, counts: {} };
const P1 = '0190a000-0000-7000-8000-0000000000a1';
const P2 = '0190a000-0000-7000-8000-0000000000a2';
const CATEGORY = {
  id: '0190a000-0000-7000-8000-0000000000c9',
  nameEn: 'Drinks',
  nameAr: 'مشروبات',
  position: 0,
  status: 'active',
  imageUrl: null,
  productCount: 0,
  version: 1,
};
const listing = (extra: Record<string, unknown>) => ({
  productId: P1,
  nameEn: 'Product',
  nameAr: null,
  listed: true,
  variants: 1,
  price: money('1.250'),
  position: 0,
  titleEn: null,
  titleAr: null,
  descriptionEn: null,
  descriptionAr: null,
  featured: false,
  maxPerOrder: null,
  onlineCategoryId: null,
  posCategory: null,
  images: [],
  ...extra,
});

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
  });

  it('lets staff confirm, record the payment and cancel a pay-on-receipt order', () => {
    const unpaid = { paymentMode: 'on_receipt' as const, saleId: null };
    expect(nextActions({ status: 'placed', fulfillment: 'pickup', ...unpaid })).toEqual([
      'confirm',
      'mark_paid',
      'cancel',
    ]);
    expect(nextActions({ status: 'ready', fulfillment: 'pickup', ...unpaid })).toEqual([
      'mark_paid',
      'cancel',
    ]);
    expect(
      nextActions({ status: 'confirmed', fulfillment: 'delivery', ...unpaid, saleId: 's1' }),
    ).toEqual(['preparing', 'out_for_delivery', 'completed']);
  });
});

describe('online store console', () => {
  it('shows its sign-in page to anonymous users', async () => {
    const { router } = renderApp({ routes, appInterface: 'manager', i18n, path: '/' });
    expect(
      await screen.findByRole('heading', { name: 'Sign in to your online store' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('has its own navigation, links to the management app and shows the overview counts', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', [
        'manager.access',
        'online.manage',
        'online.orders',
        'branches.read',
        'customers.read',
      ]),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        'GET /manager/online/store': () => ({
          status: 200,
          body: { ...store, status: 'published' },
        }),
        'GET /manager/online/orders': () => ({
          status: 200,
          body: {
            ...emptyOrders,
            counts: { placed: 2, confirmed: 1, paid: 3, needs_attention: 1 },
          },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/', fetch });
    const nav = await screen.findByRole('navigation', { name: 'Online store navigation' });
    expect(within(nav).getByRole('link', { name: 'Orders' })).toHaveAttribute('href', '/orders');
    expect(within(nav).getByRole('link', { name: 'Store settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
    // Shared functions open the management app; reports are hidden without their permission.
    expect(within(nav).getByRole('link', { name: /Customers/ })).toHaveAttribute(
      'href',
      managerUrl('customers'),
    );
    expect(within(nav).queryByRole('link', { name: /Reports/ })).toBeNull();
    expect(screen.getByTestId('switch-to-manager')).toHaveAttribute('href', managerUrl());
    expect(await screen.findByTestId('count-newOrders')).toHaveTextContent('2');
    expect(screen.getByTestId('count-toPrepare')).toHaveTextContent('4');
    expect(screen.getByTestId('count-attention')).toHaveTextContent('1');
    expect(screen.getByTestId('store-url')).toHaveTextContent('http://localhost:5176/store/demo');
  });

  it('refuses a management account without any online-store permission', async () => {
    const fetch = fakeApiFetch({ session: makeSession('manager', ['manager.access']) });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/', fetch });
    expect(
      await screen.findByText(/Your account cannot manage the online store/),
    ).toBeInTheDocument();
  });

  it('warns when the plan does not include the online store', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', [
        'manager.access',
        'online.manage',
        'merchant.settings.read',
      ]),
      routes: {
        'GET /manager/online/store': () => ({ status: 200, body: store }),
        'GET /manager/subscription': () => ({
          status: 200,
          body: {
            id: 's1',
            plan: {
              id: 'p1',
              code: 'basic',
              nameEn: 'Basic',
              nameAr: 'أساسي',
              descriptionEn: null,
              descriptionAr: null,
              status: 'active',
              isDefault: true,
              isPublic: true,
              limits: { branches: null, employees: null, products: null, registers: null },
              features: [],
              price: null,
              billingPeriod: null,
              trialDays: 14,
              sortOrder: 1,
              version: 1,
            },
            status: 'active',
            effectiveStatus: 'active',
            startsAt: '2026-10-01T00:00:00.000Z',
            endsAt: null,
            trialEndsAt: null,
            usage: {
              branches: { used: 1, max: null },
              employees: { used: 1, max: null },
              products: { used: 0, max: null },
              registers: { used: 1, max: null },
            },
            version: 1,
            availablePlans: [],
          },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/', fetch });
    expect(
      await screen.findByText(/The online store is not included in your plan/),
    ).toBeInTheDocument();
  });

  it('lists orders and moves one forward with its version', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.orders']),
      routes: {
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
    renderApp({ routes, appInterface: 'manager', i18n, path: '/orders', fetch });
    await user.click(await screen.findByText('W-000007'));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Coffee beans')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Sale MAIN-000042' })).toHaveAttribute(
      'href',
      managerUrl('sales/0190a000-0000-7000-8000-0000000000c1'),
    );
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
    renderApp({ routes, appInterface: 'manager', i18n, path: '/orders', fetch });
    expect(await screen.findByText('Unpaid')).toBeInTheDocument();
    await user.click(screen.getByText('W-000007'));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: 'Record payment' }));
    const pay = await screen.findByRole('dialog', { name: 'Record payment for W-000007' });
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

  it('checks a new store address while typing and shows refused fields on save', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage', 'branches.read']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
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
        'PUT /manager/online/store': () => ({
          status: 400,
          body: {
            type: 'urn:arabat:error:validation_failed',
            title: 'Validation failed',
            status: 400,
            code: 'VALIDATION_FAILED',
            detail: 'The request is invalid.',
            issues: [
              { path: 'fulfillmentBranchId', code: 'custom', message: 'Choose the branch.' },
            ],
          },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/settings', fetch });
    const slug = await screen.findByLabelText('Store address');
    await user.clear(slug);
    await user.type(slug, 'saffron');
    expect(await screen.findByText('Taken by another store or link page.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'saffron-store' }));
    expect(slug).toHaveValue('saffron-store');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('The store was not saved. Fix these fields:'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Fulfilment branch: Choose the branch that fulfils online orders\./),
    ).toBeInTheDocument();
  });

  it('lists selected products in the store, in a chosen store category', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage']),
      routes: {
        'GET /manager/online/listings': () => ({
          status: 200,
          body: { products: [listing({ productId: P1, nameEn: 'Coffee beans', listed: false })] },
        }),
        'GET /manager/online/categories': () => ({ status: 200, body: { categories: [CATEGORY] } }),
        'PUT /manager/online/listings': () => ({ status: 200, body: { products: [] } }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/products', fetch });
    await user.click(await screen.findByRole('checkbox', { name: 'Coffee beans' }));
    await user.selectOptions(
      screen.getByLabelText('Store category for the added products'),
      CATEGORY.id,
    );
    await user.click(screen.getByRole('button', { name: 'List online (1)' }));
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.method === 'PUT')?.body).toEqual({
        productIds: [P1],
        listed: true,
        onlineCategoryId: CATEGORY.id,
      }),
    );
  });

  it('reorders the products sold online and edits what the store says about one', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage']),
      routes: {
        'GET /manager/online/listings': () => ({
          status: 200,
          body: {
            products: [
              listing({ productId: P1, nameEn: 'Coffee beans', position: 0, featured: true }),
              listing({ productId: P2, nameEn: 'Mug', position: 1 }),
            ],
          },
        }),
        'GET /manager/online/categories': () => ({ status: 200, body: { categories: [CATEGORY] } }),
        'PUT /manager/online/listings/order': () => ({ status: 200, body: { products: [] } }),
        [`PUT /manager/online/listings/${P2}`]: () => ({ status: 200, body: { products: [] } }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/products', fetch });
    expect(await screen.findByText('Featured')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Move Mug up' }));
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.path.endsWith('/listings/order'))?.body).toEqual({
        productIds: [P2, P1],
      }),
    );
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[1]!);
    const dialog = await screen.findByRole('dialog', { name: 'In the store: Mug' });
    await user.type(within(dialog).getByLabelText('Store title (English)'), 'Big mug');
    await user.selectOptions(within(dialog).getByLabelText('Store category'), CATEGORY.id);
    await user.type(within(dialog).getByLabelText('Maximum per order'), '5');
    await user.click(within(dialog).getByRole('checkbox', { name: /Featured/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.path.endsWith(`/listings/${P2}`))?.body).toEqual({
        titleEn: 'Big mug',
        titleAr: null,
        descriptionEn: null,
        descriptionAr: null,
        featured: true,
        maxPerOrder: 5,
        onlineCategoryId: CATEGORY.id,
      }),
    );
  });

  it('creates a store category and uploads its picture', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage']),
      routes: {
        'GET /manager/online/categories': () => ({ status: 200, body: { categories: [] } }),
        'POST /manager/online/categories': () => ({ status: 200, body: CATEGORY }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/categories', fetch });
    await user.click(await screen.findByRole('button', { name: 'Add category' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name (Arabic)'), 'مشروبات');
    await user.type(within(dialog).getByLabelText('Name (English)'), 'Drinks');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.method === 'POST')?.body).toEqual({
        nameEn: 'Drinks',
        nameAr: 'مشروبات',
        status: 'active',
      }),
    );
    // Saved: the dialog stays open so a picture can be added.
    expect(
      await within(dialog).findByRole('button', { name: 'Upload picture' }),
    ).toBeInTheDocument();
  });

  it('adds a delivery area from the Kuwait list with its fee and free-delivery threshold', async () => {
    const user = userEvent.setup();
    const area = {
      id: '0190a000-0000-7000-8000-0000000000e1',
      nameEn: 'Salmiya',
      nameAr: 'السالمية',
      fee: { amount: '1.000', currency: 'KWD' },
      minimumOrder: { amount: '0.000', currency: 'KWD' },
      freeDeliveryFrom: { amount: '10.000', currency: 'KWD' },
      estimatedMinutes: 45,
      branchId: null,
      position: 0,
      active: true,
      version: 1,
    };
    let created = false;
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage', 'branches.read']),
      routes: {
        'GET /manager/online/delivery-areas': () => ({
          status: 200,
          body: { areas: created ? [area] : [] },
        }),
        'POST /manager/online/delivery-areas': () => {
          created = true;
          return { status: 201, body: area };
        },
        'GET /manager/branches': () => ({ status: 200, body: { branches: [] } }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/delivery-areas', fetch });
    await user.click(await screen.findByRole('button', { name: 'Add area' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(
      within(dialog).getByLabelText('Pick from the Kuwait list'),
      'Salmiya|السالمية',
    );
    expect(within(dialog).getByLabelText('Name (English)')).toHaveValue('Salmiya');
    expect(within(dialog).getByLabelText('Name (Arabic)')).toHaveValue('السالمية');
    await user.clear(within(dialog).getByLabelText('Delivery fee (KWD)'));
    await user.type(within(dialog).getByLabelText('Delivery fee (KWD)'), '1.000');
    await user.type(within(dialog).getByLabelText('Free delivery from (KWD)'), '10.000');
    await user.type(within(dialog).getByLabelText('Estimated time (minutes)'), '45');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.method === 'POST')?.body).toEqual({
        nameEn: 'Salmiya',
        nameAr: 'السالمية',
        fee: '1.000',
        minimumOrder: '0.000',
        freeDeliveryFrom: '10.000',
        estimatedMinutes: 45,
        branchId: null,
        active: true,
      }),
    );
    expect(await screen.findByText('Salmiya')).toBeInTheDocument();
    expect(screen.getByText(/free from KWD 10.000/)).toBeInTheDocument();
  });

  it('adds a branch to the store with pickup, preparation time and its own hours', async () => {
    const user = userEvent.setup();
    const mall = {
      ...branches.branches[0]!,
      id: '0190a000-0000-7000-8000-0000000000b2',
      code: 'MALL',
      nameEn: 'Mall',
      nameAr: null,
      isMain: false,
    };
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage', 'branches.read']),
      routes: {
        'GET /manager/branches': () => ({
          status: 200,
          body: { branches: [...branches.branches, mall] },
        }),
        'GET /manager/online/branches': () => ({ status: 200, body: { branches: [] } }),
        'PUT /manager/online/branches/0190a000-0000-7000-8000-0000000000b2': () => ({
          status: 200,
          body: {
            branchId: mall.id,
            nameEn: 'Mall',
            nameAr: null,
            address: null,
            phone: null,
            pickupEnabled: true,
            deliveryEnabled: false,
            preparationMinutes: 45,
            hours: null,
            position: 0,
            active: true,
            version: 1,
          },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/branches', fetch });
    expect(await screen.findByText(/fulfilment branch of the settings serves/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Add to the store' })[1]!);
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText('Preparation time (minutes)'));
    await user.type(within(dialog).getByLabelText('Preparation time (minutes)'), '45');
    // Own hours: Friday closed, the other days 09:00–22:00 by default.
    await user.click(within(dialog).getByRole('checkbox', { name: 'Store hours' }));
    await user.click(within(dialog).getAllByRole('checkbox', { name: 'Closed' })[4]!);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
        pickupEnabled: true,
        deliveryEnabled: false,
        preparationMinutes: 45,
        hours: { mon: [{ open: '09:00', close: '22:00' }], fri: [] },
      }),
    );
  });

  it('creates a discount code and pauses a used promotion', async () => {
    const user = userEvent.setup();
    const ten = {
      id: '0190a000-0000-7000-8000-0000000000e5',
      nameEn: 'Ten percent',
      nameAr: null,
      kind: 'code',
      code: 'TEN',
      discountType: 'percentage',
      percent: '10',
      amount: null,
      minimumOrder: money('5.000'),
      maxUses: 100,
      usesCount: 3,
      maxUsesPerCustomer: null,
      startsAt: null,
      endsAt: null,
      status: 'active',
      appliesTo: 'order',
      targetIds: [],
      position: 0,
      version: 1,
    };
    let created = false;
    let paused = false;
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage']),
      routes: {
        'GET /manager/online/promotions': () => ({
          status: 200,
          body: { promotions: created ? [{ ...ten, status: paused ? 'paused' : 'active' }] : [] },
        }),
        'POST /manager/online/promotions': () => {
          created = true;
          return { status: 201, body: ten };
        },
        [`DELETE /manager/online/promotions/${ten.id}`]: () => {
          paused = true;
          return { status: 200, body: { promotions: [{ ...ten, status: 'paused' }] } };
        },
        'GET /manager/online/categories': () => ({ status: 200, body: { categories: [] } }),
        'GET /manager/online/listings': () => ({ status: 200, body: { products: [] } }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/promotions', fetch });
    expect(await screen.findByText('No promotions yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add promotion' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name (English)'), 'Ten percent');
    await user.type(within(dialog).getByLabelText('Code'), 'ten');
    await user.type(within(dialog).getByLabelText('Percent'), '10');
    await user.clear(within(dialog).getByLabelText('Minimum order (KWD)'));
    await user.type(within(dialog).getByLabelText('Minimum order (KWD)'), '5.000');
    await user.type(within(dialog).getByLabelText('Maximum uses'), '100');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
        nameEn: 'Ten percent',
        kind: 'code',
        code: 'TEN',
        discountType: 'percentage',
        percent: '10',
        minimumOrder: '5.000',
        maxUses: 100,
        status: 'active',
        appliesTo: 'order',
      }),
    );
    const row = await screen.findByTestId('promotion');
    expect(within(row).getByText('TEN')).toBeInTheDocument();
    expect(within(row).getByText(/10% off · min\. KWD 5\.000 · used 3 \/ 100/)).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Pause' }));
    expect(await screen.findByText('Paused')).toBeInTheDocument();
    expect(fetch.calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  it('computes the store analytics in the browser from its orders', async () => {
    const today = new Date().toISOString();
    const cancelled = {
      ...summary,
      id: '0190a000-0000-7000-8000-0000000000f2',
      number: 'W-000008',
      status: 'cancelled',
      createdAt: today,
    };
    const paid = { ...summary, createdAt: today, discount: money('0.500'), total: money('2.000') };
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.orders']),
      routes: {
        'GET /manager/online/orders': () => ({
          status: 200,
          body: { orders: [paid, cancelled], total: 2, page: 1, pageSize: 100, counts: {} },
        }),
        [`GET /manager/online/orders/${ORDER_ID}`]: () => ({
          status: 200,
          body: { ...detail, ...paid },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/analytics', fetch });
    expect(await screen.findByTestId('kpi-orders')).toHaveTextContent('1');
    expect(screen.getByTestId('kpi-revenue')).toHaveTextContent('KWD 2.000');
    expect(screen.getByTestId('kpi-average')).toHaveTextContent('KWD 2.000');
    expect(screen.getByTestId('kpi-lost')).toHaveTextContent('50%');
    expect(await screen.findByText('Coffee beans')).toBeInTheDocument();
    expect(screen.getByText('KWD 0.500')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Revenue per day' })).toBeInTheDocument();
    // Without reports.sales the sales report is not requested.
    expect(fetch.calls.some((c) => c.path.startsWith('/manager/reports'))).toBe(false);
  });

  it('reserves the gateway and domain sections of the settings for later phases', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage', 'branches.read']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        'GET /manager/online/store': () => ({ status: 200, body: store }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/settings', fetch });
    const gateways = await screen.findByTestId('gateway-placeholders');
    expect(within(gateways).getAllByText('Coming soon')).toHaveLength(3);
    expect(within(gateways).getByText('K-net')).toBeInTheDocument();
    expect(screen.getByText('Store address on the web')).toBeInTheDocument();
    expect(screen.getAllByText(store.url).length).toBeGreaterThan(0);
    expect(screen.getByRole('checkbox', { name: /Let shoppers create accounts/ })).toBeChecked();
    expect(fetch.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('shows the launch steps of a draft store and shares its link on WhatsApp (ADR-0127)', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage', 'online.orders']),
      routes: {
        'GET /manager/online/store': () => ({ status: 200, body: store }),
        'GET /manager/online/listings': () => ({
          status: 200,
          body: { products: [listing({ listed: true })] },
        }),
        'GET /manager/online/orders': () => ({
          status: 200,
          body: { orders: [summary], total: 1, page: 1, pageSize: 5, counts: { placed: 2 } },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/', fetch });
    expect(await screen.findByRole('heading', { name: 'Online store' })).toBeInTheDocument();
    const steps = await screen.findByTestId('launch-checklist');
    // Name, products and pay on receipt are done; branch, logo and publishing are left.
    expect(await within(steps).findByText('3 of 6 steps done')).toBeInTheDocument();
    expect(within(steps).getByRole('img', { name: '50%' })).toBeInTheDocument();
    expect(within(steps).getByRole('link', { name: /Pick the fulfilment branch/ })).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
      'href',
      `https://wa.me/?text=${encodeURIComponent(`Demo ${store.url}`)}`,
    );
    // The latest orders, and the waiting count on the orders link of both navigations.
    expect(await screen.findByText('Sara')).toBeInTheDocument();
    const tabs = screen.getByRole('navigation', { name: 'Quick navigation' });
    expect(within(tabs).getByRole('link', { name: 'Orders' })).toHaveTextContent('2');
  });

  it('switches between light, dark and the device theme and remembers it', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.orders']),
      routes: { 'GET /manager/online/orders': () => ({ status: 200, body: emptyOrders }) },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/', fetch });
    const theme = await screen.findByRole('group', { name: 'Appearance' });
    await user.click(within(theme).getByRole('button', { name: 'Dark' }));
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.getItem('arabat.online.theme')).toBe('dark');
    expect(within(theme).getByRole('button', { name: 'Dark' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(theme).getByRole('button', { name: 'Auto' }));
    expect(document.documentElement.dataset['theme']).toBeUndefined();
    expect(localStorage.getItem('arabat.online.theme')).toBeNull();
  });

  it('filters the orders with status chips that carry their counts', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.orders']),
      routes: {
        'GET /manager/online/orders': () => ({
          status: 200,
          body: {
            orders: [summary],
            total: 1,
            page: 1,
            pageSize: 25,
            counts: { paid: 1, placed: 2 },
          },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/orders', fetch });
    const chips = await screen.findByRole('group', { name: 'Status' });
    expect(await within(chips).findByRole('button', { name: /All statuses\s*3/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Only statuses with orders get a chip.
    expect(within(chips).queryByRole('button', { name: /Cancelled/ })).toBeNull();
    await user.click(
      within(chips).getByRole('button', { name: /New \(awaiting confirmation\)\s*2/ }),
    );
    await waitFor(() =>
      expect(
        fetch.calls.some(
          (c) => c.path === '/manager/online/orders' && c.query.includes('status=placed'),
        ),
      ).toBe(true),
    );
  });

  describe('store design (ADR-0128)', () => {
    function designRoutes(initial = legacyDesign()) {
      let version = 0;
      let draft: unknown = initial;
      let published: unknown = null;
      const state = () => ({
        draft,
        published,
        publishedAt: published ? '2026-10-20T10:00:00.000Z' : null,
        // Never saved: shoppers see the same legacy layout as the draft.
        dirty: version > 0 && JSON.stringify(draft) !== JSON.stringify(published),
        suggestedTemplate: 'retail',
        version,
      });
      return {
        'GET /manager/online/store': () => ({
          status: 200,
          body: { ...store, fulfillmentBranchId: BRANCH },
        }),
        'GET /manager/online/design': () => ({ status: 200, body: state() }),
        'PUT /manager/online/design': (body: unknown) => {
          draft = (body as { design: unknown }).design;
          version += 1;
          return { status: 200, body: state() };
        },
        'POST /manager/online/design/publish': () => {
          published = draft;
          version += 1;
          return { status: 200, body: state() };
        },
      };
    }
    const session = () =>
      makeSession('manager', ['manager.access', 'online.manage', 'branches.read']);

    it('adds a video section, saves the draft and publishes it, with a live preview frame', async () => {
      const user = userEvent.setup();
      const fetch = fakeApiFetch({ session: session(), routes: designRoutes() });
      renderApp({ routes, appInterface: 'manager', i18n, path: '/design', fetch });
      const frame = await screen.findByTestId('design-preview');
      expect(frame).toHaveAttribute('name', 'arabat-design-preview');
      expect(frame).toHaveAttribute('src', '/store/demo');
      // The store is laid out at a true device width (then scaled to fit), so the desktop
      // preview shows the desktop header rather than the phone one.
      expect(frame).toHaveStyle({ width: '1280px' });
      await user.click(screen.getByRole('radio', { name: 'Phone' }));
      expect(screen.getByTestId('design-preview')).toHaveStyle({ width: '390px' });
      await user.click(screen.getByRole('radio', { name: 'Desktop' }));
      expect(screen.getByTestId('design-status')).toHaveTextContent('Published');
      // The legacy home page: the store banner, then the product list.
      expect(screen.getByRole('button', { name: 'Edit Banner' })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Edit Product list (search & filter)' }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Add section' }));
      const picker = await screen.findByRole('dialog', { name: 'Add section' });
      await user.click(within(picker).getByRole('button', { name: /^Video/ }));
      const url = await screen.findByLabelText('Video link');
      await user.type(url, 'https://example.com/clip.mp4');
      expect(screen.getByText('This is not a YouTube, Vimeo or TikTok link.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
      await user.clear(url);
      await user.type(url, 'https://youtu.be/dQw4w9WgXcQ');
      await user.click(screen.getByRole('radio', { name: 'Portrait (reels, TikTok)' }));
      expect(screen.getByTestId('design-status')).toHaveTextContent('Unsaved changes');
      await user.click(screen.getByRole('button', { name: 'Save draft' }));
      await waitFor(() =>
        expect(screen.getByTestId('design-status')).toHaveTextContent('Saved, not published'),
      );
      const put = fetch.calls.find(
        (c) => c.method === 'PUT' && c.path === '/manager/online/design',
      )!;
      const body = put.body as {
        version: number;
        design: { pages: { home: { type: string; url?: string; aspect?: string }[] } };
      };
      expect(body.version).toBe(0);
      expect(body.design.pages.home.map((x) => x.type)).toEqual(['banner', 'catalog', 'video']);
      expect(body.design.pages.home[2]).toMatchObject({
        url: 'https://youtu.be/dQw4w9WgXcQ',
        aspect: 'portrait',
      });
      await user.click(screen.getByRole('button', { name: 'Publish' }));
      await waitFor(() =>
        expect(screen.getByTestId('design-status')).toHaveTextContent('Published'),
      );
      expect(fetch.calls.find((c) => c.path === '/manager/online/design/publish')!.body).toEqual({
        version: 1,
      });
    });

    it('applies the restaurant template and keeps the sections a page cannot lose', async () => {
      const user = userEvent.setup();
      const fetch = fakeApiFetch({ session: session(), routes: designRoutes() });
      renderApp({ routes, appInterface: 'manager', i18n, path: '/design', fetch });
      await user.click(await screen.findByRole('tab', { name: 'Template' }));
      const restaurant = screen.getByText('Restaurant').closest('div')!;
      await user.click(within(restaurant).getByRole('button', { name: 'Apply' }));
      await user.click(within(restaurant).getByRole('button', { name: 'Yes, replace my design' }));
      await user.click(screen.getByRole('radio', { name: 'Round' }));
      await user.click(screen.getByRole('tab', { name: 'Pages' }));
      expect(screen.getByRole('button', { name: 'Edit Restaurant menu' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit Store info' })).toBeInTheDocument();
      // The products page keeps its only product list; extra sections can go.
      await user.click(screen.getByRole('radio', { name: 'Products' }));
      expect(screen.getByRole('button', { name: 'Delete Restaurant menu' })).toBeDisabled();
      await user.click(screen.getByRole('button', { name: 'Delete Store info' }));
      expect(screen.queryByRole('button', { name: 'Edit Store info' })).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Hide Restaurant menu' }));
      await user.click(screen.getByRole('button', { name: 'Save draft' }));
      await waitFor(() => expect(fetch.calls.some((c) => c.method === 'PUT')).toBe(true));
      const design = (fetch.calls.find((c) => c.method === 'PUT')!.body as { design: unknown })
        .design as {
        template: string;
        style: { radius: string };
        pages: { home: { type: string }[]; products: { type: string; visible: boolean }[] };
      };
      expect(design.template).toBe('restaurant');
      expect(design.style.radius).toBe('round');
      expect(design.pages.home.map((x) => x.type)).toEqual(['banner', 'info', 'products', 'menu']);
      expect(design.pages.products).toEqual([
        expect.objectContaining({ type: 'menu', visible: false }),
      ]);
    });

    it('sets the header, the navigation items, the social accounts and the footer blocks', async () => {
      const user = userEvent.setup();
      const fetch = fakeApiFetch({ session: session(), routes: designRoutes() });
      renderApp({ routes, appInterface: 'manager', i18n, path: '/design', fetch });
      await user.click(await screen.findByRole('tab', { name: 'Header' }));
      await user.click(screen.getByRole('radio', { name: 'Logo in the centre' }));
      await user.click(screen.getByRole('radio', { name: 'Pills' }));
      await user.click(screen.getByRole('button', { name: 'Add item' }));
      await user.type(screen.getByLabelText('Label (English)'), 'Offers');
      await user.selectOptions(screen.getByLabelText('Opens'), 'url');
      const address = screen.getByLabelText('An address');
      await user.clear(address);
      await user.type(address, 'https://offers.example.com');
      await user.type(screen.getByLabelText('Instagram'), '@demo.shop');
      await user.click(screen.getByRole('tab', { name: 'Footer' }));
      await user.click(screen.getByRole('radio', { name: 'Dark' }));
      await user.selectOptions(screen.getByLabelText('Block'), 'social');
      await user.click(screen.getByRole('button', { name: 'Add block' }));
      await user.click(screen.getByRole('button', { name: 'Save draft' }));
      await waitFor(() => expect(fetch.calls.some((c) => c.method === 'PUT')).toBe(true));
      const design = (fetch.calls.find((c) => c.method === 'PUT')!.body as { design: unknown })
        .design as {
        header: { layout: string };
        navbar: { style: string; items: { label: { en: string }; link: unknown }[] };
        social: { instagram: string };
        footer: { style: string; blocks: { type: string }[] };
      };
      expect(design.header.layout).toBe('centered');
      expect(design.navbar.style).toBe('pills');
      expect(design.navbar.items).toEqual([
        expect.objectContaining({
          label: { en: 'Offers', ar: null },
          link: { kind: 'url', url: 'https://offers.example.com' },
        }),
      ]);
      expect(design.social.instagram).toBe('demo.shop');
      expect(design.footer.style).toBe('dark');
      expect(design.footer.blocks.map((b) => b.type)).toEqual(['contact', 'social']);
    });

    it('builds the header: layout gallery, top bar messages, sub-menus and ordered header buttons', async () => {
      const user = userEvent.setup();
      const fetch = fakeApiFetch({ session: session(), routes: designRoutes() });
      renderApp({ routes, appInterface: 'manager', i18n, path: '/design', fetch });
      await user.click(await screen.findByRole('tab', { name: 'Header' }));
      const layouts = screen.getByRole('radiogroup', { name: 'Layout' });
      expect(within(layouts).getAllByRole('radio')).toHaveLength(7);
      await user.click(within(layouts).getByRole('radio', { name: 'Floating capsule' }));
      expect(within(layouts).getByRole('radio', { name: 'Floating capsule' })).toBeChecked();

      await user.click(screen.getByRole('button', { name: 'Add message' }));
      await user.type(screen.getByLabelText('Message 1 (English)'), 'Free delivery over 10 KWD');

      await user.click(screen.getByRole('button', { name: 'Add item' }));
      await user.type(screen.getByLabelText('Label (English)'), 'Shop');
      await user.click(screen.getByRole('button', { name: 'Add sub-item' }));
      await user.type(screen.getAllByLabelText('Label (English)')[1]!, 'New in');

      await user.click(screen.getByRole('button', { name: 'Move Search down' }));
      await user.click(screen.getByRole('checkbox', { name: 'Show Account' }));
      await user.click(screen.getByRole('checkbox', { name: 'Show WhatsApp' }));
      await user.click(
        within(screen.getByRole('radiogroup', { name: 'Cart button' })).getByRole('radio', {
          name: 'Icon with badge',
        }),
      );
      await user.click(
        within(screen.getByRole('radiogroup', { name: 'Header colour' })).getByRole('radio', {
          name: 'Glass',
        }),
      );
      await user.click(
        screen.getByRole('checkbox', { name: 'Search bar under the header on phones' }),
      );

      await user.click(screen.getByRole('button', { name: 'Save draft' }));
      await waitFor(() => expect(fetch.calls.some((c) => c.method === 'PUT')).toBe(true));
      const design = (fetch.calls.find((c) => c.method === 'PUT')!.body as { design: unknown })
        .design as {
        announcement: { messages: { en: string | null }[] };
        header: {
          layout: string;
          background: string;
          cartStyle: string;
          mobileSearch: boolean;
          actions: { type: string; visible: boolean }[];
        };
        navbar: { items: { label: { en: string }; children: { label: { en: string } }[] }[] };
      };
      expect(design.header.layout).toBe('floating');
      expect(design.header.background).toBe('glass');
      expect(design.header.cartStyle).toBe('icon');
      expect(design.header.mobileSearch).toBe(true);
      expect(design.announcement.messages).toEqual([{ en: 'Free delivery over 10 KWD', ar: null }]);
      expect(design.navbar.items).toEqual([
        expect.objectContaining({
          label: { en: 'Shop', ar: null },
          children: [expect.objectContaining({ label: { en: 'New in', ar: null } })],
        }),
      ]);
      expect(design.header.actions.map((a) => a.type)).toEqual([
        'account',
        'search',
        'branch',
        'language',
        'whatsapp',
        'cart',
      ]);
      expect(Object.fromEntries(design.header.actions.map((a) => [a.type, a.visible]))).toEqual(
        expect.objectContaining({ account: false, whatsapp: true, cart: true }),
      );
    });
  });

  it('defines the same translation keys in Arabic and English', () => {
    expect(flattenKeys(resources.ar).sort()).toEqual(flattenKeys(resources.en).sort());
  });
});
