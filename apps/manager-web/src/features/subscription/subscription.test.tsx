import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { i18n } from '../../i18n/index.js';
import { routes } from '../../routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const plan = {
  id: 'p1',
  code: 'basic',
  nameEn: 'Basic',
  nameAr: 'الأساسية',
  descriptionEn: 'One branch, a small team.',
  descriptionAr: null,
  status: 'active',
  isDefault: false,
  isPublic: true,
  limits: { branches: 1, employees: 3, products: 200, registers: 1 },
  features: [],
  price: { amount: '9.500', currency: 'KWD' },
  billingPeriod: 'month',
  trialDays: 0,
  sortOrder: 20,
  version: 1,
};

describe('subscription page', () => {
  it('shows the own plan, usage against limits and missing features', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'merchant.settings.read']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: { branches: [] } }),
        'GET /manager/subscription': () => ({
          status: 200,
          body: {
            id: 's1',
            plan,
            status: 'past_due',
            effectiveStatus: 'past_due',
            startsAt: '2026-10-01T08:00:00.000Z',
            endsAt: null,
            trialEndsAt: null,
            usage: {
              branches: { used: 1, max: 1 },
              employees: { used: 2, max: 3 },
              products: { used: 12, max: 200 },
              registers: { used: 1, max: 1 },
            },
            version: 2,
            availablePlans: [plan],
          },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/subscription', fetch });
    expect(await screen.findByTestId('subscription-status')).toHaveTextContent('Past due');
    expect(screen.getByText(/needs attention/)).toBeInTheDocument();
    expect(screen.getByTestId('usage-branches')).toHaveTextContent('1 / 1');
    expect(screen.getByTestId('usage-employees')).toHaveTextContent('2 / 3');
    expect(screen.getAllByText('Restaurant — not included').length).toBeGreaterThan(0);
    expect(screen.getByText('9.500 KWD / month')).toBeInTheDocument();
    expect(screen.getByText('Your plan')).toBeInTheDocument();
  });

  it('is not available without the settings permission', async () => {
    renderApp({
      routes,
      appInterface: 'manager',
      i18n,
      path: '/subscription',
      fetch: fakeApiFetch({ session: makeSession('manager', ['manager.access']) }),
    });
    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
  });
});
