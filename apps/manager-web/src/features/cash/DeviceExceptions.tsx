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
  // "Shift left open" (ADR-0112 amendment 3): the manager closes the stale shift from here, an
  // uncounted forced close (the drawer is counted at the next opening), and the exception is
  // marked handled with the same note.
  const [closingStale, setClosingStale] = useState<DeviceException | null>(null);
  const [closeNote, setCloseNote] = useState('');
  const closeStale = useMutation({
    mutationFn: async ({ e, text }: { e: DeviceException; text: string }) => {
      const staleShiftId = String(e.details['staleShiftId']);
      if (!e.details['staleShiftClosed']) {
        const shift = await api.shifts.get(staleShiftId);
        await api.shifts.forceClose(staleShiftId, { note: text, version: shift.version });
      }
      await api.devices.resolveException(e.id, text);
    },
    onSuccess: async () => {
      setClosingStale(null);
      setCloseNote('');
      await queryClient.invalidateQueries({ queryKey: exceptionsKey });
      await queryClient.invalidateQueries({ queryKey: ['manager', 'shifts'] });
      notify.ok(t('devices.staleShiftClosed'));
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
    if (e.kind === 'shift_left_open')
      return t(d['staleShiftClosed'] ? 'devices.staleShiftClosedText' : 'devices.staleShiftText', {
        name: d['fullName'] ?? '',
        register: d['staleRegisterCode'] ?? '',
        where: t(d['staleOnDevice'] ? 'devices.onDevice' : 'devices.inBrowser'),
        since: formatDateTime(String(d['staleOpenedAt'] ?? e.occurredAt), i18n.language),
      });
    if (e.kind === 'late')
      return t('devices.lateText', {
        record: t(`devices.record.${e.recordKind}`, { defaultValue: e.recordKind }),
        closedAt: d['closedAt'] ? formatDateTime(String(d['closedAt']), i18n.language) : '—',
      });
    if (e.kind === 'forced_close')
      return t('devices.forcedCloseText', {
        name: d['absentName'] ?? '',
        note: d['note'] ?? '',
        discrepancy: d['discrepancy'] ?? '',
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
              <Badge tone={e.kind === 'refused' || e.kind === 'late' ? 'danger' : 'warning'}>
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
                <span className="flex flex-wrap gap-1">
                  {e.kind === 'shift_left_open' && !e.details['staleShiftClosed'] ? (
                    <Button size="sm" onClick={() => setClosingStale(e)}>
                      {t('devices.closeStaleShift')}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={() => setHandling(e)}>
                    {t('devices.markHandled')}
                  </Button>
                </span>
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
      <Dialog
        open={closingStale !== null}
        onOpenChange={(open) => !open && setClosingStale(null)}
        title={t('devices.closeStaleShift')}
        description={
          closingStale ? `${describe(closingStale)} ${t('devices.closeStaleHint')}` : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setClosingStale(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={closeNote.trim() === ''}
              loading={closeStale.isPending}
              onClick={() =>
                closingStale && closeStale.mutate({ e: closingStale, text: closeNote.trim() })
              }
            >
              {t('devices.closeStaleShift')}
            </Button>
          </>
        }
      >
        <Field label={t('devices.resolutionNote')}>
          {(field) => (
            <Textarea
              {...field}
              value={closeNote}
              onChange={(e) => setCloseNote(e.target.value)}
              rows={3}
            />
          )}
        </Field>
      </Dialog>
    </section>
  );
}
