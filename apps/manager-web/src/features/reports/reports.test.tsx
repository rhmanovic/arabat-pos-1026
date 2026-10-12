import { fakeApiFetch, makeSession, renderApp } from '@arabat/web-core/testing';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n/index.js';
import { routes } from '../../routes.js';
import { presetRange } from './ReportsPage.js';
import { change, csvCell, toCsv } from './shared.js';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(() => vi.restoreAllMocks());

const BRANCH = '0190a000-0000-7000-8000-000000000001';
const money = (amount: string) => ({ amount, currency: 'KWD' });
const summary = (net: string, count: number, refunds = '0.000') => ({
  saleCount: count,
  itemsSold: '8.000',
  gross: money('6.666'),
  lineDiscounts: money('0.000'),
  orderDiscounts: money('0.166'),
  discounts: money('0.166'),
  netSales: money(net),
  refundCount: refunds === '0.000' ? 0 : 1,
  refunds: money(refunds),
  netAfterRefunds: money(net),
  averageSale: money('2.167'),
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
const salesReport = {
  period: {
    from: '2026-10-06',
    to: '2026-10-12',
    timezone: 'Asia/Kuwait',
    previousFrom: '2026-09-29',
    previousTo: '2026-10-05',
  },
  summary: summary('6.500', 3, '1.000'),
  previous: summary('5.000', 2),
  byDay: [{ date: '2026-10-12', saleCount: 3, netSales: money('6.500'), refunds: money('1.000') }],
  byHour: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    saleCount: hour === 9 ? 3 : 0,
    netSales: money(hour === 9 ? '6.500' : '0.000'),
  })),
  byBranch: [
    {
      branchId: BRANCH,
      saleCount: 3,
      gross: money('6.666'),
      discounts: money('0.166'),
      netSales: money('6.500'),
      refunds: money('1.000'),
      netAfterRefunds: money('5.500'),
    },
  ],
  byEmployee: [],
  byPaymentMethod: [],
  byProduct: [],
  byCategory: [],
  byServiceType: [],
  byChannel: [],
  profit: null,
};

describe('reports page', () => {
  it('shows only permitted tabs, KPI changes, and exports exactly what is displayed', async () => {
    let exported = '';
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const blobs: Blob[] = [];
    const RealBlob = Blob;
    vi.stubGlobal(
      'Blob',
      class extends RealBlob {
        constructor(parts: BlobPart[], options?: BlobPropertyBag) {
          super(parts, options);
          exported = parts.join('');
          blobs.push(this);
        }
      },
    );
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access', 'reports.sales', 'branches.read']),
      routes: {
        'GET /manager/branches': () => ({ status: 200, body: branches }),
        'GET /manager/reports/sales': () => ({ status: 200, body: salesReport }),
      },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/reports', fetch });
    expect(await screen.findByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    // Sales only: no tab bar for financial reports.
    expect(screen.queryByRole('button', { name: 'Payments & cash' })).not.toBeInTheDocument();
    const net = await screen.findByTestId('kpi-net-sales');
    expect(net).toHaveTextContent('KWD 6.500');
    // (6.500 − 5.000) ÷ 5.000 = +30.0 %
    expect(net).toHaveTextContent('+30.0% vs previous period');
    expect(screen.getByTestId('kpi-refunds')).toHaveTextContent('No data in the previous period');
    expect(screen.queryByTestId('kpi-profit')).not.toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Sales by branch' });
    expect(within(table).getByText('Main')).toBeInTheDocument();
    expect(within(table).getByText('KWD 5.500')).toBeInTheDocument();
    const section = table.closest('section')!;
    await userEvent.click(within(section).getByRole('button', { name: 'Export CSV' }));
    expect(blobs).toHaveLength(1);
    expect(exported).toBe(
      '﻿Branch,Sales,Gross sales (KWD),Discounts (KWD),Net sales (KWD),Refunds (KWD),Net after refunds (KWD)\r\n' +
        'Main,3,6.666,0.166,6.500,1.000,5.500\r\n',
    );
    // The request carries the selected period.
    const call = fetch.calls.find((c) => c.path.startsWith('/manager/reports/sales'))!;
    expect(call.query).toMatch(/^from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
    vi.unstubAllGlobals();
  });

  it('denies the page without any report permission', async () => {
    const fetch = fakeApiFetch({
      session: makeSession('manager', ['manager.access']),
      routes: { 'GET /manager/branches': () => ({ status: 200, body: { branches: [] } }) },
    });
    renderApp({ routes, appInterface: 'manager', i18n, path: '/reports', fetch });
    expect(
      await screen.findByText(/do not have access|not allowed|permission/i),
    ).toBeInTheDocument();
    expect(fetch.calls.some((c) => c.path.startsWith('/manager/reports'))).toBe(false);
  });
});

describe('report helpers', () => {
  it('builds safe CSV cells', () => {
    expect(csvCell('1.500')).toBe('1.500');
    expect(csvCell('-0.250')).toBe('-0.250');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(toCsv(['a'], [['شاي']])).toBe('﻿a\r\nشاي\r\n');
  });

  it('computes period changes exactly and date presets in local days', () => {
    expect(change(6500n, 5000n)).toBe('+30.0');
    expect(change(1000n, 3000n)).toBe('-66.7');
    expect(change(1n, 0n)).toBeNull();
    expect(presetRange('last7', '2026-10-12')).toEqual({ from: '2026-10-06', to: '2026-10-12' });
    expect(presetRange('lastMonth', '2026-03-15')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(presetRange('thisMonth', '2026-10-12')).toEqual({
      from: '2026-10-01',
      to: '2026-10-12',
    });
    expect(presetRange('yesterday', '2026-01-01')).toEqual({
      from: '2025-12-31',
      to: '2025-12-31',
    });
  });
});
