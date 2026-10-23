import { storePath } from '../address.js';
import type { ProductPageDesign, StoreProduct } from '@arabat/contracts';
import { Badge, Button, Field, Select, cn, useToast } from '@arabat/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useHref, useLocation, useNavigate, useParams } from 'react-router';
import { useCart } from '../cart.js';
import { useDesign, useText } from '../design/context.js';
import { StoreIcon } from '../design/parts.js';
import {
  Highlights,
  ProductDetails,
  ProductGallery,
  ProductRow,
  relatedProducts,
  useOutOfView,
  useRecentlyViewed,
} from '../design/product-parts.js';
import { DesignedPage } from '../design/sections.js';
import { SaleBadge, SalePrice, useEndsIn, variantSale } from '../design/sale.js';
import {
  setPageMeta,
  useLocalName,
  useMoney,
  useSlug,
  useStoreProducts,
  useStorefront,
} from '../shared.js';

/** How the pictures and the details share the page on large screens (phones: one column). */
const GRID: Record<ProductPageDesign['layout'], string> = {
  classic: 'md:grid-cols-2',
  wide: 'md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]',
  reverse: 'md:grid-cols-2',
  stacked: 'mx-auto w-full max-w-2xl',
  scroll: 'md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]',
  compact: 'mx-auto w-full max-w-4xl md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]',
};

/** One product, drawn by the store design's product page (ADR-0128 amendment 4). */
export function ProductPage() {
  const slug = useSlug();
  const { productId } = useParams();
  const products = useStoreProducts();
  const { data: store } = useStorefront();
  const name = useLocalName();
  const { t } = useTranslation();
  const product = products.data?.products.find((p) => p.productId === productId);
  const title = product ? name(product) : '';
  const storeName = store ? name(store) : '';
  useEffect(() => {
    if (!product || !title) return;
    const lowest = product.variants.map((v) => v.price.amount).sort()[0];
    setPageMeta({
      title: storeName ? `${title} · ${storeName}` : title,
      description: product.descriptionEn || product.descriptionAr,
      image: product.imageUrl,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: title,
        description: product.descriptionEn || product.descriptionAr || undefined,
        image: product.images.map((src) => new URL(src, window.location.origin).toString()),
        offers: {
          '@type': 'Offer',
          priceCurrency: 'KWD',
          price: lowest,
          availability: product.variants.some((v) => v.available)
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
        },
      },
    });
  }, [product, title, storeName]);

  if (products.isPending) return null;
  if (!product)
    return (
      <div className="flex flex-col items-start gap-3">
        <p>{t('product.notFound')}</p>
        <Link to={storePath(slug)} className="text-primary hover:underline">
          {t('product.back')}
        </Link>
      </div>
    );
  // A new product starts over: first picture, its first available option, one piece.
  return (
    <ProductView key={product.productId} product={product} all={products.data?.products ?? []} />
  );
}

function ProductView({ product, all }: { product: StoreProduct; all: StoreProduct[] }) {
  const slug = useSlug();
  const design = useDesign();
  const page = design.productPage;
  const { data: store } = useStorefront();
  const cart = useCart();
  const toast = useToast();
  const name = useLocalName();
  const money = useMoney();
  const text = useText();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [variantId, setVariantId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const href = useHref(useLocation().pathname);
  const recentIds = useRecentlyViewed(slug, product.productId, page.recent.enabled);
  const buyRef = useRef<HTMLDivElement>(null);

  const variant =
    product.variants.find((v) => v.variantId === variantId) ??
    product.variants.find((v) => v.available) ??
    product.variants[0]!;
  const sticky = page.buy.stickyBar && variant.available;
  const sale = variantSale(variant);
  const endsIn = useEndsIn();
  // The phone's bottom bar appears once the main add button has scrolled above the screen.
  const buyAway = useOutOfView(buyRef, sticky, true);

  const title = name(product);
  const description = i18n.language.startsWith('ar')
    ? product.descriptionAr || product.descriptionEn
    : product.descriptionEn || product.descriptionAr;
  const max = Math.max(1, variant.maxQuantity);
  const amount = page.buy.quantity === 'hidden' ? 1 : Math.min(quantity, max);
  const inCart = cart.lines.find((l) => l.variantId === variant.variantId)?.quantity ?? 0;
  const canAdd = Boolean(store?.acceptingOrders) && inCart < variant.maxQuantity;
  const images =
    product.images.length > 0 ? product.images : product.imageUrl ? [product.imageUrl] : [];
  const category = product.categoryId
    ? store?.categories.find((c) => c.id === product.categoryId)
    : undefined;
  const fewLeft =
    page.info.lowStockAt > 0 && variant.fewLeft !== null && variant.fewLeft <= page.info.lowStockAt
      ? variant.fewLeft
      : null;
  const center = page.info.align === 'center';
  const whatsapp = page.buy.whatsapp ? design.social.whatsapp.replace(/\D/g, '') : '';
  const url = () => new URL(href, window.location.origin).toString();
  const addLabel = text(page.buy.addLabel) || t('product.add');

  const add = () => {
    cart.add(
      { variantId: variant.variantId, productId: product.productId, quantity: amount },
      variant.maxQuantity,
    );
    toast.success(t('product.added'));
  };
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title, url: url() });
      else {
        await navigator.clipboard.writeText(url());
        toast.success(t('product.linkCopied'));
      }
    } catch {
      // The visitor closed the share sheet.
    }
  };

  const related = page.related.enabled ? relatedProducts(all, product, page.related) : [];
  const recent = recentIds
    .map((id) => all.find((p) => p.productId === id))
    .filter((p): p is StoreProduct => Boolean(p))
    .slice(0, 8);

  const options =
    product.variants.length > 1 ? (
      page.buy.options === 'buttons' ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">{t('product.variant')}</p>
          <div
            role="radiogroup"
            aria-label={t('product.variant')}
            className={cn('flex flex-wrap gap-2', center && 'justify-center')}
          >
            {product.variants.map((v) => (
              <button
                key={v.variantId}
                type="button"
                role="radio"
                aria-checked={v.variantId === variant.variantId}
                disabled={!v.available}
                onClick={() => {
                  setVariantId(v.variantId);
                  setQuantity(1);
                }}
                className={cn(
                  'min-h-10 rounded-md border px-4 text-sm font-medium transition-colors',
                  v.variantId === variant.variantId
                    ? 'border-primary bg-primary-soft text-primary ring-1 ring-primary'
                    : 'border-border bg-surface hover:border-border-strong',
                  !v.available && 'cursor-not-allowed text-fg-subtle line-through opacity-60',
                )}
              >
                {name(v) || v.sku}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <Field label={t('product.variant')}>
          {(props) => (
            <Select
              {...props}
              value={variant.variantId}
              onChange={(e) => {
                setVariantId(e.target.value);
                setQuantity(1);
              }}
            >
              {product.variants.map((v) => (
                <option key={v.variantId} value={v.variantId} disabled={!v.available}>
                  {name(v) || v.sku}
                  {v.available ? '' : ` — ${t('product.unavailable')}`}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )
    ) : null;

  const quantityControl =
    page.buy.quantity === 'stepper' ? (
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium" id="product-quantity">
          {t('product.quantity')}
        </p>
        <div
          role="group"
          aria-labelledby="product-quantity"
          className={cn(
            'inline-flex items-center self-start rounded-md border border-border bg-surface',
            center && 'self-center',
          )}
        >
          <button
            type="button"
            className="grid size-11 place-items-center text-lg disabled:opacity-40"
            aria-label={t('product.decrease')}
            disabled={amount <= 1}
            onClick={() => setQuantity(Math.max(1, amount - 1))}
          >
            −
          </button>
          <output className="min-w-10 text-center font-semibold tabular-nums" aria-live="polite">
            {amount}
          </output>
          <button
            type="button"
            className="grid size-11 place-items-center text-lg disabled:opacity-40"
            aria-label={t('product.increase')}
            disabled={amount >= max}
            onClick={() => setQuantity(Math.min(max, amount + 1))}
          >
            +
          </button>
        </div>
      </div>
    ) : page.buy.quantity === 'dropdown' ? (
      <Field label={t('product.quantity')}>
        {(props) => (
          <Select
            {...props}
            value={String(amount)}
            onChange={(e) => setQuantity(Number(e.target.value))}
            className={cn('max-w-28', center && 'mx-auto')}
          >
            {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        )}
      </Field>
    ) : null;

  const gallery = (
    <div
      className={cn(
        'min-w-0',
        page.layout === 'reverse' && 'md:order-2',
        page.layout === 'compact' && 'md:self-start',
      )}
    >
      <ProductGallery
        images={images}
        settings={page.gallery}
        index={Math.min(imageIndex, Math.max(0, images.length - 1))}
        setIndex={setImageIndex}
        scroll={page.layout === 'scroll'}
        overlay={<SaleBadge sale={sale} where="page" />}
      />
    </div>
  );

  const details = (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-4',
        center && 'items-center text-center',
        (page.layout === 'scroll' || page.layout === 'wide') && 'md:sticky md:top-24 md:self-start',
      )}
      data-testid="product-info"
    >
      {page.info.breadcrumb ? (
        <nav aria-label={t('product.breadcrumb')}>
          <ol className="flex flex-wrap items-center gap-1 text-xs text-fg-muted">
            <li>
              <Link to={storePath(slug)} className="hover:text-primary hover:underline">
                {t('product.home')}
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li>
              <Link
                to={
                  category
                    ? storePath(slug, `/products?category=${category.id}`)
                    : storePath(slug, `/products`)
                }
                className="hover:text-primary hover:underline"
              >
                {category ? name(category) : t('product.products')}
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="truncate font-medium text-fg">
              {title}
            </li>
          </ol>
        </nav>
      ) : (
        <Link to={storePath(slug)} className="text-sm text-primary hover:underline">
          {t('product.back')}
        </Link>
      )}
      {page.info.category && category ? (
        <Link
          to={storePath(slug, `/products?category=${category.id}`)}
          className="self-start rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary"
        >
          {name(category)}
        </Link>
      ) : null}
      <div
        className={cn(
          'flex flex-wrap items-start justify-between gap-2',
          center && 'flex-col items-center',
        )}
      >
        <h1
          className={cn(
            'font-semibold',
            page.info.titleSize === 'large' ? 'text-3xl font-bold sm:text-4xl' : 'text-2xl',
          )}
        >
          {title}
        </h1>
        {page.info.share ? (
          <Button variant="ghost" size="sm" onClick={() => void share()}>
            {t('product.share')}
          </Button>
        ) : null}
      </div>
      <div className={cn('flex flex-wrap items-center gap-2', center && 'justify-center')}>
        <p
          className={cn(
            'tabular-nums',
            page.info.priceSize === 'large' ? 'text-2xl font-bold sm:text-3xl' : 'text-xl',
          )}
          data-testid="product-price"
        >
          <SalePrice
            sale={sale}
            className={sale ? 'font-bold' : undefined}
            oldClassName="text-base sm:text-lg"
          >
            {money(variant.price)}
          </SalePrice>
        </p>
        {page.info.stock && variant.available && fewLeft === null ? (
          <Badge tone="success">{t('product.inStock')}</Badge>
        ) : null}
        {variant.available && fewLeft !== null ? (
          <Badge tone="warning">{t('product.fewLeft', { count: fewLeft })}</Badge>
        ) : null}
      </div>
      {sale && (design.sale.savings || design.sale.endsIn) ? (
        <p
          className={cn(
            'flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium',
            center && 'justify-center',
          )}
          data-testid="product-saving"
        >
          {design.sale.savings ? (
            <span className="rounded-md bg-danger-soft px-2 py-0.5 text-danger">
              {t('design.saleYouSave', { amount: money(sale.saving), percent: sale.percent })}
            </span>
          ) : null}
          {design.sale.endsIn && endsIn(sale.endsAt) ? (
            <span className="text-fg-muted">{endsIn(sale.endsAt)}</span>
          ) : null}
        </p>
      ) : null}
      {page.info.sku && variant.sku ? (
        <p className="text-xs text-fg-muted">{t('product.sku', { sku: variant.sku })}</p>
      ) : null}
      {page.description.style === 'plain' && page.description.blocks.length === 0 && description ? (
        <p className="whitespace-pre-line text-fg-muted">{description}</p>
      ) : null}
      {options}
      {variant.available ? (
        <>
          {quantityControl}
          <div
            ref={buyRef}
            className={cn('flex w-full flex-col gap-2 sm:flex-row', center && 'sm:justify-center')}
          >
            <Button size="lg" className="sm:flex-1" disabled={!canAdd} onClick={add}>
              {addLabel}
            </Button>
            {page.buy.buyNow ? (
              <Button
                size="lg"
                variant="secondary"
                className="sm:flex-1"
                disabled={!canAdd}
                onClick={() => {
                  add();
                  void navigate(storePath(slug, `/checkout`));
                }}
              >
                {t('product.buyNow')}
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <Badge tone="warning" className="self-start">
          {t('product.unavailable')}
        </Badge>
      )}
      {whatsapp ? (
        <a
          href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(
            t('product.whatsappText', { name: title, url: url() }),
          )}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border px-4 text-sm font-semibold hover:border-primary hover:text-primary"
        >
          <StoreIcon name="whatsapp" />
          {t('product.askWhatsapp')}
        </a>
      ) : null}
      <Highlights items={page.highlights} testId="product-highlights" />
      {page.description.style !== 'plain' || page.description.blocks.length > 0 ? (
        <div className="w-full text-start">
          <ProductDetails description={description ?? ''} settings={page.description} />
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      className={cn('flex flex-col gap-10', sticky && 'max-sm:pb-20')}
      data-testid="product-page"
      data-layout={page.layout}
    >
      <div className={cn('grid grid-cols-[minmax(0,1fr)] gap-6 md:gap-10', GRID[page.layout])}>
        {gallery}
        {details}
      </div>
      {design.pages.product.length > 0 ? <DesignedPage page="product" /> : null}
      <ProductRow
        title={text(page.related.title) || t('product.related')}
        products={related}
        variant={page.related.variant}
        quickAdd={page.related.showAdd}
        testId="related-products"
      />
      {page.recent.enabled ? (
        <ProductRow
          title={text(page.recent.title) || t('product.recent')}
          products={recent}
          variant="carousel"
          quickAdd={false}
          testId="recent-products"
        />
      ) : null}
      {sticky && buyAway ? (
        <div
          className={cn(
            'fixed inset-x-0 z-30 flex items-center gap-3 border-t border-border bg-surface/95 p-3 backdrop-blur sm:hidden',
            design.mobileBar.enabled ? 'bottom-16' : 'bottom-0',
          )}
          data-testid="product-sticky-bar"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{title}</span>
            <span className="block text-sm tabular-nums text-fg-muted">
              <SalePrice sale={sale}>{money(variant.price)}</SalePrice>
            </span>
          </span>
          <Button disabled={!canAdd} onClick={add}>
            {addLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
