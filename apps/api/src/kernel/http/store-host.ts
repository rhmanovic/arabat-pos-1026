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

/** A connected domain's address (ADR-0137): `https://www.{domain}` (the port kept in development). */
export function domainAddress(env: Pick<Env, 'PUBLIC_STORE_URL'>, domain: string): string {
  const base = new URL(env.PUBLIC_STORE_URL);
  return `${base.protocol}//www.${domain}${base.port ? `:${base.port}` : ''}`;
}

/** The host name of a request without port, trailing dot or case. */
export const plainHost = (host: string | undefined) =>
  (host ?? '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');

/** Host names that are Arabat's own apps (never a merchant's domain). */
export function ownHosts(
  env: Pick<Env, 'PUBLIC_MANAGER_URL' | 'PUBLIC_POS_URL' | 'PUBLIC_STORE_URL' | 'STORE_DOMAIN'>,
): Set<string> {
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  for (const url of [env.PUBLIC_MANAGER_URL, env.PUBLIC_POS_URL, env.PUBLIC_STORE_URL])
    hosts.add(new URL(url).hostname);
  if (env.STORE_DOMAIN) {
    hosts.add(env.STORE_DOMAIN);
    hosts.add(`www.${env.STORE_DOMAIN}`);
  }
  return hosts;
}

/** Path prefix a merchant's own domain is served under (`~` is never in a store address). */
export const DOMAIN_PATH = '/store/~';

/**
 * Fastify `rewriteUrl`: on a store's host every page address is the store's page
 * (`/products/x` → `/store/{slug}/products/x`); on a merchant's own domain (ADR-0137) it is
 * `/store/~/products/x`, resolved when the page is served. The API and the storefront's own
 * files (`/api/…`, `/store/…`) keep their address; the other apps are not reachable there.
 */
export function storeHostRewrite(options: {
  storeDomain: string;
  /** Hosts that are Arabat's own; any other host name is a merchant's domain. */
  own: Set<string> | null;
}) {
  return (req: IncomingMessage): string => {
    const url = req.url ?? '/';
    if (url.startsWith('/api/') || url === '/store' || url.startsWith('/store/')) return url;
    const slug = storeSlugFromHost(req.headers.host, options.storeDomain);
    if (slug) return `/store/${slug}${url}`;
    const host = plainHost(req.headers.host);
    if (
      options.own &&
      host &&
      !options.own.has(host) &&
      !/^[\d.]+$|^\[/.test(host) &&
      !(options.storeDomain && host.endsWith(`.${options.storeDomain}`))
    )
      return `${DOMAIN_PATH}${url}`;
    return url;
  };
}
