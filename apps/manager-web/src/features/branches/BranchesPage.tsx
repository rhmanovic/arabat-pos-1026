import { type BranchDetail, createBranchSchema } from '@arabat/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Textarea,
} from '@arabat/ui';
import { localizedName, useApi, useNotify } from '@arabat/web-core';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { branchesKey, useBranchContext, useSession } from '../../app/context.js';

type FormValues = z.input<typeof createBranchSchema>;

export function BranchesPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const { can } = useSession();
  const { branches, isLoading } = useBranchContext();
  const [editing, setEditing] = useState<BranchDetail | 'new' | null>(null);
  const [deactivating, setDeactivating] = useState<BranchDetail | null>(null);

  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: 'active' | 'inactive' }) =>
      api.branches.setStatus(v.id, v.status),
    onSuccess: async (b) => {
      await queryClient.invalidateQueries({ queryKey: branchesKey });
      notify.ok(b.status === 'active' ? t('branches.activated') : t('branches.deactivated'));
      setDeactivating(null);
    },
    onError: notify.fail,
  });

  return (
    <div>
      <PageHeader
        title={t('branches.title')}
        description={t('branches.subtitle')}
        actions={
          can('branches.manage') ? (
            <Button onClick={() => setEditing('new')}>{t('branches.add')}</Button>
          ) : null
        }
      />
      <DataTable
        caption={t('branches.title')}
        loading={isLoading}
        rows={branches}
        rowKey={(b) => b.id}
        empty={t('branches.empty')}
        columns={[
          {
            key: 'code',
            header: t('branches.code'),
            cell: (b) => (
              <span dir="ltr" className="font-mono text-xs">
                {b.code}
              </span>
            ),
          },
          {
            key: 'name',
            header: t('common.name'),
            cell: (b) => (
              <span className="flex items-center gap-2 font-medium">
                {localizedName(b, i18n.language)}
                {b.isMain ? <Badge tone="primary">{t('branches.main')}</Badge> : null}
              </span>
            ),
          },
          {
            key: 'phone',
            header: t('common.phone'),
            hideBelow: 'md',
            cell: (b) => <span dir="ltr">{b.phone ?? '—'}</span>,
          },
          {
            key: 'employees',
            header: t('branches.employees'),
            hideBelow: 'sm',
            cell: (b) => b.employeeCount,
          },
          {
            key: 'status',
            header: t('common.status'),
            cell: (b) => (
              <Badge tone={b.status === 'active' ? 'success' : 'neutral'}>
                {t(`common.${b.status}`)}
              </Badge>
            ),
          },
          {
            key: 'actions',
            header: <span className="sr-only">{t('common.actions')}</span>,
            className: 'text-end',
            cell: (b) => (
              <span className="flex justify-end gap-2">
                {can('branches.update') ? (
                  <Button size="sm" variant="secondary" onClick={() => setEditing(b)}>
                    {t('common.edit')}
                  </Button>
                ) : null}
                {can('branches.manage') && !b.isMain ? (
                  b.status === 'active' ? (
                    <Button size="sm" variant="ghost" onClick={() => setDeactivating(b)}>
                      {t('common.deactivate')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={setStatus.isPending}
                      onClick={() => setStatus.mutate({ id: b.id, status: 'active' })}
                    >
                      {t('common.activate')}
                    </Button>
                  )
                ) : null}
              </span>
            ),
          },
        ]}
      />
      {editing ? (
        <BranchDialog
          branch={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(deactivating)}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title={t('branches.deactivateTitle')}
        description={t('branches.deactivateBody')}
        confirmLabel={t('common.deactivate')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        loading={setStatus.isPending}
        onConfirm={() =>
          deactivating && setStatus.mutate({ id: deactivating.id, status: 'inactive' })
        }
      />
    </div>
  );
}

function BranchDialog({ branch, onClose }: { branch: BranchDetail | null; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({ resolver: zodResolver(createBranchSchema) });
  useEffect(() => {
    form.reset({
      code: branch?.code ?? '',
      nameAr: branch?.nameAr ?? '',
      nameEn: branch?.nameEn ?? '',
      phone: branch?.phone ?? '',
      address: branch?.address ?? '',
      receiptHeader: branch?.receiptHeader ?? '',
      receiptFooter: branch?.receiptFooter ?? '',
    });
  }, [branch, form]);
  const save = useMutation({
    mutationFn: (v: FormValues) =>
      branch
        ? api.branches.update(branch.id, { ...v, version: branch.version })
        : api.branches.create(v),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: branchesKey });
      notify.ok(branch ? t('common.saved') : t('branches.created'));
      onClose();
    },
    onError: notify.fail,
  });
  const e = form.formState.errors;
  const invalid = t('common:errors.VALIDATION_FAILED');
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={branch ? t('common.edit') : t('branches.add')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="branch-form" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="branch-form"
        noValidate
        onSubmit={form.handleSubmit((v) => save.mutate(v))}
        className="grid gap-4 md:grid-cols-2"
      >
        <Field label={t('branches.code')} hint={t('branches.codeHint')} error={e.code && invalid}>
          {(p) => <Input {...p} {...form.register('code')} dir="ltr" className="uppercase" />}
        </Field>
        <span className="max-md:hidden" />
        <Field label={t('common.nameAr')} error={e.nameAr && invalid}>
          {(p) => <Input {...p} {...form.register('nameAr')} dir="rtl" />}
        </Field>
        <Field label={t('common.nameEn')} error={e.nameEn && invalid}>
          {(p) => <Input {...p} {...form.register('nameEn')} dir="ltr" />}
        </Field>
        <Field label={t('common.phone')} error={e.phone && invalid}>
          {(p) => <Input {...p} {...form.register('phone')} type="tel" dir="ltr" />}
        </Field>
        <Field label={t('branches.address')} error={e.address && invalid}>
          {(p) => <Input {...p} {...form.register('address')} />}
        </Field>
        <Field
          label={t('branches.receiptHeader')}
          error={e.receiptHeader && invalid}
          className="md:col-span-2"
        >
          {(p) => <Textarea {...p} {...form.register('receiptHeader')} rows={2} />}
        </Field>
        <Field
          label={t('branches.receiptFooter')}
          error={e.receiptFooter && invalid}
          className="md:col-span-2"
        >
          {(p) => <Textarea {...p} {...form.register('receiptFooter')} rows={2} />}
        </Field>
      </form>
    </Dialog>
  );
}
