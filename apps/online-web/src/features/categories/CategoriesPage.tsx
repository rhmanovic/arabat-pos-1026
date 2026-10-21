import type { OnlineCategory, SaveOnlineCategory } from '@arabat/contracts';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Section,
  Select,
  cn,
} from '@arabat/ui';
import { AccessDenied, ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
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
      <Alert tone="info" className="mb-4" data-testid="categories-separate">
        {t('categories.separateNote')}
      </Alert>
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

/** The first picture in a paste or a drop, if any. */
function pictureFrom(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const file of Array.from(data.files)) if (file.type.startsWith('image/')) return file;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

/**
 * Add or edit a store category. The picture can be chosen, pasted (Ctrl+V anywhere in the
 * dialog) or dropped before saving; "Save" stores the category, then its picture, then closes.
 */
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
  // Set once the category exists, so a retry after a failed picture upload updates it.
  const [current, setCurrent] = useState<OnlineCategory | null>(category);
  const [v, setV] = useState<SaveOnlineCategory>({
    nameEn: category?.nameEn ?? null,
    nameAr: category?.nameAr ?? null,
    status: category?.status ?? 'active',
  });
  const [picture, setPicture] = useState<File | null>(null);
  const [removePicture, setRemovePicture] = useState(false);
  const [dragging, setDragging] = useState(false);
  const preview = useMemo(
    () =>
      picture && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(picture) : null,
    [picture],
  );
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);
  const choose = (file: File | null) => {
    if (!file) return;
    setPicture(file);
    setRemovePicture(false);
  };
  // A picture pasted anywhere while the dialog is open becomes its picture.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = pictureFrom(event.clipboardData);
      if (!file) return;
      event.preventDefault();
      choose(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);
  const set = (patch: Partial<SaveOnlineCategory>) => setV((x) => ({ ...x, ...patch }));
  const save = useMutation({
    mutationFn: async () => {
      let saved = current
        ? await api.online.updateCategory(current.id, { ...v, version: current.version })
        : await api.online.createCategory(v);
      setCurrent(saved);
      if (picture) saved = await api.online.uploadCategoryImage(saved.id, picture);
      else if (removePicture && saved.imageUrl)
        saved = await api.online.removeCategoryImage(saved.id);
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
  const shown = preview ?? (removePicture ? null : (current?.imageUrl ?? null));
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
        <div
          className={cn(
            'flex items-center gap-3 rounded-xl border-2 border-dashed p-3 sm:col-span-2',
            dragging ? 'border-primary bg-primary-soft' : 'border-border',
          )}
          data-testid="category-picture"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            choose(pictureFrom(e.dataTransfer));
          }}
        >
          <span className="size-16 shrink-0 overflow-hidden rounded-md border border-border bg-surface-muted">
            {shown ? (
              <img src={shown} alt={t('categories.picture')} className="size-full object-cover" />
            ) : null}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="text-xs text-fg-muted">{t('categories.pasteHint')}</p>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="sr-only"
                aria-label={t('categories.uploadImage')}
                onChange={(e) => {
                  choose(e.target.files?.[0] ?? null);
                  e.target.value = '';
                }}
              />
              <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
                {t('categories.uploadImage')}
              </Button>
              {shown ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPicture(null);
                    setRemovePicture(true);
                  }}
                >
                  {t('categories.removeImage')}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        <p className="text-xs text-fg-muted sm:col-span-2">{t('categories.separateNote')}</p>
      </div>
    </Dialog>
  );
}
