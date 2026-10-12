import { Alert, Spinner } from '@arabat/ui';
import { ErrorState, LanguageSwitcher, NotFound } from '@arabat/web-core';
import { ApiError } from '@arabat/api-client';
import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router';
import { CartProvider, useCart } from '../cart.js';
import { useLocalName, useSlug, useStorefront } from '../shared.js';

/** Public storefront shell: store branding, cart link, language switch. */
export function StoreLayout() {
  const slug = useSlug();
  const store = useStorefront();
  const { t } = useTranslation();
  if (store.isPending)
    return (
      <div className="flex min-h-dvh items-center justify-center text-primary">
        <Spinner size="lg" label={t('common:status.loading')} />
      </div>
    );
  if (store.isError)
    return store.error instanceof ApiError && store.error.status === 404 ? (
      <NotFound />
    ) : (
      <ErrorState error={store.error} onRetry={() => void store.refetch()} fullPage />
    );
  return (
    <CartProvider key={slug} slug={slug}>
      <Shell />
    </CartProvider>
  );
}

function Shell() {
  const slug = useSlug();
  const { data: store } = useStorefront();
  const cart = useCart();
  const name = useLocalName();
  const { t, i18n } = useTranslation();
  if (!store) return null;
  const ar = i18n.language.startsWith('ar');
  const tagline = ar ? store.taglineAr || store.taglineEn : store.taglineEn || store.taglineAr;
  const announcement = ar
    ? store.announcementAr || store.announcementEn
    : store.announcementEn || store.announcementAr;
  return (
    <div className="min-h-dvh bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="h-1" style={{ backgroundColor: store.primaryColor }} />
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 p-4">
          <Link to={`/${slug}`} className="min-w-0">
            <p className="truncate text-xl font-semibold">{name(store)}</p>
            {tagline ? <p className="truncate text-sm text-fg-muted">{tagline}</p> : null}
          </Link>
          <nav aria-label={t('brand')} className="flex items-center gap-3">
            <Link to={`/${slug}`} className="text-sm hover:underline">
              {t('nav.catalog')}
            </Link>
            <Link
              to={`/${slug}/cart`}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-muted"
            >
              {t('nav.cartCount', { count: cart.count })}
            </Link>
            <LanguageSwitcher />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4">
        {announcement ? <Alert className="mb-4">{announcement}</Alert> : null}
        {!store.acceptingOrders ? (
          <Alert tone="warning" className="mb-4">
            {t('closed')}
          </Alert>
        ) : null}
        <Outlet />
      </main>
      {store.contactPhone || store.contactEmail ? (
        <footer className="mx-auto max-w-5xl p-4 text-sm text-fg-muted">
          {[store.contactPhone, store.contactEmail].filter(Boolean).join(' · ')}
        </footer>
      ) : null}
    </div>
  );
}
