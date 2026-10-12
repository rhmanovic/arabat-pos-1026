import { Badge, Button, Field, Select, useToast } from '@arabat/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
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

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="aspect-square overflow-hidden rounded-lg bg-surface-muted">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt="" className="size-full object-cover" />
        ) : null}
      </div>
      <div className="flex flex-col gap-4">
        <Link to={`/${slug}`} className="text-sm text-primary hover:underline">
          {t('product.back')}
        </Link>
        <h1 className="text-2xl font-semibold">{name(product)}</h1>
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
