import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { i18n } from '../../i18n/index.js';
import { routes } from '../../routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const ID = '0190a000-0000-7000-8000-0000000000e1';
const money = (amount: string) => ({ amount, currency: 'KWD' });
const customer = {
  id: ID,
  code: 'C-000003',
  fullName: 'Khalid Al-Mutairi',
  phone: '+96555551234',
  email: null,
  address: null,
  preferredLanguage: 'ar',
  status: 'active',
  createdBy: 'Owner',
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
  stats: {
    salesCount: 3,
    salesTotal: money('2.000'),
    refundsCount: 1,
    refundedTotal: money('0.250'),
    netTotal: money('1.750'),
    averageSale: money('0.667'),
    firstPurchaseAt: '2026-10-02T08:00:00.000Z',
    lastPurchaseAt: '2026-10-11T08:00:00.000Z',
  },
  version: 1,
};

describe('customer detail', () => {
  it('shows exact spending, purchases and refunds, and adds a note', async () => {
    let notes = [
      {
        id: 'n1',
        body: 'Prefers delivery',
        author: 'Owner',
        createdAt: '2026-10-03T08:00:00.000Z',
      },
    ];
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'customers.read', 'customers.manage']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: { branches: [] } }),
        [`GET /manager/customers/${ID}`]: () => ({ status: 200, body: customer }),
        [`GET /manager/customers/${ID}/sales`]: () => ({
          status: 200,
          body: {
            sales: [
              {
                id: 's1',
                receiptNumber: 'MAIN-000010',
                branchId: 'b',
                cashierName: 'Rana',
                createdAt: '2026-10-11T08:00:00.000Z',
                total: money('0.750'),
                itemCount: '3',
                paymentKinds: ['cash'],
                refunded: money('0.250'),
                customerName: 'Khalid Al-Mutairi',
              },
            ],
            total: 3,
            page: 1,
            pageSize: 10,
            totals: {
              count: 3,
              amount: money('2.000'),
              refunded: money('0.250'),
              net: money('1.750'),
            },
          },
        }),
        [`GET /manager/customers/${ID}/refunds`]: () => ({
          status: 200,
          body: {
            refunds: [
              {
                id: 'r1',
                refundNumber: 'MAIN-000010-R1',
                saleId: 's1',
                receiptNumber: 'MAIN-000010',
                branchId: 'b',
                kind: 'refund',
                status: 'completed',
                total: money('0.250'),
                createdAt: '2026-10-11T09:00:00.000Z',
              },
            ],
          },
        }),
        [`GET /manager/customers/${ID}/notes`]: () => ({ status: 200, body: { notes } }),
        [`POST /manager/customers/${ID}/notes`]: (body) => {
          notes = [
            {
              id: 'n2',
              body: (body as { body: string }).body,
              author: 'Test User',
              createdAt: '2026-10-12T08:00:00.000Z',
            },
            ...notes,
          ];
          return { status: 201, body: { notes } };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: `/customers/${ID}`, fetch });
    expect(await screen.findByRole('heading', { name: 'Khalid Al-Mutairi' })).toBeInTheDocument();
    const stats = screen.getByTestId('customer-stats');
    expect(stats).toHaveTextContent('KWD 2.000');
    expect(stats).toHaveTextContent('KWD 0.250');
    expect(stats).toHaveTextContent('KWD 1.750');
    expect(stats).toHaveTextContent('KWD 0.667');
    expect(await screen.findByText('MAIN-000010')).toBeInTheDocument();
    expect(screen.getByText('MAIN-000010-R1')).toBeInTheDocument();
    expect(screen.getByText('3 purchases')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('New note'), 'Birthday in March');
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByText('Note added')).toBeInTheDocument();
    const list = screen.getAllByTestId('customer-note');
    expect(within(list[0]!).getByText('Birthday in March')).toBeInTheDocument();
    expect(list).toHaveLength(2);
  });

  it('hides editing and notes input from read-only users', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'customers.read']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: { branches: [] } }),
        [`GET /manager/customers/${ID}`]: () => ({ status: 200, body: customer }),
        [`GET /manager/customers/${ID}/sales`]: () => ({
          status: 200,
          body: {
            sales: [],
            total: 0,
            page: 1,
            pageSize: 10,
            totals: { count: 0, amount: money('0'), refunded: money('0'), net: money('0') },
          },
        }),
        [`GET /manager/customers/${ID}/refunds`]: () => ({ status: 200, body: { refunds: [] } }),
        [`GET /manager/customers/${ID}/notes`]: () => ({ status: 200, body: { notes: [] } }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: `/customers/${ID}`, fetch });
    await screen.findByRole('heading', { name: 'Khalid Al-Mutairi' });
    expect(screen.queryByRole('button', { name: 'Edit customer' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New note')).not.toBeInTheDocument();
    expect(await screen.findByText('No notes yet.')).toBeInTheDocument();
  });
});
