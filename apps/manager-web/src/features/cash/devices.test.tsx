import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n/index.js';
import { routes } from '../../routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const DEVICE = '0190a000-0000-7000-8000-000000000d01';
const device = {
  id: DEVICE,
  name: 'Till Mac',
  branchId: '0190a000-0000-7000-8000-000000000001',
  registerId: '0190a000-0000-7000-8000-000000000101',
  registerCode: 'R2',
  createdAt: '2026-10-17T07:00:00.000Z',
  lastSeenAt: '2026-10-17T08:00:00.000Z',
  lastSyncAt: '2026-10-17T08:00:00.000Z',
  revokedAt: null,
  online: true,
};

describe('devices', () => {
  it('lists devices with their register and removes one after confirmation', async () => {
    let revoked = false;
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'registers.manage']),
      routes: {
        'GET /manager/devices': () => ({
          status: 200,
          body: {
            devices: [
              revoked
                ? { ...device, online: false, revokedAt: '2026-10-17T09:00:00.000Z' }
                : device,
            ],
          },
        }),
        [`POST /manager/devices/${DEVICE}/revoke`]: () => {
          revoked = true;
          return { status: 204, body: null };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/devices', fetch });
    const row = await screen.findByRole('row', { name: /Till Mac/ });
    expect(within(row).getByText('R2')).toBeInTheDocument();
    expect(within(row).getByText('Online')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await vi.waitFor(() =>
      expect(fetch.calls.some((c) => c.path === `/manager/devices/${DEVICE}/revoke`)).toBe(true),
    );
    expect(await screen.findByText('Removed')).toBeInTheDocument();
  });

  it('shows and saves the offline selling limit', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', [
        'manager.access',
        'registers.manage',
        'merchant.settings.read',
        'merchant.settings.update',
      ]),
      routes: {
        'GET /manager/devices': () => ({ status: 200, body: { devices: [] } }),
        'GET /manager/device-settings': () => ({ status: 200, body: { offlineLimitHours: 72 } }),
        'PUT /manager/device-settings': (body) => ({ status: 200, body }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/devices', fetch });
    const input = await screen.findByLabelText('Limit (hours)');
    expect(input).toHaveValue('72');
    await userEvent.clear(input);
    await userEvent.type(input, '900');
    expect(screen.getByText('Enter 1 to 720 hours.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, '48');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() =>
      expect(fetch.calls.find((c) => c.method === 'PUT')?.body).toEqual({ offlineLimitHours: 48 }),
    );
  });
});
