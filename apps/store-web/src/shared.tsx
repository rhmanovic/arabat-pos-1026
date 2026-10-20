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

export function useMoney() {
  const { i18n } = useTranslation();
  return (value: Money | { amount: string; currency: string }) =>
    formatMoney('toDecimalString' in value ? value : toMoney(value), i18n.language);
}
