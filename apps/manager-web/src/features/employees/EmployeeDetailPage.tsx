import { type Assignment, type Employee, type Role, updateEmployeeSchema } from '@arabat/contracts';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  PageHeader,
  Section,
  Spinner,
} from '@arabat/ui';
import { ErrorState, useApi, useNotify } from '@arabat/web-core';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import type { z } from 'zod';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';
import { AssignmentsEditor, useAssignmentLabel } from './AssignmentsEditor.js';
import { employeesKey, rolesKey } from './EmployeesPage.js';

type ProfileValues = z.input<typeof updateEmployeeSchema>;

export function EmployeeDetailPage() {
  const { membershipId = '' } = useParams();
  const api = useApi();
  const employee = useQuery({
    queryKey: [...employeesKey, membershipId],
    queryFn: () => api.employees.get(membershipId),
  });
  const roles = useQuery({ queryKey: rolesKey, queryFn: () => api.roles.list() });

  if (employee.isPending || roles.isPending) return <Spinner />;
  if (employee.isError)
    return <ErrorState error={employee.error} onRetry={() => void employee.refetch()} />;
  if (roles.isError) return <ErrorState error={roles.error} onRetry={() => void roles.refetch()} />;
  return (
    <EmployeeDetail
      employee={employee.data}
      roles={roles.data.roles}
      key={employee.data.membershipId}
    />
  );
}

function EmployeeDetail({ employee, roles }: { employee: Employee; roles: Role[] }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const label = useAssignmentLabel(roles);
  const [assignments, setAssignments] = useState<Assignment[]>(employee.assignments);
  const [confirmOff, setConfirmOff] = useState(false);
  const editable = employee.manageable;
  const form = useForm<ProfileValues>({ resolver: zodResolver(updateEmployeeSchema) });
  useEffect(() => {
    form.reset({
      jobTitle: employee.jobTitle ?? '',
      phone: employee.phone ?? '',
      employeeCode: employee.employeeCode ?? '',
    });
  }, [employee, form]);

  const refresh = async (data: Employee) => {
    queryClient.setQueryData([...employeesKey, employee.membershipId], data);
    await queryClient.invalidateQueries({ queryKey: employeesKey, exact: true });
  };
  const saveProfile = useMutation({
    mutationFn: (v: ProfileValues) => api.employees.update(employee.membershipId, v),
    onSuccess: async (d) => {
      await refresh(d);
      notify.ok(t('common.saved'));
    },
    onError: notify.fail,
  });
  const saveRoles = useMutation({
    mutationFn: () => api.employees.setAssignments(employee.membershipId, { assignments }),
    onSuccess: async (d) => {
      await refresh(d);
      notify.ok(t('employees.rolesSaved'));
    },
    onError: notify.fail,
  });
  const setStatus = useMutation({
    mutationFn: (status: 'active' | 'inactive') =>
      api.employees.setStatus(employee.membershipId, status),
    onSuccess: async (d) => {
      await refresh(d);
      setConfirmOff(false);
      notify.ok(t('employees.statusChanged'));
    },
    onError: notify.fail,
  });
  const reset = useMutation({
    mutationFn: () => api.employees.sendPasswordReset(employee.membershipId),
    onSuccess: () => notify.ok(t('employees.resetSent')),
    onError: notify.fail,
  });
  // Account hygiene (BR-193): end every session at once; clear a sign-in lock.
  const endSessions = useMutation({
    mutationFn: () => api.employees.revokeSessions(employee.membershipId),
    onSuccess: (r) => notify.ok(t('employees.sessionsEnded', { count: r.ended })),
    onError: notify.fail,
  });
  const unlock = useMutation({
    mutationFn: () => api.employees.unlock(employee.membershipId),
    onSuccess: () => notify.ok(t('employees.unlocked')),
    onError: notify.fail,
  });

  return (
    <div className="flex flex-col gap-6">
      <Link to="/employees" className="text-sm text-primary hover:underline">
        {t('common.back')}
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {employee.fullName}
            {employee.isOwner ? <Badge tone="primary">{t('employees.owner')}</Badge> : null}
            <Badge tone={employee.status === 'active' ? 'success' : 'neutral'}>
              {t(`common.${employee.status}`)}
            </Badge>
          </span>
        }
        description={<span dir="ltr">{employee.email}</span>}
        actions={
          editable ? (
            <>
              <Button variant="secondary" loading={reset.isPending} onClick={() => reset.mutate()}>
                {t('employees.sendReset')}
              </Button>
              <Button
                variant="secondary"
                loading={endSessions.isPending}
                onClick={() => endSessions.mutate()}
              >
                {t('employees.endSessions')}
              </Button>
              <Button
                variant="secondary"
                loading={unlock.isPending}
                onClick={() => unlock.mutate()}
              >
                {t('employees.unlock')}
              </Button>
              {employee.status === 'active' ? (
                <Button variant="danger" onClick={() => setConfirmOff(true)}>
                  {t('common.deactivate')}
                </Button>
              ) : (
                <Button loading={setStatus.isPending} onClick={() => setStatus.mutate('active')}>
                  {t('common.activate')}
                </Button>
              )}
            </>
          ) : null
        }
      />
      {!editable ? <Alert tone="info" title={t('employees.notManageable')} /> : null}

      <Section title={t('employees.profile')}>
        <form noValidate onSubmit={form.handleSubmit((v) => saveProfile.mutate(v))}>
          <fieldset disabled={!editable} className="grid gap-4 md:grid-cols-3">
            <Field label={t('employees.jobTitle')}>
              {(p) => <Input {...p} {...form.register('jobTitle')} />}
            </Field>
            <Field label={t('common.phone')}>
              {(p) => <Input {...p} {...form.register('phone')} type="tel" dir="ltr" />}
            </Field>
            <Field label={t('employees.employeeCode')}>
              {(p) => <Input {...p} {...form.register('employeeCode')} dir="ltr" />}
            </Field>
          </fieldset>
          {editable ? (
            <div className="mt-4 flex justify-end">
              <Button type="submit" loading={saveProfile.isPending}>
                {t('common.save')}
              </Button>
            </div>
          ) : null}
        </form>
      </Section>

      {editable ? <PinSection employee={employee} onSaved={refresh} /> : null}

      <Section
        title={t('employees.assignments')}
        description={employee.isOwner ? t('employees.owner') : label(employee.assignments)}
      >
        {employee.isOwner ? null : (
          <>
            <AssignmentsEditor
              value={assignments}
              onChange={setAssignments}
              roles={roles}
              disabled={!editable}
            />
            {editable ? (
              <div className="mt-4 flex justify-end">
                <Button loading={saveRoles.isPending} onClick={() => saveRoles.mutate()}>
                  {t('employees.saveRoles')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Section>

      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        title={t('employees.deactivateTitle', { name: employee.fullName })}
        description={t('employees.deactivateBody')}
        confirmLabel={t('common.deactivate')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        loading={setStatus.isPending}
        onConfirm={() => setStatus.mutate('inactive')}
      />
    </div>
  );
}

/**
 * The device PIN (ADR-0112, owner decision 6): the cashier chooses it from the till through an
 * e-mailed link; nobody else knows it. A manager can only clear it.
 */
function PinSection({
  employee,
  onSaved,
}: {
  employee: Employee;
  onSaved: (e: Employee) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const [confirm, setConfirm] = useState(false);
  const clear = useMutation({
    mutationFn: () => api.employees.clearPin(employee.membershipId),
    onSuccess: async () => {
      setConfirm(false);
      await onSaved(await api.employees.get(employee.membershipId));
      notify.ok(t('employees.pinCleared'));
    },
    onError: notify.fail,
  });
  return (
    <Section
      title={t('employees.pin')}
      description={
        employee.pinSetAt
          ? t('employees.pinSetOn', { date: formatDateTime(employee.pinSetAt, i18n.language) })
          : t('employees.pinNone')
      }
    >
      <p className="text-sm text-fg-muted">{t('employees.pinHint')}</p>
      {employee.pinSetAt ? (
        <div className="mt-3">
          <Button variant="secondary" onClick={() => setConfirm(true)}>
            {t('employees.pinClear')}
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('employees.pinClearTitle', { name: employee.fullName })}
        description={t('employees.pinClearBody')}
        confirmLabel={t('employees.pinClear')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        loading={clear.isPending}
        onConfirm={() => clear.mutate()}
      />
    </Section>
  );
}
