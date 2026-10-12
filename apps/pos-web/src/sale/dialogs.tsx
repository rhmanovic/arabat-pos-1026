import type { DiscountInput, PosCatalogItem, Receipt } from '@arabat/contracts';
import { Money, MoneyError, parseQuantity } from '@arabat/money';
import { Badge, Button, Dialog, Field, Input, Select, Spinner } from '@arabat/ui';
import { localizedName, useApi, useAuth, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { shiftKey } from '../pages/ShiftPages.js';
import { type CartLine, formatQty, useCart } from './cart.js';
import { availabilityKey, itemLabel, useMoneyFormat } from './SalePage.js';

const QTY = /^\d{1,11}(\.\d{1,3})?$/;
const PCT = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/;
const AMOUNT = /^\d{1,10}(\.\d{1,3})?$/;

function minorOf(value: string): bigint | null {
  if (!AMOUNT.test(value.trim())) return null;
  try {
    return Money.parse(value.trim(), 'KWD').minor;
  } catch (error) {
    if (error instanceof MoneyError) return null;
    throw error;
  }
}

function DiscountEditor({
  value,
  onChange,
}: {
  value: { type: 'none' | 'percent' | 'amount'; text: string };
  onChange: (v: { type: 'none' | 'percent' | 'amount'; text: string }) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={t('sale.discount')}>
        {(p) => (
          <Select
            {...p}
            value={value.type}
            onChange={(e) => onChange({ type: e.target.value as 'none', text: '' })}
          >
            <option value="none">{t('sale.noDiscount')}</option>
            <option value="percent">{t('sale.discountPercent')}</option>
            <option value="amount">{t('sale.discountAmount')}</option>
          </Select>
        )}
      </Field>
      {value.type !== 'none' ? (
        <Field
          label={value.type === 'percent' ? t('sale.discountPercent') : t('sale.discountAmount')}
        >
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              inputMode="decimal"
              className="h-12 text-lg"
              value={value.text}
              onChange={(e) => onChange({ ...value, text: e.target.value })}
            />
          )}
        </Field>
      ) : null}
    </div>
  );
}

function toInput(v: {
  type: 'none' | 'percent' | 'amount';
  text: string;
}): DiscountInput | null | 'invalid' {
  if (v.type === 'none') return null;
  const text = v.text.trim();
  if (v.type === 'percent') return PCT.test(text) ? { type: 'percent', value: text } : 'invalid';
  return AMOUNT.test(text) ? { type: 'amount', value: text } : 'invalid';
}

export function LineDialog({
  line,
  item,
  onClose,
}: {
  line: CartLine;
  item: PosCatalogItem | undefined;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { hasPermission } = useAuth();
  const cart = useCart();
  const [qty, setQty] = useState(line.quantity);
  const [discount, setDiscount] = useState({
    type: line.discount?.type ?? ('none' as const),
    text: line.discount?.value ?? '',
  } as {
    type: 'none' | 'percent' | 'amount';
    text: string;
  });
  const [price, setPrice] = useState(line.priceOverride ?? '');
  const disc = toInput(discount);
  const qtyOk = QTY.test(qty.trim()) && !/^0+(\.0+)?$/.test(qty.trim());
  const priceOk = price.trim() === '' || AMOUNT.test(price.trim());
  const step = (delta: number) => {
    const current = QTY.test(qty) ? Number.parseInt(qty.split('.')[0]!, 10) : 0;
    const next = Math.max(1, current + delta);
    setQty(String(next));
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={item ? itemLabel(item, i18n.language) : t('sale.line')}
      footer={
        <>
          <Button
            variant="danger"
            size="lg"
            onClick={() => {
              cart.remove(line.key);
              onClose();
            }}
          >
            {t('sale.remove')}
          </Button>
          <Button
            size="lg"
            disabled={!qtyOk || disc === 'invalid' || !priceOk}
            onClick={() => {
              cart.update(line.key, {
                quantity: formatQty(parseQuantity(qty.trim())),
                discount: disc === 'invalid' ? null : disc,
                priceOverride: price.trim() === '' ? null : price.trim(),
              });
              onClose();
            }}
          >
            {t('sale.done')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="flex items-end gap-2">
          <Button
            variant="secondary"
            size="lg"
            className="h-12 w-14 text-2xl"
            aria-label="−1"
            onClick={() => step(-1)}
          >
            −
          </Button>
          <Field label={t('sale.quantity')} className="flex-1">
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                inputMode="decimal"
                className="h-12 text-center text-xl"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            )}
          </Field>
          <Button
            variant="secondary"
            size="lg"
            className="h-12 w-14 text-2xl"
            aria-label="+1"
            onClick={() => step(1)}
          >
            +
          </Button>
        </div>
        {hasPermission('sales.discount') ? (
          <DiscountEditor value={discount} onChange={setDiscount} />
        ) : null}
        {hasPermission('sales.price_override') ? (
          <Field label={t('sale.priceOverride')} hint={item ? `${item.price.amount}` : undefined}>
            {(p) => (
              <Input
                {...p}
                dir="ltr"
                inputMode="decimal"
                className="h-12 text-lg"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            )}
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}

export function OrderDiscountDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const cart = useCart();
  const current = cart.state.orderDiscount;
  const [value, setValue] = useState({
    type: current?.type ?? ('none' as const),
    text: current?.value ?? '',
  } as {
    type: 'none' | 'percent' | 'amount';
    text: string;
  });
  const disc = toInput(value);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('sale.orderDiscount')}
      footer={
        <Button
          size="lg"
          disabled={disc === 'invalid'}
          onClick={() => {
            cart.setOrderDiscount(disc === 'invalid' ? null : disc);
            onClose();
          }}
        >
          {t('sale.done')}
        </Button>
      }
    >
      <DiscountEditor value={value} onChange={setValue} />
    </Dialog>
  );
}

interface PlannedPayment {
  methodId: string;
  amount: string;
  tendered: string | null;
  reference: string | null;
}

export function PaymentDialog({
  totalMinor,
  onClose,
  onCompleted,
}: {
  totalMinor: bigint;
  onClose: () => void;
  onCompleted: (saleId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const fmt = useMoneyFormat();
  const cart = useCart();
  const methods = useQuery({
    queryKey: ['pos', 'payment-methods'],
    queryFn: () => api.payments.posMethods(),
  });
  const [planned, setPlanned] = useState<PlannedPayment[]>([]);
  const [methodId, setMethodId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [tendered, setTendered] = useState('');
  const [reference, setReference] = useState('');
  // One key for this checkout: retries after a network error can never sell twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const paidMinor = planned.reduce((s, p) => s + Money.parse(p.amount, 'KWD').minor, 0n);
  const remaining = totalMinor - paidMinor;
  const method = methods.data?.methods.find((m) => m.id === methodId);
  const amountMinor = minorOf(amount);
  const tenderedMinor = tendered.trim() ? minorOf(tendered) : null;
  const isCash = method?.kind === 'cash';
  const canAdd =
    method &&
    amountMinor !== null &&
    amountMinor > 0n &&
    amountMinor <= remaining &&
    (!isCash || !tendered.trim() || (tenderedMinor !== null && tenderedMinor >= amountMinor));
  const change = planned.reduce(
    (s, p) =>
      s +
      (p.tendered ? Money.parse(p.tendered, 'KWD').minor - Money.parse(p.amount, 'KWD').minor : 0n),
    0n,
  );

  const pick = (id: string) => {
    setMethodId(id);
    setAmount(Money.ofMinor(remaining, 'KWD').toDecimalString());
    setTendered('');
    setReference('');
  };
  const add = () => {
    setPlanned((ps) => [
      ...ps,
      {
        methodId: methodId!,
        amount: Money.ofMinor(amountMinor!, 'KWD').toDecimalString(),
        tendered:
          isCash && tenderedMinor !== null
            ? Money.ofMinor(tenderedMinor, 'KWD').toDecimalString()
            : null,
        reference: reference.trim() || null,
      },
    ]);
    setMethodId(null);
    setAmount('');
    setTendered('');
  };

  const complete = useMutation({
    mutationFn: () =>
      api.sales.checkout({
        idempotencyKey,
        ...(cart.state.orderId ? { orderId: cart.state.orderId } : {}),
        lines: cart.state.lines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          priceOverride: l.priceOverride,
          discount: l.discount,
        })),
        orderDiscount: cart.state.orderDiscount,
        payments: planned,
        expectedTotal: Money.ofMinor(totalMinor, 'KWD').toDecimalString(),
      }),
    onSuccess: async (sale) => {
      cart.clear();
      notify.ok(t('sale.completed'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: availabilityKey }),
        queryClient.invalidateQueries({ queryKey: shiftKey }),
        queryClient.invalidateQueries({ queryKey: ['pos', 'recent'] }),
      ]);
      onCompleted(sale.id);
    },
    onError: notify.fail,
  });

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(open) => !open && !complete.isPending && onClose()}
      title={t('sale.paymentTitle')}
      footer={
        <Button
          size="lg"
          className="h-14 w-full text-lg"
          disabled={remaining !== 0n}
          loading={complete.isPending}
          onClick={() => complete.mutate()}
        >
          {t('sale.complete')}
        </Button>
      }
    >
      <div className="grid gap-4">
        <dl className="grid grid-cols-3 gap-2 rounded-lg bg-surface-muted p-3 text-center">
          <div>
            <dt className="text-sm text-fg-muted">{t('sale.total')}</dt>
            <dd className="text-xl font-semibold tabular-nums" dir="ltr">
              {fmt(totalMinor)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-fg-muted">{t('sale.remaining')}</dt>
            <dd className="text-xl font-semibold tabular-nums" dir="ltr" data-testid="remaining">
              {fmt(remaining)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-fg-muted">{t('sale.change')}</dt>
            <dd
              className="text-xl font-semibold tabular-nums text-success"
              dir="ltr"
              data-testid="change"
            >
              {fmt(change)}
            </dd>
          </div>
        </dl>
        {totalMinor === 0n ? <p className="text-fg-muted">{t('sale.zeroTotal')}</p> : null}
        {planned.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {planned.map((p, i) => {
              const m = methods.data?.methods.find((x) => x.id === p.methodId);
              return (
                <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>{m ? localizedName(m, i18n.language) : ''}</span>
                  <span className="flex items-center gap-3">
                    <span className="tabular-nums" dir="ltr">
                      {fmt(Money.parse(p.amount, 'KWD').minor)}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPlanned((ps) => ps.filter((_, j) => j !== i))}
                    >
                      {t('sale.remove')}
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
        {remaining > 0n ? (
          <>
            <div
              role="group"
              aria-label={t('sale.payWith')}
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            >
              {methods.data?.methods.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={methodId === m.id}
                  onClick={() => pick(m.id)}
                  className="h-14 rounded-lg border-2 border-border text-lg font-medium aria-pressed:border-primary aria-pressed:bg-primary-soft"
                >
                  {localizedName(m, i18n.language)}
                </button>
              ))}
            </div>
            {method ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('sale.amount')}>
                  {(p) => (
                    <Input
                      {...p}
                      dir="ltr"
                      inputMode="decimal"
                      className="h-12 text-lg"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  )}
                </Field>
                {isCash ? (
                  <Field label={t('sale.tendered')}>
                    {(p) => (
                      <Input
                        {...p}
                        dir="ltr"
                        inputMode="decimal"
                        className="h-12 text-lg"
                        value={tendered}
                        onChange={(e) => setTendered(e.target.value)}
                      />
                    )}
                  </Field>
                ) : (
                  <Field label={t('sale.reference')}>
                    {(p) => (
                      <Input
                        {...p}
                        dir="ltr"
                        className="h-12 text-lg"
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                      />
                    )}
                  </Field>
                )}
                {isCash ? (
                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    {['5', '10', '20'].map((v) => (
                      <Button key={v} variant="secondary" onClick={() => setTendered(v)}>
                        {v}
                      </Button>
                    ))}
                  </div>
                ) : null}
                <Button size="lg" className="sm:col-span-2" disabled={!canAdd} onClick={add}>
                  {t('sale.addPayment')}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

export function SuspendDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const cart = useCart();
  const [label, setLabel] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.sales.suspend({
        lines: cart.state.lines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          priceOverride: l.priceOverride,
          discount: l.discount,
        })),
        orderDiscount: cart.state.orderDiscount,
        label: label.trim() || null,
      }),
    onSuccess: async () => {
      // A resumed order that is held again stays a separate held sale; discard the old one.
      if (cart.state.orderId)
        await api.sales.cancelSuspended(cart.state.orderId).catch(() => undefined);
      cart.clear();
      notify.ok(t('sale.suspended'));
      onClose();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('sale.suspend')}
      footer={
        <Button size="lg" loading={save.isPending} onClick={() => save.mutate()}>
          {t('sale.suspend')}
        </Button>
      }
    >
      <Field label={t('sale.suspendLabel')}>
        {(p) => (
          <Input
            {...p}
            className="h-12 text-lg"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}

export function HeldSalesDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const cart = useCart();
  const held = useQuery({ queryKey: ['pos', 'held'], queryFn: () => api.sales.suspended() });
  const discard = useMutation({
    mutationFn: (id: string) => api.sales.cancelSuspended(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pos', 'held'] }),
    onError: notify.fail,
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={t('sale.heldSales')}>
      {held.isPending ? <Spinner /> : null}
      {held.data?.orders.length === 0 ? <p className="text-fg-muted">{t('sale.noHeld')}</p> : null}
      <ul className="divide-y divide-border">
        {held.data?.orders.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-3 py-2">
            <span>
              <span className="block font-medium">
                {o.label ?? t('sale.items', { count: o.lineCount })}
              </span>
              <span className="block text-sm text-fg-muted">
                {o.cashierName} ·{' '}
                {new Date(o.createdAt).toLocaleTimeString(i18n.language, {
                  hour: '2-digit',
                  minute: '2-digit',
                  numberingSystem: 'latn',
                })}
              </span>
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  cart.load({
                    orderId: o.id,
                    orderDiscount: o.orderDiscount,
                    lines: o.lines.map((l) => ({
                      key: crypto.randomUUID(),
                      variantId: l.variantId,
                      quantity: l.quantity.replace(/\.?0+$/, ''),
                      priceOverride: l.priceOverride?.amount ?? null,
                      discount: l.discount,
                    })),
                  });
                  onClose();
                }}
              >
                {t('sale.resume')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => discard.mutate(o.id)}>
                {t('sale.discard')}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

export function RecentSalesDialog({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const fmt = useMoneyFormat();
  const recent = useQuery({ queryKey: ['pos', 'recent'], queryFn: () => api.sales.recent() });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={t('sale.recent')}>
      {recent.data?.sales.length === 0 ? (
        <p className="text-fg-muted">{t('sale.noRecent')}</p>
      ) : null}
      <ul className="divide-y divide-border">
        {recent.data?.sales.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 py-3 text-start"
              onClick={() => onOpen(s.id)}
            >
              <span>
                <span className="block font-medium" dir="ltr">
                  {s.receiptNumber}
                </span>
                <span className="block text-sm text-fg-muted">
                  {new Date(s.createdAt).toLocaleTimeString(i18n.language, {
                    hour: '2-digit',
                    minute: '2-digit',
                    numberingSystem: 'latn',
                  })}
                </span>
              </span>
              <span className="font-semibold tabular-nums" dir="ltr">
                {fmt(s.total)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

export function ReceiptDialog({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const receipt = useQuery({
    queryKey: ['pos', 'receipt', saleId],
    queryFn: () => api.sales.posReceipt(saleId),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('sale.receipt')}
      footer={
        <>
          <Button
            variant="secondary"
            size="lg"
            disabled={!receipt.data}
            onClick={() => window.print()}
          >
            {t('sale.print')}
          </Button>
          <Button size="lg" onClick={onClose}>
            {t('sale.newSale')}
          </Button>
        </>
      }
    >
      {receipt.data ? (
        <>
          <ReceiptView receipt={receipt.data} />
          {createPortal(
            <div className="hidden print:block" data-print-receipt>
              <ReceiptView receipt={receipt.data} />
            </div>,
            document.body,
          )}
        </>
      ) : (
        <Spinner />
      )}
    </Dialog>
  );
}

/** Receipt layout (screen and 80 mm print). */
export function ReceiptView({ receipt }: { receipt: Receipt }) {
  const { t, i18n } = useTranslation();
  const fmt = useMoneyFormat();
  const s = receipt.sale;
  return (
    <article className="mx-auto max-w-xs text-sm tabular-nums" data-testid="receipt">
      <header className="mb-2 text-center">
        <p className="text-base font-bold">{localizedName(receipt.merchant, i18n.language)}</p>
        <p>{localizedName(receipt.branch, i18n.language)}</p>
        {receipt.branch.address ? <p>{receipt.branch.address}</p> : null}
        {receipt.branch.phone ? <p dir="ltr">{receipt.branch.phone}</p> : null}
        {receipt.branch.receiptHeader ? (
          <p className="mt-1 whitespace-pre-wrap">{receipt.branch.receiptHeader}</p>
        ) : null}
      </header>
      <dl className="mb-2 border-y border-dashed border-fg-muted py-1">
        <div className="flex justify-between">
          <dt>{t('sale.receiptNo')}</dt>
          <dd dir="ltr" data-testid="receipt-number">
            {s.receiptNumber}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>{t('sale.cashier')}</dt>
          <dd>{s.cashierName}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{t('sale.register')}</dt>
          <dd>{localizedName(receipt.register, i18n.language) || receipt.register.code}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{t('sale.date')}</dt>
          <dd>
            <bdi>
              {new Intl.DateTimeFormat(
                i18n.language.startsWith('ar') ? 'ar-KW-u-nu-latn' : 'en-GB',
                {
                  dateStyle: 'short',
                  timeStyle: 'short',
                },
              ).format(new Date(s.createdAt))}
            </bdi>
          </dd>
        </div>
      </dl>
      <ul className="mb-2">
        {s.lines.map((l) => (
          <li key={l.position} className="py-0.5">
            <p>
              {localizedName(l, i18n.language)}
              {l.variantNameEn || l.variantNameAr
                ? ` — ${localizedName({ nameEn: l.variantNameEn, nameAr: l.variantNameAr }, i18n.language)}`
                : ''}
            </p>
            <p className="flex justify-between" dir="ltr">
              <span>
                {l.quantity.replace(/\.?0+$/, '')} × {l.unitPrice.amount}
              </span>
              <span>{l.gross.amount}</span>
            </p>
            {l.lineDiscount.amount !== '0.000' ? (
              <p className="flex justify-between" dir="ltr">
                <span>{t('sale.discount')}</span>
                <span>-{l.lineDiscount.amount}</span>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <dl className="border-t border-dashed border-fg-muted pt-1">
        <div className="flex justify-between">
          <dt>{t('sale.subtotal')}</dt>
          <dd dir="ltr">{fmt(s.subtotal)}</dd>
        </div>
        {s.orderDiscount.amount !== '0.000' || s.lineDiscounts.amount !== '0.000' ? (
          <div className="flex justify-between">
            <dt>{t('sale.discounts')}</dt>
            <dd dir="ltr">
              -
              {fmt(
                Money.fromJSON(s.lineDiscounts as { amount: string; currency: 'KWD' }).add(
                  Money.fromJSON(s.orderDiscount as { amount: string; currency: 'KWD' }),
                ).minor,
              )}
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between text-base font-bold">
          <dt>{t('sale.total')}</dt>
          <dd dir="ltr" data-testid="receipt-total">
            {fmt(s.total)}
          </dd>
        </div>
        {s.payments.map((p) => (
          <div key={p.id} className="flex justify-between">
            <dt>{localizedName(p, i18n.language)}</dt>
            <dd dir="ltr">{fmt(p.tendered ?? p.amount)}</dd>
          </div>
        ))}
        {s.change.amount !== '0.000' ? (
          <div className="flex justify-between">
            <dt>{t('sale.change')}</dt>
            <dd dir="ltr">{fmt(s.change)}</dd>
          </div>
        ) : null}
      </dl>
      <footer className="mt-2 text-center">
        {receipt.branch.receiptFooter ? (
          <p className="whitespace-pre-wrap">{receipt.branch.receiptFooter}</p>
        ) : (
          <p>{t('sale.thanks')}</p>
        )}
        <Badge className="mt-1 print:hidden" tone="success">
          {t('sale.completed')}
        </Badge>
      </footer>
    </article>
  );
}
