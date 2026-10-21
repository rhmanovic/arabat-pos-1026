import type { SaveStoreCategory, StoreCategory } from '@arabat/contracts';
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
  TabPanel,
  Tabs,
} from '@arabat/ui';
import { AccessDenied, ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useSession } from '../../app/context.js';
import { CollectionList } from '../collections/CollectionsPage.js';
import { PictureField, usePendingPicture } from '../picture.js';
import { key } from '../shared.js';
import { SortableList, SortableRow } from '../sortable.js';

/** The store's name of a category: its own name when set, else the shared one. */
export function storeCategoryName(c: StoreCategory, language: string) {
  return localizedName(
    { nameEn: c.onlineNameEn || c.nameEn, nameAr: c.onlineNameAr || c.nameAr },
    language,
  );
}

/**
 * One page, two tabs (ADR-0130 amendment 1): the categories are where a product lives — one
 * tree shared with the point of sale, with the store's own presentation of each (shown or not,
 * order, an optional store name and a picture); the special lists ("Offers", "New in"…) are an
 * optional extra to feature products, and never change a product's category.
 */
export function CategoriesPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'lists' ? 'lists' : 'categories';
  if (!can('online.manage')) return <AccessDenied />;
  return (
    <div>
      <PageHeader title={t('nav.categories')} description={t('categories.pageHint')} />
      <Tabs
        value={tab}
        onValueChange={(value) => setParams(value === 'lists' ? { tab: 'lists' } : {})}
        tabs={[
          { value: 'categories', label: t('categories.tab_categories') },
          { value: 'lists', label: t('categories.tab_lists') },
        ]}
      >
        <TabPanel value="categories">
          <p className="mb-3 text-sm text-fg-muted">{t('categories.hint')}</p>
          <Alert tone="info" className="mb-4" data-testid="categories-shared">
            {t('categories.sharedNote')}
          </Alert>
          <CategoryList />
        </TabPanel>
        <TabPanel value="lists">
          <p className="mb-4 text-sm text-fg-muted">{t('collections.hint')}</p>
          <CollectionList />
        </TabPanel>
      </Tabs>
    </div>
  );
}

function CategoryList() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<StoreCategory | 'new' | null>(null);
  const categories = useQuery({
    queryKey: [...key, 'categories'],
    queryFn: () => api.online.categories(),
  });
  const collections = useQuery({
    queryKey: [...key, 'collections'],
    queryFn: () => api.online.collections(),
  });
  const listings = useQuery({
    queryKey: [...key, 'listings'],
    queryFn: () => api.online.listings(),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  // Collections holding products without a category (typically the store categories of
  // ADR-0121): one click turns each into a shared category, reusing one of the same name.
  const loose = new Set(
    (listings.data?.products ?? []).filter((p) => !p.category).map((p) => p.productId),
  );
  const candidates = (collections.data?.collections ?? []).filter((c) =>
    c.productIds.some((id) => loose.has(id)),
  );
  const fromCollections = useMutation({
    mutationFn: async () => {
      const same = (a: string | null, b: string | null) =>
        Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
      let known = categories.data?.categories ?? [];
      for (const c of candidates) {
        const found =
          known.find((k) => same(k.nameEn, c.nameEn) || same(k.nameAr, c.nameAr)) ??
          (await api.online.createCategory({ nameEn: c.nameEn, nameAr: c.nameAr }));
        known = [...known, found];
        const productIds = c.productIds.filter((id) => loose.has(id));
        if (productIds.length > 0) {
          await api.online.setListings({ productIds, categoryId: found.id });
          for (const id of productIds) loose.delete(id);
        }
      }
    },
    onSuccess: async () => {
      await refresh();
      notify.ok(t('categories.fromCollectionsDone'));
    },
    onError: async (error) => {
      await refresh();
      notify.fail(error);
    },
  });
  const order = useMutation({
    mutationFn: (ids: string[]) => api.online.orderCategories(ids),
    onSuccess: refresh,
    onError: async (error) => {
      await refresh();
      notify.fail(error);
    },
  });
  const toggle = useMutation({
    mutationFn: (c: StoreCategory) =>
      api.online.updateCategory(c.id, {
        nameEn: c.nameEn,
        nameAr: c.nameAr,
        onlineNameEn: c.onlineNameEn,
        onlineNameAr: c.onlineNameAr,
        visible: !c.visible,
        version: c.version,
      }),
    onSuccess: refresh,
    onError: async (error) => {
      await refresh();
      notify.fail(error);
    },
  });
  if (categories.isPending) return null;
  if (categories.isError)
    return <ErrorState error={categories.error} onRetry={() => void categories.refetch()} />;
  const { categories: list, uncategorized } = categories.data;
  const ids = list.map((c) => c.id);
  const canCreate = can('catalog.manage');
  return (
    <div className="flex flex-col gap-4">
      {uncategorized > 0 ? (
        <Alert tone="warning" data-testid="uncategorized-warning">
          <span>{t('categories.uncategorized', { count: uncategorized })}</span>{' '}
          <Link
            className="font-medium text-primary hover:underline"
            to="/products?show=uncategorized"
          >
            {t('categories.linkThem')}
          </Link>
        </Alert>
      ) : null}
      {canCreate && candidates.length > 0 ? (
        <Alert tone="info" data-testid="from-collections">
          <p>{t('categories.fromCollections', { count: candidates.length })}</p>
          <Button
            className="mt-2"
            size="sm"
            loading={fromCollections.isPending}
            onClick={() => fromCollections.mutate()}
          >
            {t('categories.fromCollectionsAction')}
          </Button>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setEditing('new')} disabled={!canCreate}>
          {t('categories.add')}
        </Button>
        {!canCreate ? (
          <span className="text-xs text-fg-muted">{t('categories.needsCatalog')}</span>
        ) : null}
      </div>
      {list.length === 0 ? (
        <EmptyState title={t('categories.none')} description={t('categories.noneHint')} />
      ) : (
        <Section title={t('categories.listTitle')} description={t('categories.orderHint')}>
          <SortableList ids={ids} onOrder={(next) => order.mutate(next)}>
            {list.map((c, index) => (
              <SortableRow
                key={c.id}
                id={c.id}
                label={storeCategoryName(c, i18n.language)}
                first={index === 0}
                last={index === list.length - 1}
                onMove={(by) => {
                  const next = [...ids];
                  next.splice(index, 1);
                  next.splice(index + by, 0, c.id);
                  order.mutate(next);
                }}
              >
                <span className="size-12 shrink-0 overflow-hidden rounded-md bg-surface-muted">
                  {c.imageUrl ? (
                    <img src={c.imageUrl} alt="" className="size-full object-cover" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">
                      {storeCategoryName(c, i18n.language)}
                    </span>
                    {!c.visible ? <Badge>{t('categories.hiddenInStore')}</Badge> : null}
                  </span>
                  <span className="block truncate text-xs text-fg-muted">
                    {[
                      t('categories.productCount', { count: c.productCount }),
                      c.onlineNameAr || c.onlineNameEn
                        ? t('categories.posName', { name: localizedName(c, i18n.language) })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <Checkbox
                  className="shrink-0"
                  label={t('categories.shownInStore')}
                  checked={c.visible}
                  disabled={toggle.isPending}
                  onChange={() => toggle.mutate(c)}
                />
                <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                  {t('products.edit')}
                </Button>
              </SortableRow>
            ))}
          </SortableList>
        </Section>
      )}
      {editing ? (
        <CategoryDialog
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Add or edit a category. The shared name changes the point of sale too (needs "Manage
 * products"); the store name, "shown in the store" and the picture are the store's only. The
 * picture can be chosen, pasted (Ctrl+V anywhere in the dialog) or dropped before saving.
 */
export function CategoryDialog({
  category,
  onClose,
  onSaved,
}: {
  category: StoreCategory | null;
  onClose: () => void;
  onSaved: (saved: StoreCategory) => Promise<void>;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const { can } = useSession();
  const canRename = can('catalog.manage');
  // Set once the category exists, so a retry after a failed picture upload updates it.
  const [current, setCurrent] = useState<StoreCategory | null>(category);
  const [v, setV] = useState<SaveStoreCategory>({
    nameEn: category?.nameEn ?? null,
    nameAr: category?.nameAr ?? null,
    onlineNameEn: category?.onlineNameEn ?? null,
    onlineNameAr: category?.onlineNameAr ?? null,
    visible: category?.visible ?? true,
  });
  const pending = usePendingPicture();
  const set = (patch: Partial<SaveStoreCategory>) => setV((x) => ({ ...x, ...patch }));
  const save = useMutation({
    mutationFn: async () => {
      let saved = current
        ? await api.online.updateCategory(current.id, { ...v, version: current.version })
        : await api.online.createCategory(v);
      setCurrent(saved);
      if (pending.picture) saved = await api.online.uploadCategoryImage(saved.id, pending.picture);
      else if (pending.removed && saved.imageUrl)
        saved = await api.online.removeCategoryImage(saved.id);
      return saved;
    },
    onSuccess: async (saved) => {
      notify.ok(t('common.saved'));
      await onSaved(saved);
      onClose();
    },
    onError: async (error) => {
      notify.fail(error);
      if (current) await onSaved(current);
    },
  });
  const name = (field: 'nameAr' | 'nameEn' | 'onlineNameAr' | 'onlineNameEn', dir?: 'ltr') => (
    <Field
      label={t(`categories.${field}`)}
      hint={field.startsWith('online') ? t('categories.onlineNameHint') : undefined}
    >
      {(p) => (
        <Input
          {...p}
          dir={dir}
          disabled={!field.startsWith('online') && !canRename}
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
      title={category ? t('categories.editTitle') : t('categories.add')}
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
        {name('nameAr')}
        {name('nameEn', 'ltr')}
        <p className="text-xs text-fg-muted sm:col-span-2">
          {canRename ? t('categories.sharedNameHint') : t('categories.needsCatalog')}
        </p>
        {name('onlineNameAr')}
        {name('onlineNameEn', 'ltr')}
        <Checkbox
          className="sm:col-span-2"
          label={t('categories.shownInStore')}
          description={t('categories.shownInStoreHint')}
          checked={v.visible ?? true}
          onChange={(e) => set({ visible: e.target.checked })}
        />
        <PictureField
          pending={pending}
          current={current?.imageUrl ?? null}
          alt={t('categories.picture')}
          testId="category-picture"
        />
      </div>
    </Dialog>
  );
}
