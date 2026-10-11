import { type Category, saveCategorySchema } from '@arabat/contracts';
import { Badge, Button, DataTable, Dialog, Field, Input, PageHeader, Select } from '@arabat/ui';
import { localizedName, useApi, useNotify } from '@arabat/web-core';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { useSession } from '../../app/context.js';

export const categoriesKey = ['manager', 'categories'] as const;

export function CategoriesPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const list = useQuery({ queryKey: categoriesKey, queryFn: () => api.catalog.categories() });
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const categories = list.data?.categories ?? [];
  const name = (id: string | null) => {
    const c = categories.find((x) => x.id === id);
    return c ? localizedName(c, i18n.language) : '—';
  };
  const status = useMutation({
    mutationFn: (c: Category) =>
      api.catalog.setCategoryStatus(c.id, c.status === 'active' ? 'archived' : 'active'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: categoriesKey });
      notify.ok(t('common.saved'));
    },
    onError: notify.fail,
  });

  return (
    <div>
      <PageHeader
        title={t('catalog.categoriesTitle')}
        description={t('catalog.categoriesSubtitle')}
        actions={
          can('catalog.manage') ? (
            <Button onClick={() => setEditing('new')}>{t('catalog.newCategory')}</Button>
          ) : null
        }
      />
      <DataTable
        caption={t('catalog.categoriesTitle')}
        loading={list.isPending}
        rows={categories}
        rowKey={(c) => c.id}
        empty={t('catalog.emptyCategories')}
        columns={[
          {
            key: 'name',
            header: t('common.name'),
            cell: (c) => <span className="font-medium">{localizedName(c, i18n.language)}</span>,
          },
          {
            key: 'parent',
            header: t('catalog.parent'),
            hideBelow: 'md',
            cell: (c) => (c.parentId ? name(c.parentId) : '—'),
          },
          { key: 'count', header: t('catalog.products'), cell: (c) => c.productCount },
          {
            key: 'status',
            header: t('common.status'),
            cell: (c) => (
              <Badge tone={c.status === 'active' ? 'success' : 'neutral'}>
                {c.status === 'active' ? t('catalog.statusActive') : t('catalog.statusArchived')}
              </Badge>
            ),
          },
          {
            key: 'actions',
            header: <span className="sr-only">{t('common.actions')}</span>,
            className: 'text-end',
            cell: (c) =>
              can('catalog.manage') ? (
                <span className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                    {t('common.edit')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => status.mutate(c)}>
                    {c.status === 'active' ? t('catalog.archive') : t('catalog.restore')}
                  </Button>
                </span>
              ) : null,
          },
        ]}
      />
      {editing ? (
        <CategoryDialog
          category={editing === 'new' ? null : editing}
          all={categories}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

type Values = z.input<typeof saveCategorySchema>;

function CategoryDialog({
  category,
  all,
  onClose,
}: {
  category: Category | null;
  all: Category[];
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const form = useForm<Values>({ resolver: zodResolver(saveCategorySchema) });
  useEffect(() => {
    form.reset({
      nameAr: category?.nameAr ?? '',
      nameEn: category?.nameEn ?? '',
      parentId: category?.parentId ?? null,
      sortOrder: category?.sortOrder ?? 0,
    });
  }, [category, form]);
  const save = useMutation({
    mutationFn: (v: Values) =>
      category
        ? api.catalog.updateCategory(category.id, { ...v, version: category.version })
        : api.catalog.createCategory(v),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: categoriesKey });
      notify.ok(t('common.saved'));
      onClose();
    },
    onError: notify.fail,
  });
  const invalid = t('common:errors.VALIDATION_FAILED');
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={category ? t('common.edit') : t('catalog.newCategory')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="category-form" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="category-form"
        noValidate
        className="grid gap-4"
        onSubmit={form.handleSubmit((v) => save.mutate({ ...v, parentId: v.parentId || null }))}
      >
        <Field label={t('common.nameAr')} error={form.formState.errors.nameAr && invalid}>
          {(p) => <Input {...p} {...form.register('nameAr')} dir="rtl" />}
        </Field>
        <Field label={t('common.nameEn')}>
          {(p) => <Input {...p} {...form.register('nameEn')} dir="ltr" />}
        </Field>
        <Field label={t('catalog.parent')}>
          {(p) => (
            <Select {...p} {...form.register('parentId')}>
              <option value="">—</option>
              {all
                .filter((c) => c.id !== category?.id && c.status === 'active')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {localizedName(c, i18n.language)}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field label={t('catalog.sortOrder')}>
          {(p) => (
            <Input
              {...p}
              type="number"
              min={0}
              {...form.register('sortOrder', { valueAsNumber: true })}
              dir="ltr"
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
