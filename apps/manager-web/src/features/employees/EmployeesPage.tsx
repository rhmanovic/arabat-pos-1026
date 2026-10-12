import { type Assignment, type Role, inviteEmployeeSchema } from '@arabat/contracts';
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Select,
  TabPanel,
  Tabs,
} from '@arabat/ui';
import { ErrorState, useApi, useNotify } from '@arabat/web-core';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { useBranchContext, useSession } from '../../app/context.js';
import { AssignmentsEditor, useAssignmentLabel } from './AssignmentsEditor.js';

export const employeesKey = ['manager', 'employees'] as const;
export const rolesKey = ['manager', 'roles'] as const;

export function EmployeesPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const { branchId } = useBranchContext();
  const [tab, setTab] = useState('employees');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [inviting, setInviting] = useState(false);
  const list = useQuery({ queryKey: employeesKey, queryFn: () => api.employees.list() });
  const roles = useQuery({ queryKey: rolesKey, queryFn: () => api.roles.list() });
  const label = useAssignmentLabel(roles.data?.roles);
  const fmt = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
    numberingSystem: 'latn',
  });

  const inBranch = (assignments: Assignment[]) =>
    !branchId || assignments.some((a) => a.branchId === null || a.branchId === branchId);
  const employees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data?.employees ?? []).filter(
      (e) =>
        (e.isOwner || inBranch(e.assignments)) &&
        (!status || e.status === status) &&
        (!q ||
          e.fullName.toLowerCase().includes(q) ||
          e.email.includes(q) ||
          (e.employeeCode ?? '').toLowerCase().includes(q)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inBranch depends on branchId only
  }, [list.data, search, status, branchId]);
  const invitations = (list.data?.invitations ?? []).filter((i) => inBranch(i.assignments));

  const invitationAction = useMutation({
    mutationFn: (v: { id: string; action: 'resend' | 'revoke' }) =>
      v.action === 'resend'
        ? api.employees.resendInvitation(v.id)
        : api.employees.revokeInvitation(v.id),
    onSuccess: async (_d, v) => {
      await queryClient.invalidateQueries({ queryKey: employeesKey });
      notify.ok(v.action === 'resend' ? t('employees.resent') : t('employees.revoked'));
    },
    onError: notify.fail,
  });

  return (
    <div>
      <PageHeader
        title={t('employees.title')}
        description={t('employees.subtitle')}
        actions={
          can('employees.manage') ? (
            <Button onClick={() => setInviting(true)}>{t('employees.invite')}</Button>
          ) : null
        }
      />
      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'employees', label: t('employees.tabEmployees') },
          {
            value: 'invitations',
            label: `${t('employees.tabInvitations')} (${invitations.length})`,
          },
        ]}
      >
        <TabPanel value="employees">
          <div className="mb-4 flex flex-wrap gap-3">
            <Input
              className="max-w-xs"
              type="search"
              placeholder={t('common.search')}
              aria-label={t('common.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select
              className="max-w-48"
              aria-label={t('common.status')}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">{t('common.allStatuses')}</option>
              <option value="active">{t('common.active')}</option>
              <option value="inactive">{t('common.inactive')}</option>
            </Select>
          </div>
          <DataTable
            caption={t('employees.title')}
            loading={list.isPending}
            error={
              list.isError ? (
                <ErrorState error={list.error} onRetry={() => void list.refetch()} />
              ) : null
            }
            rows={employees}
            rowKey={(e) => e.membershipId}
            empty={t('employees.empty')}
            onRowClick={(e) => void navigate(`/employees/${e.membershipId}`)}
            columns={[
              {
                key: 'name',
                header: t('employees.fullName'),
                cell: (e) => (
                  <span>
                    <span className="flex items-center gap-2 font-medium">
                      {e.fullName}
                      {e.isOwner ? <Badge tone="primary">{t('employees.owner')}</Badge> : null}
                    </span>
                    <span className="block text-xs text-fg-muted" dir="ltr">
                      {e.email}
                    </span>
                  </span>
                ),
              },
              {
                key: 'job',
                header: t('employees.jobTitle'),
                hideBelow: 'lg',
                cell: (e) => e.jobTitle ?? '—',
              },
              {
                key: 'roles',
                header: t('employees.roles'),
                hideBelow: 'md',
                cell: (e) => (e.isOwner ? t('employees.owner') : label(e.assignments)),
              },
              {
                key: 'login',
                header: t('employees.lastLogin'),
                hideBelow: 'lg',
                cell: (e) =>
                  e.lastLoginAt ? fmt.format(new Date(e.lastLoginAt)) : t('common.never'),
              },
              {
                key: 'status',
                header: t('common.status'),
                cell: (e) => (
                  <Badge tone={e.status === 'active' ? 'success' : 'neutral'}>
                    {t(`common.${e.status}`)}
                  </Badge>
                ),
              },
            ]}
          />
        </TabPanel>
        <TabPanel value="invitations">
          <DataTable
            caption={t('employees.tabInvitations')}
            loading={list.isPending}
            error={
              list.isError ? (
                <ErrorState error={list.error} onRetry={() => void list.refetch()} />
              ) : null
            }
            rows={invitations}
            rowKey={(i) => i.id}
            empty={t('employees.noInvitations')}
            columns={[
              {
                key: 'name',
                header: t('employees.fullName'),
                cell: (i) => (
                  <span>
                    <span className="font-medium">{i.fullName}</span>
                    <span className="block text-xs text-fg-muted" dir="ltr">
                      {i.email}
                    </span>
                  </span>
                ),
              },
              {
                key: 'roles',
                header: t('employees.roles'),
                hideBelow: 'md',
                cell: (i) => label(i.assignments),
              },
              {
                key: 'expires',
                header: t('common.status'),
                cell: (i) =>
                  i.expired ? (
                    <Badge tone="danger">{t('employees.expired')}</Badge>
                  ) : (
                    <Badge tone="warning">
                      {t('employees.expires', { date: fmt.format(new Date(i.expiresAt)) })}
                    </Badge>
                  ),
              },
              {
                key: 'actions',
                header: <span className="sr-only">{t('common.actions')}</span>,
                className: 'text-end',
                cell: (i) =>
                  can('employees.manage') ? (
                    <span className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => invitationAction.mutate({ id: i.id, action: 'resend' })}
                      >
                        {t('employees.resend')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => invitationAction.mutate({ id: i.id, action: 'revoke' })}
                      >
                        {t('employees.revoke')}
                      </Button>
                    </span>
                  ) : null,
              },
            ]}
          />
        </TabPanel>
      </Tabs>
      {inviting && roles.data ? (
        <InviteDialog roles={roles.data.roles} onClose={() => setInviting(false)} />
      ) : null}
    </div>
  );
}

const inviteForm = inviteEmployeeSchema
  .omit({ assignments: true })
  .extend({ interface: z.enum(['manager', 'pos']) });
type InviteValues = z.input<typeof inviteForm>;

function InviteDialog({ roles, onClose }: { roles: Role[]; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { branchId, branches } = useBranchContext();
  const cashier = roles.find((r) => r.templateKey === 'cashier') ?? roles[0];
  const defaultBranch = branchId ?? branches.find((b) => b.isMain)?.id ?? null;
  const [assignments, setAssignments] = useState<Assignment[]>(
    cashier ? [{ roleId: cashier.id, branchId: defaultBranch }] : [],
  );
  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteForm),
    defaultValues: {
      email: '',
      fullName: '',
      jobTitle: '',
      phone: '',
      employeeCode: '',
      interface: 'pos',
    },
  });
  const send = useMutation({
    mutationFn: (v: InviteValues) => api.employees.invite({ ...v, assignments }),
    onSuccess: async (inv) => {
      await queryClient.invalidateQueries({ queryKey: employeesKey });
      notify.ok(t('employees.invited', { email: inv.email }));
      onClose();
    },
    onError: notify.fail,
  });
  const e = form.formState.errors;
  const invalid = t('common:errors.VALIDATION_FAILED');
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('employees.inviteTitle')}
      description={t('employees.inviteBody')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="invite-form"
            loading={send.isPending}
            disabled={assignments.length === 0}
          >
            {t('employees.sendInvite')}
          </Button>
        </>
      }
    >
      <form
        id="invite-form"
        noValidate
        onSubmit={form.handleSubmit((v) => send.mutate(v))}
        className="flex flex-col gap-5"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('employees.fullName')} error={e.fullName && invalid}>
            {(p) => <Input {...p} {...form.register('fullName')} />}
          </Field>
          <Field label={t('common.email')} error={e.email && invalid}>
            {(p) => <Input {...p} {...form.register('email')} type="email" dir="ltr" />}
          </Field>
          <Field label={t('employees.jobTitle')}>
            {(p) => <Input {...p} {...form.register('jobTitle')} />}
          </Field>
          <Field label={t('common.phone')}>
            {(p) => <Input {...p} {...form.register('phone')} type="tel" dir="ltr" />}
          </Field>
          <Field label={t('employees.employeeCode')}>
            {(p) => <Input {...p} {...form.register('employeeCode')} dir="ltr" />}
          </Field>
          <Field label={t('employees.firstApp')}>
            {(p) => (
              <Select {...p} {...form.register('interface')}>
                <option value="pos">{t('common:interfaces.pos')}</option>
                <option value="manager">{t('common:interfaces.manager')}</option>
              </Select>
            )}
          </Field>
        </div>
        <fieldset>
          <legend className="mb-2 font-semibold">{t('employees.assignments')}</legend>
          <AssignmentsEditor value={assignments} onChange={setAssignments} roles={roles} />
        </fieldset>
      </form>
    </Dialog>
  );
}
