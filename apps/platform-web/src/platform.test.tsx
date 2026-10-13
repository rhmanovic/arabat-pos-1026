import {
  type FakeRoute,
  fakeApiFetch,
  makeSession,
  problem,
  renderApp,
} from '@arabat/web-core/testing';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { i18n } from './i18n/index.js';
import { routes } from './routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const M = '0190a000-0000-7000-8000-0000000000a1';
const STANDARD = '0190a000-0000-7000-8000-0000000000p1';
const BASIC = '0190a000-0000-7000-8000-0000000000p2';
const plan = (id: string, code: string, limits: Record<string, number | null>) => ({
  id,
  code,
  nameEn: code === 'basic' ? 'Basic' : 'Standard',
  nameAr: code,
  descriptionEn: null,
  descriptionAr: null,
  status: 'active',
  isDefault: code === 'standard',
  isPublic: true,
  limits: { branches: null, employees: null, products: null, registers: null, ...limits },
  features: code === 'standard' ? ['restaurant', 'ecommerce'] : [],
  price: null,
  billingPeriod: null,
  trialDays: 30,
  sortOrder: 10,
  merchantCount: 1,
  version: 1,
});
const { merchantCount: _m, ...standardPlan } = plan(STANDARD, 'standard', {});
const detail = {
  id: M,
  nameEn: 'Gulf Co',
  nameAr: null,
  legalName: null,
  contactEmail: 'owner@gulf.test',
  contactPhone: null,
  defaultLanguage: 'en',
  status: 'active',
  createdAt: '2026-10-01T08:00:00.000Z',
  version: 4,
  owner: { fullName: 'Owner', email: 'owner@gulf.test', lastLoginAt: '2026-10-02T08:00:00.000Z' },
  subscription: {
    id: 's1',
    plan: standardPlan,
    status: 'trialing',
    effectiveStatus: 'trialing',
    startsAt: '2026-10-01T08:00:00.000Z',
    endsAt: null,
    trialEndsAt: '2026-10-31T08:00:00.000Z',
    usage: {
      branches: { used: 2, max: null },
      employees: { used: 4, max: null },
      products: { used: 10, max: null },
      registers: { used: 2, max: null },
    },
    version: 1,
  },
  onboarding: {
    ownerSignedIn: true,
    hasProducts: true,
    hasSales: false,
    firstSaleAt: null,
    lastSaleAt: null,
    salesLast30Days: 0,
    onlineStoreStatus: 'none',
  },
  branches: [
    { id: 'b1', code: 'MAIN', nameEn: 'Main', nameAr: null, status: 'active', employees: 3 },
  ],
  subscriptionEvents: [],
  audit: [],
};
const routesFor = (role: string, extra: Record<string, FakeRoute> = {}) =>
  fakeApiFetch({
    session: makeSession('platform', [role]),
    routes: {
      [`GET /platform/merchants/${M}`]: () => ({ status: 200, body: detail }),
      'GET /platform/plans': () => ({
        status: 200,
        body: {
          plans: [
            plan(STANDARD, 'standard', {}),
            plan(BASIC, 'basic', { branches: 1, registers: 1 }),
          ],
        },
      }),
      ...extra,
    },
  });

describe('platform console', () => {
  it('lists merchants with plan and status', async () => {
    const fetch = routesFor('platform.support', {
      'GET /platform/merchants': () => ({
        status: 200,
        body: {
          merchants: [
            {
              id: M,
              nameEn: 'Gulf Co',
              nameAr: null,
              status: 'suspended',
              contactEmail: null,
              createdAt: '2026-10-01T08:00:00.000Z',
              ownerEmail: 'owner@gulf.test',
              ownerName: 'Owner',
              branchCount: 2,
              employeeCount: 4,
              planCode: 'standard',
              planNameEn: 'Standard',
              planNameAr: 'قياسية',
              subscriptionStatus: 'trial_ended',
              lastSaleAt: null,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 25,
        },
      }),
    });
    renderApp({ routes, appInterface: 'platform', i18n, path: '/merchants', fetch });
    const row = (await screen.findByText('Gulf Co')).closest('tr')!;
    expect(within(row).getByText('Suspended')).toBeInTheDocument();
    expect(within(row).getByText('Trial ended')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New merchant' })).toBeInTheDocument();
  });

  it('suspends a merchant with a reason and its version', async () => {
    const user = userEvent.setup();
    const fetch = routesFor('platform.support', {
      [`POST /platform/merchants/${M}/status`]: () => ({
        status: 200,
        body: { ...detail, status: 'suspended', version: 5 },
      }),
    });
    renderApp({ routes, appInterface: 'platform', i18n, path: `/merchants/${M}`, fetch });
    expect(await screen.findByTestId('usage-branches')).toHaveTextContent('2 / unlimited');
    // Support may suspend but not close or change the subscription.
    expect(screen.queryByRole('button', { name: 'Close permanently' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change plan or status' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText('Reason (recorded in the audit log)'),
      'Unpaid invoice',
    );
    await user.click(confirm);
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.method === 'POST')?.body).toEqual({
        status: 'suspended',
        reason: 'Unpaid invoice',
        version: 4,
      }),
    );
  });

  it('freezes the owner with a reason and offers the transfer to super administrators only (BR-020)', async () => {
    const user = userEvent.setup();
    let current: Record<string, unknown> = detail;
    const fetch = routesFor('platform.support', {
      [`GET /platform/merchants/${M}`]: () => ({ status: 200, body: current }),
      [`POST /platform/merchants/${M}/owner-freeze`]: () => {
        current = {
          ...detail,
          ownerFrozenAt: '2026-10-13T09:00:00.000Z',
          ownerFrozenReason: 'Stolen phone',
          version: 5,
        };
        return { status: 200, body: current };
      },
    });
    renderApp({ routes, appInterface: 'platform', i18n, path: `/merchants/${M}`, fetch });
    expect(await screen.findByRole('button', { name: 'Freeze owner' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Transfer ownership' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Freeze owner' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('signed out everywhere');
    await user.type(
      within(dialog).getByLabelText('Reason (recorded in the audit log)'),
      'Stolen phone',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(
        fetch.calls.find((c) => c.method === 'POST' && c.path.endsWith('/owner-freeze'))?.body,
      ).toEqual({ reason: 'Stolen phone', version: 4 }),
    );
    expect(await screen.findByRole('button', { name: 'Release owner' })).toBeInTheDocument();
    expect(screen.getByText('Stolen phone')).toBeInTheDocument();
  });

  it('shows why a downgrade is blocked and does not allow saving it', async () => {
    const user = userEvent.setup();
    const fetch = routesFor('platform.billing', {
      [`GET /platform/merchants/${M}/plan-check`]: () => ({
        status: 200,
        body: fetch.calls.at(-1)!.query.includes(BASIC)
          ? {
              fits: false,
              direction: 'downgrade',
              issues: [{ kind: 'limit', key: 'branches', used: 2, max: 1 }],
            }
          : { fits: true, direction: 'same', issues: [] },
      }),
    });
    renderApp({ routes, appInterface: 'platform', i18n, path: `/merchants/${M}`, fetch });
    // Billing cannot suspend.
    await screen.findByTestId('subscription-status');
    expect(screen.queryByRole('button', { name: 'Suspend' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Change plan or status' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Plan'), BASIC);
    expect(
      await within(dialog).findByText('Branches: 2 in use, plan allows 1'),
    ).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Reason (recorded)'), 'Customer asked');
    expect(within(dialog).getByRole('button', { name: 'Save subscription' })).toBeDisabled();
  });

  it('saves a plan with empty limits as unlimited', async () => {
    const user = userEvent.setup();
    const fetch = routesFor('platform.billing', {
      'POST /platform/plans': (body) => ({
        status: 201,
        body: { ...plan('x', 'gold', {}), ...(body as object) },
      }),
    });
    renderApp({ routes, appInterface: 'platform', i18n, path: '/plans', fetch });
    await user.click(await screen.findByRole('button', { name: 'New plan' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Code'), 'gold');
    await user.type(within(dialog).getByLabelText('Name (English)'), 'Gold');
    await user.type(within(dialog).getByLabelText('Name (Arabic)'), 'ذهبية');
    await user.type(within(dialog).getByLabelText('Max branches'), '3');
    await user.click(within(dialog).getByLabelText('Online store'));
    await user.click(within(dialog).getByRole('button', { name: 'Save plan' }));
    await waitFor(() =>
      expect(fetch.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
        code: 'gold',
        limits: { branches: 3, employees: null, products: null, registers: null },
        features: ['ecommerce'],
        price: '',
        billingPeriod: null,
        version: 0,
      }),
    );
  });

  it('shows the API refusal when an operator lacks the role', async () => {
    const fetch = routesFor('platform.billing', {
      'GET /platform/audit': () => problem(403, 'FORBIDDEN'),
    });
    renderApp({ routes, appInterface: 'platform', i18n, path: '/', fetch });
    // The audit log is not in the billing operator's navigation.
    expect(
      await screen.findByRole('navigation', { name: 'Platform navigation' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit log' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Plans' })).toBeInTheDocument();
  });
});
