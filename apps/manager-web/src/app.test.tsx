import { flattenKeys } from '@arabat/i18n';
import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
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
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(await screen.findByText('Server connected')).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
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
