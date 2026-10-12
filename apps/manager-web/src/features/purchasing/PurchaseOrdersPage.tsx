import { PO_STATUSES, type PurchaseOrder, type PurchaseOrderStatus } from '@arabat/contracts';
import { Money, MoneyError, QuantityError, parseQuantity, quantityValue } from '@arabat/money';
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
import { localizedName, useApi, useNotify } from '@arabat/web-core';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useBranchContext, useBranchName, useSession } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';
import { Pager, displayQty, itemName } from '../inventory/shared.js';
import { ItemPicker } from './ItemPicker.js';
import { suppliersKey } from './SuppliersPage.js';

export const ordersKey = ['manager', 'purchase-orders'] as const;
const TONE: Record<PurchaseOrderStatus, 'neutral' | 'warning' | 'primary' | 'success' | 'danger'> =
  {
    draft: 'neutral',
    submitted: 'warning',
    approved: 'primary',
    partially_received: 'primary',
    received: 'success',
    cancelled: 'danger',
    closed: 'neutral',
  };
const QTY = /^\d{1,11}(\.\d{1,3})?$/;
const AMOUNT = /^\d{1,10}(\.\d{1,3})?$/;

function Amount({ value }: { value: { amount: string; currency: string } | null | undefined }) {
  const { i18n } = useTranslation();
  return (
    <span dir="ltr" className="tabular-nums">
      {formatAmount(value, i18n.language)}
    </span>
  );
}

export function StatusBadge({ status }: { status: PurchaseOrderStatus }) {
  const { t } = useTranslation();
  return <Badge tone={TONE[status]}>{t(`purchasing.status_${status}`)}</Badge>;
}

export function PurchaseOrdersPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const { can } = useSession();
  const { branchId } = useBranchContext();
  const branchName = useBranchName();
  const [params, setParams] = useSearchParams();
  const supplierId = params.get('supplierId') ?? '';
  const [status, setStatus] = useState<PurchaseOrderStatus | ''>('');
  const filterKey = JSON.stringify([status, supplierId, branchId]);
  const [paging, setPaging] = useState({ key: filterKey, page: 1 });
  const page = paging.key === filterKey ? paging.page : 1;
  const query = {
    page,
    pageSize: 25,
    ...(status ? { status } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(branchId ? { branchId } : {}),
  };
  const list = useQuery({
    queryKey: [...ordersKey, query],
    queryFn: () => api.purchasing.orders(query),
    placeholderData: keepPreviousData,
  });
  const suppliers = useQuery({ queryKey: suppliersKey, queryFn: () => api.purchasing.suppliers() });
  type Row = NonNullable<typeof list.data>['orders'][number];
  return (
    <div>
      <PageHeader
        title={t('purchasing.ordersTitle')}
        description={t('purchasing.ordersSubtitle')}
        actions={
          can('purchasing.manage') ? (
            <Button onClick={() => void navigate('/purchasing/new')}>
              {t('purchasing.newOrder')}
            </Button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          className="max-w-52"
          aria-label={t('purchasing.status')}
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="">{t('purchasing.allStatuses')}</option>
          {PO_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`purchasing.status_${s}`)}
            </option>
          ))}
        </Select>
        <Select
          className="max-w-52"
          aria-label={t('purchasing.supplier')}
          value={supplierId}
          onChange={(e) => {
            if (e.target.value) params.set('supplierId', e.target.value);
            else params.delete('supplierId');
            setParams(params);
          }}
        >
          <option value="">{t('purchasing.allSuppliers')}</option>
          {suppliers.data?.suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {localizedName(s, i18n.language)}
            </option>
          ))}
        </Select>
      </div>
      <DataTable<Row>
        caption={t('purchasing.ordersTitle')}
        loading={list.isPending}
        rows={list.data?.orders}
        rowKey={(o) => o.id}
        empty={t('purchasing.empty')}
        onRowClick={(o) => void navigate(`/purchasing/${o.id}`)}
        columns={[
          {
            key: 'number',
            header: t('purchasing.number'),
            cell: (o) => (
              <span dir="ltr" className="font-medium">
                {o.number}
              </span>
            ),
          },
          {
            key: 'supplier',
            header: t('purchasing.supplier'),
            cell: (o) => localizedName(o.supplierName, i18n.language),
          },
          {
            key: 'branch',
            header: t('purchasing.branch'),
            hideBelow: 'md',
            cell: (o) => branchName(o.branchId) ?? '—',
          },
          {
            key: 'date',
            header: t('inventory.date'),
            hideBelow: 'lg',
            cell: (o) => formatDateTime(o.createdAt, i18n.language),
          },
          { key: 'total', header: t('purchasing.total'), cell: (o) => <Amount value={o.total} /> },
          {
            key: 'received',
            header: t('purchasing.received'),
            hideBelow: 'sm',
            cell: (o) => <Amount value={o.receivedValue} />,
          },
          {
            key: 'status',
            header: t('purchasing.status'),
            cell: (o) => <StatusBadge status={o.status} />,
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
    </div>
  );
}

interface DraftLine {
  variantId: string;
  label: string;
  quantity: string;
  unitCost: string;
}

/** New order, draft editor and order detail with its workflow actions. */
export function PurchaseOrderPage() {
  const { orderId } = useParams();
  const api = useApi();
  const order = useQuery({
    queryKey: [...ordersKey, 'detail', orderId],
    enabled: Boolean(orderId),
    queryFn: () => api.purchasing.order(orderId!),
  });
  if (orderId && !order.data) return null;
  return (
    <OrderView
      key={order.data ? `${order.data.id}-${order.data.version}` : 'new'}
      order={order.data ?? null}
    />
  );
}

function OrderView({ order }: { order: PurchaseOrder | null }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const context = useBranchContext();
  const branchName = useBranchName();
  const suppliers = useQuery({ queryKey: suppliersKey, queryFn: () => api.purchasing.suppliers() });
  const editable = !order || (order.status === 'draft' && can('purchasing.manage'));
  const [supplierId, setSupplierId] = useState(order?.supplierId ?? '');
  const [branchId, setBranchId] = useState(
    order?.branchId ?? context.branchId ?? context.branches[0]?.id ?? '',
  );
  const [expectedDate, setExpectedDate] = useState(order?.expectedDate ?? '');
  const [note, setNote] = useState(order?.note ?? '');
  const [lines, setLines] = useState<DraftLine[]>(
    order?.lines.map((l) => ({
      variantId: l.variantId,
      label: itemName(l, i18n.language),
      quantity: displayQty(l.quantity),
      unitCost: l.unitCost.amount,
    })) ?? [],
  );
  const [receiving, setReceiving] = useState(false);
  const [closing, setClosing] = useState(false);

  const lineTotal = (l: DraftLine) => {
    try {
      if (!QTY.test(l.quantity.trim()) || !AMOUNT.test(l.unitCost.trim())) return null;
      return quantityValue(
        parseQuantity(l.quantity.trim()),
        Money.parse(l.unitCost.trim(), 'KWD').minor,
      );
    } catch (error) {
      if (error instanceof QuantityError || error instanceof MoneyError) return null;
      throw error;
    }
  };
  const totals = lines.map(lineTotal);
  const valid =
    Boolean(supplierId && branchId) &&
    lines.length > 0 &&
    totals.every((x) => x !== null) &&
    lines.every((l) => parseQuantity(l.quantity.trim()) > 0n);
  const total = totals.reduce<bigint>((s, x) => s + (x ?? 0n), 0n);

  const done = async (o: PurchaseOrder, message: string) => {
    await queryClient.invalidateQueries({ queryKey: ordersKey });
    notify.ok(message);
    if (!order) void navigate(`/purchasing/${o.id}`, { replace: true });
  };
  const save = useMutation({
    mutationFn: () => {
      const body = {
        supplierId,
        branchId,
        expectedDate: expectedDate || null,
        note: note.trim() || null,
        lines: lines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity.trim(),
          unitCost: l.unitCost.trim(),
        })),
      };
      return order
        ? api.purchasing.updateOrder(order.id, { ...body, version: order.version })
        : api.purchasing.createOrder(body);
    },
    onSuccess: (o) => done(o, t('purchasing.saved')),
    onError: notify.fail,
  });
  const action = useMutation({
    mutationFn: (a: { kind: 'submit' | 'approve' | 'cancel' | 'close'; reason?: string }) =>
      api.purchasing.orderAction(order!.id, a.kind, {
        version: order!.version,
        reason: a.reason ?? null,
      }),
    onSuccess: (o) => done(o, t('common.saved')),
    onError: notify.fail,
  });

  return (
    <div>
      <PageHeader
        title={order ? `${t('purchasing.ordersTitle')} ${order.number}` : t('purchasing.newOrder')}
        description={order ? undefined : t('purchasing.ordersSubtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {order ? <StatusBadge status={order.status} /> : null}
            {order?.status === 'draft' && can('purchasing.manage') ? (
              <Button
                variant="secondary"
                loading={action.isPending}
                onClick={() => action.mutate({ kind: 'submit' })}
              >
                {t('purchasing.submit')}
              </Button>
            ) : null}
            {order?.status === 'submitted' && can('purchasing.approve') ? (
              <Button loading={action.isPending} onClick={() => action.mutate({ kind: 'approve' })}>
                {t('purchasing.approve')}
              </Button>
            ) : null}
            {order &&
            ['approved', 'partially_received'].includes(order.status) &&
            can('purchasing.receive') ? (
              <Button onClick={() => setReceiving(true)}>{t('purchasing.receive')}</Button>
            ) : null}
            {order?.status === 'partially_received' && can('purchasing.approve') ? (
              <Button variant="secondary" onClick={() => setClosing(true)}>
                {t('purchasing.close')}
              </Button>
            ) : null}
            {order && ['draft', 'submitted', 'approved'].includes(order.status) ? (
              <Button
                variant="ghost"
                loading={action.isPending}
                onClick={() => action.mutate({ kind: 'cancel' })}
              >
                {t('purchasing.cancel')}
              </Button>
            ) : null}
            <Link className="text-sm text-primary" to="/purchasing">
              {t('common.back')}
            </Link>
          </div>
        }
      />
      {suppliers.data && suppliers.data.suppliers.length === 0 ? (
        <Alert tone="warning">{t('purchasing.noSuppliers')}</Alert>
      ) : null}
      <div className="grid gap-6">
        <Section title={t('purchasing.supplier')}>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label={t('purchasing.supplier')}>
              {(p) => (
                <Select
                  {...p}
                  disabled={!editable}
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                >
                  <option value="" />
                  {suppliers.data?.suppliers
                    .filter((s) => s.status === 'active' || s.id === supplierId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {localizedName(s, i18n.language)}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field label={t('purchasing.branch')}>
              {(p) => (
                <Select
                  {...p}
                  disabled={!editable}
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                >
                  {context.branches
                    .filter((b) => b.status === 'active' || b.id === branchId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {localizedName(b, i18n.language)}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field label={t('purchasing.expectedDate')}>
              {(p) => (
                <Input
                  {...p}
                  type="date"
                  disabled={!editable}
                  value={expectedDate}
                  onChange={(e) => setExpectedDate(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('purchasing.note')} className="md:col-span-3">
              {(p) => (
                <Textarea
                  {...p}
                  rows={2}
                  disabled={!editable}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </Field>
          </div>
          {order ? (
            <p className="mt-3 text-sm text-fg-muted">
              {t('purchasing.createdBy')}: {order.createdBy}
              {order.approvedBy ? ` · ${t('purchasing.approvedBy')}: ${order.approvedBy}` : ''}
              {order.closeReason ? ` · ${order.closeReason}` : ''}
            </p>
          ) : null}
        </Section>

        <Section title={t('purchasing.item')}>
          {editable ? (
            <div className="mb-3">
              <ItemPicker
                branchId={branchId}
                label={t('purchasing.searchItem')}
                onPick={(item) =>
                  setLines((ls) =>
                    ls.some((l) => l.variantId === item.variantId)
                      ? ls
                      : [
                          ...ls,
                          {
                            variantId: item.variantId,
                            label: itemName(item, i18n.language),
                            quantity: '1',
                            unitCost: item.avgCost?.amount ?? '0.000',
                          },
                        ],
                  )
                }
              />
            </div>
          ) : null}
          <ul className="divide-y divide-border">
            {lines.map((l, i) => {
              const line = order?.lines[i];
              return (
                <li
                  key={l.variantId}
                  className="grid items-end gap-3 py-2 sm:grid-cols-[1fr_7rem_8rem_7rem_auto]"
                  data-testid="po-line"
                >
                  <span className="font-medium">{l.label}</span>
                  <Field label={t('purchasing.ordered')}>
                    {(p) => (
                      <Input
                        {...p}
                        dir="ltr"
                        inputMode="decimal"
                        disabled={!editable}
                        value={l.quantity}
                        onChange={(e) =>
                          setLines((ls) =>
                            ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)),
                          )
                        }
                      />
                    )}
                  </Field>
                  <Field label={t('purchasing.unitCost')}>
                    {(p) => (
                      <Input
                        {...p}
                        dir="ltr"
                        inputMode="decimal"
                        disabled={!editable}
                        value={l.unitCost}
                        onChange={(e) =>
                          setLines((ls) =>
                            ls.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)),
                          )
                        }
                      />
                    )}
                  </Field>
                  <span className="text-sm">
                    <span className="block text-xs text-fg-muted">
                      {line ? t('purchasing.received') : t('purchasing.lineTotal')}
                    </span>
                    <span dir="ltr" className="tabular-nums">
                      {line
                        ? `${displayQty(line.receivedQuantity)} / ${displayQty(line.quantity)}`
                        : totals[i] !== null
                          ? Money.ofMinor(totals[i]!, 'KWD').toDecimalString()
                          : '—'}
                    </span>
                  </span>
                  {editable ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    >
                      {t('inventory.remove')}
                    </Button>
                  ) : (
                    <span />
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-end text-lg font-semibold" dir="ltr" data-testid="po-total">
            {formatAmount(
              order && !editable ? order.total : Money.ofMinor(total, 'KWD').toJSON(),
              i18n.language,
            )}
          </p>
          {editable ? (
            <div className="mt-3 flex justify-end">
              <Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
                {t('purchasing.save')}
              </Button>
            </div>
          ) : null}
        </Section>

        {order ? (
          <Section title={t('purchasing.receipts')}>
            {order.receipts.length === 0 ? (
              <p className="text-sm text-fg-muted">{t('purchasing.noReceipts')}</p>
            ) : null}
            <ul className="divide-y divide-border text-sm">
              {order.receipts.map((r) => (
                <li key={r.id} className="py-2">
                  <span className="font-medium" dir="ltr">
                    {r.number}
                  </span>{' '}
                  · {formatDateTime(r.createdAt, i18n.language)} · {r.receivedBy}
                  {r.supplierReference ? <span dir="ltr"> · {r.supplierReference}</span> : null}
                  <span className="block text-fg-muted">
                    {r.lines
                      .map(
                        (l) =>
                          `${order.lines[l.position] ? itemName(order.lines[l.position]!, i18n.language) : ''} × ${displayQty(l.quantity)}`,
                      )
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm">
              {t('purchasing.received')}: <Amount value={order.receivedValue} /> ·{' '}
              {branchName(order.branchId)}
            </p>
          </Section>
        ) : null}
      </div>
      {receiving && order ? (
        <ReceiveDialog order={order} onClose={() => setReceiving(false)} />
      ) : null}
      {closing && order ? (
        <CloseDialog
          onClose={() => setClosing(false)}
          onConfirm={(reason) => {
            setClosing(false);
            action.mutate({ kind: 'close', reason });
          }}
        />
      ) : null}
    </div>
  );
}

function ReceiveDialog({ order, onClose }: { order: PurchaseOrder; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [qty, setQty] = useState<Record<number, string>>(
    Object.fromEntries(order.lines.map((l) => [l.position, displayQty(l.remainingQuantity)])),
  );
  const [reference, setReference] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const lines = order.lines
    .map((l) => ({ position: l.position, quantity: (qty[l.position] ?? '').trim() }))
    .filter((l) => QTY.test(l.quantity) && parseQuantity(l.quantity) > 0n);
  const receive = useMutation({
    mutationFn: () =>
      api.purchasing.receive(order.id, {
        idempotencyKey: key,
        supplierReference: reference.trim() || null,
        lines,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersKey });
      notify.ok(t('purchasing.receiptPosted'));
      onClose();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title={`${t('purchasing.receiveTitle')} — ${order.number}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={lines.length === 0}
            loading={receive.isPending}
            onClick={() => receive.mutate()}
          >
            {t('purchasing.receive')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {order.lines.map((l) => (
          <div
            key={l.position}
            className="grid items-end gap-3 sm:grid-cols-[1fr_6rem_8rem]"
            data-testid="receive-line"
          >
            <span>{itemName(l, i18n.language)}</span>
            <span className="text-sm">
              <span className="block text-xs text-fg-muted">{t('purchasing.remaining')}</span>
              <span dir="ltr">{displayQty(l.remainingQuantity)}</span>
            </span>
            <Field label={t('purchasing.receiveNow')}>
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  inputMode="decimal"
                  value={qty[l.position] ?? ''}
                  onChange={(e) => setQty((q) => ({ ...q, [l.position]: e.target.value }))}
                />
              )}
            </Field>
          </div>
        ))}
        <Field label={t('purchasing.supplierReference')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function CloseDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('purchasing.close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
            {t('purchasing.close')}
          </Button>
        </>
      }
    >
      <Field label={t('purchasing.closeReason')}>
        {(p) => (
          <Textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        )}
      </Field>
    </Dialog>
  );
}
