import { Alert, StatCard } from '@arabat/ui';
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-4">
        <StatCard
          label={t('dashboard.todaySales', { count: d.today.saleCount })}
          value={<span dir="ltr">{amount(d.today.netSales)}</span>}
          hint={t('dashboard.yesterdayWas', { amount: amount(d.yesterday.netSales) })}
        />
        <StatCard
          label={t('dashboard.todayRefunds', { count: d.today.refundCount })}
          value={<span dir="ltr">{amount(d.today.refunds)}</span>}
          hint={t('dashboard.yesterdayWas', { amount: amount(d.yesterday.refunds) })}
        />
        <StatCard
          label={t('dashboard.todayNet')}
          value={<span dir="ltr">{amount(d.today.netAfterRefunds)}</span>}
          hint={t('dashboard.yesterdayWas', { amount: amount(d.yesterday.netAfterRefunds) })}
        />
        <StatCard
          label={t('dashboard.openShifts')}
          value={d.openShifts}
          hint={t('dashboard.cutOffHint', { timezone: d.timezone })}
        />
      </div>
    </section>
  );
}
