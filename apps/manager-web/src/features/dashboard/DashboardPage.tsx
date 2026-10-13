import { Alert, Badge, PageHeader, StatCard } from '@arabat/ui';
import { localizedName, useApi } from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useBranchContext, useSession } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';

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

  const steps = [
    {
      key: 'stepProfile',
      to: '/settings',
      done: Boolean(profile.data?.legalName && profile.data.contactPhone),
      visible: can('merchant.settings.update'),
    },
    {
      key: 'stepBranch',
      to: '/branches',
      done: branches.length > 1,
      visible: can('branches.manage'),
    },
    {
      key: 'stepEmployees',
      to: '/employees',
      done: (employees.data?.employees.length ?? 0) > 1 || (pendingInvites ?? 0) > 0,
      visible: can('employees.manage'),
    },
    { key: 'stepRoles', to: '/roles', done: customRoles > 0, visible: can('roles.manage') },
  ].filter((s) => s.visible);

  const company = session.merchant ? localizedName(session.merchant, i18n.language) : '';
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('dashboard.welcome', { name: session.actor.fullName })}
        description={t('dashboard.subtitle', { company })}
      />

      {cash.data ? (
        <Link
          to="/cash"
          data-testid="dashboard-cash"
          className="rounded-lg border border-border bg-surface p-5 hover:bg-surface-muted"
        >
          <span className="block text-sm text-fg-muted">{t('dashboard.totalCash')}</span>
          <span dir="ltr" className="block text-3xl font-semibold tabular-nums">
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
          <StatCard
            label={t('dashboard.branches')}
            value={activeBranches}
            hint={t('dashboard.branchesHint', { inactive: branches.length - activeBranches })}
          />
        ) : null}
        {can('employees.read') ? (
          <StatCard
            label={t('dashboard.employees')}
            value={activeEmployees ?? '—'}
            hint={t('dashboard.employeesHint', { invited: pendingInvites ?? 0 })}
          />
        ) : null}
        {can('employees.read') ? (
          <StatCard
            label={t('dashboard.roles')}
            value={roles.data?.roles.length ?? '—'}
            hint={t('dashboard.rolesHint', { custom: customRoles })}
          />
        ) : null}
      </div>

      {controls.data ? (
        <section className="rounded-lg border border-border bg-surface" data-testid="controls">
          <h2 className="border-b border-border p-5 font-semibold">
            {t('dashboard.controlsTitle')}
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

      <Alert tone="info" title={t('dashboard.noSalesYet')} />

      {steps.length > 0 ? (
        <section className="rounded-lg border border-border bg-surface">
          <h2 className="border-b border-border p-5 font-semibold">
            {t('dashboard.onboardingTitle')}
          </h2>
          <ul className="divide-y divide-border">
            {steps.map((step) => (
              <li key={step.key}>
                {/* The whole row is the link: an easy touch target on phones. */}
                <Link
                  to={step.to}
                  className="flex min-h-14 items-center justify-between gap-3 px-5 py-4 hover:bg-surface-muted"
                >
                  <span className="text-sm">{t(`dashboard.${step.key}`)}</span>
                  <span className="flex items-center gap-3">
                    <Badge tone={step.done ? 'success' : 'warning'}>
                      {step.done ? t('dashboard.done') : t('dashboard.todo')}
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
