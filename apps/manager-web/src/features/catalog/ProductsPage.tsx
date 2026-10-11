import type { ProductListQuery } from '@arabat/contracts';

interface Query {
  status: 'active' | 'archived' | 'all';
  sort: 'name' | 'updated' | 'price';
  direction: 'asc' | 'desc';
  page: number;
  pageSize: number;
  categoryId?: string | undefined;
}
import { Money } from '@arabat/money';
import { formatMoney } from '@arabat/i18n';
import { Badge, Button, DataTable, Input, PageHeader, Select } from '@arabat/ui';
import { localizedName, useApi } from '@arabat/web-core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useBranchContext, useSession } from '../../app/context.js';
import { categoriesKey } from './CategoriesPage.js';

export const productsKey = ['manager', 'products'] as const;

export function formatAmount(
  value: { amount: string; currency: string } | null | undefined,
  language: string,
) {
  return value
    ? formatMoney(Money.fromJSON(value as { amount: string; currency: 'KWD' }), language)
    : '—';
}

export function ProductsPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const { can } = useSession();
  const { branchId } = useBranchContext();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState<Query>({
    status: 'active',
    sort: 'name',
    direction: 'asc',
    page: 1,
    pageSize: 25,
  });
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  const effective: ProductListQuery = {
    ...query,
    ...(q ? { q } : {}),
    ...(branchId ? { branchId } : {}),
  };
  const list = useQuery({
    queryKey: [...productsKey, effective],
    queryFn: () => api.catalog.products(effective),
    placeholderData: keepPreviousData,
  });
  const categories = useQuery({ queryKey: categoriesKey, queryFn: () => api.catalog.categories() });
  const categoryName = (id: string | null) => {
    const c = categories.data?.categories.find((x) => x.id === id);
    return c ? localizedName(c, i18n.language) : '—';
  };
  const set = (patch: Partial<Query>) => setQuery((current) => ({ ...current, page: 1, ...patch }));
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / query.pageSize));

  return (
    <div>
      <PageHeader
        title={t('catalog.productsTitle')}
        description={t('catalog.productsSubtitle')}
        actions={
          can('catalog.manage') ? (
            <Button onClick={() => void navigate('/products/new')}>
              {t('catalog.newProduct')}
            </Button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          className="max-w-xs"
          type="search"
          aria-label={t('common.search')}
          placeholder={t('catalog.searchPlaceholder')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            set({});
          }}
        />
        <Select
          className="max-w-48"
          aria-label={t('catalog.category')}
          value={query.categoryId ?? ''}
          onChange={(e) => set({ categoryId: e.target.value || undefined })}
        >
          <option value="">{t('catalog.allCategories')}</option>
          {categories.data?.categories
            .filter((c) => c.status === 'active')
            .map((c) => (
              <option key={c.id} value={c.id}>
                {localizedName(c, i18n.language)}
              </option>
            ))}
        </Select>
        <Select
          className="max-w-40"
          aria-label={t('common.status')}
          value={query.status}
          onChange={(e) => set({ status: e.target.value as Query['status'] })}
        >
          <option value="active">{t('catalog.statusActive')}</option>
          <option value="archived">{t('catalog.statusArchived')}</option>
          <option value="all">{t('catalog.statusAll')}</option>
        </Select>
        <Select
          className="max-w-48"
          aria-label={t('catalog.sort')}
          value={`${query.sort}:${query.direction}`}
          onChange={(e) => {
            const [sort, direction] = e.target.value.split(':') as [
              Query['sort'],
              Query['direction'],
            ];
            set({ sort, direction });
          }}
        >
          <option value="name:asc">{t('catalog.sortName')} ↑</option>
          <option value="name:desc">{t('catalog.sortName')} ↓</option>
          <option value="price:asc">{t('catalog.sortPrice')} ↑</option>
          <option value="price:desc">{t('catalog.sortPrice')} ↓</option>
          <option value="updated:desc">{t('catalog.sortUpdated')}</option>
        </Select>
      </div>
      <DataTable
        caption={t('catalog.productsTitle')}
        loading={list.isPending}
        rows={list.data?.products}
        rowKey={(p) => p.id}
        empty={t('catalog.empty')}
        onRowClick={(p) => void navigate(`/products/${p.id}`)}
        columns={[
          {
            key: 'name',
            header: t('common.name'),
            cell: (p) => (
              <span className="flex items-center gap-3">
                {p.imageUrl ? (
                  <img
                    src={p.imageUrl}
                    alt=""
                    className="size-10 rounded-md border border-border object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span aria-hidden className="size-10 rounded-md bg-surface-muted" />
                )}
                <span>
                  <span className="block font-medium">{localizedName(p, i18n.language)}</span>
                  <span className="block text-xs text-fg-muted" dir="ltr">
                    {p.skus.slice(0, 3).join(', ')}
                  </span>
                </span>
              </span>
            ),
          },
          {
            key: 'category',
            header: t('catalog.category'),
            hideBelow: 'md',
            cell: (p) => categoryName(p.categoryId),
          },
          {
            key: 'variants',
            header: t('catalog.variants'),
            hideBelow: 'lg',
            cell: (p) =>
              p.hasVariants ? t('catalog.variantCount', { count: p.variantCount }) : '—',
          },
          {
            key: 'price',
            header: t('catalog.price'),
            cell: (p) => (
              <span className="tabular-nums" dir="ltr">
                {p.minPrice && p.maxPrice && p.minPrice.amount !== p.maxPrice.amount
                  ? t('catalog.from', { price: formatAmount(p.minPrice, i18n.language) })
                  : formatAmount(p.minPrice, i18n.language)}
              </span>
            ),
          },
          {
            key: 'status',
            header: t('common.status'),
            hideBelow: 'sm',
            cell: (p) => (
              <Badge tone={p.status === 'active' ? 'success' : 'neutral'}>
                {p.status === 'active' ? t('catalog.statusActive') : t('catalog.statusArchived')}
              </Badge>
            ),
          },
        ]}
      />
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-fg-muted">
        <span>{t('catalog.total', { count: list.data?.total ?? 0 })}</span>
        <span className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={query.page <= 1}
            onClick={() => setQuery((c) => ({ ...c, page: c.page - 1 }))}
          >
            {t('catalog.previous')}
          </Button>
          <span>{t('catalog.pageOf', { page: query.page, pages })}</span>
          <Button
            size="sm"
            variant="secondary"
            disabled={query.page >= pages}
            onClick={() => setQuery((c) => ({ ...c, page: c.page + 1 }))}
          >
            {t('catalog.next')}
          </Button>
        </span>
      </div>
    </div>
  );
}
