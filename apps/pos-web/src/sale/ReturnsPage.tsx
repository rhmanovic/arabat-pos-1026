import {
  REFUND_REASONS,
  VOID_REASONS,
  type Refund,
  type RefundableSale,
  type RefundReceipt,
} from '@arabat/contracts';
import { Money, QuantityError, formatQuantity, parseQuantity } from '@arabat/money';
import { Alert, Badge, Button, Dialog, Field, Input, Select, Spinner, Textarea } from '@arabat/ui';
import { localizedName, useApi, useAuth, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { shiftKey } from '../pages/ShiftPages.js';
import { type CartLine, itemsInForce, priceLines, useNow } from './cart.js';
import { ReceiptDialog } from './dialogs.js';
import { availabilityKey, catalogKey, itemLabel, useMoneyFormat } from './SalePage.js';

const QTY = /^\d{1,11}(\.\d{1,3})?$/;

function milli(value: string): bigint | null {
  try {
    return QTY.test(value.trim()) ? parseQuantity(value.trim()) : null;
  } catch (error) {
    if (error instanceof QuantityError) return null;
    throw error;
  }
}

interface Selection {
  quantity: string;
  /** Undefined = follow the refund reason (BR-175). */
  restock?: boolean;
}

/** Find a sale, choose what comes back, then refund, exchange or (same shift) cancel. */
export function ReturnsPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const [receipt, setReceipt] = useState('');
  const [sale, setSale] = useState<RefundableSale | null>(null);
  const recent = useQuery({ queryKey: ['pos', 'recent'], queryFn: () => api.sales.recent() });
  const find = useMutation({
    mutationFn: (code: string) => api.refunds.lookup(code),
    onSuccess: setSale,
    onError: notify.fail,
  });
  return (
    <div className="mx-auto grid h-full max-w-5xl content-start gap-3 overflow-y-auto p-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{t('returns.title')}</h1>
        <div className="flex-1" />
        <Link to="/" className="text-primary">
          {t('shift.back')}
        </Link>
      </div>
      <form
        className="flex gap-2 rounded-lg bg-surface p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (receipt.trim()) find.mutate(receipt.trim());
        }}
      >
        <Input
          aria-label={t('returns.receipt')}
          placeholder={t('returns.receipt')}
          className="h-12 flex-1 text-lg"
          dir="ltr"
          value={receipt}
          onChange={(e) => setReceipt(e.target.value)}
        />
        <Button size="lg" type="submit" loading={find.isPending}>
          {t('returns.find')}
        </Button>
      </form>
      {!sale && recent.data && recent.data.sales.length > 0 ? (
        <section className="rounded-lg bg-surface p-3">
          <h2 className="mb-2 text-sm text-fg-muted">{t('returns.recent')}</h2>
          <div className="flex flex-wrap gap-2">
            {recent.data.sales.slice(0, 12).map((s) => (
              <Button key={s.id} variant="secondary" onClick={() => find.mutate(s.receiptNumber)}>
                <span dir="ltr">{s.receiptNumber}</span>
              </Button>
            ))}
          </div>
        </section>
      ) : null}
      {sale ? (
        <ReturnForm
          key={`${sale.saleId}-${sale.refunded.amount}`}
          sale={sale}
          onReload={() => find.mutate(sale.receiptNumber)}
          language={i18n.language}
        />
      ) : null}
    </div>
  );
}

function ReturnForm({
  sale,
  onReload,
  language,
}: {
  sale: RefundableSale;
  onReload: () => void;
  language: string;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const fmt = useMoneyFormat();
  const [selection, setSelection] = useState<Record<number, Selection>>({});
  const [reason, setReason] = useState<(typeof REFUND_REASONS)[number]>('changed_mind');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'refund' | 'exchange'>('refund');
  const [result, setResult] = useState<Refund | null>(null);
  const [exchangeSaleId, setExchangeSaleId] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  /** Customer phone or name on refunds that wait for approval (BR-180). */
  const [customerContact, setCustomerContact] = useState('');
  /** Terminal / transfer references per card or transfer pay-back (BR-181). */
  const [references, setReferences] = useState<Record<string, string>>({});

  const chosen = sale.lines
    .map((l) => ({ line: l, sel: selection[l.position] }))
    .filter((x) => x.sel && milli(x.sel.quantity) !== null && milli(x.sel.quantity)! > 0n);
  const valid =
    chosen.length > 0 &&
    chosen.every((x) => milli(x.sel!.quantity)! <= parseQuantity(x.line.refundableQuantity)) &&
    (reason !== 'other' || Boolean(note.trim()));
  const previewLines = chosen.map((x) => ({
    position: x.line.position,
    quantity: x.sel!.quantity.trim(),
  }));
  const preview = useQuery({
    queryKey: ['pos', 'refund-preview', sale.saleId, JSON.stringify(previewLines)],
    enabled: valid,
    queryFn: () => api.refunds.preview({ saleId: sale.saleId, lines: previewLines }),
  });
  // Damaged and defective goods stay out of sellable stock unless the cashier says otherwise
  // (BR-175); the box follows the reason until it is touched.
  const restockDefault = !(reason === 'damaged' || reason === 'defective');
  const setQty = (
    position: number,
    quantity: string,
    restock: boolean | undefined = selection[position]?.restock,
  ) => setSelection((s) => ({ ...s, [position]: { quantity, restock } }));

  const refundLines = chosen.map((x) => ({
    position: x.line.position,
    quantity: x.sel!.quantity.trim(),
    restock: (x.sel!.restock ?? restockDefault) && x.line.trackInventory,
  }));
  const needsReferences = (preview.data?.allocation ?? []).filter((a) => a.referenceRequired);
  const referencesOk = needsReferences.every((a) => (references[a.paymentId] ?? '').trim() !== '');
  const refund = useMutation({
    mutationFn: () =>
      api.refunds.create({
        idempotencyKey: key,
        saleId: sale.saleId,
        lines: refundLines,
        reason,
        note: note.trim() || null,
        customerContact: customerContact.trim() || null,
        // The suggested split, with the references the cashier typed.
        ...(needsReferences.length
          ? {
              allocation: preview.data!.allocation.map((a) => ({
                paymentId: a.paymentId,
                amount: a.amount.amount,
                reference: (references[a.paymentId] ?? '').trim() || null,
              })),
            }
          : {}),
      }),
    onSuccess: async (r) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: shiftKey }),
        queryClient.invalidateQueries({ queryKey: availabilityKey }),
      ]);
      if (r.status === 'pending_approval')
        notify.ok(t('returns.pending', { number: r.refundNumber }));
      else notify.ok(t('returns.done'));
      setResult(r);
    },
    onError: notify.fail,
  });

  // After an exchange: first the refund receipt, then the new sale's receipt.
  if (result)
    return (
      <RefundReceiptDialog
        refundId={result.id}
        pending={result.status === 'pending_approval'}
        onClose={() => {
          setResult(null);
          if (!exchangeSaleId) onReload();
        }}
      />
    );
  if (exchangeSaleId)
    return (
      <ReceiptDialog
        saleId={exchangeSaleId}
        onClose={() => {
          setExchangeSaleId(null);
          onReload();
        }}
      />
    );

  return (
    <div className="grid gap-3">
      <section className="flex flex-wrap items-center gap-3 rounded-lg bg-surface p-3">
        <span className="text-lg font-semibold" dir="ltr">
          {sale.receiptNumber}
        </span>
        <span className="text-fg-muted">
          {new Date(sale.createdAt).toLocaleString(language, { numberingSystem: 'latn' })}
        </span>
        <span className="font-semibold tabular-nums" dir="ltr">
          {fmt(sale.total)}
        </span>
        {sale.refunded.amount !== '0.000' ? (
          <Badge tone="warning">
            {t('returns.alreadyRefunded', { amount: fmt(sale.refunded) })}
          </Badge>
        ) : null}
        <div className="flex-1" />
        {sale.voidable && hasPermission('sales.void') ? (
          <Button variant="danger" onClick={() => setVoiding(true)}>
            {t('returns.void')}
          </Button>
        ) : null}
      </section>
      {!sale.withinWindow ? <Alert tone="warning">{t('returns.outsideWindow')}</Alert> : null}

      <ul className="divide-y divide-border rounded-lg bg-surface" aria-label={t('returns.sale')}>
        {sale.lines.map((l) => {
          const refundable = parseQuantity(l.refundableQuantity);
          const sel = selection[l.position];
          return (
            <li
              key={l.position}
              className="grid items-center gap-3 p-3 sm:grid-cols-[1fr_auto_auto]"
              data-testid="return-line"
            >
              <span>
                <span className="block font-medium">
                  {localizedName(l, language)}
                  {l.variantNameEn || l.variantNameAr
                    ? ` — ${localizedName({ nameEn: l.variantNameEn, nameAr: l.variantNameAr }, language)}`
                    : ''}
                </span>
                <span className="block text-sm text-fg-muted">
                  {t('returns.sold')}: <span dir="ltr">{l.soldQuantity.replace(/\.?0+$/, '')}</span>{' '}
                  · {t('returns.refundable')}:{' '}
                  <span dir="ltr">{l.refundableQuantity.replace(/\.?0+$/, '') || '0'}</span> ·{' '}
                  <span dir="ltr">{fmt(l.net)}</span>
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Input
                  aria-label={`${t('returns.returnQty')} ${localizedName(l, language)}`}
                  className="h-12 w-24 text-center text-lg"
                  dir="ltr"
                  inputMode="decimal"
                  disabled={refundable === 0n}
                  value={sel?.quantity ?? ''}
                  onChange={(e) => setQty(l.position, e.target.value)}
                />
                <Button
                  variant="secondary"
                  disabled={refundable === 0n}
                  onClick={() =>
                    setQty(l.position, formatQuantity(refundable).replace(/\.?0+$/, ''))
                  }
                >
                  {t('returns.all')}
                </Button>
              </span>
              {l.trackInventory ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5 accent-primary"
                    checked={sel?.restock ?? restockDefault}
                    onChange={(e) => setQty(l.position, sel?.quantity ?? '', e.target.checked)}
                  />
                  {t('returns.restock')}
                </label>
              ) : (
                <span />
              )}
            </li>
          );
        })}
      </ul>

      <section className="grid gap-3 rounded-lg bg-surface p-3 sm:grid-cols-2">
        <Field label={t('returns.reason')}>
          {(p) => (
            <Select
              {...p}
              value={reason}
              onChange={(e) => setReason(e.target.value as typeof reason)}
            >
              {REFUND_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`returns.reason_${r}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('returns.note')}>
          {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </section>

      <div role="group" className="grid grid-cols-2 gap-2">
        {(['refund', 'exchange'] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => setMode(m)}
            className="h-12 rounded-lg border-2 border-border bg-surface text-lg font-medium aria-pressed:border-primary aria-pressed:bg-primary-soft"
          >
            {t(`returns.${m}`)}
          </button>
        ))}
      </div>

      {!valid ? <p className="text-fg-muted">{t('returns.nothing')}</p> : null}
      {valid && preview.data ? (
        <section className="grid gap-2 rounded-lg bg-surface p-3" data-testid="refund-preview">
          <p className="flex justify-between text-xl font-semibold">
            <span>{t('returns.refundTotal')}</span>
            <span dir="ltr" data-testid="refund-total">
              {fmt(preview.data.total)}
            </span>
          </p>
          {mode === 'refund' ? (
            <ul className="grid gap-2 text-sm text-fg-muted">
              {preview.data.allocation.map((a) => {
                const p = sale.payments.find((x) => x.paymentId === a.paymentId);
                return (
                  <li key={a.paymentId} className="grid gap-1">
                    <span className="flex justify-between">
                      <span>
                        {t('returns.payBack')}: {p ? localizedName(p, language) : a.kind}
                      </span>
                      <span dir="ltr">{fmt(a.amount)}</span>
                    </span>
                    {a.referenceRequired ? (
                      <Field label={t('returns.payBackReference')}>
                        {(fp) => (
                          <Input
                            {...fp}
                            dir="ltr"
                            className="h-11"
                            value={references[a.paymentId] ?? ''}
                            onChange={(e) =>
                              setReferences((r) => ({ ...r, [a.paymentId]: e.target.value }))
                            }
                          />
                        )}
                      </Field>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {preview.data.approvalRequired ? (
            <>
              <Alert tone="warning">
                {t('returns.needsApproval')}{' '}
                {preview.data.approvalReasons
                  .map((r) => t(`returns.approvalReason_${r}`, { defaultValue: r }))
                  .join(' · ')}
              </Alert>
              {mode === 'refund' ? (
                <Field label={t('returns.customerContact')} hint={t('returns.customerContactHint')}>
                  {(fp) => (
                    <Input
                      {...fp}
                      className="h-11"
                      maxLength={120}
                      value={customerContact}
                      onChange={(e) => setCustomerContact(e.target.value)}
                    />
                  )}
                </Field>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {mode === 'refund' ? (
        <Button
          size="lg"
          className="h-14 text-lg"
          disabled={!valid || !preview.data || !referencesOk}
          loading={refund.isPending}
          onClick={() => refund.mutate()}
        >
          {t('returns.confirmRefund')}
        </Button>
      ) : valid && preview.data ? (
        <ExchangePanel
          sale={sale}
          creditMinor={
            Money.fromJSON(preview.data.total as { amount: string; currency: 'KWD' }).minor
          }
          returnLines={refundLines}
          reason={reason}
          note={note}
          onDone={(r, saleId) => {
            setExchangeSaleId(saleId);
            setResult(r);
          }}
        />
      ) : null}

      <VoidDialog
        open={voiding}
        sale={sale}
        onClose={() => setVoiding(false)}
        onDone={(r) => {
          setVoiding(false);
          setResult(r);
        }}
      />
    </div>
  );
}

function ExchangePanel({
  sale,
  creditMinor,
  returnLines,
  reason,
  note,
  onDone,
}: {
  sale: RefundableSale;
  creditMinor: bigint;
  returnLines: { position: number; quantity: string; restock: boolean }[];
  reason: (typeof REFUND_REASONS)[number];
  note: string;
  onDone: (refund: Refund, saleId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const fmt = useMoneyFormat();
  const catalog = useQuery({
    queryKey: catalogKey,
    queryFn: () => api.catalog.posCatalog(),
    staleTime: 60_000,
  });
  const methods = useQuery({
    queryKey: ['pos', 'payment-methods'],
    queryFn: () => api.payments.posMethods(),
  });
  const now = useNow();
  const live = useMemo(() => itemsInForce(catalog.data?.items ?? [], now), [catalog.data, now]);
  const items = useMemo(() => new Map(live.map((i) => [i.variantId, i])), [live]);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [search, setSearch] = useState('');
  const [methodId, setMethodId] = useState<string>('');
  const [key] = useState(() => crypto.randomUUID());
  const pricing = lines.length
    ? priceLines({ lines, orderDiscount: null, orderId: null, customer: null }, items)
    : null;
  const newTotal = pricing?.ok ? pricing.cart.totalMinor : 0n;
  const due = newTotal - creditMinor;
  const term = search.trim().toLowerCase();
  const matches = term
    ? live
        .filter(
          (i) =>
            itemLabel(i, i18n.language).toLowerCase().includes(term) ||
            (i.sku ?? '').toLowerCase() === term ||
            i.barcodes.includes(search.trim()),
        )
        .slice(0, 8)
    : [];
  const add = (variantId: string) => {
    setLines((ls) => {
      const existing = ls.find((l) => l.variantId === variantId);
      if (existing)
        return ls.map((l) =>
          l === existing ? { ...l, quantity: String(Number.parseInt(l.quantity, 10) + 1) } : l,
        );
      return [
        ...ls,
        {
          key: crypto.randomUUID(),
          variantId,
          quantity: '1',
          priceOverride: null,
          priceOverrideReason: null,
          discount: null,
        },
      ];
    });
    setSearch('');
  };
  const submit = useMutation({
    mutationFn: () =>
      api.refunds.exchange({
        idempotencyKey: key,
        saleId: sale.saleId,
        returnLines,
        reason,
        note: note.trim() || null,
        lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
        orderDiscount: null,
        payments:
          due > 0n ? [{ methodId, amount: Money.ofMinor(due, 'KWD').toDecimalString() }] : [],
        expectedTotal: Money.ofMinor(newTotal, 'KWD').toDecimalString(),
      }),
    onSuccess: async (r) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: shiftKey }),
        queryClient.invalidateQueries({ queryKey: availabilityKey }),
      ]);
      notify.ok(t('returns.exchanged'));
      onDone(r.refund, r.sale.id);
    },
    onError: notify.fail,
  });
  return (
    <section className="grid gap-3 rounded-lg bg-surface p-3">
      <h2 className="font-semibold">{t('returns.newItems')}</h2>
      <div className="relative">
        <Input
          type="search"
          aria-label={t('sale.search')}
          placeholder={t('sale.searchHint')}
          className="h-12 text-lg"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches[0]) {
              e.preventDefault();
              add(matches[0].variantId);
            }
          }}
        />
        {matches.length ? (
          <ul
            className="absolute inset-x-0 top-full z-10 mt-1 rounded-md border border-border bg-surface shadow-lg"
            role="listbox"
          >
            {matches.map((m) => (
              <li key={m.variantId}>
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  className="flex w-full justify-between px-3 py-2 text-start hover:bg-surface-muted"
                  onClick={() => add(m.variantId)}
                >
                  <span>{itemLabel(m, i18n.language)}</span>
                  <span dir="ltr">{fmt(m.price)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <ul className="divide-y divide-border">
        {lines.map((l, i) => (
          <li key={l.key} className="flex items-center justify-between gap-3 py-2">
            <span>
              {items.get(l.variantId) ? itemLabel(items.get(l.variantId)!, i18n.language) : ''}
            </span>
            <span className="flex items-center gap-2">
              <Input
                aria-label={t('sale.quantity')}
                className="w-20 text-center"
                dir="ltr"
                value={l.quantity}
                onChange={(e) =>
                  setLines((ls) =>
                    ls.map((x) => (x.key === l.key ? { ...x, quantity: e.target.value } : x)),
                  )
                }
              />
              <span dir="ltr" className="w-24 text-end tabular-nums">
                {pricing?.ok ? fmt(pricing.cart.lines[i]!.netMinor) : '—'}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
              >
                {t('sale.remove')}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <dl className="grid gap-1 text-sm">
        <div className="flex justify-between">
          <dt>{t('returns.newTotal')}</dt>
          <dd dir="ltr">{fmt(newTotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{t('returns.credit')}</dt>
          <dd dir="ltr">−{fmt(creditMinor)}</dd>
        </div>
        <div className="flex justify-between text-lg font-semibold">
          <dt>{due >= 0n ? t('returns.due') : t('returns.back')}</dt>
          <dd dir="ltr" data-testid="exchange-difference">
            {fmt(due >= 0n ? due : -due)}
          </dd>
        </div>
      </dl>
      {due > 0n ? (
        <Field label={t('returns.payWith')}>
          {(p) => (
            <Select {...p} value={methodId} onChange={(e) => setMethodId(e.target.value)}>
              <option value="" />
              {methods.data?.methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {localizedName(m, i18n.language)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      <Button
        size="lg"
        className="h-14 text-lg"
        disabled={!pricing?.ok || lines.length === 0 || (due > 0n && !methodId)}
        loading={submit.isPending}
        onClick={() => submit.mutate()}
      >
        {t('returns.completeExchange')}
      </Button>
    </section>
  );
}

function VoidDialog({
  open,
  sale,
  onClose,
  onDone,
}: {
  open: boolean;
  sale: RefundableSale;
  onClose: () => void;
  onDone: (r: Refund) => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<(typeof VOID_REASONS)[number]>('cashier_error');
  const [note, setNote] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const run = useMutation({
    mutationFn: () =>
      api.refunds.voidSale(sale.saleId, { idempotencyKey: key, reason, note: note.trim() || null }),
    onSuccess: async (r) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: shiftKey }),
        queryClient.invalidateQueries({ queryKey: availabilityKey }),
      ]);
      onDone(r);
    },
    onError: notify.fail,
  });
  if (!open) return null;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('returns.voidTitle')}
      description={t('returns.voidBody')}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={onClose}>
            {t('shift.cancel')}
          </Button>
          <Button
            variant="danger"
            size="lg"
            disabled={reason === 'other' && !note.trim()}
            loading={run.isPending}
            onClick={() => run.mutate()}
          >
            {t('returns.void')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label={t('returns.reason')}>
          {(p) => (
            <Select
              {...p}
              value={reason}
              onChange={(e) => setReason(e.target.value as typeof reason)}
            >
              {VOID_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`returns.reason_${r}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('returns.note')}>
          {(p) => (
            <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function RefundReceiptDialog({
  refundId,
  pending,
  onClose,
}: {
  refundId: string;
  pending: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const receipt = useQuery({
    queryKey: ['pos', 'refund-receipt', refundId],
    queryFn: () => api.refunds.posReceipt(refundId),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('returns.receiptTitle')}
      footer={
        <>
          <Button size="lg" onClick={onClose}>
            {t('returns.close')}
          </Button>
        </>
      }
    >
      {receipt.data ? (
        <>
          {pending ? (
            <Alert tone="warning">
              {t('returns.pending', { number: receipt.data.refund.refundNumber })}
            </Alert>
          ) : null}
          <RefundReceiptView receipt={receipt.data} />
        </>
      ) : (
        <Spinner />
      )}
    </Dialog>
  );
}

function RefundReceiptView({ receipt }: { receipt: RefundReceipt }) {
  const { t, i18n } = useTranslation();
  const fmt = useMoneyFormat();
  const r = receipt.refund;
  return (
    <article className="mx-auto max-w-xs text-sm tabular-nums" data-testid="refund-receipt">
      <header className="mb-2 text-center">
        <p className="text-base font-bold" dir="auto">
          {localizedName(receipt.merchant, i18n.language)}
        </p>
        <p dir="auto">{localizedName(receipt.branch, i18n.language)}</p>
        <p className="mt-1 font-semibold">{t(`returns.kind_${r.kind}`)}</p>
      </header>
      <dl className="mb-2 border-y border-dashed border-fg-muted py-1">
        <div className="flex justify-between text-base font-bold">
          <dt>{t('returns.receiptTitle')}</dt>
          <dd dir="ltr" data-testid="refund-number">
            {r.refundNumber}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>{t('returns.originalReceipt')}</dt>
          <dd dir="ltr">{r.receiptNumber}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{t('sale.cashier')}</dt>
          <dd dir="auto">{receipt.cashierName}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{t('returns.reason')}</dt>
          <dd>{t(`returns.reason_${r.reason}`)}</dd>
        </div>
      </dl>
      <ul className="mb-2">
        {r.lines.map((l) => (
          <li key={l.position} className="flex justify-between py-0.5">
            <span dir="auto">
              {localizedName(l, i18n.language)} ×{' '}
              <span dir="ltr">{l.quantity.replace(/\.?0+$/, '')}</span>
            </span>
            <span dir="ltr">{fmt(l.amount)}</span>
          </li>
        ))}
      </ul>
      <dl className="border-t border-dashed border-fg-muted pt-1">
        <div className="flex justify-between text-base font-bold">
          <dt>{t('returns.refundTotal')}</dt>
          <dd dir="ltr" data-testid="refund-receipt-total">
            {fmt(r.total)}
          </dd>
        </div>
        {r.payments.map((p) => (
          <div key={p.id} className="flex justify-between">
            <dt>{p.kind === 'exchange' ? t('returns.credit') : localizedName(p, i18n.language)}</dt>
            <dd dir="ltr">{fmt(p.amount)}</dd>
          </div>
        ))}
      </dl>
      {receipt.branch.receiptFooter ? (
        <p className="mt-2 text-center whitespace-pre-wrap" dir="auto">
          {receipt.branch.receiptFooter}
        </p>
      ) : null}
    </article>
  );
}
