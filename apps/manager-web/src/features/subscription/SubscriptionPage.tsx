import { PLAN_FEATURES, PLAN_LIMITS } from '@arabat/contracts';
import { Alert, Badge, PageHeader, Section, Spinner } from '@arabat/ui';
import { ErrorState, useApi } from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';

const TONE = {
  trialing: 'primary',
  active: 'success',
  past_due: 'warning',
  cancelled: 'neutral',
  expired: 'danger',
  trial_ended: 'warning',
} as const;

/** The company's own plan, status and usage (Prompt 17). Plans are changed by the platform. */
export function SubscriptionPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const sub = useQuery({
    queryKey: ['manager', 'subscription'],
    queryFn: () => api.subscription.get(),
  });
  if (sub.isPending) return <Spinner label={t('common:status.loading')} />;
  if (sub.isError) return <ErrorState error={sub.error} onRetry={() => void sub.refetch()} />;
  const s = sub.data;
  const ar = i18n.language.startsWith('ar');
  const planName = (p: { nameEn: string; nameAr: string }) => (ar ? p.nameAr : p.nameEn);
  const date = (iso: string) => formatDateTime(iso, i18n.language);
  const limit = (v: number | null) => (v === null ? t('subscription.unlimited') : String(v));
  const lapsed = ['past_due', 'expired', 'trial_ended', 'cancelled'].includes(s.effectiveStatus);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('subscription.title')} description={t('subscription.subtitle')} />
      {lapsed ? <Alert tone="warning">{t('subscription.lapsed')}</Alert> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('subscription.current')}>
          <div className="flex flex-col gap-2 text-sm">
            <p className="flex flex-wrap items-center gap-2 text-lg">
              <span className="font-semibold">{planName(s.plan)}</span>
              <Badge tone={TONE[s.effectiveStatus]} data-testid="subscription-status">
                {t(`subscription.status_${s.effectiveStatus}`)}
              </Badge>
            </p>
            {(ar ? s.plan.descriptionAr : s.plan.descriptionEn) ? (
              <p className="text-fg-muted">{ar ? s.plan.descriptionAr : s.plan.descriptionEn}</p>
            ) : null}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-fg-muted">{t('subscription.started')}</dt>
              <dd>{date(s.startsAt)}</dd>
              {s.trialEndsAt ? (
                <>
                  <dt className="text-fg-muted">{t('subscription.trialEnds')}</dt>
                  <dd>{date(s.trialEndsAt)}</dd>
                </>
              ) : null}
              {s.endsAt ? (
                <>
                  <dt className="text-fg-muted">{t('subscription.ends')}</dt>
                  <dd>{date(s.endsAt)}</dd>
                </>
              ) : null}
            </dl>
          </div>
        </Section>
        <Section title={t('subscription.usage')}>
          <ul className="flex flex-col gap-3 text-sm">
            {PLAN_LIMITS.map((k) => {
              const u = s.usage[k];
              const pct = u.max ? Math.min(100, Math.round((u.used * 100) / u.max)) : 0;
              return (
                <li key={k} data-testid={`usage-${k}`}>
                  <div className="flex justify-between">
                    <span>{t(`subscription.limit_${k}`)}</span>
                    <span className="tabular-nums">
                      {u.used} / {limit(u.max)}
                    </span>
                  </div>
                  {u.max !== null ? (
                    <div className="mt-1 h-2 rounded-full bg-surface-muted" aria-hidden>
                      <div
                        className={`h-2 rounded-full ${pct >= 100 ? 'bg-warning' : 'bg-primary'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 flex flex-wrap gap-1">
            {PLAN_FEATURES.map((f) => (
              <Badge key={f} tone={s.plan.features.includes(f) ? 'success' : 'neutral'}>
                {t(`subscription.feature_${f}`)}
                {s.plan.features.includes(f) ? '' : ` — ${t('subscription.notIncluded')}`}
              </Badge>
            ))}
          </p>
        </Section>
      </div>
      {s.availablePlans.length > 0 ? (
        <Section title={t('subscription.available')} description={t('subscription.availableHint')}>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {s.availablePlans.map((p) => (
              <li
                key={p.id}
                className={`rounded-lg border p-4 text-sm ${p.id === s.plan.id ? 'border-primary' : 'border-border'}`}
              >
                <p className="flex items-center gap-2 font-semibold">
                  {planName(p)}
                  {p.id === s.plan.id ? (
                    <Badge tone="primary">{t('subscription.yourPlan')}</Badge>
                  ) : null}
                </p>
                <p className="mt-1 text-fg-muted">
                  {p.price
                    ? t(
                        p.billingPeriod === 'year'
                          ? 'subscription.perYear'
                          : 'subscription.perMonth',
                        {
                          price: `${p.price.amount} ${p.price.currency}`,
                        },
                      )
                    : t('subscription.priceOnRequest')}
                </p>
                <ul className="mt-2 flex flex-col gap-0.5">
                  {PLAN_LIMITS.map((k) => (
                    <li key={k}>
                      {t(`subscription.limit_${k}`)}: {limit(p.limits[k])}
                    </li>
                  ))}
                  {p.features.map((f) => (
                    <li key={f}>✓ {t(`subscription.feature_${f}`)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
