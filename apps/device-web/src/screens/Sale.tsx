import type { DiscountInput, OverridablePermission } from '@arabat/contracts';
import {
  type Cart,
  type CartLine,
  type CatalogItem,
  EMPTY_CART,
  type PreparedSale,
  type StaffMember,
  attemptPin,
  commitSale,
  discardRefusedShift,
  getSale,
  listSales,
  missingRights,
  newId,
  prepareSale,
  priceCartLines,
  receiptHtmlFor,
  recordCashMovement,
  searchCatalog,
  supervisorRights,
} from '@arabat/device-core';
import { formatDateTime } from '@arabat/i18n';
import { Money, normalizeAmountInput } from '@arabat/money';
import type { PaymentInput } from '@arabat/pos-core';
import { Alert, Button, Dialog, Field, Input, Segmented, cn, useToast } from '@arabat/ui';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError, useDevice } from '../app/device.js';
import { verifyPin } from '../app/pin.js';
import { PinPad } from './Lock.js';
import { kwd } from './Shift.js';
import { StatusBar } from './StatusBar.js';

const name = (x: { nameEn: string | null; nameAr: string | null }, language: string) =>
  (language.startsWith('ar') ? x.nameAr || x.nameEn : x.nameEn || x.nameAr) ?? '';

/** The selling screen: catalog on one side, the cart and its totals on the other. */
export function SaleScreen({ onRefunds, onClose }: { onRefunds: () => void; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const {
    bridge,
    cashier,
    ctx,
    catalog,
    methods,
    shift,
    staff,
    cart,
    setCart,
    reload,
    requestUpload,
    canSell,
    shiftBlocked,
    role,
  } = useDevice();
  const toast = useToast();
  const [discarding, setDiscarding] = useState(false);
  // A shift the server refused blocks everything until it is taken or discarded (amendment 3).
  const blocked = shiftBlocked !== null;
  const discardShift = async () => {
    if (!shift) return;
    setDiscarding(true);
    try {
      await discardRefusedShift(bridge.db, shift);
      await reload();
    } catch (e) {
      toast.error(describeError(e, t));
    } finally {
      setDiscarding(false);
    }
  };
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [editing, setEditing] = useState<CartLine | null>(null);
  const [orderDiscountOpen, setOrderDiscountOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [cashOpen, setCashOpen] = useState<'cash_in' | 'cash_out' | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [lastSale, setLastSale] = useState<{ receiptNumber: string; changeMinor: bigint } | null>(
    null,
  );
  const [supervisor, setSupervisor] = useState<{
    member: StaffMember;
    rights: OverridablePermission[];
    note: string | null;
  } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const items = useMemo(
    () => (catalog ? searchCatalog(catalog, query, category) : []),
    [catalog, query, category],
  );
  const pricing = useMemo(() => (catalog ? priceCartLines(cart, catalog) : null), [cart, catalog]);
  const missing = useMemo(
    () =>
      catalog && ctx && cashier
        ? missingRights(cart, catalog, ctx, cashier).filter((r) => !supervisor?.rights.includes(r))
        : [],
    [cart, catalog, ctx, cashier, supervisor],
  );

  const add = (item: CatalogItem) => {
    const existing = cart.lines.find(
      (l) => l.variantId === item.variantId && l.priceOverride === null && l.discount === null,
    );
    if (existing) {
      setCart({
        ...cart,
        lines: cart.lines.map((l) =>
          l === existing ? { ...l, quantity: String(Number(l.quantity) + 1) } : l,
        ),
      });
    } else {
      setCart({
        ...cart,
        lines: [
          ...cart.lines,
          {
            key: newId(),
            variantId: item.variantId,
            quantity: '1',
            priceOverride: null,
            priceOverrideReason: null,
            discount: null,
          },
        ],
      });
    }
  };
  const scan = (e: FormEvent) => {
    e.preventDefault();
    const exact = catalog?.byBarcode.get(query.trim());
    if (exact && catalog?.items.get(exact)) {
      add(catalog.items.get(exact)!);
      setQuery('');
    } else if (items.length === 1) {
      add(items[0]!);
      setQuery('');
    }
  };
  const updateLine = (key: string, patch: Partial<CartLine> | null) =>
    setCart({
      ...cart,
      lines:
        patch === null
          ? cart.lines.filter((l) => l.key !== key)
          : cart.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    });

  if (!catalog || !ctx || !cashier || !shift) return null;
  const total = pricing?.ok ? pricing.cart.totalMinor : null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-surface-muted select-none">
      <StatusBar />
      {shiftBlocked ? (
        <Alert tone="danger" className="rounded-none border-x-0 py-2" data-testid="shift-blocked">
          <span className="font-semibold">
            {t('shift.refusedTitle', { code: shiftBlocked.code ?? '' })}
          </span>{' '}
          {t(`shift.refusedFix.${shiftBlocked.code ?? 'other'}`, {
            defaultValue: t('shift.refusedFix.other'),
          })}{' '}
          {shiftBlocked.message ? <span dir="auto">({shiftBlocked.message})</span> : null}{' '}
          {t('shift.refusedRetry', { attempts: shiftBlocked.attempts })}
          <Button
            size="sm"
            variant="secondary"
            className="ms-2"
            loading={discarding}
            onClick={() => void discardShift()}
            data-testid="discard-shift"
          >
            {t('shift.discard')}
          </Button>
        </Alert>
      ) : null}
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 md:grid-cols-[1fr_minmax(20rem,26rem)]">
        <section className="flex min-h-0 flex-col gap-2 rounded-lg bg-surface p-2">
          <form onSubmit={scan} className="flex gap-2">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('sale.search')}
              className="h-12 w-full rounded-md border border-border bg-surface px-3 text-lg"
              autoFocus
              data-testid="search"
            />
          </form>
          <div className="flex gap-1 overflow-x-auto">
            <Button
              size="sm"
              variant={category === null ? 'primary' : 'secondary'}
              onClick={() => setCategory(null)}
            >
              {t('sale.all')}
            </Button>
            {catalog.categories.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant={category === c.id ? 'primary' : 'secondary'}
                onClick={() => setCategory(c.id)}
              >
                <bdi>{name(c, i18n.language)}</bdi>
              </Button>
            ))}
          </div>
          <div
            className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4"
            data-testid="catalog"
          >
            {items.map((item) => (
              <button
                key={item.variantId}
                type="button"
                onClick={() => add(item)}
                className="flex min-h-touch flex-col items-start justify-between gap-1 rounded-md border border-border bg-surface p-3 text-start hover:bg-surface-muted"
              >
                <span className="font-medium" dir="auto">
                  {name(item, i18n.language)}
                  {item.variantNameEn || item.variantNameAr
                    ? ` — ${name({ nameEn: item.variantNameEn, nameAr: item.variantNameAr }, i18n.language)}`
                    : ''}
                </span>
                <span className="text-sm text-fg-muted" dir="ltr">
                  {kwd(item.priceMinor, i18n.language)}
                </span>
              </button>
            ))}
          </div>
        </section>
        <section className="flex min-h-0 flex-col rounded-lg bg-surface" data-testid="cart">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="font-semibold">
              {t(role === 'secondary' ? 'shift.branchShiftBy' : 'shift.openedBy', {
                name: staff.find((s) => s.membershipId === shift.membershipId)?.fullName ?? '',
                since: formatDateTime(shift.openedAt, i18n.language),
              })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCart(EMPTY_CART)}
              disabled={cart.lines.length === 0}
            >
              {t('sale.clear')}
            </Button>
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
            {cart.lines.length === 0 ? (
              <li className="p-4 text-sm text-fg-muted">{t('sale.empty')}</li>
            ) : null}
            {cart.lines.map((l, i) => {
              const item = catalog.items.get(l.variantId);
              const priced = pricing?.ok ? pricing.cart.lines[i] : null;
              return (
                <li key={l.key}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start hover:bg-surface-muted"
                    onClick={() => setEditing(l)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium" dir="auto">
                        {item ? name(item, i18n.language) : l.variantId}
                      </span>
                      <span className="text-xs text-fg-muted" dir="ltr">
                        {l.quantity} ×{' '}
                        {l.priceOverride ??
                          (item ? Money.ofMinor(item.priceMinor, 'KWD').toDecimalString() : '')}
                        {l.discount
                          ? ` · −${l.discount.value}${l.discount.type === 'percent' ? '%' : ''}`
                          : ''}
                      </span>
                    </span>
                    <span dir="ltr" className="tabular-nums">
                      {priced ? kwd(priced.netMinor, i18n.language) : '—'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-border p-3 text-sm">
            {pricing && !pricing.ok ? (
              <Alert tone="danger">
                {t(`errors.${pricing.code}`, { defaultValue: pricing.code })}
              </Alert>
            ) : null}
            {pricing?.ok ? (
              <>
                <div className="flex justify-between">
                  <span>{t('sale.subtotal')}</span>
                  <span dir="ltr">{kwd(pricing.cart.subtotalMinor, i18n.language)}</span>
                </div>
                <button
                  type="button"
                  className="flex w-full justify-between hover:underline"
                  onClick={() => setOrderDiscountOpen(true)}
                >
                  <span>
                    {t('sale.discounts')}
                    {cart.orderDiscount
                      ? ` (${t('sale.orderDiscount')} ${cart.orderDiscount.value}${cart.orderDiscount.type === 'percent' ? '%' : ''})`
                      : ''}
                  </span>
                  <span dir="ltr">
                    −
                    {kwd(
                      pricing.cart.lineDiscountsMinor + pricing.cart.orderDiscountMinor,
                      i18n.language,
                    )}
                  </span>
                </button>
                <div className="mt-1 flex justify-between text-xl font-bold" data-testid="total">
                  <span>{t('sale.total')}</span>
                  <span dir="ltr">{kwd(pricing.cart.totalMinor, i18n.language)}</span>
                </div>
              </>
            ) : null}
            {missing.length > 0 ? (
              <Alert tone="warning" className="mt-2 py-2">
                {t('sale.needsSupervisor', {
                  rights: missing.map((r) => t(`sale.rights.${r}`)).join('، '),
                })}
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  onClick={() => setSupervisor({ member: cashier, rights: [], note: null })}
                >
                  {t('sale.supervisorTitle')}
                </Button>
              </Alert>
            ) : null}
            {supervisor && supervisor.rights.length > 0 ? (
              <p className="mt-1 text-xs text-fg-muted">
                {t('sale.supervisorWho')}: {supervisor.member.fullName}
              </p>
            ) : null}
            <Button
              size="touch"
              block
              className="mt-3"
              disabled={
                !pricing?.ok || cart.lines.length === 0 || missing.length > 0 || !canSell || blocked
              }
              onClick={() => setPaying(true)}
              data-testid="pay"
            >
              {t('sale.pay')}{' '}
              {total !== null ? <span dir="ltr">{kwd(total, i18n.language)}</span> : null}
            </Button>
            {lastSale ? (
              <p className="mt-2 text-xs text-fg-muted" data-testid="last-sale">
                {t('sale.completed', {
                  receipt: lastSale.receiptNumber,
                  change: kwd(lastSale.changeMinor, i18n.language),
                })}
              </p>
            ) : null}
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {role === 'primary' ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setCashOpen('cash_in')}
                    disabled={blocked}
                  >
                    {t('sale.cashIn')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setCashOpen('cash_out')}
                    disabled={blocked}
                  >
                    {t('sale.cashOut')}
                  </Button>
                </>
              ) : null}
              <Button variant="secondary" size="sm" onClick={() => setRecentOpen(true)}>
                {t('sale.recent')}
              </Button>
              <Button variant="secondary" size="sm" onClick={onRefunds} disabled={blocked}>
                {t('sale.refundsNav')}
              </Button>
            </div>
            {role === 'primary' ? (
              <Button variant="ghost" size="sm" block className="mt-1" onClick={onClose}>
                {t('sale.closeNav')}
              </Button>
            ) : null}
          </div>
        </section>
      </main>

      {editing ? (
        <LineDialog
          key={editing.key}
          line={editing}
          item={catalog.items.get(editing.variantId) ?? null}
          onClose={() => setEditing(null)}
          onChange={(patch) => updateLine(editing.key, patch)}
        />
      ) : null}
      <DiscountDialog
        key={String(orderDiscountOpen)}
        open={orderDiscountOpen}
        title={t('sale.orderDiscount')}
        value={cart.orderDiscount}
        onClose={() => setOrderDiscountOpen(false)}
        onChange={(d) => setCart({ ...cart, orderDiscount: d })}
      />
      <SupervisorDialog
        open={supervisor !== null && supervisor.rights.length === 0}
        cashier={cashier}
        needed={missing}
        onClose={() => setSupervisor(null)}
        onApproved={(member, rights, note) => setSupervisor({ member, rights, note })}
      />
      <PaymentDialog
        key={`${paying}-${total}`}
        open={paying}
        total={total ?? 0n}
        onClose={() => setPaying(false)}
        onComplete={async (payments, zeroTotalReason) => {
          const prepared = prepareSale(
            {
              cart,
              payments,
              cashier,
              shift,
              supervisor: supervisor && supervisor.rights.length ? supervisor : null,
              zeroTotalReason,
            },
            ctx,
            catalog,
            methods,
          );
          const done = await commitSale(bridge.db, prepared, ctx);
          requestUpload();
          setCart(EMPTY_CART);
          setSupervisor(null);
          setPaying(false);
          setLastSale({ receiptNumber: done.receiptNumber, changeMinor: done.changeMinor });
          toast.success(
            t('sale.completed', {
              receipt: done.receiptNumber,
              change: kwd(done.changeMinor, i18n.language),
            }),
          );
          await reload();
          void printSale(done.saleId);
          searchRef.current?.focus();
        }}
      />
      <CashDialog
        key={cashOpen ?? 'closed'}
        direction={cashOpen}
        onClose={() => setCashOpen(null)}
        onDone={async (direction, amountMinor, note) => {
          await recordCashMovement(bridge.db, {
            cashier,
            shift,
            direction,
            amountMinor,
            note,
            settings: ctx.settings,
            role,
          });
          requestUpload();
          toast.success(t('sale.cashDone'));
          setCashOpen(null);
        }}
      />
      <RecentSalesDialog
        open={recentOpen}
        onClose={() => setRecentOpen(false)}
        onPrint={(id) => void printSale(id, 1)}
      />
    </div>
  );

  async function printSale(saleId: string, copy = 0) {
    try {
      const sale = await getSale(bridge.db, saleId);
      if (!sale) return;
      await bridge.print.receipt(receiptHtmlFor(sale, ctx!, cashier));
      if (copy > 0) toast.success(t('sale.printed'));
    } catch (error) {
      toast.error(t('sale.printFailed', { message: describeError(error, t) }));
    }
  }
}

function LineDialog({
  line,
  item,
  onClose,
  onChange,
}: {
  line: CartLine | null;
  item: CatalogItem | null;
  onClose: () => void;
  onChange: (patch: Partial<CartLine> | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const [qty, setQty] = useState(line?.quantity ?? '1');
  const [price, setPrice] = useState(line?.priceOverride ?? '');
  const [reason, setReason] = useState(line?.priceOverrideReason ?? '');
  if (!line || !item) return null;
  const apply = () => {
    const q = normalizeAmountInput(qty);
    const p = normalizeAmountInput(price);
    onChange({
      quantity: q || '1',
      priceOverride: p ? p : null,
      priceOverrideReason: p ? reason.trim() || null : null,
    });
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={name(item, i18n.language)}
      size="sm"
      footer={
        <>
          <Button variant="danger" onClick={() => (onChange(null), onClose())}>
            {t('sale.remove')}
          </Button>
          <Button onClick={apply}>{t('common:actions.close')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('sale.qty')}>
          {(p) => (
            <Input
              {...p}
              inputMode="decimal"
              dir="ltr"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={t('sale.newPrice')}
          hint={`${t('sale.line')}: ${kwd(item.priceMinor, i18n.language)}`}
        >
          {(p) => (
            <Input
              {...p}
              inputMode="decimal"
              dir="ltr"
              value={price}
              placeholder={Money.ofMinor(item.priceMinor, 'KWD').toDecimalString()}
              onChange={(e) => setPrice(e.target.value)}
            />
          )}
        </Field>
        {price.trim() ? (
          <Field label={t('sale.reason')}>
            {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        ) : null}
        <DiscountFields value={line.discount} onChange={(d) => onChange({ discount: d })} />
      </div>
    </Dialog>
  );
}

function DiscountFields({
  value,
  onChange,
}: {
  value: DiscountInput | null;
  onChange: (d: DiscountInput | null) => void;
}) {
  const { t } = useTranslation();
  const [type, setType] = useState<'none' | 'percent' | 'amount'>(value?.type ?? 'none');
  const [amount, setAmount] = useState(value?.value ?? '');
  const emit = (ty: typeof type, v: string) => {
    const value = normalizeAmountInput(v);
    if (ty === 'none' || !value) onChange(null);
    else onChange({ type: ty, value });
  };
  return (
    <div className="flex flex-col gap-2">
      <Segmented
        label={t('sale.discount')}
        value={type}
        onChange={(v) => {
          setType(v);
          emit(v, amount);
        }}
        options={[
          { value: 'none', label: t('sale.none') },
          { value: 'percent', label: t('sale.percent') },
          { value: 'amount', label: t('sale.amount') },
        ]}
      />
      {type !== 'none' ? (
        <Input
          inputMode="decimal"
          dir="ltr"
          value={amount}
          aria-label={t('sale.discount')}
          onChange={(e) => {
            setAmount(e.target.value);
            emit(type, e.target.value);
          }}
        />
      ) : null}
    </div>
  );
}

function DiscountDialog({
  open,
  title,
  value,
  onClose,
  onChange,
}: {
  open: boolean;
  title: string;
  value: DiscountInput | null;
  onClose: () => void;
  onChange: (d: DiscountInput | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={title}
      size="sm"
      footer={<Button onClick={onClose}>{t('common:actions.close')}</Button>}
    >
      <DiscountFields value={value} onChange={onChange} />
    </Dialog>
  );
}

/** A supervisor picks their name, types their own PIN and lends the rights the cart needs (BR-177). */
function SupervisorDialog({
  open,
  cashier,
  needed,
  onClose,
  onApproved,
}: {
  open: boolean;
  cashier: StaffMember;
  needed: OverridablePermission[];
  onClose: () => void;
  onApproved: (member: StaffMember, rights: OverridablePermission[], note: string | null) => void;
}) {
  const { t } = useTranslation();
  const { bridge, staff } = useDevice();
  const [who, setWho] = useState<StaffMember | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = staff.filter((s) => s.membershipId !== cashier.membershipId && s.pinHash);
  const submit = async (pin: string) => {
    if (!who) return;
    setBusy(true);
    setError(null);
    try {
      const lendable = supervisorRights(who, cashier);
      const rights = needed.filter((r) => lendable.includes(r));
      if (rights.length !== needed.length) throw new Error('OVERRIDE_NOT_ALLOWED');
      const outcome = await attemptPin(bridge.db, who, pin, verifyPin);
      if (!outcome.ok) throw new Error(outcome.reason === 'locked' ? 'locked' : 'wrong');
      onApproved(who, rights, note.trim() || null);
      setWho(null);
      setNote('');
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(
        m === 'wrong'
          ? t('lock.wrong', { count: '' })
          : m === 'locked'
            ? t('lock.locked', { until: '' })
            : describeError(e, t),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('sale.supervisorTitle')}
      description={t('sale.supervisorBody', {
        rights: needed.map((r) => t(`sale.rights.${r}`)).join('، '),
      })}
      size="sm"
    >
      {!who ? (
        <div className="grid grid-cols-2 gap-2">
          {candidates.map((s) => (
            <Button key={s.membershipId} variant="secondary" size="touch" onClick={() => setWho(s)}>
              <bdi>{s.fullName}</bdi>
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <p className="font-medium">{who.fullName}</p>
          <Field label={t('sale.supervisorNote')} className="w-full">
            {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          <PinPad onSubmit={(pin) => void submit(pin)} busy={busy} error={error} />
          <Button variant="ghost" onClick={() => setWho(null)}>
            {t('lock.back')}
          </Button>
        </div>
      )}
    </Dialog>
  );
}

/** Split tenders: cash with change, other methods with a reference; the sum must equal the total. */
function PaymentDialog({
  open,
  total,
  onClose,
  onComplete,
}: {
  open: boolean;
  total: bigint;
  onClose: () => void;
  onComplete: (payments: PaymentInput[], zeroTotalReason: string | null) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const { methods, ctx } = useDevice();
  const usable = methods.filter(
    (m) => m.status === 'active' && m.availableInPos && !m.gatewayProvider,
  );
  const [payments, setPayments] = useState<PaymentInput[]>([]);
  const [methodId, setMethodId] = useState<string>(usable[0]?.id ?? '');
  const [amount, setAmount] = useState(Money.ofMinor(total, 'KWD').toDecimalString());
  const [tendered, setTendered] = useState('');
  const [reference, setReference] = useState('');
  const [zeroReason, setZeroReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paid = payments.reduce((s, p) => s + Money.parse(p.amount, 'KWD').minor, 0n);
  const remaining = total - paid;

  const method = usable.find((m) => m.id === methodId);
  const addPayment = () => {
    setError(null);
    try {
      const minor = Money.parseInput(amount, 'KWD').minor;
      if (minor <= 0n || minor > remaining) throw new Error('PAYMENT_TOTAL_MISMATCH');
      const p: PaymentInput = {
        methodId,
        amount: Money.ofMinor(minor, 'KWD').toDecimalString(),
        tendered:
          method?.kind === 'cash'
            ? Money.ofMinor(
                tendered.trim() ? Money.parseInput(tendered, 'KWD').minor : minor,
                'KWD',
              ).toDecimalString()
            : null,
        reference: reference.trim() || null,
      };
      if (method?.kind === 'cash' && Money.parse(p.tendered!, 'KWD').minor < minor)
        throw new Error('PAYMENT_TOTAL_MISMATCH');
      if (method?.kind !== 'cash' && ctx?.settings.requireTenderReference && !p.reference)
        throw new Error('REFERENCE_REQUIRED');
      const next = [...payments, p];
      setPayments(next);
      const left = total - next.reduce((s, x) => s + Money.parse(x.amount, 'KWD').minor, 0n);
      setAmount(Money.ofMinor(left, 'KWD').toDecimalString());
      setTendered('');
      setReference('');
    } catch (e) {
      setError(describeError(e, t));
    }
  };
  const complete = async () => {
    setBusy(true);
    setError(null);
    try {
      await onComplete(payments, zeroReason.trim() || null);
    } catch (e) {
      setError(describeError(e, t));
    } finally {
      setBusy(false);
    }
  };
  const change = payments.reduce(
    (s, p) =>
      s +
      (p.tendered ? Money.parse(p.tendered, 'KWD').minor - Money.parse(p.amount, 'KWD').minor : 0n),
    0n,
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t('sale.paymentsTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common:actions.back')}
          </Button>
          <Button
            size="lg"
            loading={busy}
            disabled={remaining !== 0n || (total === 0n && !zeroReason.trim())}
            onClick={() => void complete()}
            data-testid="complete-sale"
          >
            {t('sale.complete')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex justify-between text-lg font-semibold">
          <span>{t('sale.due')}</span>
          <span dir="ltr">{kwd(total, i18n.language)}</span>
        </div>
        {total === 0n ? (
          <Field label={t('sale.zeroReason')}>
            {(p) => (
              <Input {...p} value={zeroReason} onChange={(e) => setZeroReason(e.target.value)} />
            )}
          </Field>
        ) : null}
        {payments.length > 0 ? (
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {payments.map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-2 px-3 py-2">
                <span>
                  {name(
                    usable.find((m) => m.id === p.methodId) ?? { nameEn: p.methodId, nameAr: null },
                    i18n.language,
                  )}
                </span>
                <span dir="ltr">{p.amount}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPayments(payments.filter((_, j) => j !== i))}
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {remaining > 0n ? (
          <>
            <div className="flex flex-wrap gap-2">
              {usable.map((m) => (
                <Button
                  key={m.id}
                  variant={m.id === methodId ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setMethodId(m.id)}
                >
                  <bdi>{name(m, i18n.language)}</bdi>
                </Button>
              ))}
            </div>
            <Field label={t('sale.amount')}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="decimal"
                  dir="ltr"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              )}
            </Field>
            {method?.kind === 'cash' ? (
              <Field label={t('sale.tendered')}>
                {(p) => (
                  <Input
                    {...p}
                    inputMode="decimal"
                    dir="ltr"
                    value={tendered}
                    placeholder={amount}
                    onChange={(e) => setTendered(e.target.value)}
                    data-testid="tendered"
                  />
                )}
              </Field>
            ) : (
              <Field label={t('sale.reference')}>
                {(p) => (
                  <Input
                    {...p}
                    dir="ltr"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                )}
              </Field>
            )}
            <Button variant="secondary" onClick={addPayment} data-testid="add-payment">
              {t('sale.addPayment')}{' '}
              {remaining > 0n ? <span dir="ltr">({kwd(remaining, i18n.language)})</span> : null}
            </Button>
          </>
        ) : null}
        <div
          className={cn(
            'flex justify-between text-sm',
            remaining === 0n ? 'text-success' : 'text-fg-muted',
          )}
        >
          <span>{remaining === 0n ? t('sale.change') : t('sale.remaining')}</span>
          <span dir="ltr">{kwd(remaining === 0n ? change : remaining, i18n.language)}</span>
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Dialog>
  );
}

function CashDialog({
  direction,
  onClose,
  onDone,
}: {
  direction: 'cash_in' | 'cash_out' | null;
  onClose: () => void;
  onDone: (
    direction: 'cash_in' | 'cash_out',
    amountMinor: bigint,
    note: string | null,
  ) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!direction) return;
    setBusy(true);
    setError(null);
    try {
      await onDone(direction, Money.parseInput(amount, 'KWD').minor, note.trim() || null);
    } catch (e) {
      setError(describeError(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={direction !== null}
      onOpenChange={(o) => !o && onClose()}
      title={
        direction
          ? t(`sale.${direction === 'cash_in' ? 'cashIn' : 'cashOut'}`)
          : t('sale.cashTitle')
      }
      size="sm"
      footer={
        <Button loading={busy} disabled={!amount.trim()} onClick={() => void submit()}>
          {t('sale.cashTitle')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('sale.cashAmount')}>
          {(p) => (
            <Input
              {...p}
              inputMode="decimal"
              dir="ltr"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
          )}
        </Field>
        <Field label={t('sale.cashNote')}>
          {(p) => <Input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Dialog>
  );
}

function RecentSalesDialog({
  open,
  onClose,
  onPrint,
}: {
  open: boolean;
  onClose: () => void;
  onPrint: (saleId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { bridge, shift } = useDevice();
  const [sales, setSales] = useState<Awaited<ReturnType<typeof listSales>>>([]);
  useEffect(() => {
    if (open && shift) void listSales(bridge.db, { shiftId: shift.id, limit: 30 }).then(setSales);
  }, [open, bridge, shift]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t('sale.recent')} size="sm">
      <ul className="divide-y divide-border text-sm">
        {sales.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 py-2">
            <span dir="ltr" className="font-medium">
              {s.receiptNumber}
            </span>
            <span dir="ltr">{kwd(s.totalMinor, i18n.language)}</span>
            <Button variant="secondary" size="sm" onClick={() => onPrint(s.id)}>
              {t('sale.reprint')}
            </Button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

export type { PreparedSale, Cart };
