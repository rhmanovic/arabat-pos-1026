import type { StoreProduct } from '@arabat/contracts';
import type { Money } from '@arabat/money';
import { cn } from '@arabat/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { storePath } from '../address.js';
import { priceLines, toMoney, useCart } from '../cart.js';
import { useMoney, useStoreProducts, useStorefront } from '../shared.js';
import { useDesign } from './context.js';

/*
 * Delivery-app touches for the menu (owner, 2026-10-24, from Talabat): a round + on the dish
 * picture adds one at once and opens − n +; left alone it folds into a bubble with the
 * quantity. A cart bar at the bottom shows the count, "View cart", the total and how much is
 * left to the minimum order or to free delivery.
 */

/** How long − n + stays open after the last touch. */
const FOLD_MS = 2500;

export function MenuQuickAdd({ product }: { product: StoreProduct }) {
  const { data: store } = useStorefront();
  const cart = useCart();
  const { t, i18n } = useTranslation();
  const name =
    (i18n.language.startsWith('ar')
      ? product.nameAr || product.nameEn
      : product.nameEn || product.nameAr) ?? '';
  const single = product.variants.length === 1 ? product.variants[0]! : null;
  const quantity = single
    ? (cart.lines.find((l) => l.variantId === single.variantId)?.quantity ?? 0)
    : 0;
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touch = () => {
    setOpen(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), FOLD_MS);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const round =
    'grid size-9 place-items-center rounded-full text-xl leading-none font-bold shadow-md';
  if (!store) return null;
  // Products with options open their page to choose (like a delivery app's options sheet).
  if (!single)
    return (
      <Link
        to={storePath(store.slug, `/products/${product.productId}`)}
        aria-label={t('design.chooseOptions')}
        className={cn(round, 'relative z-10 bg-surface text-primary')}
      >
        +
      </Link>
    );
  if (!single.available) return null;
  const add = () => {
    cart.add(
      { variantId: single.variantId, productId: product.productId, quantity: 1 },
      single.maxQuantity,
    );
    touch();
  };
  if (quantity === 0)
    return (
      <button
        type="button"
        aria-label={t('design.addOne', { name })}
        onClick={(e) => {
          e.preventDefault();
          add();
        }}
        className={cn(round, 'relative z-10 bg-surface text-primary active:scale-90')}
      >
        +
      </button>
    );
  if (!open)
    return (
      <button
        type="button"
        aria-label={t('design.inCart', { count: quantity, name })}
        onClick={(e) => {
          e.preventDefault();
          touch();
        }}
        className={cn(round, 'quick-pop relative z-10 bg-primary text-base text-primary-fg')}
        data-testid="quick-count"
      >
        {quantity}
      </button>
    );
  return (
    <div
      dir="ltr"
      className="quick-pop relative z-10 flex h-9 items-center gap-1 rounded-full bg-surface px-1 shadow-md"
      data-testid="quick-stepper"
    >
      <button
        type="button"
        aria-label={t('design.removeOne', { name })}
        onClick={(e) => {
          e.preventDefault();
          cart.setQuantity(single.variantId, quantity - 1);
          touch();
        }}
        className="grid size-7 place-items-center rounded-full text-lg font-bold text-primary"
      >
        −
      </button>
      <span className="min-w-5 text-center text-sm font-bold tabular-nums" aria-live="polite">
        {quantity}
      </span>
      <button
        type="button"
        aria-label={t('design.addOne', { name })}
        disabled={quantity >= single.maxQuantity}
        onClick={(e) => {
          e.preventDefault();
          add();
        }}
        className="grid size-7 place-items-center rounded-full text-lg font-bold text-primary disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

/** The cart bar at the bottom of the screen, while the cart holds something. */
export function MenuCartBar() {
  const { data: store } = useStorefront();
  const products = useStoreProducts();
  const cart = useCart();
  const design = useDesign();
  const money = useMoney();
  const { t } = useTranslation();
  const shown = Boolean(store && products.data && cart.count > 0);
  // Room at the bottom of the page while the bar shows, so it never covers the last dishes or
  // the footer.
  useEffect(() => {
    if (!shown) return;
    const before = document.body.style.paddingBottom;
    document.body.style.paddingBottom = '7rem';
    return () => {
      document.body.style.paddingBottom = before;
    };
  }, [shown]);
  if (!store || !products.data || cart.count === 0) return null;
  const { subtotal } = priceLines(cart.lines, products.data.products, store, 'pickup');
  // How much is left: first to the minimum order, then to the lowest free-delivery threshold.
  const minimum = toMoney(store.minimumOrder);
  const free = store.deliveryAreas
    .map((a) => (a.freeDeliveryFrom ? toMoney(a.freeDeliveryFrom) : null))
    .filter((m): m is Money => m !== null)
    .reduce<Money | null>((low, m) => (low === null || m.compare(low) < 0 ? m : low), null);
  const goal =
    subtotal.compare(minimum) < 0
      ? { key: 'design.toMinimum', target: minimum }
      : store.deliveryEnabled && free && subtotal.compare(free) < 0
        ? { key: 'design.toFreeDelivery', target: free }
        : null;
  // Integer fils: the width of the progress line only (never shown as money).
  const percent =
    goal && goal.target.minor > 0n
      ? Math.max(4, Math.min(100, Number((subtotal.minor * 100n) / goal.target.minor)))
      : 100;
  return (
    <>
      <div
        className={cn(
          'cart-bar fixed inset-x-0 z-30 px-3 pb-2',
          design.mobileBar.enabled ? 'bottom-16 sm:bottom-0' : 'bottom-0',
        )}
        style={{
          paddingBottom: design.mobileBar.enabled
            ? undefined
            : 'max(0.5rem, env(safe-area-inset-bottom))',
        }}
        data-testid="cart-bar"
      >
        <div className="mx-auto flex max-w-xl flex-col gap-2">
          {goal ? (
            <div className="rounded-xl bg-surface/95 px-3 py-2 text-sm shadow backdrop-blur">
              <p className="font-medium">
                {t(goal.key, { amount: money(goal.target.subtract(subtotal)) })}
              </p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          ) : null}
          <Link
            to={storePath(store.slug, '/cart')}
            className="flex items-center gap-3 rounded-full bg-primary px-3 py-2.5 font-bold text-primary-fg shadow-lg active:scale-[0.99]"
          >
            <span
              key={cart.count}
              className="quick-pop grid size-8 place-items-center rounded-full bg-black/15 text-sm tabular-nums"
            >
              {cart.count}
            </span>
            <span className="flex-1">{t('design.viewCart')}</span>
            <span className="tabular-nums">{money(subtotal)}</span>
          </Link>
        </div>
      </div>
    </>
  );
}
