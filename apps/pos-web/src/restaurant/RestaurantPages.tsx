import type {
  ModifierGroup,
  OrderSummary,
  PosCatalogItem,
  RestaurantOrder,
  RestaurantOrderItem,
} from '@arabat/contracts';
import { Money, parseQuantity } from '@arabat/money';
import { Alert, Badge, Button, Dialog, Field, Input, Spinner, Textarea, cn } from '@arabat/ui';
import { localizedName, useApi, useAuth, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { shiftKey } from '../pages/ShiftPages.js';
import { PaymentDialog, ReceiptDialog } from '../sale/dialogs.js';
import { availabilityKey, catalogKey, itemLabel, useMoneyFormat } from '../sale/SalePage.js';

export const floorKey = ['pos', 'restaurant', 'floor'] as const;
const orderKey = (id: string) => ['pos', 'restaurant', 'order', id] as const;
const QTY = /^\d{1,6}(\.\d{1,3})?$/;

/** Whether the restaurant screens apply to this user (module on + permission). */
export function useRestaurantEnabled() {
  const api = useApi();
  const { hasPermission } = useAuth();
  const allowed = hasPermission('restaurant.orders') || hasPermission('kitchen.access');
  const settings = useQuery({
    queryKey: ['pos', 'restaurant', 'settings'],
    queryFn: () => api.restaurant.posSettings(),
    enabled: allowed,
    staleTime: 60_000,
  });
  return allowed && settings.data?.enabled === true;
}

const STATUS_TONE = {
  pending: 'neutral',
  queued: 'warning',
  preparing: 'warning',
  ready: 'success',
  served: 'primary',
  cancelled: 'danger',
} as const;

function OrderBadges({ o }: { o: OrderSummary }) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-wrap gap-1">
      {o.pending ? (
        <Badge tone="neutral">{t('restaurant.notSent', { count: o.pending })}</Badge>
      ) : null}
      {o.inKitchen ? (
        <Badge tone="warning">{t('restaurant.inKitchen', { count: o.inKitchen })}</Badge>
      ) : null}
      {o.ready ? (
        <Badge tone="success">{t('restaurant.readyCount', { count: o.ready })}</Badge>
      ) : null}
    </span>
  );
}

/** Tables by area plus the takeaway/pickup queue. */
export function FloorPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const navigate = useNavigate();
  const fmt = useMoneyFormat();
  const floor = useQuery({
    queryKey: floorKey,
    queryFn: () => api.restaurant.floor(),
    refetchInterval: 10_000,
  });
  const [newOrder, setNewOrder] = useState<'takeaway' | 'pickup' | null>(null);
  const [label, setLabel] = useState('');
  const open = useMutation({
    mutationFn: (body: Parameters<typeof api.restaurant.open>[0]) => api.restaurant.open(body),
    onSuccess: (o) => void navigate(`/tables/orders/${o.id}`),
    onError: notify.fail,
  });
  if (floor.error)
    return (
      <div className="p-6">
        <Alert tone="warning">{t('restaurant.unavailable')}</Alert>
      </div>
    );
  if (!floor.data)
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface px-4 py-2">
        <h1 className="text-lg font-semibold">{t('restaurant.floor')}</h1>
        <div className="flex-1" />
        <Button onClick={() => setNewOrder('takeaway')}>{t('restaurant.newTakeaway')}</Button>
        <Button variant="secondary" onClick={() => setNewOrder('pickup')}>
          {t('restaurant.newPickup')}
        </Button>
        <Link to="/" className="rounded-md border border-border px-3 py-1.5 text-sm font-medium">
          {t('restaurant.retailSale')}
        </Link>
      </div>
      {floor.data.areas.length === 0 ? <Alert tone="info">{t('restaurant.noTables')}</Alert> : null}
      {floor.data.areas.map((area) => (
        <section
          key={area.id}
          className="rounded-lg bg-surface p-3"
          aria-label={localizedName(area, i18n.language)}
        >
          <h2 className="mb-2 font-semibold">{localizedName(area, i18n.language)}</h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {area.tables.map((table) => (
              <li key={table.id}>
                <button
                  type="button"
                  data-testid="table-tile"
                  aria-label={`${t('restaurant.table')} ${table.code}`}
                  disabled={open.isPending}
                  onClick={() =>
                    table.order
                      ? void navigate(`/tables/orders/${table.order.id}`)
                      : open.mutate({ orderType: 'dine_in', tableId: table.id })
                  }
                  className={cn(
                    'flex h-28 w-full flex-col justify-between rounded-lg border-2 p-3 text-start',
                    table.order
                      ? 'border-primary bg-primary-soft'
                      : 'border-border hover:border-primary',
                  )}
                >
                  <span className="flex items-center justify-between">
                    <span className="text-xl font-semibold" dir="ltr">
                      {table.code}
                    </span>
                    <span className="text-xs text-fg-muted">
                      {t('restaurant.seats', { count: table.seats })}
                    </span>
                  </span>
                  {table.order ? (
                    <span className="grid gap-1">
                      <span className="font-semibold tabular-nums" dir="ltr">
                        {fmt(table.order.due)}
                      </span>
                      <OrderBadges o={table.order} />
                    </span>
                  ) : (
                    <span className="text-sm text-fg-muted">{t('restaurant.free')}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="rounded-lg bg-surface p-3" aria-label={t('restaurant.queue')}>
        <h2 className="mb-2 font-semibold">{t('restaurant.queue')}</h2>
        {floor.data.queue.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('restaurant.noQueue')}</p>
        ) : null}
        <ul className="divide-y divide-border">
          {floor.data.queue.map((o) => (
            <li key={o.id}>
              <Link
                to={`/tables/orders/${o.id}`}
                className="flex items-center justify-between gap-3 py-2"
                data-testid="queue-order"
              >
                <span>
                  <span className="font-medium" dir="ltr">
                    {o.number}
                  </span>{' '}
                  · {t(`restaurant.type_${o.orderType}`)}
                  {o.label ? ` · ${o.label}` : ''}
                </span>
                <span className="flex items-center gap-3">
                  <OrderBadges o={o} />
                  <span className="tabular-nums" dir="ltr">
                    {fmt(o.due)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {newOrder ? (
        <Dialog
          open
          onOpenChange={(o) => !o && setNewOrder(null)}
          title={newOrder === 'takeaway' ? t('restaurant.newTakeaway') : t('restaurant.newPickup')}
          footer={
            <Button
              loading={open.isPending}
              onClick={() => open.mutate({ orderType: newOrder, label: label.trim() || null })}
            >
              {t('restaurant.start')}
            </Button>
          }
        >
          <Field label={t('restaurant.customerName')}>
            {(p) => <Input {...p} value={label} onChange={(e) => setLabel(e.target.value)} />}
          </Field>
        </Dialog>
      ) : null}
    </div>
  );
}

function itemTitle(i: RestaurantOrderItem, language: string) {
  const base = localizedName(i, language);
  const v =
    i.variantNameEn || i.variantNameAr
      ? localizedName({ nameEn: i.variantNameEn, nameAr: i.variantNameAr }, language)
      : null;
  return v ? `${base} — ${v}` : base;
}

/** One order: add items (with modifiers), send to the kitchen, bills, move and merge. */
export function OrderPage() {
  const { orderId } = useParams();
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const fmt = useMoneyFormat();
  const order = useQuery({
    queryKey: orderKey(orderId!),
    queryFn: () => api.restaurant.order(orderId!),
    refetchInterval: 15_000,
  });
  const catalog = useQuery({
    queryKey: catalogKey,
    queryFn: () => api.catalog.posCatalog(),
    staleTime: 60_000,
  });
  const menu = useQuery({
    queryKey: ['pos', 'restaurant', 'menu'],
    queryFn: () => api.restaurant.posMenu(),
    staleTime: 60_000,
  });
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState<PosCatalogItem | null>(null);
  const [dialog, setDialog] = useState<'bill' | 'move' | 'merge' | null>(null);
  const [cancelling, setCancelling] = useState<RestaurantOrderItem | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  /** The bill was just paid: its receipt prints by itself. */
  const [justPaid, setJustPaid] = useState(false);
  const update = (o: RestaurantOrder) => {
    queryClient.setQueryData(orderKey(o.id), o);
    void queryClient.invalidateQueries({ queryKey: floorKey });
  };
  const add = useMutation({
    mutationFn: (item: {
      variantId: string;
      quantity: string;
      modifierIds: string[];
      note: string | null;
    }) => api.restaurant.addItems(orderId!, { version: order.data!.version, items: [item] }),
    onSuccess: (o) => {
      update(o);
      setPicking(null);
    },
    onError: async (e) => {
      notify.fail(e);
      await order.refetch();
    },
  });
  const send = useMutation({
    mutationFn: () => api.restaurant.send(orderId!),
    onSuccess: (o) => {
      update(o);
      notify.ok(t('restaurant.sent'));
    },
    onError: notify.fail,
  });
  const cancelOrder = useMutation({
    mutationFn: () => api.restaurant.cancel(orderId!, order.data!.version),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: floorKey });
      void navigate('/tables');
    },
    onError: notify.fail,
  });
  const groupsFor = (productId: string): ModifierGroup[] =>
    (menu.data?.productGroups[productId] ?? []).flatMap(
      (id) => menu.data?.groups.filter((g) => g.id === id) ?? [],
    );
  const term = search.trim().toLowerCase();
  const visible = (catalog.data?.items ?? []).filter(
    (i) =>
      !term ||
      itemLabel(i, i18n.language).toLowerCase().includes(term) ||
      (i.sku ?? '').toLowerCase().includes(term),
  );
  const o = order.data;
  if (!o)
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  const openOrder = o.status === 'open';
  const unpaid = o.items.filter((i) => !i.saleId && i.kitchenStatus !== 'cancelled');
  const nothingSent = o.items.every(
    (i) => i.kitchenStatus === 'pending' || i.kitchenStatus === 'cancelled',
  );
  return (
    <div className="grid h-full min-h-0 gap-3 p-3 md:grid-cols-[1fr_26rem]">
      <section
        className="flex min-h-0 flex-col gap-3 rounded-lg bg-surface p-3"
        aria-label={t('restaurant.menu')}
      >
        <input
          type="search"
          aria-label={t('restaurant.searchMenu')}
          placeholder={t('restaurant.searchMenu')}
          className="h-12 w-full rounded-lg border border-border bg-surface px-4 outline-none focus:border-primary"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={!openOrder}
        />
        <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((item) => (
            <li key={item.variantId}>
              <button
                type="button"
                disabled={!openOrder || add.isPending}
                data-testid="menu-tile"
                onClick={() =>
                  groupsFor(item.productId).length
                    ? setPicking(item)
                    : add.mutate({
                        variantId: item.variantId,
                        quantity: '1',
                        modifierIds: [],
                        note: null,
                      })
                }
                className="flex h-24 w-full flex-col justify-between rounded-lg border border-border p-3 text-start hover:border-primary disabled:opacity-50"
              >
                <span className="line-clamp-2 font-medium">{itemLabel(item, i18n.language)}</span>
                <span className="font-semibold tabular-nums" dir="ltr">
                  {fmt(item.price)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <aside
        className="flex min-h-0 flex-col rounded-lg bg-surface p-3"
        aria-label={t('restaurant.order')}
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold">
              <span dir="ltr">{o.number}</span> ·{' '}
              {o.tableCode
                ? `${t('restaurant.table')} ${o.tableCode}`
                : t(`restaurant.type_${o.orderType}`)}
            </h1>
            <p className="text-sm text-fg-muted">
              {o.label ? `${o.label} · ` : ''}
              {o.openedBy}
              {!openOrder ? ` · ${t(`restaurant.status_${o.status}`)}` : ''}
            </p>
          </div>
          <Link to="/tables" className="text-sm text-primary">
            {t('restaurant.backToFloor')}
          </Link>
        </div>
        <ul
          className="min-h-0 flex-1 divide-y divide-border overflow-y-auto"
          aria-label={t('restaurant.items')}
        >
          {o.items.map((item) => (
            <li key={item.id} data-testid="order-item">
              <button
                type="button"
                className={cn(
                  'flex w-full items-start justify-between gap-2 py-2 text-start',
                  item.kitchenStatus === 'cancelled' && 'opacity-50 line-through',
                )}
                disabled={!openOrder || item.kitchenStatus === 'cancelled' || Boolean(item.saleId)}
                onClick={() => setCancelling(item)}
              >
                <span className="min-w-0">
                  <span className="block font-medium">{itemTitle(item, i18n.language)}</span>
                  {item.modifiers.length ? (
                    <span className="block text-sm text-fg-muted">
                      {item.modifiers.map((m) => localizedName(m, i18n.language)).join(', ')}
                    </span>
                  ) : null}
                  {item.note ? (
                    <span className="block text-sm italic text-fg-muted">“{item.note}”</span>
                  ) : null}
                  <span className="mt-1 flex flex-wrap gap-1">
                    <Badge tone={STATUS_TONE[item.kitchenStatus]}>
                      {t(`restaurant.kitchen_${item.kitchenStatus}`)}
                    </Badge>
                    {item.saleId ? <Badge tone="success">{t('restaurant.paid')}</Badge> : null}
                  </span>
                </span>
                <span className="shrink-0 text-end tabular-nums" dir="ltr">
                  <span className="block text-sm text-fg-muted">
                    {item.quantity.replace(/\.?0+$/, '')} × {item.unitPrice.amount}
                  </span>
                  <span className="font-semibold">{fmt(item.lineTotal)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <dl className="mt-2 grid gap-1 border-t border-border pt-2">
          <div className="flex justify-between text-sm">
            <dt>{t('restaurant.paidTotal')}</dt>
            <dd dir="ltr" className="tabular-nums">
              {fmt(o.paid)}
            </dd>
          </div>
          <div className="flex justify-between text-2xl font-semibold">
            <dt>{t('restaurant.due')}</dt>
            <dd dir="ltr" className="tabular-nums" data-testid="order-due">
              {fmt(o.due)}
            </dd>
          </div>
        </dl>
        {openOrder ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                disabled={o.pending === 0}
                loading={send.isPending}
                onClick={() => send.mutate()}
              >
                {t('restaurant.sendToKitchen')}
              </Button>
              {o.orderType === 'dine_in' ? (
                <Button variant="secondary" onClick={() => setDialog('move')}>
                  {t('restaurant.moveTable')}
                </Button>
              ) : (
                <span />
              )}
              <Button variant="secondary" onClick={() => setDialog('merge')}>
                {t('restaurant.combine')}
              </Button>
              <Button
                variant="ghost"
                disabled={!nothingSent || o.bills.length > 0}
                loading={cancelOrder.isPending}
                onClick={() => cancelOrder.mutate()}
              >
                {t('restaurant.cancelOrder')}
              </Button>
            </div>
            <Button
              size="lg"
              className="mt-2 h-14 text-lg"
              disabled={unpaid.length === 0 || !hasPermission('sales.create')}
              onClick={() => setDialog('bill')}
            >
              {t('restaurant.payBill')}
            </Button>
          </>
        ) : null}
        {o.bills.length ? (
          <ul className="mt-2 text-sm" aria-label={t('restaurant.bills')}>
            {o.bills.map((b) => (
              <li key={b.saleId}>
                <button
                  type="button"
                  className="text-primary"
                  onClick={() => {
                    setJustPaid(false);
                    setReceiptId(b.saleId);
                  }}
                >
                  <span dir="ltr">{b.receiptNumber}</span> · <span dir="ltr">{fmt(b.total)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </aside>
      {picking ? (
        <ModifierDialog
          item={picking}
          groups={groupsFor(picking.productId)}
          pending={add.isPending}
          onClose={() => setPicking(null)}
          onAdd={(v) => add.mutate({ variantId: picking.variantId, ...v })}
        />
      ) : null}
      {cancelling ? (
        <CancelItemDialog
          order={o}
          item={cancelling}
          onClose={() => setCancelling(null)}
          onDone={(next) => {
            update(next);
            setCancelling(null);
          }}
        />
      ) : null}
      {dialog === 'bill' ? (
        <BillDialog
          order={o}
          onClose={() => setDialog(null)}
          onPaid={(next, saleId) => {
            update(next);
            setDialog(null);
            setJustPaid(true);
            setReceiptId(saleId);
          }}
        />
      ) : null}
      {dialog === 'move' || dialog === 'merge' ? (
        <MoveDialog
          mode={dialog}
          order={o}
          onClose={() => setDialog(null)}
          onDone={(next) => {
            update(next);
            setDialog(null);
          }}
        />
      ) : null}
      {receiptId ? (
        <ReceiptDialog saleId={receiptId} autoPrint={justPaid} onClose={() => setReceiptId(null)} />
      ) : null}
    </div>
  );
}

function ModifierDialog({
  item,
  groups,
  pending,
  onClose,
  onAdd,
}: {
  item: PosCatalogItem;
  groups: ModifierGroup[];
  pending: boolean;
  onClose: () => void;
  onAdd: (v: { quantity: string; modifierIds: string[]; note: string | null }) => void;
}) {
  const { t, i18n } = useTranslation();
  const fmt = useMoneyFormat();
  const [chosen, setChosen] = useState<string[]>([]);
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const toggle = (g: ModifierGroup, id: string) =>
    setChosen((c) => {
      if (c.includes(id)) return c.filter((x) => x !== id);
      const inGroup = c.filter((x) => g.modifiers.some((m) => m.id === x));
      if (g.maxSelect === 1) return [...c.filter((x) => !inGroup.includes(x)), id];
      return inGroup.length >= g.maxSelect ? c : [...c, id];
    });
  const valid =
    QTY.test(quantity.trim()) &&
    parseQuantity(quantity.trim()) > 0n &&
    groups.every((g) => {
      const n = g.modifiers.filter((m) => chosen.includes(m.id)).length;
      return n >= g.minSelect && n <= g.maxSelect;
    });
  const unit =
    Money.parse(item.price.amount, 'KWD').minor +
    groups
      .flatMap((g) => g.modifiers)
      .filter((m) => chosen.includes(m.id))
      .reduce((s, m) => s + Money.parse(m.price.amount, 'KWD').minor, 0n);
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title={itemLabel(item, i18n.language)}
      footer={
        <Button
          disabled={!valid}
          loading={pending}
          onClick={() =>
            onAdd({ quantity: quantity.trim(), modifierIds: chosen, note: note.trim() || null })
          }
        >
          {t('restaurant.addItem')} · <span dir="ltr">{fmt(unit)}</span>
        </Button>
      }
    >
      <div className="grid gap-4">
        {groups.map((g) => (
          <fieldset key={g.id} className="grid gap-2">
            <legend className="mb-1 font-medium">
              {localizedName(g, i18n.language)}{' '}
              <span className="text-sm text-fg-muted">
                {g.minSelect > 0 ? t('restaurant.required') : t('restaurant.optional')}
                {g.maxSelect > 1 ? ` · ${t('restaurant.upTo', { count: g.maxSelect })}` : ''}
              </span>
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {g.modifiers.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={chosen.includes(m.id)}
                  onClick={() => toggle(g, m.id)}
                  className="flex h-12 items-center justify-between rounded-lg border-2 border-border px-3 aria-pressed:border-primary aria-pressed:bg-primary-soft"
                >
                  <span>{localizedName(m, i18n.language)}</span>
                  {m.price.amount !== '0.000' ? (
                    <span className="text-sm tabular-nums" dir="ltr">
                      +{m.price.amount}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <Field label={t('restaurant.quantity')}>
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('restaurant.note')}>
            {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

function CancelItemDialog({
  order,
  item,
  onClose,
  onDone,
}: {
  order: RestaurantOrder;
  item: RestaurantOrderItem;
  onClose: () => void;
  onDone: (o: RestaurantOrder) => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const sent = item.kitchenStatus !== 'pending';
  const [reason, setReason] = useState('');
  const [waste, setWaste] = useState(sent);
  const run = useMutation({
    mutationFn: () =>
      api.restaurant.cancelItem(order.id, item.id, { reason: reason.trim(), waste: sent && waste }),
    onSuccess: onDone,
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${t('restaurant.cancelItem')}: ${itemTitle(item, i18n.language)}`}
      footer={
        <Button
          variant="danger"
          disabled={!reason.trim()}
          loading={run.isPending}
          onClick={() => run.mutate()}
        >
          {t('restaurant.cancelItem')}
        </Button>
      }
    >
      <div className="grid gap-3">
        {sent ? <Alert tone="warning">{t('restaurant.sentWarning')}</Alert> : null}
        <Field label={t('restaurant.reason')}>
          {(p) => (
            <Textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          )}
        </Field>
        {sent ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={waste} onChange={(e) => setWaste(e.target.checked)} />
            {t('restaurant.wasted')}
          </label>
        ) : null}
      </div>
    </Dialog>
  );
}

function BillDialog({
  order,
  onClose,
  onPaid,
}: {
  order: RestaurantOrder;
  onClose: () => void;
  onPaid: (o: RestaurantOrder, saleId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const fmt = useMoneyFormat();
  const unpaid = order.items.filter((i) => !i.saleId && i.kitchenStatus !== 'cancelled');
  const [selected, setSelected] = useState<string[]>(unpaid.map((i) => i.id));
  const [paying, setPaying] = useState(false);
  const paid = useRef<RestaurantOrder | null>(null);
  const quote = useQuery({
    queryKey: ['pos', 'restaurant', 'quote', order.id, selected],
    enabled: selected.length > 0,
    queryFn: () => api.restaurant.quote(order.id, { itemIds: selected }),
  });
  const total = quote.data ? Money.parse(quote.data.total.amount, 'KWD').minor : null;
  if (paying && total !== null)
    return (
      <PaymentDialog
        totalMinor={total}
        onClose={() => setPaying(false)}
        submit={async ({ idempotencyKey, payments }) => {
          const r = await api.restaurant.pay(order.id, {
            idempotencyKey,
            itemIds: selected,
            payments,
            expectedTotal: Money.ofMinor(total, 'KWD').toDecimalString(),
          });
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: availabilityKey }),
            queryClient.invalidateQueries({ queryKey: shiftKey }),
          ]);
          paid.current = r.order;
          return r.sale;
        }}
        onCompleted={(saleId) => onPaid(paid.current!, saleId)}
      />
    );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('restaurant.payBill')}
      footer={
        <Button disabled={total === null} onClick={() => setPaying(true)}>
          {t('restaurant.payAmount')} {total !== null ? <span dir="ltr">{fmt(total)}</span> : null}
        </Button>
      }
    >
      <p className="mb-2 text-sm text-fg-muted">{t('restaurant.splitHint')}</p>
      <ul className="divide-y divide-border">
        {unpaid.map((i) => (
          <li key={i.id}>
            <label className="flex items-center gap-3 py-2">
              <input
                type="checkbox"
                aria-label={itemTitle(i, i18n.language)}
                checked={selected.includes(i.id)}
                onChange={(e) =>
                  setSelected((s) =>
                    e.target.checked ? [...s, i.id] : s.filter((x) => x !== i.id),
                  )
                }
              />
              <span className="flex-1">
                {itemTitle(i, i18n.language)} × {i.quantity.replace(/\.?0+$/, '')}
              </span>
              <span className="tabular-nums" dir="ltr">
                {fmt(i.lineTotal)}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="mt-3 flex justify-between text-lg font-semibold">
        <span>{t('restaurant.billTotal')}</span>
        <span dir="ltr" data-testid="bill-total">
          {total !== null ? fmt(total) : '—'}
        </span>
      </p>
    </Dialog>
  );
}

function MoveDialog({
  mode,
  order,
  onClose,
  onDone,
}: {
  mode: 'move' | 'merge';
  order: RestaurantOrder;
  onClose: () => void;
  onDone: (o: RestaurantOrder) => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const floor = useQuery({ queryKey: floorKey, queryFn: () => api.restaurant.floor() });
  const tables = useMemo(() => floor.data?.areas.flatMap((a) => a.tables) ?? [], [floor.data]);
  const options =
    mode === 'move'
      ? tables
          .filter((x) => !x.order)
          .map((x) => ({ id: x.id, label: `${t('restaurant.table')} ${x.code}` }))
      : [
          ...tables
            .filter((x) => x.order && x.order.id !== order.id)
            .map((x) => ({
              id: x.order!.id,
              label: `${t('restaurant.table')} ${x.code} · ${x.order!.number}`,
            })),
          ...(floor.data?.queue ?? [])
            .filter((q) => q.id !== order.id)
            .map((q) => ({ id: q.id, label: `${q.number}${q.label ? ` · ${q.label}` : ''}` })),
        ];
  const run = useMutation({
    mutationFn: (target: string) =>
      mode === 'move'
        ? api.restaurant.move(order.id, { version: order.version, tableId: target })
        : api.restaurant.merge(order.id, { version: order.version, sourceOrderId: target }),
    onSuccess: onDone,
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={mode === 'move' ? t('restaurant.moveTable') : t('restaurant.combineInto')}
    >
      {mode === 'merge' ? (
        <p className="mb-2 text-sm text-fg-muted">{t('restaurant.combineHint')}</p>
      ) : null}
      {options.length === 0 ? (
        <p className="text-fg-muted">{t('restaurant.nothingToChoose')}</p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        {options.map((x) => (
          <Button
            key={x.id}
            variant="secondary"
            loading={run.isPending && run.variables === x.id}
            onClick={() => run.mutate(x.id)}
          >
            {x.label}
          </Button>
        ))}
      </div>
    </Dialog>
  );
}
