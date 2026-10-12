import type { Customer, SaveCustomer } from '@arabat/contracts';
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Section,
  Select,
  StatCard,
  Textarea,
} from '@arabat/ui';
import { useApi, useNotify } from '@arabat/web-core';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useBranchName, useSession } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';
import { Pager } from '../inventory/shared.js';

export const customersKey = ['manager', 'customers'] as const;

function Amount({ value }: { value: { amount: string; currency: string } | null | undefined }) {
  const { i18n } = useTranslation();
  return (
    <span dir="ltr" className="tabular-nums">
      {formatAmount(value, i18n.language)}
    </span>
  );
}

function StatusBadge({ status }: { status: Customer['status'] }) {
  const { t } = useTranslation();
  return (
    <Badge tone={status === 'active' ? 'success' : 'neutral'}>
      {status === 'active' ? t('common.active') : t('common.inactive')}
    </Badge>
  );
}

export function CustomersPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const { can } = useSession();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);
  const [status, setStatus] = useState<'' | Customer['status']>('');
  const [sort, setSort] = useState<'recent' | 'name' | 'spend'>('recent');
  const [creating, setCreating] = useState(false);
  const filterKey = JSON.stringify([q, status, sort]);
  const [paging, setPaging] = useState({ key: filterKey, page: 1 });
  const page = paging.key === filterKey ? paging.page : 1;
  const query = { page, pageSize: 25, sort, ...(q ? { q } : {}), ...(status ? { status } : {}) };
  const list = useQuery({
    queryKey: [...customersKey, 'list', query],
    queryFn: () => api.customers.list(query),
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <PageHeader
        title={t('customers.title')}
        description={t('customers.subtitle')}
        actions={
          can('customers.create') ? (
            <Button onClick={() => setCreating(true)}>{t('customers.new')}</Button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          type="search"
          className="max-w-xs"
          aria-label={t('customers.search')}
          placeholder={t('customers.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          className="max-w-44"
          aria-label={t('common.status')}
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="">{t('customers.allStatuses')}</option>
          <option value="active">{t('common.active')}</option>
          <option value="inactive">{t('common.inactive')}</option>
        </Select>
        <Select
          className="max-w-52"
          aria-label={t('customers.sort')}
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
        >
          <option value="recent">{t('customers.sortRecent')}</option>
          <option value="name">{t('customers.sortName')}</option>
          <option value="spend">{t('customers.sortSpend')}</option>
        </Select>
      </div>
      <DataTable<Customer>
        caption={t('customers.title')}
        loading={list.isPending}
        rows={list.data?.customers}
        rowKey={(c) => c.id}
        empty={q || status ? t('customers.noMatch') : t('customers.empty')}
        onRowClick={(c) => void navigate(`/customers/${c.id}`)}
        columns={[
          {
            key: 'name',
            header: t('common.name'),
            cell: (c) => (
              <span>
                <span className="block font-medium">{c.fullName}</span>
                <span className="block text-xs text-fg-muted" dir="ltr">
                  {c.code}
                </span>
              </span>
            ),
          },
          {
            key: 'phone',
            header: t('customers.phone'),
            hideBelow: 'md',
            cell: (c) => <span dir="ltr">{c.phone ?? '—'}</span>,
          },
          {
            key: 'purchases',
            header: t('customers.purchases'),
            hideBelow: 'sm',
            cell: (c) => c.stats.salesCount,
          },
          {
            key: 'net',
            header: t('customers.netSpend'),
            cell: (c) => <Amount value={c.stats.netTotal} />,
          },
          {
            key: 'last',
            header: t('customers.lastPurchase'),
            hideBelow: 'lg',
            cell: (c) =>
              c.stats.lastPurchaseAt ? formatDateTime(c.stats.lastPurchaseAt, i18n.language) : '—',
          },
          {
            key: 'status',
            header: t('common.status'),
            cell: (c) => <StatusBadge status={c.status} />,
          },
        ]}
      />
      <Pager
        page={page}
        total={list.data?.total ?? 0}
        pageSize={25}
        onPage={(p) => setPaging({ key: filterKey, page: p })}
        label={t('customers.count', { count: list.data?.total ?? 0 })}
      />
      {creating ? (
        <CustomerDialog
          customer={null}
          onClose={() => setCreating(false)}
          onSaved={(c) => void navigate(`/customers/${c.id}`)}
        />
      ) : null}
    </div>
  );
}

function CustomerDialog({
  customer,
  onClose,
  onSaved,
}: {
  customer: Customer | null;
  onClose: () => void;
  onSaved?: (c: Customer) => void;
}) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [v, setV] = useState({
    fullName: customer?.fullName ?? '',
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    address: customer?.address ?? '',
    preferredLanguage: customer?.preferredLanguage ?? '',
    status: customer?.status ?? ('active' as Customer['status']),
  });
  const set = (patch: Partial<typeof v>) => setV((c) => ({ ...c, ...patch }));
  const save = useMutation({
    mutationFn: () => {
      const body: SaveCustomer = {
        fullName: v.fullName.trim(),
        phone: v.phone.trim() || null,
        email: v.email.trim() || null,
        address: v.address.trim() || null,
        preferredLanguage: (v.preferredLanguage || null) as 'ar' | 'en' | null,
        status: v.status,
      };
      return customer
        ? api.customers.update(customer.id, { ...body, version: customer.version })
        : api.customers.create(body);
    },
    onSuccess: async (c) => {
      await queryClient.invalidateQueries({ queryKey: customersKey });
      notify.ok(t('common.saved'));
      onClose();
      onSaved?.(c);
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title={customer ? t('customers.edit') : t('customers.new')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!v.fullName.trim()}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('customers.fullName')} className="sm:col-span-2">
          {(p) => (
            <Input {...p} value={v.fullName} onChange={(e) => set({ fullName: e.target.value })} />
          )}
        </Field>
        <Field label={t('customers.phone')} hint={t('customers.phoneHint')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              inputMode="tel"
              value={v.phone}
              onChange={(e) => set({ phone: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('customers.email')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              type="email"
              value={v.email}
              onChange={(e) => set({ email: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('customers.address')} className="sm:col-span-2">
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={v.address}
              onChange={(e) => set({ address: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('customers.language')}>
          {(p) => (
            <Select
              {...p}
              value={v.preferredLanguage}
              onChange={(e) => set({ preferredLanguage: e.target.value })}
            >
              <option value="">—</option>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </Select>
          )}
        </Field>
        <Field label={t('common.status')}>
          {(p) => (
            <Select
              {...p}
              value={v.status}
              onChange={(e) => set({ status: e.target.value as Customer['status'] })}
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

export function CustomerDetailPage() {
  const { customerId } = useParams();
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { can } = useSession();
  const branchName = useBranchName();
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState('');
  const [salesPage, setSalesPage] = useState(1);
  const customer = useQuery({
    queryKey: [...customersKey, 'detail', customerId],
    queryFn: () => api.customers.get(customerId!),
  });
  const salesQuery = useQuery({
    queryKey: [...customersKey, 'sales', customerId, salesPage],
    queryFn: () => api.customers.sales(customerId!, { page: salesPage, pageSize: 10 }),
    placeholderData: keepPreviousData,
  });
  const refunds = useQuery({
    queryKey: [...customersKey, 'refunds', customerId],
    queryFn: () => api.customers.refunds(customerId!),
  });
  const notes = useQuery({
    queryKey: [...customersKey, 'notes', customerId],
    queryFn: () => api.customers.notes(customerId!),
  });
  const addNote = useMutation({
    mutationFn: () => api.customers.addNote(customerId!, note.trim()),
    onSuccess: (r) => {
      queryClient.setQueryData([...customersKey, 'notes', customerId], r);
      setNote('');
      notify.ok(t('customers.noteAdded'));
    },
    onError: notify.fail,
  });
  const c = customer.data;
  if (!c) return null;
  type SaleRow = NonNullable<typeof salesQuery.data>['sales'][number];
  type RefundRow = NonNullable<typeof refunds.data>['refunds'][number];
  return (
    <div>
      <PageHeader
        title={c.fullName}
        description={
          <>
            <span dir="ltr">{c.code}</span>
            {c.phone ? (
              <>
                {' · '}
                <span dir="ltr">{c.phone}</span>
              </>
            ) : null}
            {c.email ? <> · {c.email}</> : null}
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={c.status} />
            {can('customers.manage') ? (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {t('customers.edit')}
              </Button>
            ) : null}
            <Link className="text-sm text-primary" to="/customers">
              {t('common.back')}
            </Link>
          </div>
        }
      />
      <div className="grid gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="customer-stats">
          <StatCard
            label={t('customers.purchases')}
            value={c.stats.salesCount}
            hint={
              c.stats.lastPurchaseAt
                ? `${t('customers.lastPurchase')}: ${formatDateTime(c.stats.lastPurchaseAt, i18n.language)}`
                : undefined
            }
          />
          <StatCard label={t('customers.spent')} value={<Amount value={c.stats.salesTotal} />} />
          <StatCard
            label={t('customers.refunded')}
            value={<Amount value={c.stats.refundedTotal} />}
            hint={t('customers.refundCount', { count: c.stats.refundsCount })}
          />
          <StatCard
            label={t('customers.netSpend')}
            value={<Amount value={c.stats.netTotal} />}
            hint={
              <>
                {t('customers.average')}: <Amount value={c.stats.averageSale} />
              </>
            }
          />
        </div>
        <p className="text-xs text-fg-muted">{t('customers.scopeHint')}</p>

        <Section title={t('customers.purchaseHistory')}>
          <DataTable<SaleRow>
            caption={t('customers.purchaseHistory')}
            loading={salesQuery.isPending}
            rows={salesQuery.data?.sales}
            rowKey={(s) => s.id}
            empty={t('customers.noPurchases')}
            onRowClick={can('sales.read') ? (s) => void navigate(`/sales/${s.id}`) : undefined}
            columns={[
              {
                key: 'receipt',
                header: t('sales.receipt'),
                cell: (s) => (
                  <span dir="ltr" className="font-medium">
                    {s.receiptNumber}
                  </span>
                ),
              },
              {
                key: 'date',
                header: t('inventory.date'),
                cell: (s) => formatDateTime(s.createdAt, i18n.language),
              },
              {
                key: 'branch',
                header: t('purchasing.branch'),
                hideBelow: 'md',
                cell: (s) => branchName(s.branchId) ?? '—',
              },
              { key: 'total', header: t('sales.total'), cell: (s) => <Amount value={s.total} /> },
              {
                key: 'refunded',
                header: t('sales.refunded'),
                hideBelow: 'sm',
                cell: (s) => (s.refunded.amount === '0.000' ? '—' : <Amount value={s.refunded} />),
              },
            ]}
          />
          <Pager
            page={salesPage}
            total={salesQuery.data?.total ?? 0}
            pageSize={10}
            onPage={setSalesPage}
            label={t('customers.purchaseCount', { count: salesQuery.data?.total ?? 0 })}
          />
        </Section>

        <Section title={t('customers.refundHistory')}>
          <DataTable<RefundRow>
            caption={t('customers.refundHistory')}
            loading={refunds.isPending}
            rows={refunds.data?.refunds}
            rowKey={(r) => r.id}
            empty={t('customers.noRefunds')}
            onRowClick={
              can('sales.read') ? (r) => void navigate(`/refunds?saleId=${r.saleId}`) : undefined
            }
            columns={[
              {
                key: 'number',
                header: t('customers.refundNumber'),
                cell: (r) => (
                  <span dir="ltr" className="font-medium">
                    {r.refundNumber}
                  </span>
                ),
              },
              {
                key: 'date',
                header: t('inventory.date'),
                cell: (r) => formatDateTime(r.createdAt, i18n.language),
              },
              {
                key: 'kind',
                header: t('refunds.kind'),
                hideBelow: 'sm',
                cell: (r) => t(`refunds.kind_${r.kind}`, { defaultValue: r.kind }),
              },
              {
                key: 'status',
                header: t('common.status'),
                cell: (r) => t(`refunds.status_${r.status}`, { defaultValue: r.status }),
              },
              { key: 'total', header: t('sales.total'), cell: (r) => <Amount value={r.total} /> },
            ]}
          />
        </Section>

        <Section title={t('customers.notes')}>
          {can('customers.manage') ? (
            <div className="mb-4 grid gap-2">
              <Field label={t('customers.newNote')}>
                {(p) => (
                  <Textarea
                    {...p}
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                )}
              </Field>
              <div className="flex justify-end">
                <Button
                  disabled={!note.trim()}
                  loading={addNote.isPending}
                  onClick={() => addNote.mutate()}
                >
                  {t('customers.addNote')}
                </Button>
              </div>
            </div>
          ) : null}
          {notes.data?.notes.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('customers.noNotes')}</p>
          ) : null}
          <ul className="divide-y divide-border">
            {notes.data?.notes.map((n) => (
              <li key={n.id} className="py-2" data-testid="customer-note">
                <p className="whitespace-pre-wrap">{n.body}</p>
                <p className="text-xs text-fg-muted">
                  {n.author} · {formatDateTime(n.createdAt, i18n.language)}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      </div>
      {editing ? <CustomerDialog customer={c} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}
