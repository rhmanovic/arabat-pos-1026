import type { DamagedReturn } from '@arabat/contracts';
import { Badge, Button, DataTable, Dialog, Field, PageHeader, Select, Textarea } from '@arabat/ui';
import { ErrorState, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBranchContext, useBranchName, useSession } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';
import { formatDateTime } from './AdjustmentsPage.js';
import { InventoryTabs, displayQty, inventoryKey, itemName } from './shared.js';

/** Returned goods kept out of sellable stock, held until their disposal is recorded (BR-175). */
export function DamagedReturnsPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { can } = useSession();
  const { branchId } = useBranchContext();
  const branchName = useBranchName();
  const [status, setStatus] = useState<'held' | 'disposed' | 'all'>('held');
  const [disposing, setDisposing] = useState<DamagedReturn | null>(null);
  const list = useQuery({
    queryKey: [...inventoryKey, 'damaged-returns', branchId, status],
    queryFn: () => api.inventory.damagedReturns({ ...(branchId ? { branchId } : {}), status }),
  });
  return (
    <div>
      <PageHeader
        title={t('inventory.returnsTitle')}
        description={t('inventory.returnsSubtitle')}
      />
      <InventoryTabs />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select
          className="max-w-48"
          aria-label={t('inventory.status')}
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="held">{t('inventory.returns_held')}</option>
          <option value="disposed">{t('inventory.returns_disposed')}</option>
          <option value="all">{t('inventory.allStatuses')}</option>
        </Select>
        {list.data ? (
          <span className="text-sm text-fg-muted" data-testid="held-count">
            {t('inventory.heldCount', { count: list.data.heldCount })}
          </span>
        ) : null}
      </div>
      <DataTable
        caption={t('inventory.returnsTitle')}
        loading={list.isPending}
        error={
          list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : null
        }
        rows={list.data?.returns}
        rowKey={(r) => r.id}
        empty={t('inventory.returnsEmpty')}
        columns={[
          {
            key: 'date',
            header: t('inventory.date'),
            cell: (r) => formatDateTime(r.createdAt, i18n.language),
          },
          {
            key: 'refund',
            header: t('inventory.refund'),
            cell: (r) => <span dir="ltr">{r.refundNumber}</span>,
          },
          { key: 'item', header: t('inventory.item'), cell: (r) => itemName(r, i18n.language) },
          {
            key: 'branch',
            header: t('inventory.branch'),
            hideBelow: 'md',
            cell: (r) => branchName(r.branchId) ?? '—',
          },
          {
            key: 'qty',
            header: t('inventory.quantity'),
            cell: (r) => <span dir="ltr">{displayQty(r.quantity)}</span>,
          },
          {
            key: 'cost',
            header: t('inventory.unitCost'),
            hideBelow: 'lg',
            cell: (r) =>
              r.unitCost ? <span dir="ltr">{formatAmount(r.unitCost, i18n.language)}</span> : '—',
          },
          {
            key: 'reason',
            header: t('inventory.reason'),
            cell: (r) => t(`inventory.returnReason_${r.reason}`, { defaultValue: r.reason }),
          },
          {
            key: 'status',
            header: t('inventory.status'),
            cell: (r) =>
              r.status === 'held' ? (
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone="warning">{t('inventory.returns_held')}</Badge>
                  {can('inventory.adjust') ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setDisposing(r)}
                      data-testid="dispose-return"
                    >
                      {t('inventory.dispose')}
                    </Button>
                  ) : null}
                </span>
              ) : (
                <span>
                  <Badge tone="neutral">{t('inventory.returns_disposed')}</Badge>
                  <span className="block text-xs text-fg-muted">
                    {r.disposedBy}
                    {r.disposalNote ? ` — ${r.disposalNote}` : ''}
                  </span>
                </span>
              ),
          },
        ]}
      />
      {disposing ? <DisposeDialog item={disposing} onClose={() => setDisposing(null)} /> : null}
    </div>
  );
}

function DisposeDialog({ item, onClose }: { item: DamagedReturn; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const dispose = useMutation({
    mutationFn: () => api.inventory.disposeDamagedReturn(item.id, { note: note.trim() }),
    onSuccess: async () => {
      notify.ok(t('inventory.disposed'));
      await queryClient.invalidateQueries({ queryKey: inventoryKey });
      onClose();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('inventory.disposeTitle')}
      description={t('inventory.disposeHint', {
        item: itemName(item, i18n.language),
        quantity: displayQty(item.quantity),
      })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!note.trim()}
            loading={dispose.isPending}
            onClick={() => dispose.mutate()}
          >
            {t('inventory.dispose')}
          </Button>
        </>
      }
    >
      <Field label={t('inventory.disposalNote')}>
        {(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </Dialog>
  );
}
