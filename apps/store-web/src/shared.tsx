import { formatMoney } from '@arabat/i18n';
import type { Money } from '@arabat/money';
import { useApi } from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { toMoney } from './cart.js';

/** The pickup branch the shopper chose (ADR-0123), kept per store in the browser. */
const BranchContext = createContext<{
  branchId: string | null;
  setBranchId: (id: string | null) => void;
} | null>(null);

const branchStorageKey = (slug: string) => `arabat.store.${slug}.branch`;

export function BranchChoiceProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [branchId, setState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(branchStorageKey(slug));
    } catch {
      return null;
    }
  });
  const setBranchId = useCallback(
    (id: string | null) => {
      setState(id);
      try {
        if (id) localStorage.setItem(branchStorageKey(slug), id);
        else localStorage.removeItem(branchStorageKey(slug));
      } catch {
        // Private mode: the choice lives for this page only.
      }
    },
    [slug],
  );
  const value = useMemo(() => ({ branchId, setBranchId }), [branchId, setBranchId]);
  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

/** The shopper's account token (ADR-0124), kept per store in the browser. */
const AccountContext = createContext<{
  token: string | null;
  setToken: (token: string | null) => void;
} | null>(null);
const tokenStorageKey = (slug: string) => `arabat.store.${slug}.token`;

export function AccountProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [token, setState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(tokenStorageKey(slug));
    } catch {
      return null;
    }
  });
  const setToken = useCallback(
    (next: string | null) => {
      setState(next);
      try {
        if (next) localStorage.setItem(tokenStorageKey(slug), next);
        else localStorage.removeItem(tokenStorageKey(slug));
      } catch {
        // Private mode: signed in for this page only.
      }
    },
    [slug],
  );
  const value = useMemo(() => ({ token, setToken }), [token, setToken]);
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

/** Token and sign-in state of the shopper; `account` loads when a token is present. */
export function useAccount() {
  const ctx = useContext(AccountContext);
  const api = useApi();
  const slug = useSlug();
  const token = ctx?.token ?? null;
  const setToken = ctx?.setToken ?? (() => undefined);
  const view = useQuery({
    queryKey: ['store', slug, 'account', token],
    queryFn: () => api.store.account.me(slug, token!),
    enabled: token !== null,
    retry: false,
  });
  // A revoked or expired token signs the shopper out quietly.
  if (view.isError && token) setToken(null);
  return {
    token,
    setToken,
    account: view.data?.account ?? null,
    addresses: view.data?.addresses ?? [],
    isPending: token !== null && view.isPending,
    signOut: async () => {
      if (token) await api.store.account.logout(slug, token).catch(() => undefined);
      setToken(null);
    },
  };
}

/**
 * The branch products, stock and prices come from: the shopper's choice when it serves the
 * store, else the store's default branch.
 */
export function useBranchChoice() {
  const ctx = useContext(BranchContext);
  const { data: store } = useStorefront();
  const chosen = ctx?.branchId ?? null;
  const branch =
    (chosen ? store?.branches.find((b) => b.id === chosen) : undefined) ??
    store?.branches.find((b) => b.id === store.defaultBranchId) ??
    store?.branches[0] ??
    null;
  return {
    branch,
    branchId: branch?.id ?? null,
    isDefault: branch === null || branch.id === store?.defaultBranchId,
    setBranchId: ctx?.setBranchId ?? (() => undefined),
  };
}

export function useSlug(): string {
  return useParams()['slug'] ?? '';
}

export function useStorefront() {
  const api = useApi();
  const slug = useSlug();
  return useQuery({ queryKey: ['store', slug], queryFn: () => api.store.info(slug) });
}

/** Catalog with live availability; refreshed often because POS sales change stock. */
export function useStoreProducts() {
  const api = useApi();
  const slug = useSlug();
  const { branchId, isDefault } = useBranchChoice();
  return useQuery({
    queryKey: ['store', slug, 'products', isDefault ? null : branchId],
    queryFn: () => api.store.products(slug, isDefault ? null : branchId),
    staleTime: 15_000,
  });
}

/** Picks the name in the shopper's language, falling back to the other one. */
export function useLocalName() {
  const { i18n } = useTranslation();
  return (item: { nameEn: string | null; nameAr: string | null }) =>
    (i18n.language.startsWith('ar') ? item.nameAr || item.nameEn : item.nameEn || item.nameAr) ??
    '';
}

/** Page metadata for search engines and link previews (Phase 10): title, description, OG tags, JSON-LD. */
export function setPageMeta(meta: {
  title: string;
  description?: string | null;
  image?: string | null;
  jsonLd?: Record<string, unknown> | null;
}) {
  document.title = meta.title;
  const tag = (selector: string, create: () => HTMLElement) => {
    let el = document.head.querySelector<HTMLElement>(selector);
    if (!el) {
      el = create();
      document.head.appendChild(el);
    }
    return el;
  };
  const metaTag = (attr: 'name' | 'property', key: string, content: string | null | undefined) => {
    const el = tag(`meta[${attr}="${key}"]`, () => {
      const m = document.createElement('meta');
      m.setAttribute(attr, key);
      return m;
    });
    if (content) el.setAttribute('content', content);
    else el.remove();
  };
  metaTag('name', 'description', meta.description);
  metaTag('property', 'og:title', meta.title);
  metaTag('property', 'og:description', meta.description);
  metaTag(
    'property',
    'og:image',
    meta.image ? new URL(meta.image, window.location.origin).toString() : null,
  );
  metaTag('property', 'og:type', meta.jsonLd ? 'product' : 'website');
  const ld = tag('script[data-seo="jsonld"]', () => {
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.setAttribute('data-seo', 'jsonld');
    return s;
  });
  if (meta.jsonLd) ld.textContent = JSON.stringify(meta.jsonLd);
  else ld.remove();
}

export function useMoney() {
  const { i18n } = useTranslation();
  return (value: Money | { amount: string; currency: string }) =>
    formatMoney('toDecimalString' in value ? value : toMoney(value), i18n.language);
}
