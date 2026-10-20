import type { OnlineStore } from '@arabat/contracts';
import { Badge, Button, cn } from '@arabat/ui';
import { useApi } from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { linksUrl, managerUrl, useSession } from '../../app/context.js';
import { Icon, type IconName } from '../../app/icons.js';
import { ORDER_TONE, formatAmount, formatDateTime, key, useOrderOverview } from '../shared.js';

/**
 * Overview (ADR-0127): the store with its link to share, what is left before launch, the
 * orders that need someone, the latest orders and one-tap shortcuts.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const api = useApi();
  const store = useQuery({
    queryKey: [...key, 'store'],
    queryFn: () => api.online.store(),
    enabled: can('online.manage'),
  });
  const s = store.data;
  return (
    <div className="flex flex-col gap-6">
      {/* Staff who only handle orders see the page title instead of the store card. */}
      {!can('online.manage') ? (
        <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
      ) : null}
      {can('online.manage') && s ? <StoreHero store={s} /> : null}
      {can('online.manage') && s ? <LaunchChecklist store={s} /> : null}
      {can('online.orders') ? <OrdersOverview /> : null}
      <QuickActions />
      <SharedCard />
    </div>
  );
}

// ------------------------------------------------------------------------------ store hero
function StoreHero({ store: s }: { store: OnlineStore }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const name = s.nameAr || s.nameEn || t('dashboard.storeCard');
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const copy = () => {
    void navigator.clipboard?.writeText(s.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  const statusDot = { published: 'bg-success', paused: 'bg-warning', draft: 'bg-fg-subtle' }[
    s.status
  ];
  return (
    <section
      aria-label={t('dashboard.storeCard')}
      className="vibe-gradient vibe-glow relative overflow-hidden rounded-xl p-5 sm:p-7"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -end-16 -top-16 size-56 rounded-full bg-white/10 blur-2xl"
      />
      <div className="relative flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-sm font-semibold text-white/85">{t('dashboard.title')}</h1>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur">
            <span aria-hidden className={cn('size-2 rounded-full', statusDot)} />
            {t(`dashboard.status_${s.status}`)}
          </span>
        </div>
        <div>
          <p className="text-2xl font-bold sm:text-3xl">{name}</p>
          <p className="mt-1 text-sm text-white/85">
            {s.status === 'draft' ? t('dashboard.noStoreYet') : t('dashboard.heroLive')}
          </p>
        </div>
        <p
          dir="ltr"
          className="w-fit max-w-full truncate rounded-lg bg-black/20 px-3 py-2 font-mono text-sm"
          data-testid="store-url"
        >
          {s.url}
        </p>
        <div className="flex flex-wrap gap-2">
          {s.status !== 'draft' ? (
            <a href={s.url} target="_blank" rel="noreferrer">
              <Button size="md" className="bg-white text-[oklch(0.35_0.2_292)] hover:bg-white/90">
                <Icon name="external" className="size-4 rtl:-scale-x-100" />
                {t('dashboard.openStore')}
              </Button>
            </a>
          ) : (
            <Link to="/settings">
              <Button size="md" className="bg-white text-[oklch(0.35_0.2_292)] hover:bg-white/90">
                <Icon name="rocket" className="size-4" />
                {t('dashboard.setUp')}
              </Button>
            </Link>
          )}
          <Button
            size="md"
            className="bg-white/15 text-white hover:bg-white/25"
            onClick={copy}
            aria-live="polite"
          >
            <Icon name={copied ? 'check' : 'copy'} className="size-4" />
            {copied ? t('dashboard.copied') : t('dashboard.copyLink')}
          </Button>
          {canShare ? (
            <Button
              size="md"
              className="bg-white/15 text-white hover:bg-white/25"
              onClick={() => void navigator.share({ title: name, url: s.url }).catch(() => {})}
            >
              <Icon name="share" className="size-4" />
              {t('dashboard.share')}
            </Button>
          ) : null}
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`${name} ${s.url}`)}`}
            target="_blank"
            rel="noreferrer"
          >
            <Button size="md" className="bg-white/15 text-white hover:bg-white/25">
              {t('dashboard.whatsapp')}
            </Button>
          </a>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------ launch checklist
function LaunchChecklist({ store: s }: { store: OnlineStore }) {
  const { t } = useTranslation();
  const api = useApi();
  const listings = useQuery({
    queryKey: [...key, 'listings'],
    queryFn: () => api.online.listings(),
  });
  const listed = (listings.data?.products ?? []).some((p) => p.listed);
  const steps: { key: string; done: boolean; to: string }[] = [
    { key: 'name', done: Boolean(s.nameAr || s.nameEn), to: '/settings' },
    { key: 'products', done: listed, to: '/products' },
    { key: 'branch', done: Boolean(s.fulfillmentBranchId), to: '/settings' },
    {
      key: 'payment',
      done: s.payOnReceiptEnabled || s.paymentMethods.some((m) => m.ready),
      to: '/settings',
    },
    { key: 'look', done: Boolean(s.logoUrl || s.bannerUrl), to: '/settings' },
    { key: 'publish', done: s.status === 'published', to: '/settings' },
  ];
  const done = steps.filter((x) => x.done).length;
  const percent = Math.round((done / steps.length) * 100);
  if (done === steps.length)
    return (
      <p
        className="flex items-center gap-3 rounded-xl border border-success/30 bg-success-soft p-4 text-sm font-medium"
        data-testid="launch-done"
      >
        <span aria-hidden className="text-xl">
          🚀
        </span>
        {t('dashboard.launchDone')}
      </p>
    );
  return (
    <section
      aria-labelledby="launch-title"
      className="rounded-xl border border-border bg-surface p-5"
      data-testid="launch-checklist"
    >
      <div className="flex items-center gap-4">
        <ProgressRing percent={percent} />
        <div className="min-w-0">
          <h2 id="launch-title" className="text-lg font-bold">
            {t('dashboard.launchTitle')}
          </h2>
          <p className="text-sm text-fg-muted">
            {t('dashboard.launchProgress', { done, total: steps.length })}
          </p>
        </div>
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.key}>
            <Link
              to={step.to}
              className={cn(
                'vibe-lift flex items-center gap-3 rounded-lg border p-3 text-sm',
                step.done
                  ? 'border-success/30 bg-success-soft text-fg-muted'
                  : 'border-border bg-surface',
              )}
            >
              <span
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold',
                  step.done ? 'bg-success text-primary-fg' : 'bg-primary-soft text-primary',
                )}
              >
                {step.done ? <Icon name="check" className="size-4" /> : i + 1}
              </span>
              <span className={cn('flex-1', step.done ? 'line-through' : 'font-medium')}>
                {t(`dashboard.step_${step.key}`)}
              </span>
              {step.done ? (
                <span className="sr-only">{t('dashboard.stepDone')}</span>
              ) : (
                <Icon name="arrow" className="size-4 text-fg-subtle rtl:-scale-x-100" />
              )}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ProgressRing({ percent }: { percent: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative size-16 shrink-0" role="img" aria-label={`${percent}%`}>
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90" aria-hidden>
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="7"
          className="stroke-surface-muted"
        />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          className="stroke-primary transition-[stroke-dashoffset] duration-500"
          strokeDasharray={c}
          strokeDashoffset={c - (c * percent) / 100}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-bold tabular-nums">
        {percent}%
      </span>
    </div>
  );
}

// ------------------------------------------------------------------------- orders overview
function OrdersOverview() {
  const { t, i18n } = useTranslation();
  const overview = useOrderOverview(true);
  const counts = overview.data?.counts ?? {};
  const n = (...statuses: string[]) => statuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
  const tiles = [
    {
      key: 'newOrders',
      emoji: '🔔',
      value: n('placed'),
      status: 'placed',
      tint: 'bg-warning-soft',
    },
    {
      key: 'awaitingPayment',
      emoji: '⏳',
      value: n('pending_payment'),
      status: 'pending_payment',
      tint: 'bg-surface-muted',
    },
    {
      key: 'toPrepare',
      emoji: '📦',
      value: n('confirmed', 'paid'),
      status: '',
      tint: 'bg-primary-soft',
    },
    {
      key: 'inProgress',
      emoji: '🛵',
      value: n('preparing', 'ready', 'out_for_delivery'),
      status: '',
      tint: 'bg-success-soft',
    },
    {
      key: 'attention',
      emoji: '⚠️',
      value: n('needs_attention'),
      status: 'needs_attention',
      tint: 'bg-danger-soft',
    },
  ];
  const latest = overview.data?.orders ?? [];
  return (
    <section aria-labelledby="orders-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="orders-title" className="text-lg font-bold">
          {t('dashboard.ordersCard')}
        </h2>
        <Link className="text-sm font-medium text-primary hover:underline" to="/orders">
          {t('dashboard.allOrders')}
        </Link>
      </div>
      <ul className="vibe-scroll -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0 lg:grid-cols-5">
        {tiles.map((tile) => (
          <li key={tile.key} className="w-40 shrink-0 snap-start sm:w-auto">
            <Link
              to={tile.status ? `/orders?status=${tile.status}` : '/orders'}
              className="vibe-lift flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-4"
            >
              <span
                aria-hidden
                className={cn('grid size-10 place-items-center rounded-lg text-lg', tile.tint)}
              >
                {tile.emoji}
              </span>
              <span
                className={cn(
                  'text-3xl font-bold tabular-nums',
                  tile.value === 0 && 'text-fg-subtle',
                )}
                dir="ltr"
                data-testid={`count-${tile.key}`}
              >
                {tile.value}
              </span>
              <span className="text-sm text-fg-muted">{t(`dashboard.${tile.key}`)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="rounded-xl border border-border bg-surface">
        <h3 className="border-b border-border px-5 py-3 text-sm font-bold">
          {t('dashboard.latest')}
        </h3>
        {latest.length === 0 ? (
          <p className="flex items-center gap-3 px-5 py-6 text-sm text-fg-muted">
            <span aria-hidden className="text-2xl">
              ✨
            </span>
            {t('dashboard.noOrdersYet')}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {latest.map((o) => (
              <li key={o.id}>
                <Link
                  to={`/orders?status=${o.status}`}
                  className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-surface-muted"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary">
                    {o.customerName.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{o.customerName}</span>
                    <span className="block text-xs text-fg-muted">
                      <span dir="ltr">{o.number}</span> ·{' '}
                      {formatDateTime(o.createdAt, i18n.language)}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span className="font-semibold tabular-nums">
                      {formatAmount(o.total, i18n.language)}
                    </span>
                    <Badge tone={ORDER_TONE[o.status]}>{t(`store.status_${o.status}`)}</Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------- quick actions
function QuickActions() {
  const { t } = useTranslation();
  const { can } = useSession();
  const actions: { key: string; icon: IconName; to: string; perm: string; external?: boolean }[] = [
    { key: 'qaProducts', icon: 'products', to: '/products', perm: 'online.manage' },
    { key: 'qaPromotion', icon: 'promotions', to: '/promotions', perm: 'online.manage' },
    { key: 'qaAreas', icon: 'areas', to: '/delivery-areas', perm: 'online.manage' },
    { key: 'qaAnalytics', icon: 'analytics', to: '/analytics', perm: 'online.orders' },
    { key: 'qaLinks', icon: 'links', to: linksUrl(), perm: 'online.manage', external: true },
    { key: 'qaSettings', icon: 'settings', to: '/settings', perm: 'online.manage' },
  ];
  const shown = actions.filter((a) => can(a.perm));
  if (shown.length === 0) return null;
  const tile =
    'vibe-lift flex flex-col items-center gap-2 rounded-xl border border-border bg-surface p-4 text-center text-sm font-medium';
  const icon = (name: IconName) => (
    <span className="grid size-11 place-items-center rounded-full bg-primary-soft text-primary">
      <Icon name={name} />
    </span>
  );
  return (
    <section aria-labelledby="qa-title" className="flex flex-col gap-3">
      <h2 id="qa-title" className="text-lg font-bold">
        {t('dashboard.quickActions')}
      </h2>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {shown.map((a) => (
          <li key={a.key}>
            {a.external ? (
              <a href={a.to} className={tile}>
                {icon(a.icon)}
                {t(`dashboard.${a.key}`)}
              </a>
            ) : (
              <Link to={a.to} className={tile}>
                {icon(a.icon)}
                {t(`dashboard.${a.key}`)}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// -------------------------------------------------------------------------------- shared
function SharedCard() {
  const { t } = useTranslation();
  const { can } = useSession();
  const links = (
    [
      ['catalog', 'products', 'catalog.read'],
      ['customers', 'customers', 'customers.read'],
      ['reports', 'reports', 'reports.sales'],
      ['payments', 'payments', 'payments.settings'],
    ] as const
  ).filter(([, , perm]) => can(perm));
  return (
    <section className="rounded-xl border border-dashed border-border-strong p-5">
      <h2 className="font-bold">{t('dashboard.sharedCard')}</h2>
      <p className="mt-1 text-sm text-fg-muted">{t('dashboard.sharedHint')}</p>
      {links.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {links.map(([k, path]) => (
            <a key={k} href={managerUrl(path)}>
              <Button size="sm" variant="secondary">
                {t(`nav.${k}`)}
                <Icon name="external" className="size-4 rtl:-scale-x-100" />
              </Button>
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}
