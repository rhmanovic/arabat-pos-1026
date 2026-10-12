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
