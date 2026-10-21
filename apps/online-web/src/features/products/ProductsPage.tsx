import type {
  Listing,
  OnlineCollection,
  Product,
  SaveListing,
  SaveProduct,
  StoreCategory,
} from '@arabat/contracts';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Section,
  Segmented,
  Select,
  Textarea,
} from '@arabat/ui';
import { AccessDenied, ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { managerUrl, useSession } from '../../app/context.js';
import { storeCategoryName } from '../categories/CategoriesPage.js';
import { GalleryField, PictureField, usePendingGallery, usePendingPicture } from '../picture.js';
import { formatAmount, key } from '../shared.js';
import { SortableList, SortableRow } from '../sortable.js';

const SHOW = ['all', 'website', 'hidden', 'uncategorized'] as const;
type Show = (typeof SHOW)[number];

/**
 * Every product of the catalog is in the store (ADR-0130): here the store decides whether
 * shoppers see it on the website, its order, its category and collections, and what the store
 * says about it. Prices, stock and pictures stay the catalog's (shared with the POS); whether a
 * product is offered at the point of sale is set in the point-of-sale management only.
 */
export function ProductsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const [adding, setAdding] = useState(false);
  if (!can('online.manage')) return <AccessDenied />;
  return (
    <div>
      <PageHeader
        title={t('nav.products')}
        description={t('products.hint')}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <a className="text-sm text-primary hover:underline" href={managerUrl('products')}>
              {t('nav.catalog')} ↗
            </a>
            {can('catalog.manage') ? (
              <Button onClick={() => setAdding(true)}>{t('products.add')}</Button>
            ) : null}
          </div>
        }
      />
      <Listings />
      {adding ? <AddProductDialog onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

function Listings() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const show: Show = SHOW.includes(params.get('show') as Show)
    ? (params.get('show') as Show)
    : 'all';
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Listing | null>(null);
  const listings = useQuery({
    queryKey: [...key, 'listings'],
    queryFn: () => api.online.listings(),
  });
  const categories = useQuery({
    queryKey: [...key, 'categories'],
    queryFn: () => api.online.categories(),
  });
  const collections = useQuery({
    queryKey: [...key, 'collections'],
    queryFn: () => api.online.collections(),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const bulk = useMutation({
    mutationFn: (body: Parameters<typeof api.online.setListings>[0]) =>
      api.online.setListings(body),
    onSuccess: async () => {
      setSelected(new Set());
      await refresh();
      notify.ok(t('common.saved'));
    },
    onError: notify.fail,
  });
  const visibility = useMutation({
    mutationFn: (p: Listing) =>
      api.online.setListings({ productIds: [p.productId], visible: !p.visible }),
    onSuccess: refresh,
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

  if (listings.isPending || categories.isPending || collections.isPending) return null;
  if (listings.isError)
    return <ErrorState error={listings.error} onRetry={() => void listings.refetch()} />;
  const all = listings.data.products;
  const cats = categories.data?.categories ?? [];
  const cols = collections.data?.collections ?? [];
  const term = search.trim().toLowerCase();
  const matches = (p: Listing) =>
    (!term ||
      `${p.nameEn ?? ''} ${p.nameAr ?? ''} ${p.titleEn ?? ''} ${p.titleAr ?? ''}`
        .toLowerCase()
        .includes(term)) &&
    (show === 'all' ||
      (show === 'website' && p.visible) ||
      (show === 'hidden' && !p.visible) ||
      (show === 'uncategorized' && !p.category));
  const shown = all.filter(matches);
  const ids = all.map((p) => p.productId);
  const uncategorized = all.filter((p) => !p.category).length;
  const onWebsite = all.filter((p) => p.visible).length;
  const collectionName = (id: string) => {
    const c = cols.find((x) => x.id === id);
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
  const productIds = [...selected];

  return (
    <div className="flex flex-col gap-4">
      {uncategorized > 0 ? (
        <Alert tone="warning" data-testid="uncategorized-warning">
          <span>{t('categories.uncategorized', { count: uncategorized })}</span>{' '}
          {show !== 'uncategorized' ? (
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => setParams({ show: 'uncategorized' })}
            >
              {t('categories.linkThem')}
            </button>
          ) : (
            <span className="text-fg-muted">{t('products.linkHint')}</span>
          )}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="max-w-xs"
          type="search"
          aria-label={t('store.searchProducts')}
          placeholder={t('store.searchProducts')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Segmented
          label={t('products.show')}
          value={show}
          options={SHOW.map((value) => ({ value, label: t(`products.show_${value}`) }))}
          onChange={(value) => setParams(value === 'all' ? {} : { show: value })}
        />
      </div>
      {selected.size > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-muted p-3"
          data-testid="bulk-actions"
        >
          <span className="text-sm font-medium">
            {t('products.selected', { count: selected.size })}
          </span>
          <Button
            size="sm"
            loading={bulk.isPending}
            onClick={() => bulk.mutate({ productIds, visible: true })}
          >
            {t('products.showOnWebsite')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={bulk.isPending}
            onClick={() => bulk.mutate({ productIds, visible: false })}
          >
            {t('products.hideFromWebsite')}
          </Button>
          {can('catalog.manage') ? (
            <Select
              className="w-48"
              aria-label={t('products.setCategory')}
              value=""
              onChange={(e) =>
                e.target.value &&
                bulk.mutate({
                  productIds,
                  categoryId: e.target.value === 'none' ? null : e.target.value,
                })
              }
            >
              <option value="">{t('products.setCategory')}</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {localizedName(c, i18n.language)}
                </option>
              ))}
              <option value="none">{t('products.noCategory')}</option>
            </Select>
          ) : null}
          {cols.length > 0 ? (
            <Select
              className="w-48"
              aria-label={t('products.addToCollection')}
              value=""
              onChange={(e) =>
                e.target.value && bulk.mutate({ productIds, addToCollectionId: e.target.value })
              }
            >
              <option value="">{t('products.addToCollection')}</option>
              {cols.map((c) => (
                <option key={c.id} value={c.id}>
                  {localizedName(c, i18n.language)}
                </option>
              ))}
            </Select>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            {t('common.cancel')}
          </Button>
        </div>
      ) : null}
      <Section
        title={t('products.listTitle', { count: all.length, shown: onWebsite })}
        description={term || show !== 'all' ? undefined : t('products.dragHint')}
      >
        {all.length === 0 ? (
          <EmptyState title={t('products.none')} description={t('products.noneHint')} />
        ) : shown.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('products.noMatch')}</p>
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
                  actions={
                    <>
                      <Checkbox
                        className="shrink-0"
                        label={t('products.onWebsite')}
                        checked={p.visible}
                        disabled={
                          visibility.isPending && visibility.variables?.productId === p.productId
                        }
                        onChange={() => visibility.mutate(p)}
                      />
                      <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
                        {t('products.edit')}
                      </Button>
                    </>
                  }
                >
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-primary"
                    aria-label={t('store.selectProduct', { name: displayName(p) })}
                    checked={selected.has(p.productId)}
                    onChange={() => toggle(p.productId)}
                  />
                  <span className="size-12 shrink-0 overflow-hidden rounded-md bg-surface-muted">
                    {p.images[0] ? (
                      <img src={p.images[0].url} alt="" className="size-full object-cover" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="line-clamp-2 font-medium break-words">{displayName(p)}</span>
                      {p.featured ? <Badge tone="primary">{t('products.featured')}</Badge> : null}
                      {!p.visible ? <Badge>{t('products.hiddenOnWebsite')}</Badge> : null}
                      {!p.posVisible ? (
                        <Badge tone="warning">{t('products.hiddenInPos')}</Badge>
                      ) : null}
                      {!p.category ? (
                        <Badge tone="warning">{t('products.noCategory')}</Badge>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-fg-muted">
                      {[
                        formatAmount(p.price, i18n.language),
                        p.category ? localizedName(p.category, i18n.language) : null,
                        ...p.collectionIds.map(collectionName),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </SortableRow>
              );
            })}
          </SortableList>
        )}
      </Section>
      {editing ? (
        <EditDialog
          listing={editing}
          categories={cats}
          collections={cols}
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

/**
 * Quick add from the store console (ADR-0130): a product of the shared catalog, so the point
 * of sale has it too. Name, price, category, picture (chosen, pasted or dropped) and stock
 * tracking; options, barcodes and costs stay in the full catalog form.
 */
function AddProductDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [trackInventory, setTrackInventory] = useState(false);
  const [visible, setVisible] = useState(true);
  const pending = usePendingPicture();
  const categories = useQuery({
    queryKey: [...key, 'categories'],
    queryFn: () => api.online.categories(),
  });
  const save = useMutation({
    mutationFn: async () => {
      const product = await api.catalog.createProduct({
        nameAr: nameAr.trim() || null,
        nameEn: nameEn.trim() || null,
        categoryId: categoryId || null,
        trackInventory,
        variants: [{ nameEn: null, nameAr: null, price: price.trim() }],
      });
      if (pending.picture) await api.catalog.uploadImage(product.id, pending.picture);
      // A new product is shown on the website at once; hiding it is the store's choice.
      if (!visible) await api.online.setListings({ productIds: [product.id], visible: false });
      return product;
    },
    onSuccess: async () => {
      notify.ok(t('products.added'));
      await queryClient.invalidateQueries({ queryKey: key });
      onClose();
    },
    onError: notify.fail,
  });
  const cats: StoreCategory[] = categories.data?.categories ?? [];
  return (
    <Dialog
      open
      onOpenChange={(open) => (!open ? onClose() : undefined)}
      size="lg"
      title={t('products.add')}
      description={t('products.addHint')}
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
        <Field label={t('products.nameAr')}>
          {(p) => <Input {...p} value={nameAr} onChange={(e) => setNameAr(e.target.value)} />}
        </Field>
        <Field label={t('products.nameEn')}>
          {(p) => (
            <Input {...p} dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          )}
        </Field>
        <Field label={t('products.price')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              inputMode="decimal"
              placeholder="0.000"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('products.categoryShared')} hint={t('products.categorySharedHint')}>
          {(p) => (
            <Select {...p} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t('products.noCategory')}</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {localizedName(c, i18n.language)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Checkbox
          label={t('products.trackInventory')}
          description={t('products.trackInventoryHint')}
          checked={trackInventory}
          onChange={(e) => setTrackInventory(e.target.checked)}
        />
        <Checkbox
          label={t('products.onWebsite')}
          description={t('products.onWebsiteHint')}
          checked={visible}
          onChange={(e) => setVisible(e.target.checked)}
        />
        <PictureField
          pending={pending}
          current={null}
          alt={t('products.picture')}
          testId="product-picture"
        />
        <p className="text-xs text-fg-muted sm:col-span-2">
          {t('products.addShared')}{' '}
          <Link className="text-primary hover:underline" to="/categories">
            {t('products.manageCategories')}
          </Link>
        </p>
      </div>
    </Dialog>
  );
}

/** The store's own text and options for one product; the catalog keeps its name and price. */
function EditDialog({
  listing,
  categories,
  collections,
  onClose,
  onSaved,
}: {
  listing: Listing;
  categories: StoreCategory[];
  collections: OnlineCollection[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const { can } = useSession();
  const [v, setV] = useState<SaveListing>({
    titleEn: listing.titleEn,
    titleAr: listing.titleAr,
    descriptionEn: listing.descriptionEn,
    descriptionAr: listing.descriptionAr,
    featured: listing.featured,
    maxPerOrder: listing.maxPerOrder,
    visible: listing.visible,
    collectionIds: listing.collectionIds,
  });
  const [categoryId, setCategoryId] = useState(listing.category?.id ?? '');
  const set = (patch: Partial<SaveListing>) => setV((x) => ({ ...x, ...patch }));
  // The catalog's name, price and pictures are edited here too, like when adding a product.
  const canCatalog = can('catalog.manage');
  const product = useQuery({
    queryKey: [...key, 'product', listing.productId],
    queryFn: () => api.catalog.product(listing.productId),
    enabled: canCatalog,
  });
  const [names, setNames] = useState<{ nameAr: string; nameEn: string; price: string } | null>(
    null,
  );
  const loaded = product.data;
  const base = loaded
    ? {
        nameAr: loaded.nameAr ?? '',
        nameEn: loaded.nameEn ?? '',
        price: loaded.variants.find((x) => x.status === 'active')?.price.amount ?? '',
      }
    : null;
  const shown = names ?? base;
  const setName = (patch: Partial<{ nameAr: string; nameEn: string; price: string }>) =>
    base ? setNames({ ...(names ?? base), ...patch }) : undefined;
  const gallery = usePendingGallery();
  const save = useMutation({
    mutationFn: async () => {
      if (loaded && names && base && JSON.stringify(names) !== JSON.stringify(base))
        await api.catalog.updateProduct(loaded.id, catalogUpdate(loaded, names));
      for (const imageId of gallery.removed)
        await api.catalog.deleteImage(listing.productId, imageId);
      for (const file of gallery.added) await api.catalog.uploadImage(listing.productId, file);
      return api.online.saveListing(listing.productId, {
        ...v,
        // Only a change is sent: moving a product needs "Manage products" (POS too).
        ...((categoryId || null) !== (listing.category?.id ?? null)
          ? { categoryId: categoryId || null }
          : {}),
      });
    },
    onSuccess: async () => {
      notify.ok(t('common.saved'));
      await onSaved();
    },
    onError: notify.fail,
  });
  const chosen = new Set(v.collectionIds ?? []);
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
        {canCatalog && shown && loaded ? (
          <>
            <Field label={t('products.nameAr')}>
              {(p) => (
                <Input
                  {...p}
                  value={shown.nameAr}
                  onChange={(e) => setName({ nameAr: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('products.nameEn')}>
              {(p) => (
                <Input
                  {...p}
                  dir="ltr"
                  value={shown.nameEn}
                  onChange={(e) => setName({ nameEn: e.target.value })}
                />
              )}
            </Field>
            {loaded.hasVariants ? (
              <p className="text-sm text-fg-muted sm:col-span-2">{t('products.optionPrices')}</p>
            ) : (
              <Field
                label={t('products.price')}
                hint={can('catalog.prices.manage') ? undefined : t('products.priceNeedsRight')}
              >
                {(p) => (
                  <Input
                    {...p}
                    dir="ltr"
                    inputMode="decimal"
                    disabled={!can('catalog.prices.manage')}
                    value={shown.price}
                    onChange={(e) => setName({ price: e.target.value })}
                  />
                )}
              </Field>
            )}
          </>
        ) : null}
        {/* Where the product lives first, then where it is also featured (ADR-0130 amendment 1). */}
        <Field
          className="sm:col-span-2"
          label={t('products.categoryShared')}
          hint={
            can('catalog.manage') ? t('products.categorySharedHint') : t('categories.needsCatalog')
          }
        >
          {(p) => (
            <Select
              {...p}
              disabled={!can('catalog.manage')}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">{t('products.noCategory')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {storeCategoryName(c, i18n.language)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {collections.length > 0 ? (
          <div className="sm:col-span-2">
            <p className="mb-1 text-sm font-medium">{t('products.collections')}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {collections.map((c) => (
                <Checkbox
                  key={c.id}
                  label={localizedName(c, i18n.language)}
                  checked={chosen.has(c.id)}
                  onChange={(e) =>
                    set({
                      collectionIds: e.target.checked
                        ? [...chosen, c.id]
                        : [...chosen].filter((x) => x !== c.id),
                    })
                  }
                />
              ))}
            </div>
          </div>
        ) : null}
        <Checkbox
          className="sm:col-span-2"
          label={t('products.onWebsite')}
          description={
            listing.posVisible ? t('products.onWebsiteHint') : t('products.hiddenInPosHint')
          }
          checked={v.visible ?? true}
          onChange={(e) => set({ visible: e.target.checked })}
        />
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
        {text('titleAr', t('products.titleAr'))}
        {text('titleEn', t('products.titleEn'), 'ltr')}
        {area('descriptionAr', t('products.descriptionAr'))}
        {area('descriptionEn', t('products.descriptionEn'), 'ltr')}
        <Checkbox
          label={t('products.featured')}
          description={t('products.featuredHint')}
          checked={v.featured}
          onChange={(e) => set({ featured: e.target.checked })}
        />
        <div className="sm:col-span-2">
          <p className="mb-1 text-sm font-medium">{t('products.images')}</p>
          {canCatalog ? (
            <GalleryField
              pending={gallery}
              current={listing.images}
              max={MAX_PICTURES}
              testId="product-gallery"
            />
          ) : listing.images.length > 0 ? (
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
        </div>
      </div>
    </Dialog>
  );
}

/** Pictures per product (the catalog's limit). */
const MAX_PICTURES = 8;

/**
 * The full catalog form for a product with a new name and (simple product) price: everything
 * else is sent back as it is, so options, barcodes and costs stay untouched.
 */
function catalogUpdate(
  product: Product,
  next: { nameAr: string; nameEn: string; price: string },
): SaveProduct {
  const active = product.variants.filter((x) => x.status === 'active');
  return {
    nameAr: next.nameAr.trim() || null,
    nameEn: next.nameEn.trim() || null,
    descriptionAr: product.descriptionAr,
    descriptionEn: product.descriptionEn,
    categoryId: product.categoryId,
    type: product.type,
    hasVariants: product.hasVariants,
    trackInventory: product.trackInventory,
    availableInAllBranches: product.availableInAllBranches,
    branchIds: product.branchIds,
    posVisible: product.posVisible,
    variants: active.map((x, n) => ({
      id: x.id,
      nameAr: x.nameAr,
      nameEn: x.nameEn,
      sku: x.sku,
      barcodes: x.barcodes,
      price: !product.hasVariants && n === 0 ? next.price.trim() : x.price.amount,
      cost: x.cost ? x.cost.amount : null,
    })),
    version: product.version,
  };
}
