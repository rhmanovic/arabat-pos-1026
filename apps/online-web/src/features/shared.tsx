import type { OnlineOrder, OnlineOrderAction, OnlineOrderStatus } from '@arabat/contracts';
import { formatMoney } from '@arabat/i18n';
import { Money } from '@arabat/money';
import { useApi } from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

/** Query key prefix of everything the console loads. */
export const key = ['online'] as const;
export type Action = OnlineOrderAction;

export function formatAmount(
  value: { amount: string; currency: string } | null | undefined,
  language: string,
) {
  return value
    ? formatMoney(Money.fromJSON(value as { amount: string; currency: 'KWD' }), language)
    : '—';
}

export function formatDateTime(iso: string, language: string) {
  return new Intl.DateTimeFormat(language.startsWith('ar') ? 'ar-KW-u-nu-latn' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
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

export const ORDER_TONE: Record<
  OnlineOrderStatus,
  'primary' | 'success' | 'warning' | 'danger' | 'neutral'
> = {
  pending_payment: 'neutral',
  placed: 'warning',
  confirmed: 'primary',
  paid: 'primary',
  preparing: 'primary',
  ready: 'success',
  out_for_delivery: 'success',
  completed: 'success',
  expired: 'neutral',
  payment_failed: 'danger',
  cancelled: 'neutral',
  needs_attention: 'warning',
};

/**
 * Actions offered for an order; the API re-checks every transition (BR-146). A pay-on-receipt
 * order (ADR-0118) can have its payment recorded until it is completed, completes only once
 * paid, and can be cancelled in place while unpaid.
 */
export function nextActions(
  order: Pick<OnlineOrder, 'status' | 'fulfillment'> &
    Partial<Pick<OnlineOrder, 'paymentMode' | 'saleId'>>,
): Action[] {
  const forward: Record<string, Action[]> = {
    placed: ['confirm'],
    confirmed: ['preparing', 'ready', 'out_for_delivery', 'completed'],
    paid: ['preparing', 'ready', 'out_for_delivery', 'completed'],
    preparing: ['ready', 'out_for_delivery', 'completed'],
    ready: ['completed'],
    out_for_delivery: ['completed'],
    pending_payment: ['cancel'],
    needs_attention: ['cancel'],
  };
  const unpaidOnReceipt = order.paymentMode === 'on_receipt' && !order.saleId;
  const steps = (forward[order.status] ?? []).filter(
    (a) =>
      !(a === 'ready' && order.fulfillment !== 'pickup') &&
      !(a === 'out_for_delivery' && order.fulfillment !== 'delivery') &&
      !(a === 'completed' && unpaidOnReceipt),
  );
  if (unpaidOnReceipt && order.status !== 'needs_attention') steps.push('mark_paid', 'cancel');
  return steps;
}

export const PAYABLE_KINDS = ['cash', 'card', 'bank_transfer', 'custom'];

/**
 * The latest orders with the counts per status, shared by the overview and the navigation
 * badges (one request, refreshed every 30 seconds).
 */
export function useOrderOverview(enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...key, 'orders', { page: 1, pageSize: 5 }],
    queryFn: () => api.online.orders({ page: 1, pageSize: 5 }),
    enabled,
    refetchInterval: 30_000,
  });
}

/**
 * Actions that float over the window (above the phone tab bar), so Save never needs a scroll
 * to the end of a long form. Rendered in the body: page entrance animations would otherwise
 * pin it inside the page.
 */
export function FloatingBar({ label, children }: { label: string; children: ReactNode }) {
  return createPortal(
    <div
      role="toolbar"
      aria-label={label}
      data-testid="floating-bar"
      className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-center gap-2 rounded-2xl border border-border bg-surface/90 p-2 shadow-xl backdrop-blur-md lg:bottom-6"
    >
      {children}
    </div>,
    document.body,
  );
}
