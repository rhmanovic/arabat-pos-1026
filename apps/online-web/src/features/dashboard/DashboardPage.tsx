import { Badge, Button, Card, CardContent, PageHeader } from '@arabat/ui';
import { useApi } from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { managerUrl, useSession } from '../../app/context.js';
import { key } from '../shared.js';

/** Overview: the store's state and the orders that need someone, with the shared functions. */
export function DashboardPage() {
  const { t } = useTranslation();
  const api = useApi();
  const { can } = useSession();
  const store = useQuery({
    queryKey: [...key, 'store'],
    queryFn: () => api.online.store(),
    enabled: can('online.manage'),
  });
  const orders = useQuery({
    queryKey: [...key, 'orders', { page: 1, pageSize: 1 }],
    queryFn: () => api.online.orders({ page: 1, pageSize: 1 }),
    enabled: can('online.orders'),
    refetchInterval: 30_000,
  });
  const counts = orders.data?.counts ?? {};
  const n = (...statuses: string[]) => statuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
  const tiles = [
    { key: 'newOrders', value: n('placed'), tone: 'warning' as const, status: 'placed' },
    {
      key: 'awaitingPayment',
      value: n('pending_payment'),
      tone: 'neutral' as const,
      status: 'pending_payment',
    },
    { key: 'toPrepare', value: n('confirmed', 'paid'), tone: 'primary' as const, status: '' },
    {
      key: 'inProgress',
      value: n('preparing', 'ready', 'out_for_delivery'),
      tone: 'success' as const,
      status: '',
    },
    {
      key: 'attention',
      value: n('needs_attention'),
      tone: 'danger' as const,
      status: 'needs_attention',
    },
  ];
  const s = store.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('dashboard.title')} description={t('dashboard.subtitle')} />
      <div className="grid gap-4 lg:grid-cols-2">
        {can('online.manage') ? (
          <Card>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">{t('dashboard.storeCard')}</h2>
                {s ? (
                  <Badge tone={s.status === 'published' ? 'success' : 'neutral'}>
                    {t(`dashboard.status_${s.status}`)}
                  </Badge>
                ) : null}
              </div>
              {s ? (
                <>
                  <p className="text-sm">
                    {s.nameAr || s.nameEn ? (
                      <span className="font-medium">{s.nameAr || s.nameEn}</span>
                    ) : null}{' '}
                    <span dir="ltr" className="break-all text-fg-muted" data-testid="store-url">
                      {s.url}
                    </span>
                  </p>
                  {s.status === 'draft' ? (
                    <p className="text-sm text-fg-muted">{t('dashboard.noStoreYet')}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {s.status !== 'draft' ? (
                      <a href={s.url} target="_blank" rel="noreferrer">
                        <Button size="sm">{t('dashboard.openStore')}</Button>
                      </a>
                    ) : null}
                    <Link to="/settings">
                      <Button size="sm" variant="secondary">
                        {t('dashboard.editSettings')}
                      </Button>
                    </Link>
                    <Link to="/products">
                      <Button size="sm" variant="secondary">
                        {t('dashboard.chooseProducts')}
                      </Button>
                    </Link>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
        {can('online.orders') ? (
          <Card>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">{t('dashboard.ordersCard')}</h2>
                <Link className="text-sm text-primary hover:underline" to="/orders">
                  {t('dashboard.allOrders')}
                </Link>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {tiles.map((tile) => (
                  <li key={tile.key}>
                    <Link
                      to={tile.status ? `/orders?status=${tile.status}` : '/orders'}
                      className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-muted"
                    >
                      <span>{t(`dashboard.${tile.key}`)}</span>
                      <Badge tone={tile.value > 0 ? tile.tone : 'neutral'}>
                        <span dir="ltr" data-testid={`count-${tile.key}`}>
                          {tile.value}
                        </span>
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
        <Card className="lg:col-span-2">
          <CardContent className="flex flex-col gap-2">
            <h2 className="font-semibold">{t('dashboard.sharedCard')}</h2>
            <p className="text-sm text-fg-muted">{t('dashboard.sharedHint')}</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['catalog', 'products', 'catalog.read'],
                  ['customers', 'customers', 'customers.read'],
                  ['reports', 'reports', 'reports.sales'],
                  ['payments', 'payments', 'payments.settings'],
                ] as const
              )
                .filter(([, , perm]) => can(perm))
                .map(([k, path]) => (
                  <a key={k} href={managerUrl(path)}>
                    <Button size="sm" variant="secondary">
                      {t(`nav.${k}`)} ↗
                    </Button>
                  </a>
                ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
