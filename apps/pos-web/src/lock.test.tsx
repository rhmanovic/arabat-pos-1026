import { fakeApiFetch, makeSession, problem, renderApp } from '@arabat/web-core/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { i18n } from './i18n/index.js';
import { routes } from './routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('POS lock screen', () => {
  it('shows the lock screen for a locked session and unlocks with the password', async () => {
    const user = userEvent.setup();
    let locked = true;
    const fetch = fakeApiFetch({
      routes: {
        'GET /auth/pos/me': () =>
          locked
            ? problem(401, 'SESSION_LOCKED')
            : { status: 200, body: makeSession('pos', ['pos.access']) },
        'POST /auth/pos/unlock': (body) => {
          if ((body as { password: string }).password !== 'Right-Password-1')
            return problem(401, 'INVALID_CREDENTIALS');
          locked = false;
          return { status: 204, body: null };
        },
      },
    });
    renderApp({ routes, appInterface: 'pos', i18n, path: '/', fetch });
    expect(await screen.findByRole('heading', { name: 'POS locked' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Password'), 'Wrong-Password-1');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('The e-mail or password is incorrect.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Password'), 'Right-Password-1');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'POS locked' })).toBeNull());
    expect(fetch.calls.filter((c) => c.path === '/auth/pos/unlock')).toHaveLength(2);
  });

  it('lets another person end the locked session', async () => {
    const user = userEvent.setup();
    const fetch = fakeApiFetch({
      routes: {
        'GET /auth/pos/me': () => problem(401, 'SESSION_LOCKED'),
        'POST /auth/pos/lock/sign-out': () => ({ status: 204, body: null }),
      },
    });
    const { router } = renderApp({ routes, appInterface: 'pos', i18n, path: '/', fetch });
    await user.click(await screen.findByRole('button', { name: 'Sign in as someone else' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });
});
