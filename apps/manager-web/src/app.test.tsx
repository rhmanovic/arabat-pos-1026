import { flattenKeys } from '@arabat/i18n';
import { fakeApiFetch, makeSession, problem, renderApp } from '@arabat/web-core/testing';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n, resources } from './i18n/index.js';
import { routes } from './routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('manager app', () => {
  it('shows the manager sign-in page to anonymous users', async () => {
    const { router } = renderApp({ routes, appInterface: 'manager', i18n, path: '/' });
    expect(
      await screen.findByRole('heading', { name: 'Sign in to management' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(await screen.findByText('Server connected')).toBeInTheDocument();
  });

  it('shows a non-revealing error for wrong credentials', async () => {
    const fetch = fakeApiFetch({
      routes: { 'POST /auth/login': () => problem(401, 'INVALID_CREDENTIALS') },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/login', fetch });
    await userEvent.type(await screen.findByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever-123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('The e-mail or password is incorrect.')).toBeInTheDocument();
    expect(fetch.calls.find((c) => c.path === '/auth/login')?.body).toEqual({
      interface: 'manager',
      email: 'a@b.co',
      password: 'whatever-123',
    });
  });

  it('sends a cashier who signs in here to the POS', async () => {
    const fetch = fakeApiFetch({
      routes: {
        'POST /auth/login': () =>
          problem(403, 'INTERFACE_NOT_PERMITTED', { availableInterfaces: ['pos'] }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/login', fetch });
    await userEvent.type(await screen.findByLabelText('Email'), 'cashier@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever-123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('link', { name: 'Open Point of Sale' })).toHaveAttribute(
      'href',
      '/pos/',
    );
  });

  it('lets a user pick a company when they belong to several', async () => {
    const merchants = [
      { id: '00000000-0000-7000-8000-0000000000a1', nameEn: 'Alpha', nameAr: null, branches: [] },
      { id: '00000000-0000-7000-8000-0000000000b2', nameEn: 'Beta', nameAr: null, branches: [] },
    ];
    let selected: unknown;
    const fetch = fakeApiFetch({
      routes: {
        'POST /auth/login': () => ({
          status: 200,
          body: { status: 'select_merchant', ticket: 't'.repeat(43), merchants },
        }),
        'POST /auth/login/select': (body) => {
          selected = body;
          return {
            status: 200,
            body: { status: 'authenticated', interface: 'manager', redirectTo: '/manager/' },
          };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/login', fetch });
    await userEvent.type(await screen.findByLabelText('Email'), 'multi@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'whatever-123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Beta' }));
    await vi.waitFor(() =>
      expect(selected).toEqual({ ticket: 't'.repeat(43), merchantId: merchants[1]!.id }),
    );
  });

  it('validates the registration form before calling the API', async () => {
    const fetch = fakeApiFetch();
    renderApp({ routes, appInterface: 'manager', i18n, path: '/register', fetch });
    await userEvent.type(await screen.findByLabelText('Company name'), 'Gulf Co');
    await userEvent.type(screen.getByLabelText('Full name'), 'Owner Name');
    await userEvent.type(screen.getByLabelText('Email'), 'owner@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(fetch.calls.some((c) => c.path === '/auth/register')).toBe(false);
  });

  it('renders the manager layout with its own navigation for a manager session', async () => {
    renderApp({
      routes,
      appInterface: 'manager',
      i18n,
      fetch: fakeApiFetch({ session: makeSession('manager', ['manager.access']) }),
    });
    const nav = await screen.findByRole('navigation', { name: 'Manager navigation' });
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome, Test User' })).toBeInTheDocument();
    // Navigation is role-aware: no employee or branch administration without the permission.
    expect(within(nav).queryByRole('link', { name: 'Employees' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Branches' })).not.toBeInTheDocument();
  });

  it('shows administration links for permitted users and unfinished modules as unavailable', async () => {
    const permissions = [
      'manager.access',
      'employees.read',
      'branches.read',
      'merchant.settings.read',
      'catalog.read',
      'sales.read',
      'inventory.read',
      'shifts.view_all',
      'registers.manage',
      'payments.settings',
      'customers.read',
      'reports.sales',
    ];
    const fetch = fakeApiFetch({
      session: makeSession('manager', permissions),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: { branches: [] } }),
        'GET /manager/employees': () => ({ status: 200, body: { employees: [], invitations: [] } }),
        'GET /manager/roles': () => ({ status: 200, body: { roles: [], grantable: [] } }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, fetch });
    const nav = await screen.findByRole('navigation', { name: 'Manager navigation' });
    for (const name of [
      'Employees',
      'Roles & permissions',
      'Branches',
      'Settings',
      'Products',
      'Categories',
      'Inventory',
      'Shifts',
      'Registers',
      'Payment methods',
      'Customers',
    ]) {
      expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
    }
    expect(within(nav).getByRole('link', { name: 'Sales' })).toBeInTheDocument();
    // Unfinished modules (reports) are visible but not links.
    expect(within(nav).queryByRole('link', { name: /Reports/ })).not.toBeInTheDocument();
    expect(within(nav).getByText('Reports').closest('[aria-disabled="true"]')).not.toBeNull();
  });

  it('denies a management page without its permission even when typed in the address bar', async () => {
    renderApp({
      routes,
      appInterface: 'manager',
      i18n,
      path: '/employees',
      fetch: fakeApiFetch({ session: makeSession('manager', ['manager.access']) }),
    });
    expect(
      await screen.findByText('You do not have permission to view this page.'),
    ).toBeInTheDocument();
  });

  it('switches the layout to RTL for Arabic', async () => {
    await i18n.changeLanguage('ar');
    renderApp({ routes, appInterface: 'manager', i18n, path: '/login' });
    expect(
      await screen.findByRole('heading', { name: 'تسجيل الدخول إلى الإدارة' }),
    ).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('defines the same translation keys in Arabic and English', () => {
    expect(flattenKeys(resources.ar).sort()).toEqual(flattenKeys(resources.en).sort());
  });
});
