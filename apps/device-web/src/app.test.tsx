import type { DeviceRecordResult, DeviceSnapshot } from '@arabat/contracts';
import { createFakeBridge } from '@arabat/device-core/testing';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { argon2id } from 'hash-wasm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App.js';
import { i18n } from './i18n/index.js';

const U = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, '0')}`;
let PIN_HASH: string;

beforeAll(async () => {
  PIN_HASH = await argon2id({
    password: '482913',
    salt: 'saltsaltsalt',
    parallelism: 1,
    iterations: 1,
    memorySize: 1024,
    hashLength: 32,
    outputType: 'encoded',
  });
});
beforeEach(async () => {
  await i18n.changeLanguage('en');
  delete (window as { ArabatApp?: unknown }).ArabatApp;
});

function snapshot(partial: Partial<DeviceSnapshot> = {}): DeviceSnapshot {
  return {
    version: 'v1',
    full: true,
    catalogVersion: 'c1',
    serverTime: new Date().toISOString(),
    offlineLimitHours: 72,
    priceOffers: [],
    device: {
      id: U(1),
      name: 'Till',
      merchantId: U(2),
      branchId: U(3),
      branchCode: 'MAIN',
      code: 'D1',
      registerId: U(4),
      registerCode: 'R1',
      registerName: { nameEn: 'Main drawer', nameAr: 'الصندوق الرئيسي' },
      role: 'primary',
    },
    merchant: {
      id: U(2),
      nameEn: 'Arabat Café',
      nameAr: 'مقهى',
      currency: 'KWD',
      timezone: 'Asia/Kuwait',
    },
    branch: {
      id: U(3),
      code: 'MAIN',
      nameEn: 'Main',
      nameAr: null,
      phone: null,
      address: null,
      receiptHeader: null,
      receiptFooter: null,
    },
    register: {
      id: U(4),
      code: 'R1',
      nameEn: 'Main drawer',
      nameAr: 'الصندوق الرئيسي',
      defaultOpeningFloatMinor: '0',
      discrepancyToleranceMinor: '0',
    },
    settings: {
      maxDiscountPercent: '10',
      priceOverrideFloorPercent: '50',
      priceOverrideCeilingPercent: '200',
      priceOverrideBelowCost: false,
      requireTenderReference: true,
      blindCashCount: true,
      cashOutOtherLimitMinor: '20000',
      cashOutOtherShiftLimitMinor: '50000',
      refundWindowDays: 30,
      refundApprovalLimitMinor: '20000',
      refundOwnSalesNeedApproval: true,
      allowNegativeStock: false,
      heldSaleExpiryHours: 24,
    },
    counters: { lastReceiptNumber: null },
    branchShift: null,
    primaryDevice: { id: U(1), name: 'Till' },
    paymentMethods: [
      {
        id: U(900),
        kind: 'cash',
        status: 'active',
        availableInPos: true,
        gatewayProvider: null,
        financialAccountId: null,
        nameEn: 'Cash',
        nameAr: 'نقدي',
        feeType: 'none',
        feeFixedMinor: '0',
        feePercent: '0',
        sortOrder: 0,
      },
      {
        id: U(901),
        kind: 'card',
        status: 'active',
        availableInPos: true,
        gatewayProvider: null,
        financialAccountId: U(902),
        nameEn: 'Card',
        nameAr: 'بطاقة',
        feeType: 'none',
        feeFixedMinor: '0',
        feePercent: '0',
        sortOrder: 1,
      },
    ],
    staff: [
      {
        membershipId: U(10),
        userId: U(11),
        fullName: 'Sara',
        isOwner: false,
        pinHash: PIN_HASH,
        permissions: [
          'pos.access',
          'sales.create',
          'shifts.operate',
          'cash.move',
          'refunds.create',
        ],
      },
      {
        membershipId: U(20),
        userId: U(21),
        fullName: 'Boss',
        isOwner: true,
        pinHash: PIN_HASH,
        permissions: ['pos.access', 'sales.create', 'shifts.operate', 'registers.manage'],
      },
    ],
    categories: [],
    products: [
      {
        id: U(60),
        categoryId: null,
        nameEn: 'Tea',
        nameAr: 'شاي',
        type: 'standard',
        trackInventory: false,
        sellable: true,
        updatedAt: 'x',
        variants: [
          {
            id: U(61),
            nameEn: null,
            nameAr: null,
            sku: 'TEA-1',
            priceMinor: '250',
            costMinor: null,
            isDefault: true,
            status: 'active',
            barcodes: [],
          },
        ],
      },
    ],
    ...partial,
  };
}

/** The server as the device sees it: registration, snapshot, and an accepting upload. */
function fakeServer(
  options: { snap?: () => DeviceSnapshot; refuseShiftOpen?: string | null } = {},
) {
  const uploads: { kind: string; receiptNumber?: string }[][] = [];
  const snap = options.snap ?? snapshot;
  const state = { refuseShiftOpen: options.refuseShiftOpen ?? null, snap };
  const accepted = new Set<string>();
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl: typeof fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith('/device/register')) {
      const body = JSON.parse(String(init?.body)) as { branchId?: string };
      if (!body.branchId)
        return json(200, {
          status: 'select_branch',
          merchants: [
            {
              id: U(2),
              nameEn: 'Arabat Café',
              nameAr: 'مقهى',
              branches: [{ id: U(3), code: 'MAIN', nameEn: 'Main', nameAr: null }],
            },
          ],
        });
      return json(200, {
        status: 'registered',
        device: state.snap().device,
        token: 'T'.repeat(43),
      });
    }
    if (init?.method === 'GET' && u.includes('/device/sync')) {
      const since = new URL(u, 'http://x').searchParams.get('since');
      return json(
        200,
        since ? { ...state.snap(), full: false, products: [], version: `${since}+` } : state.snap(),
      );
    }
    if (init?.method === 'POST' && u.endsWith('/device/sync')) {
      const { records } = JSON.parse(String(init.body)) as {
        records: { id: string; kind: string; receiptNumber?: string }[];
      };
      uploads.push(records);
      const results: DeviceRecordResult[] = records.map((r) => {
        const base = { id: r.id, kind: r.kind, result: null, clockSkew: false };
        const shiftId = (r as { shiftId?: string }).shiftId;
        // The refused-shift cascade of the first real test (amendment 3).
        if (r.kind === 'shift_open' && state.refuseShiftOpen)
          return { ...base, status: 'refused', code: state.refuseShiftOpen, message: 'elsewhere' };
        if (shiftId && !accepted.has(shiftId) && state.refuseShiftOpen)
          return { ...base, status: 'refused', code: 'SHIFT_REQUIRED', message: 'not yet' };
        const dup = accepted.has(r.id);
        accepted.add(r.id);
        return {
          ...base,
          status: dup ? 'duplicate' : 'accepted',
          result: {},
          code: null,
          message: null,
        };
      });
      return json(200, { serverTime: new Date().toISOString(), results });
    }
    return json(404, { code: 'ROUTE_NOT_FOUND' });
  };
  return { fetch: fetchImpl, uploads, state };
}

async function start(server: ReturnType<typeof fakeServer>, token = 'T'.repeat(43)) {
  const bridge = await createFakeBridge({
    baseUrl: 'http://test/api/v1',
    fetch: server.fetch,
    token,
  });
  window.ArabatApp = bridge;
  const user = userEvent.setup();
  render(<App />);
  return { bridge, user };
}

async function typePin(user: ReturnType<typeof userEvent.setup>, digits = '482913') {
  const pad = await screen.findByTestId('pin-pad');
  for (const d of digits) await user.click(within(pad).getByRole('button', { name: d }));
  await user.click(within(pad).getByRole('button', { name: 'Enter' }));
}

describe('device till', () => {
  it('asks to open it in the Arabat app outside the bridge', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { name: 'Open this in the Arabat app' }),
    ).toBeInTheDocument();
  });

  it(
    'registers, signs in with a PIN, opens the shift, sells, prints and uploads in order',
    { timeout: 30_000 },
    async () => {
      const server = fakeServer();
      const bridge = await createFakeBridge({ baseUrl: 'http://test/api/v1', fetch: server.fetch });
      window.ArabatApp = bridge;
      const user = userEvent.setup();
      render(<App />);

      // Registration by a manager, then the branch choice.
      await user.type(await screen.findByLabelText('E-mail'), 'owner@example.com');
      await user.type(screen.getByLabelText('Password'), 'secret-pass');
      await user.type(screen.getByLabelText('Device name'), 'Front till');
      await user.click(screen.getByRole('button', { name: 'Register' }));
      await user.click(await screen.findByRole('button', { name: /Main/ }));
      expect(bridge.token).toBe('T'.repeat(43));

      // The staff list came with the first sync; Sara signs in with her PIN.
      await user.click(await screen.findByRole('button', { name: 'Sara' }));
      const pad = screen.getByTestId('pin-pad');
      for (const d of ['0', '0', '0', '0', '0', '0'])
        await user.click(within(pad).getByRole('button', { name: d }));
      await user.click(within(pad).getByRole('button', { name: 'Enter' }));
      expect(await screen.findByText(/Wrong PIN/)).toBeInTheDocument();
      for (const d of ['4', '8', '2', '9', '1', '3'])
        await user.click(within(pad).getByRole('button', { name: d }));
      await user.click(within(pad).getByRole('button', { name: 'Enter' }));

      // Opening count.
      await user.type(await screen.findByLabelText('Counted cash'), '5.000');
      await user.click(screen.getByRole('button', { name: 'Open shift' }));

      // Sell two teas for cash with change.
      const catalog = await screen.findByTestId('catalog');
      await user.click(within(catalog).getByRole('button', { name: /Tea/ }));
      await user.click(within(catalog).getByRole('button', { name: /Tea/ }));
      expect(screen.getByTestId('total')).toHaveTextContent('KWD 0.500');
      await user.click(screen.getByTestId('pay'));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByTestId('tendered'), '1');
      await user.click(within(dialog).getByTestId('add-payment'));
      expect(within(dialog).getByText('Change').nextSibling).toHaveTextContent('KWD 0.500');
      await user.click(within(dialog).getByTestId('complete-sale'));
      expect(await screen.findByTestId('last-sale')).toHaveTextContent('MAIN-D1-000001');

      // Printed through the bridge with the server's template; uploaded shift first, then the sale.
      await waitFor(() => expect(bridge.printed).toHaveLength(1));
      expect(bridge.printed[0]).toContain('MAIN-D1-000001');
      await waitFor(
        () =>
          expect(server.uploads.flat().map((r) => r.kind)).toEqual([
            'sign_in',
            'shift_open',
            'sale',
          ]),
        { timeout: 5000 },
      );
      await waitFor(() => expect(screen.getByTestId('sync-line')).toHaveTextContent('Synced'));

      // Lock keeps Sara: her PIN pad only, no "other person", and no log-out while her shift is open.
      await user.click(screen.getByTestId('lock'));
      expect(await screen.findByRole('heading', { name: 'Sara' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Other person' })).not.toBeInTheDocument();
      expect(screen.getByTestId('log-out')).toBeDisabled();
      await typePin(user);
      expect(await screen.findByTestId('catalog')).toBeInTheDocument();

      // Close the shift with Arabic digits and a comma: still 5.000.
      await user.click(screen.getByRole('button', { name: 'Close shift' }));
      await user.type(await screen.findByLabelText('Counted cash'), '٥,٥٠٠');
      await user.click(screen.getByRole('button', { name: 'Close shift' }));
      expect(await screen.findByText(/Shift closed\. Difference KWD 0\.000/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Back to the till' }));
      // Without an open shift logging out is possible: the picker is back.
      const logOut = await screen.findByTestId('log-out');
      expect(logOut).toBeEnabled();
      await user.click(logOut);
      expect(
        await screen.findByRole('heading', { name: 'Who is at the till?' }),
      ).toBeInTheDocument();
    },
  );

  it(
    'blocks selling at once when the server refuses the shift, keeps retrying it, and lets the cashier discard an empty one',
    { timeout: 30_000 },
    async () => {
      const server = fakeServer({ refuseShiftOpen: 'REGISTER_BUSY' });
      const { user } = await start(server);
      await user.click(await screen.findByRole('button', { name: 'Sara' }));
      await typePin(user);
      await user.type(await screen.findByLabelText('Counted cash'), '0.250');
      await user.click(screen.getByRole('button', { name: 'Open shift' }));
      // The refusal arrives with the first upload: the banner, Pay disabled.
      const banner = await screen.findByTestId('shift-blocked', {}, { timeout: 5000 });
      expect(banner).toHaveTextContent(/refused this shift \(REGISTER_BUSY\)/);
      expect(banner).toHaveTextContent(/Manager → Cash → Shifts/);
      const catalog = screen.getByTestId('catalog');
      await user.click(within(catalog).getByRole('button', { name: /Tea/ }));
      expect(screen.getByTestId('pay')).toBeDisabled();
      // Retried at every sync, unchanged.
      await user.click(screen.getByRole('button', { name: 'Sync now' }));
      await waitFor(() => expect(server.uploads.length).toBeGreaterThanOrEqual(2));
      const opens = server.uploads.flat().filter((r) => r.kind === 'shift_open');
      expect(opens.length).toBeGreaterThanOrEqual(2);
      expect(opens[1]).toEqual(opens[0]);
      // Nothing was sold in it: discard, back to the opening screen.
      await user.click(screen.getByTestId('discard-shift'));
      expect(await screen.findByRole('heading', { name: 'Open the shift' })).toBeInTheDocument();
      // The cause fixed on the server: a new shift is taken and selling works.
      server.state.refuseShiftOpen = null;
      await user.type(screen.getByLabelText('Counted cash'), '1');
      await user.click(screen.getByRole('button', { name: 'Open shift' }));
      await waitFor(() => expect(screen.queryByTestId('shift-blocked')).not.toBeInTheDocument());
      await user.click(
        within(await screen.findByTestId('catalog')).getByRole('button', { name: /Tea/ }),
      );
      await waitFor(() => expect(screen.getByTestId('pay')).toBeEnabled(), { timeout: 5000 });
    },
  );

  it(
    'a secondary till sells into the branch shift of the primary and has no shift or cash controls',
    { timeout: 30_000 },
    async () => {
      const branchShift = {
        id: U(500),
        status: 'open' as const,
        registerId: U(4),
        registerCode: 'R1',
        openedAt: new Date().toISOString(),
        closedAt: null,
        openedBy: { membershipId: U(20), userId: U(21), fullName: 'Boss' },
      };
      // An unbound device (amendment 4): no drawer, card / transfer only.
      const secondary = (bs: DeviceSnapshot['branchShift']) =>
        snapshot({
          device: {
            ...snapshot().device,
            role: 'secondary',
            code: 'D2',
            registerId: null,
            registerCode: null,
            registerName: null,
          },
          register: null,
          branchShift: bs,
        });
      const server = fakeServer({ snap: () => secondary(null) });
      const { user } = await start(server);
      await user.click(await screen.findByRole('button', { name: 'Sara' }));
      await typePin(user);
      expect(await screen.findByTestId('no-branch-shift')).toHaveTextContent(/primary till “Till”/);
      // The primary opened the branch shift: the next sync brings it, Sara sells into it.
      server.state.snap = () => secondary(branchShift);
      await user.click(
        within(screen.getByTestId('no-branch-shift')).getByRole('button', { name: 'Sync now' }),
      );
      const catalog = await screen.findByTestId('catalog', {}, { timeout: 5000 });
      expect(screen.getByTestId('cart')).toHaveTextContent('Branch shift of Boss');
      expect(screen.queryByRole('button', { name: 'Pay in' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Close shift' })).not.toBeInTheDocument();
      expect(screen.getByTestId('drawer')).toHaveTextContent('No cash drawer');
      await user.click(within(catalog).getByRole('button', { name: /Tea/ }));
      await user.click(screen.getByTestId('pay'));
      const dialog = await screen.findByRole('dialog');
      // No cash method is offered; the card needs its reference.
      expect(within(dialog).queryByRole('button', { name: 'Cash' })).not.toBeInTheDocument();
      expect(within(dialog).queryByTestId('tendered')).not.toBeInTheDocument();
      await user.type(within(dialog).getByLabelText('Reference'), 'A1');
      await user.click(within(dialog).getByTestId('add-payment'));
      await user.click(within(dialog).getByTestId('complete-sale'));
      expect(await screen.findByTestId('last-sale')).toHaveTextContent('MAIN-D2-000001');
      await waitFor(() => expect(server.uploads.flat().some((r) => r.kind === 'sale')).toBe(true), {
        timeout: 5000,
      });
      const sale = server.uploads.flat().find((r) => r.kind === 'sale') as unknown as {
        shiftId: string;
      };
      expect(sale.shiftId).toBe(U(500));
      // A secondary logs out freely (no shift of its own).
      expect(screen.getByTestId('log-out')).toBeEnabled();
      // The primary closed it: the till goes back to "no open shift".
      server.state.snap = () =>
        secondary({ ...branchShift, status: 'closed', closedAt: new Date().toISOString() });
      await user.click(screen.getAllByRole('button', { name: 'Sync now' })[0]!);
      expect(
        await screen.findByTestId('no-branch-shift', {}, { timeout: 5000 }),
      ).toBeInTheDocument();
    },
  );

  it(
    'lets a manager close an absent cashier’s shift from the lock screen with their own PIN',
    { timeout: 30_000 },
    async () => {
      const server = fakeServer();
      const { user } = await start(server);
      await user.click(await screen.findByRole('button', { name: 'Sara' }));
      await typePin(user);
      await user.type(await screen.findByLabelText('Counted cash'), '2');
      await user.click(screen.getByRole('button', { name: 'Open shift' }));
      await screen.findByTestId('catalog');
      await user.click(screen.getByTestId('lock'));
      // Sara went home with the screen locked: the manager closes her shift.
      await user.click(await screen.findByTestId('force-close'));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Boss' }));
      await user.type(within(dialog).getByTestId('force-counted'), '2.000');
      await user.type(within(dialog).getByTestId('force-note'), 'Sara went home');
      const pad = within(dialog).getByTestId('pin-pad');
      for (const d of '482913') await user.click(within(pad).getByRole('button', { name: d }));
      await user.click(within(pad).getByRole('button', { name: 'Enter' }));
      expect(
        await within(dialog).findByText(/Shift closed/, {}, { timeout: 5000 }),
      ).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Back to the till' }));
      // Sara is logged out; anyone can sign in now; the close went up as forced.
      expect(
        await screen.findByRole('heading', { name: 'Who is at the till?' }),
      ).toBeInTheDocument();
      await waitFor(
        () =>
          expect(
            server.uploads.flat().find((r) => r.kind === 'shift_close') as
              { forced?: boolean; note?: string } | undefined,
          ).toMatchObject({ forced: true, note: 'Sara went home' }),
        { timeout: 5000 },
      );
    },
  );
});
