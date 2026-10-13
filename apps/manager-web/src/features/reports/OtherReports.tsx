import { Money } from '@arabat/money';
import { Badge } from '@arabat/ui';
import { localizedName, useApi } from '@arabat/web-core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBranchName } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';
import { displayQty } from '../inventory/shared.js';
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

const fmtMoney = (lang: string) => (v: bigint) =>
  formatAmount(Money.ofMinor(v, 'KWD').toJSON(), lang);

export function PaymentsTab({ query, onPeriod }: TabProps) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const report = useReport('payments', query, (q) => api.reports.payments(q), onPeriod);
  const r = report.data;
  if (!r) return <ReportState isPending={report.isPending} error={report.error} />;
  const name = (x: { kind: string; nameEn: string | null; nameAr: string | null }) =>
    x.kind === 'exchange' ? t('reports.exchangeCredit') : localizedName(x, i18n.language) || x.kind;
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          testId="kpi-collected"
          label={t('reports.collected')}
          value={<Amount value={r.totals.collected} />}
          current={minorOf(r.totals.collected)}
          previous={minorOf(r.totals.previousCollected)}
        />
        <Kpi label={t('reports.paidBack')} value={<Amount value={r.totals.refunded} />} />
        <Kpi testId="kpi-fees" label={t('reports.fees')} value={<Amount value={r.totals.fees} />} />
        <Kpi
          label={t('reports.netAfterFees')}
          value={<Amount value={r.totals.netAfterFees} />}
          hint={
            <>
              {t('reports.netCollected')}: <Amount value={r.totals.net} />
            </>
          }
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" data-testid="cash-summary">
        <Kpi label={t('reports.cashSales')} value={<Amount value={r.cash.cashSales} />} />
        <Kpi label={t('reports.cashRefunds')} value={<Amount value={r.cash.cashRefunds} />} />
        <Kpi label={t('reports.cashIn')} value={<Amount value={r.cash.cashIn} />} />
        <Kpi label={t('reports.cashOut')} value={<Amount value={r.cash.cashOut} />} />
        <Kpi label={t('reports.netCash')} value={<Amount value={r.cash.netCash} />} />
      </div>
      <ReportTable
        title={t('reports.cashByType')}
        filename={`cash-by-type-${query.from}-${query.to}`}
        rows={(
          [
            'cashSales',
            'cashRefunds',
            'drops',
            'topUps',
            'deposits',
            'expenses',
            'supplierPayments',
            'corrections',
            'countDifferences',
            'openingCounts',
            'branchTransfers',
          ] as const
        ).map((key) => ({ key, value: r.custody[key] }))}
        rowKey={(x) => x.key}
        columns={[
          {
            key: 'type',
            header: t('reports.cashType'),
            value: (x) => t(`reports.custody_${x.key}`),
          },
          { key: 'amount', header: t('reports.amount'), money: true, value: (x) => x.value.amount },
        ]}
      />
      <BarChart
        title={t('reports.collectionsTrend')}
        primaryLabel={t('reports.collected')}
        secondaryLabel={t('reports.paidBack')}
        format={fmtMoney(i18n.language)}
        points={r.byDay.map((d) => ({
          key: d.date,
          label: d.date.slice(5),
          value: minorOf(d.collected),
          secondary: minorOf(d.refunded),
        }))}
      />
      <ReportTable
        title={t('reports.collections')}
        filename={`collections-${query.from}-${query.to}`}
        rows={r.collections}
        rowKey={(x) => `${x.kind}-${x.methodId ?? ''}`}
        columns={[
          { key: 'method', header: t('reports.method'), value: name },
          { key: 'count', header: t('reports.payments'), value: (x) => String(x.count) },
          {
            key: 'in',
            header: t('reports.collected'),
            money: true,
            value: (x) => x.collected.amount,
          },
          { key: 'fees', header: t('reports.fees'), money: true, value: (x) => x.fees.amount },
          {
            key: 'out',
            header: t('reports.paidBack'),
            money: true,
            value: (x) => x.refunded.amount,
          },
          {
            key: 'net',
            header: t('reports.netCollected'),
            money: true,
            value: (x) => x.net.amount,
          },
        ]}
      />
      <ReportTable
        title={t('reports.refundAllocations')}
        filename={`refund-allocations-${query.from}-${query.to}`}
        rows={r.refundAllocations}
        rowKey={(x) => `${x.kind}-${x.nameEn ?? ''}-${x.status}`}
        columns={[
          { key: 'method', header: t('reports.method'), value: name },
          {
            key: 'status',
            header: t('common.status'),
            value: (x) => t(`reports.payStatus_${x.status}`, { defaultValue: x.status }),
          },
          { key: 'count', header: t('reports.payments'), value: (x) => String(x.count) },
          {
            key: 'amount',
            header: t('reports.amount'),
            money: true,
            value: (x) => x.amount.amount,
          },
        ]}
      />
      <Definitions keys={['collected', 'fees', 'paidBack', 'cash', 'custody', 'period']} />
    </div>
  );
}

export function ShiftsTab({ query, onPeriod }: TabProps) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const branchName = useBranchName();
  const report = useReport('shifts', query, (q) => api.reports.shifts(q), onPeriod);
  const r = report.data;
  if (!r) return <ReportState isPending={report.isPending} error={report.error} />;
  const tone = {
    balanced: 'success',
    over: 'warning',
    short: 'danger',
    uncounted: 'neutral',
  } as const;
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label={t('reports.closedShifts')}
          value={r.totals.shiftCount}
          hint={`${t('reports.balanced')}: ${r.totals.balanced}`}
        />
        <Kpi
          label={t('reports.over')}
          value={<Amount value={r.totals.totalOver} />}
          hint={`${r.totals.over} ${t('reports.shiftsWord')}`}
        />
        <Kpi
          label={t('reports.short')}
          value={<Amount value={r.totals.totalShort} />}
          hint={`${r.totals.short} ${t('reports.shiftsWord')}`}
        />
        <Kpi
          testId="kpi-net-discrepancy"
          label={t('reports.netDiscrepancy')}
          value={<Amount value={r.totals.netDiscrepancy} />}
        />
      </div>
      <ReportTable
        title={t('reports.shiftSummaries')}
        filename={`shifts-${query.from}-${query.to}`}
        rows={r.shifts}
        rowKey={(x) => x.id}
        columns={[
          {
            key: 'closed',
            header: t('reports.closedAt'),
            value: (x) => x.closedAt,
            display: (x) => formatDateTime(x.closedAt, i18n.language),
          },
          {
            key: 'branch',
            header: t('reports.branch'),
            value: (x) => branchName(x.branchId) ?? '',
            hideBelow: 'lg',
          },
          { key: 'register', header: t('reports.register'), value: (x) => x.registerCode },
          {
            key: 'employee',
            header: t('reports.employee'),
            value: (x) => x.employeeName,
            hideBelow: 'md',
          },
          {
            key: 'float',
            header: t('reports.openingFloat'),
            money: true,
            value: (x) => x.openingFloat.amount,
            hideBelow: 'lg',
          },
          {
            key: 'sales',
            header: t('reports.cashSales'),
            money: true,
            value: (x) => x.cashSales.amount,
            hideBelow: 'lg',
          },
          {
            key: 'refunds',
            header: t('reports.cashRefunds'),
            money: true,
            value: (x) => x.cashRefunds.amount,
            hideBelow: 'lg',
          },
          {
            key: 'in',
            header: t('reports.cashIn'),
            money: true,
            value: (x) => x.cashIn.amount,
            hideBelow: 'lg',
          },
          {
            key: 'out',
            header: t('reports.cashOut'),
            money: true,
            value: (x) => x.cashOut.amount,
            hideBelow: 'lg',
          },
          {
            key: 'expected',
            header: t('reports.expected'),
            money: true,
            value: (x) => x.expectedCash.amount,
          },
          {
            key: 'counted',
            header: t('reports.counted'),
            money: true,
            value: (x) => x.countedCash.amount,
          },
          {
            key: 'diff',
            header: t('reports.discrepancy'),
            money: true,
            value: (x) => x.discrepancy.amount,
          },
          {
            key: 'outcome',
            header: t('reports.outcome'),
            value: (x) => t(`reports.${x.outcome}`),
            display: (x) => <Badge tone={tone[x.outcome]}>{t(`reports.${x.outcome}`)}</Badge>,
          },
        ]}
      />
      <ReportTable
        title={t('reports.registerReconciliation')}
        filename={`registers-${query.from}-${query.to}`}
        rows={r.registers}
        rowKey={(x) => x.registerId}
        columns={[
          { key: 'register', header: t('reports.register'), value: (x) => x.registerCode },
          {
            key: 'branch',
            header: t('reports.branch'),
            value: (x) => branchName(x.branchId) ?? '',
          },
          { key: 'count', header: t('reports.closedShifts'), value: (x) => String(x.shiftCount) },
          {
            key: 'expected',
            header: t('reports.expected'),
            money: true,
            value: (x) => x.expectedCash.amount,
          },
          {
            key: 'counted',
            header: t('reports.counted'),
            money: true,
            value: (x) => x.countedCash.amount,
          },
          {
            key: 'diff',
            header: t('reports.discrepancy'),
            money: true,
            value: (x) => x.discrepancy.amount,
          },
        ]}
      />
      <Definitions keys={['discrepancy', 'cash']} />
    </div>
  );
}

export function InventoryTab({ query, onPeriod }: TabProps) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const branchName = useBranchName();
  const [onlyAlerts, setOnlyAlerts] = useState(false);
  const report = useReport('inventory', query, (q) => api.reports.inventory(q), onPeriod);
  const r = report.data;
  if (!r) return <ReportState isPending={report.isPending} error={report.error} />;
  const total = r.valuation.reduce((s, v) => s + minorOf(v.value), 0n);
  const low = r.stock.filter((x) => x.status === 'low').length;
  const out = r.stock.filter((x) => x.status === 'out' || x.status === 'negative').length;
  const unvalued = r.valuation.reduce((s, v) => s + v.unvaluedItems, 0);
  const name = (x: {
    nameEn: string | null;
    nameAr: string | null;
    variantNameEn?: string | null;
    variantNameAr?: string | null;
  }) => {
    const base = localizedName(x, i18n.language);
    const v =
      x.variantNameEn || x.variantNameAr
        ? localizedName(
            { nameEn: x.variantNameEn ?? null, nameAr: x.variantNameAr ?? null },
            i18n.language,
          )
        : null;
    return v ? `${base} — ${v}` : base;
  };
  const statusTone = {
    in_stock: 'success',
    low: 'warning',
    out: 'danger',
    negative: 'danger',
  } as const;
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          testId="kpi-stock-value"
          label={t('reports.stockValue')}
          value={<Amount value={Money.ofMinor(total, 'KWD').toJSON()} />}
          hint={unvalued ? t('reports.unvalued', { count: unvalued }) : undefined}
        />
        <Kpi
          label={t('reports.trackedItems')}
          value={r.valuation.reduce((s, v) => s + v.trackedItems, 0)}
        />
        <Kpi label={t('reports.lowStock')} value={low} />
        <Kpi label={t('reports.outOfStock')} value={out} />
        <Kpi
          testId="kpi-closing-stock"
          label={t('reports.closingStockAt', { date: r.asAt.date })}
          value={<Amount value={r.asAt.total.value} />}
          hint={t('reports.reservedHint', { quantity: displayQty(r.reservedQuantity) })}
        />
        <Kpi
          testId="kpi-in-transit"
          label={t('reports.inTransit')}
          value={<Amount value={r.inTransit.value} />}
          hint={t('reports.inTransitHint', {
            count: r.inTransit.transfers,
            quantity: displayQty(r.inTransit.quantity),
          })}
        />
      </div>
      <ReportTable
        title={t('reports.asAtTitle', { date: r.asAt.date })}
        description={t('reports.asAtHint')}
        filename={`closing-stock-${r.asAt.date}`}
        rows={[
          ...r.asAt.valuation,
          {
            branchId: '__total',
            items: 0,
            quantity: r.asAt.total.quantity,
            value: r.asAt.total.value,
          },
        ]}
        rowKey={(x) => x.branchId}
        columns={[
          {
            key: 'branch',
            header: t('reports.branch'),
            value: (x) =>
              x.branchId === '__total' ? t('reports.total') : (branchName(x.branchId) ?? ''),
          },
          { key: 'qty', header: t('reports.quantity'), value: (x) => displayQty(x.quantity) },
          { key: 'value', header: t('reports.value'), money: true, value: (x) => x.value.amount },
        ]}
      />
      <ReportTable
        title={t('reports.rollForward')}
        description={t('reports.rollForwardHint')}
        filename={`stock-roll-forward-${query.from}-${query.to}`}
        rows={[
          { key: 'opening', label: t('reports.openingStock'), ...r.rollForward.total.opening },
          ...r.rollForward.total.movements.map((m) => ({
            key: m.movementType,
            label: t(`reports.move_${m.movementType}`, { defaultValue: m.movementType }),
            quantity: m.quantity,
            value: m.value,
          })),
          {
            key: 'rounding',
            label: t('reports.rounding'),
            quantity: '0.000',
            value: r.rollForward.total.rounding,
          },
          { key: 'closing', label: t('reports.closingStock'), ...r.rollForward.total.closing },
        ]}
        rowKey={(x) => x.key}
        columns={[
          { key: 'line', header: t('reports.line'), value: (x) => x.label },
          {
            key: 'qty',
            header: t('reports.quantity'),
            value: (x) => (x.key === 'rounding' ? '' : displayQty(x.quantity)),
          },
          { key: 'value', header: t('reports.value'), money: true, value: (x) => x.value.amount },
        ]}
      />
      {r.unvalued.length > 0 ? (
        <ReportTable
          title={t('reports.unvaluedTitle', { count: r.unvalued.length })}
          description={t('reports.unvaluedHint')}
          filename="items-without-cost"
          rows={r.unvalued}
          rowKey={(x) => `${x.branchId}-${x.variantId}`}
          columns={[
            { key: 'name', header: t('reports.product'), value: name },
            { key: 'sku', header: 'SKU', value: (x) => x.sku ?? '', hideBelow: 'lg' },
            {
              key: 'branch',
              header: t('reports.branch'),
              value: (x) => branchName(x.branchId) ?? '',
              hideBelow: 'md',
            },
            { key: 'qty', header: t('reports.onHand'), value: (x) => displayQty(x.onHand) },
          ]}
        />
      ) : null}
      <ReportTable
        title={t('reports.valuation')}
        description={t('reports.valuationHint')}
        filename="stock-valuation"
        rows={r.valuation}
        rowKey={(x) => x.branchId}
        columns={[
          {
            key: 'branch',
            header: t('reports.branch'),
            value: (x) => branchName(x.branchId) ?? '',
          },
          { key: 'items', header: t('reports.trackedItems'), value: (x) => String(x.trackedItems) },
          { key: 'qty', header: t('reports.quantity'), value: (x) => displayQty(x.quantity) },
          { key: 'value', header: t('reports.value'), money: true, value: (x) => x.value.amount },
          {
            key: 'unvalued',
            header: t('reports.unvaluedItems'),
            value: (x) => String(x.unvaluedItems),
            hideBelow: 'sm',
          },
        ]}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={onlyAlerts}
          onChange={(e) => setOnlyAlerts(e.target.checked)}
        />
        {t('reports.onlyAlerts')}
      </label>
      <ReportTable
        title={t('reports.currentStock')}
        filename="current-stock"
        rows={onlyAlerts ? r.stock.filter((x) => x.status !== 'in_stock') : r.stock}
        rowKey={(x) => `${x.branchId}-${x.variantId}`}
        columns={[
          { key: 'name', header: t('reports.product'), value: name },
          { key: 'sku', header: 'SKU', value: (x) => x.sku ?? '', hideBelow: 'lg' },
          {
            key: 'branch',
            header: t('reports.branch'),
            value: (x) => branchName(x.branchId) ?? '',
            hideBelow: 'md',
          },
          { key: 'qty', header: t('reports.onHand'), value: (x) => displayQty(x.onHand) },
          {
            key: 'reserved',
            header: t('reports.reserved'),
            value: (x) => (x.reserved === '0.000' ? '' : displayQty(x.reserved)),
            hideBelow: 'lg',
          },
          {
            key: 'threshold',
            header: t('reports.threshold'),
            value: (x) =>
              displayQty(x.lowStockThreshold) === '—' ? '' : displayQty(x.lowStockThreshold),
            hideBelow: 'lg',
          },
          {
            key: 'avg',
            header: t('reports.averageCost'),
            money: true,
            value: (x) => x.averageCost?.amount ?? '',
            display: (x) => <Amount value={x.averageCost} />,
            hideBelow: 'md',
          },
          {
            key: 'value',
            header: t('reports.value'),
            money: true,
            value: (x) => x.value?.amount ?? '',
            display: (x) => <Amount value={x.value} />,
          },
          {
            key: 'status',
            header: t('common.status'),
            value: (x) => t(`reports.stock_${x.status}`),
            display: (x) => (
              <Badge tone={statusTone[x.status]}>{t(`reports.stock_${x.status}`)}</Badge>
            ),
          },
        ]}
      />
      <ReportTable
        title={t('reports.movements')}
        filename={`stock-movements-${query.from}-${query.to}`}
        rows={r.movements}
        rowKey={(x) => x.movementType}
        columns={[
          {
            key: 'type',
            header: t('reports.movementType'),
            value: (x) => t(`reports.move_${x.movementType}`, { defaultValue: x.movementType }),
          },
          { key: 'count', header: t('reports.entries'), value: (x) => String(x.count) },
          { key: 'in', header: t('reports.quantityIn'), value: (x) => displayQty(x.quantityIn) },
          { key: 'out', header: t('reports.quantityOut'), value: (x) => displayQty(x.quantityOut) },
          {
            key: 'value',
            header: t('reports.netValue'),
            money: true,
            value: (x) => x.value.amount,
          },
        ]}
      />
      <ReportTable
        title={t('reports.adjustments')}
        filename={`stock-adjustments-${query.from}-${query.to}`}
        rows={r.adjustments}
        rowKey={(x) => `${x.kind}-${x.reason}`}
        columns={[
          {
            key: 'kind',
            header: t('reports.adjustmentKind'),
            value: (x) => t(`inventory.kind_${x.kind}`, { defaultValue: x.kind }),
          },
          {
            key: 'reason',
            header: t('reports.reason'),
            value: (x) => t(`inventory.reason_${x.reason}`, { defaultValue: x.reason }),
          },
          { key: 'docs', header: t('reports.documents'), value: (x) => String(x.documents) },
          { key: 'qty', header: t('reports.netQuantity'), value: (x) => displayQty(x.quantity) },
        ]}
      />
      <ReportTable
        title={t('reports.productQuantities')}
        filename={`product-quantities-${query.from}-${query.to}`}
        rows={r.productQuantities}
        rowKey={(x) => x.variantId}
        columns={[
          { key: 'name', header: t('reports.product'), value: name },
          { key: 'sold', header: t('reports.sold'), value: (x) => displayQty(x.sold) },
          {
            key: 'back',
            header: t('reports.returnedToStock'),
            value: (x) => displayQty(x.returnedToStock),
          },
          {
            key: 'lost',
            header: t('reports.returnedNotRestocked'),
            value: (x) => displayQty(x.returnedNotRestocked),
            hideBelow: 'sm',
          },
          { key: 'net', header: t('reports.netSold'), value: (x) => displayQty(x.netSold) },
        ]}
      />
      <Definitions keys={['valuation', 'period']} />
    </div>
  );
}

export function PurchasingTab({ query, onPeriod }: TabProps) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const branchName = useBranchName();
  const report = useReport('purchasing', query, (q) => api.reports.purchasing(q), onPeriod);
  const r = report.data;
  if (!r) return <ReportState isPending={report.isPending} error={report.error} />;
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label={t('reports.ordersCreated')}
          value={r.summary.ordersCreated}
          hint={<Amount value={r.summary.orderedValue} />}
        />
        <Kpi
          testId="kpi-received"
          label={t('reports.receivedValue')}
          value={<Amount value={r.summary.receivedValue} />}
          hint={`${r.summary.receipts} ${t('reports.receiptsWord')}`}
        />
        <Kpi
          label={t('reports.openOrders')}
          value={r.summary.openOrders}
          hint={<Amount value={r.summary.openValue} />}
        />
        <Kpi
          label={t('reports.transfersCount')}
          value={r.transfers.reduce((s, x) => s + x.transfers, 0)}
        />
      </div>
      <ReportTable
        title={t('reports.bySupplier')}
        filename={`purchases-by-supplier-${query.from}-${query.to}`}
        rows={r.bySupplier}
        rowKey={(x) => x.supplierId}
        columns={[
          {
            key: 'name',
            header: t('reports.supplier'),
            value: (x) => localizedName(x, i18n.language),
          },
          { key: 'orders', header: t('reports.orders'), value: (x) => String(x.orders) },
          {
            key: 'ordered',
            header: t('reports.orderedValue'),
            money: true,
            value: (x) => x.orderedValue.amount,
          },
          {
            key: 'receipts',
            header: t('reports.receiptsWord'),
            value: (x) => String(x.receipts),
            hideBelow: 'sm',
          },
          {
            key: 'received',
            header: t('reports.receivedValue'),
            money: true,
            value: (x) => x.receivedValue.amount,
          },
        ]}
      />
      <ReportTable
        title={t('reports.receivingHistory')}
        filename={`receiving-${query.from}-${query.to}`}
        rows={r.receipts}
        rowKey={(x) => x.id}
        columns={[
          { key: 'number', header: t('reports.number'), value: (x) => x.number },
          {
            key: 'order',
            header: t('reports.order'),
            value: (x) => x.orderNumber,
            hideBelow: 'sm',
          },
          {
            key: 'supplier',
            header: t('reports.supplier'),
            value: (x) => localizedName(x.supplierName, i18n.language),
          },
          {
            key: 'branch',
            header: t('reports.branch'),
            value: (x) => branchName(x.branchId) ?? '',
            hideBelow: 'md',
          },
          {
            key: 'date',
            header: t('reports.date'),
            value: (x) => x.createdAt,
            display: (x) => formatDateTime(x.createdAt, i18n.language),
            hideBelow: 'md',
          },
          {
            key: 'ref',
            header: t('reports.reference'),
            value: (x) => x.supplierReference ?? '',
            hideBelow: 'lg',
          },
          { key: 'value', header: t('reports.value'), money: true, value: (x) => x.value.amount },
        ]}
      />
      <ReportTable
        title={t('reports.transfers')}
        filename={`transfers-${query.from}-${query.to}`}
        rows={r.transfers}
        rowKey={(x) => `${x.sourceBranchId}-${x.destinationBranchId}`}
        columns={[
          {
            key: 'from',
            header: t('reports.fromBranch'),
            value: (x) => branchName(x.sourceBranchId) ?? '',
          },
          {
            key: 'to',
            header: t('reports.toBranch'),
            value: (x) => branchName(x.destinationBranchId) ?? '',
          },
          { key: 'count', header: t('reports.transfersCount'), value: (x) => String(x.transfers) },
          { key: 'sent', header: t('reports.dispatched'), value: (x) => displayQty(x.dispatched) },
          { key: 'got', header: t('reports.received'), value: (x) => displayQty(x.received) },
          { key: 'missing', header: t('reports.missing'), value: (x) => displayQty(x.missing) },
          {
            key: 'value',
            header: t('reports.dispatchedValue'),
            money: true,
            value: (x) => x.dispatchedValue.amount,
            hideBelow: 'md',
          },
          {
            key: 'mvalue',
            header: t('reports.missingValue'),
            money: true,
            value: (x) => x.missingValue.amount,
          },
          { key: 'lost', header: t('reports.lost'), value: (x) => displayQty(x.lost) },
          {
            key: 'lvalue',
            header: t('reports.lostValue'),
            money: true,
            value: (x) => x.lostValue.amount,
          },
          {
            key: 'pending',
            header: t('reports.pendingLosses'),
            value: (x) => String(x.pendingLosses),
            hideBelow: 'lg',
          },
        ]}
      />
    </div>
  );
}

/** Expenses by category and supplier payments by supplier, reversals netted (ADR-0091). */
export function ExpensesTab({ query, onPeriod }: TabProps) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const report = useReport('expenses', query, (q) => api.reports.expenses(q), onPeriod);
  const r = report.data;
  if (!r) return <ReportState isPending={report.isPending} error={report.error} />;
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi
          testId="kpi-expenses"
          label={t('reports.expensesTotal')}
          value={<Amount value={r.totals.expenses} />}
          current={minorOf(r.totals.expenses)}
          previous={minorOf(r.totals.previousExpenses)}
        />
        <Kpi
          testId="kpi-supplier-payments"
          label={t('reports.supplierPayments')}
          value={<Amount value={r.totals.supplierPayments} />}
        />
        <Kpi label={t('reports.cashPaidOut')} value={<Amount value={r.totals.total} />} />
      </div>
      <BarChart
        title={t('reports.expensesTrend')}
        primaryLabel={t('reports.expensesTotal')}
        secondaryLabel={t('reports.supplierPayments')}
        format={fmtMoney(i18n.language)}
        points={r.byDay.map((d) => ({
          key: d.date,
          label: d.date.slice(5),
          value: minorOf(d.expenses),
          secondary: minorOf(d.supplierPayments),
        }))}
      />
      <ReportTable
        title={t('reports.expensesByCategory')}
        filename={`expenses-by-category-${query.from}-${query.to}`}
        rows={r.byCategory}
        rowKey={(x) => x.category}
        columns={[
          {
            key: 'category',
            header: t('reports.category'),
            value: (x) => t(`cashCustody.category_${x.category}`),
          },
          { key: 'count', header: t('reports.records'), value: (x) => String(x.count) },
          { key: 'net', header: t('reports.amount'), money: true, value: (x) => x.net.amount },
        ]}
      />
      <ReportTable
        title={t('reports.paymentsBySupplier')}
        filename={`supplier-payments-${query.from}-${query.to}`}
        rows={r.bySupplier}
        rowKey={(x) => x.supplierId}
        columns={[
          {
            key: 'supplier',
            header: t('reports.supplier'),
            value: (x) => localizedName(x, i18n.language),
          },
          { key: 'count', header: t('reports.records'), value: (x) => String(x.count) },
          { key: 'net', header: t('reports.amount'), money: true, value: (x) => x.net.amount },
        ]}
      />
      <ReportTable
        title={t('reports.outflowsByBranch')}
        filename={`outflows-by-branch-${query.from}-${query.to}`}
        rows={r.byBranch}
        rowKey={(x) => x.branchId}
        columns={[
          {
            key: 'branch',
            header: t('reports.branch'),
            value: (x) => localizedName(x, i18n.language),
          },
          {
            key: 'expenses',
            header: t('reports.expensesTotal'),
            money: true,
            value: (x) => x.expenses.amount,
          },
          {
            key: 'supplier',
            header: t('reports.supplierPayments'),
            money: true,
            value: (x) => x.supplierPayments.amount,
          },
        ]}
      />
      <ReportTable
        title={t('reports.outflowsBySource')}
        filename={`outflows-by-source-${query.from}-${query.to}`}
        rows={r.bySource}
        rowKey={(x) => x.source}
        columns={[
          {
            key: 'source',
            header: t('reports.paidFrom'),
            value: (x) => t(`reports.source_${x.source}`),
          },
          { key: 'count', header: t('reports.records'), value: (x) => String(x.count) },
          { key: 'net', header: t('reports.amount'), money: true, value: (x) => x.net.amount },
        ]}
      />
      <Definitions keys={['expenses', 'period']} />
    </div>
  );
}
