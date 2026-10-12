import type { Refund, RefundListQuery } from '@arabat/contracts';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Section,
  Select,
  Textarea,
} from '@arabat/ui';
import { ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useBranchContext, useBranchName, useSession } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';
import { CashTabs } from '../cash/shared.js';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';
import { Pager, displayQty } from '../inventory/shared.js';

export const refundsKey = ['manager', 'refunds'] as const;
type Row = Omit<Refund, 'lines' | 'payments'>;
const STATUS_TONE = {
  pending_approval: 'warning',
  processing: 'primary',
  completed: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
} as const;

function Amount({ value }: { value: { amount: string; currency: string } | null | undefined }) {
  const { i18n } = useTranslation();
  return (
    <span dir="ltr" className="tabular-nums">
      {formatAmount(value, i18n.language)}
    </span>
  );
}

export function RefundsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'all' | 'pending' | 'activity'>('all');
  return (
    <div>
      <PageHeader title={t('refunds.title')} description={t('refunds.subtitle')} />
      <CashTabs
        tabs={[
          { key: 'all', label: t('refunds.tabAll') },
          { key: 'pending', label: t('refunds.tabPending') },
          { key: 'activity', label: t('refunds.tabActivity') },
        ]}
        active={tab}
        onChange={(k) => setTab(k as typeof tab)}
      />
      {tab === 'activity' ? <Activity /> : <RefundList pendingOnly={tab === 'pending'} />}
    </div>
  );
}

function RefundList({ pendingOnly }: { pendingOnly: boolean }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { branchId } = useBranchContext();
  const branchName = useBranchName();
  const [params, setParams] = useSearchParams();
  const saleId = params.get('saleId');
  const [status, setStatus] = useState<RefundListQuery['status'] | ''>('');
  const [kind, setKind] = useState<RefundListQuery['kind'] | ''>('');
  const [open, setOpen] = useState<string | null>(null);
  const filterKey = JSON.stringify([status, kind, branchId, pendingOnly, saleId]);
  const [paging, setPaging] = useState({ key: filterKey, page: 1 });
  const page = paging.key === filterKey ? paging.page : 1;
  const query: RefundListQuery = {
    page,
    pageSize: 25,
    ...(pendingOnly ? { status: 'pending_approval' } : status ? { status } : {}),
    ...(kind ? { kind } : {}),
    ...(branchId ? { branchId } : {}),
    ...(saleId ? { saleId } : {}),
  };
  const list = useQuery({
    queryKey: [...refundsKey, query],
    queryFn: () => api.refunds.list(query),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      {!pendingOnly ? (
        <div className="mb-4 flex flex-wrap gap-3">
          <Select
            className="max-w-48"
            aria-label={t('refunds.status')}
            value={status ?? ''}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="">{t('refunds.allStatuses')}</option>
            {(
              ['pending_approval', 'processing', 'completed', 'rejected', 'cancelled'] as const
            ).map((s) => (
              <option key={s} value={s}>
                {t(`refunds.status_${s}`)}
              </option>
            ))}
          </Select>
          <Select
            className="max-w-44"
            aria-label={t('refunds.kind')}
            value={kind ?? ''}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="">{t('refunds.allKinds')}</option>
            {(['refund', 'void', 'exchange'] as const).map((k) => (
              <option key={k} value={k}>
                {t(`refunds.kind_${k}`)}
              </option>
            ))}
          </Select>
          {saleId ? (
            <span className="flex items-center gap-2 text-sm text-fg-muted">
              {t('refunds.filteredSale')}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  params.delete('saleId');
                  setParams(params);
                }}
              >
                {t('inventory.clearFilter')}
              </Button>
            </span>
          ) : null}
        </div>
      ) : null}
      <DataTable<Row>
        caption={t('refunds.title')}
        loading={list.isPending}
        error={
          list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : null
        }
        rows={list.data?.refunds}
        rowKey={(r) => r.id}
        empty={pendingOnly ? t('refunds.noPending') : t('refunds.empty')}
        onRowClick={(r) => setOpen(r.id)}
        columns={[
          {
            key: 'number',
            header: t('refunds.number'),
            cell: (r) => (
              <span dir="ltr" className="font-medium">
                {r.refundNumber}
              </span>
            ),
          },
          {
            key: 'date',
            header: t('inventory.date'),
            hideBelow: 'sm',
            cell: (r) => formatDateTime(r.createdAt, i18n.language),
          },
          { key: 'kind', header: t('refunds.kind'), cell: (r) => t(`refunds.kind_${r.kind}`) },
          {
            key: 'reason',
            header: t('refunds.reason'),
            hideBelow: 'lg',
            cell: (r) => t(`refunds.reason_${r.reason}`),
          },
          {
            key: 'branch',
            header: t('inventory.branch'),
            hideBelow: 'lg',
            cell: (r) => branchName(r.branchId) ?? '—',
          },
          {
            key: 'by',
            header: t('refunds.requestedBy'),
            hideBelow: 'md',
            cell: (r) => r.requestedBy,
          },
          { key: 'total', header: t('refunds.total'), cell: (r) => <Amount value={r.total} /> },
          {
            key: 'status',
            header: t('refunds.status'),
            cell: (r) => (
              <Badge tone={STATUS_TONE[r.status]}>{t(`refunds.status_${r.status}`)}</Badge>
            ),
          },
        ]}
      />
      <Pager
        page={page}
        total={list.data?.total ?? 0}
        pageSize={25}
        onPage={(p) => setPaging({ key: filterKey, page: p })}
        label={t('inventory.count', { count: list.data?.total ?? 0 })}
      />
      {open ? <RefundDialog id={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function RefundDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const [note, setNote] = useState('');
  const refund = useQuery({
    queryKey: [...refundsKey, 'detail', id],
    queryFn: () => api.refunds.get(id),
  });
  const decide = useMutation({
    mutationFn: (action: 'approve' | 'reject') =>
      action === 'approve'
        ? api.refunds.approve(id, note.trim() || null)
        : api.refunds.reject(id, note.trim() || null),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: refundsKey });
      notify.ok(r.status === 'rejected' ? t('refunds.rejected') : t('refunds.approved'));
      onClose();
    },
    onError: notify.fail,
  });
  const r = refund.data;
  const pending = r?.status === 'pending_approval' && can('refunds.approve');
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title={r ? `${t(`refunds.kind_${r.kind}`)} ${r.refundNumber}` : t('refunds.title')}
      footer={
        pending ? (
          <>
            <Button
              variant="danger"
              loading={decide.isPending && decide.variables === 'reject'}
              onClick={() => decide.mutate('reject')}
            >
              {t('refunds.reject')}
            </Button>
            <Button
              loading={decide.isPending && decide.variables === 'approve'}
              onClick={() => decide.mutate('approve')}
            >
              {t('refunds.approve')}
            </Button>
          </>
        ) : undefined
      }
    >
      {r ? (
        <div className="grid gap-4 text-sm">
          <dl className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-fg-muted">{t('refunds.sale')}</dt>
              <dd>
                <Link className="text-primary" dir="ltr" to={`/sales/${r.saleId}`}>
                  {r.receiptNumber}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">{t('refunds.status')}</dt>
              <dd>
                <Badge tone={STATUS_TONE[r.status]}>{t(`refunds.status_${r.status}`)}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">{t('refunds.reason')}</dt>
              <dd>
                {t(`refunds.reason_${r.reason}`)}
                {r.note ? ` — ${r.note}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-fg-muted">{t('refunds.requestedBy')}</dt>
              <dd>
                {r.requestedBy} · {formatDateTime(r.createdAt, i18n.language)}
              </dd>
            </div>
            {r.decidedBy ? (
              <div>
                <dt className="text-fg-muted">{t('refunds.decidedBy')}</dt>
                <dd>
                  {r.decidedBy}
                  {r.decisionNote ? ` — ${r.decisionNote}` : ''}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-fg-muted">{t('refunds.total')}</dt>
              <dd className="text-base font-semibold">
                <Amount value={r.total} />
              </dd>
            </div>
          </dl>
          {r.approvalReasons.length ? (
            <Alert tone="warning">
              {r.approvalReasons.map((x) => t(`refunds.approvalReason_${x}`)).join(' · ')}
            </Alert>
          ) : null}
          <Section title={t('refunds.items')}>
            <ul className="divide-y divide-border">
              {r.lines.map((l) => (
                <li key={l.position} className="flex justify-between gap-3 py-2">
                  <span>
                    {localizedName(l, i18n.language)} ×{' '}
                    <span dir="ltr">{displayQty(l.quantity)}</span>
                    <span className="ms-2 text-xs text-fg-muted">
                      {l.restock ? t('refunds.restocked') : t('refunds.notRestocked')}
                    </span>
                  </span>
                  <Amount value={l.amount} />
                </li>
              ))}
            </ul>
          </Section>
          <Section title={t('refunds.payments')}>
            <ul className="divide-y divide-border">
              {r.payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-3 py-2">
                  <span>
                    {p.kind === 'exchange' ? t('refunds.credit') : localizedName(p, i18n.language)}
                    <Badge className="ms-2" tone={p.status === 'succeeded' ? 'success' : 'warning'}>
                      {p.status}
                    </Badge>
                  </span>
                  <Amount value={p.amount} />
                </li>
              ))}
            </ul>
          </Section>
          {pending ? (
            <Field label={t('refunds.decisionNote')}>
              {(p) => (
                <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              )}
            </Field>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}

function Activity() {
  const { t } = useTranslation();
  const api = useApi();
  const { branchId } = useBranchContext();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const query = {
    ...(branchId ? { branchId } : {}),
    ...(DATE.test(from) ? { from } : {}),
    ...(DATE.test(to) ? { to } : {}),
  };
  const activity = useQuery({
    queryKey: [...refundsKey, 'activity', query],
    queryFn: () => api.refunds.activity(query),
  });
  type A = NonNullable<typeof activity.data>['byEmployee'][number];
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm">
          {t('inventory.from')}
          <Input
            type="date"
            className="w-40"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          {t('inventory.to')}
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {activity.data ? (
        <p className="mb-3 text-sm text-fg-muted">
          {t('refunds.activityHint', { percent: activity.data.flagThresholdPercent })}
        </p>
      ) : null}
      <DataTable<A>
        caption={t('refunds.tabActivity')}
        loading={activity.isPending}
        error={
          activity.isError ? (
            <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />
          ) : null
        }
        rows={activity.data?.byEmployee}
        rowKey={(a) => a.membershipId}
        columns={[
          { key: 'name', header: t('refunds.employee'), cell: (a) => a.employeeName },
          { key: 'sales', header: t('refunds.sales'), hideBelow: 'sm', cell: (a) => a.sales },
          {
            key: 'salesAmount',
            header: t('refunds.salesAmount'),
            hideBelow: 'md',
            cell: (a) => <Amount value={a.salesAmount} />,
          },
          { key: 'refunds', header: t('refunds.refundCount'), cell: (a) => a.refunds },
          { key: 'voids', header: t('refunds.voids'), hideBelow: 'md', cell: (a) => a.voids },
          {
            key: 'amount',
            header: t('refunds.refundAmount'),
            cell: (a) => <Amount value={a.refundAmount} />,
          },
          {
            key: 'rate',
            header: t('refunds.rate'),
            cell: (a) => <span dir="ltr">{a.refundRate}%</span>,
          },
          {
            key: 'late',
            header: t('refunds.outsideWindow'),
            hideBelow: 'lg',
            cell: (a) => a.outsideWindow,
          },
          {
            key: 'flag',
            header: t('refunds.flagged'),
            cell: (a) => (a.flagged ? <Badge tone="danger">{t('refunds.flagged')}</Badge> : null),
          },
        ]}
      />
    </>
  );
}
