import type { Supplier } from '@arabat/contracts';
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from '@arabat/ui';
import { ErrorState, localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useSession } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';

export const suppliersKey = ['manager', 'suppliers'] as const;

export function SuppliersPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { can } = useSession();
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const list = useQuery({ queryKey: suppliersKey, queryFn: () => api.purchasing.suppliers() });
  return (
    <div>
      <PageHeader
        title={t('purchasing.suppliersTitle')}
        description={t('purchasing.suppliersSubtitle')}
        actions={
          can('purchasing.manage') ? (
            <Button onClick={() => setEditing('new')}>{t('purchasing.newSupplier')}</Button>
          ) : null
        }
      />
      <DataTable<Supplier>
        caption={t('purchasing.suppliersTitle')}
        loading={list.isPending}
        error={
          list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : null
        }
        rows={list.data?.suppliers}
        rowKey={(s) => s.id}
        onRowClick={can('purchasing.manage') ? setEditing : undefined}
        columns={[
          {
            key: 'name',
            header: t('common.name'),
            cell: (s) => (
              <span>
                <span className="block font-medium">{localizedName(s, i18n.language)}</span>
                {s.code ? (
                  <span className="block text-xs text-fg-muted" dir="ltr">
                    {s.code}
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            key: 'contact',
            header: t('purchasing.contactName'),
            hideBelow: 'md',
            cell: (s) => s.contactName ?? '—',
          },
          {
            key: 'phone',
            header: t('purchasing.phone'),
            hideBelow: 'lg',
            cell: (s) => <span dir="ltr">{s.phone ?? '—'}</span>,
          },
          { key: 'orders', header: t('purchasing.orders'), cell: (s) => s.orderCount },
          {
            key: 'purchased',
            header: t('purchasing.purchased'),
            hideBelow: 'sm',
            cell: (s) => (
              <span dir="ltr" className="tabular-nums">
                {formatAmount(s.purchasedTotal, i18n.language)}
              </span>
            ),
          },
          {
            key: 'history',
            header: <span className="sr-only">{t('purchasing.history')}</span>,
            cell: (s) => (
              <Link
                className="text-sm text-primary"
                to={`/purchasing?supplierId=${s.id}`}
                onClick={(e) => e.stopPropagation()}
              >
                {t('purchasing.history')}
              </Link>
            ),
          },
          {
            key: 'status',
            header: t('common.status'),
            cell: (s) => (
              <Badge tone={s.status === 'active' ? 'success' : 'neutral'}>
                {s.status === 'active' ? t('common.active') : t('common.inactive')}
              </Badge>
            ),
          },
        ]}
      />
      {editing ? (
        <SupplierDialog
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function SupplierDialog({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [v, setV] = useState({
    code: supplier?.code ?? '',
    nameAr: supplier?.nameAr ?? '',
    nameEn: supplier?.nameEn ?? '',
    contactName: supplier?.contactName ?? '',
    phone: supplier?.phone ?? '',
    email: supplier?.email ?? '',
    address: supplier?.address ?? '',
    taxNumber: supplier?.taxNumber ?? '',
    paymentTerms: supplier?.paymentTerms ?? '',
    notes: supplier?.notes ?? '',
    status: supplier?.status ?? ('active' as const),
  });
  const set = (patch: Partial<typeof v>) => setV((c) => ({ ...c, ...patch }));
  const save = useMutation({
    mutationFn: () => {
      const body = Object.fromEntries(
        Object.entries(v).map(([k, val]) => [k, val === '' ? null : val]),
      ) as typeof v;
      return supplier
        ? api.purchasing.updateSupplier(supplier.id, { ...body, version: supplier.version })
        : api.purchasing.createSupplier(body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: suppliersKey });
      notify.ok(t('common.saved'));
      onClose();
    },
    onError: notify.fail,
  });
  const field = (key: keyof typeof v, label: string, dir?: 'ltr' | 'rtl') => (
    <Field label={label}>
      {(p) => (
        <Input {...p} dir={dir} value={v[key]} onChange={(e) => set({ [key]: e.target.value })} />
      )}
    </Field>
  );
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title={supplier ? t('common.edit') : t('purchasing.newSupplier')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!v.nameAr && !v.nameEn}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {field('nameAr', t('common.nameAr'), 'rtl')}
        {field('nameEn', t('common.nameEn'), 'ltr')}
        {field('code', t('purchasing.code'), 'ltr')}
        {field('contactName', t('purchasing.contactName'))}
        {field('phone', t('purchasing.phone'), 'ltr')}
        {field('email', t('purchasing.email'), 'ltr')}
        {field('taxNumber', t('purchasing.taxNumber'), 'ltr')}
        {field('paymentTerms', t('purchasing.paymentTerms'))}
        <Field label={t('purchasing.address')} className="sm:col-span-2">
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={v.address}
              onChange={(e) => set({ address: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('purchasing.notes')} className="sm:col-span-2">
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={v.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('common.status')}>
          {(p) => (
            <Select
              {...p}
              value={v.status}
              onChange={(e) => set({ status: e.target.value as 'active' | 'inactive' })}
            >
              <option value="active">{t('common.active')}</option>
              <option value="inactive">{t('common.inactive')}</option>
            </Select>
          )}
        </Field>
      </div>
    </Dialog>
  );
}
