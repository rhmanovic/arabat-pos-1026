import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n/index.js';
import { routes } from '../../routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const BRANCH = '0190a000-0000-7000-8000-000000000001';
const SECOND = '0190a000-0000-7000-8000-000000000002';
const branch = (id: string, nameEn: string, status: string, isMain: boolean) => ({
  id,
  code: isMain ? 'MAIN' : 'B2',
  nameEn,
  nameAr: null,
  isMain,
  status,
  timezone: 'Asia/Kuwait',
  phone: null,
  address: null,
  receiptHeader: null,
  receiptFooter: null,
  employeeCount: 1,
  version: 1,
  createdAt: '2026-10-01T08:00:00.000Z',
});
const employee = (membershipId: string, fullName: string, email: string, isOwner: boolean) => ({
  membershipId,
  userId: `u-${membershipId}`,
  fullName,
  email,
  jobTitle: null,
  phone: null,
  employeeCode: null,
  isOwner,
  status: 'active',
  userStatus: 'active',
  lastLoginAt: null,
  assignments: [],
  manageable: !isOwner,
  createdAt: '2026-10-01T08:00:00.000Z',
});

describe('account hygiene (BR-193)', () => {
  it('lists the devices, signs one out and changes the password with the current one', async () => {
    const sessions = [
      {
        id: 's1',
        interface: 'manager',
        merchantName: 'Test Co',
        ip: '10.0.0.5',
        userAgent: 'Firefox',
        createdAt: '2026-10-13T06:00:00.000Z',
        lastSeenAt: '2026-10-13T08:00:00.000Z',
        current: true,
      },
      {
        id: 's2',
        interface: 'pos',
        merchantName: 'Test Co',
        ip: '10.0.0.9',
        userAgent: 'Till tablet',
        createdAt: '2026-10-12T06:00:00.000Z',
        lastSeenAt: '2026-10-12T20:00:00.000Z',
        current: false,
      },
    ];
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access']),
      routes: {
        'GET /auth/manager/sessions': () => ({ status: 200, body: { sessions } }),
        'DELETE /auth/manager/sessions/s2': () => ({ status: 204, body: undefined }),
        'POST /auth/manager/password': () => ({
          status: 200,
          body: { status: 'password_changed' },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/account', fetch });
    const table = await screen.findByRole('table', { name: 'Signed-in devices' });
    expect(await within(table).findByText('This device')).toBeInTheDocument();
    expect(within(table).getByText('Till tablet')).toBeInTheDocument();
    await userEvent.click(within(table).getByRole('button', { name: 'Sign out' }));
    await vi.waitFor(() =>
      expect(
        fetch.calls.some((c) => c.method === 'DELETE' && c.path === '/auth/manager/sessions/s2'),
      ).toBe(true),
    );
    // The password form needs the current password, a long enough new one, typed twice.
    const submit = screen.getByRole('button', { name: 'Change password' });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Current password'), 'Old-Password-1');
    await userEvent.type(screen.getByLabelText('New password'), 'Brand-New-Pass-9');
    await userEvent.type(screen.getByLabelText('Repeat the new password'), 'Brand-New-Pass-8');
    expect(screen.getByText('The passwords differ.')).toBeInTheDocument();
    expect(submit).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Repeat the new password'));
    await userEvent.type(screen.getByLabelText('Repeat the new password'), 'Brand-New-Pass-9');
    await userEvent.click(submit);
    const call = await vi.waitFor(() => {
      const c = fetch.calls.find((x) => x.method === 'POST' && x.path === '/auth/manager/password');
      if (!c) throw new Error('not yet');
      return c;
    });
    expect(call.body).toEqual({
      currentPassword: 'Old-Password-1',
      newPassword: 'Brand-New-Pass-9',
    });
  });

  it('asks what to do with dormant roles when a branch is reactivated (BR-192)', async () => {
    let activated = false;
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'branches.read', 'branches.manage']),
      routes: {
        'GET /manager/branches': () => ({
          status: 200,
          body: {
            branches: [
              branch(BRANCH, 'Main', 'active', true),
              branch(SECOND, 'Second', activated ? 'active' : 'inactive', false),
            ],
          },
        }),
        [`POST /manager/branches/${SECOND}/status`]: (body) => {
          const b = body as { dormantGrants?: string };
          if (!b.dormantGrants)
            return {
              status: 409,
              body: {
                type: 'urn:arabat:error:grants_need_confirmation',
                title: 'GRANTS_NEED_CONFIRMATION',
                status: 409,
                code: 'GRANTS_NEED_CONFIRMATION',
                detail: 'Dormant role assignments at this branch would come back into force.',
                issues: [
                  { path: 'dormantGrants', code: 'confirm', message: 'Noor — Cashier' },
                  { path: 'dormantGrants', code: 'confirm', message: 'Sami — Supervisor' },
                ],
              },
            };
          activated = true;
          return { status: 201, body: branch(SECOND, 'Second', 'active', false) };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/branches', fetch });
    await userEvent.click(await screen.findByRole('button', { name: 'Activate' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Reactivate Second: dormant roles');
    expect(within(dialog).getByTestId('dormant-grants')).toHaveTextContent('Noor — Cashier');
    expect(within(dialog).getByTestId('dormant-grants')).toHaveTextContent('Sami — Supervisor');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Clear the roles and activate' }),
    );
    await vi.waitFor(() => {
      const calls = fetch.calls.filter(
        (c) => c.method === 'POST' && c.path === `/manager/branches/${SECOND}/status`,
      );
      expect(calls.map((c) => c.body)).toEqual([
        { status: 'active' },
        { status: 'active', dormantGrants: 'clear' },
      ]);
    });
  });

  it('lets the owner hand over ownership with their password and the named member accept with the code (BR-020)', async () => {
    const profile = {
      id: 'm1',
      nameEn: 'Test Co',
      nameAr: null,
      legalName: null,
      commercialRegistrationNo: null,
      contactEmail: null,
      contactPhone: null,
      countryCode: 'KW',
      defaultCurrency: 'KWD',
      defaultLanguage: 'en',
      timezone: 'Asia/Kuwait',
      timezoneChangedAt: null,
      status: 'active',
      version: 1,
      createdAt: '2026-10-01T08:00:00.000Z',
      pendingOwnershipTransfer: null,
    };
    let current: Record<string, unknown> = profile;
    const ownerFetch = fakeApiFetch({
      session: makeSession(
        'manager',
        ['manager.access', 'merchant.settings.read', 'merchant.settings.update'],
        {
          isOwner: true,
        },
      ),
      routes: {
        'GET /manager/merchant': () => ({ status: 200, body: current }),
        'GET /manager/employees': () => ({
          status: 200,
          body: {
            employees: [
              employee('o1', 'Owner', 'owner@test.arabat', true),
              employee('e1', 'Noor', 'noor@test.arabat', false),
            ],
            invitations: [],
          },
        }),
        'POST /manager/merchant/ownership-transfers': () => {
          current = {
            ...profile,
            pendingOwnershipTransfer: {
              id: 't1',
              toMembershipId: 'e1',
              toName: 'Noor',
              toEmail: 'noor@test.arabat',
              expiresAt: '2026-10-16T08:00:00.000Z',
              createdAt: '2026-10-13T08:00:00.000Z',
              forMe: false,
            },
          };
          return { status: 202, body: current };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/settings', fetch: ownerFetch });
    const start = await screen.findByTestId('ownership-start');
    await userEvent.selectOptions(within(start).getByLabelText('New owner'), 'e1');
    await userEvent.type(within(start).getByLabelText('Your password'), 'Owner-Pass-2026');
    await userEvent.click(within(start).getByRole('button', { name: 'Hand over ownership' }));
    const call = await vi.waitFor(() => {
      const c = ownerFetch.calls.find(
        (x) => x.method === 'POST' && x.path === '/manager/merchant/ownership-transfers',
      );
      if (!c) throw new Error('not yet');
      return c;
    });
    expect(call.body).toEqual({ toMembershipId: 'e1', password: 'Owner-Pass-2026' });
    expect(await screen.findByTestId('ownership-pending')).toHaveTextContent(
      'Waiting for Noor (noor@test.arabat) to confirm, until 2026-10-16.',
    );

    // The named member sees the acceptance box and sends the code.
    const memberFetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'merchant.settings.read']),
      routes: {
        'GET /manager/merchant': () => ({
          status: 200,
          body: {
            ...profile,
            pendingOwnershipTransfer: {
              id: 't1',
              toMembershipId: 'e1',
              toName: 'Noor',
              toEmail: 'noor@test.arabat',
              expiresAt: '2026-10-16T08:00:00.000Z',
              createdAt: '2026-10-13T08:00:00.000Z',
              forMe: true,
            },
          },
        }),
        'POST /manager/merchant/ownership-transfers/accept': () => ({
          status: 200,
          body: { status: 'accepted' },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/settings', fetch: memberFetch });
    const accept = await screen.findByTestId('ownership-accept');
    await userEvent.type(
      within(accept).getByLabelText('Confirmation code'),
      'abcdefghijklmnopqrst',
    );
    await userEvent.click(within(accept).getByRole('button', { name: 'Accept ownership' }));
    await vi.waitFor(() =>
      expect(
        memberFetch.calls.find(
          (x) => x.method === 'POST' && x.path === '/manager/merchant/ownership-transfers/accept',
        )?.body,
      ).toEqual({ token: 'abcdefghijklmnopqrst' }),
    );
  });
});
