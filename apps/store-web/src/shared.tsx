import { formatMoney } from '@arabat/i18n';
import type { Money } from '@arabat/money';
import { useApi } from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { toMoney } from './cart.js';

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
  return useQuery({
    queryKey: ['store', slug, 'products'],
    queryFn: () => api.store.products(slug),
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
