import { MOVEMENT_TYPES, type MovementQuery, type MovementType } from '@arabat/contracts';
import { Button, DataTable, Input, PageHeader, Select } from '@arabat/ui';
import { useApi } from '@arabat/web-core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useBranchContext, useBranchName } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';
import { Qty, formatDateTime } from './AdjustmentsPage.js';
import { InventoryTabs, Pager, inventoryKey, itemName } from './shared.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function MovementsPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const { branchId } = useBranchContext();
  const branchName = useBranchName();
  const [params, setParams] = useSearchParams();
  const variantId = params.get('variantId');
  const [type, setType] = useState<MovementType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const query: MovementQuery = {
    page,
    pageSize: 50,
    ...(branchId ? { branchId } : {}),
    ...(variantId ? { variantId } : {}),
    ...(type ? { type } : {}),
    ...(DATE.test(from) ? { from } : {}),
    ...(DATE.test(to) ? { to } : {}),
  };
  const list = useQuery({
    queryKey: [...inventoryKey, 'movements', query],
    queryFn: () => api.inventory.movements(query),
    placeholderData: keepPreviousData,
  });
  const withCost = list.data?.movements.some((m) => m.unitCost !== undefined) ?? false;
  const reset = () => setPage(1);

  return (
    <div>
      <PageHeader title={t('inventory.movementsTitle')} />
      <InventoryTabs />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select
          className="max-w-48"
          aria-label={t('inventory.type')}
          value={type}
          onChange={(e) => {
            setType(e.target.value as MovementType | '');
            reset();
          }}
        >
          <option value="">{t('inventory.allTypes')}</option>
          {MOVEMENT_TYPES.map((m) => (
            <option key={m} value={m}>
              {t(`inventory.type_${m}`)}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          {t('inventory.from')}
          <Input
            type="date"
            className="w-40"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              reset();
            }}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          {t('inventory.to')}
          <Input
            type="date"
            className="w-40"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              reset();
            }}
          />
        </label>
        {variantId ? (
          <span className="flex items-center gap-2 text-sm text-fg-muted">
            {t('inventory.filteredItem')}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                params.delete('variantId');
                setParams(params);
                reset();
              }}
            >
              {t('inventory.clearFilter')}
            </Button>
          </span>
        ) : null}
      </div>
      <DataTable
        caption={t('inventory.movementsTitle')}
        loading={list.isPending}
        rows={list.data?.movements}
        rowKey={(m) => m.id}
        empty={t('inventory.movementsEmpty')}
        columns={[
          {
            key: 'date',
            header: t('inventory.date'),
            cell: (m) => (
              <span className="whitespace-nowrap">
                {formatDateTime(m.createdAt, i18n.language)}
              </span>
            ),
          },
          {
            key: 'item',
            header: t('inventory.item'),
            cell: (m) => (
              <span>
                <span className="block font-medium">{itemName(m, i18n.language)}</span>
                {m.sku ? (
                  <span className="block text-xs text-fg-muted" dir="ltr">
                    {m.sku}
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            key: 'type',
            header: t('inventory.type'),
            cell: (m) => (
              <span>
                <span className="block">{t(`inventory.type_${m.movementType}`)}</span>
                {m.reason ? (
                  <span className="block text-xs text-fg-muted">
                    {t(`inventory.reason_${m.reason}`, m.reason)}
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            key: 'qty',
            header: t('inventory.delta'),
            cell: (m) => <Qty value={m.quantity} signed />,
          },
          {
            key: 'balance',
            header: t('inventory.balance'),
            cell: (m) => <Qty value={m.balanceAfter} />,
          },
          ...(withCost
            ? [
                {
                  key: 'value',
                  header: t('inventory.value'),
                  hideBelow: 'lg' as const,
                  cell: (m: { value?: { amount: string; currency: string } | null }) => (
                    <span className="tabular-nums" dir="ltr">
                      {formatAmount(m.value, i18n.language)}
                    </span>
                  ),
                },
              ]
            : []),
          {
            key: 'branch',
            header: t('inventory.branch'),
            hideBelow: 'md',
            cell: (m) => branchName(m.branchId) ?? '—',
          },
          {
            key: 'by',
            header: t('inventory.createdBy'),
            hideBelow: 'lg',
            cell: (m) => m.createdBy?.fullName ?? '—',
          },
          {
            key: 'source',
            header: t('inventory.source'),
            hideBelow: 'md',
            cell: (m) =>
              m.sourceType === 'stock_adjustment' ? (
                <Link className="text-sm text-primary" to={`/inventory/adjustments/${m.sourceId}`}>
                  {t('inventory.viewAdjustment')}
                </Link>
              ) : (
                '—'
              ),
          },
        ]}
      />
      <Pager
        page={page}
        total={list.data?.total ?? 0}
        pageSize={50}
        onPage={setPage}
        label={t('inventory.count', { count: list.data?.total ?? 0 })}
      />
    </div>
  );
}
