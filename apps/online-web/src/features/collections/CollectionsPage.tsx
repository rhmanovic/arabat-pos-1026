import type { Listing, OnlineCollection, SaveOnlineCollection } from '@arabat/contracts';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Section,
  Select,
} from '@arabat/ui';
import { AccessDenied, ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../app/context.js';
import { PictureField, usePendingPicture } from '../picture.js';
import { key } from '../shared.js';
import { SortableList, SortableRow } from '../sortable.js';

/**
 * Marketing collections of the store (ADR-0130): "Offers", "New in", "Ramadan"… A product may
 * be in several; they are shown next to the categories and never replace them.
 */
export function CollectionsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  if (!can('online.manage')) return <AccessDenied />;
  return (
    <div>
      <PageHeader title={t('nav.collections')} description={t('collections.hint')} />
      <CollectionList />
    </div>
  );
}

function CollectionList() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<OnlineCollection | 'new' | null>(null);
  const [deleting, setDeleting] = useState<OnlineCollection | null>(null);
  const collections = useQuery({
    queryKey: [...key, 'collections'],
    queryFn: () => api.online.collections(),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const order = useMutation({
    mutationFn: (ids: string[]) => api.online.orderCollections(ids),
    onSuccess: refresh,
    onError: async (error) => {
      await refresh();
      notify.fail(error);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.online.deleteCollection(id),
    onSuccess: async () => {
      setDeleting(null);
      await refresh();
      notify.ok(t('collections.deleted'));
    },
    onError: notify.fail,
  });
  if (collections.isPending) return null;
  if (collections.isError)
    return <ErrorState error={collections.error} onRetry={() => void collections.refetch()} />;
  const list = collections.data.collections;
  const ids = list.map((c) => c.id);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={() => setEditing('new')}>{t('collections.add')}</Button>
      </div>
      {list.length === 0 ? (
        <EmptyState title={t('collections.none')} description={t('collections.noneHint')} />
      ) : (
        <Section title={t('collections.listTitle')} description={t('collections.orderHint')}>
          <SortableList ids={ids} onOrder={(next) => order.mutate(next)}>
            {list.map((c, index) => (
              <SortableRow
                key={c.id}
                id={c.id}
                label={localizedName(c, i18n.language)}
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
                    <span className="truncate font-medium">{localizedName(c, i18n.language)}</span>
                    {c.status === 'hidden' ? <Badge>{t('collections.status_hidden')}</Badge> : null}
                  </span>
                  <span className="block text-xs text-fg-muted">
                    {t('categories.productCount', { count: c.productIds.length })}
                  </span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                  {t('products.edit')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(c)}>
                  {t('categories.delete')}
                </Button>
              </SortableRow>
            ))}
          </SortableList>
        </Section>
      )}
      {editing ? (
        <CollectionDialog
          collection={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await refresh();
          }}
        />
      ) : null}
      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(open) => (!open ? setDeleting(null) : undefined)}
        size="sm"
        title={t('collections.deleteTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting.id)}
            >
              {t('categories.delete')}
            </Button>
          </>
        }
      >
        {deleting ? (
          <p className="text-sm">
            {t('collections.deleteHint', { name: localizedName(deleting, i18n.language) })}
          </p>
        ) : null}
      </Dialog>
    </div>
  );
}

/** Add or edit a collection: name, status, picture and its products. */
function CollectionDialog({
  collection,
  onClose,
  onSaved,
}: {
  collection: OnlineCollection | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const [current, setCurrent] = useState<OnlineCollection | null>(collection);
  const [v, setV] = useState<SaveOnlineCollection>({
    nameEn: collection?.nameEn ?? null,
    nameAr: collection?.nameAr ?? null,
    status: collection?.status ?? 'active',
    productIds: collection?.productIds ?? [],
  });
  const [search, setSearch] = useState('');
  const pending = usePendingPicture();
  const listings = useQuery({
    queryKey: [...key, 'listings'],
    queryFn: () => api.online.listings(),
  });
  const set = (patch: Partial<SaveOnlineCollection>) => setV((x) => ({ ...x, ...patch }));
  const save = useMutation({
    mutationFn: async () => {
      let saved = current
        ? await api.online.updateCollection(current.id, { ...v, version: current.version })
        : await api.online.createCollection(v);
      setCurrent(saved);
      if (pending.picture)
        saved = await api.online.uploadCollectionImage(saved.id, pending.picture);
      else if (pending.removed && saved.imageUrl)
        saved = await api.online.removeCollectionImage(saved.id);
      return saved;
    },
    onSuccess: async () => {
      notify.ok(t('common.saved'));
      await onSaved();
      onClose();
    },
    onError: async (error) => {
      notify.fail(error);
      await onSaved();
    },
  });
  const chosen = new Set(v.productIds ?? []);
  const term = search.trim().toLowerCase();
  const products = (listings.data?.products ?? []).filter(
    (p: Listing) => !term || `${p.nameEn ?? ''} ${p.nameAr ?? ''}`.toLowerCase().includes(term),
  );
  const toggle = (id: string, on: boolean) =>
    set({
      productIds: on ? [...(v.productIds ?? []), id] : (v.productIds ?? []).filter((x) => x !== id),
    });
  return (
    <Dialog
      open
      onOpenChange={(open) => (!open ? onClose() : undefined)}
      size="lg"
      title={collection ? t('collections.editTitle') : t('collections.add')}
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
        <Field label={t('categories.nameAr')}>
          {(p) => (
            <Input
              {...p}
              value={v.nameAr ?? ''}
              onChange={(e) => set({ nameAr: e.target.value || null })}
            />
          )}
        </Field>
        <Field label={t('categories.nameEn')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              value={v.nameEn ?? ''}
              onChange={(e) => set({ nameEn: e.target.value || null })}
            />
          )}
        </Field>
        <Field label={t('categories.status')}>
          {(p) => (
            <Select
              {...p}
              value={v.status ?? 'active'}
              onChange={(e) => set({ status: e.target.value as 'active' | 'hidden' })}
            >
              <option value="active">{t('collections.status_active')}</option>
              <option value="hidden">{t('collections.status_hidden')}</option>
            </Select>
          )}
        </Field>
        <PictureField
          pending={pending}
          current={current?.imageUrl ?? null}
          alt={t('collections.picture')}
          testId="collection-picture"
        />
        <div className="sm:col-span-2">
          <p className="mb-1 text-sm font-medium">
            {t('collections.products', { count: chosen.size })}
          </p>
          <Input
            className="mb-2"
            type="search"
            aria-label={t('store.searchProducts')}
            placeholder={t('store.searchProducts')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="grid max-h-56 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
            {products.map((p) => (
              <Checkbox
                key={p.productId}
                label={localizedName(p, i18n.language)}
                description={!p.visible ? t('products.hiddenOnWebsite') : undefined}
                checked={chosen.has(p.productId)}
                onChange={(e) => toggle(p.productId, e.target.checked)}
              />
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
