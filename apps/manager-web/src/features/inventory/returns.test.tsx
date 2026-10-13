import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n/index.js';
import { routes } from '../../routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const held = {
  id: '0190a000-0000-7000-8000-0000000000d1',
  refundId: '0190a000-0000-7000-8000-0000000000d2',
  refundNumber: 'MAIN-000003-R1',
  branchId: '0190a000-0000-7000-8000-000000000001',
  variantId: '0190a000-0000-7000-8000-0000000000aa',
  nameEn: 'Desk lamp',
  nameAr: null,
  variantNameEn: null,
  variantNameAr: null,
  sku: 'LAMP',
  quantity: '1.000',
  unitCost: { amount: '4.000', currency: 'KWD' },
  reason: 'damaged',
  status: 'held',
  createdAt: '2026-10-12T10:00:00.000Z',
  disposedBy: null,
  disposedAt: null,
  disposalNote: null,
};

describe('returned goods kept out of stock (BR-175)', () => {
  it('lists held returns and records their disposal with a note', async () => {
    const disposals: unknown[] = [];
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'inventory.read', 'inventory.adjust']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: { branches: [] } }),
        'GET /manager/inventory/damaged-returns': () => ({
          status: 200,
          body: { returns: [held], heldCount: 1 },
        }),
        [`POST /manager/inventory/damaged-returns/${held.id}/dispose`]: (body) => {
          disposals.push(body);
          return {
            status: 201,
            body: {
              ...held,
              status: 'disposed',
              disposedBy: 'Test User',
              disposalNote: 'Scrapped',
            },
          };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/inventory/returns', fetch });
    expect(await screen.findByTestId('held-count')).toHaveTextContent('1 held');
    const table = screen.getByRole('table', { name: 'Returned goods kept out of stock' });
    expect(within(table).getByText('Desk lamp')).toBeInTheDocument();
    expect(within(table).getByText('Damaged')).toBeInTheDocument();
    await userEvent.click(within(table).getByTestId('dispose-return'));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Record disposal' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('What was done (required)'), 'Scrapped');
    await userEvent.click(confirm);
    await vi.waitFor(() => expect(disposals).toHaveLength(1));
    expect(disposals[0]).toMatchObject({ note: 'Scrapped' });
  });
});
