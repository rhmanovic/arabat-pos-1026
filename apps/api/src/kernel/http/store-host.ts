import { isStoreSubdomain } from '@arabat/contracts';
import type { IncomingMessage } from 'node:http';
import type { Env } from '../../config/env.js';

/*
 * Stores at their own sub-domain (ADR-0136): `store666.arabatapp.com` is the store `store666`,
 * served at `/` instead of `/store/store666`. A wildcard DNS record sends every sub-domain to
 * the same service; the host name alone says which store is meant.
 */

type StoreEnv = Pick<Env, 'PUBLIC_STORE_URL' | 'STORE_DOMAIN'>;

/** The store a host name stands for (`{slug}.STORE_DOMAIN`), or null for any other host. */
export function storeSlugFromHost(host: string | undefined, storeDomain: string): string | null {
  if (!storeDomain || !host) return null;
  const name = host.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const suffix = `.${storeDomain}`;
  if (!name.endsWith(suffix)) return null;
  const label = name.slice(0, -suffix.length);
  return isStoreSubdomain(label) ? label : null;
}

/** The public address of a store, without a trailing slash: its sub-domain when it has one. */
export function storeAddress(env: StoreEnv, slug: string): string {
  if (env.STORE_DOMAIN && isStoreSubdomain(slug)) {
    const base = new URL(env.PUBLIC_STORE_URL);
    return `${base.protocol}//${slug}.${env.STORE_DOMAIN}${base.port ? `:${base.port}` : ''}`;
  }
  return `${env.PUBLIC_STORE_URL.replace(/\/+$/, '')}/${encodeURIComponent(slug)}`;
}

/**
 * Fastify `rewriteUrl`: on a store's host every page address is the store's page
 * (`/products/x` → `/store/{slug}/products/x`). The API and the storefront's own files
 * (`/api/…`, `/store/…`) keep their address; the other apps are not reachable there.
 */
export function storeHostRewrite(storeDomain: string) {
  return (req: IncomingMessage): string => {
    const url = req.url ?? '/';
    const slug = storeSlugFromHost(req.headers.host, storeDomain);
    if (!slug || url.startsWith('/api/') || url === '/store' || url.startsWith('/store/'))
      return url;
    return `/store/${slug}${url}`;
  };
}
