import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { i18n } from '../../i18n/index.js';
import { routes } from '../../routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('restaurant setup', () => {
  it('turns the module on and explains the stock policy', async () => {
    let settings = { enabled: false, autoSendOnPayment: true, version: 0 };
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'restaurant.manage']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: { branches: [] } }),
        'GET /manager/restaurant/settings': () => ({ status: 200, body: settings }),
        'PUT /manager/restaurant/settings': (body) => {
          settings = { ...(body as typeof settings), version: 1 };
          return { status: 200, body: settings };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/restaurant', fetch });
    expect(await screen.findByText(/The restaurant module is off/)).toBeInTheDocument();
    expect(screen.getByText(/Stock is deducted once, when a bill is paid/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByLabelText('Use restaurant service (tables, kitchen display)'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Changes saved')).toBeInTheDocument();
    const put = fetch.calls.find((c) => c.method === 'PUT')!;
    expect(put.body).toEqual({ enabled: true, autoSendOnPayment: true, version: 0 });
  });

  it('is not reachable without restaurant.manage', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access']),
      routes: { 'GET /manager/branches': () => ({ status: 200, body: { branches: [] } }) },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/restaurant', fetch });
    expect(
      await screen.findByText('You do not have permission to view this page.'),
    ).toBeInTheDocument();
    expect(fetch.calls.some((c) => c.path.startsWith('/manager/restaurant'))).toBe(false);
  });
});
