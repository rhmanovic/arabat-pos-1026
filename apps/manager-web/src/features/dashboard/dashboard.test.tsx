import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { i18n } from '../../i18n/index.js';
import { routes } from '../../routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const plan = (features: string[]) => ({
  id: 'p1',
  code: 'shop',
  nameEn: 'Shop',
  nameAr: 'المحل',
  descriptionEn: null,
  descriptionAr: null,
  status: 'active',
  isDefault: true,
  isPublic: true,
  limits: { branches: 1, employees: 3, products: 200, registers: 1 },
  features,
  price: { amount: '9.500', currency: 'KWD' },
  billingPeriod: 'month',
  trialDays: 14,
  sortOrder: 10,
  version: 1,
});

const subscription = (features: string[], extra: Record<string, unknown> = {}) => ({
  id: 's1',
  plan: plan(features),
  status: 'trialing',
  effectiveStatus: 'trialing',
  startsAt: '2026-10-01T08:00:00.000Z',
  endsAt: null,
  trialEndsAt: '2026-10-15T08:00:00.000Z',
  usage: {
    branches: { used: 1, max: 1 },
    employees: { used: 1, max: 3 },
    products: { used: 0, max: 200 },
    registers: { used: 1, max: 1 },
  },
  version: 1,
  availablePlans: [],
  ...extra,
});

describe('dashboard "your apps" card', () => {
  it('shows every product with its state read from the plan', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', [
        'manager.access',
        'merchant.settings.read',
        'online.manage',
        'registers.manage',
      ]),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: { branches: [] } }),
        'GET /manager/subscription': () => ({ status: 200, body: subscription(['ecommerce']) }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/', fetch });
    const card = await screen.findByTestId('dashboard-apps');
    expect(within(card).getByTestId('apps-plan')).toHaveTextContent('Shop');
    expect(within(card).getByText('Trial')).toBeInTheDocument();
    expect(within(card).getByText('4 of 6 active')).toBeInTheDocument();
    expect(within(card).getByText(/Trial ends/)).toBeInTheDocument();

    const state = (key: string) => within(card).getByTestId(`app-${key}`).dataset.state;
    expect(state('manager')).toBe('included');
    expect(state('pos')).toBe('included');
    expect(state('links')).toBe('included');
    expect(state('online')).toBe('included');
    expect(state('restaurant')).toBe('notIncluded');
    expect(state('website')).toBe('soon');

    // The link page and the online store console are separate applications (ADR-0119).
    expect(within(card).getByRole('link', { name: /Link page/ })).toHaveAttribute(
      'href',
      expect.stringMatching(/\/links\/$/),
    );
    expect(within(card).getByRole('link', { name: /Online store/ })).toHaveAttribute(
      'href',
      expect.stringMatching(/\/online\/$/),
    );
    // A product the plan lacks leads to the subscription page.
    expect(within(card).getByRole('link', { name: /Restaurant/ })).toHaveAttribute(
      'href',
      '/subscription',
    );
    expect(within(card).getByText('Coming soon')).toBeInTheDocument();
  });

  it('is not shown without the settings permission', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'branches.read']),
      routes: { 'GET /manager/branches': () => ({ status: 200, body: { branches: [] } }) },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/', fetch });
    await screen.findByText(/Welcome/);
    expect(screen.queryByTestId('dashboard-apps')).not.toBeInTheDocument();
  });
});
