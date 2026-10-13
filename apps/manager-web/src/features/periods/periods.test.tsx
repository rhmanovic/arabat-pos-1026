import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n/index.js';
import { routes } from '../../routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const money = (amount: string) => ({ amount, currency: 'KWD' });
const BRANCH = '0190a000-0000-7000-8000-000000000001';
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
    },
  ],
};
const summary = (period: string, status: string, closed = false) => ({
  period,
  from: `${period}-01`,
  to: `${period}-30`,
  status,
  closedAt: closed ? '2026-10-01T06:00:00.000Z' : null,
  closedBy: closed ? 'Owner Test' : null,
  note: closed ? 'books agreed' : null,
});
const pack = (period: string, status: string) => ({
  ...summary(period, status, status === 'closed'),
  timezone: 'Asia/Kuwait',
  computedAt: '2026-10-13T08:00:00.000Z',
  sales: {
    saleCount: 12,
    gross: money('150.000'),
    discounts: money('5.000'),
    netSales: money('145.000'),
    refundCount: 1,
    refunds: money('5.000'),
    netAfterRefunds: money('140.000'),
  },
  profit: {
    available: true,
    costOfSales: money('80.000'),
    grossProfit: money('60.000'),
    marginPercent: '42.9',
    uncostedSales: money('0.000'),
  },
  collections: [
    {
      kind: 'cash',
      methodId: null,
      nameEn: null,
      nameAr: null,
      collected: money('100.000'),
      fees: money('0.000'),
      feesReversed: money('0.000'),
      refunded: money('5.000'),
      net: money('95.000'),
    },
    {
      kind: 'card',
      methodId: 'm1',
      nameEn: 'KNET',
      nameAr: 'كي نت',
      collected: money('45.000'),
      fees: money('0.450'),
      feesReversed: money('0.000'),
      refunded: money('0.000'),
      net: money('45.000'),
    },
  ],
  collectionTotals: {
    collected: money('145.000'),
    fees: money('0.450'),
    feesReversed: money('0.000'),
    refunded: money('5.000'),
    netAfterFees: money('139.550'),
  },
  unreferencedTenders: { count: 1, amount: money('10.000') },
  cash: {
    places: [
      {
        accountId: 'a1',
        kind: 'treasury',
        branchId: BRANCH,
        nameEn: 'Treasury',
        nameAr: 'الخزينة',
        balance: money('70.000'),
      },
    ],
    treasuriesTotal: money('70.000'),
    registersTotal: money('0.000'),
    inTransitTotal: money('0.000'),
    depositsInTransitTotal: money('20.000'),
    total: money('70.000'),
  },
  stock: {
    closingQuantity: '340.000',
    closingValue: money('512.250'),
    unvaluedItems: 0,
    inTransit: { transfers: 1, quantity: '5.000', value: money('2.000') },
  },
  refundsOwed: { count: 1, amount: money('3.000') },
  open: {
    variances: 2,
    transfersInTransit: 1,
    pendingRefunds: 1,
    pendingAdjustments: 0,
    pendingPayoutRequests: 0,
    pendingCashMovements: 0,
    pendingTransferLosses: 0,
    heldSales: 3,
  },
  suppliers: { received: money('400.000'), paid: money('250.000'), balance: money('150.000') },
  documents: { sales: 12, refunds: 1, receipts: 2, disbursements: 4, purchaseOrders: 2 },
});

describe('period close (BR-189)', () => {
  it('lists the months, shows the pack of the selected one and closes a ready month with a note', async () => {
    let closed = false;
    const fetch = fakeApiFetch({
      session: makeSession('manager', [
        'manager.access',
        'reports.financial',
        'periods.close',
        'branches.read',
      ]),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        'GET /manager/periods': () => ({
          status: 200,
          body: {
            timezone: 'Asia/Kuwait',
            periods: [
              summary('2026-10', 'current'),
              summary('2026-09', closed ? 'closed' : 'closable', closed),
              summary('2026-08', 'closed', true),
            ],
          },
        }),
        'GET /manager/periods/2026-09': () => ({
          status: 200,
          body: pack('2026-09', closed ? 'closed' : 'closable'),
        }),
        'GET /manager/periods/2026-08': () => ({ status: 200, body: pack('2026-08', 'closed') }),
        'POST /manager/periods/2026-09/close': () => {
          closed = true;
          return { status: 201, body: pack('2026-09', 'closed') };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/periods', fetch });
    expect(await screen.findByRole('heading', { name: 'Period close' })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Period close' });
    expect(within(table).getByText('Ready to close')).toBeInTheDocument();
    expect(within(table).getAllByText('Closed')).toHaveLength(1);
    expect(within(table).getByText('books agreed')).toBeInTheDocument();
    // The first month that is not the current one is shown by default.
    const packView = await screen.findByTestId('period-pack');
    expect(packView).toHaveTextContent('Month-end pack 2026-09');
    expect(packView).toHaveTextContent('Open month: figures as of');
    expect(packView).toHaveTextContent('KWD 140.000');
    expect(packView).toHaveTextContent('Margin: 42.9%');
    expect(packView).toHaveTextContent('KWD 512.250');
    expect(packView).toHaveTextContent('1 card / transfer tender without a reference (KWD 10.000)');
    expect(
      within(packView).getByRole('table', { name: 'Collections by tender' }),
    ).toHaveTextContent('KNET');
    expect(within(packView).getByTestId('period-open-items')).toHaveTextContent(
      'Cash differences without follow-up2',
    );
    expect(packView).toHaveTextContent('Owed to suppliers (received − paid)KWD 150.000');
    // Closing asks for confirmation and takes a note.
    await userEvent.click(within(table).getByRole('button', { name: 'Close month' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Close 2026-09');
    expect(dialog).toHaveTextContent('cannot be undone');
    await userEvent.type(
      within(dialog).getByLabelText('Note (optional)'),
      'agreed with accountant',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close month' }));
    const call = await vi.waitFor(() => {
      const c = fetch.calls.find(
        (x) => x.method === 'POST' && x.path === '/manager/periods/2026-09/close',
      );
      if (!c) throw new Error('not yet');
      return c;
    });
    expect(call.body).toEqual({ note: 'agreed with accountant' });
    await vi.waitFor(() =>
      expect(
        within(screen.getByRole('table', { name: 'Period close' })).getAllByText('Closed'),
      ).toHaveLength(2),
    );
    expect(screen.queryByRole('button', { name: 'Close month' })).not.toBeInTheDocument();
  });

  it('hides the close button without periods.close', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'reports.financial']),
      routes: {
        'GET /manager/periods': () => ({
          status: 200,
          body: { timezone: 'Asia/Kuwait', periods: [summary('2026-09', 'closable')] },
        }),
        'GET /manager/periods/2026-09': () => ({ status: 200, body: pack('2026-09', 'closable') }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/periods', fetch });
    await screen.findByTestId('period-pack');
    expect(screen.queryByRole('button', { name: 'Close month' })).not.toBeInTheDocument();
  });
});
