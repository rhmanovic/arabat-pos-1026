import { flattenKeys } from '@arabat/i18n';
import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { i18n, resources } from './i18n/index.js';
import { routes } from './routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('pos app', () => {
  it('shows the cashier sign-in page to anonymous users', async () => {
    const { router } = renderApp({ routes, appInterface: 'pos', i18n, path: '/' });
    expect(await screen.findByRole('heading', { name: 'Cashier sign-in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('renders the full-screen register layout without management navigation', async () => {
    renderApp({
      routes,
      appInterface: 'pos',
      i18n,
      fetch: fakeApiFetch({ session: makeSession('pos', ['pos.access']) }),
    });
    expect(await screen.findByRole('banner', { name: 'Register toolbar' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Products' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('defines the same translation keys in Arabic and English', () => {
    expect(flattenKeys(resources.ar).sort()).toEqual(flattenKeys(resources.en).sort());
  });
});
