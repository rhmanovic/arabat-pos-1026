import type { StockLevel, StockLevelQuery } from '@arabat/contracts';
import {
  Alert,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  Select,
  StatCard,
} from '@arabat/ui';
import { useApi, useNotify } from '@arabat/web-core';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useBranchContext, useBranchName, useSession } from '../../app/context.js';
import { formatAmount } from '../catalog/ProductsPage.js';
import {
  InventoryTabs,
  Pager,
  StockStatusBadge,
  displayQty,
  inventoryKey,
  itemName,
} from './shared.js';

type Stock = 'all' | 'low' | 'out' | 'in_stock';

export function InventoryPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const { can } = useSession();
  const { branchId } = useBranchContext();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [stock, setStock] = useState<Stock>('all');
  const [sort, setSort] = useState<'name:asc' | 'on_hand:asc' | 'on_hand:desc' | 'updated:desc'>(
    'name:asc',
  );
  // Any filter change returns to the first page.
  const filterKey = JSON.stringify([q, stock, sort, branchId]);
  const [paging, setPaging] = useState({ key: filterKey, page: 1 });
  const page = paging.key === filterKey ? paging.page : 1;
  const setPage = (next: number) => setPaging({ key: filterKey, page: next });
  const [threshold, setThreshold] = useState<StockLevel | null>(null);
  const [detail, setDetail] = useState<StockLevel | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const [sortKey, direction] = sort.split(':') as [StockLevelQuery['sort'], 'asc' | 'desc'];
  const query: StockLevelQuery = {
    stock,
    sort: sortKey,
    direction,
    page,
    pageSize: 25,
    ...(q ? { q } : {}),
    ...(branchId ? { branchId } : {}),
  };
  const levels = useQuery({
    queryKey: [...inventoryKey, 'levels', query],
    queryFn: () => api.inventory.levels(query),
    placeholderData: keepPreviousData,
  });
  const summary = useQuery({
    queryKey: [...inventoryKey, 'summary', branchId],
    queryFn: () => api.inventory.summary(branchId),
  });
  const costVisible = levels.data?.costVisible ?? false;
  const canAdjust = can('inventory.adjust');

  return (
    <div>
      <PageHeader
        title={t('inventory.title')}
        description={t('inventory.subtitle')}
        actions={
          <div className="flex flex-wrap gap-2">
            {can('merchant.settings.update') ? (
              <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
                {t('inventory.settings')}
              </Button>
            ) : null}
            {canAdjust ? (
              <Button onClick={() => void navigate('/inventory/adjustments/new')}>
                {t('inventory.newAdjustment')}
              </Button>
            ) : null}
          </div>
        }
      />
      <InventoryTabs />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('inventory.tracked')} value={summary.data?.trackedVariants ?? '—'} />
        <StatCard label={t('inventory.low')} value={summary.data?.lowStock ?? '—'} />
        <StatCard label={t('inventory.out')} value={summary.data?.outOfStock ?? '—'} />
        {summary.data?.totalValue ? (
          <StatCard
            label={t('inventory.value')}
            value={<span dir="ltr">{formatAmount(summary.data.totalValue, i18n.language)}</span>}
            hint={
              summary.data.unvaluedVariants > 0
                ? t('inventory.unvalued', { count: summary.data.unvaluedVariants })
                : t('inventory.costingMethod')
            }
          />
        ) : null}
      </div>

      {!branchId ? (
        <Alert className="mb-4" tone="info">
          {t('inventory.allBranchesNote')}
        </Alert>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-3">
        <Input
          className="max-w-xs"
          type="search"
          aria-label={t('common.search')}
          placeholder={t('catalog.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          className="max-w-44"
          aria-label={t('inventory.stockFilter')}
          value={stock}
          onChange={(e) => setStock(e.target.value as Stock)}
        >
          <option value="all">{t('inventory.stockAll')}</option>
          <option value="low">{t('inventory.stockLow')}</option>
          <option value="out">{t('inventory.stockOut')}</option>
          <option value="in_stock">{t('inventory.stockIn')}</option>
        </Select>
        <Select
          className="max-w-48"
          aria-label={t('catalog.sort')}
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
        >
          <option value="name:asc">{t('catalog.sortName')}</option>
          <option value="on_hand:asc">{t('inventory.sortOnHand')} ↑</option>
          <option value="on_hand:desc">{t('inventory.sortOnHand')} ↓</option>
          <option value="updated:desc">{t('inventory.sortUpdated')}</option>
        </Select>
      </div>

      <DataTable
        caption={t('inventory.title')}
        loading={levels.isPending}
        rows={levels.data?.levels}
        rowKey={(l) => l.variantId}
        empty={t('inventory.empty')}
        onRowClick={setDetail}
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
            key: 'onHand',
            header: t('inventory.onHand'),
            cell: (l) => (
              <span className="font-semibold tabular-nums" dir="ltr" data-testid="on-hand">
                {displayQty(l.onHand)}
              </span>
            ),
          },
          ...(branchId
            ? [
                {
                  key: 'threshold',
                  header: t('inventory.threshold'),
                  hideBelow: 'md' as const,
                  cell: (l: StockLevel) => (
                    <span className="tabular-nums" dir="ltr">
                      {displayQty(l.lowStockThreshold)}
                    </span>
                  ),
                },
              ]
            : []),
          {
            key: 'status',
            header: t('common.status'),
            cell: (l) => <StockStatusBadge status={l.status} />,
          },
          ...(costVisible
            ? [
                {
                  key: 'avg',
                  header: t('inventory.avgCost'),
                  hideBelow: 'lg' as const,
                  cell: (l: StockLevel) => (
                    <span className="tabular-nums" dir="ltr">
                      {branchId ? formatAmount(l.avgCost, i18n.language) : '—'}
                    </span>
                  ),
                },
                {
                  key: 'value',
                  header: t('inventory.value'),
                  hideBelow: 'md' as const,
                  cell: (l: StockLevel) => (
                    <span className="tabular-nums" dir="ltr">
                      {formatAmount(l.value, i18n.language)}
                    </span>
                  ),
                },
              ]
            : []),
          {
            key: 'actions',
            header: <span className="sr-only">{t('common.actions')}</span>,
            cell: (l) => (
              <span
                className="flex flex-wrap justify-end gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                {canAdjust ? (
                  <Link
                    className="rounded-md px-2 py-1 text-sm text-primary hover:bg-primary-soft"
                    to={`/inventory/adjustments/new?variantId=${l.variantId}`}
                  >
                    {t('inventory.adjust')}
                  </Link>
                ) : null}
                <Link
                  className="rounded-md px-2 py-1 text-sm text-primary hover:bg-primary-soft"
                  to={`/inventory/movements?variantId=${l.variantId}`}
                >
                  {t('inventory.history')}
                </Link>
                {canAdjust && branchId ? (
                  <button
                    type="button"
                    className="rounded-md px-2 py-1 text-sm text-primary hover:bg-primary-soft"
                    onClick={() => setThreshold(l)}
                  >
                    {t('inventory.setThreshold')}
                  </button>
                ) : null}
              </span>
            ),
          },
        ]}
      />
      <Pager
        page={page}
        total={levels.data?.total ?? 0}
        pageSize={25}
        onPage={setPage}
        label={t('inventory.count', { count: levels.data?.total ?? 0 })}
      />

      {threshold && branchId ? (
        <ThresholdDialog level={threshold} branchId={branchId} onClose={() => setThreshold(null)} />
      ) : null}
      {detail ? <VariantDialog level={detail} onClose={() => setDetail(null)} /> : null}
      {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}

function ThresholdDialog({
  level,
  branchId,
  onClose,
}: {
  level: StockLevel;
  branchId: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(displayQty(level.lowStockThreshold).replace('—', ''));
  const valid = value.trim() === '' || /^\d{1,11}(\.\d{1,3})?$/.test(value.trim());
  const save = useMutation({
    mutationFn: () =>
      api.inventory.setThreshold({
        branchId,
        variantId: level.variantId,
        threshold: value.trim() === '' ? null : value.trim(),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: inventoryKey });
      notify.ok(t('inventory.thresholdSaved'));
      onClose();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(open) => !open && onClose()}
      title={t('inventory.thresholdTitle')}
      description={itemName(level, i18n.language)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field
        label={t('inventory.threshold')}
        hint={t('inventory.thresholdHint')}
        error={valid ? undefined : t('common:errors.INVALID_QUANTITY')}
      >
        {(p) => (
          <Input
            {...p}
            inputMode="decimal"
            dir="ltr"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}

function VariantDialog({ level, onClose }: { level: StockLevel; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const branchName = useBranchName();
  const stock = useQuery({
    queryKey: [...inventoryKey, 'variant', level.variantId],
    queryFn: () => api.inventory.variant(level.variantId),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={itemName(level, i18n.language)}
      description={t('inventory.byBranch')}
    >
      <DataTable
        caption={t('inventory.byBranch')}
        loading={stock.isPending}
        rows={stock.data?.branches}
        rowKey={(b) => b.branchId}
        columns={[
          {
            key: 'branch',
            header: t('inventory.branch'),
            cell: (b) => branchName(b.branchId) ?? (b.nameAr || b.nameEn),
          },
          {
            key: 'onHand',
            header: t('inventory.onHand'),
            cell: (b) => (
              <span className="tabular-nums" dir="ltr">
                {displayQty(b.onHand)}
              </span>
            ),
          },
          {
            key: 'status',
            header: t('common.status'),
            cell: (b) => <StockStatusBadge status={b.status} />,
          },
          ...(stock.data?.branches.some((b) => b.value !== undefined)
            ? [
                {
                  key: 'value',
                  header: t('inventory.value'),
                  cell: (b: { value?: { amount: string; currency: string } | null }) => (
                    <span className="tabular-nums" dir="ltr">
                      {formatAmount(b.value, i18n.language)}
                    </span>
                  ),
                },
              ]
            : []),
        ]}
      />
      {stock.data ? (
        <p className="mt-3 text-sm font-medium">
          {t('inventory.total')}:{' '}
          <span className="tabular-nums" dir="ltr">
            {displayQty(stock.data.total)}
          </span>
        </p>
      ) : null}
    </Dialog>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: [...inventoryKey, 'settings'],
    queryFn: () => api.inventory.settings(),
  });
  const [allow, setAllow] = useState<boolean | null>(null);
  const value = allow ?? settings.data?.allowNegativeStock ?? false;
  const save = useMutation({
    mutationFn: () =>
      api.inventory.updateSettings({ allowNegativeStock: value, version: settings.data!.version }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: inventoryKey });
      notify.ok(t('common.saved'));
      onClose();
    },
    onError: notify.fail,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('inventory.settings')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!settings.data} loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Checkbox
          label={t('inventory.allowNegative')}
          description={t('inventory.allowNegativeHint')}
          checked={value}
          disabled={!settings.data}
          onChange={(e) => setAllow(e.target.checked)}
        />
        <p className="text-sm text-fg-muted">{t('inventory.costingMethod')}</p>
      </div>
    </Dialog>
  );
}
