import type { AdjustmentKind } from '@arabat/contracts';
import { Badge, Button, DataTable, PageHeader, Section, Select } from '@arabat/ui';
import { useApi } from '@arabat/web-core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useBranchContext, useBranchName, useSession } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';
import { InventoryTabs, Pager, displayQty, inventoryKey, itemName } from './shared.js';

export function formatDateTime(iso: string, language: string) {
  return new Intl.DateTimeFormat(language.startsWith('ar') ? 'ar-KW-u-nu-latn' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

const KIND_TONE: Record<AdjustmentKind, 'primary' | 'success' | 'warning' | 'neutral'> = {
  opening: 'primary',
  increase: 'success',
  decrease: 'warning',
  count: 'neutral',
};

export function AdjustmentsPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const { can } = useSession();
  const { branchId } = useBranchContext();
  const branchName = useBranchName();
  const [kind, setKind] = useState<AdjustmentKind | ''>('');
  const [page, setPage] = useState(1);
  const query = {
    page,
    pageSize: 25,
    ...(branchId ? { branchId } : {}),
    ...(kind ? { kind } : {}),
  };
  const list = useQuery({
    queryKey: [...inventoryKey, 'adjustments', query],
    queryFn: () => api.inventory.adjustments(query),
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <PageHeader
        title={t('inventory.adjustmentsTitle')}
        actions={
          can('inventory.adjust') ? (
            <Button onClick={() => void navigate('/inventory/adjustments/new')}>
              {t('inventory.newAdjustment')}
            </Button>
          ) : null
        }
      />
      <InventoryTabs />
      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          className="max-w-48"
          aria-label={t('inventory.kind')}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as AdjustmentKind | '');
            setPage(1);
          }}
        >
          <option value="">{t('inventory.allTypes')}</option>
          {(['opening', 'increase', 'decrease', 'count'] as const).map((k) => (
            <option key={k} value={k}>
              {t(`inventory.kind_${k}`)}
            </option>
          ))}
        </Select>
      </div>
      <DataTable
        caption={t('inventory.adjustmentsTitle')}
        loading={list.isPending}
        rows={list.data?.adjustments}
        rowKey={(a) => a.id}
        empty={t('inventory.adjustmentsEmpty')}
        onRowClick={(a) => void navigate(`/inventory/adjustments/${a.id}`)}
        columns={[
          {
            key: 'date',
            header: t('inventory.date'),
            cell: (a) => formatDateTime(a.createdAt, i18n.language),
          },
          {
            key: 'kind',
            header: t('inventory.kind'),
            cell: (a) => <Badge tone={KIND_TONE[a.kind]}>{t(`inventory.kind_${a.kind}`)}</Badge>,
          },
          {
            key: 'reason',
            header: t('inventory.reason'),
            cell: (a) => t(`inventory.reason_${a.reason}`),
          },
          {
            key: 'branch',
            header: t('inventory.branch'),
            hideBelow: 'md',
            cell: (a) => branchName(a.branchId) ?? '—',
          },
          {
            key: 'lines',
            header: t('inventory.lines'),
            hideBelow: 'sm',
            cell: (a) => <span className="tabular-nums">{a.lineCount}</span>,
          },
          {
            key: 'by',
            header: t('inventory.createdBy'),
            hideBelow: 'lg',
            cell: (a) => a.createdBy.fullName,
          },
        ]}
      />
      <Pager
        page={page}
        total={list.data?.total ?? 0}
        pageSize={25}
        onPage={setPage}
        label={t('inventory.count', { count: list.data?.total ?? 0 })}
      />
    </div>
  );
}

export function AdjustmentDetailPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { adjustmentId } = useParams();
  const branchName = useBranchName();
  const adjustment = useQuery({
    queryKey: [...inventoryKey, 'adjustment', adjustmentId],
    queryFn: () => api.inventory.adjustment(adjustmentId!),
  });
  const a = adjustment.data;
  const withCost = a?.lines.some((l) => l.unitCost !== undefined) ?? false;
  return (
    <div>
      <PageHeader
        title={
          a
            ? `${t('inventory.adjustmentTitle')} — ${t(`inventory.kind_${a.kind}`)}`
            : t('inventory.adjustmentTitle')
        }
        actions={
          <Link className="text-sm text-primary" to="/inventory/adjustments">
            {t('common.back')}
          </Link>
        }
      />
      <InventoryTabs />
      {a ? (
        <div className="grid gap-6">
          <Section title={t('inventory.adjustmentTitle')}>
            <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-fg-muted">{t('inventory.date')}</dt>
                <dd>{formatDateTime(a.createdAt, i18n.language)}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">{t('inventory.branch')}</dt>
                <dd>{branchName(a.branchId) ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">{t('inventory.reason')}</dt>
                <dd data-testid="adjustment-reason">{t(`inventory.reason_${a.reason}`)}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">{t('inventory.createdBy')}</dt>
                <dd>{a.createdBy.fullName}</dd>
              </div>
              {a.note ? (
                <div className="sm:col-span-2 lg:col-span-4">
                  <dt className="text-fg-muted">{t('inventory.note')}</dt>
                  <dd className="whitespace-pre-wrap">{a.note}</dd>
                </div>
              ) : null}
            </dl>
          </Section>
          <DataTable
            caption={t('inventory.lines')}
            rows={a.lines}
            rowKey={(l) => l.variantId}
            columns={[
              {
                key: 'item',
                header: t('inventory.item'),
                cell: (l) => (
                  <span>
                    <span className="block font-medium">{itemName(l, i18n.language)}</span>
                    {l.sku ? (
                      <span className="block text-xs text-fg-muted" dir="ltr">
                        {l.sku}
                      </span>
                    ) : null}
                  </span>
                ),
              },
              {
                key: 'before',
                header: t('inventory.before'),
                hideBelow: 'sm',
                cell: (l) => <Qty value={l.previousOnHand} />,
              },
              {
                key: 'delta',
                header: t('inventory.delta'),
                cell: (l) => <Qty value={l.delta} signed />,
              },
              {
                key: 'after',
                header: t('inventory.after'),
                cell: (l) => <Qty value={l.newOnHand} />,
              },
              ...(withCost
                ? [
                    {
                      key: 'cost',
                      header: t('inventory.unitCost'),
                      hideBelow: 'md' as const,
                      cell: (l: (typeof a.lines)[number]) => (
                        <span className="tabular-nums" dir="ltr">
                          {formatAmount(l.unitCost, i18n.language)}
                        </span>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}

export function Qty({ value, signed = false }: { value: string; signed?: boolean }) {
  const negative = value.startsWith('-');
  const text = displayQty(value);
  return (
    <span
      dir="ltr"
      className={
        signed
          ? negative
            ? 'tabular-nums text-danger'
            : 'tabular-nums text-success'
          : 'tabular-nums'
      }
    >
      {signed && !negative && text !== '0' ? `+${text}` : text}
    </span>
  );
}
