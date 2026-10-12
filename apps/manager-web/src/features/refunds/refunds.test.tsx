import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { i18n } from '../../i18n/index.js';
import { routes } from '../../routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const money = (amount: string) => ({ amount, currency: 'KWD' });
const refund = {
  id: '0190a000-0000-7000-8000-00000000e001',
  refundNumber: 'MAIN-000004-R1',
  saleId: '0190a000-0000-7000-8000-00000000e002',
  receiptNumber: 'MAIN-000004',
  branchId: '0190a000-0000-7000-8000-000000000001',
  kind: 'refund',
  status: 'pending_approval',
  reason: 'defective',
  note: null,
  total: money('25.000'),
  exchangeCredit: money('0.000'),
  exchangeSaleId: null,
  approvalReasons: ['over_limit'],
  requestedBy: 'Rana',
  decidedBy: null,
  decisionNote: null,
  createdAt: '2026-10-12T08:00:00.000Z',
  completedAt: null,
  version: 1,
};

describe('refunds review', () => {
  it('lists pending refunds and approves one with the reason shown', async () => {
    let status = 'pending_approval';
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'sales.read', 'refunds.approve']),
      routes: {
        'GET /manager/refunds': () => ({
          status: 200,
          body: { refunds: [{ ...refund, status }], total: 1, page: 1, pageSize: 25 },
        }),
        [`GET /manager/refunds/${refund.id}`]: () => ({
          status: 200,
          body: {
            ...refund,
            status,
            lines: [
              {
                position: 0,
                variantId: 'v',
                nameEn: 'Desk lamp',
                nameAr: null,
                quantity: '2.500',
                amount: money('25.000'),
                restock: true,
              },
            ],
            payments: [
              {
                id: 'p',
                kind: 'cash',
                nameEn: 'Cash',
                nameAr: null,
                amount: money('25.000'),
                status: 'pending',
                verification: 'manual',
                reference: null,
              },
            ],
          },
        }),
        [`POST /manager/refunds/${refund.id}/approve`]: () => {
          status = 'completed';
          return { status: 201, body: { ...refund, status, lines: [], payments: [] } };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/refunds', fetch });
    await userEvent.click(await screen.findByRole('button', { name: 'Waiting for approval' }));
    await userEvent.click(await screen.findByText('MAIN-000004-R1'));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Above the approval limit')).toBeInTheDocument();
    expect(within(dialog).getByText('Desk lamp', { exact: false })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Refund approved')).toBeInTheDocument();
    expect(fetch.calls.some((c) => c.method === 'POST' && c.path.endsWith('/approve'))).toBe(true);
  });
});
