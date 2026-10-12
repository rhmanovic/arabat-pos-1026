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
const method = {
  id: '0190a000-0000-7000-8000-000000000201',
  kind: 'card',
  nameEn: 'Card (KNET)',
  nameAr: null,
  status: 'active',
  availableInPos: true,
  availableOnline: false,
  feeType: 'fixed_plus_percentage',
  feeFixed: money('0.050'),
  feePercent: '1.5',
  financialAccountId: null,
  gatewayProvider: null,
  gatewayLive: false,
  sortOrder: 1,
  version: 1,
};

describe('payment methods', () => {
  it('lists fees and previews the exact fee before saving', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'payments.settings']),
      routes: {
        'GET /manager/payment-methods': () => ({ status: 200, body: { methods: [method] } }),
        'GET /manager/financial-accounts': () => ({ status: 200, body: { accounts: [] } }),
        'POST /manager/payment-methods': (body) => ({
          status: 201,
          body: { ...method, ...(body as object), id: 'new', feeFixed: money('0.000') },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/payments', fetch });
    expect(await screen.findByTestId('method-fee')).toHaveTextContent('KWD 0.050 + 1.5%');

    await userEvent.click(screen.getByRole('button', { name: 'New payment method' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name (English)'), 'Visa');
    await userEvent.selectOptions(within(dialog).getByLabelText('Processing fee'), 'percentage');
    const pct = within(dialog).getByLabelText('Percentage (%)');
    await userEvent.clear(pct);
    await userEvent.type(pct, '2.5');
    const amount = within(dialog).getByLabelText('Preview amount (KWD)');
    await userEvent.clear(amount);
    await userEvent.type(amount, '0.333');
    // 2.5 % of 0.333 = 0.008325 → 0.008 (half-up to the fils)
    expect(within(dialog).getByTestId('fee-preview')).toHaveTextContent(
      'On a payment of KWD 0.333 the fee is KWD 0.008; you receive KWD 0.325.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    const call = await vi.waitFor(() => {
      const c = fetch.calls.find(
        (x) => x.method === 'POST' && x.path === '/manager/payment-methods',
      );
      if (!c) throw new Error('not yet');
      return c;
    });
    expect(call.body).toMatchObject({
      kind: 'card',
      nameEn: 'Visa',
      feeType: 'percentage',
      feePercent: '2.5',
    });
  });
});

describe('failed loading', () => {
  const unauthenticated = {
    status: 401,
    body: {
      type: 'urn:arabat:error:unauthenticated',
      title: 'Authentication required',
      status: 401,
      code: 'UNAUTHENTICATED',
    },
  };

  it('shows an error in the table instead of an empty list', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'payments.settings']),
      routes: {
        'GET /manager/payment-methods': () => ({
          status: 500,
          body: { type: 'x', title: 'Internal', status: 500, code: 'INTERNAL_ERROR' },
        }),
        'GET /manager/financial-accounts': () => ({ status: 200, body: { accounts: [] } }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/payments', fetch });
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  });

  it('returns to sign-in when the session ended, instead of empty pages', async () => {
    let ended = false;
    const session = makeSession('manager', ['manager.access', 'payments.settings']);
    const fetch = fakeApiFetch({
      routes: {
        'GET /auth/manager/me': () => (ended ? unauthenticated : { status: 200, body: session }),
        'GET /manager/payment-methods': () => {
          ended = true;
          return unauthenticated;
        },
        'GET /manager/financial-accounts': () => unauthenticated,
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/payments', fetch });
    expect(
      await screen.findByRole('heading', { name: 'Sign in to management' }),
    ).toBeInTheDocument();
  });
});

describe('cash custody payouts', () => {
  const branchId = '0190a000-0000-7000-8000-000000000301';
  const overview = {
    branches: [
      {
        branchId,
        nameEn: 'Main',
        nameAr: null,
        treasury: {
          accountId: '0190a000-0000-7000-8000-000000000302',
          nameEn: 'Main treasury',
          nameAr: null,
          balance: money('40.000'),
          countedAt: '2026-10-12T08:00:00.000Z',
        },
        registers: [],
        total: money('40.000'),
      },
    ],
    treasuriesTotal: money('40.000'),
    registersTotal: money('0.000'),
    inTransitTotal: money('5.000'),
    total: money('45.000'),
  };

  it('pays an expense from the treasury with its category, and shows cash in transit', async () => {
    const posted: unknown[] = [];
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'cash.custody']),
      routes: {
        'GET /manager/cash/overview': () => ({ status: 200, body: overview }),
        'POST /manager/cash/disbursements': (body) => {
          posted.push(body);
          return { status: 201, body: {} };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/cash', fetch });
    expect(await screen.findByText('In transit')).toBeInTheDocument();
    // Without cash.deposit there is no deposit action.
    expect(screen.queryByRole('button', { name: 'Deposit to bank' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pay expense / supplier' }));
    const dialog = await screen.findByRole('dialog');
    const pay = within(dialog).getByRole('button', { name: 'Pay expense / supplier' });
    await userEvent.type(within(dialog).getByLabelText('Amount'), '2.750');
    expect(pay).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByLabelText('Expense category'), 'other');
    // "Other" needs a description.
    expect(pay).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Description'), 'Water bottles');
    await userEvent.click(pay);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      branchId,
      kind: 'expense',
      category: 'other',
      amount: '2.750',
      description: 'Water bottles',
    });
  });
});

describe('dashboard cash card', () => {
  it('shows the company’s cash on hand to cash custodians only', async () => {
    const overview = {
      branches: [],
      treasuriesTotal: money('30.000'),
      registersTotal: money('12.500'),
      inTransitTotal: money('5.000'),
      total: money('47.500'),
    };
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'cash.custody']),
      routes: { 'GET /manager/cash/overview': () => ({ status: 200, body: overview }) },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/', fetch });
    const card = await screen.findByTestId('dashboard-cash');
    expect(card).toHaveTextContent('KWD 47.500');
    expect(card).toHaveTextContent('In transit: KWD 5.000');
  });
});
