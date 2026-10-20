import {
  type DesignLink,
  type DesignPage,
  type Localized,
  type StoreDesign,
  legacyDesign,
  storeDesignSchema,
} from '@arabat/contracts';
import { cn } from '@arabat/ui';
import { readableOn, useApi } from '@arabat/web-core';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

/**
 * Store design on the storefront (ADR-0128). Shoppers get the published design; inside the
 * console's preview frame (named `arabat-design-preview`) the merchant's draft is shown and
 * replaced live by the editor through `postMessage` (same origin only).
 */
export const PREVIEW_FRAME_NAME = 'arabat-design-preview';
export const isPreview = () => typeof window !== 'undefined' && window.name === PREVIEW_FRAME_NAME;

type PreviewMessage =
  | { type: 'arabat:design'; design: unknown }
  | { type: 'arabat:navigate'; page: DesignPage }
  | { type: 'arabat:focus'; sectionId: string }
  | { type: 'arabat:scroll'; to: 'top' | 'footer' };

const DesignContext = createContext<StoreDesign | null>(null);

export function DesignProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const api = useApi();
  const preview = isPreview();
  const navigate = useNavigate();
  const published = useQuery({
    queryKey: ['store', slug, 'design', preview],
    queryFn: async () =>
      preview ? (await api.online.design()).draft : (await api.store.design(slug)).design,
    retry: false,
    staleTime: 60_000,
  });
  const [live, setLive] = useState<StoreDesign | null>(null);

  useEffect(() => {
    if (!preview) return;
    const onMessage = (event: MessageEvent<PreviewMessage>) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const msg = event.data;
      if (msg?.type === 'arabat:design') {
        const parsed = storeDesignSchema.safeParse(msg.design);
        if (parsed.success) setLive(parsed.data);
      } else if (msg?.type === 'arabat:navigate') {
        const path = { home: '', products: '/products', categories: '/categories' }[msg.page];
        void navigate(`/${slug}${path}`);
      } else if (msg?.type === 'arabat:scroll') {
        // The editor's header and footer tabs bring their part of the store into view.
        requestAnimationFrame(() => {
          if (msg.to === 'footer')
            document
              .querySelector('[data-testid="store-footer"]')
              ?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
          else window.scrollTo?.({ top: 0, behavior: 'smooth' });
        });
      } else if (msg?.type === 'arabat:focus') {
        document
          .getElementById(`section-${msg.sectionId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
    window.addEventListener('message', onMessage);
    // Ask the editor for its current draft (it may hold unsaved changes).
    window.parent.postMessage({ type: 'arabat:design-ready' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, [preview, navigate, slug]);

  // While the design loads nothing is drawn, so the legacy layout never flashes.
  if (published.isPending && !live) return null;
  const design = live ?? published.data ?? legacyDesign();
  return <DesignContext.Provider value={design}>{children}</DesignContext.Provider>;
}

export function useDesign(): StoreDesign {
  return useContext(DesignContext) ?? legacyDesign();
}

/** Picks the text in the shopper's language, falling back to the other one. */
export function useText() {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith('ar');
  return (value: Localized | null | undefined, fallback = '') =>
    (ar ? value?.ar || value?.en : value?.en || value?.ar) || fallback;
}

export function assetUrl(slug: string, id: string | null): string | null {
  if (!id) return null;
  return isPreview()
    ? `/api/v1/manager/online/design/assets/${id}/file`
    : `/api/v1/store/${encodeURIComponent(slug)}/assets/${id}`;
}

/** Where a design link goes: a route inside the store, or an outside address. */
export function linkTarget(
  slug: string,
  link: DesignLink | null,
): { to: string; external: boolean } | null {
  if (!link) return null;
  const base = `/${slug}`;
  switch (link.kind) {
    case 'page':
      return {
        to: {
          home: base,
          products: `${base}/products`,
          categories: `${base}/categories`,
          cart: `${base}/cart`,
          account: `${base}/account`,
        }[link.page],
        external: false,
      };
    case 'category':
      return { to: `${base}/products?category=${link.categoryId}`, external: false };
    case 'product':
      return { to: `${base}/products/${link.productId}`, external: false };
    case 'url':
      return link.url.startsWith('/')
        ? { to: `${base}${link.url === '/' ? '' : link.url}`, external: false }
        : { to: link.url, external: true };
  }
}

// --------------------------------------------------------------------------- styling
/** Card surface by the design's card style. */
export function useCard() {
  const { style } = useDesign();
  return {
    bordered: 'border border-border bg-surface',
    shadow: 'bg-surface shadow-[0_6px_24px_-12px_rgb(0_0_0/0.25)]',
    flat: 'bg-surface-muted',
  }[style.cards];
}

/** Call-to-action buttons: solid, or pill shaped. */
export function useCta() {
  const { style } = useDesign();
  return (variant: 'primary' | 'light' | 'outline' = 'primary') =>
    cn(
      'inline-flex min-h-11 items-center justify-center gap-2 px-5 text-sm font-semibold transition-opacity hover:opacity-90',
      style.buttons === 'pill' ? 'rounded-full' : 'rounded-md',
      variant === 'primary' && 'bg-primary text-primary-fg',
      variant === 'light' && 'bg-white text-[#111]',
      variant === 'outline' && 'border border-current',
    );
}

const RADII = {
  sharp: ['0.125rem', '0.25rem', '0.375rem', '0.5rem'],
  soft: ['0.375rem', '0.625rem', '0.875rem', '1.25rem'],
  round: ['0.625rem', '1rem', '1.5rem', '2rem'],
} as const;

/** CSS variables of the store's colours and shapes, applied to the whole document. */
export function themeVariables(design: StoreDesign, primary: string): Record<string, string> {
  const brand = /^#[0-9a-f]{6}$/i.test(primary) ? primary : '#0f766e';
  const fg = readableOn(brand);
  const [sm, md, lg, xl] = RADII[design.style.radius];
  const vars: Record<string, string> = {
    '--color-primary': brand,
    '--color-primary-hover': `color-mix(in oklch, ${brand} 85%, black)`,
    '--color-primary-fg': fg,
    '--color-primary-soft': `color-mix(in oklch, ${brand} 12%, white)`,
    '--radius-sm': sm,
    '--radius-md': md,
    '--radius-lg': lg,
    '--radius-xl': xl,
  };
  if (design.style.background === 'tinted') {
    vars['--color-canvas'] = `color-mix(in oklch, ${brand} 5%, white)`;
    vars['--color-surface-muted'] = `color-mix(in oklch, ${brand} 8%, white)`;
  }
  if (design.style.background === 'dark') {
    Object.assign(vars, {
      '--color-canvas': 'oklch(0.17 0.01 260)',
      '--color-surface': 'oklch(0.22 0.012 260)',
      '--color-surface-muted': 'oklch(0.27 0.014 260)',
      '--color-border': 'oklch(0.33 0.015 260)',
      '--color-border-strong': 'oklch(0.42 0.02 260)',
      '--color-fg': 'oklch(0.96 0.005 260)',
      '--color-fg-muted': 'oklch(0.77 0.01 260)',
      '--color-fg-subtle': 'oklch(0.66 0.01 260)',
      '--color-primary-soft': `color-mix(in oklch, ${brand} 25%, oklch(0.22 0.012 260))`,
    });
  }
  return vars;
}

export function useThemeVariables(primary: string) {
  const design = useDesign();
  const vars = themeVariables(design, primary);
  const key = JSON.stringify(vars);
  useEffect(() => {
    const root = document.documentElement;
    const entries = Object.entries(JSON.parse(key) as Record<string, string>);
    for (const [k, v] of entries) root.style.setProperty(k, v);
    root.style.colorScheme = design.style.background === 'dark' ? 'dark' : 'light';
    return () => {
      for (const [k] of entries) root.style.removeProperty(k);
      root.style.colorScheme = '';
    };
  }, [key, design.style.background]);
}
