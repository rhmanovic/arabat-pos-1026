import type { DeviceException } from '@arabat/contracts';
import { Badge, Button, DataTable, Dialog, Field, Segmented, Textarea } from '@arabat/ui';
import { ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';

const exceptionsKey = ['manager', 'device-exceptions'] as const;

/**
 * Device uploads to look at (ADR-0112): sales that took stock below zero, records with a wrong
 * device clock, and records the server refused (kept with what the device sent).
 */
export function DeviceExceptions() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const [handling, setHandling] = useState<DeviceException | null>(null);
  const [note, setNote] = useState('');
  const list = useQuery({
    queryKey: [...exceptionsKey, status],
    queryFn: () => api.devices.exceptions(status),
  });
  const resolve = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      api.devices.resolveException(id, text),
    onSuccess: async () => {
      setHandling(null);
      setNote('');
      await queryClient.invalidateQueries({ queryKey: exceptionsKey });
      notify.ok(t('devices.exceptionResolved'));
    },
    onError: notify.fail,
  });
  const describe = (e: DeviceException) => {
    const d = e.details as Record<string, string | boolean | null | undefined>;
    if (e.kind === 'negative_stock')
      return t('devices.negativeStockText', {
        product:
          localizedName(
            {
              nameEn: (d['productNameEn'] as string) ?? null,
              nameAr: (d['productNameAr'] as string) ?? null,
            },
            i18n.language,
          ) || '—',
        balance: d['balance'] ?? '',
        receipt: d['receiptNumber'] ?? '',
      });
    if (e.kind === 'clock_skew')
      return d['outsideShift']
        ? t('devices.clockOutsideShift', { at: formatDateTime(e.occurredAt, i18n.language) })
        : t('devices.clockAhead', {
            at: formatDateTime(e.occurredAt, i18n.language),
            received: formatDateTime(e.receivedAt, i18n.language),
          });
    return t('devices.refusedText', {
      record: t(`devices.record.${e.recordKind}`, { defaultValue: e.recordKind }),
      message: d['message'] ?? '',
      code: d['code'] ?? '',
    });
  };
  return (
    <section className="mt-8" aria-labelledby="device-exceptions">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="device-exceptions" className="text-lg font-semibold">
          {t('devices.exceptions')}
        </h2>
        <Segmented
          label={t('devices.exceptions')}
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: t('devices.exceptionsOpen') },
            { value: 'resolved', label: t('devices.exceptionsResolved') },
          ]}
        />
      </div>
      <DataTable
        caption={t('devices.exceptions')}
        loading={list.isPending}
        error={
          list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : null
        }
        empty={t('devices.exceptionsEmpty')}
        rows={list.data?.exceptions}
        rowKey={(e) => e.id}
        columns={[
          {
            key: 'kind',
            header: t('devices.kindHeader'),
            cell: (e) => (
              <Badge tone={e.kind === 'refused' ? 'danger' : 'warning'}>
                {t(`devices.kind.${e.kind}`)}
              </Badge>
            ),
          },
          { key: 'what', header: t('devices.whatHappened'), cell: (e) => describe(e) },
          {
            key: 'device',
            header: t('devices.device'),
            hideBelow: 'md',
            cell: (e) => (
              <span>
                <bdi>{e.deviceName}</bdi> · <span dir="ltr">{e.registerCode}</span>
              </span>
            ),
          },
          {
            key: 'when',
            header: t('devices.when'),
            hideBelow: 'md',
            cell: (e) => formatDateTime(e.occurredAt, i18n.language),
          },
          {
            key: 'actions',
            header: <span className="sr-only">{t('common.actions')}</span>,
            cell: (e) =>
              e.resolvedAt ? (
                <span className="text-sm text-fg-muted">
                  {e.resolvedByName ?? '—'}: {e.resolutionNote}
                </span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setHandling(e)}>
                  {t('devices.markHandled')}
                </Button>
              ),
          },
        ]}
      />
      <Dialog
        open={handling !== null}
        onOpenChange={(open) => !open && setHandling(null)}
        title={t('devices.markHandled')}
        description={handling ? describe(handling) : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setHandling(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={note.trim() === ''}
              loading={resolve.isPending}
              onClick={() => handling && resolve.mutate({ id: handling.id, text: note.trim() })}
            >
              {t('devices.markHandled')}
            </Button>
          </>
        }
      >
        <Field label={t('devices.resolutionNote')}>
          {(field) => (
            <Textarea {...field} value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
          )}
        </Field>
      </Dialog>
    </section>
  );
}
