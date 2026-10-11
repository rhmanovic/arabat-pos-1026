import { createI18n } from '@arabat/i18n';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RouteObject } from 'react-router';
import { RedirectIfAuthenticated, RequireAuth, RequirePermission } from './guards.js';
import { fakeApiFetch, makeSession, renderApp } from './testing.js';

const i18n = createI18n({ namespace: 'test', resources: { ar: {}, en: {} }, language: 'en' });

const routes: RouteObject[] = [
  {
    path: '/login',
    element: (
      <RedirectIfAuthenticated>
        <p>login page</p>
      </RedirectIfAuthenticated>
    ),
  },
  {
    path: '/',
    element: <RequireAuth />,
    children: [
      { index: true, element: <p>protected home</p> },
      {
        path: 'roles',
        element: (
          <RequirePermission permission="roles.read">
            <p>roles page</p>
          </RequirePermission>
        ),
      },
    ],
  },
];

describe('protected routes', () => {
  it('redirects anonymous users to the login page and never renders protected content', async () => {
    const { router } = renderApp({ routes, appInterface: 'manager', i18n, path: '/' });
    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(screen.queryByText('protected home')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.state).toEqual({ from: '/' });
  });

  it('renders protected content for an authenticated session', async () => {
    renderApp({
      routes,
      appInterface: 'manager',
      i18n,
      fetch: fakeApiFetch({ session: makeSession('manager') }),
    });
    expect(await screen.findByText('protected home')).toBeInTheDocument();
  });

  it('denies a route when the permission is missing', async () => {
    renderApp({
      routes,
      appInterface: 'manager',
      i18n,
      path: '/roles',
      fetch: fakeApiFetch({ session: makeSession('manager') }),
    });
    expect(
      await screen.findByText('You do not have permission to view this page.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('roles page')).not.toBeInTheDocument();
  });

  it('allows a route when the permission is granted', async () => {
    renderApp({
      routes,
      appInterface: 'manager',
      i18n,
      path: '/roles',
      fetch: fakeApiFetch({ session: makeSession('manager', ['roles.read']) }),
    });
    expect(await screen.findByText('roles page')).toBeInTheDocument();
  });

  it('shows an error with retry instead of content when the API is unreachable', async () => {
    const failing = () => Promise.reject(new TypeError('Failed to fetch'));
    renderApp({ routes, appInterface: 'pos', i18n, fetch: failing as typeof fetch });
    expect(
      await screen.findByText('Cannot reach the server. Check your connection.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('protected home')).not.toBeInTheDocument();
  });

  it('sends an authenticated user away from the login page', async () => {
    const { router } = renderApp({
      routes,
      appInterface: 'manager',
      i18n,
      path: '/login',
      fetch: fakeApiFetch({ session: makeSession('manager') }),
    });
    expect(await screen.findByText('protected home')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });
});
