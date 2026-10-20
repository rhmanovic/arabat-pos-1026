import type { OnlineOrder } from '@arabat/contracts';
import { formatMoney } from '@arabat/i18n';
import { Money } from '@arabat/money';
import { Alert, PageHeader, Section, Select } from '@arabat/ui';
import { AccessDenied, ErrorState, localizedName, useApi } from '@arabat/web-core';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../app/context.js';
import { key } from '../shared.js';

type OrderRow = Omit<OnlineOrder, 'lines' | 'payments' | 'timeline'>;
const DONE = new Set(['paid', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed']);
const LOST = new Set(['cancelled', 'expired', 'payment_failed']);
const kwd = (minor: bigint) => Money.ofMinor(minor, 'KWD');
const minorOf = (m: { amount: string }) => Money.parse(m.amount, 'KWD').minor;
const dayOf = (iso: string) => iso.slice(0, 10);

/**
 * Store analytics (Phase 10, frontend only): computed in the browser from the orders the
 * console already loads and the sales report, over the last 7, 30 or 90 days. One hue for the
 * single series; the table beside the bars carries the same numbers.
 */
export function AnalyticsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  if (!can('online.manage') && !can('online.orders')) return <AccessDenied />;
  return (
    <div>
      <PageHeader title={t('nav.analytics')} description={t('analytics.hint')} />
      <Analytics />
    </div>
  );
}

function Analytics() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { can } = useSession();
  const [days, setDays] = useState<7 | 30 | 90>(30);
  // The clock is read once per visit so the render stays pure.
  const [now] = useState(() => Date.now());
  const since = new Date(now - days * 86_400_000);
  // Every open or closed order of the store (pages of 100, at most ten pages).
  const orders = useQuery({
    queryKey: [...key, 'analytics', 'orders'],
    queryFn: async () => {
      const all: OrderRow[] = [];
      for (let page = 1; page <= 10; page++) {
        const r = await api.online.orders({ page, pageSize: 100 });
        all.push(...r.orders);
        if (all.length >= r.total) break;
      }
      return all;
    },
    staleTime: 60_000,
  });
  const inRange = (orders.data ?? []).filter((o) => new Date(o.createdAt) >= since);
  const recent = inRange.filter((o) => DONE.has(o.status)).slice(0, 50);
  // Lines of the last 50 paid orders, for the top products.
  const details = useQueries({
    queries: recent.map((o) => ({
      queryKey: [...key, 'analytics', 'order', o.id],
      queryFn: () => api.online.order(o.id),
      staleTime: 300_000,
    })),
  });
  const report = useQuery({
    queryKey: [...key, 'analytics', 'report', days],
    enabled: can('reports.sales'),
    queryFn: () =>
      api.reports.sales({
        from: since.toISOString().slice(0, 10),
        to: new Date(now).toISOString().slice(0, 10),
      }),
    staleTime: 300_000,
  });
  if (orders.isPending) return null;
  if (orders.isError)
    return <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />;

  const money = (minor: bigint) => formatMoney(kwd(minor), i18n.language);
  const done = inRange.filter((o) => DONE.has(o.status));
  const revenue = done.reduce((sum, o) => sum + minorOf(o.total), 0n);
  const discounts = done.reduce((sum, o) => sum + minorOf(o.discount), 0n);
  const lost = inRange.filter((o) => LOST.has(o.status)).length;
  const average = done.length ? revenue / BigInt(done.length) : 0n;
  const byDay = new Map<string, { orders: number; revenueMinor: bigint }>();
  for (let d = days - 1; d >= 0; d--)
    byDay.set(dayOf(new Date(now - d * 86_400_000).toISOString()), {
      orders: 0,
      revenueMinor: 0n,
    });
  for (const o of done) {
    const bucket = byDay.get(dayOf(o.createdAt));
    if (bucket) {
      bucket.orders += 1;
      bucket.revenueMinor += minorOf(o.total);
    }
  }
  const peak = [...byDay.values()].reduce((m, b) => (b.revenueMinor > m ? b.revenueMinor : m), 0n);
  const byStatus = new Map<string, number>();
  for (const o of inRange) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
  const products = new Map<
    string,
    { nameEn: string | null; nameAr: string | null; qty: number; netMinor: bigint }
  >();
  for (const q of details)
    for (const l of q.data?.lines ?? []) {
      const entry = products.get(l.productId) ?? {
        nameEn: l.nameEn,
        nameAr: l.nameAr,
        qty: 0,
        netMinor: 0n,
      };
      entry.qty += Number(l.quantity);
      entry.netMinor += minorOf(l.lineTotal);
      products.set(l.productId, entry);
    }
  const top = [...products.values()].sort((a, b) => (b.netMinor > a.netMinor ? 1 : -1)).slice(0, 8);
  const channels = report.data?.byChannel ?? [];
  const fulfilment = {
    pickup: done.filter((o) => o.fulfillment === 'pickup').length,
    delivery: done.filter((o) => o.fulfillment === 'delivery').length,
  };
  const tile = (label: string, value: string, testId: string) => (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-sm text-fg-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums" data-testid={testId}>
        {value}
      </p>
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Select
          aria-label={t('analytics.range')}
          className="w-44"
          value={String(days)}
          onChange={(e) => setDays(Number(e.target.value) as 7 | 30 | 90)}
        >
          {[7, 30, 90].map((d) => (
            <option key={d} value={d}>
              {t('analytics.lastDays', { count: d })}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tile(t('analytics.orders'), String(done.length), 'kpi-orders')}
        {tile(t('analytics.revenue'), money(revenue), 'kpi-revenue')}
        {tile(t('analytics.average'), money(average), 'kpi-average')}
        {tile(
          t('analytics.lostRate'),
          inRange.length ? `${Math.round((lost / inRange.length) * 100)}%` : '—',
          'kpi-lost',
        )}
      </div>
      <Section title={t('analytics.perDay')} description={t('analytics.perDayHint')}>
        {done.length === 0 ? (
          <Alert>{t('analytics.empty')}</Alert>
        ) : (
          <div className="flex flex-col gap-3">
            <div
              className="flex h-40 items-end gap-px overflow-hidden rounded-md bg-surface-muted p-2"
              role="img"
              aria-label={t('analytics.perDay')}
            >
              {[...byDay.entries()].map(([day, b]) => (
                <div
                  key={day}
                  title={`${day}: ${money(b.revenueMinor)} · ${b.orders}`}
                  className="flex-1 rounded-t-[4px] bg-primary"
                  style={{
                    height:
                      peak > 0n ? `${Math.max(2, Number((b.revenueMinor * 100n) / peak))}%` : '2%',
                    opacity: b.revenueMinor > 0n ? 1 : 0.15,
                  }}
                />
              ))}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-fg-muted">
                  <th className="py-1 text-start">{t('sales.date')}</th>
                  <th className="py-1 text-end">{t('analytics.orders')}</th>
                  <th className="py-1 text-end">{t('analytics.revenue')}</th>
                </tr>
              </thead>
              <tbody>
                {[...byDay.entries()]
                  .filter(([, b]) => b.orders > 0)
                  .reverse()
                  .slice(0, 14)
                  .map(([day, b]) => (
                    <tr key={day} className="border-t border-border">
                      <td className="py-1" dir="ltr">
                        {day}
                      </td>
                      <td className="py-1 text-end tabular-nums">{b.orders}</td>
                      <td className="py-1 text-end tabular-nums">{money(b.revenueMinor)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('analytics.topProducts')} description={t('analytics.topProductsHint')}>
          {top.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('analytics.empty')}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {top.map((p) => (
                  <tr
                    key={p.nameEn ?? p.nameAr ?? ''}
                    className="border-t border-border first:border-0"
                  >
                    <td className="py-1">{localizedName(p, i18n.language)}</td>
                    <td className="py-1 text-end tabular-nums">{p.qty}</td>
                    <td className="py-1 text-end tabular-nums">{money(p.netMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
        <Section title={t('analytics.mix')}>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt>{t('store.fulfillment_pickup')}</dt>
            <dd className="text-end tabular-nums">{fulfilment.pickup}</dd>
            <dt>{t('store.fulfillment_delivery')}</dt>
            <dd className="text-end tabular-nums">{fulfilment.delivery}</dd>
            <dt>{t('analytics.discounts')}</dt>
            <dd className="text-end tabular-nums">{money(discounts)}</dd>
            {[...byStatus.entries()].map(([status, n]) => (
              <div key={status} className="contents">
                <dt className="text-fg-muted">{t(`store.status_${status}`)}</dt>
                <dd className="text-end tabular-nums">{n}</dd>
              </div>
            ))}
            {channels.map((c) => (
              <div key={c.channel} className="contents">
                <dt className="text-fg-muted">{t(`analytics.channel_${c.channel}`)}</dt>
                <dd className="text-end tabular-nums">
                  {c.saleCount} ·{' '}
                  {formatMoney(
                    Money.fromJSON(c.netSales as { amount: string; currency: 'KWD' }),
                    i18n.language,
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>
    </div>
  );
}
