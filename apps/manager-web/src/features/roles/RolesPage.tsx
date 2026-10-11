import type { PermissionInfo, Role } from '@arabat/contracts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
} from '@arabat/ui';
import { localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermissionLabel, useSession } from '../../app/context.js';
import { rolesKey } from '../employees/EmployeesPage.js';

export function RolesPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const roles = useQuery({ queryKey: rolesKey, queryFn: () => api.roles.list() });
  const catalog = useQuery({
    queryKey: ['manager', 'permissions'],
    queryFn: () => api.roles.catalog(),
    staleTime: Infinity,
  });
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.roles.remove(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: rolesKey });
      setDeleting(null);
      notify.ok(t('roles.deleted'));
    },
    onError: notify.fail,
  });

  return (
    <div>
      <PageHeader
        title={t('roles.title')}
        description={t('roles.subtitle')}
        actions={
          can('roles.manage') ? (
            <Button onClick={() => setEditing('new')}>{t('roles.add')}</Button>
          ) : null
        }
      />
      <DataTable
        caption={t('roles.title')}
        loading={roles.isPending}
        rows={roles.data?.roles}
        rowKey={(r) => r.id}
        columns={[
          {
            key: 'name',
            header: t('common.name'),
            cell: (r) => (
              <span className="flex items-center gap-2 font-medium">
                {localizedName(r, i18n.language)}
                <Badge>{r.templateKey ? t('roles.template') : t('roles.custom')}</Badge>
              </span>
            ),
          },
          {
            key: 'perms',
            header: t('roles.permissions'),
            cell: (r) => t('roles.count', { count: r.permissions.length }),
          },
          {
            key: 'assigned',
            header: t('roles.assigned'),
            hideBelow: 'sm',
            cell: (r) => r.assignmentCount,
          },
          {
            key: 'actions',
            header: <span className="sr-only">{t('common.actions')}</span>,
            className: 'text-end',
            cell: (r) => (
              <span className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
                  {r.editable ? t('common.edit') : t('common.readOnly')}
                </Button>
                {r.editable && r.assignmentCount === 0 ? (
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(r)}>
                    {t('common.delete')}
                  </Button>
                ) : null}
              </span>
            ),
          },
        ]}
      />
      {editing && catalog.data && roles.data ? (
        <RoleDialog
          role={editing === 'new' ? null : editing}
          catalog={catalog.data.permissions}
          grantable={roles.data.grantable}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('roles.deleteTitle')}
        description={t('roles.deleteBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}

/** Permission matrix grouped by module; permissions the editor does not hold are locked. */
function RoleDialog({
  role,
  catalog,
  grantable,
  onClose,
}: {
  role: Role | null;
  catalog: PermissionInfo[];
  grantable: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const label = usePermissionLabel();
  const editable = role ? role.editable : true;
  const [nameAr, setNameAr] = useState(role?.nameAr ?? '');
  const [nameEn, setNameEn] = useState(role?.nameEn ?? '');
  const [selected, setSelected] = useState<Set<string>>(
    new Set(role?.permissions ?? ['manager.access']),
  );
  const held = new Set(grantable);
  const groups = [...new Set(catalog.map((p) => p.group))];
  const save = useMutation({
    mutationFn: () => {
      const body = { nameAr, nameEn, permissions: [...selected] };
      return role
        ? api.roles.update(role.id, { ...body, version: role.version })
        : api.roles.create(body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: rolesKey });
      notify.ok(t('roles.saved'));
      onClose();
    },
    onError: notify.fail,
  });
  const toggle = (key: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={role ? t('roles.editTitle') : t('roles.createTitle')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {editable ? (
            <Button
              loading={save.isPending}
              disabled={!nameAr.trim() && !nameEn.trim()}
              onClick={() => save.mutate()}
            >
              {t('common.save')}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {!editable ? <Alert tone="info" title={t('roles.notEditable')} /> : null}
        <fieldset disabled={!editable} className="grid gap-4 md:grid-cols-2">
          <Field label={t('common.nameAr')}>
            {(p) => (
              <Input {...p} value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" />
            )}
          </Field>
          <Field label={t('common.nameEn')}>
            {(p) => (
              <Input {...p} value={nameEn} onChange={(e) => setNameEn(e.target.value)} dir="ltr" />
            )}
          </Field>
        </fieldset>
        {groups.map((group) => (
          <fieldset key={group} className="rounded-md border border-border p-4">
            <legend className="px-1 text-sm font-semibold">{t(`permGroup.${group}`)}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {catalog
                .filter((p) => p.group === group)
                .map((p) => (
                  <Checkbox
                    key={p.key}
                    label={label(p.key)}
                    description={`${p.scope === 'merchant' ? t('roles.merchantScope') : t('roles.branchScope')}${held.has(p.key) ? '' : ` · ${t('roles.notGrantable')}`}`}
                    checked={selected.has(p.key)}
                    disabled={!editable || (!held.has(p.key) && !selected.has(p.key))}
                    onChange={(e) => toggle(p.key, e.target.checked)}
                    data-permission={p.key}
                  />
                ))}
            </div>
          </fieldset>
        ))}
      </div>
    </Dialog>
  );
}
