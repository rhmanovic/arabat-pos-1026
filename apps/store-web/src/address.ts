/*
 * Where the storefront runs (ADR-0136): on its own sub-domain (`store666.arabatapp.com`) the
 * server names the store in `<meta name="arabat-store">` and every page is at `/…`; otherwise
 * pages are at `/store/{slug}/…`. Links inside the store are built with `storePath` only.
 */

/** The store named by the page's host, or null under the shared `/store/{slug}` address. */
export function hostStore(): string | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLMetaElement>('meta[name="arabat-store"]')?.content || null;
}

/** A page of the store (`''`, `/products`, `/cart`…) as a route of the store app. */
export function storePath(slug: string, path = ''): string {
  return hostStore() ? path || '/' : `/${slug}${path}`;
}
