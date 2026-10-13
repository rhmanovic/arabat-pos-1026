import type { CashVariance } from '@arabat/contracts';
import { Badge, Button, DataTable, Dialog, Field, Select, Textarea } from '@arabat/ui';
import { ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBranchContext, useBranchName, useSession } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';

export const variancesKey = ['manager', 'cash', 'variances'] as const;

const STATUS_TONE = { explained: 'primary', settled: 'success', written_off: 'warning' } as const;

/**
 * Every cash difference the system recorded, with management's follow-up (BR-167): shift
 * closes beyond the tolerance, opening differences between shifts, counts of drawers and
 * treasuries, branch transfers received short or over.
 */
export function VariancesTab({ from, to }: { from: string | undefined; to: string | undefined }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { branchId } = useBranchContext();
  const branchName = useBranchName();
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('open');
  const [resolving, setResolving] = useState<CashVariance | null>(null);
  const query = {
    status,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(branchId ? { branchId } : {}),
  };
  const list = useQuery({
    queryKey: [...variancesKey, query],
    queryFn: () => api.cash.variances(query),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select
          className="max-w-48"
          aria-label={t('common.status')}
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="open">{t('cash.varianceOpen')}</option>
          <option value="resolved">{t('cash.varianceResolved')}</option>
          <option value="all">{t('cash.statusAll')}</option>
        </Select>
        {list.data ? (
          <span className="text-sm text-fg-muted" data-testid="variances-open">
            {t('cash.varianceOpenCount', { count: list.data.openCount })}
          </span>
        ) : null}
      </div>
      <DataTable
        caption={t('cash.tabVariances')}
        loading={list.isPending}
        error={
          list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : null
        }
        rows={list.data?.variances}
        rowKey={(v) => `${v.sourceType}:${v.sourceId}`}
        empty={t('cash.varianceEmpty')}
        columns={[
          {
            key: 'when',
            header: t('inventory.date'),
            cell: (v) => formatDateTime(v.occurredAt, i18n.language),
          },
          {
            key: 'what',
            header: t('cash.varianceSource'),
            cell: (v) => (
              <span>
                <span className="block font-medium">{t(`cash.variance_${v.sourceType}`)}</span>
                <span className="block text-xs text-fg-muted">
                  {v.place.kind === 'transfer'
                    ? v.place.nameEn
                    : v.place.kind === 'treasury'
                      ? t('cashCustody.treasury')
                      : localizedName(v.place, i18n.language)}{' '}
                  · {branchName(v.branchId) ?? ''}
                </span>
              </span>
            ),
          },
          {
            key: 'amount',
            header: t('cash.discrepancy'),
            cell: (v) => (
              <span
                dir="ltr"
                className={
                  v.amount.amount.startsWith('-')
                    ? 'tabular-nums text-danger'
                    : 'tabular-nums text-success'
                }
              >
                {formatAmount(v.amount, i18n.language)}
              </span>
            ),
          },
          {
            key: 'who',
            header: t('cash.accountable'),
            hideBelow: 'md',
            cell: (v) => v.accountable ?? t('cash.betweenShifts'),
          },
          {
            key: 'note',
            header: t('cash.note'),
            hideBelow: 'lg',
            cell: (v) => v.sourceNote ?? '—',
          },
          {
            key: 'followup',
            header: t('cash.followup'),
            cell: (v) =>
              v.followup ? (
                <span className="flex flex-col gap-0.5">
                  <Badge tone={STATUS_TONE[v.followup.status]}>
                    {t(`cash.followup_${v.followup.status}`)}
                  </Badge>
                  <span className="text-xs text-fg-muted">
                    {v.followup.resolvedBy} — {v.followup.note}
                  </span>
                  <button
                    type="button"
                    className="text-start text-xs text-primary"
                    onClick={() => setResolving(v)}
                  >
                    {t('cash.followupChange')}
                  </button>
                </span>
              ) : (
                <Button size="sm" onClick={() => setResolving(v)} data-testid="resolve-variance">
                  {t('cash.followupRecord')}
                </Button>
              ),
          },
        ]}
      />
      {resolving ? <ResolveDialog variance={resolving} onClose={() => setResolving(null)} /> : null}
    </>
  );
}

function ResolveDialog({ variance, onClose }: { variance: CashVariance; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [status, setStatus] = useState<'explained' | 'settled' | 'written_off'>(
    variance.followup?.status ?? 'explained',
  );
  const [note, setNote] = useState(variance.followup?.note ?? '');
  // Settling or writing off needs cash custody at the branch (BR-167).
  const custody = can('cash.custody');
  const save = useMutation({
    mutationFn: () =>
      api.cash.resolveVariance(variance.sourceType, variance.sourceId, {
        status,
        note: note.trim(),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: variancesKey });
      await queryClient.invalidateQueries({ queryKey: ['manager', 'merchant', 'controls'] });
      notify.ok(t('cash.followupSaved'));
      onClose();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('cash.followupTitle')}
      description={t('cash.followupHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!note.trim()} loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="text-sm">
          {t(`cash.variance_${variance.sourceType}`)} ·{' '}
          <span dir="ltr">{formatAmount(variance.amount, i18n.language)}</span> ·{' '}
          {formatDateTime(variance.occurredAt, i18n.language)}
        </p>
        <Field label={t('cash.followup')}>
          {(p) => (
            <Select
              {...p}
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="explained">{t('cash.followup_explained')}</option>
              <option value="settled" disabled={!custody}>
                {t('cash.followup_settled')}
              </option>
              <option value="written_off" disabled={!custody}>
                {t('cash.followup_written_off')}
              </option>
            </Select>
          )}
        </Field>
        <Field label={t('cash.note')}>
          {(p) => (
            <Textarea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
