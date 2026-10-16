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
    openingExpected: money('50.000'),
    openingDiscrepancy: money('0.000'),
    openingIsInitial: false,
  },
  countedCash: null,
  discrepancy: null,
  outcome: null,
  countedBreakdown: null,
  closingNote: null,
  movements: [],
  version: 1,
  blindCount: false,
  openingDiscrepancy: money('0.000'),
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
                expectedCash: money('25.000'),
                blindCount: false,
                needsCount: false,
                availability: 'free',
                occupiedBy: null,
              },
              {
                id: '0190a000-0000-7000-8000-000000000102',
                code: 'R2',
                nameEn: 'Register 2',
                nameAr: null,
                defaultOpeningFloat: money('0.000'),
                expectedCash: money('0.000'),
                blindCount: false,
                needsCount: true,
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
    // The drawer keeps its cash between shifts: the cashier counts against the expected balance.
    expect(screen.getByTestId('open-expected')).toHaveTextContent('KWD 25.000');
    await userEvent.type(screen.getByLabelText('Counted cash (KWD)'), '24');
    expect(screen.getByTestId('open-difference')).toHaveTextContent('KWD -1.000');
    // A difference needs an explanation before opening.
    expect(screen.getByRole('button', { name: 'Open shift' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Note (optional)'), 'one note missing');
    await userEvent.click(screen.getByRole('button', { name: 'Open shift' }));
    expect(await screen.findByRole('heading', { name: 'Products' })).toBeInTheDocument();
    expect(
      fetch.calls.find((c) => c.method === 'POST' && c.path === '/pos/shifts')?.body,
    ).toMatchObject({
      registerId: SHIFT.registerId,
      countedCash: '24.000',
      expectedCash: '25.000',
      note: 'one note missing',
    });
  });

  it('counts blind when the company policy hides the expected balance (BR-162)', async () => {
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
                expectedCash: null,
                blindCount: true,
                needsCount: false,
                availability: 'free',
                occupiedBy: null,
              },
            ],
          },
        }),
        'POST /pos/shifts': () => {
          shift = {
            ...SHIFT,
            summary: null,
            blindCount: true,
            openingDiscrepancy: money('-1.000'),
          };
          return { status: 201, body: shift };
        },
      },
    });
    renderApp({ routes, appInterface: 'pos', i18n, fetch });
    await userEvent.click(await screen.findByRole('radio', { name: /Register 1/ }));
    // No expected balance, no live difference, no note demanded before the count.
    expect(screen.getByTestId('blind-count')).toBeInTheDocument();
    expect(screen.queryByTestId('open-expected')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Counted cash (KWD)'), '24');
    expect(screen.queryByTestId('open-difference')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open shift' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Open shift' }));
    expect(await screen.findByRole('heading', { name: 'Products' })).toBeInTheDocument();
    const body = fetch.calls.find((c) => c.method === 'POST' && c.path === '/pos/shifts')?.body as
      Record<string, unknown> | undefined;
    expect(body).toMatchObject({ registerId: SHIFT.registerId, countedCash: '24.000' });
    expect(body).not.toHaveProperty('expectedCash');
    // The difference is revealed only after the count was recorded.
    expect(await screen.findByText(/Difference found at opening: KWD -1\.000/)).toBeInTheDocument();
  });

  it('withholds drawer figures on the shift page under a blind count', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('pos', ['pos.access', 'shifts.operate']),
      routes: {
        'GET /pos/shifts/current': () => ({
          status: 200,
          body: { shift: { ...SHIFT, summary: null, blindCount: true } },
        }),
      },
    });
    renderApp({ routes, appInterface: 'pos', i18n, fetch, path: '/shift' });
    expect(await screen.findByTestId('blind-count')).toBeInTheDocument();
    expect(screen.queryByTestId('expected-cash')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close shift' })).toBeEnabled();
  });

  it('sends an "other" cash-out above the company limit to a manager and lets the cashier withdraw it (BR-164)', async () => {
    const pendingMovement = {
      id: '0190a000-0000-7000-8000-000000000601',
      kind: 'cash_out',
      amount: money('30.000'),
      reason: 'other',
      note: 'repair',
      createdBy: 'Cashier',
      createdByUserId: 'u1',
      createdAt: '2026-10-12T06:00:00.000Z',
      status: 'pending',
      correctsMovementId: null,
      limitExceeded: true,
      ownerOverride: false,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
    };
    let shift: unknown = SHIFT;
    const fetch = fakeApiFetch({
      session: makeSession('pos', ['pos.access', 'shifts.operate', 'cash.move']),
      routes: {
        'GET /pos/shifts/current': () => ({ status: 200, body: { shift } }),
        'GET /pos/sales/settings': () => ({
          status: 200,
          body: {
            maxDiscountPercent: '10',
            refundWindowDays: 30,
            refundApprovalLimit: money('20.000'),
            blindCashCount: true,
            cashOutOtherLimit: money('20.000'),
            cashOutOtherShiftLimit: money('50.000'),
            maxRegisterTolerance: money('1.000'),
            expenseApprovalLimit: money('20.000'),
            supplierPaymentApprovalLimit: money('100.000'),
            adjustmentApprovalLimit: money('50.000'),
            blindStockCount: true,
            priceOverrideFloorPercent: '50',
            priceOverrideCeilingPercent: '200',
            priceOverrideBelowCost: false,
            refundOwnSalesNeedApproval: true,
            requireTenderReference: true,
            heldSaleExpiryHours: 24,
            cartClearLogThreshold: money('5.000'),
            version: 1,
          },
        }),
        'POST /pos/shifts/current/cash-movements': () => {
          shift = { ...SHIFT, movements: [pendingMovement] };
          return { status: 201, body: shift };
        },
        'POST /pos/shifts/current/cash-movements/0190a000-0000-7000-8000-000000000601/withdraw':
          () => {
            shift = { ...SHIFT, movements: [{ ...pendingMovement, status: 'withdrawn' }] };
            return { status: 201, body: shift };
          },
      },
    });
    renderApp({ routes, appInterface: 'pos', i18n, fetch, path: '/shift' });
    await userEvent.click(await screen.findByRole('button', { name: 'Cash out' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Reason'), 'other');
    await userEvent.type(within(dialog).getByLabelText('Amount (KWD)'), '30');
    // The cashier is warned before confirming that this amount waits for a manager.
    expect(await within(dialog).findByTestId('cash-out-limit')).toHaveTextContent(
      'Above KWD 20.000',
    );
    await userEvent.type(within(dialog).getByLabelText('Description'), 'repair');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByTestId('movement-pending')).toHaveTextContent('Awaiting approval');
    const sent = fetch.calls.find(
      (c) => c.method === 'POST' && c.path === '/pos/shifts/current/cash-movements',
    );
    expect(sent?.body).toMatchObject({ kind: 'cash_out', reason: 'other', amount: '30' });
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(await screen.findByTestId('movement-withdrawn')).toHaveTextContent('Withdrawn');
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
    // A visible difference (50.000 expected) needs an explanation before closing (BR-164).
    expect(within(dialog).getByTestId('close-difference')).toHaveTextContent('KWD -3.250');
    expect(within(dialog).getByRole('button', { name: 'Close shift' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Note (optional)'), 'coins missing');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close shift' }));
    expect(await screen.findByTestId('discrepancy')).toHaveTextContent('KWD -0.250');
    const call = await vi.waitFor(() => {
      const c = fetch.calls.find((x) => x.path === '/pos/shifts/current/close');
      if (!c) throw new Error('not yet');
      return c;
    });
    expect(call.body).toMatchObject({ countedCash: '46.750', version: 1 });
  });

  it('scans a barcode, prices the cart exactly and pays cash with change', async () => {
    const item = {
      variantId: '0190a000-0000-7000-8000-000000000a01',
      productId: '0190a000-0000-7000-8000-000000000b01',
      categoryId: null,
      nameEn: 'Karak tea',
      nameAr: 'شاي كرك',
      variantNameEn: null,
      variantNameAr: null,
      sku: 'TEA',
      barcodes: ['6281000000017'],
      price: money('0.333'),
      trackInventory: true,
      imageUrl: null,
    };
    const sale = {
      id: '0190a000-0000-7000-8000-000000000c01',
      orderId: 'o',
      receiptNumber: 'MAIN-000001',
      branchId: SHIFT.branchId,
      registerId: SHIFT.registerId,
      shiftId: SHIFT.id,
      cashierName: 'Cashier',
      createdAt: '2026-10-12T06:00:00.000Z',
      subtotal: money('0.999'),
      lineDiscounts: money('0.000'),
      orderDiscount: money('0.000'),
      total: money('0.999'),
      paid: money('0.999'),
      change: money('4.001'),
      refunded: money('0.000'),
      customer: null,
      lines: [],
      payments: [],
    };
    const fetch = fakeApiFetch({
      session: makeSession('pos', ['pos.access', 'shifts.operate', 'sales.create']),
      routes: {
        'GET /pos/shifts/current': () => ({ status: 200, body: { shift: SHIFT } }),
        'GET /pos/catalog': () => ({
          status: 200,
          body: { branchId: SHIFT.branchId, categories: [], items: [item], version: 'v1' },
        }),
        'GET /pos/inventory/availability': () => ({
          status: 200,
          body: {
            branchId: SHIFT.branchId,
            allowNegativeStock: false,
            items: [{ variantId: item.variantId, onHand: '5.000', status: 'in_stock' }],
          },
        }),
        'GET /pos/payment-methods': () => ({
          status: 200,
          body: {
            methods: [
              {
                id: '0190a000-0000-7000-8000-000000000d01',
                kind: 'cash',
                nameEn: 'Cash',
                nameAr: null,
                sortOrder: 0,
              },
            ],
          },
        }),
        'POST /pos/sales': () => ({ status: 201, body: sale }),
        'GET /pos/sales/0190a000-0000-7000-8000-000000000c01/receipt': () => ({
          status: 200,
          body: {
            sale,
            merchant: { nameEn: 'Demo', nameAr: null },
            branch: {
              nameEn: 'Main',
              nameAr: null,
              phone: null,
              address: null,
              receiptHeader: null,
              receiptFooter: null,
            },
            register: { code: 'R1', nameEn: 'Register 1', nameAr: null },
          },
        }),
      },
    });
    renderApp({ routes, appInterface: 'pos', i18n, fetch });
    const search = await screen.findByLabelText('Search or scan barcode');
    await screen.findByText('Karak tea');
    for (let i = 0; i < 3; i++) await userEvent.type(search, '6281000000017{Enter}');
    expect(screen.getAllByTestId('cart-line')).toHaveLength(1);
    expect(screen.getByTestId('cart-total')).toHaveTextContent('KWD 0.999');
    expect(await screen.findByTestId('tile-stock')).toHaveTextContent('In stock: 5');
    // Tapping a line shows its −/+ buttons; they step the line by one unit.
    expect(screen.queryByRole('button', { name: 'Increase quantity' })).toBeNull();
    await userEvent.click(screen.getByTestId('cart-line'));
    await userEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(screen.getByTestId('line-qty')).toHaveTextContent('4');
    expect(screen.getByTestId('cart-total')).toHaveTextContent('KWD 1.332');
    await userEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(screen.getByTestId('line-qty')).toHaveTextContent('3');
    expect(screen.getByTestId('cart-total')).toHaveTextContent('KWD 0.999');
    // Edit opens the full line dialog; tapping the line again hides the quick actions.
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const lineDialog = await screen.findByRole('dialog');
    await userEvent.click(within(lineDialog).getByRole('button', { name: 'Done' }));
    await userEvent.click(screen.getByTestId('cart-line'));
    expect(screen.queryByRole('button', { name: 'Increase quantity' })).toBeNull();
    // Clear needs a second tap: one slip does not wipe the sale.
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getAllByTestId('cart-line')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Confirm clear' })).toBeInTheDocument();
    // Cashiers without the permission may still enter a discount: a supervisor authorises it
    // at payment (BR-177).
    expect(screen.getByRole('button', { name: 'Discount on sale' })).toBeEnabled();
    await userEvent.type(search, 'nothing{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('No product found');

    // F12 is the desktop shortcut for Pay.
    await userEvent.keyboard('{F12}');
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Cash' }));
    await userEvent.type(within(dialog).getByLabelText('Cash received (KWD)'), '5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add payment' }));
    expect(within(dialog).getByTestId('remaining')).toHaveTextContent('KWD 0.000');
    expect(within(dialog).getByTestId('change')).toHaveTextContent('KWD 4.001');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Complete sale' }));
    expect(await screen.findAllByTestId('receipt-number')).not.toHaveLength(0);
    const call = fetch.calls.find((c) => c.method === 'POST' && c.path === '/pos/sales')!;
    expect(call.body).toMatchObject({
      lines: [{ variantId: item.variantId, quantity: '3' }],
      payments: [{ amount: '0.999', tendered: '5.000' }],
      expectedTotal: '0.999',
    });
    expect((call.body as { idempotencyKey: string }).idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('lets a supervisor authorise a discount beyond the cashier’s rights on the cashier’s till (BR-177)', async () => {
    const item = {
      variantId: '0190a000-0000-7000-8000-000000000a03',
      productId: '0190a000-0000-7000-8000-000000000b03',
      categoryId: null,
      nameEn: 'Oud oil',
      nameAr: null,
      variantNameEn: null,
      variantNameAr: null,
      sku: 'OUD',
      barcodes: [],
      price: money('10.000'),
      trackInventory: false,
      imageUrl: null,
    };
    const sale = {
      id: '0190a000-0000-7000-8000-000000000c03',
      orderId: 'o',
      receiptNumber: 'MAIN-000003',
      branchId: SHIFT.branchId,
      registerId: SHIFT.registerId,
      shiftId: SHIFT.id,
      cashierName: 'Cashier',
      createdAt: '2026-10-12T06:00:00.000Z',
      subtotal: money('10.000'),
      lineDiscounts: money('0.000'),
      orderDiscount: money('1.500'),
      total: money('8.500'),
      paid: money('8.500'),
      change: money('0.000'),
      refunded: money('0.000'),
      customer: null,
      lines: [],
      payments: [],
    };
    const fetch = fakeApiFetch({
      // No discount right at all: the cashier needs a supervisor for any discount.
      session: makeSession('pos', ['pos.access', 'shifts.operate', 'sales.create']),
      routes: {
        'GET /pos/shifts/current': () => ({ status: 200, body: { shift: SHIFT } }),
        'GET /pos/catalog': () => ({
          status: 200,
          body: { branchId: SHIFT.branchId, categories: [], items: [item], version: 'v1' },
        }),
        'GET /pos/inventory/availability': () => ({
          status: 200,
          body: { branchId: SHIFT.branchId, allowNegativeStock: false, items: [] },
        }),
        'GET /pos/sales/settings': () => ({
          status: 200,
          body: {
            maxDiscountPercent: '10',
            refundWindowDays: 30,
            refundApprovalLimit: money('20.000'),
            blindCashCount: true,
            cashOutOtherLimit: money('20.000'),
            cashOutOtherShiftLimit: money('50.000'),
            maxRegisterTolerance: money('1.000'),
            expenseApprovalLimit: money('20.000'),
            supplierPaymentApprovalLimit: money('100.000'),
            adjustmentApprovalLimit: money('50.000'),
            blindStockCount: true,
            priceOverrideFloorPercent: '50',
            priceOverrideCeilingPercent: '200',
            priceOverrideBelowCost: false,
            refundOwnSalesNeedApproval: true,
            requireTenderReference: true,
            heldSaleExpiryHours: 24,
            cartClearLogThreshold: money('5.000'),
            version: 1,
          },
        }),
        'GET /pos/payment-methods': () => ({
          status: 200,
          body: {
            methods: [
              {
                id: '0190a000-0000-7000-8000-000000000d01',
                kind: 'cash',
                nameEn: 'Cash',
                nameAr: null,
                sortOrder: 0,
              },
            ],
          },
        }),
        'POST /pos/overrides': () => ({
          status: 201,
          body: {
            id: '0190a000-0000-7000-8000-000000000f01',
            approverName: 'Sara Supervisor',
            permissions: ['sales.discount', 'sales.discount.override_limit'],
            expiresAt: '2030-01-01T00:00:00.000Z',
          },
        }),
        'POST /pos/sales': () => ({ status: 201, body: sale }),
        'GET /pos/sales/0190a000-0000-7000-8000-000000000c03/receipt': () => ({
          status: 200,
          body: {
            sale,
            merchant: { nameEn: 'Demo', nameAr: null },
            branch: {
              nameEn: 'Main',
              nameAr: null,
              phone: null,
              address: null,
              receiptHeader: null,
              receiptFooter: null,
            },
            register: { code: 'R1', nameEn: 'Register 1', nameAr: null },
          },
        }),
      },
    });
    renderApp({ routes, appInterface: 'pos', i18n, fetch });
    await userEvent.click(await screen.findByTestId('product-tile'));
    // A 15 % sale discount: above the 10 % limit, and the cashier may not discount at all.
    await userEvent.click(screen.getByRole('button', { name: 'Discount on sale' }));
    const discount = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(discount).getByLabelText('Discount'), 'percent');
    await userEvent.type(within(discount).getByLabelText('Percent (%)'), '15');
    await userEvent.click(within(discount).getByRole('button', { name: 'Done' }));
    expect(screen.getByTestId('cart-total')).toHaveTextContent('KWD 8.500');
    await userEvent.click(screen.getByRole('button', { name: /^Pay/ }));
    const pay = await screen.findByRole('dialog');
    const panel = within(pay).getByTestId('supervisor-panel');
    expect(panel).toHaveTextContent('discount · discount above the limit');
    await userEvent.click(within(pay).getByRole('button', { name: 'Cash' }));
    await userEvent.click(within(pay).getByRole('button', { name: 'Add payment' }));
    // Paid in full, but still blocked until a supervisor authorises it.
    expect(within(pay).getByRole('button', { name: 'Complete sale' })).toBeDisabled();
    await userEvent.type(within(panel).getByLabelText('Supervisor e-mail'), 'sara@shop.test');
    await userEvent.type(within(panel).getByLabelText('Supervisor password'), 'Sara-Pass-2026');
    await userEvent.click(within(panel).getByRole('button', { name: 'Authorise' }));
    expect(await within(pay).findByTestId('supervisor-granted')).toHaveTextContent(
      'Authorised by Sara Supervisor.',
    );
    expect(
      fetch.calls.find((c) => c.method === 'POST' && c.path === '/pos/overrides')?.body,
    ).toEqual({ email: 'sara@shop.test', password: 'Sara-Pass-2026', note: null });
    await userEvent.click(within(pay).getByRole('button', { name: 'Complete sale' }));
    expect(await screen.findAllByTestId('receipt-number')).not.toHaveLength(0);
    expect(
      fetch.calls.find((c) => c.method === 'POST' && c.path === '/pos/sales')?.body,
    ).toMatchObject({
      orderDiscount: { type: 'percent', value: '15' },
      overrideId: '0190a000-0000-7000-8000-000000000f01',
      expectedTotal: '8.500',
    });
  });

  it('creates a customer at the till, links it to the sale and prints it on the receipt', async () => {
    const item = {
      variantId: '0190a000-0000-7000-8000-000000000a02',
      productId: '0190a000-0000-7000-8000-000000000b02',
      categoryId: null,
      nameEn: 'Juice',
      nameAr: null,
      variantNameEn: null,
      variantNameAr: null,
      sku: 'JUICE',
      barcodes: [],
      price: money('0.250'),
      trackInventory: false,
      imageUrl: null,
    };
    const noura = {
      id: '0190a000-0000-7000-8000-000000000e01',
      code: 'C-000007',
      fullName: 'Noura',
      phone: '+96599990000',
      status: 'active',
    };
    const sale = {
      id: '0190a000-0000-7000-8000-000000000c02',
      orderId: 'o',
      receiptNumber: 'MAIN-000002',
      branchId: SHIFT.branchId,
      registerId: SHIFT.registerId,
      shiftId: SHIFT.id,
      cashierName: 'Cashier',
      createdAt: '2026-10-12T06:00:00.000Z',
      subtotal: money('0.250'),
      lineDiscounts: money('0.000'),
      orderDiscount: money('0.000'),
      total: money('0.250'),
      paid: money('0.250'),
      change: money('0.000'),
      refunded: money('0.000'),
      customer: { id: noura.id, code: noura.code, fullName: noura.fullName },
      lines: [],
      payments: [],
    };
    const fetch = fakeApiFetch({
      session: makeSession('pos', [
        'pos.access',
        'shifts.operate',
        'sales.create',
        'customers.read',
        'customers.create',
      ]),
      routes: {
        'GET /pos/shifts/current': () => ({ status: 200, body: { shift: SHIFT } }),
        'GET /pos/catalog': () => ({
          status: 200,
          body: { branchId: SHIFT.branchId, categories: [], items: [item], version: 'v1' },
        }),
        'GET /pos/inventory/availability': () => ({
          status: 200,
          body: { branchId: SHIFT.branchId, allowNegativeStock: false, items: [] },
        }),
        'GET /pos/payment-methods': () => ({
          status: 200,
          body: {
            methods: [
              {
                id: '0190a000-0000-7000-8000-000000000d01',
                kind: 'cash',
                nameEn: 'Cash',
                nameAr: null,
                sortOrder: 0,
              },
            ],
          },
        }),
        'GET /pos/customers': () => ({ status: 200, body: { customers: [] } }),
        'POST /pos/customers': () => ({ status: 201, body: noura }),
        'POST /pos/sales': () => ({ status: 201, body: sale }),
        [`GET /pos/sales/${sale.id}/receipt`]: () => ({
          status: 200,
          body: {
            sale,
            merchant: { nameEn: 'Demo', nameAr: null },
            branch: {
              nameEn: 'Main',
              nameAr: null,
              phone: null,
              address: null,
              receiptHeader: null,
              receiptFooter: null,
            },
            register: { code: 'R1', nameEn: 'Register 1', nameAr: null },
          },
        }),
      },
    });
    renderApp({ routes, appInterface: 'pos', i18n, fetch });
    await screen.findByText('Juice');
    await userEvent.click(screen.getByTestId('product-tile'));
    expect(screen.getByTestId('cart-customer')).toHaveTextContent('Walk-in');

    await userEvent.click(screen.getByRole('button', { name: 'Choose customer' }));
    let dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name, phone or code'), '99990000');
    expect(await within(dialog).findByText('No customer found.')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'New customer' }));
    expect(within(dialog).getByLabelText('Phone')).toHaveValue('99990000');
    await userEvent.type(within(dialog).getByLabelText('Full name'), 'Noura');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save and use' }));
    expect(await screen.findByTestId('cart-customer')).toHaveTextContent('Noura');

    await userEvent.click(screen.getByRole('button', { name: /Pay/ }));
    dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Cash' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add payment' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Complete sale' }));
    expect((await screen.findAllByTestId('receipt-customer'))[0]).toHaveTextContent('Noura');
    const created = fetch.calls.find((c) => c.method === 'POST' && c.path === '/pos/customers')!;
    expect(created.body).toEqual({ fullName: 'Noura', phone: '99990000' });
    const checkout = fetch.calls.find((c) => c.method === 'POST' && c.path === '/pos/sales')!;
    expect(checkout.body).toMatchObject({ customerId: noura.id, expectedTotal: '0.250' });
  });

  it('opens the assistant from the strip (F9), sends the question with the cart and shows the answer (ADR-0107)', async () => {
    const item = {
      variantId: '0190a000-0000-7000-8000-000000000a01',
      productId: '0190a000-0000-7000-8000-000000000b01',
      categoryId: null,
      nameEn: 'Karak tea',
      nameAr: 'شاي كرك',
      variantNameEn: null,
      variantNameAr: null,
      sku: 'TEA',
      barcodes: ['6281000000017'],
      price: money('0.333'),
      trackInventory: false,
      imageUrl: null,
    };
    const fetch = fakeApiFetch({
      session: makeSession('pos', ['pos.access', 'shifts.operate', 'sales.create']),
      routes: {
        'GET /pos/shifts/current': () => ({ status: 200, body: { shift: SHIFT } }),
        'GET /pos/catalog': () => ({
          status: 200,
          body: { branchId: SHIFT.branchId, categories: [], items: [item], version: 'v1' },
        }),
        'GET /pos/inventory/availability': () => ({
          status: 200,
          body: { branchId: SHIFT.branchId, allowNegativeStock: false, items: [] },
        }),
        'GET /pos/assistant': () => ({ status: 200, body: { enabled: true } }),
        'POST /pos/assistant/chat': () => ({
          status: 200,
          body: { reply: 'Press F8 to hold the sale.', toolsUsed: [] },
        }),
      },
    });
    renderApp({ routes, appInterface: 'pos', i18n, fetch });
    await userEvent.click(await screen.findByTestId('product-tile'));
    await userEvent.click(screen.getByRole('button', { name: 'Assistant' }));
    let dialog = await screen.findByRole('dialog', { name: 'Cashier assistant' });
    // Empty thread: the intro and the suggested questions.
    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'How do I hold a sale?' }),
    );
    expect(await within(dialog).findByTestId('assistant-assistant')).toHaveTextContent(
      'Press F8 to hold the sale.',
    );
    expect(within(dialog).getByTestId('assistant-user')).toHaveTextContent('How do I hold a sale?');
    const call = fetch.calls.find((c) => c.method === 'POST' && c.path === '/pos/assistant/chat')!;
    expect(call.body).toEqual({
      messages: [{ role: 'user', content: 'How do I hold a sale?' }],
      language: 'en',
      cart: {
        lines: [{ name: 'Karak tea', quantity: '1', unitPrice: '0.333', lineTotal: '0.333' }],
        total: '0.333',
        customer: null,
      },
      conversationId: expect.any(String),
    });
    // Closing keeps the thread; F9 reopens it and a typed follow-up carries the history.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.keyboard('{F9}');
    dialog = await screen.findByRole('dialog', { name: 'Cashier assistant' });
    expect(within(dialog).getByTestId('assistant-assistant')).toBeInTheDocument();
    await userEvent.type(
      within(dialog).getByLabelText('Type your question…'),
      'and resume?{Enter}',
    );
    expect(await within(dialog).findAllByTestId('assistant-assistant')).toHaveLength(2);
    const second = fetch.calls.filter((c) => c.path === '/pos/assistant/chat')[1]!;
    expect((second.body as { messages: unknown[] }).messages).toHaveLength(3);
    // The same conversation id until "New conversation".
    expect((second.body as { conversationId: string }).conversationId).toBe(
      (call.body as { conversationId: string }).conversationId,
    );
    // "New conversation" empties the thread.
    await userEvent.click(within(dialog).getAllByRole('button', { name: /New conversation/ })[0]!);
    expect(within(dialog).queryByTestId('assistant-user')).toBeNull();
  });

  it('tells the cashier when the assistant is not configured and takes no input', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('pos', ['pos.access', 'shifts.operate', 'sales.create']),
      routes: {
        'GET /pos/shifts/current': () => ({ status: 200, body: { shift: SHIFT } }),
        'GET /pos/catalog': () => ({
          status: 200,
          body: { branchId: SHIFT.branchId, categories: [], items: [], version: 'v1' },
        }),
        'GET /pos/inventory/availability': () => ({
          status: 200,
          body: { branchId: SHIFT.branchId, allowNegativeStock: false, items: [] },
        }),
        'GET /pos/assistant': () => ({ status: 200, body: { enabled: false } }),
      },
    });
    renderApp({ routes, appInterface: 'pos', i18n, fetch });
    await userEvent.click(await screen.findByRole('button', { name: 'Assistant' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cashier assistant' });
    expect(await within(dialog).findByTestId('assistant-disabled')).toHaveTextContent(
      'The assistant is not enabled for this system yet.',
    );
    expect(within(dialog).getByLabelText('Type your question…')).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: 'How do I hold a sale?' })).toBeNull();
    expect(fetch.calls.some((c) => c.path === '/pos/assistant/chat')).toBe(false);
  });

  it('defines the same translation keys in Arabic and English', () => {
    expect(flattenKeys(resources.ar).sort()).toEqual(flattenKeys(resources.en).sort());
  });
});
