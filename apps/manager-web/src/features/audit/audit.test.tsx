import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n/index.js';
import { routes } from '../../routes.js';
import { summarizeDetails } from './AuditLogPage.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const entry = {
  id: '0190a000-0000-7000-8000-00000000e001',
  occurredAt: '2026-10-12T06:30:00.000Z',
  actorType: 'user',
  actorId: '0190a000-0000-7000-8000-000000000011',
  actorName: 'Noor Manager',
  action: 'sales.settings_updated',
  targetType: 'merchant',
  targetId: '0190a000-0000-7000-8000-000000000001',
  ip: '10.0.0.5',
  details: {
    blindCashCount: { from: true, to: false },
    maxDiscountPercent: { from: '10', to: '15' },
  },
};
const systemEntry = {
  ...entry,
  id: '0190a000-0000-7000-8000-00000000e002',
  actorType: 'system',
  actorId: null,
  actorName: null,
  action: 'online.order_expired',
  targetType: 'online_order',
  details: { reason: 'reservation expired' },
};

describe('merchant audit log (BR-163)', () => {
  it('summarises before/after details on one line', () => {
    expect(summarizeDetails(entry.details)).toBe(
      'blindCashCount: true → false · maxDiscountPercent: 10 → 15',
    );
    expect(summarizeDetails({ items: ['a', 'b'], note: null, amount: '1.000' })).toBe(
      'items: a, b · amount: 1.000',
    );
  });

  it('lists the company events with who, what and when, filters by action, and offers an export', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'audit.read']),
      routes: {
        'GET /manager/audit': () => ({
          status: 200,
          body: {
            entries: [entry, systemEntry],
            total: 2,
            page: 1,
            pageSize: 50,
            actions: ['online.order_expired', 'sales.settings_updated'],
          },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/audit', fetch });
    expect(await screen.findByRole('heading', { name: 'Audit log' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Audit log' })).toBeInTheDocument();
    expect(await screen.findByText('Noor Manager')).toBeInTheDocument();
    expect(screen.getAllByTestId('audit-action')[0]).toHaveTextContent('sales.settings_updated');
    expect(screen.getByText(/blindCashCount: true → false/)).toBeInTheDocument();
    expect(screen.getAllByText('System').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();

    await userEvent.type(screen.getByLabelText(/Filter by action/), 'refund');
    const filtered = await vi.waitFor(() => {
      const c = fetch.calls.find(
        (x) =>
          x.method === 'GET' && x.path === '/manager/audit' && x.query.includes('action=refund'),
      );
      if (!c) throw new Error('not yet');
      return c;
    });
    expect(filtered.query).toContain('action=refund');
  });

  it('hides the audit link from users without the right', async () => {
    renderApp({
      routes,
      appInterface: 'manager',
      i18n,
      path: '/',
      fetch: fakeApiFetch({ session: makeSession('manager', ['manager.access']) }),
    });
    const nav = await screen.findByRole('navigation', { name: 'Manager navigation' });
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
  });
});
