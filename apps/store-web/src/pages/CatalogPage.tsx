import { Badge, EmptyState, Input, Spinner } from '@arabat/ui';
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
  const money = useMoney();
  const { t } = useTranslation();
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  if (products.isPending) return <Spinner label={t('common:status.loading')} />;
  if (products.isError)
    return <ErrorState error={products.error} onRetry={() => void products.refetch()} />;

  const term = search.trim().toLowerCase();
  const visible = products.data.products.filter(
    (p) =>
      (!category || p.categoryId === category) &&
      (!term || `${p.nameEn ?? ''} ${p.nameAr ?? ''}`.toLowerCase().includes(term)),
  );
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
        {categories.length > 0 ? (
          <div className="flex flex-wrap gap-2" role="group">
            {[
              { id: null, label: t('catalog.all') },
              ...categories.map((c) => ({ id: c.id, label: name(c) })),
            ].map((c) => (
              <button
                key={c.id ?? 'all'}
                type="button"
                aria-pressed={category === c.id}
                onClick={() => setCategory(c.id)}
                className="rounded-full border border-border px-3 py-1 text-sm aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-fg"
              >
                {c.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {visible.map((p) => {
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
                    <img
                      src={p.imageUrl}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
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
    </div>
  );
}
