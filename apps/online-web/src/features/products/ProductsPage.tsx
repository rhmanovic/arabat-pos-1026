import { Badge, Button, DataTable, Input, PageHeader } from '@arabat/ui';
import { AccessDenied, ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { managerUrl, useSession } from '../../app/context.js';
import { formatAmount, key } from '../shared.js';

/** Which catalog products are sold online; prices and stock stay the catalog's (shared). */
export function ProductsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  if (!can('online.manage')) return <AccessDenied />;
  return (
    <div>
      <PageHeader
        title={t('nav.products')}
        description={t('store.productsHint')}
        actions={
          <a className="text-sm text-primary hover:underline" href={managerUrl('products')}>
            {t('nav.catalog')} ↗
          </a>
        }
      />
      <ProductsTab />
    </div>
  );
}

// ----------------------------------------------------------------------------- listings
function ProductsTab() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const listings = useQuery({
    queryKey: [...key, 'listings'],
    queryFn: () => api.online.listings(),
  });
  const save = useMutation({
    mutationFn: (listed: boolean) => api.online.setListings({ productIds: [...selected], listed }),
    onSuccess: async () => {
      setSelected(new Set());
      await queryClient.invalidateQueries({ queryKey: key });
      notify.ok(t('common.saved'));
    },
    onError: notify.fail,
  });
  const term = search.trim().toLowerCase();
  const rows = listings.data?.products.filter(
    (p) => !term || `${p.nameEn ?? ''} ${p.nameAr ?? ''}`.toLowerCase().includes(term),
  );
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          type="search"
          aria-label={t('store.searchProducts')}
          placeholder={t('store.searchProducts')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button
          disabled={selected.size === 0}
          loading={save.isPending && save.variables}
          onClick={() => save.mutate(true)}
        >
          {t('store.list', { count: selected.size })}
        </Button>
        <Button
          variant="secondary"
          disabled={selected.size === 0}
          loading={save.isPending && !save.variables}
          onClick={() => save.mutate(false)}
        >
          {t('store.unlist', { count: selected.size })}
        </Button>
      </div>
      <DataTable
        caption={t('store.tabProducts')}
        loading={listings.isPending}
        error={
          listings.isError ? (
            <ErrorState error={listings.error} onRetry={() => void listings.refetch()} />
          ) : null
        }
        rows={rows}
        rowKey={(p) => p.productId}
        empty={t('store.noProducts')}
        columns={[
          {
            key: 'select',
            header: <span className="sr-only">{t('store.select')}</span>,
            cell: (p) => (
              <input
                type="checkbox"
                className="size-4 accent-primary"
                aria-label={localizedName(p, i18n.language)}
                checked={selected.has(p.productId)}
                onChange={() => toggle(p.productId)}
              />
            ),
          },
          {
            key: 'name',
            header: t('store.product'),
            cell: (p) => localizedName(p, i18n.language),
          },
          {
            key: 'price',
            header: t('sales.unitPrice'),
            hideBelow: 'sm',
            cell: (p) => (
              <span dir="ltr" className="tabular-nums">
                {formatAmount(p.price, i18n.language)}
              </span>
            ),
          },
          {
            key: 'listed',
            header: t('store.listed'),
            cell: (p) =>
              p.listed ? (
                <Badge tone="success">{t('store.listedYes')}</Badge>
              ) : (
                <Badge>{t('store.listedNo')}</Badge>
              ),
          },
        ]}
      />
    </div>
  );
}
