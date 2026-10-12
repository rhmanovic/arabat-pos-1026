import type { PosCatalogItem } from '@arabat/contracts';
import { formatMoney } from '@arabat/i18n';
import { Money, parseQuantity } from '@arabat/money';
import { Badge, Button, Spinner, cn } from '@arabat/ui';
import { ErrorState, localizedName, useApi, useAuth } from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ShiftStrip } from '../pages/ShiftPages.js';
import { useRestaurantEnabled } from '../restaurant/RestaurantPages.js';
import { type CartLine, formatQty, priceLines, useCart } from './cart.js';
import { CustomerBar } from './customer.js';
import {
  HeldSalesDialog,
  LineDialog,
  OrderDiscountDialog,
  PaymentDialog,
  ReceiptDialog,
  RecentSalesDialog,
  SuspendDialog,
} from './dialogs.js';

export const catalogKey = ['pos', 'catalog'] as const;
export const availabilityKey = ['pos', 'availability'] as const;

export function useMoneyFormat() {
  const { i18n } = useTranslation();
  return (value: { amount: string; currency: string } | bigint) =>
    formatMoney(
      typeof value === 'bigint'
        ? Money.ofMinor(value, 'KWD')
        : Money.fromJSON(value as { amount: string; currency: 'KWD' }),
      i18n.language,
    );
}

export function itemLabel(item: PosCatalogItem, language: string): string {
  const product = localizedName(item, language);
  const variant =
    item.variantNameEn || item.variantNameAr
      ? localizedName({ nameEn: item.variantNameEn, nameAr: item.variantNameAr }, language)
      : null;
  return variant ? `${product} — ${variant}` : product;
}

/** The register screen: catalog and search on one side, the current sale on the other. */
export function SalePage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { hasPermission } = useAuth();
  const fmt = useMoneyFormat();
  const cart = useCart();
  const restaurant = useRestaurantEnabled();
  const catalog = useQuery({
    queryKey: catalogKey,
    queryFn: () => api.catalog.posCatalog(),
    staleTime: 60_000,
  });
  const availability = useQuery({
    queryKey: availabilityKey,
    queryFn: () => api.inventory.posAvailability(),
    staleTime: 15_000,
  });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [editing, setEditing] = useState<CartLine | null>(null);
  /** The cart line whose quick actions (−/+, edit, remove) are shown. */
  const [selected, setSelected] = useState<string | null>(null);
  /** Phones show the catalog full screen; the cart opens over it from the bottom bar. */
  const [cartOpen, setCartOpen] = useState(false);
  /** Brief highlight of the tile just added, plus a short vibration where supported. */
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedback = (variantId: string) => {
    try {
      navigator.vibrate?.(10);
    } catch {
      // Vibration is optional.
    }
    setFlash(variantId);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 400);
  };
  /** "Clear" needs a second tap within a few seconds so one slip cannot wipe the sale. */
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    if (!confirmClear) return;
    const id = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(id);
  }, [confirmClear]);
  const [dialog, setDialog] = useState<'pay' | 'discount' | 'suspend' | 'held' | 'recent' | null>(
    null,
  );
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const items = useMemo(
    () => new Map((catalog.data?.items ?? []).map((i) => [i.variantId, i])),
    [catalog.data],
  );
  const stock = useMemo(
    () => new Map((availability.data?.items ?? []).map((a) => [a.variantId, a])),
    [availability.data],
  );
  const term = search.trim().toLowerCase();
  const visible = (catalog.data?.items ?? []).filter((i) => {
    if (category && i.categoryId !== category) return false;
    if (!term) return true;
    return (
      itemLabel(i, i18n.language).toLowerCase().includes(term) ||
      (i.nameEn ?? '').toLowerCase().includes(term) ||
      (i.nameAr ?? '').includes(term) ||
      (i.sku ?? '').toLowerCase().includes(term) ||
      i.barcodes.some((b) => b.toLowerCase() === term)
    );
  });
  const linesReady = cart.state.lines.every((l) => items.has(l.variantId));
  const pricing = linesReady && cart.state.lines.length > 0 ? priceLines(cart.state, items) : null;

  // Barcode scanners type quickly and end with Enter; keep the search box focused.
  useEffect(() => {
    if (!dialog && !editing && !receiptId) searchRef.current?.focus();
  }, [dialog, editing, receiptId]);

  const submitSearch = () => {
    const code = search.trim();
    if (!code) return;
    const lower = code.toLowerCase();
    const exact = (catalog.data?.items ?? []).find(
      (i) =>
        i.barcodes.some((b) => b.toLowerCase() === lower) || (i.sku ?? '').toLowerCase() === lower,
    );
    const match = exact ?? (visible.length === 1 ? visible[0] : undefined);
    if (match) {
      cart.add(match.variantId);
      feedback(match.variantId);
      setSearch('');
      setNotFound(null);
    } else setNotFound(code);
  };

  const canDiscount = hasPermission('sales.discount');
  const total = pricing?.ok ? pricing.cart.totalMinor : null;

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <ShiftStrip
        extra={
          <>
            <Button size="sm" variant="secondary" onClick={() => setDialog('recent')}>
              {t('sale.recent')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDialog('held')}>
              {t('sale.heldSales')}
            </Button>
            {restaurant && hasPermission('restaurant.orders') ? (
              <Link
                to="/tables"
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium"
              >
                {t('restaurant.tables')}
              </Link>
            ) : null}
            {restaurant && hasPermission('kitchen.access') ? (
              <Link
                to="/kitchen"
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium"
              >
                {t('kitchen.title')}
              </Link>
            ) : null}
            {hasPermission('refunds.create') ? (
              <Link
                to="/returns"
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium"
              >
                {t('returns.open')}
              </Link>
            ) : null}
          </>
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-3 md:grid-cols-[minmax(0,1fr)_24rem]">
        <section
          aria-labelledby="catalog-title"
          className="flex min-w-0 min-h-0 flex-col gap-3 rounded-lg bg-surface p-3"
        >
          <h1 id="catalog-title" className="sr-only">
            {t('register.catalogTitle')}
          </h1>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitSearch();
            }}
          >
            <input
              ref={searchRef}
              type="search"
              aria-label={t('sale.search')}
              placeholder={t('sale.searchHintShort')}
              autoComplete="off"
              className="h-14 w-full rounded-lg border border-border bg-surface px-4 text-lg outline-none focus:border-primary"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setNotFound(null);
              }}
            />
          </form>
          {notFound ? (
            <p role="alert" className="text-sm text-danger">
              {t('sale.notFound', { code: notFound })}
            </p>
          ) : null}
          <div
            className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] md:[scrollbar-width:auto]"
            role="group"
            aria-label={t('sale.allCategories')}
          >
            {[
              { id: null, label: t('sale.allCategories') },
              ...(catalog.data?.categories ?? []).map((c) => ({
                id: c.id,
                label: localizedName(c, i18n.language),
              })),
            ].map((c) => (
              <button
                key={c.id ?? 'all'}
                type="button"
                aria-pressed={category === c.id}
                onClick={() => setCategory(c.id)}
                className="h-11 shrink-0 rounded-full border border-border px-4 text-sm font-medium aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary"
              >
                {c.label}
              </button>
            ))}
          </div>
          <ul
            className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto [scrollbar-width:none] sm:grid-cols-3 md:[scrollbar-width:auto] lg:grid-cols-4"
            aria-label={t('register.catalogTitle')}
          >
            {catalog.isPending ? (
              <li className="col-span-full flex justify-center p-6 text-primary">
                <Spinner label={t('common:status.loading')} />
              </li>
            ) : null}
            {catalog.isError ? (
              <li className="col-span-full p-2">
                <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
              </li>
            ) : null}
            {visible.length === 0 && catalog.data ? (
              <li className="col-span-full p-6 text-center text-fg-muted">
                {t('sale.noProducts')}
              </li>
            ) : null}
            {visible.map((item) => {
              const s = stock.get(item.variantId);
              return (
                <li key={item.variantId}>
                  <button
                    type="button"
                    onClick={() => {
                      cart.add(item.variantId);
                      feedback(item.variantId);
                    }}
                    className={cn(
                      'flex min-h-28 w-full flex-col justify-between gap-1 rounded-lg border border-border p-3 text-start transition-colors hover:border-primary active:bg-primary-soft',
                      flash === item.variantId && 'border-primary bg-primary-soft',
                    )}
                    data-testid="product-tile"
                  >
                    <span className="line-clamp-2 font-medium">
                      {itemLabel(item, i18n.language)}
                    </span>
                    {item.trackInventory && s ? (
                      <span className="text-xs text-fg-muted" data-testid="tile-stock">
                        {t('sale.inStock', { qty: formatQty(parseQuantity(s.onHand)) })}
                      </span>
                    ) : null}
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-semibold tabular-nums" dir="ltr">
                        {fmt(item.price)}
                      </span>
                      {item.trackInventory &&
                      s &&
                      (s.status === 'out' || s.status === 'negative') ? (
                        <Badge tone="danger">{t('sale.outOfStock')}</Badge>
                      ) : item.trackInventory && s?.status === 'low' ? (
                        <Badge tone="warning">{t('sale.lowStock')}</Badge>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <aside
          aria-labelledby="cart-title"
          className={cn(
            'min-h-0 flex-col bg-surface p-3 md:static md:z-auto md:flex md:rounded-lg',
            cartOpen ? 'fixed inset-0 z-30 flex' : 'hidden',
          )}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 id="cart-title" className="text-lg font-semibold">
              {t('sale.cart')}
            </h2>
            <Button
              variant="secondary"
              className="h-11 md:hidden"
              onClick={() => setCartOpen(false)}
            >
              {t('sale.backToProducts')}
            </Button>
          </div>
          <CustomerBar />
          {cart.state.lines.length === 0 ? (
            <p className="flex-1 text-fg-muted">{t('sale.empty')}</p>
          ) : (
            <ul
              className="min-h-0 flex-1 divide-y divide-border overflow-y-auto"
              aria-label={t('sale.cart')}
            >
              {cart.state.lines.map((l, index) => {
                const item = items.get(l.variantId);
                const priced = pricing?.ok ? pricing.cart.lines[index] : null;
                const bad = pricing && !pricing.ok && pricing.line === index;
                return (
                  <li
                    key={l.key}
                    className={cn('rounded-md px-2 py-2', selected === l.key && 'bg-primary-soft')}
                  >
                    <button
                      type="button"
                      aria-expanded={selected === l.key}
                      onClick={() => setSelected(selected === l.key ? null : l.key)}
                      className={cn(
                        'flex w-full items-start justify-between gap-2 text-start',
                        bad && 'text-danger',
                      )}
                      data-testid="cart-line"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {item ? itemLabel(item, i18n.language) : '…'}
                        </span>
                        <span className="block text-sm text-fg-muted" dir="ltr">
                          {l.quantity} × {l.priceOverride ?? item?.price.amount}
                          {l.discount
                            ? ` · −${l.discount.value}${l.discount.type === 'percent' ? '%' : ''}`
                            : ''}
                        </span>
                        {bad ? <span className="block text-xs">{t('sale.invalid')}</span> : null}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums" dir="ltr">
                        {priced ? fmt(priced.netMinor) : '—'}
                      </span>
                    </button>
                    {selected === l.key ? (
                      <div className="mt-2 flex items-center gap-2">
                        <QuantityStepper line={l} />
                        <span className="flex-1" />
                        <Button className="h-11" variant="secondary" onClick={() => setEditing(l)}>
                          {t('sale.edit')}
                        </Button>
                        <Button
                          className="h-11"
                          variant="secondary"
                          onClick={() => cart.remove(l.key)}
                        >
                          {t('sale.remove')}
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <dl className="mt-2 grid gap-1 border-t border-border pt-2 text-sm" data-testid="totals">
            {pricing?.ok ? (
              <>
                <div className="flex justify-between">
                  <dt>{t('sale.subtotal')}</dt>
                  <dd dir="ltr" className="tabular-nums">
                    {fmt(pricing.cart.subtotalMinor)}
                  </dd>
                </div>
                {pricing.cart.lineDiscountsMinor + pricing.cart.orderDiscountMinor > 0n ? (
                  <div className="flex justify-between text-success">
                    <dt>{t('sale.discounts')}</dt>
                    <dd dir="ltr" className="tabular-nums">
                      −{fmt(pricing.cart.lineDiscountsMinor + pricing.cart.orderDiscountMinor)}
                    </dd>
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="flex justify-between text-2xl font-semibold">
              <dt>{t('sale.total')}</dt>
              <dd dir="ltr" className="tabular-nums" data-testid="cart-total">
                {total !== null ? fmt(total) : fmt(0n)}
              </dd>
            </div>
          </dl>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Button
              variant="secondary"
              className={cn(confirmClear && 'border-danger bg-danger/10 text-danger')}
              disabled={cart.state.lines.length === 0}
              onClick={() => {
                if (!confirmClear) return setConfirmClear(true);
                setConfirmClear(false);
                cart.clear();
              }}
            >
              {confirmClear ? t('sale.confirmClear') : t('sale.clear')}
            </Button>
            <Button
              variant="secondary"
              disabled={cart.state.lines.length === 0 || !pricing?.ok}
              onClick={() => setDialog('suspend')}
            >
              {t('sale.suspend')}
            </Button>
            <Button
              variant="secondary"
              disabled={!canDiscount || cart.state.lines.length === 0}
              onClick={() => setDialog('discount')}
              aria-label={t('sale.orderDiscount')}
            >
              {t('sale.discountShort')}
            </Button>
          </div>
          <Button
            size="lg"
            className="mt-2 h-16 text-xl"
            disabled={!pricing?.ok}
            onClick={() => setDialog('pay')}
          >
            {t('sale.pay')} {total !== null ? fmt(total) : ''}
          </Button>
        </aside>
      </div>
      <Button
        size="lg"
        className="h-14 shrink-0 justify-between text-lg md:hidden"
        onClick={() => setCartOpen(true)}
        data-testid="open-cart"
      >
        <span>{t('sale.viewCart', { count: cart.state.lines.length })}</span>
        <span dir="ltr" className="tabular-nums">
          {fmt(total ?? 0n)}
        </span>
      </Button>

      {editing ? (
        <LineDialog
          line={editing}
          item={items.get(editing.variantId)}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {dialog === 'discount' ? <OrderDiscountDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'suspend' ? <SuspendDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'held' ? <HeldSalesDialog onClose={() => setDialog(null)} /> : null}
      {dialog === 'recent' ? (
        <RecentSalesDialog
          onClose={() => setDialog(null)}
          onOpen={(id) => {
            setDialog(null);
            setReceiptId(id);
          }}
        />
      ) : null}
      {dialog === 'pay' && pricing?.ok ? (
        <PaymentDialog
          totalMinor={pricing.cart.totalMinor}
          onClose={() => setDialog(null)}
          onCompleted={(saleId) => {
            setDialog(null);
            setCartOpen(false);
            setReceiptId(saleId);
          }}
        />
      ) : null}
      {receiptId ? <ReceiptDialog saleId={receiptId} onClose={() => setReceiptId(null)} /> : null}
    </div>
  );
}

/** −/+ buttons that change a cart line by one unit; going below one unit removes the line. */
function QuantityStepper({ line }: { line: CartLine }) {
  const { t } = useTranslation();
  const cart = useCart();
  let milli: bigint | null;
  try {
    milli = parseQuantity(line.quantity);
  } catch {
    milli = null;
  }
  const step = (delta: bigint) => {
    if (milli === null) return;
    const next = milli + delta;
    if (next <= 0n) cart.remove(line.key);
    else cart.update(line.key, { quantity: formatQty(next) });
  };
  return (
    <div className="flex items-center gap-1" dir="ltr">
      <button
        type="button"
        aria-label={t('sale.decrease')}
        disabled={milli === null}
        onClick={() => step(-1000n)}
        className="flex size-11 items-center justify-center rounded-md border border-border bg-surface text-lg font-semibold hover:border-primary disabled:opacity-50"
      >
        −
      </button>
      <span className="min-w-8 text-center font-semibold tabular-nums" data-testid="line-qty">
        {line.quantity}
      </span>
      <button
        type="button"
        aria-label={t('sale.increase')}
        disabled={milli === null}
        onClick={() => step(1000n)}
        className="flex size-11 items-center justify-center rounded-md border border-border bg-surface text-lg font-semibold hover:border-primary disabled:opacity-50"
      >
        +
      </button>
    </div>
  );
}
