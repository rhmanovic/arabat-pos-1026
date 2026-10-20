import type { OnlineCategory, SaveOnlineCategory } from '@arabat/contracts';
import {
  Badge,
  Button,
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
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../app/context.js';
import { key } from '../shared.js';
import { SortableList, SortableRow } from '../sortable.js';

/**
 * The store's own navigation (ADR-0121): categories independent of the POS ones, with a
 * picture each. While there are none, the storefront groups products by the catalog categories.
 */
export function CategoriesPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  if (!can('online.manage')) return <AccessDenied />;
  return (
    <div>
      <PageHeader title={t('nav.categories')} description={t('categories.hint')} />
      <CategoryList />
    </div>
  );
}

function CategoryList() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<OnlineCategory | 'new' | null>(null);
  const [deleting, setDeleting] = useState<OnlineCategory | null>(null);
  const categories = useQuery({
    queryKey: [...key, 'categories'],
    queryFn: () => api.online.categories(),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const order = useMutation({
    mutationFn: (ids: string[]) => api.online.orderCategories(ids),
    onSuccess: refresh,
    onError: async (error) => {
      await refresh();
      notify.fail(error);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.online.deleteCategory(id),
    onSuccess: async () => {
      setDeleting(null);
      await refresh();
      notify.ok(t('categories.deleted'));
    },
    onError: notify.fail,
  });
  if (categories.isPending) return null;
  if (categories.isError)
    return <ErrorState error={categories.error} onRetry={() => void categories.refetch()} />;
  const list = categories.data.categories;
  const ids = list.map((c) => c.id);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={() => setEditing('new')}>{t('categories.add')}</Button>
      </div>
      {list.length === 0 ? (
        <EmptyState title={t('categories.none')} description={t('categories.noneHint')} />
      ) : (
        <Section title={t('categories.listTitle')} description={t('products.dragHint')}>
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
                    {c.status === 'hidden' ? <Badge>{t('categories.status_hidden')}</Badge> : null}
                  </span>
                  <span className="block text-xs text-fg-muted">
                    {t('categories.productCount', { count: c.productCount })}
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
        <CategoryDialog
          category={editing === 'new' ? null : editing}
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
        title={t('categories.deleteTitle')}
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
            {t('categories.deleteHint', {
              name: localizedName(deleting, i18n.language),
              count: deleting.productCount,
            })}
          </p>
        ) : null}
      </Dialog>
    </div>
  );
}

function CategoryDialog({
  category,
  onClose,
  onSaved,
}: {
  category: OnlineCategory | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const fileInput = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<OnlineCategory | null>(category);
  const [v, setV] = useState<SaveOnlineCategory>({
    nameEn: category?.nameEn ?? null,
    nameAr: category?.nameAr ?? null,
    status: category?.status ?? 'active',
  });
  const set = (patch: Partial<SaveOnlineCategory>) => setV((x) => ({ ...x, ...patch }));
  const save = useMutation({
    mutationFn: () =>
      current
        ? api.online.updateCategory(current.id, { ...v, version: current.version })
        : api.online.createCategory(v),
    onSuccess: async (saved) => {
      setCurrent(saved);
      notify.ok(t('common.saved'));
      await onSaved();
      if (!category) return; // a new category stays open so a picture can be added
      onClose();
    },
    onError: notify.fail,
  });
  const upload = useMutation({
    mutationFn: (file: File) => api.online.uploadCategoryImage(current!.id, file),
    onSuccess: async (saved) => {
      setCurrent(saved);
      notify.ok(t('categories.imageSaved'));
      await onSaved();
    },
    onError: notify.fail,
  });
  const removeImage = useMutation({
    mutationFn: () => api.online.removeCategoryImage(current!.id),
    onSuccess: async (saved) => {
      setCurrent(saved);
      await onSaved();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => (!open ? onClose() : undefined)}
      title={current ? t('categories.editTitle') : t('categories.add')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {current ? t('categories.close') : t('common.cancel')}
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
              <option value="active">{t('categories.status_active')}</option>
              <option value="hidden">{t('categories.status_hidden')}</option>
            </Select>
          )}
        </Field>
        {current ? (
          <div className="flex items-center gap-3 sm:col-span-2">
            <span className="size-16 shrink-0 overflow-hidden rounded-md border border-border bg-surface-muted">
              {current.imageUrl ? (
                <img src={current.imageUrl} alt="" className="size-full object-cover" />
              ) : null}
            </span>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-label={t('categories.uploadImage')}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = '';
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              loading={upload.isPending}
              onClick={() => fileInput.current?.click()}
            >
              {t('categories.uploadImage')}
            </Button>
            {current.imageUrl ? (
              <Button
                variant="ghost"
                size="sm"
                loading={removeImage.isPending}
                onClick={() => removeImage.mutate()}
              >
                {t('categories.removeImage')}
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-fg-muted sm:col-span-2">{t('categories.imageAfterSave')}</p>
        )}
      </div>
    </Dialog>
  );
}
