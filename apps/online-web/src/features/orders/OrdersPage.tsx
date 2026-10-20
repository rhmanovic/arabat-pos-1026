import type { OnlineOrder, OnlineOrderStatus } from '@arabat/contracts';
import { ONLINE_ORDER_STATUSES } from '@arabat/contracts';
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
import { AccessDenied, ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { managerUrl, useBranchName, useSession } from '../../app/context.js';
import {
  type Action,
  ORDER_TONE,
  PAYABLE_KINDS,
  Pager,
  formatAmount,
  formatDateTime,
  key,
  nextActions,
} from '../shared.js';

/** Online orders: list, detail, fulfilment steps and the pay-on-receipt payment (ADR-0118). */
export function OrdersPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  if (!can('online.orders')) return <AccessDenied />;
  return (
    <div>
      <PageHeader title={t('nav.orders')} description={t('subtitle')} />
      <OrdersTab />
    </div>
  );
}

// ------------------------------------------------------------------------------- orders
function OrdersTab() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const branchName = useBranchName();
  const [params] = useSearchParams();
  // The overview's tiles open the list filtered (`?status=`).
  const [status, setStatus] = useState<OnlineOrderStatus | ''>(
    (params.get('status') as OnlineOrderStatus | null) ?? '',
  );
  const [paging, setPaging] = useState({ status, page: 1 });
  const page = paging.status === status ? paging.page : 1;
  const [openId, setOpenId] = useState<string | null>(null);
  const query = { page, pageSize: 25, ...(status ? { status } : {}) };
  const list = useQuery({
    queryKey: [...key, 'orders', query],
    queryFn: () => api.online.orders(query),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
  const reconcile = useMutation({
    mutationFn: () => api.online.reconcile(),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: key });
      notify.ok(t('store.reconciled', r));
    },
    onError: notify.fail,
  });
  const counts = list.data?.counts ?? {};
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          className="w-56"
          aria-label={t('store.status')}
          value={status}
          onChange={(e) => setStatus(e.target.value as OnlineOrderStatus | '')}
        >
          <option value="">{t('store.allStatuses')}</option>
          {ONLINE_ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`store.status_${s}`)} ({counts[s] ?? 0})
            </option>
          ))}
        </Select>
        {(counts['needs_attention'] ?? 0) > 0 ? (
          <Badge tone="warning">
            {t('store.attentionCount', { count: counts['needs_attention'] })}
          </Badge>
        ) : null}
        {can('online.manage') ? (
          <Button
            variant="secondary"
            loading={reconcile.isPending}
            onClick={() => reconcile.mutate()}
          >
            {t('store.reconcile')}
          </Button>
        ) : null}
      </div>
      <DataTable
        caption={t('store.tabOrders')}
        loading={list.isPending}
        error={
          list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : null
        }
        rows={list.data?.orders}
        rowKey={(o) => o.id}
        empty={t('store.noOrders')}
        onRowClick={(o) => setOpenId(o.id)}
        columns={[
          {
            key: 'number',
            header: t('store.number'),
            cell: (o) => (
              <span dir="ltr" className="font-medium">
                {o.number}
              </span>
            ),
          },
          {
            key: 'date',
            header: t('sales.date'),
            cell: (o) => formatDateTime(o.createdAt, i18n.language),
          },
          { key: 'customer', header: t('sales.customer'), cell: (o) => o.customerName },
          {
            key: 'fulfillment',
            header: t('store.fulfillment'),
            hideBelow: 'md',
            cell: (o) => t(`store.fulfillment_${o.fulfillment}`),
          },
          {
            key: 'branch',
            header: t('inventory.branch'),
            hideBelow: 'lg',
            cell: (o) => branchName(o.branchId) ?? '—',
          },
          {
            key: 'wanted',
            header: t('store.wanted'),
            hideBelow: 'lg',
            cell: (o) =>
              o.scheduledFor ? formatDateTime(o.scheduledFor, i18n.language) : t('store.asap'),
          },
          {
            key: 'status',
            header: t('store.status'),
            cell: (o) => (
              <span className="flex flex-wrap gap-1">
                <Badge tone={ORDER_TONE[o.status]}>{t(`store.status_${o.status}`)}</Badge>
                {o.paymentMode === 'on_receipt' && !o.saleId ? (
                  <Badge tone="warning">{t('store.unpaid')}</Badge>
                ) : null}
              </span>
            ),
          },
          {
            key: 'total',
            header: t('sales.total'),
            cell: (o) => (
              <span dir="ltr" className="tabular-nums">
                {formatAmount(o.total, i18n.language)}
              </span>
            ),
          },
        ]}
      />
      <Pager
        page={page}
        total={list.data?.total ?? 0}
        pageSize={25}
        onPage={(p) => setPaging({ status, page: p })}
        label={t('inventory.count', { count: list.data?.total ?? 0 })}
      />
      {openId ? <OrderDialog id={openId} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

function OrderDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [paying, setPaying] = useState(false);
  const order = useQuery({ queryKey: [...key, 'order', id], queryFn: () => api.online.order(id) });
  const act = useMutation({
    mutationFn: (action: Exclude<Action, 'mark_paid'>) =>
      api.online.act(id, { action, note: note || null, version: order.data!.version }),
    onSuccess: async () => {
      setNote('');
      await queryClient.invalidateQueries({ queryKey: key });
      notify.ok(t('store.updated'));
    },
    onError: notify.fail,
  });
  const o = order.data;
  const money = (v: { amount: string; currency: string }) => (
    <span dir="ltr" className="tabular-nums">
      {formatAmount(v, i18n.language)}
    </span>
  );
  const actions = o ? nextActions(o) : [];
  return (
    <Dialog
      open
      onOpenChange={(v) => (!v ? onClose() : undefined)}
      size="lg"
      title={o ? `${t('store.order')} ${o.number}` : t('store.order')}
      description={o ? formatDateTime(o.createdAt, i18n.language) : undefined}
      footer={
        actions.length > 0 ? (
          <>
            {actions.map((a) => (
              <Button
                key={a}
                variant={a === 'cancel' ? 'danger' : a === actions[0] ? 'primary' : 'secondary'}
                loading={act.isPending && act.variables === a}
                disabled={act.isPending}
                onClick={() => (a === 'mark_paid' ? setPaying(true) : act.mutate(a))}
              >
                {t(`store.action_${a}`)}
              </Button>
            ))}
          </>
        ) : undefined
      }
    >
      {o && paying ? (
        <PayDialog
          order={o}
          note={note}
          onClose={() => setPaying(false)}
          onPaid={() => {
            setPaying(false);
            setNote('');
          }}
        />
      ) : null}
      {o ? (
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ORDER_TONE[o.status]}>{t(`store.status_${o.status}`)}</Badge>
            {o.paymentMode === 'on_receipt' ? (
              <Badge tone={o.saleId ? 'success' : 'warning'}>
                {o.saleId ? t('store.paidOnReceipt') : t('store.unpaidOnReceipt')}
              </Badge>
            ) : null}
            <span>{t(`store.fulfillment_${o.fulfillment}`)}</span>
            {o.saleId ? (
              <a
                className="text-primary hover:underline"
                href={managerUrl(`sales/${o.saleId}`)}
                target="_blank"
                rel="noreferrer"
              >
                {t('store.sale', { receipt: o.receiptNumber })}
              </a>
            ) : null}
          </div>
          {o.status === 'needs_attention' ? (
            <Alert tone="warning">{o.statusNote ?? t('store.attentionHint')}</Alert>
          ) : null}
          {o.saleId && o.status !== 'completed' ? (
            <p className="text-fg-muted">{t('store.refundHint')}</p>
          ) : null}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-fg-muted">{t('sales.customer')}</dt>
            <dd>
              {o.customerName} · <span dir="ltr">{o.customerPhone}</span>
              {o.customerEmail ? ` · ${o.customerEmail}` : ''}
            </dd>
            <dt className="text-fg-muted">{t('inventory.branch')}</dt>
            <dd>{localizedName(o.branch, i18n.language) || '—'}</dd>
            <dt className="text-fg-muted">{t('store.wanted')}</dt>
            <dd>
              {o.scheduledFor ? formatDateTime(o.scheduledFor, i18n.language) : t('store.asap')}
            </dd>
            {o.deliveryArea || o.deliveryAreaName ? (
              <>
                <dt className="text-fg-muted">{t('store.deliveryArea')}</dt>
                <dd>
                  {(o.deliveryArea && localizedName(o.deliveryArea, i18n.language)) ||
                    o.deliveryAreaName}
                </dd>
              </>
            ) : null}
            {o.deliveryAddress ? (
              <>
                <dt className="text-fg-muted">{t('store.address')}</dt>
                <dd className="whitespace-pre-line">{o.deliveryAddress}</dd>
              </>
            ) : null}
            {o.note ? (
              <>
                <dt className="text-fg-muted">{t('store.note')}</dt>
                <dd className="whitespace-pre-line">{o.note}</dd>
              </>
            ) : null}
            {o.promotion ? (
              <>
                <dt className="text-fg-muted">{t('store.discount')}</dt>
                <dd>
                  -{formatAmount(o.discount, i18n.language)} · {o.promotion.name}
                  {o.promotion.code ? (
                    <>
                      {' '}
                      (<span dir="ltr">{o.promotion.code}</span>)
                    </>
                  ) : null}
                </dd>
              </>
            ) : null}
            <dt className="text-fg-muted">{t('sales.method')}</dt>
            <dd>
              {o.paymentMethod ? localizedName(o.paymentMethod, i18n.language) : '—'}
              {o.paymentReference ? (
                <>
                  {' · '}
                  <span dir="ltr">{o.paymentReference}</span>
                </>
              ) : null}
            </dd>
          </dl>
          <table className="w-full">
            <thead className="text-xs text-fg-muted">
              <tr>
                <th className="text-start">{t('sales.lines')}</th>
                <th className="text-end">{t('sales.qty')}</th>
                <th className="text-end">{t('sales.total')}</th>
              </tr>
            </thead>
            <tbody>
              {o.lines.map((l) => (
                <tr key={l.position}>
                  <td>
                    {[
                      localizedName(l, i18n.language),
                      localizedName(
                        { nameEn: l.variantNameEn, nameAr: l.variantNameAr },
                        i18n.language,
                      ),
                    ]
                      .filter(Boolean)
                      .join(' — ')}
                  </td>
                  <td className="text-end tabular-nums">{l.quantity.replace(/\.000$/, '')}</td>
                  <td className="text-end">{money(l.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {o.fulfillment === 'delivery' ? (
                <tr>
                  <td colSpan={2}>{t('store.deliveryFee')}</td>
                  <td className="text-end">{money(o.deliveryFee)}</td>
                </tr>
              ) : null}
              <tr className="font-semibold">
                <td colSpan={2}>{t('sales.total')}</td>
                <td className="text-end">{money(o.total)}</td>
              </tr>
            </tfoot>
          </table>
          {o.payments.length > 0 ? (
            <Section title={t('store.paymentAttempts')}>
              <ul className="flex flex-col gap-1">
                {o.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap justify-between gap-2">
                    <span>
                      {p.provider} · <span dir="ltr">{p.providerReference ?? '—'}</span>
                    </span>
                    <span>
                      {t(`store.payment_${p.status}`)} · {money(p.amount)}
                      {p.failureReason ? ` · ${p.failureReason}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          <Section title={t('store.timeline')}>
            <ol className="flex flex-col gap-1">
              {o.timeline.map((e, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>{t(`store.status_${e.status}`)}</span>
                  <span className="text-fg-muted">{formatDateTime(e.at, i18n.language)}</span>
                </li>
              ))}
            </ol>
          </Section>
          {actions.length > 0 ? (
            <Field label={t('store.note')}>
              {(p) => <Textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}

/** Records the money received for a pay-on-receipt order with a POS tender (ADR-0118). */
function PayDialog({
  order,
  note,
  onClose,
  onPaid,
}: {
  order: OnlineOrder;
  note: string;
  onClose: () => void;
  onPaid: () => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const tenders = useQuery({ queryKey: [...key, 'tenders'], queryFn: () => api.online.tenders() });
  const [methodId, setMethodId] = useState('');
  const [reference, setReference] = useState('');
  const list = (tenders.data?.tenders ?? []).filter((m) => PAYABLE_KINDS.includes(m.kind));
  const chosen = list.find((m) => m.id === (methodId || list[0]?.id));
  const pay = useMutation({
    mutationFn: () =>
      api.online.act(order.id, {
        action: 'mark_paid',
        paymentMethodId: chosen!.id,
        reference: reference || null,
        note: note || null,
        version: order.version,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      notify.ok(t('store.paymentRecorded'));
      onPaid();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => (!v ? onClose() : undefined)}
      title={t('store.markPaidTitle', { number: order.number })}
      description={t('store.markPaidHint', { total: formatAmount(order.total, i18n.language) })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={pay.isPending}
            disabled={!chosen || (chosen.requiresReference && !reference.trim())}
            onClick={() => pay.mutate()}
          >
            {t('store.recordPayment')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('store.tender')}>
          {(p) => (
            <Select {...p} value={chosen?.id ?? ''} onChange={(e) => setMethodId(e.target.value)}>
              {list.map((m) => (
                <option key={m.id} value={m.id}>
                  {localizedName(m, i18n.language)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {chosen && chosen.kind !== 'cash' ? (
          <Field
            label={t('store.reference')}
            hint={chosen.requiresReference ? t('store.referenceRequired') : undefined}
          >
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            )}
          </Field>
        ) : null}
        {chosen?.kind === 'cash' ? (
          <p className="text-sm text-fg-muted">{t('store.cashToTreasury')}</p>
        ) : null}
      </div>
    </Dialog>
  );
}
