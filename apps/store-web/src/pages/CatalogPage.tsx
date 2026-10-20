import type { StoreProduct } from '@arabat/contracts';
import { Badge, EmptyState, Input, Select, Spinner } from '@arabat/ui';
import { ErrorState } from '@arabat/web-core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { toMoney } from '../cart.js';
import { useLocalName, useMoney, useSlug, useStoreProducts, useStorefront } from '../shared.js';

export function CatalogPage() {
  const slug = useSlug();
  const { data: store } = useStorefront();
  const products = useStoreProducts();
  const name = useLocalName();
  const { t } = useTranslation();
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'default' | 'name' | 'priceAsc' | 'priceDesc'>('default');

  if (products.isPending) return <Spinner label={t('common:status.loading')} />;
  if (products.isError)
    return <ErrorState error={products.error} onRetry={() => void products.refetch()} />;

  const term = search.trim().toLowerCase();
  const lowest = (p: StoreProduct) =>
    p.variants.map((v) => toMoney(v.price)).reduce((a, b) => (b.compare(a) < 0 ? b : a));
  const sorted = [...products.data.products].sort((a, b) => {
    if (sort === 'name') return name(a).localeCompare(name(b));
    if (sort === 'priceAsc') return lowest(a).compare(lowest(b));
    if (sort === 'priceDesc') return lowest(b).compare(lowest(a));
    return a.position - b.position;
  });
  const visible = sorted.filter(
    (p) =>
      (!category || p.categoryId === category) &&
      (!term || `${p.nameEn ?? ''} ${p.nameAr ?? ''}`.toLowerCase().includes(term)),
  );
  // Featured products open the page while nothing is filtered (ADR-0121).
  const featured = !category && !term ? visible.filter((p) => p.featured) : [];
  const used = new Set(products.data.products.map((p) => p.categoryId));
  const categories = (store?.categories ?? []).filter((c) => used.has(c.id));

  if (products.data.products.length === 0) return <EmptyState title={t('catalog.empty')} />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label={t('catalog.search')}
          placeholder={t('catalog.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select
          aria-label={t('catalog.sort')}
          className="w-44"
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
        >
          {(['default', 'name', 'priceAsc', 'priceDesc'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`catalog.sort_${s}`)}
            </option>
          ))}
        </Select>
        {categories.length > 0 ? (
          <div className="flex flex-wrap gap-2" role="group">
            {[
              { id: null, label: t('catalog.all') },
              ...categories.map((c) => ({ id: c.id, label: name(c), imageUrl: c.imageUrl })),
            ].map((c: { id: string | null; label: string; imageUrl?: string | null }) => (
              <button
                key={c.id ?? 'all'}
                type="button"
                aria-pressed={category === c.id}
                onClick={() => setCategory(c.id)}
                className="flex items-center gap-2 rounded-full border border-border py-1 pe-3 ps-1 text-sm aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-fg"
              >
                {'imageUrl' in c && c.imageUrl ? (
                  <img src={c.imageUrl} alt="" className="size-6 rounded-full object-cover" />
                ) : (
                  <span className="w-2" aria-hidden />
                )}
                {c.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {featured.length > 0 ? (
        <section aria-label={t('catalog.featured')} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t('catalog.featured')}</h2>
          <ProductGrid products={featured} slug={slug} testId="featured-grid" />
        </section>
      ) : null}
      <ProductGrid products={visible} slug={slug} testId="product-grid" />
    </div>
  );
}

function ProductGrid({
  products,
  slug,
  testId,
}: {
  products: StoreProduct[];
  slug: string;
  testId: string;
}) {
  const name = useLocalName();
  const money = useMoney();
  const { t } = useTranslation();
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid={testId}>
      {products.map((p) => {
        const available = p.variants.some((v) => v.available);
        const prices = p.variants.map((v) => toMoney(v.price));
        const lowest = prices.reduce((a, b) => (b.compare(a) < 0 ? b : a));
        const varies = prices.some((m) => !m.equals(lowest));
        return (
          <li key={p.productId}>
            <Link
              to={`/${slug}/products/${p.productId}`}
              className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface hover:border-primary"
            >
              <div className="aspect-square bg-surface-muted">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" className="size-full object-cover" loading="lazy" />
                ) : null}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <p className="font-medium">{name(p)}</p>
                <p className="text-sm tabular-nums text-fg-muted">
                  {varies ? t('catalog.from', { price: money(lowest) }) : money(lowest)}
                </p>
                {!available ? <Badge tone="warning">{t('catalog.unavailable')}</Badge> : null}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
