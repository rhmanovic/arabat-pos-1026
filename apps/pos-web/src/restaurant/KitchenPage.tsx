import type { KitchenTicket } from '@arabat/contracts';
import { Alert, Badge, Button, Select, Spinner } from '@arabat/ui';
import { localizedName, useApi, useNotify } from '@arabat/web-core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const NEXT = { new: 'preparing', preparing: 'ready', ready: 'completed' } as const;
const COLUMNS = ['new', 'preparing', 'ready'] as const;

function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * Kitchen display (Prompt 15): incoming tickets per station, start → ready → done. Status
 * taps only move tickets forward and never create sales or payments.
 */
export function KitchenPage() {
  const { t, i18n } = useTranslation();
  const api = useApi();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const now = useNow();
  const [stationId, setStationId] = useState('');
  const key = ['pos', 'kitchen', stationId] as const;
  const board = useQuery({
    queryKey: key,
    queryFn: () => api.restaurant.kitchen(stationId || undefined),
    refetchInterval: 5_000,
  });
  const advance = useMutation({
    mutationFn: (ticket: KitchenTicket) =>
      api.restaurant.ticketStatus(ticket.id, {
        status: NEXT[ticket.status as keyof typeof NEXT],
        version: ticket.version,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pos', 'kitchen'] }),
    onError: async (e) => {
      notify.fail(e);
      await queryClient.invalidateQueries({ queryKey: ['pos', 'kitchen'] });
    },
  });
  if (board.error)
    return (
      <div className="p-6">
        <Alert tone="warning">{t('restaurant.unavailable')}</Alert>
      </div>
    );
  if (!board.data)
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  const minutes = (iso: string) => Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface px-4 py-2">
        <h1 className="text-lg font-semibold">{t('kitchen.title')}</h1>
        <Select
          className="w-48"
          aria-label={t('kitchen.station')}
          value={stationId}
          onChange={(e) => setStationId(e.target.value)}
        >
          <option value="">{t('kitchen.allStations')}</option>
          {board.data.stations.map((s) => (
            <option key={s.id} value={s.id}>
              {localizedName(s, i18n.language)}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-3">
        {COLUMNS.map((column) => {
          const tickets = board.data.tickets.filter((x) => x.status === column);
          return (
            <section
              key={column}
              aria-label={t(`kitchen.column_${column}`)}
              className="flex min-h-0 flex-col rounded-lg bg-surface p-3"
            >
              <h2 className="mb-2 font-semibold">
                {t(`kitchen.column_${column}`)} <Badge tone="neutral">{tickets.length}</Badge>
              </h2>
              <ul className="grid min-h-0 gap-2 overflow-y-auto">
                {tickets.map((ticket) => {
                  const age = minutes(ticket.createdAt);
                  return (
                    <li
                      key={ticket.id}
                      className="rounded-lg border-2 border-border p-3"
                      data-testid="kitchen-ticket"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="font-semibold">
                          <span dir="ltr">{ticket.orderNumber}</span> ·{' '}
                          {ticket.tableCode
                            ? `${t('restaurant.table')} ${ticket.tableCode}`
                            : t(`restaurant.type_${ticket.orderType}`)}
                          {ticket.label ? ` · ${ticket.label}` : ''}
                        </span>
                        <Badge tone={age >= 15 ? 'danger' : age >= 8 ? 'warning' : 'neutral'}>
                          {t('kitchen.minutes', { count: age })}
                        </Badge>
                      </div>
                      <ul className="mb-3 grid gap-1">
                        {ticket.items
                          .filter((i) => i.kitchenStatus !== 'cancelled')
                          .map((i) => (
                            <li key={i.id}>
                              <span className="text-lg font-semibold" dir="ltr">
                                {i.quantity.replace(/\.?0+$/, '')}×
                              </span>{' '}
                              <span className="text-lg">{localizedName(i, i18n.language)}</span>
                              {i.variantNameEn || i.variantNameAr
                                ? ` — ${localizedName({ nameEn: i.variantNameEn, nameAr: i.variantNameAr }, i18n.language)}`
                                : ''}
                              {i.modifiers.length ? (
                                <span className="block ps-6 text-sm">
                                  {i.modifiers
                                    .map((m) => localizedName(m, i18n.language))
                                    .join(', ')}
                                </span>
                              ) : null}
                              {i.note ? (
                                <span className="block ps-6 text-sm font-medium text-danger">
                                  “{i.note}”
                                </span>
                              ) : null}
                            </li>
                          ))}
                      </ul>
                      <Button
                        block
                        size="lg"
                        variant={column === 'ready' ? 'secondary' : 'primary'}
                        loading={advance.isPending && advance.variables?.id === ticket.id}
                        onClick={() => advance.mutate(ticket)}
                      >
                        {t(`kitchen.action_${column}`)}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
