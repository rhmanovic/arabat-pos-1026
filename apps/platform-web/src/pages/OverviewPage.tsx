import { Badge, DataTable, EmptyState, Section, Spinner, StatCard } from '@arabat/ui';
import { ErrorState, useApi } from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { MERCHANT_TONE, platformKey, useFormat } from '../shared.js';

/** Operational overview across the platform (counts only, no business documents). */
export function OverviewPage() {
  const { t } = useTranslation();
  const api = useApi();
  const f = useFormat();
  const navigate = useNavigate();
  const overview = useQuery({
    queryKey: [...platformKey, 'overview'],
    queryFn: () => api.platform.overview(),
    refetchInterval: 60_000,
  });
  if (overview.isPending) return <Spinner label={t('common:status.loading')} />;
  if (overview.isError)
    return <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />;
  const o = overview.data;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t('overview.title')}</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t('overview.merchants')}
          value={o.merchants.total}
          hint={`${t('overview.new30')}: ${o.merchants.newLast30Days}`}
        />
        <StatCard label={t('overview.active')} value={o.merchants.active} />
        <StatCard label={t('overview.suspended')} value={o.merchants.suspended} />
        <StatCard label={t('overview.closed')} value={o.merchants.closed} />
        <StatCard label={t('overview.trialsEnding')} value={o.subscriptions.trialsEndingIn7Days} />
        <StatCard label={t('overview.lapsed')} value={o.subscriptions.lapsed} />
        <StatCard
          label={t('overview.sales24')}
          value={o.usage.salesLast24Hours}
          hint={`${t('overview.online24')}: ${o.usage.onlineOrdersLast24Hours}`}
        />
        <StatCard
          label={t('overview.branches')}
          value={o.usage.activeBranches}
          hint={`${t('overview.memberships')}: ${o.usage.activeMemberships}`}
        />
      </div>
      {o.merchants.total === 0 ? (
        <EmptyState title={t('overview.emptyTitle')} description={t('overview.emptyBody')} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
          <Section title={t('overview.byPlan')}>
            <ul className="flex flex-col gap-1 text-sm">
              {o.subscriptions.byPlan.map((p) => (
                <li key={p.code} className="flex justify-between">
                  <span>{f.planName(p)}</span>
                  <span className="tabular-nums">{p.merchants}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title={t('overview.recent')}>
            <DataTable
              caption={t('overview.recent')}
              rows={o.recentMerchants}
              rowKey={(m) => m.id}
              onRowClick={(m) => void navigate(`/merchants/${m.id}`)}
              columns={[
                { key: 'name', header: t('merchants.name'), cell: (m) => f.name(m) },
                {
                  key: 'created',
                  header: t('merchants.created'),
                  cell: (m) => f.date(m.createdAt),
                },
                {
                  key: 'status',
                  header: t('merchants.status'),
                  cell: (m) => (
                    <Badge tone={MERCHANT_TONE[m.status]}>{t(`status.${m.status}`)}</Badge>
                  ),
                },
              ]}
            />
          </Section>
        </div>
      )}
    </div>
  );
}
