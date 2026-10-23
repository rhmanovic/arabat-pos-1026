import { legacyDesign } from '@arabat/contracts';
import { flattenKeys } from '@arabat/i18n';
import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const addresses = {
  available: true,
  code: 'st-4k9m2p',
  permanentUrl: 'https://st-4k9m2p.arabatapp.com',
  storeUrl: 'https://demo.arabatapp.com',
  primaryUrl: 'https://demo.arabatapp.com',
  target: 'stores.arabatapp.com',
  domain: null,
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
  parentId: null,
  onlineNameEn: null,
  onlineNameAr: null,
  visible: true,
  position: 0,
  imageUrl: null,
  productCount: 0,
  version: 1,
};
const COLLECTION = {
  id: '0190a000-0000-7000-8000-0000000000d1',
  nameEn: 'Offers',
  nameAr: null,
  position: 0,
  status: 'active',
  imageUrl: null,
  productIds: [],
  version: 1,
};
const listing = (extra: Record<string, unknown>) => ({
  productId: P1,
  nameEn: 'Product',
  nameAr: null,
  visible: true,
  posVisible: true,
  variants: 1,
  price: money('1.250'),
  trackInventory: true,
  position: 0,
  titleEn: null,
  titleAr: null,
  descriptionEn: null,
  descriptionAr: null,
  featured: false,
  maxPerOrder: null,
  category: null,
  collectionIds: [],
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
    // Save floats over the window; it wakes up with the first change.
    const bar = screen.getByRole('toolbar', { name: 'Save settings' });
    expect(within(bar).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.clear(slug);
    await user.type(slug, 'saffron');
    expect(await screen.findByText('Taken by another store or link page.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'saffron-store' }));
    expect(slug).toHaveValue('saffron-store');
    expect(within(bar).getByText('Unsaved changes')).toBeInTheDocument();
    await user.click(within(bar).getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('The store was not saved. Fix these fields:'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Fulfilment branch: Choose the branch that fulfils online orders\./),
    ).toBeInTheDocument();
  });

  it('switches a product off the website and links products without a category', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage', 'catalog.manage']),
      routes: {
        'GET /manager/online/listings': () => ({
          status: 200,
          body: {
            products: [
              listing({ productId: P1, nameEn: 'Coffee beans' }),
              listing({ productId: P2, nameEn: 'Mug', posVisible: false, category: CATEGORY }),
            ],
          },
        }),
        'GET /manager/online/categories': () => ({
          status: 200,
          body: { categories: [CATEGORY], uncategorized: 1 },
        }),
        'GET /manager/online/collections': () => ({ status: 200, body: { collections: [] } }),
        'PUT /manager/online/listings': () => ({ status: 200, body: { products: [] } }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/products', fetch });
    // One product without a category: the warning offers to link it.
    expect(await screen.findByTestId('uncategorized-warning')).toHaveTextContent(
      'Products without a category: 1',
    );
    expect(screen.getByText('Hidden at the point of sale')).toBeInTheDocument();
    // The website switch is the store's own.
    await user.click(screen.getAllByRole('checkbox', { name: /Shown on the website/ })[0]!);
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.method === 'PUT')?.body).toEqual({
        productIds: [P1],
        visible: false,
      }),
    );
    // "Link them": only the products without a category, then a bulk category.
    await user.click(screen.getByRole('button', { name: 'Link them to a category' }));
    expect(screen.queryByText('Mug')).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Select Coffee beans' }));
    await user.selectOptions(screen.getByLabelText('Set category…'), CATEGORY.id);
    await waitFor(() =>
      expect(fetch.calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({
        productIds: [P1],
        categoryId: CATEGORY.id,
      }),
    );
  });

  it('reorders the store products and edits what the store says about one', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage', 'catalog.manage']),
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
        'GET /manager/online/categories': () => ({
          status: 200,
          body: { categories: [CATEGORY], uncategorized: 2 },
        }),
        'GET /manager/online/collections': () => ({
          status: 200,
          body: { collections: [COLLECTION] },
        }),
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
    // Where the product lives comes first, then where it is also shown.
    const category = within(dialog).getByLabelText('Category (shared with the point of sale)');
    const lists = within(dialog).getByText('Also show it in:');
    expect(category.compareDocumentPosition(lists) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Store title (English)'), 'Big mug');
    await user.selectOptions(
      within(dialog).getByLabelText('Category (shared with the point of sale)'),
      CATEGORY.id,
    );
    await user.click(within(dialog).getByRole('checkbox', { name: 'Offers' }));
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
        visible: true,
        collectionIds: [COLLECTION.id],
        categoryId: CATEGORY.id,
      }),
    );
  });

  it('edits the name, price and pictures of a product like adding one', async () => {
    const user = userEvent.setup();
    URL.createObjectURL = () => 'blob:preview';
    URL.revokeObjectURL = () => undefined;
    const VARIANT = '0190a000-0000-7000-8000-0000000000e1';
    const IMG = '0190a000-0000-7000-8000-0000000000f1';
    const product = {
      id: P1,
      categoryId: null,
      nameEn: 'Coffee beans',
      nameAr: null,
      descriptionEn: 'Fresh',
      descriptionAr: null,
      type: 'standard',
      hasVariants: false,
      trackInventory: true,
      availableInAllBranches: true,
      branchIds: [],
      posVisible: true,
      status: 'active',
      variants: [
        {
          id: VARIANT,
          nameEn: null,
          nameAr: null,
          sku: 'CB-1',
          barcodes: ['12345678'],
          price: { amount: '2.000', currency: 'KWD' },
          cost: { amount: '1.000', currency: 'KWD' },
          isDefault: true,
          status: 'active',
          position: 0,
        },
      ],
      images: [{ id: IMG, contentType: 'image/webp', sizeBytes: 10, url: '/img/1' }],
      version: 3,
      createdAt: '2026-10-21T10:00:00.000Z',
      updatedAt: '2026-10-21T10:00:00.000Z',
    };
    const fetch = fakeApiFetch({
      session: makeSession('manager', [
        'manager.access',
        'online.manage',
        'catalog.manage',
        'catalog.prices.manage',
      ]),
      routes: {
        'GET /manager/online/listings': () => ({
          status: 200,
          body: {
            products: [
              listing({
                productId: P1,
                nameEn: 'Coffee beans',
                images: [{ id: IMG, url: '/img/1' }],
              }),
            ],
          },
        }),
        'GET /manager/online/categories': () => ({
          status: 200,
          body: { categories: [CATEGORY], uncategorized: 1 },
        }),
        'GET /manager/online/collections': () => ({ status: 200, body: { collections: [] } }),
        [`GET /manager/products/${P1}`]: () => ({ status: 200, body: product }),
        [`PATCH /manager/products/${P1}`]: () => ({ status: 200, body: product }),
        [`DELETE /manager/products/${P1}/images/${IMG}`]: () => ({ status: 200, body: product }),
        [`POST /manager/products/${P1}/images`]: () => ({ status: 201, body: product }),
        [`PUT /manager/online/listings/${P1}`]: () => ({ status: 200, body: { products: [] } }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/products', fetch });
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'In the store: Coffee beans' });
    // The catalog's name and price are here, no trip to the catalog.
    const name = await within(dialog).findByLabelText('Name (English)');
    expect(name).toHaveValue('Coffee beans');
    await user.clear(name);
    await user.type(name, 'Arabica beans');
    const price = within(dialog).getByLabelText('Price (KWD)');
    await user.clear(price);
    await user.type(price, '2.750');
    // Pictures: remove the saved one, paste a new one.
    await user.click(within(dialog).getByRole('button', { name: 'Remove picture 1' }));
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'new.png', {
      type: 'image/png',
    });
    await user.paste({ files: [file], items: [], types: ['Files'] } as unknown as DataTransfer);
    expect(within(dialog).getByRole('img', { name: 'new.png' })).toBeInTheDocument();
    expect(within(dialog).queryByText('Open in the catalog')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Everything else of the catalog product goes back unchanged.
    expect(fetch.calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      nameAr: null,
      nameEn: 'Arabica beans',
      descriptionAr: null,
      descriptionEn: 'Fresh',
      categoryId: null,
      type: 'standard',
      hasVariants: false,
      trackInventory: true,
      availableInAllBranches: true,
      branchIds: [],
      posVisible: true,
      variants: [
        {
          id: VARIANT,
          nameAr: null,
          nameEn: null,
          sku: 'CB-1',
          barcodes: ['12345678'],
          price: '2.750',
          cost: '1.000',
        },
      ],
      version: 3,
    });
    expect(fetch.calls.some((c) => c.method === 'DELETE' && c.path.endsWith(IMG))).toBe(true);
    expect(fetch.calls.some((c) => c.method === 'POST' && c.path.endsWith('/images'))).toBe(true);
    expect(fetch.calls.some((c) => c.path === `/manager/online/listings/${P1}`)).toBe(true);
  });

  it('adds a product from the store console with a pasted picture: it is in both places', async () => {
    const user = userEvent.setup();
    URL.createObjectURL = () => 'blob:preview';
    URL.revokeObjectURL = () => undefined;
    const created = {
      id: P1,
      categoryId: CATEGORY.id,
      nameEn: null,
      nameAr: 'قهوة',
      descriptionEn: null,
      descriptionAr: null,
      type: 'standard',
      hasVariants: false,
      trackInventory: false,
      availableInAllBranches: true,
      branchIds: [],
      posVisible: true,
      status: 'active',
      variants: [],
      images: [],
      version: 1,
      createdAt: '2026-10-21T10:00:00.000Z',
      updatedAt: '2026-10-21T10:00:00.000Z',
    };
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage', 'catalog.manage']),
      routes: {
        'GET /manager/online/listings': () => ({ status: 200, body: { products: [] } }),
        'GET /manager/online/categories': () => ({
          status: 200,
          body: { categories: [CATEGORY], uncategorized: 0 },
        }),
        'GET /manager/online/collections': () => ({ status: 200, body: { collections: [] } }),
        'POST /manager/products': () => ({ status: 201, body: created }),
        [`POST /manager/products/${P1}/images`]: () => ({ status: 201, body: created }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/products', fetch });
    await user.click(await screen.findByRole('button', { name: 'Add product' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add product' });
    await user.type(within(dialog).getByLabelText('Name (Arabic)'), 'قهوة');
    await user.type(within(dialog).getByLabelText('Price (KWD)'), '2.500');
    await user.selectOptions(
      within(dialog).getByLabelText('Category (shared with the point of sale)'),
      CATEGORY.id,
    );
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shot.png', {
      type: 'image/png',
    });
    await user.paste({ files: [file], items: [], types: ['Files'] } as unknown as DataTransfer);
    expect(within(dialog).getByRole('img', { name: 'Product picture' })).toHaveAttribute(
      'src',
      'blob:preview',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fetch.calls.find((c) => c.path === '/manager/products')?.body).toEqual({
      nameAr: 'قهوة',
      nameEn: null,
      categoryId: CATEGORY.id,
      trackInventory: false,
      variants: [{ nameEn: null, nameAr: null, price: '2.500' }],
    });
    expect(fetch.calls.some((c) => c.path === `/manager/products/${P1}/images`)).toBe(true);
    // Shown on the website by default: nothing else is sent.
    expect(
      fetch.calls.some((c) => c.path === '/manager/online/listings' && c.method === 'PUT'),
    ).toBe(false);
  });

  it('downloads the Excel files and uploads one: a check first, then everything at once', async () => {
    const user = userEvent.setup();
    let uploads = 0;
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage', 'catalog.manage']),
      routes: {
        'GET /manager/online/listings': () => ({ status: 200, body: { products: [] } }),
        'GET /manager/online/categories': () => ({
          status: 200,
          body: { categories: [], uncategorized: 0 },
        }),
        'GET /manager/online/collections': () => ({ status: 200, body: { collections: [] } }),
        'POST /manager/online/transfer/products/import': () => {
          // The first upload is the check, the second one applies.
          const apply = ++uploads === 2;
          return {
            status: 201,
            body: {
              mode: apply ? 'applied' : 'preview',
              counts: { created: 1, updated: 1, unchanged: 3 },
              rows: [
                { row: 2, action: 'update', name: 'Tea' },
                { row: 6, action: 'create', name: 'Coffee' },
              ],
              issues: [],
            },
          };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/products', fetch });
    const bar = await screen.findByTestId('transfer-products');
    expect(within(bar).getByRole('link', { name: /Download the template/ })).toHaveAttribute(
      'href',
      '/api/v1/manager/online/transfer/products/template',
    );
    expect(within(bar).getByRole('link', { name: /Download all/ })).toHaveAttribute(
      'href',
      '/api/v1/manager/online/transfer/products/export',
    );
    // The picker sits outside the dialog with no type filter (Firefox on Windows froze on one);
    // the dialog opens once a file is chosen, and a file that is not .xlsx is turned away.
    const picker = within(bar).getByLabelText('Choose a file');
    expect(picker).not.toHaveAttribute('accept');
    await user.upload(picker, new File(['x'], 'notes.txt'));
    expect(await screen.findByText(/Choose an Excel file/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    const file = new File([new Uint8Array([0x50, 0x4b])], 'products.xlsx');
    await user.upload(picker, file);
    const dialog = await screen.findByRole('dialog', { name: 'Upload products from Excel' });
    // The check shows what changes; nothing is applied yet.
    expect(await within(dialog).findByTestId('transfer-counts')).toHaveTextContent('1New');
    expect(within(dialog).getByText('Coffee')).toBeInTheDocument();
    const imports = () => fetch.calls.filter((c) => c.path.endsWith('/import'));
    expect(imports().map((c) => c.query)).toEqual(['']);
    await user.click(within(dialog).getByRole('button', { name: 'Apply 2 changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(imports().map((c) => c.query)).toEqual(['', 'apply=true']);
  });

  it('shows the problems of an uploaded file by row and column and does not apply it', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage', 'catalog.manage']),
      routes: {
        'GET /manager/online/listings': () => ({ status: 200, body: { products: [] } }),
        'GET /manager/online/categories': () => ({
          status: 200,
          body: { categories: [], uncategorized: 0 },
        }),
        'GET /manager/online/collections': () => ({ status: 200, body: { collections: [] } }),
        'POST /manager/online/transfer/products/import': () => ({
          status: 201,
          body: {
            mode: 'preview',
            counts: { created: 2, updated: 0, unchanged: 0 },
            rows: [],
            issues: [
              { row: 4, column: 'price', code: 'invalidAmount' },
              { row: 5, column: 'category', code: 'unknownCategory' },
              { row: 1, column: 'list:Sale', code: 'unknownCollection', message: 'Sale' },
            ],
          },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/products', fetch });
    await user.upload(
      within(await screen.findByTestId('transfer-products')).getByLabelText('Choose a file'),
      new File([new Uint8Array([1])], 'bad.xlsx'),
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText('Fix 3 problems in the file, then upload it again:'),
    ).toBeInTheDocument();
    const row = within(dialog).getByText('Price (KWD)').closest('tr')!;
    expect(row).toHaveTextContent('4');
    expect(row).toHaveTextContent('Write an amount with up to 3 decimals, like 1.250.');
    // A special list's column (one per list) is named after the list.
    expect(within(dialog).getByText('List: Sale').closest('tr')).toHaveTextContent(
      'Your store has no special list named “Sale”.',
    );
    expect(within(dialog).getByRole('button', { name: /Apply/ })).toBeDisabled();
  });

  it('does not offer to add products without the catalog right', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage']),
      routes: {
        'GET /manager/online/listings': () => ({ status: 200, body: { products: [] } }),
        'GET /manager/online/categories': () => ({
          status: 200,
          body: { categories: [], uncategorized: 0 },
        }),
        'GET /manager/online/collections': () => ({ status: 200, body: { collections: [] } }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/products', fetch });
    expect(await screen.findByText('No products yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add product' })).toBeNull();
  });

  it('creates a shared category with a store picture in one save, then closes', async () => {
    const user = userEvent.setup();
    // jsdom has no object URLs; the preview needs one.
    URL.createObjectURL = () => 'blob:preview';
    URL.revokeObjectURL = () => undefined;
    const withPicture = { ...CATEGORY, imageUrl: '/api/v1/manager/online/categories/c9/image?v=1' };
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage', 'catalog.manage']),
      routes: {
        'GET /manager/online/categories': () => ({
          status: 200,
          body: { categories: [], uncategorized: 0 },
        }),
        'POST /manager/online/categories': () => ({ status: 200, body: CATEGORY }),
        [`POST /manager/online/categories/${CATEGORY.id}/image`]: () => ({
          status: 200,
          body: withPicture,
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/categories', fetch });
    // Categories are shared with the point of sale.
    expect(await screen.findByTestId('categories-shared')).toHaveTextContent(
      'Categories are shared with the point of sale',
    );
    await user.click(await screen.findByRole('button', { name: 'Add category' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name (Arabic)'), 'مشروبات');
    await user.type(within(dialog).getByLabelText('Name (English)'), 'Drinks');
    // A picture pasted anywhere in the dialog becomes the category's picture (shown at once).
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shot.png', {
      type: 'image/png',
    });
    await user.paste({ files: [file], items: [], types: ['Files'] } as unknown as DataTransfer);
    expect(within(dialog).getByRole('img', { name: 'Category picture' })).toHaveAttribute(
      'src',
      'blob:preview',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    // One save: the category is created, its picture uploaded, and the dialog closes.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      fetch.calls.find((c) => c.path === '/manager/online/categories' && c.method === 'POST')?.body,
    ).toEqual({
      nameEn: 'Drinks',
      nameAr: 'مشروبات',
      onlineNameEn: null,
      onlineNameAr: null,
      visible: true,
    });
    expect(
      fetch.calls.some(
        (c) => c.method === 'POST' && c.path === `/manager/online/categories/${CATEGORY.id}/image`,
      ),
    ).toBe(true);
  });

  it('shows a category in the store or not without the catalog right, but cannot rename it', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage']),
      routes: {
        'GET /manager/online/categories': () => ({
          status: 200,
          body: { categories: [CATEGORY], uncategorized: 0 },
        }),
        [`PUT /manager/online/categories/${CATEGORY.id}`]: () => ({
          status: 200,
          body: { ...CATEGORY, visible: false },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/categories', fetch });
    expect(await screen.findByRole('button', { name: 'Add category' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Shown in the store' }));
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
        nameEn: 'Drinks',
        visible: false,
        version: 1,
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Name (English)')).toBeDisabled();
    expect(within(dialog).getByLabelText('Store name (English)')).toBeEnabled();
  });

  it('shows categories and special lists as two tabs of one page', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage', 'catalog.manage']),
      routes: {
        'GET /manager/online/categories': () => ({
          status: 200,
          body: { categories: [CATEGORY], uncategorized: 0 },
        }),
        'GET /manager/online/collections': () => ({
          status: 200,
          body: { collections: [COLLECTION] },
        }),
        'GET /manager/online/listings': () => ({ status: 200, body: { products: [] } }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/categories', fetch });
    expect(await screen.findByRole('heading', { name: 'Categories & lists' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Categories (your store sections)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByText('Drinks')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Offers and special lists (optional)' }));
    expect(await screen.findByText(/a list never changes its category/)).toBeInTheDocument();
    expect(await screen.findByText('Offers')).toBeInTheDocument();
    // The navigation has one entry for both.
    expect(screen.queryByRole('link', { name: 'Collections' })).toBeNull();
  });

  it('turns collections holding products without a category into shared categories', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage', 'catalog.manage']),
      routes: {
        'GET /manager/online/categories': () => ({
          status: 200,
          body: { categories: [CATEGORY], uncategorized: 2 },
        }),
        'GET /manager/online/collections': () => ({
          status: 200,
          body: {
            collections: [
              { ...COLLECTION, nameEn: 'Drinks', productIds: [P1] },
              { ...COLLECTION, id: P2, nameEn: 'Sweets', productIds: [P2] },
            ],
          },
        }),
        'GET /manager/online/listings': () => ({
          status: 200,
          body: {
            products: [
              listing({ productId: P1, nameEn: 'Coffee beans' }),
              listing({ productId: P2, nameEn: 'Cake' }),
            ],
          },
        }),
        'POST /manager/online/categories': () => ({
          status: 200,
          body: { ...CATEGORY, id: COLLECTION.id, nameEn: 'Sweets', nameAr: null },
        }),
        'PUT /manager/online/listings': () => ({ status: 200, body: { products: [] } }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/categories', fetch });
    await user.click(
      await screen.findByRole('button', { name: 'Make categories from these lists' }),
    );
    await waitFor(() =>
      expect(fetch.calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([
        // "Drinks" already exists as a category: it is reused.
        { productIds: [P1], categoryId: CATEGORY.id },
        { productIds: [P2], categoryId: COLLECTION.id },
      ]),
    );
    expect(fetch.calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { nameEn: 'Sweets', nameAr: null },
    ]);
  });

  it('creates a special list with chosen products from the second tab of the categories page', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage']),
      routes: {
        'GET /manager/online/collections': () => ({ status: 200, body: { collections: [] } }),
        'GET /manager/online/listings': () => ({
          status: 200,
          body: {
            products: [
              listing({ productId: P1, nameEn: 'Coffee beans' }),
              listing({ productId: P2, nameEn: 'Mug', visible: false }),
            ],
          },
        }),
        'POST /manager/online/collections': () => ({ status: 200, body: COLLECTION }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/collections', fetch });
    expect(await screen.findByText('No special lists yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add a list' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name (English)'), 'Offers');
    await user.click(within(dialog).getByRole('checkbox', { name: /Mug/ }));
    expect(within(dialog).getByText('Hidden on the website')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fetch.calls.find((c) => c.method === 'POST')?.body).toEqual({
      nameEn: 'Offers',
      nameAr: null,
      status: 'active',
      productIds: [P2],
    });
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
      stacksWithDiscounts: false,
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
        'GET /manager/online/categories': () => ({
          status: 200,
          body: { categories: [], uncategorized: 0 },
        }),
        'GET /manager/online/collections': () => ({ status: 200, body: { collections: [] } }),
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

  it('splits the settings into tabs; gateways are interface only for now', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage', 'branches.read']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        'GET /manager/online/store': () => ({ status: 200, body: store }),
        'GET /manager/online/domain': () => ({
          status: 200,
          body: { ...addresses, available: false },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/settings', fetch });
    // General first: the address, the status, the branding.
    const tabs = await screen.findByRole('tablist', { name: 'Settings' });
    expect(within(tabs).getByRole('tab', { name: /General/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('checkbox', { name: /Let shoppers create accounts/ })).toBeChecked();
    expect(screen.queryByText('Fulfilment')).toBeNull();
    // Payment: what works now, then the gateway screens, disabled.
    await user.click(within(tabs).getByRole('tab', { name: /Payment/ }));
    expect(screen.getByRole('checkbox', { name: /Allow payment on receipt/ })).toBeInTheDocument();
    const providers = screen.getByTestId('gateway-providers');
    expect(within(providers).getAllByText('Coming soon')).toHaveLength(5);
    await user.click(within(providers).getByRole('radio', { name: /Tap Payments/ }));
    expect(screen.getByText('Connect Tap Payments')).toBeInTheDocument();
    expect(screen.getByTestId('gateway-form')).toBeDisabled();
    expect(screen.getByLabelText('Notification address')).toHaveValue(
      `${new URL(store.url).origin}/api/v1/webhooks/payments/tap`,
    );
    expect(screen.getByRole('button', { name: 'Save and connect' })).toBeDisabled();
    expect(screen.getByTestId('gateway-methods')).toBeDisabled();
    // Domain: the addresses, and connecting a domain not switched on yet.
    await user.click(within(tabs).getByRole('tab', { name: /Domain/ }));
    expect(await screen.findByTestId('address-main')).toHaveTextContent(addresses.primaryUrl);
    expect(screen.getByTestId('address-permanent')).toHaveTextContent(addresses.permanentUrl);
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(screen.getByLabelText('Your domain')).toBeDisabled();
    // Nothing was sent anywhere.
    expect(fetch.calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('connects the merchant’s own domain: records to add, the check, the main address (ADR-0137)', async () => {
    const user = userEvent.setup();
    const pending = {
      domain: 'raghefkarak.com',
      status: 'pending',
      isPrimary: false,
      www: {
        hostname: 'www.raghefkarak.com',
        status: 'pending',
        certificate: 'pending',
        errors: [],
      },
      root: { hostname: 'raghefkarak.com', status: 'pending', certificate: 'pending', errors: [] },
      records: [
        { type: 'CNAME', name: 'www', value: 'stores.arabatapp.com', purpose: 'required' },
        { type: 'CNAME', name: '@', value: 'stores.arabatapp.com', purpose: 'root' },
      ],
      lastCheckedAt: '2026-10-23T10:00:00.000Z',
      activatedAt: null,
    };
    const active = {
      ...pending,
      status: 'active',
      isPrimary: true,
      www: { ...pending.www, status: 'active', certificate: 'active' },
      activatedAt: '2026-10-23T10:05:00.000Z',
    };
    let typed: unknown = null;
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage', 'branches.read']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        'GET /manager/online/store': () => ({ status: 200, body: store }),
        'GET /manager/online/domain': () => ({ status: 200, body: addresses }),
        'POST /manager/online/domain': (body) => {
          typed = body;
          return { status: 201, body: { ...addresses, domain: pending } };
        },
        'POST /manager/online/domain/check': () => ({
          status: 200,
          body: { ...addresses, primaryUrl: 'https://www.raghefkarak.com', domain: active },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/settings?tab=domain', fetch });
    await user.type(await screen.findByLabelText('Your domain'), 'raghefkarak.com');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(typed).toEqual({ domain: 'raghefkarak.com' });
    // The one record to add, and where it stands.
    expect(await screen.findByTestId('domain-status')).toHaveTextContent('Waiting for the record');
    const records = screen.getAllByTestId('dns-records')[0]!;
    expect(records).toHaveTextContent('CNAME');
    expect(records).toHaveTextContent('www');
    expect(records).toHaveTextContent('stores.arabatapp.com');
    await user.click(screen.getByRole('button', { name: 'Check now' }));
    expect(await screen.findByText('Your domain works')).toBeInTheDocument();
    expect(screen.getByTestId('domain-status')).toHaveTextContent('Working');
    expect(screen.getByTestId('address-main')).toHaveTextContent('https://www.raghefkarak.com');
    expect(screen.getByTestId('address-store')).toHaveTextContent(addresses.storeUrl);
    expect(screen.getByRole('button', { name: 'Use the Arabat address instead' })).toBeEnabled();
    // Once it works the merchant sees only that: no records, steps or checks, and no save bar.
    expect(screen.queryByTestId('dns-records')).toBeNull();
    expect(screen.queryByTestId('domain-steps')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByTestId('domain-root-tip')).toHaveTextContent('raghefkarak.com');
  });

  it('tells the merchant plainly when a working domain stops (ADR-0137)', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage', 'branches.read']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        'GET /manager/online/store': () => ({ status: 200, body: store }),
        'GET /manager/online/domain': () => ({
          status: 200,
          body: {
            ...addresses,
            domain: {
              domain: 'raghefkarak.com',
              status: 'pending',
              isPrimary: false,
              www: {
                hostname: 'www.raghefkarak.com',
                status: 'pending',
                certificate: 'active',
                errors: [],
              },
              root: {
                hostname: 'raghefkarak.com',
                status: 'pending',
                certificate: 'pending',
                errors: [],
              },
              records: [
                { type: 'CNAME', name: 'www', value: 'stores.arabatapp.com', purpose: 'required' },
                { type: 'CNAME', name: '@', value: 'stores.arabatapp.com', purpose: 'root' },
              ],
              lastCheckedAt: '2026-10-25T10:00:00.000Z',
              activatedAt: '2026-10-24T10:00:00.000Z',
            },
          },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/settings?tab=domain', fetch });
    expect(await screen.findByText('Your domain stopped working')).toBeInTheDocument();
    expect(screen.getByTestId('domain-status')).toHaveTextContent('Stopped');
    expect(screen.getByTestId('dns-records')).toHaveTextContent('stores.arabatapp.com');
    expect(screen.queryByTestId('domain-steps')).toBeNull();
    expect(screen.getByRole('button', { name: 'Check now' })).toBeEnabled();
  });

  it('shows the launch steps of a draft store and shares its link on WhatsApp (ADR-0127)', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage', 'online.orders']),
      routes: {
        'GET /manager/online/store': () => ({ status: 200, body: store }),
        'GET /manager/online/listings': () => ({
          status: 200,
          body: { products: [listing({ visible: true })] },
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
    expect(localStorage.getItem('arabat.theme')).toBe('dark');
    expect(within(theme).getByRole('button', { name: 'Dark' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(theme).getByRole('button', { name: 'Auto' }));
    expect(document.documentElement.dataset['theme']).toBeUndefined();
    expect(localStorage.getItem('arabat.theme')).toBeNull();
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
      expect(frame).toHaveAttribute('src', '/store/demo?preview=1');
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
      await user.click(
        within(screen.getByRole('radiogroup', { name: 'Footer colour' })).getByRole('radio', {
          name: 'Dark',
        }),
      );
      await user.click(screen.getByRole('button', { name: 'Social accounts' }));
      await user.click(screen.getByRole('button', { name: 'Save draft' }));
      await waitFor(() => expect(fetch.calls.some((c) => c.method === 'PUT')).toBe(true));
      const design = (fetch.calls.find((c) => c.method === 'PUT')!.body as { design: unknown })
        .design as {
        header: { layout: string };
        navbar: { style: string; items: { label: { en: string }; link: unknown }[] };
        social: { instagram: string };
        footer: { background: string; blocks: { type: string }[] };
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
      expect(design.footer.background).toBe('dark');
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

    describe('home page sections (ADR-0128 amendment 3)', () => {
      const savedHome = async (
        fetch: ReturnType<typeof fakeApiFetch>,
        user: ReturnType<typeof userEvent.setup>,
      ) => {
        await user.click(screen.getByRole('button', { name: 'Save draft' }));
        await waitFor(() => expect(fetch.calls.some((c) => c.method === 'PUT')).toBe(true));
        return (fetch.calls.find((c) => c.method === 'PUT')!.body as { design: unknown })
          .design as {
          pages: {
            home: {
              type: string;
              endsAt?: string | null;
              look: { background: string; devices: string; showUntil: string | null };
            }[];
          };
        };
      };

      it('finds a section in the gallery, sets its content, look, screens and schedule', async () => {
        const user = userEvent.setup();
        const fetch = fakeApiFetch({ session: session(), routes: designRoutes() });
        renderApp({ routes, appInterface: 'manager', i18n, path: '/design', fetch });
        await user.click(await screen.findByRole('button', { name: 'Add section' }));
        const picker = await screen.findByRole('dialog', { name: 'Add section' });
        await user.type(
          within(picker).getByRole('searchbox', { name: 'Search sections' }),
          'timer',
        );
        expect(within(picker).queryByRole('button', { name: /^Picture gallery/ })).toBeNull();
        await user.click(within(picker).getByRole('button', { name: /^Offer countdown/ }));
        // The new section opens with its content, look and visibility.
        expect(
          await screen.findByText('Until you set an end, shoppers do not see the countdown.'),
        ).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'In 3 days' }));
        await user.click(
          within(screen.getByRole('radiogroup', { name: 'Background' })).getByRole('radio', {
            name: 'Dark',
          }),
        );
        await user.click(
          within(screen.getByRole('radiogroup', { name: 'Show on' })).getByRole('radio', {
            name: 'Phones only',
          }),
        );
        await user.type(screen.getByLabelText('Show until'), '2030-01-31T21:30');
        const design = await savedHome(fetch, user);
        const offer = design.pages.home.at(-1)!;
        expect(offer.type).toBe('countdown');
        const days = (Date.parse(offer.endsAt!) - Date.now()) / 86_400_000;
        expect(days).toBeGreaterThan(2.9);
        expect(days).toBeLessThan(3.1);
        expect(offer.look).toEqual(
          expect.objectContaining({ background: 'dark', devices: 'phone' }),
        );
        expect(new Date(offer.look.showUntil!).getFullYear()).toBe(2030);
      });

      it('builds a columns section and gives it a gradient, an edge, motion and an anchor (amendment 7)', async () => {
        const user = userEvent.setup();
        const fetch = fakeApiFetch({ session: session(), routes: designRoutes() });
        renderApp({ routes, appInterface: 'manager', i18n, path: '/design', fetch });
        await user.click(await screen.findByRole('button', { name: 'Add section' }));
        const picker = await screen.findByRole('dialog', { name: 'Add section' });
        await user.click(within(picker).getByRole('button', { name: /^Columns & layout/ }));
        // Three columns, then a button added to the third one.
        await user.click(await screen.findByRole('radio', { name: 'Three equal' }));
        const third = screen.getByRole('group', { name: 'Column 3' });
        await user.click(within(third).getByRole('button', { name: '+ Button' }));
        await user.type(within(third).getByLabelText('Button text (English)'), 'Shop now');
        const radio = (group: string, name: string) =>
          user.click(
            within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name }),
          );
        await radio('Background', 'Gradient');
        await user.click(screen.getByRole('radio', { name: 'Ocean' }));
        await radio('Bottom edge shape', 'Wave');
        await radio('Entrance animation', 'Rise');
        await radio('Section height', 'Full screen');
        await user.type(screen.getByLabelText('Direct link name'), 'Our Offers');
        expect(
          screen.getByText('Link to it from any button or menu item with /#our-offers'),
        ).toBeInTheDocument();
        const design = await savedHome(fetch, user);
        const columns = design.pages.home.at(-1)! as unknown as {
          type: string;
          layout: string;
          columns: { blocks: { type: string; text: { en: string | null } }[] }[];
          look: Record<string, unknown>;
        };
        expect(columns.type).toBe('columns');
        expect(columns.layout).toBe('1-1-1');
        expect(columns.columns).toHaveLength(3);
        expect(columns.columns[2]!.blocks.map((b) => b.type)).toEqual(['button']);
        expect(columns.columns[2]!.blocks[0]!.text.en).toBe('Shop now');
        // New columns start with a title and words to replace.
        expect(columns.columns[0]!.blocks.map((b) => b.type)).toEqual(['heading', 'text']);
        expect(columns.look).toEqual(
          expect.objectContaining({
            background: 'gradient',
            gradient: 'ocean',
            dividerBottom: 'wave',
            animation: 'up',
            height: 'screen',
            anchor: 'our-offers',
          }),
        );
      });

      it('adds a ready-made section, follows the recommendations and applies a ready home page', async () => {
        const user = userEvent.setup();
        const fetch = fakeApiFetch({ session: session(), routes: designRoutes() });
        renderApp({ routes, appInterface: 'manager', i18n, path: '/design', fetch });
        // The legacy home page (banner, product list) misses categories, trust and a next step.
        expect(await screen.findByTestId('page-score')).toHaveTextContent('4 of 7 done');
        await user.click(screen.getAllByRole('button', { name: 'Add it' })[0]!);
        expect(screen.getByTestId('page-score')).toHaveTextContent('5 of 7 done');
        expect(screen.getByRole('button', { name: 'Edit Categories' })).toBeInTheDocument();
        // A ready-made section from the picker.
        await user.click(screen.getByRole('button', { name: 'Add section' }));
        const picker = await screen.findByRole('dialog', { name: 'Add section' });
        await user.click(within(picker).getByRole('tab', { name: 'Ready-made' }));
        await user.click(within(picker).getByRole('button', { name: /Questions & answers/ }));
        await user.click(screen.getByRole('button', { name: /Back to sections/ }));
        // The FAQ brings trust, but it waits for answers: the score holds and the list flags it.
        expect(screen.getByTestId('page-score')).toHaveTextContent('5 of 7 done');
        expect(screen.getByRole('button', { name: 'Edit Questions & answers' })).toHaveTextContent(
          'Needs content',
        );
        // A whole ready home page replaces the sections after a confirmation.
        await user.click(screen.getByRole('button', { name: 'Use the Grocery layout' }));
        await user.click(screen.getByRole('button', { name: 'Yes, replace the home page' }));
        const design = await savedHome(fetch, user);
        expect(design.pages.home.map((x) => x.type)).toEqual([
          'banner',
          'categories',
          'products',
          'collage',
          'products',
          'features',
          'faq',
        ]);
      });
    });

    describe('footer editor (ADR-0128 amendment 2)', () => {
      const saved = async (
        fetch: ReturnType<typeof fakeApiFetch>,
        user: ReturnType<typeof userEvent.setup>,
      ) => {
        await user.click(screen.getByRole('button', { name: 'Save draft' }));
        await waitFor(() => expect(fetch.calls.some((c) => c.method === 'PUT')).toBe(true));
        return (fetch.calls.find((c) => c.method === 'PUT')!.body as { design: unknown })
          .design as {
          footer: {
            layout: string;
            background: string;
            topEdge: string;
            badges: { title: { en: string } }[];
            cta: { enabled: boolean; button: { en: string } };
            blocks: { type: string; title: { en: string | null } }[];
            bottom: { showPayments: boolean; links: { label: { en: string } }[] };
            mobileCollapse: boolean;
          };
        };
      };

      it('applies a preset, follows the recommendations and builds the footer', async () => {
        const user = userEvent.setup();
        const fetch = fakeApiFetch({ session: session(), routes: designRoutes() });
        renderApp({ routes, appInterface: 'manager', i18n, path: '/design', fetch });
        await user.click(await screen.findByRole('tab', { name: 'Footer' }));
        const layouts = screen.getByRole('radiogroup', { name: 'Layout' });
        expect(within(layouts).getAllByRole('radio')).toHaveLength(7);
        // The legacy footer: a contact block only; the recommendations offer fixes.
        expect(screen.getByTestId('footer-score')).toHaveTextContent('1 of 6 done');
        await user.click(screen.getByRole('button', { name: 'Show them' }));
        await user.click(screen.getByRole('button', { name: 'Add suggested' }));
        await user.click(screen.getByRole('button', { name: 'Add one' }));
        expect(screen.getByTestId('footer-score')).toHaveTextContent('4 of 6 done');
        // Layout, colour and edge.
        await user.click(within(layouts).getByRole('radio', { name: 'Brand + columns' }));
        await user.click(
          within(screen.getByRole('radiogroup', { name: 'Top edge' })).getByRole('radio', {
            name: 'Wave',
          }),
        );
        // A new block opens for editing with a ready title; it can carry links.
        await user.click(screen.getByRole('button', { name: 'Links' }));
        expect(screen.getByRole('button', { name: 'Edit Links' })).toHaveAttribute(
          'aria-expanded',
          'true',
        );
        await user.click(screen.getAllByRole('button', { name: 'Add link' })[0]!);
        // A policy link in the bottom line.
        await user.click(screen.getAllByRole('button', { name: 'Add link' }).at(-1)!);
        const labels = screen.getAllByLabelText('Label (English)');
        await user.type(labels.at(-1)!, 'Return policy');
        await user.click(
          screen.getByRole('checkbox', { name: 'Fold the blocks into tappable rows on phones' }),
        );
        const design = await saved(fetch, user);
        expect(design.footer.layout).toBe('split');
        expect(design.footer.topEdge).toBe('wave');
        expect(design.footer.bottom.showPayments).toBe(true);
        expect(design.footer.badges.map((b) => b.title.en)).toEqual([
          'Fast delivery',
          'Secure payment',
          'We are here to help',
        ]);
        expect(design.footer.cta).toEqual(
          expect.objectContaining({ enabled: true, button: { en: 'Shop now', ar: 'تسوّق الآن' } }),
        );
        expect(design.footer.blocks.map((b) => b.type)).toEqual(['contact', 'links']);
        expect(design.footer.blocks[1]!.title).toEqual({ en: 'Quick links', ar: 'روابط سريعة' });
        expect(design.footer.bottom.links.map((l) => l.label.en)).toEqual(['Return policy']);
        // The legacy footer did not fold; the switch turns folding on.
        expect(design.footer.mobileCollapse).toBe(true);
      });

      it('replaces the footer with the restaurant preset', async () => {
        const user = userEvent.setup();
        const fetch = fakeApiFetch({ session: session(), routes: designRoutes() });
        renderApp({ routes, appInterface: 'manager', i18n, path: '/design', fetch });
        await user.click(await screen.findByRole('tab', { name: 'Footer' }));
        await user.click(screen.getByRole('button', { name: 'Apply Restaurant' }));
        expect(screen.getByRole('radio', { name: 'Brand band on top' })).toBeChecked();
        await user.click(screen.getByRole('button', { name: 'Remove Branches' }));
        const design = await saved(fetch, user);
        expect(design.footer.layout).toBe('stacked');
        expect(design.footer.background).toBe('dark');
        expect(design.footer.cta.enabled).toBe(true);
        expect(design.footer.blocks.map((b) => b.type)).toEqual(['hours', 'contact']);
      });
    });

    describe('product page (ADR-0128 amendment 4)', () => {
      const TEA = '0190a000-0000-7000-8000-0000000000f1';
      const MUG = '0190a000-0000-7000-8000-0000000000f2';
      const product = (id: string, nameEn: string, withContent: boolean) => ({
        productId: id,
        nameEn,
        nameAr: null,
        descriptionEn: withContent ? 'Brewed daily' : null,
        descriptionAr: null,
        categoryId: null,
        collectionIds: [],
        imageUrl: withContent ? '/img/tea' : null,
        images: withContent ? ['/img/tea'] : [],
        featured: false,
        position: 0,
        variants: [
          {
            variantId: `${id.slice(0, -2)}aa`,
            nameEn: null,
            nameAr: null,
            sku: null,
            price: { amount: '1.000', currency: 'KWD' },
            available: true,
            maxQuantity: 5,
            fewLeft: null,
          },
        ],
      });
      const preview = {
        'GET /manager/online/preview/storefront': () => ({
          status: 200,
          body: {
            slug: 'demo',
            nameEn: 'Demo',
            nameAr: null,
            taglineEn: null,
            taglineAr: null,
            announcementEn: null,
            announcementAr: null,
            primaryColor: '#0f766e',
            contactPhone: null,
            contactEmail: null,
            acceptingOrders: true,
            pickupEnabled: true,
            deliveryEnabled: false,
            deliveryFee: { amount: '0.000', currency: 'KWD' },
            minimumOrder: { amount: '0.000', currency: 'KWD' },
            paymentMethods: [],
            payOnReceipt: true,
            logoUrl: null,
            bannerUrl: null,
            categories: [],
            collections: [],
            branches: [],
            defaultBranchId: BRANCH,
            deliveryAreas: [],
            scheduling: { enabled: false, slotMinutes: 30 },
            timezone: 'Asia/Kuwait',
            accountsEnabled: false,
          },
        }),
        'GET /manager/online/preview/products': () => ({
          status: 200,
          body: { products: [product(TEA, 'Saffron tea', true), product(MUG, 'Mug', false)] },
        }),
      };

      it('designs the product page: presets, recommendations, arrangement, buy box, description, related and sections', async () => {
        const user = userEvent.setup();
        const fetch = fakeApiFetch({
          session: session(),
          routes: { ...designRoutes(), ...preview },
        });
        renderApp({ routes, appInterface: 'manager', i18n, path: '/design', fetch });
        const frame = (await screen.findByTestId('design-preview')) as HTMLIFrameElement;
        const posted = vi.spyOn(frame.contentWindow!, 'postMessage');
        await user.click(screen.getByRole('radio', { name: 'Product page' }));
        // The preview opens the first product; another one can be picked.
        await waitFor(() =>
          expect(posted).toHaveBeenCalledWith(
            { type: 'arabat:navigate', page: 'product', productId: TEA },
            window.location.origin,
          ),
        );
        await user.selectOptions(await screen.findByLabelText('Preview with'), MUG);
        await waitFor(() =>
          expect(posted).toHaveBeenCalledWith(
            { type: 'arabat:navigate', page: 'product', productId: MUG },
            window.location.origin,
          ),
        );
        // Recommendations: the mug lacks a picture and words; no WhatsApp number yet.
        expect(screen.getByTestId('product-page-score')).toHaveTextContent('3 of 7 done');
        expect(
          screen.getByText('Shoppers buy what they can see. Products without a picture: 1.'),
        ).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Add suggested' }));
        expect(screen.getByTestId('product-page-score')).toHaveTextContent('4 of 7 done');
        // A ready page, then the merchant's own changes.
        await user.click(screen.getByRole('button', { name: 'Apply Food and drinks' }));
        const layouts = screen.getByRole('radiogroup', { name: 'Arrangement' });
        expect(within(layouts).getAllByRole('radio')).toHaveLength(6);
        expect(within(layouts).getByRole('radio', { name: 'Compact' })).toBeChecked();
        await user.click(within(layouts).getByRole('radio', { name: 'All pictures' }));
        await user.click(screen.getByRole('radio', { name: 'Tall' }));
        await user.click(screen.getByRole('checkbox', { name: /Buy now/ }));
        const addLabel = screen.getByLabelText('Add button (English)');
        await user.clear(addLabel);
        await user.type(addLabel, 'Add to bag');
        await user.selectOptions(screen.getByLabelText('"Only a few left"'), '3');
        await user.click(screen.getByRole('radio', { name: 'Tabs' }));
        await user.click(screen.getByRole('button', { name: 'Add information' }));
        const words = screen.getByText('Description and information').closest('details')!;
        await user.type(within(words).getByLabelText('Title (English)'), 'Returns');
        await user.click(screen.getByRole('radio', { name: 'Featured' }));
        await user.click(screen.getByRole('checkbox', { name: 'Show recently viewed products' }));
        // Sections under the product: no product list or menu there.
        await user.click(screen.getByRole('button', { name: 'Add section' }));
        const picker = await screen.findByRole('dialog', { name: 'Add section' });
        expect(
          within(picker).queryByRole('button', { name: /^Product list \(search & filter\)/ }),
        ).toBeNull();
        expect(within(picker).queryByRole('button', { name: /^Restaurant menu/ })).toBeNull();
        await user.click(within(picker).getByRole('button', { name: /^Questions & answers/ }));
        await user.click(await screen.findByRole('button', { name: /Back to sections/ }));
        expect(document.body.textContent).not.toMatch(/productDesign\./);
        await user.click(screen.getByRole('button', { name: 'Save draft' }));
        await waitFor(() => expect(fetch.calls.some((c) => c.method === 'PUT')).toBe(true));
        const design = (
          fetch.calls.find((c) => c.method === 'PUT')!.body as {
            design: {
              productPage: Record<string, unknown>;
              pages: { product: { type: string }[] };
            };
          }
        ).design;
        expect(design.productPage).toMatchObject({
          layout: 'scroll',
          gallery: { ratio: 'portrait', thumbs: 'dots' },
          info: { lowStockAt: 3, breadcrumb: false, titleSize: 'large' },
          buy: { buyNow: true, addLabel: { en: 'Add to bag', ar: 'أضف للطلب' } },
          description: { style: 'tabs', blocks: [{ title: { en: 'Returns', ar: null } }] },
          related: { source: 'featured', showAdd: true },
          recent: { enabled: true },
        });
        expect(design.productPage['highlights']).toHaveLength(2);
        expect(design.pages.product.map((x) => x.type)).toEqual(['faq']);
      });
    });

    describe('ready styles and the categories page (ADR-0128 amendment 6)', () => {
      it('restyles a home section in one tap and keeps its content', async () => {
        const user = userEvent.setup();
        const fetch = fakeApiFetch({ session: session(), routes: designRoutes() });
        renderApp({ routes, appInterface: 'manager', i18n, path: '/design', fetch });
        await user.click(await screen.findByRole('button', { name: 'Edit Banner' }));
        const styles = screen.getByRole('radiogroup', { name: 'Ready styles' });
        await user.click(within(styles).getByRole('radio', { name: 'Big hero' }));
        expect(within(styles).getByRole('radio', { name: /Big hero/ })).toBeChecked();
        await user.click(screen.getByRole('button', { name: 'Save draft' }));
        await waitFor(() => expect(fetch.calls.some((c) => c.method === 'PUT')).toBe(true));
        const home = (
          fetch.calls.find((c) => c.method === 'PUT')!.body as {
            design: { pages: { home: Record<string, unknown>[] } };
          }
        ).design.pages.home;
        expect(home[0]).toMatchObject({
          type: 'banner',
          imageSource: 'store',
          variant: 'overlay',
          height: 'large',
          align: 'center',
        });
      });

      it('applies a ready categories page, follows its recommendations and sets the categories section', async () => {
        const user = userEvent.setup();
        const fetch = fakeApiFetch({ session: session(), routes: designRoutes() });
        renderApp({ routes, appInterface: 'manager', i18n, path: '/design', fetch });
        await user.click(await screen.findByRole('radio', { name: 'Categories' }));
        await user.click(screen.getByText('Ready categories pages'));
        await user.click(screen.getByRole('button', { name: 'Use the Cards with counts layout' }));
        await user.click(screen.getByRole('button', { name: 'Yes, replace the categories page' }));
        expect(screen.getByRole('button', { name: 'Edit Categories' })).toBeInTheDocument();
        // Counts and nesting are done by the layout; products under the categories are not.
        const tips = screen.getByTestId('page-score');
        const before = tips.textContent;
        await user.click(screen.getByRole('button', { name: 'Edit Categories' }));
        await user.click(screen.getByRole('radio', { name: 'Tall' }));
        await user.click(screen.getByRole('checkbox', { name: 'Main categories only' }));
        await user.click(screen.getByRole('button', { name: /Back to sections/ }));
        expect(screen.getByTestId('page-score').textContent).toBe(before);
        expect(document.body.textContent).not.toMatch(/design\.(style|pageTip|categoryLayout)_/);
        await user.click(screen.getByRole('button', { name: 'Save draft' }));
        await waitFor(() => expect(fetch.calls.some((c) => c.method === 'PUT')).toBe(true));
        const categories = (
          fetch.calls.find((c) => c.method === 'PUT')!.body as {
            design: { pages: { categories: Record<string, unknown>[] } };
          }
        ).design.pages.categories;
        expect(categories.map((x) => x['type'])).toEqual(['categories', 'features']);
        expect(categories[0]).toMatchObject({
          variant: 'cards',
          aspect: 'portrait',
          showCount: true,
          showSub: true,
          topOnly: true,
        });
      });
    });

    describe('cart and checkout pages (ADR-0128 amendment 5)', () => {
      it('designs the cart and the checkout: presets, recommendations, settings and cart sections', async () => {
        const user = userEvent.setup();
        const fetch = fakeApiFetch({ session: session(), routes: designRoutes() });
        renderApp({ routes, appInterface: 'manager', i18n, path: '/design', fetch });
        const frame = (await screen.findByTestId('design-preview')) as HTMLIFrameElement;
        const posted = vi.spyOn(frame.contentWindow!, 'postMessage');
        await user.click(screen.getByRole('radio', { name: 'Cart' }));
        await waitFor(() =>
          expect(posted).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'arabat:navigate', page: 'cart' }),
            window.location.origin,
          ),
        );
        // The legacy cart: suggestions, phone bar, minimum and empty-cart products are on.
        expect(screen.getByTestId('cart-page-score')).toHaveTextContent('4 of 5 done');
        await user.click(screen.getByRole('button', { name: 'Turn on' }));
        expect(screen.getByTestId('cart-page-score')).toHaveTextContent('5 of 5 done');
        await user.click(screen.getByRole('button', { name: 'Apply Food and drinks' }));
        await user.click(screen.getByRole('radio', { name: 'One column' }));
        await user.type(screen.getByLabelText('Note at the top (English)'), 'Ready in 20 minutes');
        // A section under the cart: no product list or menu offered there.
        await user.click(screen.getByRole('button', { name: 'Add section' }));
        const picker = await screen.findByRole('dialog', { name: 'Add section' });
        expect(within(picker).queryByRole('button', { name: /^Restaurant menu/ })).toBeNull();
        await user.click(within(picker).getByRole('button', { name: /^Questions & answers/ }));
        await user.click(await screen.findByRole('button', { name: /Back to sections/ }));
        // The checkout: settings only, no sections.
        await user.click(screen.getByRole('radio', { name: 'Checkout' }));
        // The draft follows the preview a moment later, so the order of the two may vary.
        await waitFor(() =>
          expect(posted).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'arabat:navigate', page: 'checkout' }),
            window.location.origin,
          ),
        );
        expect(screen.queryByRole('button', { name: 'Add section' })).toBeNull();
        expect(screen.getByTestId('checkout-page-score')).toHaveTextContent('3 of 4 done');
        await user.click(screen.getByRole('radio', { name: 'Required' }));
        await user.click(screen.getByRole('checkbox', { name: 'Promotion code box' }));
        await user.click(screen.getByRole('checkbox', { name: 'Ask to agree to the terms' }));
        await user.type(
          screen.getByLabelText('Agreement words (English)'),
          'I accept the delivery terms',
        );
        expect(document.body.textContent).not.toMatch(/cartDesign\./);
        await user.click(screen.getByRole('button', { name: 'Save draft' }));
        await waitFor(() => expect(fetch.calls.some((c) => c.method === 'PUT')).toBe(true));
        const design = (
          fetch.calls.find((c) => c.method === 'PUT')!.body as {
            design: {
              cartPage: Record<string, unknown>;
              checkoutPage: Record<string, unknown>;
              pages: { cart: { type: string }[] };
            };
          }
        ).design;
        expect(design.cartPage).toMatchObject({
          layout: 'stacked',
          message: { en: 'Ready in 20 minutes' },
          checkoutLabel: { en: 'Continue', ar: 'متابعة' },
          upsell: { source: 'all' },
        });
        expect(design.checkoutPage).toMatchObject({
          email: 'required',
          promo: false,
          note: { label: { en: 'Notes for the kitchen' } },
          terms: { enabled: true, text: { en: 'I accept the delivery terms' } },
          submitLabel: { en: 'Send my order' },
        });
        expect(design.pages.cart.map((x) => x.type)).toEqual(['faq']);
      });
    });
  });

  it('creates a product discount with a preview and a below-cost confirmation (ADR-0133)', async () => {
    const user = userEvent.setup();
    const previews: unknown[] = [];
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage', 'catalog.prices.manage']),
      routes: {
        'GET /manager/discounts': () => ({ status: 200, body: { discounts: [] } }),
        'GET /manager/online/categories': () => ({
          status: 200,
          body: { categories: [CATEGORY], uncategorized: 0 },
        }),
        'POST /manager/discounts/preview': (body) => {
          previews.push(body);
          return {
            status: 200,
            body: {
              products: 3,
              unchanged: 0,
              belowCost: 1,
              samples: [
                {
                  productId: '0190a000-0000-7000-8000-0000000000a7',
                  nameEn: 'Espresso',
                  nameAr: null,
                  price: money('1.000'),
                  discountedPrice: money('0.750'),
                  cost: money('0.800'),
                  belowCost: true,
                },
              ],
            },
          };
        },
        'POST /manager/discounts': (body) => ({
          status: 201,
          body: {
            id: '0190a000-0000-7000-8000-0000000000a8',
            ...(body as object),
            amount: null,
            state: 'running',
            status: 'active',
            productCount: 3,
            version: 1,
            createdAt: '2026-10-22T10:00:00.000Z',
          },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/discounts', fetch });
    expect(await screen.findByText('No discounts yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New discount' }));
    const dialog = await screen.findByRole('dialog', { name: 'New discount' });
    await user.type(within(dialog).getByLabelText('Name (Arabic)'), 'خصم المشروبات');
    await user.click(within(dialog).getByRole('button', { name: '25%' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Categories' }));
    await user.click(await within(dialog).findByRole('checkbox', { name: 'Drinks' }));
    // The preview tells what the discount does and warns about selling below cost.
    const preview = within(dialog).getByTestId('discount-preview');
    expect(await within(preview).findByText('Lowers the price of 3 products.')).toBeInTheDocument();
    expect(within(preview).getByText('1 product would sell below its cost.')).toBeInTheDocument();
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.click(within(preview).getByRole('checkbox', { name: 'I know, save it anyway' }));
    await user.click(save);
    await waitFor(() =>
      expect(
        fetch.calls.find((c) => c.method === 'POST' && c.path === '/manager/discounts')?.body,
      ).toMatchObject({
        nameAr: 'خصم المشروبات',
        type: 'percentage',
        percent: '25',
        appliesTo: 'categories',
        targetIds: [CATEGORY.id],
        online: true,
        pos: true,
      }),
    );
    expect(previews.length).toBeGreaterThan(0);
  });

  it('shows discounts read-only without the right to manage prices', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'online.manage']),
      routes: { 'GET /manager/discounts': () => ({ status: 200, body: { discounts: [] } }) },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/discounts', fetch });
    expect(await screen.findByText(/Changing them needs/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New discount' })).toBeNull();
  });

  it('defines the same translation keys in Arabic and English', () => {
    expect(flattenKeys(resources.ar).sort()).toEqual(flattenKeys(resources.en).sort());
  });
});
