import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n/index.js';
import { routes } from '../../routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const BRANCH = '0190a000-0000-7000-8000-000000000001';
const SALE = '0190a000-0000-7000-8000-000000000c01';
const money = (amount: string) => ({ amount, currency: 'KWD' });
const branches = {
  branches: [
    {
      id: BRANCH,
      code: 'MAIN',
      nameEn: 'Main',
      nameAr: 'الرئيسي',
      status: 'active',
      isMain: true,
      timezone: 'Asia/Kuwait',
      phone: null,
      address: null,
      receiptHeader: null,
      receiptFooter: null,
      version: 1,
      employeeCount: 1,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  ],
};
const summary = {
  id: SALE,
  receiptNumber: 'MAIN-000009',
  branchId: BRANCH,
  cashierName: 'Noor Cashier',
  createdAt: '2026-10-13T08:00:00.000Z',
  total: money('0.000'),
  itemCount: '1',
  paymentKinds: [],
  refunded: money('0.000'),
  customerName: null,
  serviceType: null,
  channel: 'pos',
  flags: ['zero_total', 'above_limit', 'supervised'],
};
const sale = {
  id: SALE,
  orderId: 'o',
  receiptNumber: 'MAIN-000009',
  branchId: BRANCH,
  registerId: 'r',
  shiftId: 's',
  cashierName: 'Noor Cashier',
  createdAt: '2026-10-13T08:00:00.000Z',
  subtotal: money('10.000'),
  lineDiscounts: money('10.000'),
  orderDiscount: money('0.000'),
  total: money('0.000'),
  paid: money('0.000'),
  change: money('0.000'),
  fees: money('0.000'),
  refunded: money('0.000'),
  customer: null,
  aboveLimit: true,
  discountLimitPercent: '10',
  zeroTotalReason: 'tester for the stand',
  override: {
    id: 'ov',
    approverName: 'Sara Supervisor',
    kinds: ['sales.discount.override_limit', 'sales.zero_total'],
    note: 'approved by phone with the owner',
  },
  lines: [
    {
      position: 0,
      variantId: 'v',
      productId: 'p',
      nameEn: 'Oud oil',
      nameAr: null,
      variantNameEn: null,
      variantNameAr: null,
      sku: 'OUD',
      quantity: '1.000',
      listUnitPrice: money('12.000'),
      unitPrice: money('10.000'),
      priceOverridden: true,
      priceOverrideReason: 'scratched box',
      gross: money('10.000'),
      discount: { type: 'percent', value: '100' },
      lineDiscount: money('10.000'),
      orderDiscount: money('0.000'),
      net: money('0.000'),
    },
  ],
  payments: [],
};

describe('sales history (session 8: unusual sales)', () => {
  it('filters unusual sales, shows their flags and the exceptions on the sale', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'sales.read']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        'GET /manager/sales': () => {
          // The call is recorded before the handler runs: read the filter from its query.
          const flag = new URLSearchParams(fetch.calls.at(-1)?.query ?? '').get('flag');
          const sales = flag === null || summary.flags.includes(flag) ? [summary] : [];
          return {
            status: 200,
            body: {
              sales,
              total: sales.length,
              page: 1,
              pageSize: 25,
              totals: {
                count: sales.length,
                amount: money('0.000'),
                refunded: money('0.000'),
                net: money('0.000'),
              },
            },
          };
        },
        [`GET /manager/sales/${SALE}`]: () => ({ status: 200, body: sale }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/sales', fetch });
    const row = await screen.findByRole('row', { name: /MAIN-000009/ });
    expect(within(row).getByTestId('sale-flags')).toHaveTextContent(
      'Free saleAbove discount limitSupervisor override',
    );
    await userEvent.selectOptions(screen.getByLabelText('Unusual sales'), 'price_override');
    expect(await screen.findByText('No sales found.')).toBeInTheDocument();
    const call = fetch.calls.findLast((c) => c.path === '/manager/sales')!;
    expect(call.query).toContain('flag=price_override');
    await userEvent.selectOptions(screen.getByLabelText('Unusual sales'), 'supervised');
    await userEvent.click(await screen.findByRole('row', { name: /MAIN-000009/ }));
    const box = await screen.findByTestId('sale-exceptions');
    expect(box).toHaveTextContent('A discount or price change above the 10 % limit was allowed.');
    expect(box).toHaveTextContent('Free sale: tester for the stand');
    expect(box).toHaveTextContent(
      'Authorised on the cashier’s till by Sara Supervisor (Apply discounts above the limit, Complete sales with nothing to pay (complimentary)) — approved by phone with the owner',
    );
    expect(screen.getByText('Price changed: scratched box')).toBeInTheDocument();
  });
});

describe('server-side receipt printing', () => {
  it.each([
    [true, 'Sent to the printer'],
    [false, 'No printer connected; the receipt prints when one connects'],
  ])(
    'sends the sale to the receipt printer from the sale page (agent online: %s)',
    async (agentOnline, message) => {
      const fetch = fakeApiFetch({
        session: makeSession('manager', ['manager.access', 'sales.read']),
        routes: {
          'GET /manager/branches': () => ({ status: 200, body: branches }),
          [`GET /manager/sales/${SALE}`]: () => ({ status: 200, body: sale }),
          [`POST /manager/sales/${SALE}/print`]: () => ({
            status: 201,
            body: {
              id: '0190a000-0000-7000-8000-000000000f01',
              status: 'pending',
              createdAt: '2026-10-16T08:00:00.000Z',
              copyNumber: 1,
              agentOnline,
            },
          }),
        },
      });
      const print = vi.spyOn(window, 'print').mockImplementation(() => {});
      renderApp({ routes, appInterface: 'manager', i18n, path: `/sales/${SALE}`, fetch });
      await userEvent.click(await screen.findByRole('button', { name: 'Print receipt' }));
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(
        fetch.calls.filter((c) => c.method === 'POST' && c.path === `/manager/sales/${SALE}/print`),
      ).toHaveLength(1);
      expect(print).not.toHaveBeenCalled();
      print.mockRestore();
    },
  );
});
