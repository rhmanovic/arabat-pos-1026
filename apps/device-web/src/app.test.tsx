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

function snapshot(): DeviceSnapshot {
  return {
    version: 'v1',
    full: true,
    catalogVersion: 'c1',
    serverTime: new Date().toISOString(),
    offlineLimitHours: 72,
    device: {
      id: U(1),
      name: 'Till',
      merchantId: U(2),
      branchId: U(3),
      branchCode: 'MAIN',
      registerId: U(4),
      registerCode: 'R1',
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
  };
}

/** The server as the device sees it: registration, snapshot, and an accepting upload. */
function fakeServer() {
  const uploads: { kind: string; receiptNumber?: string }[][] = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl: typeof fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith('/device/register')) {
      const body = JSON.parse(String(init?.body)) as { branchId?: string; role?: string };
      if (body.branchId && !body.role)
        return json(200, {
          status: 'select_role',
          merchantId: U(2),
          branch: { id: U(3), code: 'MAIN', nameEn: 'Main', nameAr: null },
          primaryTaken: false,
        });
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
      return json(200, { status: 'registered', device: snapshot().device, token: 'T'.repeat(43) });
    }
    if (init?.method === 'GET' && u.includes('/device/sync')) {
      const since = new URL(u, 'http://x').searchParams.get('since');
      return json(
        200,
        since ? { ...snapshot(), full: false, products: [], version: `${since}+` } : snapshot(),
      );
    }
    if (init?.method === 'POST' && u.endsWith('/device/sync')) {
      const { records } = JSON.parse(String(init.body)) as {
        records: { id: string; kind: string; receiptNumber?: string }[];
      };
      uploads.push(records);
      const results: DeviceRecordResult[] = records.map((r) => ({
        id: r.id,
        kind: r.kind,
        status: 'accepted',
        result: {},
        code: null,
        message: null,
        clockSkew: false,
      }));
      return json(200, { serverTime: new Date().toISOString(), results });
    }
    return json(404, { code: 'ROUTE_NOT_FOUND' });
  };
  return { fetch: fetchImpl, uploads };
}

describe('device till', () => {
  it('asks to open it in the Arabat app outside the bridge', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { name: 'Open this in the Arabat app' }),
    ).toBeInTheDocument();
  });

  it('registers, signs in with a PIN, opens the shift, sells, prints and uploads in order', async () => {
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
    await user.click(await screen.findByRole('button', { name: /Primary till/ }));
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
    expect(await screen.findByTestId('last-sale')).toHaveTextContent('MAIN-R1-000001');

    // Printed through the bridge with the server's template; uploaded shift first, then the sale.
    await waitFor(() => expect(bridge.printed).toHaveLength(1));
    expect(bridge.printed[0]).toContain('MAIN-R1-000001');
    await waitFor(
      () => expect(server.uploads.flat().map((r) => r.kind)).toEqual(['shift_open', 'sale']),
      { timeout: 5000 },
    );
    await waitFor(() => expect(screen.getByTestId('sync-line')).toHaveTextContent('Synced'));
  });
});
