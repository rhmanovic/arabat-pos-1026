import type { PosOnlineOrder } from '@arabat/contracts';
import { Money } from '@arabat/money';
import { Badge, Button, Dialog, Spinner } from '@arabat/ui';
import { localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shiftKey } from '../pages/ShiftPages.js';
import { PaymentDialog } from './dialogs.js';
import { availabilityKey, useMoneyFormat } from './SalePage.js';

export const onlineOrdersKey = ['pos', 'online-orders'] as const;

/**
 * Pickup orders of the branch waiting at the till (ADR-0123): an unpaid one is paid with the
 * till's tenders and handed over in one step; a paid one is handed over.
 */
export function OnlineOrdersDialog({
  onClose,
  onCompleted,
}: {
  onClose: () => void;
  /** A sale was created at the till: show its receipt. */
  onCompleted: (saleId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const fmt = useMoneyFormat();
  const [paying, setPaying] = useState<PosOnlineOrder | null>(null);
  const orders = useQuery({ queryKey: onlineOrdersKey, queryFn: () => api.posOnline.orders() });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: onlineOrdersKey }),
      queryClient.invalidateQueries({ queryKey: availabilityKey }),
      queryClient.invalidateQueries({ queryKey: shiftKey }),
    ]);
  const complete = useMutation({
    mutationFn: (o: PosOnlineOrder) => api.posOnline.complete(o.id, o.version),
    onSuccess: async () => {
      notify.ok(t('sale.onlineHandedOver'));
      await refresh();
    },
    onError: async (error) => {
      await refresh();
      notify.fail(error);
    },
  });
  const time = (value: string) =>
    new Date(value).toLocaleString(i18n.language, {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      numberingSystem: 'latn',
    });

  if (paying) {
    const total = Money.parse(paying.total.amount, 'KWD');
    return (
      <PaymentDialog
        totalMinor={total.minor}
        onClose={() => setPaying(null)}
        submit={async ({ idempotencyKey, payments }) => {
          const sale = await api.posOnline.pay(paying.id, {
            idempotencyKey,
            payments,
            expectedTotal: total.toDecimalString(),
            version: paying.version,
          });
          await refresh();
          return sale;
        }}
        onCompleted={onCompleted}
      />
    );
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={t('sale.onlineOrders')}>
      {orders.isPending ? <Spinner /> : null}
      {orders.data?.orders.length === 0 ? (
        <p className="text-fg-muted">{t('sale.noOnlineOrders')}</p>
      ) : null}
      <ul className="divide-y divide-border">
        {orders.data?.orders.map((o) => (
          <li key={o.id} className="flex flex-col gap-2 py-3" data-testid="online-order">
            <div className="flex items-start justify-between gap-3">
              <span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold" dir="ltr">
                    {o.number}
                  </span>
                  <Badge tone={o.paid ? 'success' : 'warning'}>
                    {o.paid ? t('sale.onlinePaid') : t('sale.onlineUnpaid')}
                  </Badge>
                  <Badge>{t(`sale.onlineStatus_${o.status}`)}</Badge>
                </span>
                <span className="block text-sm text-fg-muted">
                  {o.customerName} · <bdi dir="ltr">{o.customerPhone}</bdi> ·{' '}
                  {o.scheduledFor
                    ? t('sale.onlineScheduled', { time: time(o.scheduledFor) })
                    : t('sale.onlineAsap')}
                </span>
              </span>
              <span className="text-lg font-semibold tabular-nums">{fmt(o.total)}</span>
            </div>
            <ul className="text-sm">
              {o.lines.map((l) => (
                <li key={l.position} className="flex justify-between gap-2">
                  <span>
                    <bdi dir="ltr">{l.quantity.replace(/\.?0+$/, '')}</bdi> ×{' '}
                    {[
                      localizedName(l, i18n.language),
                      localizedName(
                        { nameEn: l.variantNameEn, nameAr: l.variantNameAr },
                        i18n.language,
                      ),
                    ]
                      .filter(Boolean)
                      .join(' — ')}
                  </span>
                  <span className="tabular-nums">{fmt(l.lineTotal)}</span>
                </li>
              ))}
            </ul>
            {o.note ? <p className="text-sm text-fg-muted">{o.note}</p> : null}
            <div className="flex justify-end gap-2">
              {o.paid ? (
                <Button
                  size="sm"
                  loading={complete.isPending && complete.variables?.id === o.id}
                  onClick={() => complete.mutate(o)}
                >
                  {t('sale.onlineHandOver')}
                </Button>
              ) : (
                <Button size="sm" onClick={() => setPaying(o)}>
                  {t('sale.onlineTakePayment')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
