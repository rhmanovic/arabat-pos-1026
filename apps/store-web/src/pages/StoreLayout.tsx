import { Alert, Select, Spinner } from '@arabat/ui';
import { ErrorState, LanguageSwitcher, NotFound } from '@arabat/web-core';
import { ApiError } from '@arabat/api-client';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { CartProvider, useCart } from '../cart.js';
import {
  AccountProvider,
  BranchChoiceProvider,
  useAccount,
  setPageMeta,
  useBranchChoice,
  useLocalName,
  useSlug,
  useStorefront,
} from '../shared.js';

/** Public storefront shell: store branding, cart link, language switch. */
export function StoreLayout() {
  const slug = useSlug();
  const store = useStorefront();
  const { t } = useTranslation();
  const location = useLocation();
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
  // A renamed store still answers on its old address for a while: move to the current one.
  if (store.data.slug !== slug)
    return (
      <Navigate
        to={{
          ...location,
          pathname: location.pathname.replace(/^\/[^/]+/, `/${store.data.slug}`),
        }}
        replace
      />
    );
  return (
    <BranchChoiceProvider key={slug} slug={slug}>
      <AccountProvider slug={slug}>
        <CartProvider slug={slug}>
          <Shell />
        </CartProvider>
      </AccountProvider>
    </BranchChoiceProvider>
  );
}

function Shell() {
  const slug = useSlug();
  const { data: store } = useStorefront();
  const cart = useCart();
  const name = useLocalName();
  const { branchId, setBranchId } = useBranchChoice();
  const { token } = useAccount();
  const { t, i18n } = useTranslation();
  const storeName = store ? name(store) : '';
  const storeDescription = store
    ? i18n.language.startsWith('ar')
      ? store.taglineAr || store.taglineEn
      : store.taglineEn || store.taglineAr
    : null;
  useEffect(() => {
    if (storeName)
      setPageMeta({
        title: storeName,
        description: storeDescription,
        image: store?.logoUrl ?? store?.bannerUrl ?? null,
        jsonLd: null,
      });
  }, [storeName, storeDescription, store?.logoUrl, store?.bannerUrl]);
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
        {store.bannerUrl ? (
          <div className="mx-auto max-w-5xl px-4 pt-4">
            <img
              src={store.bannerUrl}
              alt=""
              className="aspect-[3/1] w-full rounded-lg object-cover"
              data-testid="store-banner"
            />
          </div>
        ) : null}
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 p-4">
          <Link to={`/${slug}`} className="flex min-w-0 items-center gap-3">
            {store.logoUrl ? (
              <img
                src={store.logoUrl}
                alt=""
                className="size-12 shrink-0 rounded-full border border-border object-cover"
                data-testid="store-logo"
              />
            ) : null}
            <span className="min-w-0">
              <span className="block truncate text-xl font-semibold">{name(store)}</span>
              {tagline ? (
                <span className="block truncate text-sm text-fg-muted">{tagline}</span>
              ) : null}
            </span>
          </Link>
          <nav aria-label={t('brand')} className="flex items-center gap-3">
            {store.branches.filter((b) => b.pickupEnabled).length > 1 ? (
              <Select
                aria-label={t('nav.branch')}
                className="w-40"
                value={branchId ?? ''}
                onChange={(e) => setBranchId(e.target.value || null)}
              >
                {store.branches
                  .filter((b) => b.pickupEnabled)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {name(b)}
                    </option>
                  ))}
              </Select>
            ) : null}
            <Link to={`/${slug}`} className="text-sm hover:underline">
              {t('nav.catalog')}
            </Link>
            {store.accountsEnabled || token ? (
              <Link to={`/${slug}/account`} className="text-sm hover:underline">
                {token ? t('nav.account') : t('nav.signIn')}
              </Link>
            ) : null}
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
