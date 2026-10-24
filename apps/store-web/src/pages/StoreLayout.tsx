import { hostStore } from '../address.js';
import { ErrorState, NotFound } from '@arabat/web-core';
import { ApiError } from '@arabat/api-client';
import { Navigate, ScrollRestoration, useLocation } from 'react-router';
import { CartProvider } from '../cart.js';
import { StoreShell } from '../design/Shell.js';
import { DesignProvider, useDesignQuery } from '../design/context.js';
import { StoreSkeleton } from '../design/skeleton.js';
import { AccountProvider, BranchChoiceProvider, useSlug, useStorefront } from '../shared.js';

/** Public storefront: the store, its providers and the designed shell (ADR-0128). */
export function StoreLayout() {
  return (
    <>
      {/*
       * A new page opens at its top; Back returns to where the shopper was. Keyed by the path, so
       * filtering or searching a list (query only) keeps the place on the page.
       */}
      <ScrollRestoration getKey={(location) => location.pathname} />
      <StorePage />
    </>
  );
}

function StorePage() {
  const slug = useSlug();
  const store = useStorefront();
  // The design loads together with the store, not after it.
  useDesignQuery(slug);
  const location = useLocation();
  if (store.isPending) return <StoreSkeleton />;
  if (store.isError)
    return store.error instanceof ApiError && store.error.status === 404 ? (
      <NotFound />
    ) : (
      <ErrorState error={store.error} onRetry={() => void store.refetch()} fullPage />
    );
  // A renamed store still answers on its old address for a while: move to the current one.
  if (store.data.slug !== slug && hostStore()) {
    // On its own sub-domain the address to change is the host name (ADR-0136).
    window.location.replace(window.location.href.replace(`//${slug}.`, `//${store.data.slug}.`));
    return <StoreSkeleton />;
  }
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
          <DesignProvider slug={slug}>
            <StoreShell />
          </DesignProvider>
        </CartProvider>
      </AccountProvider>
    </BranchChoiceProvider>
  );
}
