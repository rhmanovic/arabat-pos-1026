import { Alert } from '@arabat/ui';
import type { ReactNode } from 'react';
import { useApi } from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { formatAmount } from '../catalog/ProductsPage.js';

/**
 * Today's figures for the owner's dashboard (BR-187): net sales, refunds and net after refunds
 * for the merchant's local day, with yesterday beside them. Real figures only; a company that
 * has not sold anything yet is told so instead of being shown zeros.
 */
export function TodayKpis() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const today = useQuery({
    queryKey: ['manager', 'reports', 'today'],
    queryFn: () => api.reports.today(),
    refetchInterval: 60_000,
  });
  if (!today.data) return null;
  const d = today.data;
  if (!d.hasSales) return <Alert tone="info" title={t('dashboard.noSalesYet')} />;
  const amount = (m: { amount: string; currency: string }) => formatAmount(m, i18n.language);
  return (
    <section data-testid="dashboard-today" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold">{t('dashboard.todayTitle', { date: d.date })}</h2>
        <Link to="/reports" className="text-sm font-medium text-primary">
          {t('dashboard.openReports')}
        </Link>
      </div>
      {/* Swipe on phones, a row of four on larger screens (ADR-0131). */}
      <div className="vibe-scroll -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-4 sm:overflow-visible sm:px-0">
        <Kpi
          emoji="💰"
          tone="bg-primary-soft"
          label={t('dashboard.todaySales', { count: d.today.saleCount })}
          value={amount(d.today.netSales)}
          hint={t('dashboard.yesterdayWas', { amount: amount(d.yesterday.netSales) })}
        />
        <Kpi
          emoji="↩️"
          tone="bg-warning-soft"
          label={t('dashboard.todayRefunds', { count: d.today.refundCount })}
          value={amount(d.today.refunds)}
          hint={t('dashboard.yesterdayWas', { amount: amount(d.yesterday.refunds) })}
        />
        <Kpi
          emoji="✨"
          tone="bg-success-soft"
          label={t('dashboard.todayNet')}
          value={amount(d.today.netAfterRefunds)}
          hint={t('dashboard.yesterdayWas', { amount: amount(d.yesterday.netAfterRefunds) })}
        />
        <Kpi
          emoji="🕐"
          tone="bg-surface-muted"
          label={t('dashboard.openShifts')}
          value={String(d.openShifts)}
          hint={t('dashboard.cutOffHint', { timezone: d.timezone })}
          money={false}
        />
      </div>
    </section>
  );
}

function Kpi({
  emoji,
  tone,
  label,
  value,
  hint,
  money = true,
}: {
  emoji: string;
  tone: string;
  label: ReactNode;
  value: string;
  hint: ReactNode;
  money?: boolean;
}) {
  return (
    <div className="vibe-lift flex min-w-[11rem] snap-start flex-col rounded-xl border border-border bg-surface p-4 sm:min-w-0">
      <span aria-hidden className={`grid size-9 place-items-center rounded-lg text-lg ${tone}`}>
        {emoji}
      </span>
      <span className="mt-2 text-sm text-fg-muted">{label}</span>
      <span dir={money ? 'ltr' : undefined} className="text-2xl font-bold tabular-nums text-start">
        {value}
      </span>
      <span className="mt-1 text-xs text-fg-subtle">{hint}</span>
    </div>
  );
}
