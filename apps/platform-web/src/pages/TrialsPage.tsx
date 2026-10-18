import type {
  DeviceTrialRequest,
  DeviceTrialStatus,
  Lead,
  LeadStage,
  TrialDeviceStock,
} from '@arabat/contracts';
import { DEVICE_TRIAL_STATUSES, LEAD_STAGES } from '@arabat/contracts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Segmented,
  StatCard,
  Tabs,
  Textarea,
} from '@arabat/ui';
import { ErrorState, useApi, useErrorMessage, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { platformKey, useFormat, useRole } from '../shared.js';

const STAGE_TONE = { receipt: 'warning', started: 'neutral', trial: 'success' } as const;
const DEVICE_TONE = {
  pending: 'primary',
  waitlist: 'warning',
  approved: 'primary',
  delivered: 'success',
  returned: 'neutral',
  rejected: 'danger',
} as const;
/** The moves the API allows from each device-trial status. */
const NEXT: Record<DeviceTrialStatus, DeviceTrialStatus[]> = {
  pending: ['approved', 'waitlist', 'rejected'],
  waitlist: ['approved', 'pending', 'rejected'],
  approved: ['delivered', 'rejected'],
  delivered: ['returned'],
  returned: [],
  rejected: [],
};
const key = [...platformKey, 'trials'] as const;

/** Leads, device trials, trial stock, funnel numbers and trial settings (ADR-0115). */
export function TrialsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('leads');
  return (
    <div>
      <PageHeader title={t('trials.title')} description={t('trials.subtitle')} />
      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'leads', label: t('trials.tabs.leads') },
          { value: 'devices', label: t('trials.tabs.devices') },
          { value: 'stock', label: t('trials.tabs.stock') },
          { value: 'funnel', label: t('trials.tabs.funnel') },
          { value: 'settings', label: t('trials.tabs.settings') },
        ]}
      >
        {tab === 'leads' ? <LeadsTab /> : null}
        {tab === 'devices' ? <DevicesTab /> : null}
        {tab === 'stock' ? <StockTab /> : null}
        {tab === 'funnel' ? <FunnelTab /> : null}
        {tab === 'settings' ? <SettingsTab /> : null}
      </Tabs>
    </div>
  );
}

function LeadsTab() {
  const { t } = useTranslation();
  const api = useApi();
  const f = useFormat();
  const [stage, setStage] = useState<LeadStage | 'all'>('all');
  const list = useQuery({
    queryKey: [...key, 'leads', stage],
    queryFn: () => api.platform.leads(stage === 'all' ? undefined : stage),
  });
  const counts = list.data?.counts;
  return (
    <div>
      <div className="mb-3 overflow-x-auto">
        <Segmented
          label={t('trials.stage')}
          value={stage}
          onChange={setStage}
          options={[
            { value: 'all' as const, label: t('trials.all') },
            ...LEAD_STAGES.map((s) => ({
              value: s,
              label: `${t(`trials.stages.${s}`)}${counts ? ` (${counts[s]})` : ''}`,
            })),
          ]}
        />
      </div>
      <DataTable
        caption={t('trials.tabs.leads')}
        loading={list.isPending}
        error={
          list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : null
        }
        empty={t('trials.noLeads')}
        rows={list.data?.leads}
        rowKey={(l) => l.id}
        columns={[
          {
            key: 'who',
            header: t('trials.lead'),
            cell: (l: Lead) => (
              <span className="flex flex-col">
                <span className="font-medium">{l.companyName ?? l.fullName ?? '—'}</span>
                <a
                  dir="ltr"
                  className="text-start text-xs text-primary underline"
                  href={`mailto:${l.email}`}
                >
                  {l.email}
                </a>
                {l.phone ? (
                  <a
                    dir="ltr"
                    className="text-start text-xs text-primary underline"
                    href={`tel:${l.phone.replace(/[^+0-9]/g, '')}`}
                  >
                    {l.phone}
                  </a>
                ) : null}
              </span>
            ),
          },
          {
            key: 'stage',
            header: t('trials.stage'),
            cell: (l) => <Badge tone={STAGE_TONE[l.stage]}>{t(`trials.stages.${l.stage}`)}</Badge>,
          },
          {
            key: 'business',
            header: t('trials.business'),
            hideBelow: 'md',
            cell: (l) => (l.businessType ? t(`trials.businesses.${l.businessType}`) : '—'),
          },
          {
            key: 'devices',
            header: t('trials.devices'),
            hideBelow: 'md',
            cell: (l) =>
              l.devices ? (
                <Badge tone={DEVICE_TONE[l.devices]}>{t(`trials.deviceStatus.${l.devices}`)}</Badge>
              ) : l.merchantId ? (
                t('trials.ownDevices')
              ) : (
                '—'
              ),
          },
          {
            key: 'activity',
            header: t('trials.activity'),
            hideBelow: 'md',
            cell: (l) =>
              l.merchantId ? (
                <span className="flex flex-col text-xs">
                  <span>{t('trials.salesCount', { n: l.salesCount })}</span>
                  <span className="text-fg-muted">
                    {t('trials.lastSeen')}: {f.date(l.lastSeenAt)}
                  </span>
                  <span className="text-fg-muted">
                    {t('trials.trialEnds')}: {f.date(l.trialEndsAt)}
                  </span>
                </span>
              ) : (
                '—'
              ),
          },
          {
            key: 'when',
            header: t('trials.updated'),
            hideBelow: 'md',
            cell: (l) => f.date(l.updatedAt),
          },
          {
            key: 'open',
            header: '',
            cell: (l) =>
              l.merchantId ? (
                <Link className="text-sm text-primary underline" to={`/merchants/${l.merchantId}`}>
                  {t('trials.openMerchant')}
                </Link>
              ) : null,
          },
        ]}
      />
    </div>
  );
}

function DevicesTab() {
  const { t } = useTranslation();
  const api = useApi();
  const f = useFormat();
  const [status, setStatus] = useState<DeviceTrialStatus | 'all'>('pending');
  const [open, setOpen] = useState<DeviceTrialRequest | null>(null);
  const list = useQuery({
    queryKey: [...key, 'devices', status],
    queryFn: () => api.platform.deviceTrials(status === 'all' ? undefined : status),
  });
  const counts = list.data?.counts;
  return (
    <div>
      <div className="mb-3 overflow-x-auto">
        <Segmented
          label={t('trials.status')}
          value={status}
          onChange={setStatus}
          options={[
            ...DEVICE_TRIAL_STATUSES.map((s) => ({
              value: s,
              label: `${t(`trials.deviceStatus.${s}`)}${counts ? ` (${counts[s]})` : ''}`,
            })),
            { value: 'all' as const, label: t('trials.all') },
          ]}
        />
      </div>
      <DataTable
        caption={t('trials.tabs.devices')}
        loading={list.isPending}
        error={
          list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : null
        }
        empty={t('trials.noRequests')}
        rows={list.data?.requests}
        rowKey={(r) => r.id}
        onRowClick={(r) => setOpen(r)}
        columns={[
          {
            key: 'who',
            header: t('trials.lead'),
            cell: (r: DeviceTrialRequest) => (
              <span className="flex flex-col">
                <span className="font-medium">{r.companyName ?? r.contactName ?? '—'}</span>
                <span dir="ltr" className="text-start text-xs text-fg-muted">
                  {r.email}
                </span>
              </span>
            ),
          },
          {
            key: 'lines',
            header: t('trials.devices'),
            cell: (r) => r.lines.map((l) => `${f.planName(l)} × ${l.quantity}`).join('، '),
          },
          {
            key: 'status',
            header: t('trials.status'),
            cell: (r) => (
              <Badge tone={DEVICE_TONE[r.status]}>{t(`trials.deviceStatus.${r.status}`)}</Badge>
            ),
          },
          {
            key: 'when',
            header: t('trials.requested'),
            hideBelow: 'md',
            cell: (r) => f.date(r.createdAt),
          },
          {
            key: 'ends',
            header: t('trials.trialEnds'),
            hideBelow: 'md',
            cell: (r) => (r.deliveredAt ? f.date(r.trialEndsAt) : '—'),
          },
        ]}
      />
      {open ? <DeviceDialog request={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function DeviceDialog({ request, onClose }: { request: DeviceTrialRequest; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const f = useFormat();
  const notify = useNotify();
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const [note, setNote] = useState(request.note ?? '');
  const move = useMutation({
    mutationFn: (status: DeviceTrialStatus) =>
      api.platform.updateDeviceTrial(request.id, { status, note, version: request.version }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      notify.ok(t('trials.saved'));
      onClose();
    },
  });
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={request.companyName ?? request.contactName ?? request.email}
      footer={
        <div className="flex flex-wrap gap-2">
          {NEXT[request.status].map((s) => (
            <Button
              key={s}
              variant={
                s === 'rejected'
                  ? 'danger'
                  : s === 'waitlist' || s === 'pending'
                    ? 'secondary'
                    : 'primary'
              }
              loading={move.isPending && move.variables === s}
              onClick={() => move.mutate(s)}
            >
              {t(`trials.actions.${s}`)}
            </Button>
          ))}
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p>
          <Badge tone={DEVICE_TONE[request.status]}>
            {t(`trials.deviceStatus.${request.status}`)}
          </Badge>{' '}
          <a dir="ltr" className="text-primary underline" href={`mailto:${request.email}`}>
            {request.email}
          </a>
        </p>
        <ul className="list-inside list-disc">
          {request.lines.map((l, i) => (
            <li key={i}>
              {f.planName(l)} × {l.quantity}
            </li>
          ))}
        </ul>
        {request.status === 'approved' ? (
          <Alert tone="info">{t('trials.deliveredHint')}</Alert>
        ) : null}
        {request.deliveredAt ? (
          <p className="text-fg-muted">
            {t('trials.deliveredAt')}: {f.date(request.deliveredAt)} · {t('trials.trialEnds')}:{' '}
            {f.date(request.trialEndsAt)}
          </p>
        ) : null}
        <Field label={t('trials.note')}>
          {(p) => (
            <Textarea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </Field>
        {move.isError ? <Alert tone="danger">{message(move.error)}</Alert> : null}
      </div>
    </Dialog>
  );
}

function StockTab() {
  const { t } = useTranslation();
  const api = useApi();
  const f = useFormat();
  const { can } = useRole();
  const editable = can('platform.super_admin', 'platform.billing');
  const stock = useQuery({ queryKey: [...key, 'stock'], queryFn: () => api.platform.trialStock() });
  return (
    <div>
      <p className="mb-3 text-sm text-fg-muted">{t('trials.stockHint')}</p>
      <DataTable
        caption={t('trials.tabs.stock')}
        loading={stock.isPending}
        error={
          stock.isError ? (
            <ErrorState error={stock.error} onRetry={() => void stock.refetch()} />
          ) : null
        }
        empty={t('trials.noDevices')}
        rows={stock.data?.devices}
        rowKey={(d) => d.itemId}
        columns={[
          {
            key: 'name',
            header: t('trials.device'),
            cell: (d: TrialDeviceStock) => (
              <span className="flex items-center gap-1">
                {f.planName(d)}
                {d.status === 'hidden' ? <Badge>{t('trials.hiddenDevice')}</Badge> : null}
              </span>
            ),
          },
          {
            key: 'stock',
            header: t('trials.trialStock'),
            cell: (d) => (editable ? <StockInput device={d} /> : d.trialStock),
          },
          { key: 'out', header: t('trials.out'), cell: (d) => d.out },
          {
            key: 'available',
            header: t('trials.available'),
            cell: (d) => (
              <Badge tone={d.available > 0 ? 'success' : 'warning'}>{d.available}</Badge>
            ),
          },
          { key: 'waiting', header: t('trials.waiting'), cell: (d) => d.waiting },
        ]}
      />
    </div>
  );
}

function StockInput({ device }: { device: TrialDeviceStock }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(String(device.trialStock));
  const save = useMutation({
    mutationFn: () =>
      api.platform.saveTrialStock(device.itemId, {
        trialStock: Number(value),
        version: device.version,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: platformKey });
      notify.ok(t('trials.saved'));
    },
    onError: (error) => notify.fail(error),
  });
  return (
    <span className="flex items-center gap-2">
      <Input
        aria-label={t('trials.trialStock')}
        type="number"
        min={0}
        dir="ltr"
        className="w-20"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {value !== String(device.trialStock) ? (
        <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
          {t('trials.save')}
        </Button>
      ) : null}
    </span>
  );
}

function FunnelTab() {
  const { t } = useTranslation();
  const api = useApi();
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const funnel = useQuery({
    queryKey: [...key, 'funnel', days],
    queryFn: () => api.platform.funnel(Number(days)),
  });
  const first = funnel.data?.steps[0]?.sessions ?? 0;
  return (
    <div>
      <div className="mb-3">
        <Segmented
          label={t('trials.period')}
          value={days}
          onChange={setDays}
          options={(['7', '30', '90'] as const).map((d) => ({
            value: d,
            label: t('trials.days', { n: d }),
          }))}
        />
      </div>
      {funnel.isError ? (
        <ErrorState error={funnel.error} onRetry={() => void funnel.refetch()} />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {funnel.data?.steps.map((s) => (
          <StatCard
            key={s.step}
            label={t(`trials.steps.${s.step}`)}
            value={s.sessions}
            hint={first ? `${Math.round((s.sessions * 100) / first)}%` : undefined}
          />
        ))}
      </div>
      <p className="mt-3 text-xs text-fg-muted">{t('trials.funnelHint')}</p>
    </div>
  );
}

function SettingsTab() {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const editable = can('platform.super_admin', 'platform.billing');
  const settings = useQuery({
    queryKey: [...key, 'settings'],
    queryFn: () => api.platform.trialSettings(),
  });
  const [edit, setEdit] = useState<{ own: string; devices: string; waitlist: boolean } | null>(
    null,
  );
  const s = settings.data;
  const v =
    edit ??
    (s
      ? {
          own: String(s.trialDaysOwn),
          devices: String(s.trialDaysDevices),
          waitlist: s.waitlistEnabled,
        }
      : null);
  const save = useMutation({
    mutationFn: () =>
      api.platform.saveTrialSettings({
        trialDaysOwn: Number(v!.own),
        trialDaysDevices: Number(v!.devices),
        waitlistEnabled: v!.waitlist,
        version: s!.version,
      }),
    onSuccess: async () => {
      setEdit(null);
      await queryClient.invalidateQueries({ queryKey: key });
      notify.ok(t('trials.saved'));
    },
  });
  if (settings.isError)
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  if (!v) return null;
  return (
    <div className="flex max-w-lg flex-col gap-4">
      <Field label={t('trials.daysOwn')} hint={t('trials.daysOwnHint')}>
        {(p) => (
          <Input
            {...p}
            type="number"
            min={1}
            max={365}
            dir="ltr"
            disabled={!editable}
            value={v.own}
            onChange={(e) => setEdit({ ...v, own: e.target.value })}
          />
        )}
      </Field>
      <Field label={t('trials.daysDevices')} hint={t('trials.daysDevicesHint')}>
        {(p) => (
          <Input
            {...p}
            type="number"
            min={1}
            max={365}
            dir="ltr"
            disabled={!editable}
            value={v.devices}
            onChange={(e) => setEdit({ ...v, devices: e.target.value })}
          />
        )}
      </Field>
      <Checkbox
        label={t('trials.waitlist')}
        checked={v.waitlist}
        disabled={!editable}
        onChange={(e) => setEdit({ ...v, waitlist: e.target.checked })}
      />
      <p className="-mt-2 text-xs text-fg-muted">{t('trials.waitlistHint')}</p>
      {save.isError ? <Alert tone="danger">{message(save.error)}</Alert> : null}
      {editable ? (
        <div>
          <Button loading={save.isPending} disabled={!edit} onClick={() => save.mutate()}>
            {t('trials.save')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
