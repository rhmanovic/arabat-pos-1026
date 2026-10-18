import type {
  OnlineOrder,
  OnlineOrderStatus,
  OnlineStore,
  SaveOnlineStore,
} from '@arabat/contracts';
import { ONLINE_ORDER_STATUSES } from '@arabat/contracts';
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
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useBranchContext, useBranchName, useSession } from '../../app/context.js';
import { CashTabs } from '../cash/shared.js';
import { formatAmount } from '../catalog/ProductsPage.js';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';
import { Pager } from '../inventory/shared.js';

const key = ['manager', 'online'] as const;
type Tab = 'orders' | 'settings' | 'products';
type Action = 'preparing' | 'ready' | 'out_for_delivery' | 'completed' | 'cancel';

export const ORDER_TONE: Record<
  OnlineOrderStatus,
  'primary' | 'success' | 'warning' | 'danger' | 'neutral'
> = {
  pending_payment: 'neutral',
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

/** Actions offered for an order; the API re-checks every transition (BR-146). */
export function nextActions(order: Pick<OnlineOrder, 'status' | 'fulfillment'>): Action[] {
  const forward: Record<string, Action[]> = {
    paid: ['preparing', 'ready', 'out_for_delivery', 'completed'],
    preparing: ['ready', 'out_for_delivery', 'completed'],
    ready: ['completed'],
    out_for_delivery: ['completed'],
    pending_payment: ['cancel'],
    needs_attention: ['cancel'],
  };
  return (forward[order.status] ?? []).filter(
    (a) =>
      !(a === 'ready' && order.fulfillment !== 'pickup') &&
      !(a === 'out_for_delivery' && order.fulfillment !== 'delivery'),
  );
}

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
              <Badge tone={ORDER_TONE[o.status]}>{t(`online.status_${o.status}`)}</Badge>
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
  const order = useQuery({ queryKey: [...key, 'order', id], queryFn: () => api.online.order(id) });
  const act = useMutation({
    mutationFn: (action: Action) =>
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
                onClick={() => act.mutate(a)}
              >
                {t(`online.action_${a}`)}
              </Button>
            ))}
          </>
        ) : undefined
      }
    >
      {o ? (
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ORDER_TONE[o.status]}>{t(`online.status_${o.status}`)}</Badge>
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
            <dd>{localizedName(o.paymentMethod, i18n.language)}</dd>
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
    version: s.version,
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
  const save = useMutation({
    mutationFn: () => api.online.saveStore(v),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      notify.ok(t('common.saved'));
    },
    onError: notify.fail,
  });
  const text = (field: keyof SaveOnlineStore, label: string, props: { dir?: 'ltr' } = {}) => (
    <Field label={label}>
      {(p) => (
        <Input
          {...p}
          {...props}
          value={(v[field] as string | null | undefined) ?? ''}
          onChange={(e) => set({ [field]: e.target.value } as Partial<SaveOnlineStore>)}
        />
      )}
    </Field>
  );
  const ready = store.paymentMethods.filter((m) => m.ready);
  return (
    <div className="flex flex-col gap-4">
      <Section title={t('online.statusSection')} description={t('online.statusHint')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('online.storeStatus')}>
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
          {text('slug', t('online.slug'), { dir: 'ltr' })}
          <p className="text-sm sm:col-span-2">
            {t('online.address')}:{' '}
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
          </p>
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
          <Field label={t('online.branch')}>
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
          <Field label={t('online.reservationMinutes')} hint={t('online.reservationHint')}>
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
          <Checkbox
            label={t('online.pickup')}
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
      <Section title={t('online.paymentsSection')}>
        {store.paymentMethods.length === 0 ? (
          <Alert tone="warning">{t('online.noPaymentMethods')}</Alert>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
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
        {ready.length === 0 ? (
          <p className="mt-2 text-sm text-fg-muted">{t('online.publishNeedsGateway')}</p>
        ) : null}
        <p className="mt-2 text-sm">
          <Link className="text-primary hover:underline" to="/payments">
            {t('online.managePayments')}
          </Link>
        </p>
      </Section>
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
