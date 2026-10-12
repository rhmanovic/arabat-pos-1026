import { ApiError } from '@arabat/api-client';
import type { OnlineOrderStatus } from '@arabat/contracts';
import { formatDateTime } from '@arabat/i18n';
import { Alert, Badge, Button, Spinner } from '@arabat/ui';
import { ErrorState, useApi } from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useLocalName, useMoney, useSlug } from '../shared.js';

const TONE: Record<OnlineOrderStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  pending_payment: 'warning',
  paid: 'success',
  preparing: 'success',
  ready: 'success',
  out_for_delivery: 'success',
  completed: 'success',
  expired: 'danger',
  payment_failed: 'danger',
  cancelled: 'danger',
  needs_attention: 'warning',
};

/** Public order tracking by its unguessable token (no account needed). */
export function OrderPage() {
  const api = useApi();
  const slug = useSlug();
  const { token = '' } = useParams();
  const name = useLocalName();
  const money = useMoney();
  const { t, i18n } = useTranslation();
  const order = useQuery({
    queryKey: ['store', slug, 'order', token],
    queryFn: () => api.store.order(slug, token),
    // While a payment may still be confirmed, check again regularly.
    refetchInterval: (q) => (q.state.data?.status === 'pending_payment' ? 5_000 : 30_000),
  });
  if (order.isPending) return <Spinner label={t('common:status.loading')} />;
  if (order.isError)
    return order.error instanceof ApiError && order.error.status === 404 ? (
      <Alert tone="warning">{t('order.notFound')}</Alert>
    ) : (
      <ErrorState error={order.error} onRetry={() => void order.refetch()} />
    );
  const o = order.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{t('order.title', { number: o.number })}</h1>
        <Badge tone={TONE[o.status]} data-testid="order-status">
          {t(`status.${o.status}`)}
        </Badge>
        <Button variant="ghost" size="sm" onClick={() => void order.refetch()}>
          {t('order.refresh')}
        </Button>
      </div>
      {o.status === 'pending_payment' && o.paymentUrl ? (
        <Alert tone="warning">
          <p>{t('order.payBy', { time: formatDateTime(o.reservedUntil, i18n.language) })}</p>
          <Button className="mt-2" onClick={() => window.location.assign(o.paymentUrl!)}>
            {t('order.payNow')}
          </Button>
        </Alert>
      ) : null}
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-2 font-semibold">{t('order.items')}</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {o.lines.map((l) => (
            <li key={l.position} className="flex justify-between gap-2">
              <span>
                {l.quantity.replace(/\.000$/, '')} ×{' '}
                {[name(l), name({ nameEn: l.variantNameEn, nameAr: l.variantNameAr })]
                  .filter(Boolean)
                  .join(' — ')}
              </span>
              <span className="tabular-nums">{money(l.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-2 flex flex-col gap-1 border-t border-border pt-2 text-sm">
          <div className="flex justify-between">
            <dt>{t('cart.subtotal')}</dt>
            <dd className="tabular-nums">{money(o.subtotal)}</dd>
          </div>
          {o.fulfillment === 'delivery' ? (
            <div className="flex justify-between">
              <dt>{t('checkout.deliveryFee')}</dt>
              <dd className="tabular-nums">{money(o.deliveryFee)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between font-semibold">
            <dt>{t('checkout.total')}</dt>
            <dd className="tabular-nums">{money(o.total)}</dd>
          </div>
        </dl>
        <p className="mt-2 text-sm text-fg-muted">
          {t(`order.${o.fulfillment}`)} · {o.customerName}
        </p>
      </section>
      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-2 font-semibold">{t('order.timeline')}</h2>
        <ol className="flex flex-col gap-1 text-sm">
          {o.timeline.map((e, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span>{t(`status.${e.status}`)}</span>
              <span className="text-fg-muted">{formatDateTime(e.at, i18n.language)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
