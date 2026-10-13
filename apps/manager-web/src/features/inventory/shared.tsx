import type { StockStatus } from '@arabat/contracts';
import { Badge, cn } from '@arabat/ui';
import { localizedName } from '@arabat/web-core';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';

export const inventoryKey = ['manager', 'inventory'] as const;

/** "12.500" → "12.5", "3.000" → "3" (display only; values stay exact strings). */
export function displayQty(value: string | null | undefined): string {
  if (value == null) return '—';
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

export function itemName(
  row: {
    nameEn: string | null;
    nameAr: string | null;
    variantNameEn: string | null;
    variantNameAr: string | null;
  },
  language: string,
): string {
  const product = localizedName(row, language);
  const variant =
    row.variantNameEn || row.variantNameAr
      ? localizedName({ nameEn: row.variantNameEn, nameAr: row.variantNameAr }, language)
      : null;
  return variant ? `${product} — ${variant}` : product;
}

const TONES: Record<StockStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  in_stock: 'success',
  low: 'warning',
  out: 'neutral',
  negative: 'danger',
};

export function StockStatusBadge({ status }: { status: StockStatus }) {
  const { t } = useTranslation();
  return <Badge tone={TONES[status]}>{t(`inventory.status_${status}`)}</Badge>;
}

/** Secondary navigation between the inventory screens. */
export function InventoryTabs() {
  const { t } = useTranslation();
  const tabs = [
    { to: '/inventory', label: t('inventory.tabStock'), end: true },
    { to: '/inventory/adjustments', label: t('inventory.tabAdjustments'), end: false },
    { to: '/inventory/movements', label: t('inventory.tabMovements'), end: false },
    { to: '/inventory/returns', label: t('inventory.tabReturns'), end: false },
  ];
  return (
    <nav aria-label={t('inventory.title')} className="mb-6 flex gap-1 border-b border-border">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
              isActive
                ? 'border-primary text-primary'
                : 'border-transparent text-fg-muted hover:text-fg',
            )
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function Pager({
  page,
  total,
  pageSize,
  onPage,
  label,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  label: string;
}) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-fg-muted">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1 disabled:opacity-50"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          {t('catalog.previous')}
        </button>
        <span>{t('catalog.pageOf', { page, pages })}</span>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-1 disabled:opacity-50"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          {t('catalog.next')}
        </button>
      </span>
    </div>
  );
}
