import { ErrorState, NotFound } from '@arabat/web-core';
import { ApiError } from '@arabat/api-client';
import { Navigate, useLocation } from 'react-router';
import { CartProvider } from '../cart.js';
import { StoreShell } from '../design/Shell.js';
import { DesignProvider, useDesignQuery } from '../design/context.js';
import { StoreSkeleton } from '../design/skeleton.js';
import { AccountProvider, BranchChoiceProvider, useSlug, useStorefront } from '../shared.js';

/** Public storefront: the store, its providers and the designed shell (ADR-0128). */
export function StoreLayout() {
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
