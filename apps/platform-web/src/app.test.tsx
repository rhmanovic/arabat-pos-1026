import { flattenKeys } from '@arabat/i18n';
import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { i18n, resources } from './i18n/index.js';
import { routes } from './routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('platform app', () => {
  it('shows the operator sign-in page to anonymous users', async () => {
    const { router } = renderApp({ routes, appInterface: 'platform', i18n, path: '/' });
    expect(await screen.findByRole('heading', { name: 'Operator sign-in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('renders the platform console layout for an operator session', async () => {
    renderApp({
      routes,
      appInterface: 'platform',
      i18n,
      fetch: fakeApiFetch({ session: makeSession('platform', ['platform.super_admin']) }),
    });
    expect(
      await screen.findByRole('navigation', { name: 'Platform navigation' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Restricted to platform operators')).toBeInTheDocument();
  });

  it('reports an unreachable database on the sign-in page', async () => {
    renderApp({
      routes,
      appInterface: 'platform',
      i18n,
      path: '/login',
      fetch: fakeApiFetch({ healthy: false }),
    });
    expect(await screen.findByText('Server unreachable')).toBeInTheDocument();
  });

  it('defines the same translation keys in Arabic and English', () => {
    expect(flattenKeys(resources.ar).sort()).toEqual(flattenKeys(resources.en).sort());
  });
});
