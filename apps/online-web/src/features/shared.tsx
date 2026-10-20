import type { OnlineOrder, OnlineOrderAction, OnlineOrderStatus } from '@arabat/contracts';
import { formatMoney } from '@arabat/i18n';
import { Money } from '@arabat/money';
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
