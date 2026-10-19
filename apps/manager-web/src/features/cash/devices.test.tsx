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
  role: 'primary',
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

  it('lists device exceptions and marks one handled with a note', async () => {
    const exception = {
      id: '0190a000-0000-7000-8000-000000000e01',
      kind: 'negative_stock',
      branchId: device.branchId,
      deviceId: DEVICE,
      deviceName: 'Till Mac',
      registerCode: 'R2',
      recordId: '0190a000-0000-7000-8000-000000000e02',
      recordKind: 'sale',
      details: {
        variantId: '0190a000-0000-7000-8000-000000000e03',
        balance: '-1',
        receiptNumber: 'MAIN-R2-000004',
        productNameEn: 'Cup',
        productNameAr: 'كوب',
      },
      occurredAt: '2026-10-17T08:00:00.000Z',
      receivedAt: '2026-10-17T09:00:00.000Z',
      createdAt: '2026-10-17T09:00:00.000Z',
      resolvedAt: null,
      resolvedByName: null,
      resolutionNote: null,
      payload: null,
    };
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'registers.manage']),
      routes: {
        'GET /manager/devices': () => ({ status: 200, body: { devices: [device] } }),
        'GET /manager/device-exceptions': () => ({
          status: 200,
          body: { exceptions: [exception] },
        }),
        [`POST /manager/device-exceptions/${exception.id}/resolve`]: () => ({
          status: 204,
          body: null,
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/devices', fetch });
    const row = await screen.findByRole('row', { name: /Negative stock/ });
    expect(
      within(row).getByText(/Cup went to -1 in stock with sale MAIN-R2-000004/),
    ).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Mark handled' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('What was done'), 'Counted the shelf');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark handled' }));
    await vi.waitFor(() =>
      expect(
        fetch.calls.find((c) => c.path === `/manager/device-exceptions/${exception.id}/resolve`)
          ?.body,
      ).toEqual({ note: 'Counted the shelf' }),
    );
  });

  it('closes a shift left open elsewhere from the exceptions list (amendment 3)', async () => {
    const stale = '0190a000-0000-7000-8000-000000000e11';
    const exception = {
      id: '0190a000-0000-7000-8000-000000000e10',
      kind: 'shift_left_open',
      branchId: device.branchId,
      deviceId: DEVICE,
      deviceName: 'Till Mac',
      registerCode: 'R2',
      recordId: '0190a000-0000-7000-8000-000000000e12',
      recordKind: 'shift_open',
      details: {
        staleShiftId: stale,
        staleRegisterCode: 'R1',
        staleOnDevice: false,
        staleOpenedAt: '2026-10-17T07:00:00.000Z',
        staleShiftClosed: false,
        fullName: 'Sara',
      },
      occurredAt: '2026-10-17T08:00:00.000Z',
      receivedAt: '2026-10-17T09:00:00.000Z',
      createdAt: '2026-10-17T09:00:00.000Z',
      resolvedAt: null,
      resolvedByName: null,
      resolutionNote: null,
      payload: null,
    };
    const shift = {
      id: stale,
      branchId: device.branchId,
      registerId: '0190a000-0000-7000-8000-000000000e13',
      registerName: { nameEn: 'R1', nameAr: null },
      membershipId: '0190a000-0000-7000-8000-000000000e14',
      employeeName: 'Sara',
      status: 'open',
      openedAt: '2026-10-17T07:00:00.000Z',
      openingNote: null,
      closedAt: null,
      closedByName: null,
      closeType: null,
      summary: {
        openingFloat: { amount: '0.000', currency: 'KWD' },
        cashIn: { amount: '0.000', currency: 'KWD' },
        cashOut: { amount: '0.000', currency: 'KWD' },
        cashSales: { amount: '0.000', currency: 'KWD' },
        cashRefunds: { amount: '0.000', currency: 'KWD' },
        expectedCash: { amount: '0.000', currency: 'KWD' },
        openingExpected: null,
        openingDiscrepancy: null,
        openingIsInitial: true,
      },
      countedCash: null,
      discrepancy: null,
      outcome: null,
      countedBreakdown: null,
      closingNote: null,
      movements: [],
      version: 3,
    };
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'registers.manage']),
      routes: {
        'GET /manager/devices': () => ({ status: 200, body: { devices: [device] } }),
        'GET /manager/device-exceptions': () => ({
          status: 200,
          body: { exceptions: [exception] },
        }),
        [`GET /manager/shifts/${stale}`]: () => ({ status: 200, body: shift }),
        [`POST /manager/shifts/${stale}/force-close`]: () => ({
          status: 201,
          body: { ...shift, status: 'closed', closeType: 'forced_uncounted' },
        }),
        [`POST /manager/device-exceptions/${exception.id}/resolve`]: () => ({
          status: 204,
          body: null,
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/devices', fetch });
    const row = await screen.findByRole('row', { name: /Shift left open/ });
    expect(within(row).getByText(/Sara opened the branch shift/)).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Close the shift' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('What was done'), 'Left open yesterday');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close the shift' }));
    await vi.waitFor(() =>
      expect(
        fetch.calls.find((c) => c.path === `/manager/shifts/${stale}/force-close`)?.body,
      ).toEqual({ note: 'Left open yesterday', version: 3 }),
    );
    await vi.waitFor(() =>
      expect(
        fetch.calls.find((c) => c.path === `/manager/device-exceptions/${exception.id}/resolve`)
          ?.body,
      ).toEqual({ note: 'Left open yesterday' }),
    );
  });

  it('lets the owner make a device additional; others see no change button (Plan A)', async () => {
    const fetch = fakeApiFetch({
      session: { ...makeSession('manager', ['manager.access', 'registers.manage']), isOwner: true },
      routes: {
        'GET /manager/devices': () => ({ status: 200, body: { devices: [device] } }),
        [`PUT /manager/devices/${DEVICE}`]: (body) => ({
          status: 200,
          body: { ...device, ...(body as object) },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/devices', fetch });
    const row = await screen.findByRole('row', { name: /Till Mac/ });
    expect(within(row).getByText('Primary')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'secondary');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() =>
      expect(fetch.calls.find((c) => c.method === 'PUT')?.body).toEqual({ role: 'secondary' }),
    );
  });

  it('hides the change button from managers who are not the owner', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'registers.manage']),
      routes: { 'GET /manager/devices': () => ({ status: 200, body: { devices: [device] } }) },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/devices', fetch });
    const row = await screen.findByRole('row', { name: /Till Mac/ });
    expect(within(row).queryByRole('button', { name: 'Change' })).toBeNull();
  });
});
