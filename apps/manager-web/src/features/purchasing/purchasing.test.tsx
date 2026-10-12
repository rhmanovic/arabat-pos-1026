import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { i18n } from '../../i18n/index.js';
import { routes } from '../../routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const BRANCH = '0190a000-0000-7000-8000-000000000001';
const SUPPLIER = '0190a000-0000-7000-8000-0000000000c1';
const ORDER = '0190a000-0000-7000-8000-0000000000d1';
const money = (amount: string) => ({ amount, currency: 'KWD' });

const branches = {
  branches: [
    {
      id: BRANCH,
      code: 'MAIN',
      nameEn: 'Main',
      nameAr: 'الرئيسي',
      status: 'active',
      isMain: true,
      timezone: 'Asia/Kuwait',
      phone: null,
      address: null,
      receiptHeader: null,
      receiptFooter: null,
      version: 1,
      employeeCount: 1,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  ],
};

const supplier = {
  id: SUPPLIER,
  code: 'ALM',
  nameEn: 'Al Muhalab Trading',
  nameAr: null,
  contactName: null,
  phone: null,
  email: null,
  address: null,
  taxNumber: null,
  paymentTerms: null,
  notes: null,
  status: 'active',
  orderCount: 1,
  purchasedTotal: money('0.000'),
  version: 1,
};

const order = (overrides: Record<string, unknown> = {}) => ({
  id: ORDER,
  number: 'PO-000001',
  supplierId: SUPPLIER,
  supplierName: { nameEn: 'Al Muhalab Trading', nameAr: null },
  branchId: BRANCH,
  status: 'approved',
  expectedDate: null,
  note: null,
  total: money('37.500'),
  receivedValue: money('0.000'),
  createdBy: 'Rana',
  approvedBy: 'Owner',
  closeReason: null,
  createdAt: '2026-10-12T08:00:00.000Z',
  lines: [
    {
      position: 0,
      variantId: '0190a000-0000-7000-8000-0000000000aa',
      nameEn: 'Karak tea',
      nameAr: null,
      variantNameEn: null,
      variantNameAr: null,
      sku: 'TEA-1',
      quantity: '10.000',
      receivedQuantity: '0.000',
      remainingQuantity: '10.000',
      unitCost: money('3.750'),
      total: money('37.500'),
    },
  ],
  receipts: [],
  version: 3,
  ...overrides,
});

describe('purchase orders', () => {
  it('receives part of an approved order with the typed quantity and an idempotency key', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', [
        'manager.access',
        'branches.read',
        'purchasing.read',
        'purchasing.receive',
      ]),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        'GET /manager/suppliers': () => ({ status: 200, body: { suppliers: [supplier] } }),
        [`GET /manager/purchase-orders/${ORDER}`]: () => ({ status: 200, body: order() }),
        [`POST /manager/purchase-orders/${ORDER}/receipts`]: () => ({
          status: 201,
          body: order({ status: 'partially_received', version: 4 }),
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: `/purchasing/${ORDER}`, fetch });

    // A receiver without purchasing.approve sees neither approve nor close.
    await userEvent.click(await screen.findByRole('button', { name: 'Receive delivery' }));
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    const dialog = await screen.findByRole('dialog');
    const line = within(dialog).getByTestId('receive-line');
    const input = within(line).getByLabelText('Receiving now');
    expect(input).toHaveValue('10');
    await userEvent.clear(input);
    await userEvent.type(input, '4.5');
    await userEvent.type(
      within(dialog).getByLabelText('Supplier invoice / delivery note'),
      'INV-77',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Receive delivery' }));

    expect(await screen.findByText('Delivery received into stock')).toBeInTheDocument();
    const post = fetch.calls.find((c) => c.method === 'POST');
    expect(post?.body).toMatchObject({
      supplierReference: 'INV-77',
      lines: [{ position: 0, quantity: '4.5' }],
    });
    expect((post?.body as { idempotencyKey: string }).idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('disables receiving when every quantity is cleared', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'purchasing.read', 'purchasing.receive']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        'GET /manager/suppliers': () => ({ status: 200, body: { suppliers: [supplier] } }),
        [`GET /manager/purchase-orders/${ORDER}`]: () => ({ status: 200, body: order() }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: `/purchasing/${ORDER}`, fetch });
    await userEvent.click(await screen.findByRole('button', { name: 'Receive delivery' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.clear(within(dialog).getByLabelText('Receiving now'));
    expect(within(dialog).getByRole('button', { name: 'Receive delivery' })).toBeDisabled();
  });
});
