import { fakeApiFetch, problem, renderApp } from '@arabat/web-core/testing';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from './i18n/index.js';
import { routes } from './routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const TOKEN = 'q3VqX9yT2mWcK1pL8rN4sD6fG0hJ7kZbVnMx5oPe3uA';

/** The page behind the e-mailed PIN link (ADR-0112, owner decision 6): public, no session. */
describe('PIN page', () => {
  it('sets the cashier’s own PIN with the link token and refuses a mismatch', async () => {
    const fetch = fakeApiFetch({
      session: null,
      routes: {
        'POST /device/pin-reset/complete': (body) => ({
          status: 200,
          body: { status: 'pin_set', ...(body as object) },
        }),
      },
    });
    renderApp({ routes, appInterface: 'pos', i18n, path: `/pin?token=${TOKEN}`, fetch });
    expect(
      await screen.findByRole('heading', { name: 'Choose your till PIN' }),
    ).toBeInTheDocument();
    const pin = screen.getByLabelText('PIN');
    const confirm = screen.getByLabelText('Repeat the PIN');
    await userEvent.type(pin, '482913');
    await userEvent.type(confirm, '482914');
    expect(screen.getByText('The PINs do not match.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save PIN' })).toBeDisabled();
    await userEvent.clear(confirm);
    await userEvent.type(confirm, '482913');
    await userEvent.click(screen.getByRole('button', { name: 'Save PIN' }));
    await vi.waitFor(() =>
      expect(fetch.calls.find((c) => c.path === '/device/pin-reset/complete')?.body).toEqual({
        token: TOKEN,
        pin: '482913',
      }),
    );
    expect(await screen.findByText(/Your PIN is set/)).toBeInTheDocument();
  });

  it('explains an incomplete link', async () => {
    const fetch = fakeApiFetch({ session: null, routes: {} });
    renderApp({ routes, appInterface: 'pos', i18n, path: '/pin', fetch });
    expect(await screen.findByText(/This link is incomplete/)).toBeInTheDocument();
  });
});

/** Browser POS sign-in with name + PIN behind the branch link (Plan A). */
describe('PIN sign-in page', () => {
  const KEY = 'k'.repeat(43);
  const M = '0190a000-0000-7000-8000-0000000000a1';
  const branch = {
    merchant: { nameEn: 'Arabat Café', nameAr: 'مقهى عربات' },
    branch: {
      id: '0190a000-0000-7000-8000-0000000000b1',
      code: 'MAIN',
      nameEn: 'Main',
      nameAr: null,
    },
    staff: [
      { membershipId: M, fullName: 'Fatma', hasPin: true },
      { membershipId: '0190a000-0000-7000-8000-0000000000a2', fullName: 'Ali', hasPin: false },
    ],
  };

  it('lists the branch’s cashiers, signs one in with the PIN and explains a lock', async () => {
    localStorage.setItem('arabat.pos.pinLink', KEY);
    let attempts = 0;
    const fetch = fakeApiFetch({
      session: null,
      routes: {
        'POST /auth/pos/pin-sign-in/branch': () => ({ status: 200, body: branch }),
        'POST /auth/pos/pin-sign-in': () =>
          ++attempts === 1
            ? problem(429, 'RATE_LIMITED')
            : {
                status: 200,
                body: { status: 'authenticated', interface: 'pos', redirectTo: '/pos/' },
              },
      },
    });
    renderApp({ routes, appInterface: 'pos', i18n, path: '/pin-sign-in', fetch });
    expect(await screen.findByRole('heading', { name: 'Arabat Café · Main' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ali' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Fatma' }));
    await userEvent.type(screen.getByLabelText('PIN'), '482913');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByText('Too many wrong PINs. Try again in 5 minutes.'),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('PIN'), '482913');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await vi.waitFor(() =>
      expect(fetch.calls.filter((c) => c.path === '/auth/pos/pin-sign-in').at(-1)?.body).toEqual({
        key: KEY,
        membershipId: M,
        pin: '482913',
      }),
    );
    expect(fetch.calls.find((c) => c.path === '/auth/pos/pin-sign-in/branch')?.body).toEqual({
      key: KEY,
    });
    localStorage.clear();
  });

  it('asks for the manager’s link when this browser has none', async () => {
    localStorage.clear();
    const fetch = fakeApiFetch({ session: null, routes: {} });
    renderApp({ routes, appInterface: 'pos', i18n, path: '/pin-sign-in', fetch });
    expect(
      await screen.findByText(/Open the sign-in link your manager shared/),
    ).toBeInTheDocument();
  });
});
