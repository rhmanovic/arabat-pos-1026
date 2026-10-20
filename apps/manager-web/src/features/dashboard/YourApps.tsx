import type { ManagerSubscription } from '@arabat/contracts';
import { Badge } from '@arabat/ui';
import { useApi } from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useSession } from '../../app/context.js';
import { NAV } from '../../app/navigation.js';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';

type AppKey = 'manager' | 'pos' | 'links' | 'online' | 'restaurant' | 'website';
type AppState = 'included' | 'notIncluded' | 'soon';

interface AppTile {
  key: AppKey;
  state: AppState;
  /** In-app route, or an absolute address of a separate application. */
  to?: string;
  external?: boolean;
}

const STATUS_TONE = {
  trialing: 'primary',
  active: 'success',
  past_due: 'warning',
  cancelled: 'neutral',
  expired: 'danger',
  trial_ended: 'warning',
} as const;

/** Icon tile colours: one strong hue per product so the row reads at a glance. */
const ICON_STYLE: Record<AppKey, string> = {
  manager: 'linear-gradient(135deg, oklch(0.55 0.17 255), oklch(0.42 0.16 275))',
  pos: 'linear-gradient(135deg, oklch(0.68 0.16 160), oklch(0.5 0.15 180))',
  links: 'linear-gradient(135deg, oklch(0.7 0.19 330), oklch(0.55 0.2 300))',
  online: 'linear-gradient(135deg, oklch(0.75 0.17 60), oklch(0.6 0.19 35))',
  restaurant: 'linear-gradient(135deg, oklch(0.68 0.19 25), oklch(0.5 0.18 10))',
  website: 'linear-gradient(135deg, oklch(0.7 0.14 220), oklch(0.5 0.13 240))',
};

const ICONS: Record<AppKey, ReactNode> = {
  manager: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  pos: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M7 20h10M12 16v4M7 8h6M7 12h3" />
    </>
  ),
  links: (
    <>
      <path d="M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.5-1.5" />
    </>
  ),
  online: (
    <>
      <path d="M3 7h18l-1.5 12a1.5 1.5 0 0 1-1.5 1.3H6a1.5 1.5 0 0 1-1.5-1.3L3 7Z" />
      <path d="M8 7V6a4 4 0 0 1 8 0v1" />
    </>
  ),
  restaurant: (
    <>
      <path d="M6 3v7a3 3 0 0 0 6 0V3M9 3v18" />
      <path d="M17 3c-2 2-2 6-2 8h4v10" />
    </>
  ),
  website: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
};

/**
 * "Your apps" (owner request 2026-10-19): what the company owns under its subscription, each
 * product as a tile with a clear icon and a state read from the plan — included, not included
 * (upgrade through the platform) or coming soon. Nothing here is a guess: the management app,
 * the register and the link page come with every plan (ADR-0116 adds no feature for the link
 * page), the online store and the restaurant follow the plan's features, and the products not
 * built yet say so.
 */
export function YourApps() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { can } = useSession();
  const sub = useQuery({
    queryKey: ['manager', 'subscription'],
    queryFn: () => api.subscription.get(),
    enabled: can('merchant.settings.read'),
  });
  if (!sub.data) return null;
  const s = sub.data;
  const ar = i18n.language.startsWith('ar');
  const has = (f: ManagerSubscription['plan']['features'][number]) => s.plan.features.includes(f);
  const linksTo = NAV.find((n) => n.key === 'links')?.to;
  const onlineTo = NAV.find((n) => n.key === 'online')?.to;
  const tiles: AppTile[] = [
    { key: 'manager', state: 'included', to: '/' },
    { key: 'pos', state: 'included', to: can('registers.manage') ? '/registers' : undefined },
    {
      key: 'links',
      state: 'included',
      to: can('online.manage') ? linksTo : undefined,
      external: true,
    },
    {
      key: 'online',
      state: has('ecommerce') ? 'included' : 'notIncluded',
      to: has('ecommerce') && can('online.manage') ? onlineTo : undefined,
      external: true,
    },
    {
      key: 'restaurant',
      state: has('restaurant') ? 'included' : 'notIncluded',
      to: has('restaurant') && can('restaurant.manage') ? '/restaurant' : undefined,
    },
    { key: 'website', state: 'soon' },
  ];
  const included = tiles.filter((x) => x.state === 'included').length;
  const dateLine = s.trialEndsAt
    ? t('dashboard.apps.trialEnds', { date: formatDateTime(s.trialEndsAt, i18n.language) })
    : s.endsAt
      ? t('dashboard.apps.renews', { date: formatDateTime(s.endsAt, i18n.language) })
      : null;

  return (
    <section
      data-testid="dashboard-apps"
      className="rounded-xl border border-border bg-surface p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{t('dashboard.apps.title')}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
            <span className="font-medium text-fg" data-testid="apps-plan">
              {ar ? s.plan.nameAr : s.plan.nameEn}
            </span>
            <Badge tone={STATUS_TONE[s.effectiveStatus]}>
              {t(`subscription.status_${s.effectiveStatus}`)}
            </Badge>
            <span>{t('dashboard.apps.count', { included, total: tiles.length })}</span>
            {dateLine ? <span>{dateLine}</span> : null}
          </p>
        </div>
        <Link to="/subscription" className="text-sm font-medium text-primary">
          {t('dashboard.apps.manage')}
        </Link>
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 xl:grid-cols-6">
        {tiles.map((tile) => (
          <li key={tile.key} data-testid={`app-${tile.key}`} data-state={tile.state}>
            <Tile tile={tile} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tile({ tile }: { tile: AppTile }) {
  const { t } = useTranslation();
  const muted = tile.state !== 'included';
  const body = (
    <>
      <span
        aria-hidden
        className={`flex size-11 items-center justify-center rounded-xl text-white shadow-sm ${muted ? 'opacity-45 grayscale-[35%]' : ''}`}
        style={{ background: ICON_STYLE[tile.key] }}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {ICONS[tile.key]}
        </svg>
      </span>
      <span className="mt-3 block font-semibold leading-tight">
        {t(`dashboard.apps.${tile.key}`)}
      </span>
      <span className="mt-0.5 block text-xs text-fg-muted">
        {t(`dashboard.apps.${tile.key}Hint`)}
      </span>
      <span className="mt-2 block">
        {tile.state === 'included' ? (
          <Badge tone="success">✓ {t('dashboard.apps.included')}</Badge>
        ) : tile.state === 'soon' ? (
          <Badge tone="primary">{t('dashboard.apps.soon')}</Badge>
        ) : (
          <Badge tone="neutral">{t('dashboard.apps.notIncluded')}</Badge>
        )}
      </span>
    </>
  );
  const className =
    'flex h-full flex-col rounded-xl border border-border bg-surface p-3 text-start sm:p-4';
  if (tile.state === 'notIncluded')
    return (
      <Link to="/subscription" className={`${className} hover:bg-surface-muted`}>
        {body}
        <span className="mt-1 block text-xs font-medium text-primary">
          {t('dashboard.apps.upgrade')}
        </span>
      </Link>
    );
  if (!tile.to) return <div className={className}>{body}</div>;
  if (tile.external)
    return (
      <a href={tile.to} className={`${className} hover:bg-surface-muted`}>
        {body}
      </a>
    );
  return (
    <Link to={tile.to} className={`${className} hover:bg-surface-muted`}>
      {body}
    </Link>
  );
}
