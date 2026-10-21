import { Badge, Icon, type IconName, cn } from '@arabat/ui';
import { localizedName, useApi } from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useBranchContext, useSession } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';
import { TodayKpis } from './TodayKpis.js';
import { YourApps } from './YourApps.js';

/** Overview built only from data that exists (no invented sales or revenue). */
export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { session, can } = useSession();
  const { branches, branchId } = useBranchContext();
  const employees = useQuery({
    queryKey: ['manager', 'employees'],
    queryFn: () => api.employees.list(),
    enabled: can('employees.read'),
  });
  const roles = useQuery({
    queryKey: ['manager', 'roles'],
    queryFn: () => api.roles.list(),
    enabled: can('employees.read'),
  });
  // Cash on hand (ADR-0090/0091): treasuries + drawers + in transit, for the selected branch.
  const cash = useQuery({
    queryKey: ['manager', 'cash', 'overview', branchId],
    queryFn: () => api.cash.overview(branchId),
    enabled: can('cash.custody'),
  });
  const profile = useQuery({
    queryKey: ['manager', 'merchant'],
    queryFn: () => api.merchant.get(),
    enabled: can('merchant.settings.read'),
  });
  // Internal-control checklist (BR-165): live facts, never estimates.
  const controls = useQuery({
    queryKey: ['manager', 'merchant', 'controls'],
    queryFn: () => api.merchant.controls(),
    enabled: can('merchant.settings.read'),
  });
  // Setup checklist (owner request 2026-10-16): each step reads a live fact, never a guess.
  const methods = useQuery({
    queryKey: ['manager', 'payment-methods'],
    queryFn: () => api.payments.methods(),
    enabled: can('payments.settings'),
  });
  const registers = useQuery({
    queryKey: ['manager', 'registers', 'all'],
    queryFn: () => api.registers.list(),
    enabled: can('registers.manage'),
  });
  const categories = useQuery({
    queryKey: ['manager', 'categories'],
    queryFn: () => api.catalog.categories(),
    enabled: can('catalog.manage'),
  });
  const productCount = useQuery({
    queryKey: ['manager', 'onboarding', 'products'],
    queryFn: () => api.catalog.products({ pageSize: 1 }),
    enabled: can('catalog.manage'),
  });
  const stock = useQuery({
    queryKey: ['manager', 'onboarding', 'stock'],
    queryFn: () => api.inventory.summary(null),
    enabled: can('inventory.adjust'),
  });
  const firstSale = useQuery({
    queryKey: ['manager', 'onboarding', 'sales'],
    queryFn: () => api.sales.list({ pageSize: 1 }),
    enabled: can('sales.read'),
  });
  const names = (xs: { nameEn: string | null; nameAr: string | null }[]) =>
    xs.map((x) => localizedName(x, i18n.language)).join(', ');
  const warnings = controls.data
    ? [
        ...(controls.data.treasurerAssigned
          ? []
          : [{ key: 'treasurer', to: '/employees', text: t('dashboard.controlTreasurerMissing') }]),
        ...(controls.data.pendingCashMovements > 0
          ? [
              {
                key: 'pending',
                to: '/shifts',
                text: t('dashboard.controlPending', { count: controls.data.pendingCashMovements }),
              },
            ]
          : []),
        ...(controls.data.pendingPayoutRequests > 0
          ? [
              {
                key: 'payouts',
                to: '/cash',
                text: t('dashboard.controlPendingPayouts', {
                  count: controls.data.pendingPayoutRequests,
                }),
              },
            ]
          : []),
        ...(controls.data.openVariances > 0
          ? [
              {
                key: 'variances',
                to: '/shifts',
                text: t('dashboard.controlOpenVariances', { count: controls.data.openVariances }),
              },
            ]
          : []),
        ...(controls.data.depositsInTransit > 0
          ? [
              {
                key: 'deposits',
                to: '/cash',
                text: t('dashboard.controlDepositsInTransit', {
                  count: controls.data.depositsInTransit,
                }),
              },
            ]
          : []),
        ...(controls.data.unreconciledBankEntries > 0
          ? [
              {
                key: 'bank',
                to: '/accounts',
                text: t('dashboard.controlUnreconciledBank', {
                  count: controls.data.unreconciledBankEntries,
                }),
              },
            ]
          : []),
        ...(controls.data.pendingAdjustments > 0
          ? [
              {
                key: 'adjustments',
                to: '/inventory/adjustments',
                text: t('dashboard.controlPendingAdjustments', {
                  count: controls.data.pendingAdjustments,
                }),
              },
            ]
          : []),
        ...(controls.data.pendingTransferLosses > 0
          ? [
              {
                key: 'losses',
                to: '/transfers',
                text: t('dashboard.controlPendingTransferLosses', {
                  count: controls.data.pendingTransferLosses,
                }),
              },
            ]
          : []),
        ...(controls.data.openDeviceExceptions > 0
          ? [
              {
                key: 'devices',
                to: '/devices',
                text: t('dashboard.controlDeviceExceptions', {
                  count: controls.data.openDeviceExceptions,
                }),
              },
            ]
          : []),
        ...(controls.data.unresolvedTransferShortages > 0
          ? [
              {
                key: 'shortages',
                to: '/transfers',
                text: t('dashboard.controlUnresolvedShortages', {
                  count: controls.data.unresolvedTransferShortages,
                }),
              },
            ]
          : []),
        ...(controls.data.membersWithoutRoles.length > 0
          ? [
              {
                key: 'roles',
                to: '/employees',
                text: t('dashboard.controlMembersWithoutRoles', {
                  count: controls.data.membersWithoutRoles.length,
                  names: controls.data.membersWithoutRoles.map((m) => m.fullName).join(', '),
                }),
              },
            ]
          : []),
        ...(controls.data.registersAboveTolerance.length > 0
          ? [
              {
                key: 'tolerance',
                to: '/registers',
                text: t('dashboard.controlRegistersAboveTolerance', {
                  count: controls.data.registersAboveTolerance.length,
                  names: names(controls.data.registersAboveTolerance),
                }),
              },
            ]
          : []),
      ]
    : [];

  const inScope = (assignments: { branchId: string | null }[]) =>
    !branchId || assignments.some((a) => a.branchId === null || a.branchId === branchId);
  const activeEmployees = employees.data?.employees.filter(
    (e) => e.status === 'active' && inScope(e.assignments),
  ).length;
  const pendingInvites = employees.data?.invitations.filter(
    (i) => !i.expired && inScope(i.assignments),
  ).length;
  const activeBranches = branches.filter((b) => b.status === 'active').length;
  const customRoles = roles.data?.roles.filter((r) => !r.templateKey).length ?? 0;

  const tracked = stock.data?.trackedVariants ?? 0;
  // In the order a new company works through them; optional steps never block the setup.
  const steps: { key: string; to: string; done: boolean; visible: boolean; optional?: boolean }[] =
    [
      {
        key: 'stepProfile',
        to: '/settings',
        done: Boolean(profile.data?.legalName && profile.data.contactPhone),
        visible: can('merchant.settings.update'),
      },
      {
        key: 'stepPayments',
        to: '/payments',
        done: (methods.data?.methods.filter((m) => m.status === 'active').length ?? 0) > 0,
        visible: can('payments.settings'),
      },
      {
        key: 'stepRegisters',
        to: '/registers',
        done: (registers.data?.registers.length ?? 0) > 0,
        visible: can('registers.manage'),
      },
      {
        key: 'stepCategories',
        to: '/categories',
        done: (categories.data?.categories.length ?? 0) > 0,
        visible: can('catalog.manage'),
      },
      {
        key: 'stepProducts',
        to: '/products/new',
        done: (productCount.data?.total ?? 0) > 0,
        visible: can('catalog.manage'),
      },
      {
        key: 'stepStock',
        to: '/inventory/adjustments/new',
        done: tracked > 0 && (stock.data?.outOfStock ?? 0) < tracked,
        visible: can('inventory.adjust'),
      },
      {
        key: 'stepEmployees',
        to: '/employees',
        done: (employees.data?.employees.length ?? 0) > 1 || (pendingInvites ?? 0) > 0,
        visible: can('employees.manage'),
      },
      {
        key: 'stepTreasurer',
        to: '/employees',
        done: Boolean(controls.data?.treasurerAssigned),
        visible: can('employees.manage') && can('merchant.settings.read'),
      },
      {
        key: 'stepFirstSale',
        to: '/sales',
        done: (firstSale.data?.total ?? 0) > 0,
        visible: can('sales.read'),
      },
      {
        key: 'stepBranch',
        to: '/branches',
        done: branches.length > 1,
        visible: can('branches.manage'),
        optional: true,
      },
      {
        key: 'stepRoles',
        to: '/roles',
        done: customRoles > 0,
        visible: can('roles.manage'),
        optional: true,
      },
    ].filter((s) => s.visible);
  const required = steps.filter((s) => !s.optional);
  const doneCount = required.filter((s) => s.done).length;

  const company = session.merchant ? localizedName(session.merchant, i18n.language) : '';
  const shortcuts: { key: string; to: string; icon: IconName; visible: boolean }[] = [
    { key: 'newProduct', to: '/products/new', icon: 'plus', visible: can('catalog.manage') },
    { key: 'sales', to: '/sales', icon: 'sales', visible: can('sales.read') },
    { key: 'reports', to: '/reports', icon: 'reports', visible: can('reports.sales') },
    { key: 'team', to: '/employees', icon: 'customers', visible: can('employees.read') },
  ];
  return (
    <div className="flex flex-col gap-6">
      {/* A bold welcome with the day and one-tap shortcuts (ADR-0131). */}
      <section className="vibe-gradient vibe-glow relative overflow-hidden rounded-xl p-5 sm:p-7">
        <span
          aria-hidden
          className="pointer-events-none absolute -end-16 -top-16 size-56 rounded-full bg-white/10"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-20 end-24 size-44 rounded-full bg-white/10"
        />
        <p className="relative text-sm opacity-90">
          {new Intl.DateTimeFormat(i18n.language.startsWith('ar') ? 'ar-KW-u-nu-latn' : 'en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          }).format(new Date())}
        </p>
        <h1 className="relative mt-1 text-2xl font-bold sm:text-3xl">
          {t('dashboard.welcome', { name: session.actor.fullName })} <span aria-hidden>✨</span>
        </h1>
        <p className="relative mt-1 text-sm opacity-90">{t('dashboard.subtitle', { company })}</p>
        <div className="relative mt-5 flex flex-wrap gap-2">
          {shortcuts
            .filter((x) => x.visible)
            .map((x) => (
              <Link
                key={x.key}
                to={x.to}
                className="flex min-h-10 items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold backdrop-blur-sm transition-colors hover:bg-white/25"
              >
                <Icon name={x.icon} className="size-4" />
                {t(`dashboard.shortcut_${x.key}`)}
              </Link>
            ))}
        </div>
      </section>

      {can('merchant.settings.read') ? <YourApps /> : null}

      {can('reports.sales') ? <TodayKpis /> : null}

      {cash.data ? (
        <Link
          to="/cash"
          data-testid="dashboard-cash"
          className="vibe-lift rounded-xl border border-border bg-surface p-5"
        >
          <span className="flex items-center gap-2 text-sm text-fg-muted">
            <span
              aria-hidden
              className="grid size-9 place-items-center rounded-lg bg-success-soft text-lg"
            >
              💵
            </span>
            {t('dashboard.totalCash')}
          </span>
          <span dir="ltr" className="mt-2 block text-3xl font-bold tabular-nums">
            {formatAmount(cash.data.total, i18n.language)}
          </span>
          <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
            <span>
              {t('dashboard.inTreasuries')}{' '}
              <span dir="ltr">{formatAmount(cash.data.treasuriesTotal, i18n.language)}</span>
            </span>
            <span>
              {t('dashboard.inRegisters')}{' '}
              <span dir="ltr">{formatAmount(cash.data.registersTotal, i18n.language)}</span>
            </span>
            {cash.data.inTransitTotal.amount !== '0.000' ? (
              <span>
                {t('dashboard.inTransit')}{' '}
                <span dir="ltr">{formatAmount(cash.data.inTransitTotal, i18n.language)}</span>
              </span>
            ) : null}
          </span>
        </Link>
      ) : null}

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {can('branches.read') ? (
          <Tile
            emoji="🏬"
            to="/branches"
            label={t('dashboard.branches')}
            value={activeBranches}
            hint={t('dashboard.branchesHint', { inactive: branches.length - activeBranches })}
          />
        ) : null}
        {can('employees.read') ? (
          <Tile
            emoji="👥"
            to="/employees"
            label={t('dashboard.employees')}
            value={activeEmployees ?? '—'}
            hint={t('dashboard.employeesHint', { invited: pendingInvites ?? 0 })}
          />
        ) : null}
        {can('employees.read') ? (
          <Tile
            emoji="🛡️"
            to="/roles"
            label={t('dashboard.roles')}
            value={roles.data?.roles.length ?? '—'}
            hint={t('dashboard.rolesHint', { custom: customRoles })}
          />
        ) : null}
      </div>

      {controls.data ? (
        <section className="rounded-xl border border-border bg-surface" data-testid="controls">
          <h2 className="flex items-center gap-2 border-b border-border p-5 font-semibold">
            <span aria-hidden>{warnings.length === 0 ? '✅' : '⚡'}</span>
            <span className="flex-1">{t('dashboard.controlsTitle')}</span>
            {warnings.length > 0 ? (
              <span className="grid min-w-6 place-items-center rounded-full bg-accent px-1.5 text-xs font-bold text-accent-fg">
                {warnings.length}
              </span>
            ) : null}
          </h2>
          {warnings.length === 0 ? (
            <p className="p-5 text-sm text-fg-muted">{t('dashboard.controlsAllGood')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {warnings.map((w) => (
                <li key={w.key}>
                  <Link
                    to={w.to}
                    className="flex min-h-14 items-center justify-between gap-3 px-5 py-4 hover:bg-surface-muted"
                  >
                    <span className="text-sm">{w.text}</span>
                    <Badge tone="warning">{t('dashboard.todo')}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {steps.length > 0 ? (
        <section className="rounded-xl border border-border bg-surface">
          <div className="flex items-center gap-4 border-b border-border p-5">
            <ProgressRing done={doneCount} total={required.length} />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">{t('dashboard.onboardingTitle')}</h2>
              <span className="text-sm text-fg-muted" data-testid="onboarding-progress">
                {t('dashboard.onboardingProgress', { done: doneCount, total: required.length })}
              </span>
            </div>
          </div>
          <ul className="divide-y divide-border">
            {steps.map((step) => (
              <li key={step.key}>
                {/* The whole row is the link: an easy touch target on phones. */}
                <Link
                  to={step.to}
                  className="flex min-h-14 items-center justify-between gap-3 px-5 py-4 hover:bg-surface-muted"
                >
                  <span className="flex items-center gap-3 text-sm">
                    <span
                      aria-hidden
                      className={cn(
                        'grid size-6 shrink-0 place-items-center rounded-full border',
                        step.done
                          ? 'border-transparent bg-success text-white'
                          : 'border-border-strong text-transparent',
                      )}
                    >
                      <Icon name="check" className="size-3.5" />
                    </span>
                    {t(`dashboard.${step.key}`)}
                  </span>
                  <span className="flex items-center gap-3">
                    <Badge tone={step.done ? 'success' : step.optional ? 'neutral' : 'warning'}>
                      {step.done
                        ? t('dashboard.done')
                        : step.optional
                          ? t('dashboard.optional')
                          : t('dashboard.todo')}
                    </Badge>
                    <span className="text-sm font-medium text-primary">{t('dashboard.open')}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** A small figure card that opens its page. */
function Tile({
  emoji,
  to,
  label,
  value,
  hint,
}: {
  emoji: string;
  to: string;
  label: string;
  value: number | string;
  hint: string;
}) {
  return (
    <Link
      to={to}
      className="vibe-lift flex flex-col rounded-xl border border-border bg-surface p-3 sm:p-4"
    >
      <span
        aria-hidden
        className="grid size-9 place-items-center rounded-lg bg-primary-soft text-lg"
      >
        {emoji}
      </span>
      <span className="mt-2 text-xs text-fg-muted sm:text-sm">{label}</span>
      <span className="text-2xl font-bold tabular-nums">{value}</span>
      <span className="mt-0.5 text-xs text-fg-subtle">{hint}</span>
    </Link>
  );
}

/** Progress of the setup checklist as a ring. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const share = total === 0 ? 1 : done / total;
  return (
    <svg viewBox="0 0 56 56" className="size-14 shrink-0 -rotate-90" aria-hidden>
      <circle cx="28" cy="28" r={r} fill="none" strokeWidth="6" className="stroke-surface-muted" />
      <circle
        cx="28"
        cy="28"
        r={r}
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - share)}
        className="stroke-primary transition-[stroke-dashoffset]"
      />
      <text
        x="28"
        y="28"
        textAnchor="middle"
        dominantBaseline="central"
        className="rotate-90 fill-fg text-[0.8rem] font-bold"
        style={{ transformOrigin: '28px 28px' }}
      >
        {Math.round(share * 100)}%
      </text>
    </svg>
  );
}
