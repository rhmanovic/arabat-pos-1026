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
const VARIANT = '0190a000-0000-7000-8000-0000000000aa';

const level = (overrides: Record<string, unknown> = {}) => ({
  variantId: VARIANT,
  productId: '0190a000-0000-7000-8000-0000000000bb',
  nameEn: 'Karak tea',
  nameAr: 'شاي كرك',
  variantNameEn: null,
  variantNameAr: null,
  sku: 'TEA-1',
  branchId: BRANCH,
  onHand: '12.500',
  lowStockThreshold: null,
  status: 'in_stock',
  lastMovementAt: null,
  ...overrides,
});

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

const settings = (overrides: Record<string, unknown> = {}) => ({
  allowNegativeStock: false,
  costingMethod: 'weighted_average',
  adjustmentApprovalLimit: { amount: '50.000', currency: 'KWD' },
  blindStockCount: true,
  version: 1,
  ...overrides,
});
const control = {
  number: 'ADJ-000007',
  status: 'posted',
  limitExceeded: false,
  ownerOverride: false,
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  startedAt: null,
  movementsAcknowledged: false,
};

const summary = (overrides: Record<string, unknown> = {}) => ({
  branchId: null,
  trackedVariants: 3,
  lowStock: 1,
  outOfStock: 1,
  unvaluedVariants: 0,
  costingMethod: 'weighted_average',
  allowNegativeStock: false,
  ...overrides,
});

describe('inventory', () => {
  it('lists stock with exact quantities and hides costs from users without cost rights', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'inventory.read', 'branches.read']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        'GET /manager/inventory/summary': () => ({ status: 200, body: summary() }),
        'GET /manager/inventory/levels': () => ({
          status: 200,
          body: {
            levels: [
              level(),
              level({
                variantId: '0190a000-0000-7000-8000-0000000000ac',
                nameEn: 'Milk',
                sku: 'MILK',
                onHand: '-2.000',
                status: 'negative',
              }),
            ],
            total: 2,
            page: 1,
            pageSize: 25,
            costVisible: false,
          },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/inventory', fetch });
    const table = await screen.findByRole('table', { name: 'Inventory' });
    await within(table).findByText('Karak tea');
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]!).getByText('Karak tea')).toBeInTheDocument();
    expect(within(rows[1]!).getByTestId('on-hand')).toHaveTextContent('12.5');
    expect(within(rows[2]!).getByText('Negative')).toBeInTheDocument();
    expect(screen.queryByText('Stock value')).not.toBeInTheDocument();
    expect(screen.queryByText('Average cost')).not.toBeInTheDocument();
    // Read-only users get no adjust action.
    expect(screen.queryByRole('button', { name: 'New adjustment' })).not.toBeInTheDocument();
    expect(within(rows[1]!).queryByRole('link', { name: 'Adjust' })).not.toBeInTheDocument();
    expect(within(rows[1]!).getByRole('link', { name: 'History' })).toBeInTheDocument();
  });

  it('shows the stock value to users with cost rights', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', [
        'manager.access',
        'inventory.read',
        'inventory.adjust',
        'reports.inventory',
      ]),
      routes: {
        'GET /manager/inventory/summary': () => ({
          status: 200,
          body: summary({ totalValue: { amount: '1234.500', currency: 'KWD' } }),
        }),
        'GET /manager/inventory/levels': () => ({
          status: 200,
          body: {
            levels: [level({ value: { amount: '18.750', currency: 'KWD' }, avgCost: null })],
            total: 1,
            page: 1,
            pageSize: 25,
            costVisible: true,
          },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/inventory', fetch });
    expect(await screen.findByText('KWD 1,234.500')).toBeInTheDocument();
    expect(await screen.findByText('KWD 18.750')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New adjustment' })).toBeInTheDocument();
  });

  it('validates adjustment quantities before posting and posts exact strings once confirmed', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', [
        'manager.access',
        'inventory.read',
        'inventory.adjust',
        'branches.read',
      ]),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        'GET /manager/inventory/settings': () => ({ status: 200, body: settings() }),
        'GET /manager/inventory/levels': () => ({
          status: 200,
          body: { levels: [level()], total: 1, page: 1, pageSize: 10, costVisible: false },
        }),
        'POST /manager/inventory/adjustments': (body) => ({
          status: 201,
          body: {
            id: '0190a000-0000-7000-8000-0000000000cc',
            branchId: BRANCH,
            kind: 'decrease',
            reason: 'damaged',
            note: null,
            ...control,
            createdAt: '2026-10-11T10:00:00.000Z',
            createdBy: { userId: 'u', fullName: 'Owner' },
            lines: [
              {
                ...level(),
                quantity: (body as { lines: { quantity: string }[] }).lines[0]!.quantity,
                previousOnHand: '12.500',
                delta: '-1.250',
                newOnHand: '11.250',
              },
            ],
          },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/inventory/adjustments/new', fetch });
    await userEvent.selectOptions(await screen.findByLabelText('Type'), 'decrease');
    expect(screen.getByLabelText('Reason')).toHaveValue('damaged');
    await userEvent.type(screen.getByLabelText('Add items'), 'tea');
    await userEvent.click(await screen.findByRole('option', { name: /Karak tea/ }));
    const line = screen.getByTestId('adjustment-line');
    const qty = within(line).getByLabelText('Quantity');

    await userEvent.type(qty, '1.2345');
    await userEvent.click(screen.getByRole('button', { name: 'Post adjustment' }));
    expect(await within(line).findByText(/Invalid quantity/)).toBeInTheDocument();
    expect(fetch.calls.some((c) => c.method === 'POST')).toBe(false);

    await userEvent.clear(qty);
    await userEvent.type(qty, '1.25');
    expect(within(line).getByTestId('after')).toHaveTextContent('11.25');
    await userEvent.click(screen.getByRole('button', { name: 'Post adjustment' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Post adjustment' }));
    const post = await vi.waitFor(() => {
      const call = fetch.calls.find(
        (c) => c.method === 'POST' && c.path === '/manager/inventory/adjustments',
      );
      if (!call) throw new Error('not posted yet');
      return call;
    });
    expect(post.body).toMatchObject({
      branchId: BRANCH,
      kind: 'decrease',
      reason: 'damaged',
      lines: [{ variantId: VARIANT, quantity: '1.25', unitCost: null }],
    });
    expect((post.body as { idempotencyKey: string }).idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('stock controls (BR-169 / BR-170)', () => {
  const pending = {
    id: '0190a000-0000-7000-8000-0000000000dd',
    branchId: BRANCH,
    kind: 'decrease',
    reason: 'theft',
    note: null,
    ...control,
    number: 'ADJ-000009',
    status: 'pending',
    limitExceeded: true,
    value: { amount: '60.000', currency: 'KWD' },
    createdAt: '2026-10-12T10:00:00.000Z',
    createdBy: { userId: 'u-bm', fullName: 'Badr Manager' },
    lines: [
      {
        ...level(),
        quantity: '60.000',
        previousOnHand: '90.000',
        delta: '-60.000',
        newOnHand: '30.000',
        unitCost: { amount: '1.000', currency: 'KWD' },
      },
    ],
  };

  it('counts blind, reports stock that moved meanwhile and posts once acknowledged', async () => {
    const posts: Record<string, unknown>[] = [];
    const fetch = fakeApiFetch({
      session: makeSession('manager', [
        'manager.access',
        'inventory.read',
        'inventory.adjust',
        'branches.read',
      ]),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        'GET /manager/inventory/settings': () => ({ status: 200, body: settings() }),
        'GET /manager/inventory/levels': () => ({
          status: 200,
          body: { levels: [level()], total: 1, page: 1, pageSize: 10, costVisible: false },
        }),
        'POST /manager/inventory/adjustments': (body) => {
          posts.push(body as Record<string, unknown>);
          if (!(body as { acknowledgeMovements?: boolean }).acknowledgeMovements)
            return {
              status: 409,
              body: {
                type: 'urn:arabat:error:stock_moved_since_count',
                title: 'Conflict',
                status: 409,
                code: 'STOCK_MOVED_SINCE_COUNT',
                issues: [
                  { path: 'lines.0', code: 'moved_since_count', message: 'net=-2.000 movements=1' },
                ],
              },
            };
          return {
            status: 201,
            body: {
              ...pending,
              kind: 'count',
              reason: 'stock_count',
              status: 'posted',
              limitExceeded: false,
              movementsAcknowledged: true,
            },
          };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/inventory/adjustments/new', fetch });
    await userEvent.selectOptions(await screen.findByLabelText('Type'), 'count');
    expect(await screen.findByText(/Blind count/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Add items'), 'tea');
    await userEvent.click(await screen.findByRole('option', { name: /Karak tea/ }));
    const line = screen.getByTestId('adjustment-line');
    // The book quantity and the resulting balance are hidden while counting.
    expect(within(line).queryByText('Current')).not.toBeInTheDocument();
    expect(within(line).queryByTestId('after')).not.toBeInTheDocument();
    await userEvent.type(within(line).getByLabelText('Counted'), '47');
    await userEvent.click(screen.getByRole('button', { name: 'Post adjustment' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Post adjustment' }),
    );
    // Stock moved meanwhile: the items are listed and the count waits for an acknowledgement.
    const moved = await screen.findByTestId('moved-items');
    expect(moved).toHaveTextContent('Karak tea');
    expect(moved).toHaveTextContent('net=-2.000');
    expect(posts[0]).toMatchObject({ kind: 'count', acknowledgeMovements: false });
    expect(typeof posts[0]!['startedAt']).toBe('string');
    expect(screen.getByRole('button', { name: 'Post adjustment' })).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/I reviewed these movements/));
    await userEvent.click(screen.getByRole('button', { name: 'Post adjustment' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Post adjustment' }),
    );
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toMatchObject({ acknowledgeMovements: true });
  });

  it('shows a pending document and lets another holder of the adjust right decide it', async () => {
    const decisions: unknown[] = [];
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'inventory.read', 'inventory.adjust']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        [`GET /manager/inventory/adjustments/${pending.id}`]: () => ({
          status: 200,
          body: pending,
        }),
        [`POST /manager/inventory/adjustments/${pending.id}/decision`]: (body) => {
          decisions.push(body);
          return { status: 201, body: { ...pending, status: 'posted', decidedBy: 'Test User' } };
        },
      },
    });
    renderApp({
      routes,
      appInterface: 'manager',
      i18n,
      path: `/inventory/adjustments/${pending.id}`,
      fetch,
    });
    expect(await screen.findByRole('heading', { name: /ADJ-000009/ })).toBeInTheDocument();
    expect(screen.getByTestId('adjustment-value')).toHaveTextContent('KWD 60.000');
    await userEvent.click(screen.getByTestId('decide-adjustment'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await vi.waitFor(() => expect(decisions).toHaveLength(1));
    expect(decisions[0]).toMatchObject({ decision: 'approve' });
  });
});
