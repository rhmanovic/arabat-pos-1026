import type { PeriodPack, PeriodSummary } from '@arabat/contracts';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  Field,
  PageHeader,
  Section,
  Spinner,
  StatCard,
  Textarea,
} from '@arabat/ui';
import { ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBranchName, useSession } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';

export const periodsKey = ['manager', 'periods'] as const;

const TONE: Record<PeriodSummary['status'], 'success' | 'warning' | 'neutral' | 'primary'> = {
  closed: 'success',
  closable: 'warning',
  open: 'neutral',
  current: 'primary',
};

/**
 * Month-end close (BR-189): the months since registration, each with its pack (live for an
 * open month, stored for a closed one), closed in order by a holder of `periods.close`.
 */
export function PeriodsPage() {
  const { t } = useTranslation();
  const api = useApi();
  const { can } = useSession();
  const [selected, setSelected] = useState<string | null>(null);
  const [closing, setClosing] = useState<PeriodSummary | null>(null);
  const list = useQuery({ queryKey: periodsKey, queryFn: () => api.periods.list() });
  const current =
    selected ?? list.data?.periods.find((p) => p.status !== 'current')?.period ?? null;
  const pack = useQuery({
    queryKey: [...periodsKey, 'pack', current],
    queryFn: () => api.periods.get(current!),
    enabled: Boolean(current),
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('periods.title')} description={t('periods.subtitle')} />
      <DataTable<PeriodSummary>
        caption={t('periods.title')}
        loading={list.isPending}
        error={
          list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : null
        }
        rows={list.data?.periods}
        rowKey={(p) => p.period}
        onRowClick={(p) => setSelected(p.period)}
        columns={[
          {
            key: 'period',
            header: t('periods.month'),
            cell: (p) => (
              <span dir="ltr" className={p.period === current ? 'font-semibold' : ''}>
                {p.period}
              </span>
            ),
          },
          {
            key: 'status',
            header: t('common.status'),
            cell: (p) => <Badge tone={TONE[p.status]}>{t(`periods.status_${p.status}`)}</Badge>,
          },
          {
            key: 'closed',
            header: t('periods.closedBy'),
            hideBelow: 'sm',
            cell: (p) =>
              p.closedAt ? (
                <span>
                  {p.closedBy} · {formatDateTime(p.closedAt, i18nLanguage())}
                  {p.note ? <span className="block text-xs text-fg-muted">{p.note}</span> : null}
                </span>
              ) : (
                '—'
              ),
          },
          {
            key: 'action',
            header: <span className="sr-only">{t('periods.close')}</span>,
            cell: (p) =>
              p.status === 'closable' && can('periods.close') ? (
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setClosing(p);
                  }}
                >
                  {t('periods.close')}
                </Button>
              ) : null,
          },
        ]}
      />
      {current ? (
        pack.data ? (
          <PackView pack={pack.data} />
        ) : pack.isError ? (
          <ErrorState error={pack.error} onRetry={() => void pack.refetch()} />
        ) : (
          <Spinner />
        )
      ) : null}
      {closing ? <CloseDialog period={closing} onClose={() => setClosing(null)} /> : null}
    </div>
  );
}

function i18nLanguage() {
  return document.documentElement.lang || 'en';
}

function PackView({ pack }: { pack: PeriodPack }) {
  const { t, i18n } = useTranslation();
  const branchName = useBranchName();
  const amount = (m: { amount: string; currency: string }) => formatAmount(m, i18n.language);
  const open = [
    ['variances', pack.open.variances],
    ['transfersInTransit', pack.open.transfersInTransit],
    ['pendingRefunds', pack.open.pendingRefunds],
    ['pendingAdjustments', pack.open.pendingAdjustments],
    ['pendingPayoutRequests', pack.open.pendingPayoutRequests],
    ['pendingCashMovements', pack.open.pendingCashMovements],
    ['pendingTransferLosses', pack.open.pendingTransferLosses],
    ['heldSales', pack.open.heldSales],
  ] as const;
  return (
    <div className="flex flex-col gap-6" data-testid="period-pack">
      <Section
        title={t('periods.packTitle', { period: pack.period })}
        description={
          pack.status === 'closed'
            ? t('periods.packStored', {
                by: pack.closedBy ?? '',
                when: pack.closedAt ? formatDateTime(pack.closedAt, i18n.language) : '',
              })
            : t('periods.packLive', { when: formatDateTime(pack.computedAt, i18n.language) })
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
          <StatCard
            label={t('periods.netSales', { count: pack.sales.saleCount })}
            value={<span dir="ltr">{amount(pack.sales.netSales)}</span>}
          />
          <StatCard
            label={t('periods.refunds', { count: pack.sales.refundCount })}
            value={<span dir="ltr">{amount(pack.sales.refunds)}</span>}
          />
          <StatCard
            label={t('periods.netAfterRefunds')}
            value={<span dir="ltr">{amount(pack.sales.netAfterRefunds)}</span>}
          />
          <StatCard
            label={t('periods.grossProfit')}
            value={pack.profit ? <span dir="ltr">{amount(pack.profit.grossProfit)}</span> : '—'}
            hint={
              pack.profit
                ? pack.profit.available
                  ? `${t('reports.margin')}: ${pack.profit.marginPercent ?? '—'}%`
                  : t('periods.uncosted', { amount: amount(pack.profit.uncostedSales) })
                : undefined
            }
          />
          <StatCard
            label={t('periods.cashOnHand')}
            value={<span dir="ltr">{amount(pack.cash.total)}</span>}
            hint={t('periods.cashHint', {
              treasuries: amount(pack.cash.treasuriesTotal),
              registers: amount(pack.cash.registersTotal),
            })}
          />
          <StatCard
            label={t('periods.closingStock')}
            value={<span dir="ltr">{amount(pack.stock.closingValue)}</span>}
            hint={
              pack.stock.unvaluedItems > 0
                ? t('periods.unvalued', { count: pack.stock.unvaluedItems })
                : t('periods.quantity', { quantity: pack.stock.closingQuantity })
            }
          />
        </div>
      </Section>
      <Section title={t('periods.collections')}>
        <DataTable
          caption={t('periods.collections')}
          rows={pack.collections}
          rowKey={(c) => `${c.kind}|${c.methodId ?? ''}`}
          empty={t('reports.noData')}
          columns={[
            {
              key: 'method',
              header: t('periods.method'),
              cell: (c) =>
                c.nameEn || c.nameAr ? localizedName(c, i18n.language) : t(`cash.kind_${c.kind}`),
            },
            {
              key: 'collected',
              header: t('reports.collected'),
              cell: (c) => <span dir="ltr">{amount(c.collected)}</span>,
            },
            {
              key: 'fees',
              header: t('reports.fees'),
              hideBelow: 'sm',
              cell: (c) => <span dir="ltr">{amount(c.fees)}</span>,
            },
            {
              key: 'refunded',
              header: t('reports.refunded'),
              hideBelow: 'sm',
              cell: (c) => <span dir="ltr">{amount(c.refunded)}</span>,
            },
            {
              key: 'net',
              header: t('periods.net'),
              cell: (c) => <span dir="ltr">{amount(c.net)}</span>,
            },
          ]}
        />
        <p className="mt-2 text-sm text-fg-muted">
          {t('periods.collectionTotals', {
            collected: amount(pack.collectionTotals.collected),
            fees: amount(pack.collectionTotals.fees),
            net: amount(pack.collectionTotals.netAfterFees),
          })}
          {pack.unreferencedTenders.count > 0
            ? ` · ${t('periods.unreferenced', {
                count: pack.unreferencedTenders.count,
                amount: amount(pack.unreferencedTenders.amount),
              })}`
            : ''}
        </p>
      </Section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={t('periods.cashByPlace')}>
          <DataTable
            caption={t('periods.cashByPlace')}
            rows={pack.cash.places}
            rowKey={(p) => p.accountId}
            empty={t('reports.noData')}
            columns={[
              {
                key: 'place',
                header: t('periods.place'),
                cell: (p) => (
                  <span>
                    {p.kind === 'treasury'
                      ? t('cashCustody.treasury')
                      : localizedName(p, i18n.language)}
                    <span className="block text-xs text-fg-muted">{branchName(p.branchId)}</span>
                  </span>
                ),
              },
              {
                key: 'balance',
                header: t('cashCustody.balance'),
                cell: (p) => <span dir="ltr">{amount(p.balance)}</span>,
              },
            ]}
          />
          <p className="mt-2 text-sm text-fg-muted">
            {t('periods.inTransit', {
              transit: amount(pack.cash.inTransitTotal),
              deposits: amount(pack.cash.depositsInTransitTotal),
            })}
          </p>
        </Section>
        <Section title={t('periods.openItems')} description={t('periods.openItemsHint')}>
          <ul className="divide-y divide-border text-sm" data-testid="period-open-items">
            {open.map(([key, n]) => (
              <li key={key} className="flex justify-between py-2">
                <span>{t(`periods.open_${key}`)}</span>
                <span className="tabular-nums" dir="ltr">
                  {n}
                </span>
              </li>
            ))}
            <li className="flex justify-between py-2">
              <span>{t('periods.refundsOwed', { count: pack.refundsOwed.count })}</span>
              <span dir="ltr">{amount(pack.refundsOwed.amount)}</span>
            </li>
            <li className="flex justify-between py-2">
              <span>{t('periods.supplierBalance')}</span>
              <span dir="ltr">{amount(pack.suppliers.balance)}</span>
            </li>
          </ul>
          <p className="mt-2 text-sm text-fg-muted">
            {t('periods.documents', {
              sales: pack.documents.sales,
              refunds: pack.documents.refunds,
              receipts: pack.documents.receipts,
              orders: pack.documents.purchaseOrders,
              disbursements: pack.documents.disbursements,
            })}
          </p>
        </Section>
      </div>
    </div>
  );
}

function CloseDialog({ period, onClose }: { period: PeriodSummary; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const close = useMutation({
    mutationFn: () => api.periods.close(period.period, { note: note.trim() || null }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: periodsKey });
      notify.ok(t('periods.closed'));
      onClose();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('periods.closeTitle', { period: period.period })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={close.isPending} onClick={() => close.mutate()}>
            {t('periods.close')}
          </Button>
        </>
      }
    >
      <Alert tone="warning">
        {t('periods.closeWarning', { from: period.from, to: period.to })}
      </Alert>
      <Field label={t('periods.note')} className="mt-4">
        {(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </Dialog>
  );
}
