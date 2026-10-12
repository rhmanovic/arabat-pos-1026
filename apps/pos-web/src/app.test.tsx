import { flattenKeys } from '@arabat/i18n';
import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n, resources } from './i18n/index.js';
import { routes } from './routes.js';

const money = (amount: string) => ({ amount, currency: 'KWD' });
const SHIFT = {
  id: '0190a000-0000-7000-8000-000000000501',
  branchId: '0190a000-0000-7000-8000-000000000001',
  registerId: '0190a000-0000-7000-8000-000000000101',
  registerName: { nameEn: 'Register 1', nameAr: 'الصندوق 1' },
  membershipId: 'm',
  employeeName: 'Cashier',
  status: 'open',
  openedAt: '2026-10-12T05:00:00.000Z',
  openingNote: null,
  closedAt: null,
  closedByName: null,
  closeType: null,
  summary: {
    openingFloat: money('50.000'),
    cashIn: money('0.000'),
    cashOut: money('0.000'),
    cashSales: money('0.000'),
    cashRefunds: money('0.000'),
    expectedCash: money('50.000'),
  },
  countedCash: null,
  discrepancy: null,
  outcome: null,
  countedBreakdown: null,
  closingNote: null,
  movements: [],
  version: 1,
};

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
      fetch: fakeApiFetch({
        session: makeSession('pos', ['pos.access', 'shifts.operate']),
        routes: { 'GET /pos/shifts/current': () => ({ status: 200, body: { shift: SHIFT } }) },
      }),
    });
    expect(await screen.findByRole('banner', { name: 'Register toolbar' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Products' })).toBeInTheDocument();
    expect(screen.getByTestId('shift-strip')).toHaveTextContent('Register 1');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('asks for a shift before selling and opens one on a free register', async () => {
    let shift: unknown = null;
    const fetch = fakeApiFetch({
      session: makeSession('pos', ['pos.access', 'shifts.operate']),
      routes: {
        'GET /pos/shifts/current': () => ({ status: 200, body: { shift } }),
        'GET /pos/registers': () => ({
          status: 200,
          body: {
            registers: [
              {
                id: SHIFT.registerId,
                code: 'R1',
                nameEn: 'Register 1',
                nameAr: null,
                defaultOpeningFloat: money('25.000'),
                availability: 'free',
                occupiedBy: null,
              },
              {
                id: '0190a000-0000-7000-8000-000000000102',
                code: 'R2',
                nameEn: 'Register 2',
                nameAr: null,
                defaultOpeningFloat: money('0.000'),
                availability: 'occupied',
                occupiedBy: 'Sara',
              },
            ],
          },
        }),
        'POST /pos/shifts': () => {
          shift = SHIFT;
          return { status: 201, body: SHIFT };
        },
      },
    });
    renderApp({ routes, appInterface: 'pos', i18n, fetch });
    expect(await screen.findByRole('heading', { name: 'Open a shift' })).toBeInTheDocument();
    expect(await screen.findByRole('radio', { name: /Register 2/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /In use by Sara/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Register 1/ }));
    const float = screen.getByLabelText('Opening cash (KWD)');
    expect(float).toHaveValue('25.000');
    await userEvent.clear(float);
    await userEvent.type(float, '50');
    await userEvent.click(screen.getByRole('button', { name: 'Open shift' }));
    expect(await screen.findByRole('heading', { name: 'Products' })).toBeInTheDocument();
    expect(
      fetch.calls.find((c) => c.method === 'POST' && c.path === '/pos/shifts')?.body,
    ).toMatchObject({
      registerId: SHIFT.registerId,
      openingFloat: '50',
    });
  });

  it('counts the drawer by notes and coins when closing', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('pos', ['pos.access', 'shifts.operate', 'cash.move']),
      routes: {
        'GET /pos/shifts/current': () => ({ status: 200, body: { shift: SHIFT } }),
        'POST /pos/shifts/current/close': (body) => ({
          status: 201,
          body: {
            ...SHIFT,
            status: 'closed',
            closedAt: '2026-10-12T09:00:00.000Z',
            closeType: 'normal',
            countedCash: money((body as { countedCash: string }).countedCash),
            discrepancy: money('-0.250'),
            outcome: 'short',
          },
        }),
      },
    });
    renderApp({ routes, appInterface: 'pos', i18n, fetch, path: '/shift' });
    expect(await screen.findByTestId('expected-cash')).toHaveTextContent('KWD 50.000');
    await userEvent.click(screen.getByRole('button', { name: 'Close shift' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText('Count notes and coins'));
    await userEvent.type(within(dialog).getByLabelText('20'), '2');
    await userEvent.type(within(dialog).getByLabelText('5'), '1');
    await userEvent.type(within(dialog).getByLabelText('0.5'), '3');
    await userEvent.type(within(dialog).getByLabelText('0.25'), '1');
    expect(within(dialog).getByTestId('count-total')).toHaveTextContent('KWD 46.750');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close shift' }));
    expect(await screen.findByTestId('discrepancy')).toHaveTextContent('KWD -0.250');
    const call = await vi.waitFor(() => {
      const c = fetch.calls.find((x) => x.path === '/pos/shifts/current/close');
      if (!c) throw new Error('not yet');
      return c;
    });
    expect(call.body).toMatchObject({ countedCash: '46.750', version: 1 });
  });

  it('defines the same translation keys in Arabic and English', () => {
    expect(flattenKeys(resources.ar).sort()).toEqual(flattenKeys(resources.en).sort());
  });
});
