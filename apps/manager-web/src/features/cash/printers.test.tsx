import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n/index.js';
import { routes } from '../../routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const AGENT = '0190a000-0000-7000-8000-000000000a01';
const TOKEN = 'k3J9xQ2mV7pL1sT8wY4zB6nC0dF5gH9jR2uE7iO3aSd';

describe('receipt printers', () => {
  it('creates an agent and shows its token once, lists online state and toggles auto-print', async () => {
    const agents = [
      {
        id: AGENT,
        name: 'Cashier MacBook',
        branchId: null,
        lastSeenAt: '2026-10-16T08:00:00.000Z',
        online: true,
        createdAt: '2026-10-16T07:00:00.000Z',
      },
    ];
    let auto = true;
    const fetch = fakeApiFetch({
      session: makeSession('manager', [
        'manager.access',
        'registers.manage',
        'merchant.settings.read',
        'merchant.settings.update',
      ]),
      routes: {
        'GET /manager/print-agents': () => ({ status: 200, body: { agents } }),
        'POST /manager/print-agents': () => ({
          status: 201,
          body: { id: '0190a000-0000-7000-8000-000000000a02', token: TOKEN },
        }),
        'GET /manager/print-settings': () => ({ status: 200, body: { autoPrintReceipts: auto } }),
        'PUT /manager/print-settings': (body) => {
          auto = (body as { autoPrintReceipts: boolean }).autoPrintReceipts;
          return { status: 200, body: { autoPrintReceipts: auto } };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/printers', fetch });
    const row = await screen.findByRole('row', { name: /Cashier MacBook/ });
    expect(within(row).getByText('Online')).toBeInTheDocument();
    expect(within(row).getByText('All branches')).toBeInTheDocument();

    const autoPrint = await screen.findByLabelText(/Print receipts automatically/);
    expect(autoPrint).toBeChecked();
    await userEvent.click(autoPrint);
    await vi.waitFor(() =>
      expect(
        fetch.calls.find((c) => c.method === 'PUT' && c.path === '/manager/print-settings')?.body,
      ).toEqual({ autoPrintReceipts: false }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add printer' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Till 2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await within(dialog).findByTestId('print-agent-token')).toHaveValue(TOKEN);
    expect(
      fetch.calls.find((c) => c.method === 'POST' && c.path === '/manager/print-agents')?.body,
    ).toEqual({ name: 'Till 2', branchId: null });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    // Closed: the token is gone from the page for good.
    expect(screen.queryByDisplayValue(TOKEN)).not.toBeInTheDocument();
  });
});
