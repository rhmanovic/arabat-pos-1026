import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n/index.js';
import { routes } from '../../routes.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

const money = (amount: string) => ({ amount, currency: 'KWD' });
const method = {
  id: '0190a000-0000-7000-8000-000000000201',
  kind: 'card',
  nameEn: 'Card (KNET)',
  nameAr: null,
  status: 'active',
  availableInPos: true,
  availableOnline: false,
  feeType: 'fixed_plus_percentage',
  feeFixed: money('0.050'),
  feePercent: '1.5',
  financialAccountId: null,
  gatewayProvider: null,
  gatewayLive: false,
  sortOrder: 1,
  version: 1,
};

describe('payment methods', () => {
  it('lists fees and previews the exact fee before saving', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'payments.settings']),
      routes: {
        'GET /manager/payment-methods': () => ({ status: 200, body: { methods: [method] } }),
        'GET /manager/financial-accounts': () => ({ status: 200, body: { accounts: [] } }),
        'POST /manager/payment-methods': (body) => ({
          status: 201,
          body: { ...method, ...(body as object), id: 'new', feeFixed: money('0.000') },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/payments', fetch });
    expect(await screen.findByTestId('method-fee')).toHaveTextContent('KWD 0.050 + 1.5%');

    await userEvent.click(screen.getByRole('button', { name: 'New payment method' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name (English)'), 'Visa');
    await userEvent.selectOptions(within(dialog).getByLabelText('Processing fee'), 'percentage');
    const pct = within(dialog).getByLabelText('Percentage (%)');
    await userEvent.clear(pct);
    await userEvent.type(pct, '2.5');
    const amount = within(dialog).getByLabelText('Preview amount (KWD)');
    await userEvent.clear(amount);
    await userEvent.type(amount, '0.333');
    // 2.5 % of 0.333 = 0.008325 → 0.008 (half-up to the fils)
    expect(within(dialog).getByTestId('fee-preview')).toHaveTextContent(
      'On a payment of KWD 0.333 the fee is KWD 0.008; you receive KWD 0.325.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    const call = await vi.waitFor(() => {
      const c = fetch.calls.find(
        (x) => x.method === 'POST' && x.path === '/manager/payment-methods',
      );
      if (!c) throw new Error('not yet');
      return c;
    });
    expect(call.body).toMatchObject({
      kind: 'card',
      nameEn: 'Visa',
      feeType: 'percentage',
      feePercent: '2.5',
    });
  });
});

describe('failed loading', () => {
  const unauthenticated = {
    status: 401,
    body: {
      type: 'urn:arabat:error:unauthenticated',
      title: 'Authentication required',
      status: 401,
      code: 'UNAUTHENTICATED',
    },
  };

  it('shows an error in the table instead of an empty list', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'payments.settings']),
      routes: {
        'GET /manager/payment-methods': () => ({
          status: 500,
          body: { type: 'x', title: 'Internal', status: 500, code: 'INTERNAL_ERROR' },
        }),
        'GET /manager/financial-accounts': () => ({ status: 200, body: { accounts: [] } }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/payments', fetch });
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  });

  it('returns to sign-in when the session ended, instead of empty pages', async () => {
    let ended = false;
    const session = makeSession('manager', ['manager.access', 'payments.settings']);
    const fetch = fakeApiFetch({
      routes: {
        'GET /auth/manager/me': () => (ended ? unauthenticated : { status: 200, body: session }),
        'GET /manager/payment-methods': () => {
          ended = true;
          return unauthenticated;
        },
        'GET /manager/financial-accounts': () => unauthenticated,
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/payments', fetch });
    expect(
      await screen.findByRole('heading', { name: 'Sign in to management' }),
    ).toBeInTheDocument();
  });
});

describe('cash custody payouts', () => {
  const branchId = '0190a000-0000-7000-8000-000000000301';
  const overview = {
    branches: [
      {
        branchId,
        nameEn: 'Main',
        nameAr: null,
        treasury: {
          accountId: '0190a000-0000-7000-8000-000000000302',
          nameEn: 'Main treasury',
          nameAr: null,
          balance: money('40.000'),
          countedAt: '2026-10-12T08:00:00.000Z',
        },
        registers: [],
        total: money('40.000'),
      },
    ],
    treasuriesTotal: money('40.000'),
    registersTotal: money('0.000'),
    inTransitTotal: money('5.000'),
    depositsInTransitTotal: money('0.000'),
    total: money('45.000'),
  };

  it('pays an expense from the treasury with its category, and shows cash in transit', async () => {
    const posted: unknown[] = [];
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'cash.custody']),
      routes: {
        'GET /manager/cash/overview': () => ({ status: 200, body: overview }),
        'POST /manager/cash/disbursements': (body) => {
          posted.push(body);
          return { status: 201, body: {} };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/cash', fetch });
    expect(await screen.findByText('In transit')).toBeInTheDocument();
    // Without cash.deposit there is no deposit action.
    expect(screen.queryByRole('button', { name: 'Deposit to bank' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pay expense / supplier' }));
    const dialog = await screen.findByRole('dialog');
    const pay = within(dialog).getByRole('button', { name: 'Pay expense / supplier' });
    await userEvent.type(within(dialog).getByLabelText('Amount'), '2.750');
    expect(pay).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByLabelText('Expense category'), 'other');
    // "Other" needs a description.
    expect(pay).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Description'), 'Water bottles');
    await userEvent.click(pay);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      branchId,
      kind: 'expense',
      category: 'other',
      amount: '2.750',
      description: 'Water bottles',
    });
  });
});

describe('cash-out approvals (BR-164)', () => {
  const shiftId = '0190a000-0000-7000-8000-000000000501';
  const pending = {
    id: '0190a000-0000-7000-8000-000000000601',
    kind: 'cash_out',
    amount: money('30.000'),
    reason: 'other',
    note: 'repair',
    createdBy: 'Sara Cashier',
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
  const shift = {
    id: shiftId,
    branchId: '0190a000-0000-7000-8000-000000000301',
    registerId: '0190a000-0000-7000-8000-000000000101',
    registerName: { nameEn: 'Register 1', nameAr: null },
    membershipId: 'm',
    employeeName: 'Sara Cashier',
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
    movements: [pending],
    version: 1,
  };

  it('lets a manager approve a pending cash-out from the shift detail', async () => {
    const decisions: unknown[] = [];
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'shifts.view_all']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: { branches: [] } }),
        [`GET /manager/shifts/${shiftId}`]: () => ({ status: 200, body: shift }),
        [`POST /manager/shifts/${shiftId}/movements/${pending.id}/decision`]: (body) => {
          decisions.push(body);
          return {
            status: 201,
            body: {
              ...shift,
              movements: [{ ...pending, status: 'posted', decidedBy: 'Test User' }],
            },
          };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: `/shifts/${shiftId}`, fetch });
    expect(await screen.findByText('Above the limit')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('decide-movement'));
    const dialog = await screen.findByRole('dialog');
    // Rejecting needs a reason; approving does not.
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await vi.waitFor(() => expect(decisions).toHaveLength(1));
    expect(decisions[0]).toMatchObject({ decision: 'approve' });
  });
});

describe('dashboard controls checklist (BR-165)', () => {
  it('warns the owner when nobody but them holds cash custody and when cash-outs wait', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'merchant.settings.read']),
      routes: {
        'GET /manager/merchant': () => ({ status: 200, body: {} }),
        'GET /manager/merchant/controls': () => ({
          status: 200,
          body: {
            treasurerAssigned: false,
            membersWithoutRoles: [{ membershipId: 'm1', fullName: 'Ali' }],
            registersAboveTolerance: [],
            pendingCashMovements: 2,
            pendingPayoutRequests: 0,
            openVariances: 0,
            depositsInTransit: 0,
            unreconciledBankEntries: 0,
            pendingAdjustments: 0,
          },
        }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/', fetch });
    const section = await screen.findByTestId('controls');
    expect(section).toHaveTextContent('Assign the Treasurer role');
    expect(section).toHaveTextContent('2 cash-outs are waiting');
    expect(section).toHaveTextContent('Ali');
  });
});

describe('treasury payments awaiting approval (BR-166)', () => {
  const request = {
    id: '0190a000-0000-7000-8000-000000000701',
    kind: 'expense',
    category: 'maintenance',
    supplier: null,
    purchaseOrder: null,
    branch: { id: '0190a000-0000-7000-8000-000000000301', nameEn: 'Main', nameAr: null },
    amount: money('25.000'),
    description: 'AC repair',
    receiptReference: 'R-1',
    status: 'pending',
    requestedBy: 'Tariq Treasurer',
    requestedByUserId: 'u-treasurer',
    createdAt: '2026-10-12T07:00:00.000Z',
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    disbursementId: null,
  };
  const overview = {
    branches: [],
    treasuriesTotal: money('0.000'),
    registersTotal: money('0.000'),
    inTransitTotal: money('0.000'),
    depositsInTransitTotal: money('0.000'),
    total: money('0.000'),
  };

  it('lets another custody holder approve a pending payment', async () => {
    const decisions: unknown[] = [];
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'cash.custody']),
      routes: {
        'GET /manager/cash/overview': () => ({ status: 200, body: overview }),
        'GET /manager/cash/payout-requests': () => ({ status: 200, body: { requests: [request] } }),
        'GET /manager/cash/disbursements': () => ({
          status: 200,
          body: { disbursements: [], netTotal: money('0.000'), total: 0, page: 1, pageSize: 100 },
        }),
        [`POST /manager/cash/payout-requests/${request.id}/decision`]: (body) => {
          decisions.push(body);
          return { status: 201, body: { ...request, status: 'approved', decidedBy: 'Test User' } };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/cash', fetch });
    await userEvent.click(await screen.findByRole('button', { name: 'Expenses & payments' }));
    const section = await screen.findByTestId('payout-requests');
    expect(section).toHaveTextContent('Tariq Treasurer');
    expect(section).toHaveTextContent('KWD 25.000');
    await userEvent.click(within(section).getByTestId('decide-payout'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await vi.waitFor(() => expect(decisions).toHaveLength(1));
    expect(decisions[0]).toMatchObject({ decision: 'approve' });
  });
});

describe('follow-up of cash differences (BR-167)', () => {
  it('lists open differences and records a follow-up', async () => {
    const followups: unknown[] = [];
    const variance = {
      sourceType: 'shift_close',
      sourceId: '0190a000-0000-7000-8000-000000000501',
      branchId: '0190a000-0000-7000-8000-000000000301',
      place: { kind: 'register', nameEn: 'Register 1', nameAr: null },
      amount: money('-2.000'),
      occurredAt: '2026-10-12T20:00:00.000Z',
      accountable: 'Sara Cashier',
      sourceNote: 'coins missing',
      followup: null,
    };
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'shifts.view_all', 'cash.custody']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: { branches: [] } }),
        'GET /manager/cash/variances': () => ({
          status: 200,
          body: { variances: [variance], openCount: 1 },
        }),
        [`POST /manager/cash/variances/shift_close/${variance.sourceId}/followup`]: (body) => {
          followups.push(body);
          return {
            status: 201,
            body: {
              ...variance,
              followup: {
                status: 'explained',
                note: 'wrong change',
                resolvedBy: 'Test User',
                resolvedAt: '2026-10-13T08:00:00.000Z',
              },
            },
          };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/shifts', fetch });
    await userEvent.click(await screen.findByRole('button', { name: 'Follow-up of differences' }));
    expect(await screen.findByTestId('variances-open')).toHaveTextContent(
      '1 differences without follow-up',
    );
    expect(screen.getByText('Sara Cashier')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('resolve-variance'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Note'), 'wrong change');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(followups).toHaveLength(1));
    expect(followups[0]).toMatchObject({ status: 'explained', note: 'wrong change' });
  });
});

describe('dashboard cash card', () => {
  it('shows the company’s cash on hand to cash custodians only', async () => {
    const overview = {
      branches: [],
      treasuriesTotal: money('30.000'),
      registersTotal: money('12.500'),
      inTransitTotal: money('5.000'),
      depositsInTransitTotal: money('0.000'),
      total: money('47.500'),
    };
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'cash.custody']),
      routes: { 'GET /manager/cash/overview': () => ({ status: 200, body: overview }) },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/', fetch });
    const card = await screen.findByTestId('dashboard-cash');
    expect(card).toHaveTextContent('KWD 47.500');
    expect(card).toHaveTextContent('In transit: KWD 5.000');
  });
});

describe('deposits in transit (BR-168)', () => {
  const branchId = '0190a000-0000-7000-8000-000000000301';
  const overview = {
    branches: [
      {
        branchId,
        nameEn: 'Main',
        nameAr: null,
        treasury: {
          accountId: '0190a000-0000-7000-8000-000000000302',
          nameEn: 'Main treasury',
          nameAr: null,
          balance: money('40.000'),
          countedAt: '2026-10-12T08:00:00.000Z',
        },
        registers: [],
        total: money('40.000'),
      },
    ],
    treasuriesTotal: money('40.000'),
    registersTotal: money('0.000'),
    inTransitTotal: money('0.000'),
    depositsInTransitTotal: money('12.000'),
    total: money('40.000'),
  };
  const deposit = {
    id: '0190a000-0000-7000-8000-000000000801',
    from: { accountId: 'r1', kind: 'register', nameEn: 'Register 1', nameAr: null },
    branchId,
    bank: { id: '0190a000-0000-7000-8000-000000000901', nameEn: 'Bank – NBK', nameAr: null },
    amount: money('12.000'),
    reference: 'SLIP-9',
    note: null,
    createdBy: 'Sara Cashier',
    createdByUserId: 'u-cashier',
    createdAt: '2026-10-12T09:00:00.000Z',
  };
  const transfer = {
    id: 't2',
    from: { accountId: 'dt', kind: 'deposit_transit', nameEn: 'Deposits in transit', nameAr: null },
    to: { accountId: deposit.bank.id, kind: 'bank', nameEn: 'Bank – NBK', nameAr: null },
    branchId,
    amount: money('12.000'),
    origin: 'deposit_confirmation',
    reference: null,
    note: null,
    createdBy: 'Test User',
    createdAt: '2026-10-12T10:00:00.000Z',
  };

  it('requires the slip number to deposit, lists deposits in transit and confirms one', async () => {
    const posted: unknown[] = [];
    const settled: unknown[] = [];
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'cash.custody', 'cash.deposit']),
      routes: {
        'GET /manager/cash/overview': () => ({ status: 200, body: overview }),
        'GET /manager/cash/bank-accounts': () => ({
          status: 200,
          body: { accounts: [deposit.bank] },
        }),
        'GET /manager/cash/payout-requests': () => ({ status: 200, body: { requests: [] } }),
        'GET /manager/cash/deposits/pending': () => ({
          status: 200,
          body: { deposits: [deposit], total: money('12.000') },
        }),
        'GET /manager/cash/disbursements': () => ({
          status: 200,
          body: { disbursements: [], netTotal: money('0.000'), total: 0, page: 1, pageSize: 100 },
        }),
        'POST /manager/cash/deposits': (body) => {
          posted.push(body);
          return { status: 201, body: { ...transfer, origin: 'deposit' } };
        },
        [`POST /manager/cash/deposits/${deposit.id}/settle`]: (body) => {
          settled.push(body);
          return { status: 201, body: transfer };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/cash', fetch });
    expect(await screen.findByText('Deposits in transit')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Deposit to bank' }));
    let dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Deposit to bank' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Bank account'), deposit.bank.id);
    await userEvent.type(within(dialog).getByLabelText('Amount'), '12');
    // No slip number, no deposit.
    expect(submit).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Deposit slip number'), 'SLIP-9');
    await userEvent.click(submit);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ bankAccountId: deposit.bank.id, reference: 'SLIP-9' });

    await userEvent.click(screen.getByRole('button', { name: 'Expenses & payments' }));
    const section = await screen.findByTestId('deposits-in-transit');
    expect(section).toHaveTextContent('SLIP-9');
    expect(section).toHaveTextContent('Sara Cashier');
    await userEvent.click(within(section).getByTestId('settle-deposit'));
    dialog = await screen.findByRole('dialog');
    // Returning needs a reason; confirming does not.
    expect(within(dialog).getByRole('button', { name: 'Return to treasury' })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Bank reference (optional)'), 'STMT-1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm in bank' }));
    await vi.waitFor(() => expect(settled).toHaveLength(1));
    expect(settled[0]).toMatchObject({ decision: 'confirm', reference: 'STMT-1' });
  });
});

describe('bank reconciliation (BR-168)', () => {
  const bank = {
    id: '0190a000-0000-7000-8000-000000000901',
    nameEn: 'Bank – NBK',
    nameAr: null,
    kind: 'bank',
    currency: 'KWD',
    status: 'active',
    balance: money('60.000'),
    unreconciledEntries: 2,
    lastReconciledAt: null,
    version: 1,
  };
  const entry = (id: string, amount: string, reference: string) => ({
    id,
    amount: money(amount),
    entryType: 'transfer',
    sourceType: 'cash_transfer',
    description: null,
    reference,
    createdBy: 'Test User',
    createdAt: '2026-10-12T10:00:00.000Z',
  });
  const state = {
    account: { id: bank.id, nameEn: bank.nameEn, nameAr: null, status: 'active' },
    bookBalance: money('60.000'),
    clearedBalance: money('0.000'),
    unreconciled: [
      entry('0190a000-0000-7000-8000-000000000a01', '40.000', 'SLIP-1'),
      entry('0190a000-0000-7000-8000-000000000a02', '20.000', 'SLIP-2'),
    ],
    last: null,
    history: [],
  };

  it('ticks statement entries, shows the difference and requires an explanation', async () => {
    const saved: unknown[] = [];
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'payments.settings', 'cash.deposit']),
      routes: {
        'GET /manager/payment-methods': () => ({ status: 200, body: { methods: [] } }),
        'GET /manager/financial-accounts': () => ({ status: 200, body: { accounts: [bank] } }),
        [`GET /manager/cash/bank-accounts/${bank.id}/reconciliation`]: () => ({
          status: 200,
          body: state,
        }),
        [`POST /manager/cash/bank-accounts/${bank.id}/reconciliations`]: (body) => {
          saved.push(body);
          return {
            status: 201,
            body: {
              id: 'rec1',
              statementDate: '2026-10-12',
              statementBalance: money('39.500'),
              bookBalance: money('60.000'),
              clearedBalance: money('40.000'),
              difference: money('-0.500'),
              itemCount: 1,
              note: 'Bank fee',
              createdBy: 'Test User',
              createdAt: '2026-10-12T11:00:00.000Z',
            },
          };
        },
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/accounts', fetch });
    expect(await screen.findByText('2 unreconciled')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reconcile' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/SLIP-1/)).toBeInTheDocument();
    const save = within(dialog).getByRole('button', { name: 'Save reconciliation' });
    expect(save).toBeDisabled();
    await userEvent.click(within(dialog).getByLabelText(/SLIP-1/));
    expect(within(dialog).getByTestId('cleared-after')).toHaveTextContent('KWD 40.000');
    await userEvent.type(within(dialog).getByLabelText('Statement balance (KWD)'), '39.500');
    expect(within(dialog).getByTestId('reconcile-difference')).toHaveTextContent('KWD -0.500');
    // A difference needs an explanation before saving.
    expect(save).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Explanation / note'), 'Bank fee');
    await userEvent.click(save);
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatchObject({
      statementBalance: '39.500',
      entryIds: ['0190a000-0000-7000-8000-000000000a01'],
      note: 'Bank fee',
    });
  });
});
