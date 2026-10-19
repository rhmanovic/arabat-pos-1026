import { fakeApiFetch, renderApp } from '@arabat/web-core/testing';
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
