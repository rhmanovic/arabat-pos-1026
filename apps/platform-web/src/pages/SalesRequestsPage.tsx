import type { SalesRequestStatus } from '@arabat/contracts';
import { SALES_REQUEST_STATUSES } from '@arabat/contracts';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  Field,
  PageHeader,
  Segmented,
  Select,
  Textarea,
} from '@arabat/ui';
import { ErrorState, useApi, useErrorMessage, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { platformKey, useFormat } from '../shared.js';

const TONE = { new: 'primary', contacted: 'warning', won: 'success', lost: 'neutral' } as const;

/** Purchase requests sent from the public pricing page (ADR-0114). */
export function SalesRequestsPage() {
  const { t } = useTranslation();
  const api = useApi();
  const f = useFormat();
  const [status, setStatus] = useState<SalesRequestStatus | 'all'>('new');
  const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({
    queryKey: [...platformKey, 'sales-requests', status],
    queryFn: () => api.platform.salesRequests(status === 'all' ? undefined : status),
  });
  const counts = list.data?.counts;
  return (
    <div>
      <PageHeader title={t('requests.title')} description={t('requests.subtitle')} />
      <div className="mb-3 overflow-x-auto">
        <Segmented
          label={t('requests.filter')}
          value={status}
          onChange={setStatus}
          options={[
            ...SALES_REQUEST_STATUSES.map((s) => ({
              value: s,
              label: `${t(`requests.status.${s}`)}${counts ? ` (${counts[s]})` : ''}`,
            })),
            { value: 'all' as const, label: t('requests.all') },
          ]}
        />
      </div>
      <DataTable
        caption={t('requests.title')}
        loading={list.isPending}
        error={
          list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : null
        }
        empty={t('requests.empty')}
        rows={list.data?.requests}
        rowKey={(r) => r.id}
        onRowClick={(r) => setOpen(r.id)}
        columns={[
          {
            key: 'ref',
            header: t('requests.reference'),
            cell: (r) => (
              <span dir="ltr" className="font-medium tabular-nums">
                {r.reference}
              </span>
            ),
          },
          { key: 'company', header: t('requests.company'), cell: (r) => r.companyName },
          {
            key: 'contact',
            header: t('requests.contact'),
            hideBelow: 'md',
            cell: (r) => (
              <span className="flex flex-col">
                <span>{r.contactName}</span>
                <span dir="ltr" className="text-xs text-fg-muted">
                  {r.phone}
                </span>
              </span>
            ),
          },
          {
            key: 'total',
            header: t('requests.firstPayment'),
            cell: (r) => (
              <span dir="ltr" className="tabular-nums">
                {r.total.amount} {r.total.currency}
              </span>
            ),
          },
          {
            key: 'status',
            header: t('requests.statusLabel'),
            cell: (r) => <Badge tone={TONE[r.status]}>{t(`requests.status.${r.status}`)}</Badge>,
          },
          {
            key: 'when',
            header: t('requests.when'),
            hideBelow: 'md',
            cell: (r) => f.date(r.createdAt),
          },
        ]}
      />
      {open ? <RequestDialog id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function RequestDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const f = useFormat();
  const notify = useNotify();
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const ar = i18n.language.startsWith('ar');
  const request = useQuery({
    queryKey: [...platformKey, 'sales-request', id],
    queryFn: () => api.platform.salesRequest(id),
  });
  const [edit, setEdit] = useState<{ status: SalesRequestStatus; note: string } | null>(null);
  const r = request.data;
  const form = edit ?? (r ? { status: r.status, note: r.operatorNote ?? '' } : null);
  const save = useMutation({
    mutationFn: () =>
      api.platform.updateSalesRequest(id, {
        status: form!.status,
        operatorNote: form!.note,
        version: r!.version,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: platformKey });
      notify.ok(t('requests.saved'));
      onClose();
    },
  });
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={r ? `${t('requests.request')} ${r.reference}` : t('requests.request')}
      footer={
        r ? (
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('requests.save')}
          </Button>
        ) : null
      }
    >
      {request.isError ? <ErrorState error={request.error} /> : null}
      {r && form ? (
        <div className="flex flex-col gap-4">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-fg-muted">{t('requests.company')}</dt>
              <dd className="font-medium">{r.companyName}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">{t('requests.contact')}</dt>
              <dd>{r.contactName}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">{t('requests.phone')}</dt>
              <dd dir="ltr" className="text-start">
                <a
                  className="text-primary underline"
                  href={`tel:${r.phone.replace(/[^+0-9]/g, '')}`}
                >
                  {r.phone}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">{t('requests.email')}</dt>
              <dd dir="ltr" className="text-start">
                <a className="text-primary underline" href={`mailto:${r.email}`}>
                  {r.email}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">{t('requests.when')}</dt>
              <dd>{f.date(r.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">{t('requests.language')}</dt>
              <dd>{r.language === 'ar' ? 'العربية' : 'English'}</dd>
            </div>
            {r.notes ? (
              <div className="sm:col-span-2">
                <dt className="text-fg-muted">{t('requests.notes')}</dt>
                <dd className="whitespace-pre-wrap">{r.notes}</dd>
              </div>
            ) : null}
          </dl>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-fg-muted">
                <th className="py-1 text-start font-normal">{t('requests.item')}</th>
                <th className="py-1 text-end font-normal">{t('requests.quantity')}</th>
                <th className="py-1 text-end font-normal">{t('requests.unitPrice')}</th>
                <th className="py-1 text-end font-normal">{t('requests.lineTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l, index) => (
                <tr key={index} className="border-b border-border">
                  <td className="py-1.5">
                    {ar ? l.nameAr : l.nameEn}
                    {l.kind === 'system' ? (
                      <span className="text-xs text-fg-muted"> · {t('requests.perYear')}</span>
                    ) : null}
                  </td>
                  <td className="py-1.5 text-end tabular-nums">{l.quantity}</td>
                  <td className="py-1.5 text-end tabular-nums" dir="ltr">
                    {l.unitPrice.amount}
                  </td>
                  <td className="py-1.5 text-end tabular-nums" dir="ltr">
                    {l.lineTotal.amount}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="pt-2 text-end text-fg-muted">
                  {t('requests.systemYear')}
                </td>
                <td className="pt-2 text-end tabular-nums" dir="ltr">
                  {r.system.amount}
                </td>
              </tr>
              <tr>
                <td colSpan={3} className="text-end text-fg-muted">
                  {t('requests.devicesOnce')}
                </td>
                <td className="text-end tabular-nums" dir="ltr">
                  {r.devices.amount}
                </td>
              </tr>
              <tr>
                <td colSpan={3} className="text-end font-semibold">
                  {t('requests.firstPayment')}
                </td>
                <td className="text-end font-semibold tabular-nums" dir="ltr">
                  {r.total.amount} {r.total.currency}
                </td>
              </tr>
            </tfoot>
          </table>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('requests.statusLabel')}>
              {(p) => (
                <Select
                  {...p}
                  value={form.status}
                  onChange={(e) =>
                    setEdit({ ...form, status: e.target.value as SalesRequestStatus })
                  }
                >
                  {SALES_REQUEST_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`requests.status.${s}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t('requests.operatorNote')} className="sm:col-span-2">
              {(p) => (
                <Textarea
                  {...p}
                  rows={3}
                  value={form.note}
                  onChange={(e) => setEdit({ ...form, note: e.target.value })}
                />
              )}
            </Field>
          </div>
          {save.isError ? <Alert tone="danger">{message(save.error)}</Alert> : null}
        </div>
      ) : null}
    </Dialog>
  );
}
