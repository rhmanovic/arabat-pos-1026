import type {
  OnlineOrder,
  OnlineOrderAction,
  OnlineOrderStatus,
  OnlineStore,
  SaveOnlineStore,
} from '@arabat/contracts';
import { ApiError } from '@arabat/api-client';
import { ONLINE_ORDER_STATUSES, RESERVED_STORE_SLUGS, STORE_SLUG_PATTERN } from '@arabat/contracts';
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
  Section,
  Select,
  Textarea,
} from '@arabat/ui';
import { ErrorState, AccessDenied, localizedName, useApi, useNotify } from '@arabat/web-core';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useBranchContext, useBranchName, useSession } from '../../app/context.js';
import { CashTabs } from '../cash/shared.js';
import { formatAmount } from '../catalog/ProductsPage.js';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';
import { Pager } from '../inventory/shared.js';

const key = ['manager', 'online'] as const;
type Tab = 'orders' | 'settings' | 'products';
type Action = OnlineOrderAction;

export const ORDER_TONE: Record<
  OnlineOrderStatus,
  'primary' | 'success' | 'warning' | 'danger' | 'neutral'
> = {
  pending_payment: 'neutral',
  placed: 'warning',
  confirmed: 'primary',
  paid: 'primary',
  preparing: 'primary',
  ready: 'success',
  out_for_delivery: 'success',
  completed: 'success',
  expired: 'neutral',
  payment_failed: 'danger',
  cancelled: 'neutral',
  needs_attention: 'warning',
};

/**
 * Actions offered for an order; the API re-checks every transition (BR-146). A pay-on-receipt
 * order (ADR-0118) can have its payment recorded until it is completed, completes only once
 * paid, and can be cancelled in place while unpaid.
 */
export function nextActions(
  order: Pick<OnlineOrder, 'status' | 'fulfillment'> &
    Partial<Pick<OnlineOrder, 'paymentMode' | 'saleId'>>,
): Action[] {
  const forward: Record<string, Action[]> = {
    placed: ['confirm'],
    confirmed: ['preparing', 'ready', 'out_for_delivery', 'completed'],
    paid: ['preparing', 'ready', 'out_for_delivery', 'completed'],
    preparing: ['ready', 'out_for_delivery', 'completed'],
    ready: ['completed'],
    out_for_delivery: ['completed'],
    pending_payment: ['cancel'],
    needs_attention: ['cancel'],
  };
  const unpaidOnReceipt = order.paymentMode === 'on_receipt' && !order.saleId;
  const steps = (forward[order.status] ?? []).filter(
    (a) =>
      !(a === 'ready' && order.fulfillment !== 'pickup') &&
      !(a === 'out_for_delivery' && order.fulfillment !== 'delivery') &&
      !(a === 'completed' && unpaidOnReceipt),
  );
  if (unpaidOnReceipt && order.status !== 'needs_attention') steps.push('mark_paid', 'cancel');
  return steps;
}

const PAYABLE_KINDS = ['cash', 'card', 'bank_transfer', 'custom'];

/** Online store (Prompt 16): orders, storefront settings and which products are sold online. */
export function OnlineStorePage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const tabs = (
    [
      { key: 'orders', label: t('online.tabOrders'), perm: 'online.orders' },
      { key: 'settings', label: t('online.tabSettings'), perm: 'online.manage' },
      { key: 'products', label: t('online.tabProducts'), perm: 'online.manage' },
    ] as const
  ).filter((x) => can(x.perm));
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? 'orders');
  if (tabs.length === 0) return <AccessDenied />;
  return (
    <div>
      <PageHeader title={t('online.title')} description={t('online.subtitle')} />
      <CashTabs tabs={tabs} active={tab} onChange={(k) => setTab(k as Tab)} />
      {tab === 'orders' ? <OrdersTab /> : null}
      {tab === 'settings' ? <SettingsTab /> : null}
      {tab === 'products' ? <ProductsTab /> : null}
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
  const [status, setStatus] = useState<OnlineOrderStatus | ''>('');
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
      notify.ok(t('online.reconciled', r));
    },
    onError: notify.fail,
  });
  const counts = list.data?.counts ?? {};
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          className="w-56"
          aria-label={t('online.status')}
          value={status}
          onChange={(e) => setStatus(e.target.value as OnlineOrderStatus | '')}
        >
          <option value="">{t('online.allStatuses')}</option>
          {ONLINE_ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`online.status_${s}`)} ({counts[s] ?? 0})
            </option>
          ))}
        </Select>
        {(counts['needs_attention'] ?? 0) > 0 ? (
          <Badge tone="warning">
            {t('online.attentionCount', { count: counts['needs_attention'] })}
          </Badge>
        ) : null}
        {can('online.manage') ? (
          <Button
            variant="secondary"
            loading={reconcile.isPending}
            onClick={() => reconcile.mutate()}
          >
            {t('online.reconcile')}
          </Button>
        ) : null}
      </div>
      <DataTable
        caption={t('online.tabOrders')}
        loading={list.isPending}
        error={
          list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : null
        }
        rows={list.data?.orders}
        rowKey={(o) => o.id}
        empty={t('online.noOrders')}
        onRowClick={(o) => setOpenId(o.id)}
        columns={[
          {
            key: 'number',
            header: t('online.number'),
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
            header: t('online.fulfillment'),
            hideBelow: 'md',
            cell: (o) => t(`online.fulfillment_${o.fulfillment}`),
          },
          {
            key: 'branch',
            header: t('inventory.branch'),
            hideBelow: 'lg',
            cell: (o) => branchName(o.branchId) ?? '—',
          },
          {
            key: 'status',
            header: t('online.status'),
            cell: (o) => (
              <span className="flex flex-wrap gap-1">
                <Badge tone={ORDER_TONE[o.status]}>{t(`online.status_${o.status}`)}</Badge>
                {o.paymentMode === 'on_receipt' && !o.saleId ? (
                  <Badge tone="warning">{t('online.unpaid')}</Badge>
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
      notify.ok(t('online.updated'));
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
      title={o ? `${t('online.order')} ${o.number}` : t('online.order')}
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
                {t(`online.action_${a}`)}
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
            <Badge tone={ORDER_TONE[o.status]}>{t(`online.status_${o.status}`)}</Badge>
            {o.paymentMode === 'on_receipt' ? (
              <Badge tone={o.saleId ? 'success' : 'warning'}>
                {o.saleId ? t('online.paidOnReceipt') : t('online.unpaidOnReceipt')}
              </Badge>
            ) : null}
            <span>{t(`online.fulfillment_${o.fulfillment}`)}</span>
            {o.saleId ? (
              <Link className="text-primary hover:underline" to={`/sales/${o.saleId}`}>
                {t('online.sale', { receipt: o.receiptNumber })}
              </Link>
            ) : null}
          </div>
          {o.status === 'needs_attention' ? (
            <Alert tone="warning">{o.statusNote ?? t('online.attentionHint')}</Alert>
          ) : null}
          {o.saleId && o.status !== 'completed' ? (
            <p className="text-fg-muted">{t('online.refundHint')}</p>
          ) : null}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-fg-muted">{t('sales.customer')}</dt>
            <dd>
              {o.customerName} · <span dir="ltr">{o.customerPhone}</span>
              {o.customerEmail ? ` · ${o.customerEmail}` : ''}
            </dd>
            {o.deliveryAddress ? (
              <>
                <dt className="text-fg-muted">{t('online.address')}</dt>
                <dd className="whitespace-pre-line">{o.deliveryAddress}</dd>
              </>
            ) : null}
            {o.note ? (
              <>
                <dt className="text-fg-muted">{t('online.note')}</dt>
                <dd className="whitespace-pre-line">{o.note}</dd>
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
                  <td colSpan={2}>{t('online.deliveryFee')}</td>
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
            <Section title={t('online.paymentAttempts')}>
              <ul className="flex flex-col gap-1">
                {o.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap justify-between gap-2">
                    <span>
                      {p.provider} · <span dir="ltr">{p.providerReference ?? '—'}</span>
                    </span>
                    <span>
                      {t(`online.payment_${p.status}`)} · {money(p.amount)}
                      {p.failureReason ? ` · ${p.failureReason}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          <Section title={t('online.timeline')}>
            <ol className="flex flex-col gap-1">
              {o.timeline.map((e, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span>{t(`online.status_${e.status}`)}</span>
                  <span className="text-fg-muted">{formatDateTime(e.at, i18n.language)}</span>
                </li>
              ))}
            </ol>
          </Section>
          {actions.length > 0 ? (
            <Field label={t('online.note')}>
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
      notify.ok(t('online.paymentRecorded'));
      onPaid();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(v) => (!v ? onClose() : undefined)}
      title={t('online.markPaidTitle', { number: order.number })}
      description={t('online.markPaidHint', { total: formatAmount(order.total, i18n.language) })}
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
            {t('online.recordPayment')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('online.tender')}>
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
            label={t('online.reference')}
            hint={chosen.requiresReference ? t('online.referenceRequired') : undefined}
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
          <p className="text-sm text-fg-muted">{t('online.cashToTreasury')}</p>
        ) : null}
      </div>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------- settings
function toForm(s: OnlineStore): SaveOnlineStore {
  return {
    slug: s.slug,
    status: s.status,
    nameEn: s.nameEn,
    nameAr: s.nameAr,
    taglineEn: s.taglineEn,
    taglineAr: s.taglineAr,
    announcementEn: s.announcementEn,
    announcementAr: s.announcementAr,
    primaryColor: s.primaryColor,
    contactPhone: s.contactPhone,
    contactEmail: s.contactEmail,
    fulfillmentBranchId: s.fulfillmentBranchId,
    pickupEnabled: s.pickupEnabled,
    deliveryEnabled: s.deliveryEnabled,
    deliveryFee: s.deliveryFee.amount,
    minimumOrder: s.minimumOrder.amount,
    reservationMinutes: s.reservationMinutes,
    payOnReceiptEnabled: s.payOnReceiptEnabled,
    version: s.version,
  };
}

/** Live check of a store address while the merchant types (debounced). */
function useSlugCheck(slug: string, current: string) {
  const api = useApi();
  const [debounced, setDebounced] = useState(slug);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(slug), 400);
    return () => clearTimeout(timer);
  }, [slug]);
  const normalized = debounced.trim().toLowerCase();
  const changed = normalized !== current.toLowerCase();
  const local: 'invalid' | 'reserved' | null = !STORE_SLUG_PATTERN.test(normalized)
    ? 'invalid'
    : RESERVED_STORE_SLUGS.includes(normalized)
      ? 'reserved'
      : null;
  const remote = useQuery({
    queryKey: [...key, 'slug', normalized],
    queryFn: () => api.online.slugAvailability(normalized),
    enabled: changed && local === null,
    staleTime: 10_000,
  });
  if (!changed) return { state: 'unchanged' as const, suggestions: [] as string[] };
  if (local) return { state: local, suggestions: [] as string[] };
  if (remote.isPending) return { state: 'checking' as const, suggestions: [] as string[] };
  if (remote.isError) return { state: 'unknown' as const, suggestions: [] as string[] };
  return {
    state: remote.data.available ? ('available' as const) : remote.data.reason!,
    suggestions: remote.data.suggestions,
  };
}

function SettingsTab() {
  const api = useApi();
  const store = useQuery({ queryKey: [...key, 'store'], queryFn: () => api.online.store() });
  return store.data ? <SettingsForm key={store.data.version} store={store.data} /> : null;
}

function SettingsForm({ store }: { store: OnlineStore }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { branches } = useBranchContext();
  const [v, setV] = useState<SaveOnlineStore>(() => toForm(store));
  const set = (patch: Partial<SaveOnlineStore>) => setV((x) => ({ ...x, ...patch }));
  /** Field problems the server reported on the last save, by field name. */
  const [issues, setIssues] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      setIssues({});
      return api.online.saveStore(v);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      notify.ok(t('common.saved'));
    },
    onError: (error) => {
      if (error instanceof ApiError && error.problem.issues?.length) {
        const fields = error.problem.issues.map((i) => i.path.split('.')[0] ?? i.path);
        setIssues(
          Object.fromEntries(
            error.problem.issues.map((i, n) => [
              fields[n]!,
              t(`online.issue_${fields[n]!}`, { defaultValue: i.message }),
            ]),
          ),
        );
        // On a phone the refused field may be far from the Save button: bring it into view.
        setTimeout(() => {
          document
            .querySelector(`[data-field="${fields[0]!}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 0);
      }
      notify.fail(error);
    },
  });
  const FIELD_LABELS: Record<string, string> = {
    slug: t('online.slug'),
    status: t('online.storeStatus'),
    nameAr: t('online.nameAr'),
    nameEn: t('online.nameEn'),
    taglineAr: t('online.taglineAr'),
    taglineEn: t('online.taglineEn'),
    announcementAr: t('online.announcementAr'),
    announcementEn: t('online.announcementEn'),
    primaryColor: t('online.color'),
    contactPhone: t('online.contactPhone'),
    contactEmail: t('online.contactEmail'),
    fulfillmentBranchId: t('online.branch'),
    reservationMinutes: t('online.reservationMinutes'),
    pickupEnabled: t('online.pickup'),
    deliveryEnabled: t('online.delivery'),
    deliveryFee: t('online.deliveryFee'),
    minimumOrder: t('online.minimumOrder'),
  };
  const text = (field: keyof SaveOnlineStore, label: string, props: { dir?: 'ltr' } = {}) => (
    <div data-field={field}>
      <Field label={label} error={issues[field]}>
        {(p) => (
          <Input
            {...p}
            {...props}
            value={(v[field] as string | null | undefined) ?? ''}
            onChange={(e) => set({ [field]: e.target.value } as Partial<SaveOnlineStore>)}
          />
        )}
      </Field>
    </div>
  );
  const ready = store.paymentMethods.filter((m) => m.ready);
  const slugCheck = useSlugCheck(v.slug, store.slug);
  const preview = store.url.replace(/[^/]*$/, v.slug.trim().toLowerCase());
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(store.url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  const slugMessage: Record<typeof slugCheck.state, string | null> = {
    unchanged: null,
    checking: t('online.slugChecking'),
    available: t('online.slugAvailable'),
    taken: t('online.slugTaken'),
    reserved: t('online.slugReserved'),
    invalid: t('online.slugInvalid'),
    rename_limit: t('online.slugRenameLimit'),
    unknown: null,
  };
  return (
    <div className="flex flex-col gap-4">
      <Section title={t('online.addressSection')} description={t('online.addressHint')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div data-field="slug">
            <Field
              label={t('online.slug')}
              hint={t('online.slugFormat')}
              error={
                ['taken', 'reserved', 'invalid', 'rename_limit'].includes(slugCheck.state)
                  ? (slugMessage[slugCheck.state] ?? undefined)
                  : issues['slug']
              }
            >
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  autoComplete="off"
                  value={v.slug}
                  onChange={(e) => set({ slug: e.target.value })}
                />
              )}
            </Field>
          </div>
          <div className="text-sm">
            <p className="text-fg-muted">{t('online.address')}</p>
            <p dir="ltr" className="break-all font-medium" data-testid="store-url-preview">
              {preview}
            </p>
            {slugCheck.state === 'available' || slugCheck.state === 'checking' ? (
              <p className={slugCheck.state === 'available' ? 'text-success' : 'text-fg-muted'}>
                {slugMessage[slugCheck.state]}
              </p>
            ) : null}
            {slugCheck.suggestions.length > 0 ? (
              <p className="mt-1 flex flex-wrap items-center gap-1">
                <span className="text-fg-muted">{t('online.slugSuggestions')}</span>
                {slugCheck.suggestions.map((s) => (
                  <Button key={s} size="sm" variant="secondary" onClick={() => set({ slug: s })}>
                    <span dir="ltr">{s}</span>
                  </Button>
                ))}
              </p>
            ) : null}
          </div>
          <p className="flex flex-wrap items-center gap-2 text-sm sm:col-span-2">
            {store.status === 'draft' ? (
              <span dir="ltr">{store.url}</span>
            ) : (
              <a
                className="text-primary hover:underline"
                href={store.url}
                target="_blank"
                rel="noreferrer"
                dir="ltr"
              >
                {store.url}
              </a>
            )}
            <Button size="sm" variant="secondary" onClick={copy}>
              {copied ? t('online.copied') : t('online.copyLink')}
            </Button>
          </p>
        </div>
      </Section>
      <Section title={t('online.statusSection')} description={t('online.statusHint')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div data-field="status">
            <Field label={t('online.storeStatus')} error={issues['status']}>
              {(p) => (
                <Select
                  {...p}
                  value={v.status}
                  onChange={(e) => set({ status: e.target.value as SaveOnlineStore['status'] })}
                >
                  {(['draft', 'published', 'paused'] as const).map((s) => (
                    <option key={s} value={s}>
                      {t(`online.store_${s}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </div>
      </Section>
      <Section title={t('online.branding')}>
        <div className="grid gap-4 sm:grid-cols-2">
          {text('nameAr', t('online.nameAr'))}
          {text('nameEn', t('online.nameEn'), { dir: 'ltr' })}
          {text('taglineAr', t('online.taglineAr'))}
          {text('taglineEn', t('online.taglineEn'), { dir: 'ltr' })}
          {text('announcementAr', t('online.announcementAr'))}
          {text('announcementEn', t('online.announcementEn'), { dir: 'ltr' })}
          <Field label={t('online.color')}>
            {(p) => (
              <Input
                {...p}
                type="color"
                className="h-10 w-20 p-1"
                value={v.primaryColor}
                onChange={(e) => set({ primaryColor: e.target.value })}
              />
            )}
          </Field>
          {text('contactPhone', t('online.contactPhone'), { dir: 'ltr' })}
          {text('contactEmail', t('online.contactEmail'), { dir: 'ltr' })}
        </div>
      </Section>
      <Section title={t('online.fulfillmentSection')} description={t('online.fulfillmentHint')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div data-field="fulfillmentBranchId">
            <Field label={t('online.branch')} error={issues['fulfillmentBranchId']}>
              {(p) => (
                <Select
                  {...p}
                  value={v.fulfillmentBranchId ?? ''}
                  onChange={(e) => set({ fulfillmentBranchId: e.target.value || null })}
                >
                  <option value="">—</option>
                  {branches
                    .filter((b) => b.status === 'active')
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {localizedName(b, i18n.language)}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          </div>
          <div data-field="reservationMinutes">
            <Field
              label={t('online.reservationMinutes')}
              hint={t('online.reservationHint')}
              error={issues['reservationMinutes']}
            >
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={5}
                  max={1440}
                  dir="ltr"
                  value={String(v.reservationMinutes)}
                  onChange={(e) => set({ reservationMinutes: Number(e.target.value) })}
                />
              )}
            </Field>
          </div>
          <Checkbox
            data-field="pickupEnabled"
            label={t('online.pickup')}
            description={
              issues['pickupEnabled'] ? (
                <span className="text-danger">{issues['pickupEnabled']}</span>
              ) : undefined
            }
            checked={v.pickupEnabled}
            onChange={(e) => set({ pickupEnabled: e.target.checked })}
          />
          <Checkbox
            label={t('online.delivery')}
            checked={v.deliveryEnabled}
            onChange={(e) => set({ deliveryEnabled: e.target.checked })}
          />
          {text('deliveryFee', t('online.deliveryFee'), { dir: 'ltr' })}
          {text('minimumOrder', t('online.minimumOrder'), { dir: 'ltr' })}
        </div>
      </Section>
      <Section title={t('online.paymentsSection')} description={t('online.paymentsHint')}>
        <Checkbox
          label={t('online.payOnReceipt')}
          description={t('online.payOnReceiptHint')}
          checked={v.payOnReceiptEnabled}
          onChange={(e) => set({ payOnReceiptEnabled: e.target.checked })}
        />
        {store.paymentMethods.length === 0 ? (
          <p className="mt-3 text-sm text-fg-muted">{t('online.noPaymentMethods')}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {store.paymentMethods.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                {localizedName(m, i18n.language)} ({m.provider})
                <Badge tone={m.ready ? 'success' : 'warning'}>
                  {m.ready ? t('online.gatewayReady') : t('online.gatewayNotConnected')}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {!v.payOnReceiptEnabled && ready.length === 0 ? (
          <Alert tone="warning" className="mt-2">
            {t('online.noPaymentOption')}
          </Alert>
        ) : null}
        <p className="mt-2 text-sm">
          <Link className="text-primary hover:underline" to="/payments">
            {t('online.managePayments')}
          </Link>
        </p>
      </Section>
      {Object.keys(issues).length > 0 ? (
        <Alert tone="danger" title={t('online.fixFields')}>
          <ul className="list-disc ps-5">
            {Object.entries(issues).map(([field, message]) => (
              <li key={field}>
                {FIELD_LABELS[field] ?? field}: {message}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <div>
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- listings
function ProductsTab() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const listings = useQuery({
    queryKey: [...key, 'listings'],
    queryFn: () => api.online.listings(),
  });
  const save = useMutation({
    mutationFn: (listed: boolean) => api.online.setListings({ productIds: [...selected], listed }),
    onSuccess: async () => {
      setSelected(new Set());
      await queryClient.invalidateQueries({ queryKey: key });
      notify.ok(t('common.saved'));
    },
    onError: notify.fail,
  });
  const term = search.trim().toLowerCase();
  const rows = listings.data?.products.filter(
    (p) => !term || `${p.nameEn ?? ''} ${p.nameAr ?? ''}`.toLowerCase().includes(term),
  );
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-muted">{t('online.productsHint')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          type="search"
          aria-label={t('online.searchProducts')}
          placeholder={t('online.searchProducts')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button
          disabled={selected.size === 0}
          loading={save.isPending && save.variables}
          onClick={() => save.mutate(true)}
        >
          {t('online.list', { count: selected.size })}
        </Button>
        <Button
          variant="secondary"
          disabled={selected.size === 0}
          loading={save.isPending && !save.variables}
          onClick={() => save.mutate(false)}
        >
          {t('online.unlist', { count: selected.size })}
        </Button>
      </div>
      <DataTable
        caption={t('online.tabProducts')}
        loading={listings.isPending}
        error={
          listings.isError ? (
            <ErrorState error={listings.error} onRetry={() => void listings.refetch()} />
          ) : null
        }
        rows={rows}
        rowKey={(p) => p.productId}
        empty={t('online.noProducts')}
        columns={[
          {
            key: 'select',
            header: <span className="sr-only">{t('online.select')}</span>,
            cell: (p) => (
              <input
                type="checkbox"
                className="size-4 accent-primary"
                aria-label={localizedName(p, i18n.language)}
                checked={selected.has(p.productId)}
                onChange={() => toggle(p.productId)}
              />
            ),
          },
          {
            key: 'name',
            header: t('online.product'),
            cell: (p) => localizedName(p, i18n.language),
          },
          {
            key: 'price',
            header: t('sales.unitPrice'),
            hideBelow: 'sm',
            cell: (p) => (
              <span dir="ltr" className="tabular-nums">
                {formatAmount(p.price, i18n.language)}
              </span>
            ),
          },
          {
            key: 'listed',
            header: t('online.listed'),
            cell: (p) =>
              p.listed ? (
                <Badge tone="success">{t('online.listedYes')}</Badge>
              ) : (
                <Badge>{t('online.listedNo')}</Badge>
              ),
          },
        ]}
      />
    </div>
  );
}
