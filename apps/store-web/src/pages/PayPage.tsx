import { Alert, Button, Spinner } from '@arabat/ui';
import { ErrorState, LanguageSwitcher, useApi, useErrorMessage } from '@arabat/web-core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import { useMoney } from '../shared.js';

/**
 * Hosted page of the sandbox gateway (mock adapter). A real gateway (Tap, UPayments,
 * Hesabe, Bookeey) shows its own page instead; this one only exists while mock payments
 * are enabled and never moves real money (BR-143).
 */
export function PayPage() {
  const api = useApi();
  const { reference = '' } = useParams();
  const [params] = useSearchParams();
  const money = useMoney();
  const errorMessage = useErrorMessage();
  const { t } = useTranslation();
  const payment = useQuery({
    queryKey: ['mock-payment', reference],
    queryFn: () => api.store.mockPayment(reference),
  });
  const complete = useMutation({
    mutationFn: (outcome: 'succeeded' | 'failed' | 'cancelled') =>
      api.store.mockComplete(reference, outcome),
    onSuccess: (p) => window.location.assign(sameOrigin(params.get('return')) ?? p.returnUrl),
  });
  if (payment.isPending)
    return (
      <div className="flex min-h-dvh items-center justify-center text-primary">
        <Spinner size="lg" label={t('common:status.loading')} />
      </div>
    );
  if (payment.isError)
    return <ErrorState error={payment.error} onRetry={() => void payment.refetch()} fullPage />;
  const p = payment.data;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('pay.title')}</h1>
        <LanguageSwitcher />
      </div>
      <Alert tone="warning">{t('pay.sandbox')}</Alert>
      <dl className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4 text-sm">
        <div className="flex justify-between">
          <dt>{t('pay.merchant')}</dt>
          <dd>{p.merchantName}</dd>
        </div>
        <div className="flex justify-between">
          <dt>{t('pay.order')}</dt>
          <dd>{p.orderNumber}</dd>
        </div>
        <div className="flex justify-between text-base font-semibold">
          <dt>{t('pay.amount')}</dt>
          <dd className="tabular-nums">{money(p.amount)}</dd>
        </div>
      </dl>
      {complete.isError ? <Alert tone="danger">{errorMessage(complete.error)}</Alert> : null}
      {p.status === 'initiated' ? (
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            disabled={complete.isPending}
            onClick={() => complete.mutate('succeeded')}
          >
            {t('pay.succeed')}
          </Button>
          <Button
            variant="secondary"
            disabled={complete.isPending}
            onClick={() => complete.mutate('failed')}
          >
            {t('pay.fail')}
          </Button>
          <Button
            variant="ghost"
            disabled={complete.isPending}
            onClick={() => complete.mutate('cancelled')}
          >
            {t('pay.cancel')}
          </Button>
        </div>
      ) : (
        <>
          <p>{t('pay.done', { status: t(`gateway.${p.status}`) })}</p>
          <Button onClick={() => window.location.assign(p.returnUrl)}>{t('pay.back')}</Button>
        </>
      )}
    </main>
  );
}

/** Only follows a return address on this site (no open redirect). */
function sameOrigin(url: string | null): string | null {
  if (!url) return null;
  try {
    const target = new URL(url, window.location.origin);
    return target.origin === window.location.origin ? target.href : null;
  } catch {
    return null;
  }
}
