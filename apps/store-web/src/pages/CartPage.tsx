import type { StoreProduct } from '@arabat/contracts';
import { Alert, Button, Spinner, cn } from '@arabat/ui';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { priceLines, sampleLines, toMoney, useCart } from '../cart.js';
import { isPreview, useDesign, useText } from '../design/context.js';
import { StoreIcon } from '../design/parts.js';
import { Highlights, ProductRow, useOutOfView } from '../design/product-parts.js';
import { DesignedPage } from '../design/sections.js';
import { useLocalName, useMoney, useSlug, useStoreProducts, useStorefront } from '../shared.js';

/** Products offered with the cart: never one in it or sold out; the featured first. */
function upsellProducts(
  all: StoreProduct[],
  inCart: Set<string>,
  source: 'featured' | 'all',
  limit: number,
): StoreProduct[] {
  const free = all.filter((p) => !inCart.has(p.productId) && p.variants.some((v) => v.available));
  const order = source === 'featured' ? [...free.filter((p) => p.featured), ...free] : free;
  return [...new Map(order.map((p) => [p.productId, p])).values()].slice(0, limit);
}

/** The cart, drawn by the store design's cart page (ADR-0128 amendment 5). */
export function CartPage() {
  const slug = useSlug();
  const cart = useCart();
  const products = useStoreProducts();
  const { data: store } = useStorefront();
  const page = useDesign().cartPage;
  const design = useDesign();
  const name = useLocalName();
  const money = useMoney();
  const text = useText();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const checkoutRef = useRef<HTMLDivElement>(null);
  const sample =
    isPreview() && cart.lines.length === 0 && products.data
      ? sampleLines(products.data.products)
      : null;
  const lines = sample ?? cart.lines;
  const priced =
    products.data && store ? priceLines(lines, products.data.products, store, 'pickup') : null;
  const missing = priced?.missing.length ?? 0;
  const filled = Boolean(priced && priced.priced.length > 0);
  const away = useOutOfView(checkoutRef, page.stickyCheckout && filled);

  // Sold-out or unlisted items leave the cart (the shopper is told below).
  useEffect(() => {
    if (priced && missing > 0 && !sample) for (const l of priced.missing) cart.remove(l.variantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing]);

  if (products.isPending || !store) return <Spinner label={t('common:status.loading')} />;
  const all = products.data?.products ?? [];
  if (!priced || (priced.priced.length === 0 && missing === 0))
    return (
      <div className="flex flex-col gap-10">
        <div
          className="flex flex-col items-center gap-3 py-10 text-center"
          data-testid="cart-empty"
        >
          <span className="grid size-16 place-items-center rounded-full bg-primary-soft text-primary">
            <StoreIcon name="bag" className="size-8" />
          </span>
          <h1 className="text-xl font-semibold">{text(page.empty.title) || t('cart.empty')}</h1>
          {text(page.empty.text) ? (
            <p className="max-w-md text-fg-muted">{text(page.empty.text)}</p>
          ) : null}
          <Link to={`/${slug}`} className="text-primary hover:underline">
            {t('cart.browse')}
          </Link>
        </div>
        {page.empty.showProducts ? (
          <ProductRow
            title={text(page.upsell.title) || t('cart.suggested')}
            products={upsellProducts(all, new Set(), 'featured', 4)}
            variant="grid"
            quickAdd
            testId="cart-empty-products"
          />
        ) : null}
      </div>
    );
  const minimum = toMoney(store.minimumOrder);
  const belowMinimum = priced.subtotal.compare(minimum) < 0;
  const reached =
    minimum.isZero() || !belowMinimum
      ? 100
      : Math.min(100, Number((priced.subtotal.minor * 100n) / minimum.minor));
  const canCheckout = !belowMinimum && store.acceptingOrders && priced.priced.length > 0;
  const checkoutLabel = text(page.checkoutLabel) || t('cart.checkout');
  const goCheckout = () => void navigate(`/${slug}/checkout`);
  const upsell = page.upsell.enabled
    ? upsellProducts(
        all,
        new Set(priced.priced.map((l) => l.productId)),
        page.upsell.source,
        page.upsell.limit,
      )
    : [];

  const summary = (
    <div
      className={cn(
        'flex h-fit flex-col gap-3 rounded-lg border border-border bg-surface p-4',
        page.layout === 'split' && 'md:sticky md:top-24',
      )}
      data-testid="cart-summary"
    >
      <div className="flex items-center justify-between gap-2 text-lg">
        <span>{t('cart.subtotal')}</span>
        <span className="font-semibold tabular-nums">{money(priced.subtotal)}</span>
      </div>
      <p className="text-xs text-fg-muted">{t('cart.feesAtCheckout')}</p>
      {page.minimumBar && !minimum.isZero() ? (
        <div className="flex flex-col gap-1">
          <div
            className="h-2 overflow-hidden rounded-full bg-surface-muted"
            role="progressbar"
            aria-label={t('cart.minimumProgress')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={reached}
          >
            <div
              className={cn('h-full rounded-full', belowMinimum ? 'bg-warning' : 'bg-success')}
              style={{ width: `${reached}%` }}
            />
          </div>
          {belowMinimum ? (
            <p className="text-xs text-fg-muted">
              {t('cart.toMinimum', { amount: money(minimum.subtract(priced.subtotal)) })}
            </p>
          ) : null}
        </div>
      ) : null}
      {belowMinimum ? (
        <p className="text-sm text-danger">{t('cart.minimum', { amount: money(minimum) })}</p>
      ) : null}
      <div ref={checkoutRef}>
        <Button size="lg" className="w-full" disabled={!canCheckout} onClick={goCheckout}>
          {checkoutLabel}
        </Button>
      </div>
      {page.continueShopping ? (
        <Link to={`/${slug}/products`} className="text-center text-sm text-primary hover:underline">
          {t('cart.continue')}
        </Link>
      ) : null}
      <Highlights items={page.highlights} testId="cart-highlights" />
    </div>
  );

  return (
    <div className={cn('flex flex-col gap-10', page.stickyCheckout && 'max-sm:pb-20')}>
      <div
        className={cn(
          'grid grid-cols-[minmax(0,1fr)] gap-6',
          page.layout === 'split'
            ? 'md:grid-cols-[minmax(0,1fr)_20rem]'
            : 'mx-auto w-full max-w-3xl',
        )}
        data-testid="cart-page"
        data-layout={page.layout}
      >
        <div className="flex min-w-0 flex-col gap-4">
          <h1 className="text-2xl font-semibold">{t('cart.title')}</h1>
          {sample ? <Alert tone="info">{t('cart.sample')}</Alert> : null}
          {text(page.message) ? (
            <p className="rounded-lg bg-primary-soft px-4 py-3 text-sm" data-testid="cart-message">
              {text(page.message)}
            </p>
          ) : null}
          {missing > 0 ? <Alert tone="warning">{t('cart.gone')}</Alert> : null}
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {priced.priced.map((l) => {
              const label = [name(l.product), name(l.variant)].filter(Boolean).join(' — ');
              return (
                <li key={l.variantId} className="flex flex-wrap items-center gap-3 p-3">
                  {page.images ? (
                    <Link
                      to={`/${slug}/products/${l.productId}`}
                      className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-muted text-fg-subtle"
                      tabIndex={-1}
                      aria-hidden
                    >
                      {l.product.imageUrl ? (
                        <img src={l.product.imageUrl} alt="" className="size-full object-cover" />
                      ) : (
                        <StoreIcon name="bag" className="size-6 opacity-50" />
                      )}
                    </Link>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{label}</p>
                    <p className="text-sm tabular-nums text-fg-muted">{money(l.unitPrice)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="icon"
                      aria-label={t('cart.decrease', { name: label })}
                      onClick={() => cart.setQuantity(l.variantId, l.quantity - 1)}
                    >
                      −
                    </Button>
                    <span className="w-8 text-center tabular-nums" data-testid="cart-qty">
                      {l.quantity}
                    </span>
                    <Button
                      variant="secondary"
                      size="icon"
                      aria-label={t('cart.increase', { name: label })}
                      disabled={l.quantity >= l.variant.maxQuantity}
                      onClick={() => cart.setQuantity(l.variantId, l.quantity + 1)}
                    >
                      +
                    </Button>
                  </div>
                  <p className="w-24 text-end font-medium tabular-nums">{money(l.lineTotal)}</p>
                  <Button variant="ghost" size="sm" onClick={() => cart.remove(l.variantId)}>
                    {t('cart.remove')}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
        {summary}
      </div>
      {design.pages.cart.length > 0 ? <DesignedPage page="cart" /> : null}
      <ProductRow
        title={text(page.upsell.title) || t('cart.suggested')}
        products={upsell}
        variant={page.upsell.variant}
        quickAdd
        testId="cart-upsell"
      />
      {away ? (
        <div
          className={cn(
            'fixed inset-x-0 z-30 flex items-center gap-3 border-t border-border bg-surface/95 p-3 backdrop-blur sm:hidden',
            design.mobileBar.enabled ? 'bottom-16' : 'bottom-0',
          )}
          data-testid="cart-sticky-bar"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-fg-muted">{t('cart.subtotal')}</span>
            <span className="block font-semibold tabular-nums">{money(priced.subtotal)}</span>
          </span>
          <Button disabled={!canCheckout} onClick={goCheckout}>
            {checkoutLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
