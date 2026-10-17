import type { PosDevice } from '@arabat/contracts';
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
  Field,
  Input,
  PageHeader,
} from '@arabat/ui';
import { ErrorState, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBranchName } from '../../app/context.js';
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

/** Local-first tills (ADR-0112): registered devices, their state, and removal. */
export function DevicesPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const branchName = useBranchName();
  const [removing, setRemoving] = useState<PosDevice | null>(null);
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
                <Button size="sm" variant="ghost" onClick={() => setRemoving(d)}>
                  {t('devices.revoke')}
                </Button>
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
      <DeviceExceptions />
    </div>
  );
}
