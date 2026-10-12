import { Alert, Badge, PageHeader, StatCard } from '@arabat/ui';
import { localizedName, useApi } from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useBranchContext, useSession } from '../../app/context.js';

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
  const profile = useQuery({
    queryKey: ['manager', 'merchant'],
    queryFn: () => api.merchant.get(),
    enabled: can('merchant.settings.read'),
  });

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

      <Alert tone="info" title={t('dashboard.noSalesYet')} />

      {steps.length > 0 ? (
        <section className="rounded-lg border border-border bg-surface">
          <h2 className="border-b border-border p-5 font-semibold">
            {t('dashboard.onboardingTitle')}
          </h2>
          <ul className="divide-y divide-border">
            {steps.map((step) => (
              <li key={step.key} className="flex items-center justify-between gap-3 px-5 py-4">
                <span className="text-sm">{t(`dashboard.${step.key}`)}</span>
                <span className="flex items-center gap-3">
                  <Badge tone={step.done ? 'success' : 'warning'}>
                    {step.done ? t('dashboard.done') : t('dashboard.todo')}
                  </Badge>
                  <Link to={step.to} className="text-sm font-medium text-primary hover:underline">
                    {t('dashboard.open')}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
