import { Badge, Button, Field, Select, useToast } from '@arabat/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useHref, useLocation, useParams } from 'react-router';
import { useCart } from '../cart.js';
import { useLocalName, useMoney, useSlug, useStoreProducts, useStorefront } from '../shared.js';

export function ProductPage() {
  const slug = useSlug();
  const { productId } = useParams();
  const products = useStoreProducts();
  const { data: store } = useStorefront();
  const cart = useCart();
  const toast = useToast();
  const name = useLocalName();
  const money = useMoney();
  const { t, i18n } = useTranslation();
  const product = products.data?.products.find((p) => p.productId === productId);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [imageIndex, setImageIndex] = useState(0);
  const href = useHref(useLocation().pathname);
  const title = product ? name(product) : '';
  const storeName = store ? name(store) : '';
  useEffect(() => {
    if (title) document.title = storeName ? `${title} · ${storeName}` : title;
  }, [title, storeName]);

  if (products.isPending) return null;
  if (!product)
    return (
      <div className="flex flex-col items-start gap-3">
        <p>{t('product.notFound')}</p>
        <Link to={`/${slug}`} className="text-primary hover:underline">
          {t('product.back')}
        </Link>
      </div>
    );
  const variant =
    product.variants.find((v) => v.variantId === variantId) ??
    product.variants.find((v) => v.available) ??
    product.variants[0]!;
  const description = i18n.language.startsWith('ar')
    ? product.descriptionAr || product.descriptionEn
    : product.descriptionEn || product.descriptionAr;
  const max = Math.max(1, variant.maxQuantity);
  const inCart = cart.lines.find((l) => l.variantId === variant.variantId)?.quantity ?? 0;
  const images =
    product.images.length > 0 ? product.images : product.imageUrl ? [product.imageUrl] : [];
  const current = images[Math.min(imageIndex, images.length - 1)] ?? null;
  const share = async () => {
    const url = new URL(href, window.location.origin).toString();
    try {
      if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success(t('product.linkCopied'));
      }
    } catch {
      // The visitor closed the share sheet.
    }
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-2">
        <div className="aspect-square overflow-hidden rounded-lg bg-surface-muted">
          {current ? (
            <img
              src={current}
              alt=""
              className="size-full object-cover"
              data-testid="product-image"
            />
          ) : null}
        </div>
        {images.length > 1 ? (
          <ul className="flex gap-2 overflow-x-auto" aria-label={t('product.gallery')}>
            {images.map((src, i) => (
              <li key={src}>
                <button
                  type="button"
                  aria-label={t('product.picture', { n: i + 1 })}
                  aria-pressed={i === imageIndex}
                  onClick={() => setImageIndex(i)}
                  className="block size-16 overflow-hidden rounded-md border border-border aria-pressed:border-primary aria-pressed:ring-2 aria-pressed:ring-primary"
                >
                  <img src={src} alt="" className="size-full object-cover" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex flex-col gap-4">
        <Link to={`/${slug}`} className="text-sm text-primary hover:underline">
          {t('product.back')}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="text-2xl font-semibold">{name(product)}</h1>
          <Button variant="ghost" size="sm" onClick={() => void share()}>
            {t('product.share')}
          </Button>
        </div>
        <p className="text-xl tabular-nums">{money(variant.price)}</p>
        {description ? <p className="whitespace-pre-line text-fg-muted">{description}</p> : null}
        {product.variants.length > 1 ? (
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
        ) : null}
        {variant.available ? (
          <>
            <Field label={t('product.quantity')}>
              {(props) => (
                <Select
                  {...props}
                  value={String(quantity)}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="max-w-28"
                >
                  {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button
              size="lg"
              disabled={!store?.acceptingOrders || inCart >= variant.maxQuantity}
              onClick={() => {
                cart.add(
                  { variantId: variant.variantId, productId: product.productId, quantity },
                  variant.maxQuantity,
                );
                toast.success(t('product.added'));
              }}
            >
              {t('product.add')}
            </Button>
          </>
        ) : (
          <Badge tone="warning">{t('product.unavailable')}</Badge>
        )}
      </div>
    </div>
  );
}
