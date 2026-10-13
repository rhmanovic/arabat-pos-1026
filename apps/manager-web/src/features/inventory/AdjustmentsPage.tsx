import type { Adjustment, AdjustmentKind, AdjustmentStatus } from '@arabat/contracts';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  Field,
  PageHeader,
  Section,
  Select,
  Textarea,
} from '@arabat/ui';
import { ErrorState, useApi, useNotify } from '@arabat/web-core';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useBranchContext, useBranchName, useSession } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';
import { InventoryTabs, Pager, displayQty, inventoryKey, itemName } from './shared.js';

export function formatDateTime(iso: string, language: string) {
  return new Intl.DateTimeFormat(language.startsWith('ar') ? 'ar-KW-u-nu-latn' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

const KIND_TONE: Record<AdjustmentKind, 'primary' | 'success' | 'warning' | 'neutral'> = {
  opening: 'primary',
  increase: 'success',
  decrease: 'warning',
  count: 'neutral',
};
const STATUS_TONE: Record<AdjustmentStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  posted: 'success',
  pending: 'warning',
  rejected: 'danger',
  withdrawn: 'neutral',
};

function StatusBadge({ status }: { status: AdjustmentStatus }) {
  const { t } = useTranslation();
  return <Badge tone={STATUS_TONE[status]}>{t(`inventory.status_${status}`)}</Badge>;
}

export function AdjustmentsPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const { can } = useSession();
  const { branchId } = useBranchContext();
  const branchName = useBranchName();
  const [kind, setKind] = useState<AdjustmentKind | ''>('');
  const [status, setStatus] = useState<AdjustmentStatus | ''>('');
  const [page, setPage] = useState(1);
  const query = {
    page,
    pageSize: 25,
    ...(branchId ? { branchId } : {}),
    ...(kind ? { kind } : {}),
    ...(status ? { status } : {}),
  };
  const list = useQuery({
    queryKey: [...inventoryKey, 'adjustments', query],
    queryFn: () => api.inventory.adjustments(query),
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <PageHeader
        title={t('inventory.adjustmentsTitle')}
        actions={
          can('inventory.adjust') ? (
            <Button onClick={() => void navigate('/inventory/adjustments/new')}>
              {t('inventory.newAdjustment')}
            </Button>
          ) : null
        }
      />
      <InventoryTabs />
      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          className="max-w-48"
          aria-label={t('inventory.kind')}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as AdjustmentKind | '');
            setPage(1);
          }}
        >
          <option value="">{t('inventory.allTypes')}</option>
          {(['opening', 'increase', 'decrease', 'count'] as const).map((k) => (
            <option key={k} value={k}>
              {t(`inventory.kind_${k}`)}
            </option>
          ))}
        </Select>
        <Select
          className="max-w-48"
          aria-label={t('inventory.status')}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as AdjustmentStatus | '');
            setPage(1);
          }}
        >
          <option value="">{t('inventory.allStatuses')}</option>
          {(['pending', 'posted', 'rejected', 'withdrawn'] as const).map((k) => (
            <option key={k} value={k}>
              {t(`inventory.status_${k}`)}
            </option>
          ))}
        </Select>
      </div>
      <DataTable
        caption={t('inventory.adjustmentsTitle')}
        loading={list.isPending}
        error={
          list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : null
        }
        rows={list.data?.adjustments}
        rowKey={(a) => a.id}
        empty={t('inventory.adjustmentsEmpty')}
        onRowClick={(a) => void navigate(`/inventory/adjustments/${a.id}`)}
        columns={[
          {
            key: 'number',
            header: t('inventory.number'),
            cell: (a) => (
              <span dir="ltr" className="tabular-nums">
                {a.number ?? '—'}
              </span>
            ),
          },
          {
            key: 'date',
            header: t('inventory.date'),
            cell: (a) => formatDateTime(a.createdAt, i18n.language),
          },
          {
            key: 'kind',
            header: t('inventory.kind'),
            cell: (a) => <Badge tone={KIND_TONE[a.kind]}>{t(`inventory.kind_${a.kind}`)}</Badge>,
          },
          {
            key: 'status',
            header: t('inventory.status'),
            cell: (a) => <StatusBadge status={a.status} />,
          },
          {
            key: 'reason',
            header: t('inventory.reason'),
            cell: (a) => t(`inventory.reason_${a.reason}`),
          },
          {
            key: 'branch',
            header: t('inventory.branch'),
            hideBelow: 'md',
            cell: (a) => branchName(a.branchId) ?? '—',
          },
          {
            key: 'lines',
            header: t('inventory.lines'),
            hideBelow: 'sm',
            cell: (a) => <span className="tabular-nums">{a.lineCount}</span>,
          },
          {
            key: 'by',
            header: t('inventory.createdBy'),
            hideBelow: 'lg',
            cell: (a) => a.createdBy.fullName,
          },
        ]}
      />
      <Pager
        page={page}
        total={list.data?.total ?? 0}
        pageSize={25}
        onPage={setPage}
        label={t('inventory.count', { count: list.data?.total ?? 0 })}
      />
    </div>
  );
}

export function AdjustmentDetailPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { adjustmentId } = useParams();
  const branchName = useBranchName();
  const { can, session } = useSession();
  const [deciding, setDeciding] = useState(false);
  const adjustment = useQuery({
    queryKey: [...inventoryKey, 'adjustment', adjustmentId],
    queryFn: () => api.inventory.adjustment(adjustmentId!),
  });
  const a = adjustment.data;
  const withCost = a?.lines.some((l) => l.unitCost !== undefined) ?? false;
  const mine = a?.createdBy.userId === session.actor.id;
  return (
    <div>
      <PageHeader
        title={
          a
            ? `${a.number ?? t('inventory.adjustmentTitle')} — ${t(`inventory.kind_${a.kind}`)}`
            : t('inventory.adjustmentTitle')
        }
        actions={
          <Link className="text-sm text-primary" to="/inventory/adjustments">
            {t('common.back')}
          </Link>
        }
      />
      <InventoryTabs />
      {a ? (
        <div className="grid gap-6">
          {a.status === 'pending' ? (
            <Alert tone="warning" title={t('inventory.pendingTitle')}>
              <p className="text-sm">{t('inventory.pendingBody')}</p>
              {can('inventory.adjust') ? (
                <div className="mt-3 flex gap-2">
                  {mine && !session.isOwner ? (
                    <WithdrawButton id={a.id} />
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => setDeciding(true)}
                      data-testid="decide-adjustment"
                    >
                      {t('inventory.decide')}
                    </Button>
                  )}
                </div>
              ) : null}
            </Alert>
          ) : null}
          {a.status === 'posted' && a.ownerOverride ? (
            <Alert tone="info">{t('inventory.ownerOverride')}</Alert>
          ) : null}
          <Section title={t('inventory.adjustmentTitle')}>
            <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-fg-muted">{t('inventory.status')}</dt>
                <dd>
                  <StatusBadge status={a.status} />
                </dd>
              </div>
              {a.value ? (
                <div>
                  <dt className="text-fg-muted">{t('inventory.valueAtCost')}</dt>
                  <dd dir="ltr" className="tabular-nums" data-testid="adjustment-value">
                    {formatAmount(a.value, i18n.language)}
                  </dd>
                </div>
              ) : null}
              {a.decidedBy ? (
                <div>
                  <dt className="text-fg-muted">{t(`inventory.decided_${a.status}`)}</dt>
                  <dd>
                    {a.decidedBy}
                    {a.decidedAt ? ` · ${formatDateTime(a.decidedAt, i18n.language)}` : ''}
                    {a.decisionNote ? ` — ${a.decisionNote}` : ''}
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-fg-muted">{t('inventory.date')}</dt>
                <dd>{formatDateTime(a.createdAt, i18n.language)}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">{t('inventory.branch')}</dt>
                <dd>{branchName(a.branchId) ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">{t('inventory.reason')}</dt>
                <dd data-testid="adjustment-reason">{t(`inventory.reason_${a.reason}`)}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">{t('inventory.createdBy')}</dt>
                <dd>{a.createdBy.fullName}</dd>
              </div>
              {a.note ? (
                <div className="sm:col-span-2 lg:col-span-4">
                  <dt className="text-fg-muted">{t('inventory.note')}</dt>
                  <dd className="whitespace-pre-wrap">{a.note}</dd>
                </div>
              ) : null}
            </dl>
          </Section>
          <DataTable
            caption={t('inventory.lines')}
            rows={a.lines}
            rowKey={(l) => l.variantId}
            columns={[
              {
                key: 'item',
                header: t('inventory.item'),
                cell: (l) => (
                  <span>
                    <span className="block font-medium">{itemName(l, i18n.language)}</span>
                    {l.sku ? (
                      <span className="block text-xs text-fg-muted" dir="ltr">
                        {l.sku}
                      </span>
                    ) : null}
                  </span>
                ),
              },
              {
                key: 'before',
                header: t('inventory.before'),
                hideBelow: 'sm',
                cell: (l) => <Qty value={l.previousOnHand} />,
              },
              {
                key: 'delta',
                header: t('inventory.delta'),
                cell: (l) => <Qty value={l.delta} signed />,
              },
              {
                key: 'after',
                header: t('inventory.after'),
                cell: (l) => <Qty value={l.newOnHand} />,
              },
              ...(withCost
                ? [
                    {
                      key: 'cost',
                      header: t('inventory.unitCost'),
                      hideBelow: 'md' as const,
                      cell: (l: (typeof a.lines)[number]) => (
                        <span className="tabular-nums" dir="ltr">
                          {formatAmount(l.unitCost, i18n.language)}
                        </span>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      ) : null}
      {deciding && a ? <DecisionDialog adjustment={a} onClose={() => setDeciding(false)} /> : null}
    </div>
  );
}

function WithdrawButton({ id }: { id: string }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const withdraw = useMutation({
    mutationFn: () => api.inventory.withdrawAdjustment(id),
    onSuccess: async () => {
      notify.ok(t('inventory.withdrawn'));
      await queryClient.invalidateQueries({ queryKey: inventoryKey });
    },
    onError: notify.fail,
  });
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={withdraw.isPending}
      onClick={() => withdraw.mutate()}
    >
      {t('inventory.withdraw')}
    </Button>
  );
}

/** Approve posts the movements now; rejecting needs a reason (BR-169). */
function DecisionDialog({ adjustment, onClose }: { adjustment: Adjustment; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'approve' | 'reject') =>
      api.inventory.decideAdjustment(adjustment.id, { decision, note: note.trim() || null }),
    onSuccess: async () => {
      notify.ok(t('inventory.decided'));
      await queryClient.invalidateQueries({ queryKey: inventoryKey });
      onClose();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('inventory.decideTitle', { number: adjustment.number ?? '' })}
      description={t('inventory.decideHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={!note.trim()}
            loading={decide.isPending}
            onClick={() => decide.mutate('reject')}
          >
            {t('inventory.reject')}
          </Button>
          <Button loading={decide.isPending} onClick={() => decide.mutate('approve')}>
            {t('inventory.approve')}
          </Button>
        </>
      }
    >
      <Field label={t('inventory.decisionNote')}>
        {(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </Dialog>
  );
}

export function Qty({ value, signed = false }: { value: string; signed?: boolean }) {
  const negative = value.startsWith('-');
  const text = displayQty(value);
  return (
    <span
      dir="ltr"
      className={
        signed
          ? negative
            ? 'tabular-nums text-danger'
            : 'tabular-nums text-success'
          : 'tabular-nums'
      }
    >
      {signed && !negative && text !== '0' ? `+${text}` : text}
    </span>
  );
}
