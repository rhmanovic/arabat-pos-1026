import type { PosCatalogItem } from '@arabat/contracts';
import { formatMoney } from '@arabat/i18n';
import { Money } from '@arabat/money';
import { Badge, Button, cn } from '@arabat/ui';
import { localizedName, useApi, useAuth } from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ShiftStrip } from '../pages/ShiftPages.js';
import { useRestaurantEnabled } from '../restaurant/RestaurantPages.js';
import { type CartLine, priceLines, useCart } from './cart.js';
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
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-3 md:grid-cols-[1fr_24rem] md:grid-rows-1">
        <section
          aria-labelledby="catalog-title"
          className="flex min-h-0 flex-col gap-3 rounded-lg bg-surface p-3"
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
              placeholder={t('sale.searchHint')}
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
            className="flex gap-2 overflow-x-auto pb-1"
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
            className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4"
            aria-label={t('register.catalogTitle')}
          >
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
                    onClick={() => cart.add(item.variantId)}
                    className="flex h-28 w-full flex-col justify-between rounded-lg border border-border p-3 text-start hover:border-primary active:bg-primary-soft"
                    data-testid="product-tile"
                  >
                    <span className="line-clamp-2 font-medium">
                      {itemLabel(item, i18n.language)}
                    </span>
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
          className="flex min-h-0 flex-col rounded-lg bg-surface p-3"
        >
          <h2 id="cart-title" className="mb-2 text-lg font-semibold">
            {t('sale.cart')}
          </h2>
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
                  <li key={l.key}>
                    <button
                      type="button"
                      onClick={() => setEditing(l)}
                      className={cn(
                        'flex w-full items-start justify-between gap-2 py-2 text-start',
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
              disabled={cart.state.lines.length === 0}
              onClick={() => cart.clear()}
            >
              {t('sale.clear')}
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
            >
              {t('sale.orderDiscount')}
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
            setReceiptId(saleId);
          }}
        />
      ) : null}
      {receiptId ? <ReceiptDialog saleId={receiptId} onClose={() => setReceiptId(null)} /> : null}
    </div>
  );
}
