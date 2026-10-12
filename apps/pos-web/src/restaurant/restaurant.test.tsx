import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../i18n/index.js';
import { routes } from '../routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const money = (amount: string) => ({ amount, currency: 'KWD' });
const BRANCH = '0190a000-0000-7000-8000-000000000001';
const ORDER = '0190a000-0000-7000-8000-00000000f001';
const BURGER = '0190a000-0000-7000-8000-00000000a001';
const SHIFT = {
  id: '0190a000-0000-7000-8000-000000000501',
  branchId: BRANCH,
  registerId: '0190a000-0000-7000-8000-000000000101',
  registerName: { nameEn: 'Register 1', nameAr: null },
  membershipId: 'm',
  employeeName: 'Cashier',
  status: 'open',
  openedAt: '2026-10-12T05:00:00.000Z',
  openingNote: null,
  closedAt: null,
  closedByName: null,
  closeType: null,
  summary: {
    openingFloat: money('20.000'),
    cashIn: money('0.000'),
    cashOut: money('0.000'),
    cashSales: money('0.000'),
    cashRefunds: money('0.000'),
    expectedCash: money('20.000'),
    openingExpected: money('20.000'),
    openingDiscrepancy: money('0.000'),
    openingIsInitial: false,
  },
  countedCash: null,
  discrepancy: null,
  outcome: null,
  countedBreakdown: null,
  closingNote: null,
  movements: [],
  version: 1,
};
const group = {
  id: '0190a000-0000-7000-8000-00000000b001',
  nameEn: 'Doneness',
  nameAr: null,
  minSelect: 1,
  maxSelect: 1,
  status: 'active',
  version: 1,
  modifiers: [
    {
      id: '0190a000-0000-7000-8000-00000000c001',
      nameEn: 'Medium',
      nameAr: null,
      price: money('0.000'),
      position: 0,
      status: 'active',
      componentVariantId: null,
      componentQuantity: null,
    },
    {
      id: '0190a000-0000-7000-8000-00000000c002',
      nameEn: 'Extra cheese',
      nameAr: null,
      price: money('0.250'),
      position: 1,
      status: 'active',
      componentVariantId: null,
      componentQuantity: null,
    },
  ],
};
const item = (overrides: Record<string, unknown> = {}) => ({
  id: '0190a000-0000-7000-8000-00000000d001',
  position: 0,
  variantId: BURGER,
  productId: 'p1',
  nameEn: 'Burger',
  nameAr: null,
  variantNameEn: null,
  variantNameAr: null,
  quantity: '2.000',
  note: null,
  modifiers: [
    { id: group.modifiers[0]!.id, nameEn: 'Medium', nameAr: null, price: money('0.000') },
  ],
  unitPrice: money('2.000'),
  lineTotal: money('4.000'),
  kitchenStatus: 'pending',
  saleId: null,
  cancelReason: null,
  wasted: null,
  version: 1,
  ...overrides,
});
const order = (items: unknown[], overrides: Record<string, unknown> = {}) => ({
  id: ORDER,
  number: 'R-000001',
  orderType: 'dine_in',
  tableId: 't1',
  tableCode: 'T1',
  label: null,
  guests: 2,
  openedAt: '2026-10-12T06:00:00.000Z',
  itemCount: items.length,
  due: money(items.length ? '4.000' : '0.000'),
  pending: items.length,
  inKitchen: 0,
  ready: 0,
  branchId: BRANCH,
  note: null,
  status: 'open',
  openedBy: 'Cashier',
  closedAt: null,
  items,
  bills: [],
  paid: money('0.000'),
  version: 2,
  ...overrides,
});

describe('restaurant POS', () => {
  it('requires the mandatory modifier, adds the item, and bills the selected items', async () => {
    let current = order([]);
    const fetch = fakeApiFetch({
      session: makeSession('pos', [
        'pos.access',
        'shifts.operate',
        'sales.create',
        'restaurant.orders',
      ]),
      routes: {
        'GET /pos/shifts/current': () => ({ status: 200, body: { shift: SHIFT } }),
        'GET /pos/restaurant/settings': () => ({
          status: 200,
          body: { enabled: true, autoSendOnPayment: true, version: 1 },
        }),
        'GET /pos/catalog': () => ({
          status: 200,
          body: {
            branchId: BRANCH,
            categories: [],
            items: [
              {
                variantId: BURGER,
                productId: 'p1',
                categoryId: null,
                nameEn: 'Burger',
                nameAr: null,
                variantNameEn: null,
                variantNameAr: null,
                sku: 'BRG',
                barcodes: [],
                price: money('2.000'),
                trackInventory: false,
                imageUrl: null,
              },
            ],
            version: 'v1',
          },
        }),
        'GET /pos/restaurant/menu': () => ({
          status: 200,
          body: { groups: [group], productGroups: { p1: [group.id] } },
        }),
        [`GET /pos/restaurant/orders/${ORDER}`]: () => ({ status: 200, body: current }),
        [`POST /pos/restaurant/orders/${ORDER}/items`]: () => {
          current = order([item()]);
          return { status: 201, body: current };
        },
        [`POST /pos/restaurant/orders/${ORDER}/quote`]: () => ({
          status: 200,
          body: { subtotal: money('4.000'), discounts: money('0.000'), total: money('4.000') },
        }),
      },
    });
    renderApp({ routes, appInterface: 'pos', i18n, fetch, path: `/tables/orders/${ORDER}` });
    await userEvent.click(await screen.findByTestId('menu-tile'));
    let dialog = await screen.findByRole('dialog');
    const add = within(dialog).getByRole('button', { name: /Add/ });
    expect(add).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Medium' }));
    await userEvent.clear(within(dialog).getByLabelText('Quantity'));
    await userEvent.type(within(dialog).getByLabelText('Quantity'), '2');
    expect(add).toBeEnabled();
    await userEvent.click(add);
    expect(await screen.findByTestId('order-item')).toHaveTextContent('Burger');
    const sent = fetch.calls.find((c) => c.method === 'POST' && c.path.endsWith('/items'))!;
    expect(sent.body).toEqual({
      version: 2,
      items: [
        { variantId: BURGER, quantity: '2', modifierIds: [group.modifiers[0]!.id], note: null },
      ],
    });
    expect(screen.getByTestId('order-due')).toHaveTextContent('KWD 4.000');

    await userEvent.click(screen.getByRole('button', { name: 'Pay bill' }));
    dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByTestId('bill-total')).toHaveTextContent('KWD 4.000');
    const quote = fetch.calls.find((c) => c.path.endsWith('/quote'))!;
    expect(quote.body).toEqual({ itemIds: [item().id] });
  });

  it('kitchen staff land on the kitchen display and move tickets forward', async () => {
    let status = 'new';
    const ticket = () => ({
      id: '0190a000-0000-7000-8000-00000000e001',
      orderId: ORDER,
      orderNumber: 'R-000001',
      orderType: 'dine_in',
      tableCode: 'T1',
      label: null,
      stationId: 's1',
      status,
      createdAt: new Date(Date.now() - 9.5 * 60_000).toISOString(),
      startedAt: null,
      readyAt: null,
      completedAt: null,
      items: [
        {
          id: 'i1',
          nameEn: 'Burger',
          nameAr: null,
          variantNameEn: null,
          variantNameAr: null,
          quantity: '2.000',
          note: 'no onions',
          modifiers: [{ nameEn: 'Medium', nameAr: null }],
          kitchenStatus: 'queued',
        },
      ],
      version: 1,
    });
    const fetch = fakeApiFetch({
      session: makeSession('pos', ['pos.access', 'kitchen.access']),
      routes: {
        'GET /pos/restaurant/settings': () => ({
          status: 200,
          body: { enabled: true, autoSendOnPayment: true, version: 1 },
        }),
        'GET /pos/kitchen/tickets': () => ({
          status: 200,
          body: { stations: [{ id: 's1', nameEn: 'Kitchen', nameAr: null }], tickets: [ticket()] },
        }),
        'POST /pos/kitchen/tickets/0190a000-0000-7000-8000-00000000e001/status': () => {
          status = 'preparing';
          return { status: 200, body: ticket() };
        },
      },
    });
    renderApp({ routes, appInterface: 'pos', i18n, fetch });
    const card = await screen.findByTestId('kitchen-ticket');
    expect(card).toHaveTextContent('T1');
    expect(card).toHaveTextContent('no onions');
    expect(card).toHaveTextContent('Medium');
    expect(card).toHaveTextContent('9 min');
    expect(
      within(screen.getByRole('region', { name: 'New' })).getByTestId('kitchen-ticket'),
    ).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Start' }));
    await vi.waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Preparing' })).getByTestId('kitchen-ticket'),
      ).toBeInTheDocument(),
    );
    const call = fetch.calls.find((c) => c.path.endsWith('/status'))!;
    expect(call.body).toEqual({ status: 'preparing', version: 1 });
  });
});
