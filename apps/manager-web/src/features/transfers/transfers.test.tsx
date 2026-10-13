import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n/index.js';
import { routes } from '../../routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const MAIN = '0190a000-0000-7000-8000-000000000001';
const NORTH = '0190a000-0000-7000-8000-000000000002';
const branches = {
  branches: [MAIN, NORTH].map((id, i) => ({
    id,
    code: i === 0 ? 'MAIN' : 'NORTH',
    nameEn: i === 0 ? 'Main' : 'North',
    nameAr: null,
    status: 'active',
    isMain: i === 0,
    timezone: 'Asia/Kuwait',
    phone: null,
    address: null,
    receiptHeader: null,
    receiptFooter: null,
    version: 1,
    employeeCount: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
  })),
};
const money = (amount: string) => ({ amount, currency: 'KWD' });
const loss = {
  id: '0190a000-0000-7000-8000-0000000000e1',
  number: 'TL-000004',
  status: 'pending',
  value: money('80.000'),
  explanation: 'Two boxes missing',
  limitExceeded: true,
  ownerOverride: false,
  claimedBy: 'Nora North',
  claimedByUserId: 'u-north',
  createdAt: '2026-10-12T10:00:00.000Z',
  decidedBy: null,
  decidedAt: null,
  decisionNote: null,
  lines: [{ position: 0, quantity: '2.000' }],
};
const transfer = {
  id: '0190a000-0000-7000-8000-0000000000f1',
  number: 'TR-000004',
  sourceBranchId: MAIN,
  destinationBranchId: NORTH,
  status: 'received',
  note: null,
  discrepancyNote: 'Two boxes missing',
  requestedBy: 'Owner',
  approvedBy: 'Owner',
  dispatchedBy: 'Owner',
  receivedBy: 'Nora North',
  recalledBy: null,
  recallNote: null,
  createdAt: '2026-10-11T09:00:00.000Z',
  dispatchedAt: '2026-10-11T10:00:00.000Z',
  receivedAt: '2026-10-12T10:00:00.000Z',
  recalledAt: null,
  discrepancyQuantity: '2.000',
  inTransitQuantity: '2.000',
  inTransitValue: money('80.000'),
  lostQuantity: '0.000',
  losses: [loss],
  lines: [
    {
      position: 0,
      variantId: '0190a000-0000-7000-8000-0000000000aa',
      nameEn: 'TV 55"',
      nameAr: null,
      variantNameEn: null,
      variantNameAr: null,
      sku: 'TV-55',
      requestedQuantity: '5.000',
      dispatchedQuantity: '5.000',
      receivedQuantity: '3.000',
      recalledQuantity: null,
      discrepancyQuantity: '2.000',
      lostQuantity: '0.000',
      inTransitQuantity: '2.000',
      unitCost: money('40.000'),
    },
  ],
  version: 4,
};

describe('transfer losses and in-transit stock (BR-172 / BR-173)', () => {
  it('lists goods on the road, shows a pending loss and lets the source approver decide it', async () => {
    const decisions: unknown[] = [];
    const fetch = fakeApiFetch({
      session: makeSession('manager', [
        'manager.access',
        'inventory.read',
        'inventory.transfer',
        'inventory.transfer.approve',
        'branches.read',
      ]),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        'GET /manager/transfers': () => ({
          status: 200,
          body: { transfers: [], total: 0, page: 1, pageSize: 25 },
        }),
        'GET /manager/transfers/in-transit': () => ({
          status: 200,
          body: {
            transfers: [
              {
                id: transfer.id,
                number: transfer.number,
                sourceBranchId: MAIN,
                destinationBranchId: NORTH,
                status: 'received',
                dispatchedAt: transfer.dispatchedAt,
                ageDays: 3,
                quantity: '2.000',
                value: money('80.000'),
                unresolved: true,
                pendingLoss: true,
              },
            ],
            quantity: '2.000',
            value: money('80.000'),
          },
        }),
        [`GET /manager/transfers/${transfer.id}`]: () => ({ status: 200, body: transfer }),
        [`POST /manager/transfers/${transfer.id}/losses/${loss.id}/decision`]: (body) => {
          decisions.push(body);
          return {
            status: 201,
            body: {
              ...transfer,
              inTransitQuantity: '0.000',
              lostQuantity: '2.000',
              losses: [{ ...loss, status: 'posted', decidedBy: 'Test User' }],
            },
          };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/transfers', fetch });
    const summary = await screen.findByTestId('in-transit');
    expect(summary).toHaveTextContent('In transit now (1 transfers)');
    expect(summary).toHaveTextContent('3 days on the road');
    expect(summary).toHaveTextContent('KWD 80.000');
    expect(summary).toHaveTextContent('Loss awaiting approval');
    await userEvent.click(within(summary).getByRole('link', { name: 'TR-000004' }));
    const losses = await screen.findByTestId('transfer-losses');
    expect(losses).toHaveTextContent('TL-000004');
    expect(losses).toHaveTextContent('Awaiting approval');
    expect(losses).toHaveTextContent('Two boxes missing');
    await userEvent.click(within(losses).getByTestId('decide-loss'));
    const dialog = await screen.findByRole('dialog');
    // Rejecting needs a reason; approving does not.
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve write-off' }));
    await vi.waitFor(() => expect(decisions).toHaveLength(1));
    expect(decisions[0]).toMatchObject({ decision: 'approve' });
  });

  it('recalls a transfer in transit with a reason', async () => {
    const recalls: unknown[] = [];
    const inTransit = {
      ...transfer,
      status: 'in_transit',
      receivedBy: null,
      receivedAt: null,
      discrepancyNote: null,
      discrepancyQuantity: '0.000',
      inTransitQuantity: '5.000',
      inTransitValue: money('200.000'),
      losses: [],
      lines: [
        {
          ...transfer.lines[0],
          receivedQuantity: null,
          discrepancyQuantity: null,
          inTransitQuantity: '5.000',
        },
      ],
    };
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'inventory.read', 'inventory.transfer']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        [`GET /manager/transfers/${transfer.id}`]: () => ({ status: 200, body: inTransit }),
        [`POST /manager/transfers/${transfer.id}/recall`]: (body) => {
          recalls.push(body);
          return {
            status: 201,
            body: { ...inTransit, status: 'recalled', recalledBy: 'Test User' },
          };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: `/transfers/${transfer.id}`, fetch });
    expect(await screen.findByText(/worth KWD 200\.000/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Recall' }));
    const dialog = await screen.findByRole('dialog');
    const recall = within(dialog).getByRole('button', { name: 'Recall' });
    expect(recall).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Wrong branch');
    await userEvent.click(recall);
    await vi.waitFor(() => expect(recalls).toHaveLength(1));
    expect(recalls[0]).toMatchObject({ version: 4, note: 'Wrong branch' });
  });
});
