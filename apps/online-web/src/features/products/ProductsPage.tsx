import type { Listing, OnlineCategory, SaveListing } from '@arabat/contracts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Section,
  Select,
  Textarea,
} from '@arabat/ui';
import { AccessDenied, ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { managerUrl, useSession } from '../../app/context.js';
import { formatAmount, key } from '../shared.js';
import { SortableList, SortableRow } from '../sortable.js';

/**
 * Which catalog products are sold online, in what order, and what the store says about them
 * (ADR-0121). Prices, stock and images stay the catalog's (shared with the POS).
 */
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
      <Listings />
    </div>
  );
}

function Listings() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [categoryForNew, setCategoryForNew] = useState('');
  const [editing, setEditing] = useState<Listing | null>(null);
  const listings = useQuery({
    queryKey: [...key, 'listings'],
    queryFn: () => api.online.listings(),
  });
  const categories = useQuery({
    queryKey: [...key, 'categories'],
    queryFn: () => api.online.categories(),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: [...key, 'listings'] });
    await queryClient.invalidateQueries({ queryKey: [...key, 'categories'] });
  };
  const list = useMutation({
    mutationFn: (productIds: string[]) =>
      api.online.setListings({
        productIds,
        listed: true,
        ...(categoryForNew ? { onlineCategoryId: categoryForNew } : {}),
      }),
    onSuccess: async () => {
      setSelected(new Set());
      await refresh();
      notify.ok(t('common.saved'));
    },
    onError: notify.fail,
  });
  const unlist = useMutation({
    mutationFn: (productIds: string[]) => api.online.setListings({ productIds, listed: false }),
    onSuccess: async () => {
      await refresh();
      notify.ok(t('common.saved'));
    },
    onError: notify.fail,
  });
  const order = useMutation({
    mutationFn: (productIds: string[]) => api.online.orderListings(productIds),
    onSuccess: refresh,
    onError: async (error) => {
      await refresh();
      notify.fail(error);
    },
  });

  if (listings.isPending || categories.isPending) return null;
  if (listings.isError)
    return <ErrorState error={listings.error} onRetry={() => void listings.refetch()} />;
  const term = search.trim().toLowerCase();
  const matches = (p: Listing) =>
    !term ||
    `${p.nameEn ?? ''} ${p.nameAr ?? ''} ${p.titleEn ?? ''} ${p.titleAr ?? ''}`
      .toLowerCase()
      .includes(term);
  const listed = listings.data.products.filter((p) => p.listed);
  const shown = listed.filter(matches);
  const notListed = listings.data.products.filter((p) => !p.listed && matches(p));
  const ids = listed.map((p) => p.productId);
  const cats = categories.data?.categories ?? [];
  const categoryName = (id: string | null) => {
    const c = cats.find((x) => x.id === id);
    return c ? localizedName(c, i18n.language) : null;
  };
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const displayName = (p: Listing) =>
    localizedName({ nameEn: p.titleEn || p.nameEn, nameAr: p.titleAr || p.nameAr }, i18n.language);

  return (
    <div className="flex flex-col gap-6">
      <Input
        className="max-w-xs"
        type="search"
        aria-label={t('store.searchProducts')}
        placeholder={t('store.searchProducts')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <Section
        title={t('products.listedSection', { count: listed.length })}
        description={term ? undefined : t('products.dragHint')}
      >
        {listed.length === 0 ? (
          <EmptyState title={t('products.noneListed')} description={t('products.noneListedHint')} />
        ) : (
          <SortableList ids={ids} onOrder={(next) => order.mutate(next)}>
            {shown.map((p) => {
              const index = ids.indexOf(p.productId);
              return (
                <SortableRow
                  key={p.productId}
                  id={p.productId}
                  label={displayName(p)}
                  first={index === 0}
                  last={index === ids.length - 1}
                  onMove={(by) => {
                    const next = [...ids];
                    next.splice(index, 1);
                    next.splice(index + by, 0, p.productId);
                    order.mutate(next);
                  }}
                >
                  <span className="size-12 shrink-0 overflow-hidden rounded-md bg-surface-muted">
                    {p.images[0] ? (
                      <img src={p.images[0].url} alt="" className="size-full object-cover" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{displayName(p)}</span>
                      {p.featured ? <Badge tone="primary">{t('products.featured')}</Badge> : null}
                    </span>
                    <span className="block truncate text-xs text-fg-muted">
                      {[
                        formatAmount(p.price, i18n.language),
                        categoryName(p.onlineCategoryId) ??
                          (p.posCategory ? localizedName(p.posCategory, i18n.language) : null),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
                    {t('products.edit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={unlist.isPending && unlist.variables?.[0] === p.productId}
                    onClick={() => unlist.mutate([p.productId])}
                  >
                    {t('products.remove')}
                  </Button>
                </SortableRow>
              );
            })}
          </SortableList>
        )}
      </Section>
      <Section title={t('products.notListedSection', { count: notListed.length })}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {cats.length > 0 ? (
            <Select
              className="w-56"
              aria-label={t('products.categoryForNew')}
              value={categoryForNew}
              onChange={(e) => setCategoryForNew(e.target.value)}
            >
              <option value="">{t('products.noCategory')}</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {localizedName(c, i18n.language)}
                </option>
              ))}
            </Select>
          ) : null}
          <Button
            disabled={selected.size === 0}
            loading={list.isPending}
            onClick={() => list.mutate([...selected])}
          >
            {t('store.list', { count: selected.size })}
          </Button>
          {cats.length === 0 ? (
            <Link className="text-sm text-primary hover:underline" to="/categories">
              {t('products.createCategories')}
            </Link>
          ) : null}
        </div>
        <DataTable
          caption={t('products.notListedSection', { count: notListed.length })}
          rows={notListed}
          rowKey={(p) => p.productId}
          empty={t('products.allListed')}
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
          ]}
        />
      </Section>
      {editing ? (
        <EditDialog
          listing={editing}
          categories={cats}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/** The store's own text and options for one product; the catalog keeps its name and price. */
function EditDialog({
  listing,
  categories,
  onClose,
  onSaved,
}: {
  listing: Listing;
  categories: OnlineCategory[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const [v, setV] = useState<SaveListing>({
    titleEn: listing.titleEn,
    titleAr: listing.titleAr,
    descriptionEn: listing.descriptionEn,
    descriptionAr: listing.descriptionAr,
    featured: listing.featured,
    maxPerOrder: listing.maxPerOrder,
    onlineCategoryId: listing.onlineCategoryId,
  });
  const set = (patch: Partial<SaveListing>) => setV((x) => ({ ...x, ...patch }));
  const save = useMutation({
    mutationFn: () => api.online.saveListing(listing.productId, v),
    onSuccess: async () => {
      notify.ok(t('common.saved'));
      await onSaved();
    },
    onError: notify.fail,
  });
  const text = (field: 'titleEn' | 'titleAr', label: string, dir?: 'ltr') => (
    <Field label={label} hint={t('products.titleHint')}>
      {(p) => (
        <Input
          {...p}
          dir={dir}
          value={v[field] ?? ''}
          onChange={(e) => set({ [field]: e.target.value || null })}
        />
      )}
    </Field>
  );
  const area = (field: 'descriptionEn' | 'descriptionAr', label: string, dir?: 'ltr') => (
    <Field label={label}>
      {(p) => (
        <Textarea
          {...p}
          dir={dir}
          rows={3}
          value={v[field] ?? ''}
          onChange={(e) => set({ [field]: e.target.value || null })}
        />
      )}
    </Field>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => (!open ? onClose() : undefined)}
      size="lg"
      title={t('products.editTitle', { name: localizedName(listing, i18n.language) })}
      description={t('products.editHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {text('titleAr', t('products.titleAr'))}
        {text('titleEn', t('products.titleEn'), 'ltr')}
        {area('descriptionAr', t('products.descriptionAr'))}
        {area('descriptionEn', t('products.descriptionEn'), 'ltr')}
        <Field label={t('products.category')}>
          {(p) => (
            <Select
              {...p}
              value={v.onlineCategoryId ?? ''}
              onChange={(e) => set({ onlineCategoryId: e.target.value || null })}
            >
              <option value="">{t('products.noCategory')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {localizedName(c, i18n.language)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('products.maxPerOrder')} hint={t('products.maxPerOrderHint')}>
          {(p) => (
            <Input
              {...p}
              type="number"
              min={1}
              max={20}
              dir="ltr"
              value={v.maxPerOrder === null ? '' : String(v.maxPerOrder)}
              onChange={(e) =>
                set({ maxPerOrder: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
          )}
        </Field>
        <Checkbox
          label={t('products.featured')}
          description={t('products.featuredHint')}
          checked={v.featured}
          onChange={(e) => set({ featured: e.target.checked })}
        />
        <div className="sm:col-span-2">
          <p className="mb-1 text-sm font-medium">{t('products.images')}</p>
          {listing.images.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {listing.images.map((img) => (
                <img
                  key={img.id}
                  src={img.url}
                  alt=""
                  className="size-16 rounded-md border border-border object-cover"
                />
              ))}
            </div>
          ) : (
            <Alert>{t('products.noImages')}</Alert>
          )}
          <p className="mt-1 text-xs text-fg-muted">
            {t('products.imagesHint')}{' '}
            <a
              className="text-primary hover:underline"
              href={managerUrl(`products/${listing.productId}`)}
              target="_blank"
              rel="noreferrer"
            >
              {t('products.openInCatalog')} ↗
            </a>
          </p>
        </div>
      </div>
    </Dialog>
  );
}
