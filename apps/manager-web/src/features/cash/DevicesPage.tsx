import type { DeviceRole, PosDevice } from '@arabat/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Select,
} from '@arabat/ui';
import { ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBranchContext, useBranchName, useSession } from '../../app/context.js';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';
import { DeviceExceptions } from './DeviceExceptions.js';

export const devicesKey = ['manager', 'devices'] as const;
const settingsKey = ['manager', 'device-settings'] as const;

/** Owner decision 1 (ADR-0112): hours a device may sell without a successful sync. */
function OfflineLimit() {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: () => api.devices.settings(),
    retry: false,
  });
  // What the manager typed; null shows the saved value.
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (offlineLimitHours: number) => api.devices.updateSettings({ offlineLimitHours }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: settingsKey });
      setDraft(null);
      notify.ok(t('devices.offlineLimitSaved'));
    },
    onError: notify.fail,
  });
  // Shown to people who may read the company settings.
  if (!settings.data) return null;
  const hours = draft ?? String(settings.data.offlineLimitHours);
  const value = Number(hours);
  const valid = /^\d+$/.test(hours) && value >= 1 && value <= 720;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) save.mutate(value);
  };
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t('devices.offlineLimit')}</CardTitle>
        <CardDescription>{t('devices.offlineLimitHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
          <Field
            label={t('devices.offlineLimitHours')}
            error={valid ? undefined : t('devices.offlineLimitInvalid')}
          >
            {(field) => (
              <Input
                {...field}
                inputMode="numeric"
                dir="ltr"
                className="w-32"
                value={hours}
                onChange={(e) => setDraft(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" disabled={!valid} loading={save.isPending}>
            {t('common.save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * The browser POS's PIN sign-in link per branch (Plan A): cashiers open it on any browser and
 * sign in with their name and till PIN. The link is shown once; a new link replaces the old one.
 */
function PinLinks() {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const branchName = useBranchName();
  const [shown, setShown] = useState<{ branchId: string; url: string } | null>(null);
  const key = ['manager', 'pin-links'] as const;
  const links = useQuery({ queryKey: key, queryFn: () => api.devices.pinLinks(), retry: false });
  const create = useMutation({
    mutationFn: (branchId: string) => api.devices.createPinLink(branchId),
    onSuccess: async (made) => {
      setShown({ branchId: made.branchId, url: made.url });
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: notify.fail,
  });
  const remove = useMutation({
    mutationFn: (branchId: string) => api.devices.removePinLink(branchId),
    onSuccess: async () => {
      setShown(null);
      await queryClient.invalidateQueries({ queryKey: key });
      notify.ok(t('devices.pinLinkRemoved'));
    },
    onError: notify.fail,
  });
  if (!links.data || links.data.branches.length === 0) return null;
  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t('devices.pinLinks')}</CardTitle>
        <CardDescription>{t('devices.pinLinksHint')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {links.data.branches.map((b) => (
          <div key={b.branchId} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {branchName(b.branchId)}{' '}
                {b.active ? (
                  <Badge tone="success">{t('devices.pinLinkOn')}</Badge>
                ) : (
                  <Badge>{t('devices.pinLinkOff')}</Badge>
                )}
              </span>
              <span className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={create.isPending && create.variables === b.branchId}
                  onClick={() => create.mutate(b.branchId)}
                >
                  {b.active ? t('devices.pinLinkNew') : t('devices.pinLinkCreate')}
                </Button>
                {b.active ? (
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(b.branchId)}>
                    {t('devices.pinLinkRemove')}
                  </Button>
                ) : null}
              </span>
            </div>
            {shown?.branchId === b.branchId ? (
              <div className="flex flex-col gap-1">
                <Input readOnly dir="ltr" value={shown.url} aria-label={t('devices.pinLinks')} />
                <span className="text-xs text-fg-muted">{t('devices.pinLinkOnce')}</span>
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Local-first tills (ADR-0112): registered devices, their state, and removal. */
export function DevicesPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const branchName = useBranchName();
  const { session } = useSession();
  const [removing, setRemoving] = useState<PosDevice | null>(null);
  const [changing, setChanging] = useState<PosDevice | null>(null);
  const devices = useQuery({
    queryKey: devicesKey,
    queryFn: () => api.devices.list(),
    refetchInterval: 30_000,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.devices.revoke(id),
    onSuccess: async () => {
      setRemoving(null);
      await queryClient.invalidateQueries({ queryKey: devicesKey });
      notify.ok(t('devices.revokedDone'));
    },
    onError: notify.fail,
  });
  const when = (v: string | null) => (v ? formatDateTime(v, i18n.language) : '—');
  return (
    <div>
      <PageHeader title={t('devices.title')} description={t('devices.subtitle')} />
      <OfflineLimit />
      <PinLinks />
      <DataTable
        caption={t('devices.title')}
        loading={devices.isPending}
        error={
          devices.isError ? (
            <ErrorState error={devices.error} onRetry={() => void devices.refetch()} />
          ) : null
        }
        empty={t('devices.empty')}
        rows={devices.data?.devices}
        rowKey={(d) => d.id}
        columns={[
          { key: 'name', header: t('common.name'), cell: (d) => <bdi>{d.name}</bdi> },
          {
            key: 'branch',
            header: t('inventory.branch'),
            cell: (d) => branchName(d.branchId) ?? '—',
          },
          {
            key: 'register',
            header: t('devices.register'),
            cell: (d) => <span dir="ltr">{d.registerCode}</span>,
          },
          {
            key: 'role',
            header: t('devices.role'),
            cell: (d) =>
              d.role === 'primary' ? (
                <Badge tone="primary">{t('devices.primary')}</Badge>
              ) : (
                <Badge>{t('devices.secondary')}</Badge>
              ),
          },
          {
            key: 'state',
            header: t('common.status'),
            cell: (d) =>
              d.revokedAt ? (
                <Badge tone="danger">{t('devices.revoked')}</Badge>
              ) : d.online ? (
                <Badge tone="success">{t('devices.online')}</Badge>
              ) : (
                <Badge>{t('devices.offline')}</Badge>
              ),
          },
          {
            key: 'seen',
            header: t('devices.lastSeen'),
            hideBelow: 'md',
            cell: (d) => when(d.lastSeenAt),
          },
          {
            key: 'sync',
            header: t('devices.lastSync'),
            hideBelow: 'lg',
            cell: (d) => when(d.lastSyncAt),
          },
          {
            key: 'actions',
            header: <span className="sr-only">{t('common.actions')}</span>,
            cell: (d) =>
              d.revokedAt ? null : (
                <span className="flex flex-wrap justify-end gap-1">
                  {session.isOwner ? (
                    <Button size="sm" variant="ghost" onClick={() => setChanging(d)}>
                      {t('devices.change')}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(d)}>
                    {t('devices.revoke')}
                  </Button>
                </span>
              ),
          },
        ]}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('devices.revokeTitle', { name: removing?.name ?? '' })}
        description={t('devices.revokeHint')}
        confirmLabel={t('devices.revoke')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        loading={revoke.isPending}
        onConfirm={() => removing && revoke.mutate(removing.id)}
      />
      {changing ? (
        <ChangeDeviceDialog key={changing.id} device={changing} onClose={() => setChanging(null)} />
      ) : null}
      <DeviceExceptions />
    </div>
  );
}

/** Owner: the device's role and branch (Plan A). The device learns it at its next sync. */
function ChangeDeviceDialog({ device, onClose }: { device: PosDevice; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { branches } = useBranchContext();
  const [role, setRole] = useState<DeviceRole>(device.role);
  const [branchId, setBranchId] = useState(device.branchId);
  const save = useMutation({
    mutationFn: () =>
      api.devices.update(device.id, {
        ...(role !== device.role ? { role } : {}),
        ...(branchId !== device.branchId ? { branchId } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: devicesKey });
      notify.ok(t('devices.changed'));
      onClose();
    },
    onError: notify.fail,
  });
  const unchanged = role === device.role && branchId === device.branchId;
  return (
    <Dialog
      open
      onOpenChange={(open) => (!open ? onClose() : undefined)}
      title={t('devices.changeTitle', { name: device.name })}
      description={t('devices.changeHint')}
      footer={
        <Button disabled={unchanged} loading={save.isPending} onClick={() => save.mutate()}>
          {t('common.save')}
        </Button>
      }
    >
      <div className="grid gap-3">
        <Field label={t('devices.role')} hint={t('devices.roleHint')}>
          {(field) => (
            <Select {...field} value={role} onChange={(e) => setRole(e.target.value as DeviceRole)}>
              <option value="primary">{t('devices.primary')}</option>
              <option value="secondary">{t('devices.secondary')}</option>
            </Select>
          )}
        </Field>
        <Field
          label={t('inventory.branch')}
          hint={branchId !== device.branchId ? t('devices.moveHint') : undefined}
        >
          {(field) => (
            <Select {...field} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {branches
                .filter((b) => b.status === 'active' || b.id === device.branchId)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {localizedName(b, i18n.language)}
                  </option>
                ))}
            </Select>
          )}
        </Field>
      </div>
    </Dialog>
  );
}
