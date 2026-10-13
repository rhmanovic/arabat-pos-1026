import type { ReportQuery, SalesReport } from '@arabat/contracts';
import { Money } from '@arabat/money';
import { Field, Input, PageHeader, Select } from '@arabat/ui';
import { AccessDenied, localizedName, useApi } from '@arabat/web-core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBranchContext, useBranchName, useSession } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';
import { CashTabs } from '../cash/shared.js';
import { displayQty } from '../inventory/shared.js';
import {
  ExpensesTab,
  InventoryTab,
  PaymentsTab,
  PurchasingTab,
  ShiftsTab,
} from './OtherReports.js';
import {
  Amount,
  BarChart,
  Definitions,
  Kpi,
  ReportState,
  ReportTable,
  type TabProps,
  minorOf,
  useReport,
} from './shared.js';

type Tab = 'sales' | 'payments' | 'expenses' | 'shifts' | 'inventory' | 'purchasing';
type Preset = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth' | 'custom';

/** Today's date in the merchant's zone (YYYY-MM-DD). */
function localToday(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}
function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function presetRange(preset: Exclude<Preset, 'custom'>, today: string) {
  const month = today.slice(0, 8);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: shift(today, -1), to: shift(today, -1) };
    case 'last7':
      return { from: shift(today, -6), to: today };
    case 'last30':
      return { from: shift(today, -29), to: today };
    case 'thisMonth':
      return { from: `${month}01`, to: today };
    case 'lastMonth': {
      const end = shift(`${month}01`, -1);
      return { from: `${end.slice(0, 8)}01`, to: end };
    }
  }
}

export function ReportsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const { branchId } = useBranchContext();
  const branchName = useBranchName();
  const tabs = (
    [
      { key: 'sales', label: t('reports.tabSales'), perm: 'reports.sales' },
      { key: 'payments', label: t('reports.tabPayments'), perm: 'reports.financial' },
      { key: 'expenses', label: t('reports.tabExpenses'), perm: 'reports.financial' },
      { key: 'shifts', label: t('reports.tabShifts'), perm: 'reports.financial' },
      { key: 'inventory', label: t('reports.tabInventory'), perm: 'reports.inventory' },
      { key: 'purchasing', label: t('reports.tabPurchasing'), perm: 'reports.inventory' },
    ] as const
  ).filter((x) => can(x.perm));
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? 'sales');
  const [timezone, setTimezone] = useState('Asia/Kuwait');
  const [preset, setPreset] = useState<Preset>('last7');
  const [custom, setCustom] = useState(() => presetRange('last7', localToday('Asia/Kuwait')));
  const [employeeId, setEmployeeId] = useState('');
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  if (tabs.length === 0) return <AccessDenied />;
  const range = preset === 'custom' ? custom : presetRange(preset, localToday(timezone));
  const query: ReportQuery = {
    ...range,
    ...(branchId ? { branchId } : {}),
    ...(employeeId && ['sales', 'payments', 'shifts'].includes(tab) ? { employeeId } : {}),
  };
  const props = {
    query,
    onPeriod: (tz: string) => tz !== timezone && setTimezone(tz),
  };
  return (
    <div>
      <PageHeader
        title={t('reports.title')}
        description={`${t('reports.subtitle')} ${branchId ? (branchName(branchId) ?? '') : t('reports.allBranches')}`}
      />
      <div className="mb-4 flex flex-wrap items-end gap-3" data-testid="report-filters">
        <Field label={t('reports.period')}>
          {(p) => (
            <Select
              {...p}
              className="w-44"
              value={preset}
              onChange={(e) => {
                const next = e.target.value as Preset;
                if (next === 'custom') setCustom(range);
                setPreset(next);
              }}
            >
              {(
                [
                  'today',
                  'yesterday',
                  'last7',
                  'last30',
                  'thisMonth',
                  'lastMonth',
                  'custom',
                ] as const
              ).map((k) => (
                <option key={k} value={k}>
                  {t(`reports.preset_${k}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {preset === 'custom' ? (
          <>
            <Field label={t('reports.from')}>
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={custom.from}
                  onChange={(e) =>
                    e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))
                  }
                />
              )}
            </Field>
            <Field label={t('reports.to')}>
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  value={custom.to}
                  onChange={(e) =>
                    e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))
                  }
                />
              )}
            </Field>
          </>
        ) : (
          <p className="pb-2 text-sm text-fg-muted" dir="ltr" data-testid="report-range">
            {range.from === range.to ? range.from : `${range.from} → ${range.to}`}
          </p>
        )}
        {['sales', 'payments', 'shifts'].includes(tab) ? (
          <Field label={t('reports.employee')}>
            {(p) => (
              <Select
                {...p}
                className="w-48"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
              >
                <option value="">{t('reports.allEmployees')}</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
      </div>
      {tabs.length > 1 ? (
        <CashTabs
          tabs={tabs.map(({ key, label }) => ({ key, label }))}
          active={tab}
          onChange={(k) => setTab(k as Tab)}
        />
      ) : null}
      {tab === 'sales' ? <SalesTab {...props} onEmployees={setEmployees} /> : null}
      {tab === 'payments' ? <PaymentsTab {...props} /> : null}
      {tab === 'expenses' ? <ExpensesTab {...props} /> : null}
      {tab === 'shifts' ? <ShiftsTab {...props} /> : null}
      {tab === 'inventory' ? <InventoryTab {...props} /> : null}
      {tab === 'purchasing' ? <PurchasingTab {...props} /> : null}
    </div>
  );
}

const fmtMoney = (lang: string) => (v: bigint) =>
  formatAmount(Money.ofMinor(v, 'KWD').toJSON(), lang);

function SalesTab({
  query,
  onPeriod,
  onEmployees,
}: TabProps & { onEmployees: (list: { id: string; name: string }[]) => void }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const branchName = useBranchName();
  const report = useReport('sales', query, (q) => api.reports.sales(q), onPeriod);
  const r = report.data;
  const unfiltered = !query.employeeId;
  useEffect(() => {
    if (r && unfiltered)
      onEmployees(r.byEmployee.map((e) => ({ id: e.membershipId, name: e.name })));
  }, [r, unfiltered, onEmployees]);
  if (!r) return <ReportState isPending={report.isPending} error={report.error} />;
  const s = r.summary;
  const p = r.previous;
  const fmt = fmtMoney(i18n.language);
  const productName = (x: SalesReport['byProduct'][number]) => {
    const base = localizedName(x, i18n.language);
    const v =
      x.variantNameEn || x.variantNameAr
        ? localizedName({ nameEn: x.variantNameEn, nameAr: x.variantNameAr }, i18n.language)
        : null;
    return v ? `${base} — ${v}` : base;
  };
  const methodName = (x: { kind: string; nameEn: string | null; nameAr: string | null }) =>
    x.kind === 'exchange' ? t('reports.exchangeCredit') : localizedName(x, i18n.language) || x.kind;
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          testId="kpi-net-sales"
          label={t('reports.netSales')}
          value={<Amount value={s.netSales} />}
          current={minorOf(s.netSales)}
          previous={minorOf(p.netSales)}
        />
        <Kpi
          label={t('reports.saleCount')}
          value={s.saleCount}
          current={BigInt(s.saleCount)}
          previous={BigInt(p.saleCount)}
        />
        <Kpi
          label={t('reports.averageSale')}
          value={<Amount value={s.averageSale} />}
          current={minorOf(s.averageSale)}
          previous={minorOf(p.averageSale)}
        />
        <Kpi
          testId="kpi-refunds"
          label={t('reports.refunds')}
          value={<Amount value={s.refunds} />}
          current={minorOf(s.refunds)}
          previous={minorOf(p.refunds)}
        />
        <Kpi
          label={t('reports.gross')}
          value={<Amount value={s.gross} />}
          hint={`${t('reports.itemsSold')}: ${displayQty(s.itemsSold)}`}
        />
        <Kpi
          label={t('reports.discounts')}
          value={<Amount value={s.discounts} />}
          hint={
            <>
              {t('reports.orderDiscounts')}: <Amount value={s.orderDiscounts} />
            </>
          }
        />
        <Kpi
          testId="kpi-net-after"
          label={t('reports.netAfterRefunds')}
          value={<Amount value={s.netAfterRefunds} />}
          current={minorOf(s.netAfterRefunds)}
          previous={minorOf(p.netAfterRefunds)}
        />
        {r.profit ? (
          <Kpi
            testId="kpi-profit"
            label={t('reports.grossProfit')}
            value={r.profit.available ? <Amount value={r.profit.grossProfit} /> : '—'}
            hint={
              r.profit.available
                ? `${t('reports.margin')}: ${r.profit.marginPercent ?? '—'}%`
                : t('reports.profitUnavailable', { count: r.profit.missingCostSales })
            }
          />
        ) : null}
      </div>
      <BarChart
        title={t('reports.trend')}
        primaryLabel={t('reports.netSales')}
        secondaryLabel={t('reports.refunds')}
        format={fmt}
        points={r.byDay.map((d) => ({
          key: d.date,
          label: d.date.slice(5),
          value: minorOf(d.netSales),
          secondary: minorOf(d.refunds),
        }))}
      />
      <BarChart
        title={t('reports.byHour')}
        primaryLabel={t('reports.netSales')}
        format={fmt}
        points={r.byHour.map((h) => ({
          key: String(h.hour),
          label: String(h.hour).padStart(2, '0'),
          value: minorOf(h.netSales),
        }))}
      />
      <ReportTable
        title={t('reports.byBranch')}
        filename={`sales-by-branch-${query.from}-${query.to}`}
        rows={r.byBranch}
        rowKey={(x) => x.branchId}
        columns={[
          {
            key: 'branch',
            header: t('reports.branch'),
            value: (x) => branchName(x.branchId) ?? x.branchId,
          },
          { key: 'count', header: t('reports.saleCount'), value: (x) => String(x.saleCount) },
          {
            key: 'gross',
            header: t('reports.gross'),
            money: true,
            value: (x) => x.gross.amount,
            hideBelow: 'md',
          },
          {
            key: 'disc',
            header: t('reports.discounts'),
            money: true,
            value: (x) => x.discounts.amount,
            hideBelow: 'md',
          },
          {
            key: 'net',
            header: t('reports.netSales'),
            money: true,
            value: (x) => x.netSales.amount,
          },
          { key: 'ref', header: t('reports.refunds'), money: true, value: (x) => x.refunds.amount },
          {
            key: 'after',
            header: t('reports.netAfterRefunds'),
            money: true,
            value: (x) => x.netAfterRefunds.amount,
          },
        ]}
      />
      <ReportTable
        title={t('reports.byChannel')}
        description={t('reports.byChannelHint')}
        filename={`sales-by-channel-${query.from}-${query.to}`}
        rows={r.byChannel}
        rowKey={(x) => x.channel}
        columns={[
          {
            key: 'channel',
            header: t('sales.channel'),
            value: (x) => t(`sales.channel_${x.channel}`),
          },
          { key: 'count', header: t('reports.saleCount'), value: (x) => String(x.saleCount) },
          {
            key: 'net',
            header: t('reports.netSales'),
            money: true,
            value: (x) => x.netSales.amount,
          },
        ]}
      />
      <ReportTable
        title={t('reports.byEmployee')}
        filename={`sales-by-employee-${query.from}-${query.to}`}
        rows={r.byEmployee}
        rowKey={(x) => x.membershipId}
        columns={[
          { key: 'name', header: t('reports.employee'), value: (x) => x.name },
          { key: 'count', header: t('reports.saleCount'), value: (x) => String(x.saleCount) },
          {
            key: 'disc',
            header: t('reports.discounts'),
            money: true,
            value: (x) => x.discounts.amount,
            hideBelow: 'sm',
          },
          {
            key: 'net',
            header: t('reports.netSales'),
            money: true,
            value: (x) => x.netSales.amount,
          },
          { key: 'ref', header: t('reports.refunds'), money: true, value: (x) => x.refunds.amount },
          {
            key: 'exceptions',
            header: t('reports.exceptions'),
            hideBelow: 'md',
            value: (x) =>
              [
                x.aboveLimitSales ? `${t('sales.flag_above_limit')} ${x.aboveLimitSales}` : null,
                x.priceOverrides ? `${t('sales.flag_price_override')} ${x.priceOverrides}` : null,
                x.zeroTotalSales ? `${t('sales.flag_zero_total')} ${x.zeroTotalSales}` : null,
                x.supervisedSales ? `${t('sales.flag_supervised')} ${x.supervisedSales}` : null,
              ]
                .filter(Boolean)
                .join(' · '),
          },
        ]}
      />
      <ReportTable
        title={t('reports.byPaymentMethod')}
        description={t('reports.byPaymentMethodHint')}
        filename={`sales-by-payment-${query.from}-${query.to}`}
        rows={r.byPaymentMethod}
        rowKey={(x) => `${x.kind}-${x.nameEn ?? ''}`}
        columns={[
          { key: 'method', header: t('reports.method'), value: methodName },
          { key: 'count', header: t('reports.payments'), value: (x) => String(x.count) },
          {
            key: 'amount',
            header: t('reports.amount'),
            money: true,
            value: (x) => x.amount.amount,
          },
        ]}
      />
      <ReportTable
        title={t('reports.byProduct')}
        filename={`sales-by-product-${query.from}-${query.to}`}
        rows={r.byProduct}
        rowKey={(x) => x.variantId}
        columns={[
          { key: 'name', header: t('reports.product'), value: productName },
          { key: 'sku', header: 'SKU', value: (x) => x.sku ?? '', hideBelow: 'lg' },
          { key: 'qty', header: t('reports.quantity'), value: (x) => displayQty(x.quantity) },
          {
            key: 'net',
            header: t('reports.netSales'),
            money: true,
            value: (x) => x.netSales.amount,
          },
          {
            key: 'rq',
            header: t('reports.refundedQty'),
            value: (x) => displayQty(x.refundedQuantity),
            hideBelow: 'sm',
          },
          {
            key: 'ref',
            header: t('reports.refunds'),
            money: true,
            value: (x) => x.refunds.amount,
            hideBelow: 'sm',
          },
        ]}
      />
      <ReportTable
        title={t('reports.byCategory')}
        filename={`sales-by-category-${query.from}-${query.to}`}
        rows={r.byCategory}
        rowKey={(x) => x.categoryId ?? 'none'}
        columns={[
          {
            key: 'name',
            header: t('reports.category'),
            value: (x) =>
              x.categoryId ? localizedName(x, i18n.language) : t('reports.uncategorized'),
          },
          { key: 'qty', header: t('reports.quantity'), value: (x) => displayQty(x.quantity) },
          {
            key: 'net',
            header: t('reports.netSales'),
            money: true,
            value: (x) => x.netSales.amount,
          },
        ]}
      />
      <ReportTable
        title={t('reports.byDay')}
        filename={`sales-by-day-${query.from}-${query.to}`}
        rows={r.byDay}
        rowKey={(x) => x.date}
        columns={[
          { key: 'date', header: t('reports.date'), value: (x) => x.date },
          { key: 'count', header: t('reports.saleCount'), value: (x) => String(x.saleCount) },
          {
            key: 'net',
            header: t('reports.netSales'),
            money: true,
            value: (x) => x.netSales.amount,
          },
          { key: 'ref', header: t('reports.refunds'), money: true, value: (x) => x.refunds.amount },
        ]}
      />
      <Definitions
        keys={[
          'netSales',
          'gross',
          'discounts',
          'refunds',
          'netAfterRefunds',
          'grossProfit',
          'period',
        ]}
      />
    </div>
  );
}
