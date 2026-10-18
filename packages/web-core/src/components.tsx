import { ApiError, NetworkError } from '@arabat/api-client';
import { SUPPORTED_LANGUAGES } from '@arabat/contracts';
import { Alert, Button, Segmented, Spinner, StatusDot, cn, useToast } from '@arabat/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { useApi } from './api-context.js';

export function FullPageLoader() {
  const { t } = useTranslation('common');
  return (
    <div className="flex min-h-dvh items-center justify-center text-primary">
      <Spinner size="lg" label={t('status.loading')} />
    </div>
  );
}

/** Localized message for any error thrown by the API client. */
export function useErrorMessage() {
  const { t, i18n } = useTranslation('common');
  return (error: unknown): string => {
    if (error instanceof NetworkError) return t('errors.NETWORK');
    if (error instanceof ApiError) {
      const key = `errors.${error.code}`;
      return i18n.exists(key, { ns: 'common' }) ? t(key) : t('errors.UNKNOWN');
    }
    return t('errors.UNKNOWN');
  };
}

export function ErrorState({
  error,
  onRetry,
  fullPage,
}: {
  error: unknown;
  onRetry?: () => void;
  fullPage?: boolean;
}) {
  const { t } = useTranslation('common');
  const message = useErrorMessage()(error);
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div className={cn('flex items-center justify-center p-6', fullPage && 'min-h-dvh')}>
      <Alert tone="danger" title={t('errors.title')} className="w-full max-w-md">
        <p>{message}</p>
        {requestId ? (
          <p className="mt-1 text-xs">{t('errors.requestId', { id: requestId })}</p>
        ) : null}
        {onRetry ? (
          <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
            {t('actions.retry')}
          </Button>
        ) : null}
      </Alert>
    </div>
  );
}

export function AccessDenied() {
  const { t } = useTranslation('common');
  return (
    <div className="p-6">
      <Alert tone="warning" title={t('auth.accessDenied')} />
    </div>
  );
}

export function NotFound() {
  const { t } = useTranslation('common');
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-xl font-semibold">{t('errors.notFoundTitle')}</h1>
      <p className="text-fg-muted">{t('errors.notFoundBody')}</p>
    </div>
  );
}

/** Router `errorElement`: catches rendering and loader errors of a route subtree. */
export function RouteErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
  return <ErrorState error={error} onRetry={() => window.location.reload()} fullPage />;
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { t, i18n } = useTranslation('common');
  const options = SUPPORTED_LANGUAGES.map((lng) => ({ value: lng, label: t(`language.${lng}`) }));
  return (
    <Segmented
      className={className}
      label={t('language.label')}
      value={i18n.resolvedLanguage === 'en' ? 'en' : 'ar'}
      options={options}
      onChange={(lng) => void i18n.changeLanguage(lng)}
    />
  );
}

/**
 * One round globe button that switches between Arabic and English (link pages, ADR-0116
 * amendment 3). Its accessible name is the language it switches to.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const { t, i18n } = useTranslation('common');
  const next = i18n.resolvedLanguage === 'en' ? 'ar' : 'en';
  const label = t(`language.${next}`);
  return (
    <button
      type="button"
      onClick={() => void i18n.changeLanguage(next)}
      aria-label={label}
      title={label}
      lang={next}
      className={cn(
        'grid size-10 place-items-center rounded-full bg-white/80 text-fg shadow-sm ring-1 ring-black/5 backdrop-blur transition hover:scale-105 hover:bg-white active:scale-95',
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="9.5" />
        <path d="M2.5 12h19M12 2.5c2.6 2.8 3.9 6 3.9 9.5s-1.3 6.7-3.9 9.5c-2.6-2.8-3.9-6-3.9-9.5s1.3-6.7 3.9-9.5z" />
      </svg>
    </button>
  );
}

/** Live connection indicator: proves the frontend reaches the backend and the database. */
export function ApiStatus({ className }: { className?: string }) {
  const api = useApi();
  const { t } = useTranslation('common');
  const query = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: ({ signal }) => api.health.ready(signal),
    refetchInterval: 30_000,
    retry: false,
  });
  const [tone, label] = query.isPending
    ? (['neutral', t('status.apiChecking')] as const)
    : query.isError || query.data.status === 'down'
      ? (['danger', t('status.apiOffline')] as const)
      : query.data.status === 'degraded'
        ? (['warning', t('status.apiDegraded')] as const)
        : (['success', t('status.apiOnline')] as const);
  return (
    <span
      className={cn('inline-flex items-center gap-2 text-xs text-fg-muted', className)}
      data-testid="api-status"
      data-status={tone}
    >
      <StatusDot tone={tone} />
      {label}
    </span>
  );
}

/** Toast helpers for mutations: success message, or the localized API error. */
export function useNotify() {
  const toast = useToast();
  const message = useErrorMessage();
  return {
    ok: (title: string) => toast.success(title),
    info: (title: string) => toast.info(title),
    fail: (error: unknown) => toast.error(message(error)),
  };
}
