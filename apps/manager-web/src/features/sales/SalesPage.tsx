import type { SaleListQuery } from '@arabat/contracts';
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Section,
  StatCard,
} from '@arabat/ui';
import { localizedName, useApi, useNotify } from '@arabat/web-core';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useBranchContext, useBranchName, useSession } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';
import { formatDateTime } from '../inventory/AdjustmentsPage.js';
import { Pager, displayQty } from '../inventory/shared.js';

export const salesKey = ['manager', 'sales'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function Amount({ value }: { value: { amount: string; currency: string } | null | undefined }) {
  const { i18n } = useTranslation();
  return (
    <span dir="ltr" className="tabular-nums">
      {formatAmount(value, i18n.language)}
    </span>
  );
}

export function SalesPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const { can } = useSession();
  const { branchId } = useBranchContext();
  const branchName = useBranchName();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [policy, setPolicy] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  const filterKey = JSON.stringify([q, from, to, branchId]);
  const [paging, setPaging] = useState({ key: filterKey, page: 1 });
  const page = paging.key === filterKey ? paging.page : 1;
  const query: SaleListQuery = {
    page,
    pageSize: 25,
    ...(q ? { q } : {}),
    ...(DATE.test(from) ? { from } : {}),
    ...(DATE.test(to) ? { to } : {}),
    ...(branchId ? { branchId } : {}),
  };
  const list = useQuery({
    queryKey: [...salesKey, query],
    queryFn: () => api.sales.list(query),
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <PageHeader
        title={t('sales.title')}
        description={t('sales.subtitle')}
        actions={
          can('merchant.settings.update') ? (
            <Button variant="secondary" onClick={() => setPolicy(true)}>
              {t('sales.policy')}
            </Button>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Input
          className="max-w-xs"
          type="search"
          aria-label={t('sales.search')}
          placeholder={t('sales.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          {t('inventory.from')}
          <Input
            type="date"
            className="w-40"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          {t('inventory.to')}
          <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {list.data ? (
        <p className="mb-3 text-sm text-fg-muted" data-testid="sales-summary">
          {t('sales.summary', {
            count: list.data.totals.count,
            amount: formatAmount(list.data.totals.amount, i18n.language),
            refunded: formatAmount(list.data.totals.refunded, i18n.language),
            net: formatAmount(list.data.totals.net, i18n.language),
          })}
        </p>
      ) : null}
      <DataTable
        caption={t('sales.title')}
        loading={list.isPending}
        rows={list.data?.sales}
        rowKey={(s) => s.id}
        empty={t('sales.empty')}
        onRowClick={(s) => void navigate(`/sales/${s.id}`)}
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
            header: t('sales.date'),
            cell: (s) => formatDateTime(s.createdAt, i18n.language),
          },
          {
            key: 'branch',
            header: t('inventory.branch'),
            hideBelow: 'md',
            cell: (s) => branchName(s.branchId) ?? '—',
          },
          {
            key: 'cashier',
            header: t('sales.cashier'),
            hideBelow: 'sm',
            cell: (s) => s.cashierName,
          },
          {
            key: 'customer',
            header: t('sales.customer'),
            hideBelow: 'lg',
            cell: (s) => s.customerName ?? t('sales.walkIn'),
          },
          {
            key: 'items',
            header: t('sales.items'),
            hideBelow: 'lg',
            cell: (s) => displayQty(s.itemCount),
          },
          {
            key: 'payments',
            header: t('sales.payments'),
            hideBelow: 'lg',
            cell: (s) => (
              <span className="flex flex-wrap gap-1">
                {s.paymentKinds.map((k) => (
                  <Badge key={k}>{t(`sales.kind_${k}`)}</Badge>
                ))}
              </span>
            ),
          },
          { key: 'total', header: t('sales.total'), cell: (s) => <Amount value={s.total} /> },
        ]}
      />
      <Pager
        page={page}
        total={list.data?.total ?? 0}
        pageSize={25}
        onPage={(p) => setPaging({ key: filterKey, page: p })}
        label={t('inventory.count', { count: list.data?.total ?? 0 })}
      />
      {policy ? <PolicyDialog onClose={() => setPolicy(false)} /> : null}
    </div>
  );
}

function PolicyDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: [...salesKey, 'settings'],
    queryFn: () => api.sales.managerSettings(),
  });
  const [value, setValue] = useState<string | null>(null);
  const [days, setDays] = useState<string | null>(null);
  const [limit, setLimit] = useState<string | null>(null);
  const current = value ?? settings.data?.maxDiscountPercent ?? '';
  const windowDays = days ?? String(settings.data?.refundWindowDays ?? '');
  const approvalLimit = limit ?? settings.data?.refundApprovalLimit.amount ?? '';
  const valid =
    /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/.test(current.trim()) &&
    /^\d{1,4}$/.test(windowDays.trim()) &&
    /^\d{1,10}(\.\d{1,3})?$/.test(approvalLimit.trim());
  const save = useMutation({
    mutationFn: () =>
      api.sales.updateSettings({
        maxDiscountPercent: current.trim(),
        refundWindowDays: Number.parseInt(windowDays.trim(), 10),
        refundApprovalLimit: approvalLimit.trim(),
        version: settings.data!.version,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: salesKey });
      notify.ok(t('common.saved'));
      onClose();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('sales.policy')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!valid || !settings.data}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label={t('sales.maxDiscount')} hint={t('sales.maxDiscountHint')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              inputMode="decimal"
              value={current}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('sales.refundWindow')} hint={t('sales.refundWindowHint')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              inputMode="numeric"
              value={windowDays}
              onChange={(e) => setDays(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('sales.refundLimit')} hint={t('sales.refundLimitHint')}>
          {(p) => (
            <Input
              {...p}
              dir="ltr"
              inputMode="decimal"
              value={approvalLimit}
              onChange={(e) => setLimit(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

export function SaleDetailPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { saleId } = useParams();
  const branchName = useBranchName();
  const { can } = useSession();
  const sale = useQuery({
    queryKey: [...salesKey, 'detail', saleId],
    queryFn: () => api.sales.get(saleId!),
  });
  const s = sale.data;
  return (
    <div>
      <PageHeader
        title={s ? `${t('sales.detail')} ${s.receiptNumber}` : t('sales.detail')}
        description={
          s
            ? `${formatDateTime(s.createdAt, i18n.language)} · ${branchName(s.branchId) ?? ''} · ${s.cashierName}`
            : undefined
        }
        actions={
          <Link className="text-sm text-primary" to="/sales">
            {t('common.back')}
          </Link>
        }
      />
      {s ? (
        <div className="grid gap-6">
          <p className="text-sm" data-testid="sale-customer">
            {t('sales.customer')}:{' '}
            {s.customer ? (
              can('customers.read') ? (
                <Link className="text-primary" to={`/customers/${s.customer.id}`}>
                  {s.customer.fullName} <span dir="ltr">({s.customer.code})</span>
                </Link>
              ) : (
                s.customer.fullName
              )
            ) : (
              t('sales.walkIn')
            )}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={t('sales.total')} value={<Amount value={s.total} />} />
            <StatCard
              label={t('sales.lineDiscounts')}
              value={<Amount value={s.lineDiscounts} />}
              hint={
                <>
                  {t('sales.orderDiscount')}: <Amount value={s.orderDiscount} />
                </>
              }
            />
            <StatCard
              label={t('sales.refunded')}
              value={<Amount value={s.refunded} />}
              hint={
                s.refunded.amount !== '0.000' ? (
                  <Link className="text-primary" to={`/refunds?saleId=${s.id}`}>
                    {t('nav.refunds')}
                  </Link>
                ) : undefined
              }
            />
            <StatCard label={t('sales.fees')} value={<Amount value={s.fees} />} />
            {s.cost !== undefined ? (
              <StatCard label={t('sales.cost')} value={<Amount value={s.cost} />} />
            ) : null}
          </div>
          <DataTable
            caption={t('sales.lines')}
            rows={s.lines}
            rowKey={(l) => String(l.position)}
            columns={[
              {
                key: 'item',
                header: t('inventory.item'),
                cell: (l) => (
                  <span>
                    <span className="block font-medium">
                      {localizedName(l, i18n.language)}
                      {l.variantNameEn || l.variantNameAr
                        ? ` — ${localizedName({ nameEn: l.variantNameEn, nameAr: l.variantNameAr }, i18n.language)}`
                        : ''}
                    </span>
                    {l.priceOverridden ? (
                      <Badge tone="warning">{t('sales.overridden')}</Badge>
                    ) : null}
                  </span>
                ),
              },
              {
                key: 'qty',
                header: t('sales.qty'),
                cell: (l) => <span dir="ltr">{displayQty(l.quantity)}</span>,
              },
              {
                key: 'price',
                header: t('sales.unitPrice'),
                cell: (l) => (
                  <span>
                    <Amount value={l.unitPrice} />
                    {l.priceOverridden ? (
                      <span className="block text-xs text-fg-muted line-through">
                        <Amount value={l.listUnitPrice} />
                      </span>
                    ) : null}
                  </span>
                ),
              },
              {
                key: 'discount',
                header: t('sales.discount'),
                hideBelow: 'md',
                cell: (l) => <Amount value={l.lineDiscount} />,
              },
              {
                key: 'order',
                header: t('sales.orderDiscount'),
                hideBelow: 'lg',
                cell: (l) => <Amount value={l.orderDiscount} />,
              },
              { key: 'net', header: t('sales.net'), cell: (l) => <Amount value={l.net} /> },
            ]}
          />
          <Section title={t('sales.payments')}>
            <DataTable
              caption={t('sales.payments')}
              rows={s.payments}
              rowKey={(p) => p.id}
              columns={[
                {
                  key: 'method',
                  header: t('sales.method'),
                  cell: (p) => localizedName(p, i18n.language),
                },
                {
                  key: 'amount',
                  header: t('sales.amount'),
                  cell: (p) => <Amount value={p.amount} />,
                },
                {
                  key: 'tendered',
                  header: t('sales.tendered'),
                  hideBelow: 'md',
                  cell: (p) => <Amount value={p.tendered} />,
                },
                { key: 'fee', header: t('sales.fee'), cell: (p) => <Amount value={p.fee} /> },
                {
                  key: 'ref',
                  header: t('sales.reference'),
                  hideBelow: 'lg',
                  cell: (p) => p.reference ?? '—',
                },
                {
                  key: 'ver',
                  header: t('sales.verification'),
                  hideBelow: 'md',
                  cell: (p) => t(`sales.verification_${p.verification}`),
                },
              ]}
            />
            <p className="mt-3 text-sm">
              {t('sales.change')}: <Amount value={s.change} />
            </p>
          </Section>
        </div>
      ) : null}
    </div>
  );
}
