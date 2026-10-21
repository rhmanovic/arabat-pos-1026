import type { ProductHighlight, ProductPageDesign, StoreProduct } from '@arabat/contracts';
import { cn } from '@arabat/ui';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useText } from './context.js';
import { StoreIcon } from './parts.js';
import { ProductGrid } from './sections.js';

/*
 * Pieces of the designed product page (ADR-0128 amendment 4): the picture gallery with its
 * full-screen view, the description with the store's info blocks, related products and the
 * products this shopper opened before.
 */

type Gallery = ProductPageDesign['gallery'];

export const RATIO = {
  square: 'aspect-square',
  portrait: 'aspect-[4/5]',
  landscape: 'aspect-[4/3]',
} as const;

const fitClass = (fit: Gallery['fit']) =>
  fit === 'contain' ? 'size-full object-contain p-2' : 'size-full object-cover';

/** Swipe left / right on a picture (mirrored in Arabic). */
function useSwipe(onStep: (by: -1 | 1) => void) {
  const { i18n } = useTranslation();
  const start = useRef<number | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      start.current = e.touches[0]?.clientX ?? null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const from = start.current;
      const to = e.changedTouches[0]?.clientX;
      start.current = null;
      if (from === null || to === undefined || Math.abs(to - from) < 40) return;
      const towardsStart = i18n.dir() === 'rtl' ? to < from : to > from;
      onStep(towardsStart ? -1 : 1);
    },
  };
}

function Arrow({
  by,
  onClick,
  className,
}: {
  by: -1 | 1;
  onClick: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-label={by < 0 ? t('product.previous') : t('product.next')}
      onClick={onClick}
      className={cn(
        'absolute top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-lg text-white backdrop-blur transition-colors hover:bg-black/65',
        by < 0 ? 'start-2' : 'end-2',
        className,
      )}
    >
      <span aria-hidden className="rtl:-scale-x-100">
        {by < 0 ? '‹' : '›'}
      </span>
    </button>
  );
}

/** The pictures of a product: the main one, its small pictures or dots, arrows and swipe. */
export function ProductGallery({
  images,
  settings,
  index,
  setIndex,
  scroll,
}: {
  images: string[];
  settings: Gallery;
  index: number;
  setIndex: (i: number) => void;
  /** The "all pictures" arrangement: every picture one under another on large screens. */
  scroll: boolean;
}) {
  const { t } = useTranslation();
  const [zoomed, setZoomed] = useState(false);
  const count = images.length;
  const step = (by: -1 | 1) => count > 1 && setIndex((index + by + count) % count);
  const swipe = useSwipe(step);
  const current = images[Math.min(index, count - 1)] ?? null;
  const ratio = RATIO[settings.ratio];
  const thumbs = scroll && settings.thumbs !== 'none' ? 'dots' : settings.thumbs;

  const main = (
    <div
      className={cn('group relative overflow-hidden rounded-lg bg-surface-muted', ratio)}
      {...swipe}
    >
      {current ? (
        settings.zoom ? (
          <button
            type="button"
            className="block size-full cursor-zoom-in"
            aria-label={t('product.zoom')}
            onClick={() => setZoomed(true)}
          >
            <img
              src={current}
              alt=""
              className={fitClass(settings.fit)}
              data-testid="product-image"
            />
          </button>
        ) : (
          <img
            src={current}
            alt=""
            className={fitClass(settings.fit)}
            data-testid="product-image"
          />
        )
      ) : (
        <span className="grid size-full place-items-center text-fg-subtle">
          <StoreIcon name="bag" className="size-12 opacity-40" />
        </span>
      )}
      {count > 1 ? (
        <>
          <Arrow by={-1} onClick={() => step(-1)} />
          <Arrow by={1} onClick={() => step(1)} />
        </>
      ) : null}
      {count > 1 && thumbs === 'dots' ? (
        <ul
          className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5"
          aria-label={t('product.gallery')}
        >
          {images.map((src, i) => (
            <li key={src}>
              <button
                type="button"
                aria-label={t('product.picture', { n: i + 1 })}
                aria-pressed={i === index}
                onClick={() => setIndex(i)}
                className={cn(
                  'block h-2 rounded-full bg-white/70 shadow transition-all',
                  i === index ? 'w-5 bg-white' : 'w-2',
                )}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
  const strip =
    count > 1 && (thumbs === 'below' || thumbs === 'side') ? (
      <ul
        className={cn(
          'flex gap-2 overflow-x-auto [scrollbar-width:thin]',
          thumbs === 'side' &&
            'md:order-first md:max-h-[32rem] md:w-20 md:shrink-0 md:flex-col md:overflow-y-auto',
        )}
        aria-label={t('product.gallery')}
      >
        {images.map((src, i) => (
          <li key={src} className="shrink-0">
            <button
              type="button"
              aria-label={t('product.picture', { n: i + 1 })}
              aria-pressed={i === index}
              onClick={() => setIndex(i)}
              className="block size-16 overflow-hidden rounded-md border border-border bg-surface-muted aria-pressed:border-primary aria-pressed:ring-2 aria-pressed:ring-primary md:size-20"
            >
              <img src={src} alt="" className="size-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <>
      {scroll && count > 1 ? (
        // Large screens: every picture, one under another; phones keep the swipeable one.
        <ul className="hidden flex-col gap-3 md:flex" data-testid="product-pictures">
          {images.map((src, i) => (
            <li key={src} className={cn('overflow-hidden rounded-lg bg-surface-muted', ratio)}>
              <button
                type="button"
                className={cn(
                  'block size-full',
                  settings.zoom ? 'cursor-zoom-in' : 'cursor-default',
                )}
                aria-label={t('product.picture', { n: i + 1 })}
                onClick={() => {
                  setIndex(i);
                  if (settings.zoom) setZoomed(true);
                }}
              >
                <img src={src} alt="" className={fitClass(settings.fit)} loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div
        className={cn(
          'flex flex-col gap-2',
          thumbs === 'side' && 'md:flex-row',
          scroll && count > 1 && 'md:hidden',
        )}
      >
        <div className="min-w-0 flex-1">{main}</div>
        {strip}
      </div>
      {zoomed && current ? (
        <Lightbox
          images={images}
          index={index}
          setIndex={setIndex}
          onClose={() => setZoomed(false)}
        />
      ) : null}
    </>
  );
}

/** A picture over the whole screen, with arrows, swipe and Escape to close. */
function Lightbox({
  images,
  index,
  setIndex,
  onClose,
}: {
  images: string[];
  index: number;
  setIndex: (i: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const count = images.length;
  const step = (by: -1 | 1) => count > 1 && setIndex((index + by + count) % count);
  const swipe = useSwipe(step);
  const close = useRef<HTMLButtonElement>(null);
  const keys = useRef({ step, onClose });
  useEffect(() => {
    keys.current = { step, onClose };
  });
  useEffect(() => {
    close.current?.focus();
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      const rtl = document.documentElement.dir === 'rtl';
      if (e.key === 'Escape') keys.current.onClose();
      if (e.key === 'ArrowRight') keys.current.step(rtl ? -1 : 1);
      if (e.key === 'ArrowLeft') keys.current.step(rtl ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = before;
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/95 text-white"
      role="dialog"
      aria-modal
      aria-label={t('product.gallery')}
    >
      <div className="flex items-center justify-between p-3">
        <span className="text-sm tabular-nums opacity-80">
          {t('product.pictureOf', { n: index + 1, count })}
        </span>
        <button
          ref={close}
          type="button"
          onClick={onClose}
          className="grid size-10 place-items-center rounded-full bg-white/10 text-xl hover:bg-white/20"
          aria-label={t('product.closeZoom')}
        >
          <span aria-hidden>×</span>
        </button>
      </div>
      <div className="relative min-h-0 flex-1" {...swipe}>
        <img
          src={images[index]}
          alt=""
          className="absolute inset-0 size-full object-contain p-2"
          data-testid="zoomed-image"
        />
        {count > 1 ? (
          <>
            <Arrow by={-1} onClick={() => step(-1)} />
            <Arrow by={1} onClick={() => step(1)} />
          </>
        ) : null}
      </div>
    </div>
  );
}

/** The product's description and the store's info blocks: plain, tabs or folding rows. */
export function ProductDetails({
  description,
  settings,
}: {
  description: string;
  settings: ProductPageDesign['description'];
}) {
  const { t } = useTranslation();
  const text = useText();
  const [tab, setTab] = useState(0);
  const items: { key: string; title: string; body: string }[] = [
    ...(description
      ? [{ key: 'description', title: t('product.description'), body: description }]
      : []),
    ...settings.blocks
      .map((b) => ({ key: b.id, title: text(b.title), body: text(b.text) }))
      .filter((b) => b.title && b.body),
  ];
  if (items.length === 0) return null;
  const body = (s: string) => (
    <p className="whitespace-pre-line text-sm leading-relaxed text-fg-muted">{s}</p>
  );
  if (settings.style === 'tabs') {
    const shown = items[Math.min(tab, items.length - 1)]!;
    return (
      <div className="flex flex-col gap-3" data-testid="product-details">
        <div
          role="tablist"
          aria-label={t('product.details')}
          className="flex gap-1 overflow-x-auto border-b border-border"
        >
          {items.map((item, i) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={item.key === shown.key}
              onClick={() => setTab(i)}
              className={cn(
                '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-semibold',
                item.key === shown.key
                  ? 'border-primary text-fg'
                  : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              {item.title}
            </button>
          ))}
        </div>
        <div role="tabpanel" aria-label={shown.title}>
          {body(shown.body)}
        </div>
      </div>
    );
  }
  if (settings.style === 'accordion')
    return (
      <div
        className="flex flex-col divide-y divide-border border-y border-border"
        data-testid="product-details"
      >
        {items.map((item, i) => (
          <details key={item.key} open={i === 0} className="group py-1">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-2.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
              {item.title}
              <span
                aria-hidden
                className="text-fg-subtle transition-transform group-open:rotate-180"
              >
                ▾
              </span>
            </summary>
            <div className="pb-3">{body(item.body)}</div>
          </details>
        ))}
      </div>
    );
  return (
    <div className="flex flex-col gap-4" data-testid="product-details">
      {items.map((item) =>
        item.key === 'description' ? (
          <div key={item.key}>{body(item.body)}</div>
        ) : (
          <div key={item.key} className="flex flex-col gap-1">
            <h2 className="text-sm font-bold">{item.title}</h2>
            {body(item.body)}
          </div>
        ),
      )}
    </div>
  );
}

/** Products to show beside one: same category first, then the featured, then any. */
export function relatedProducts(
  all: StoreProduct[],
  product: StoreProduct,
  settings: ProductPageDesign['related'],
): StoreProduct[] {
  const others = all.filter(
    (p) => p.productId !== product.productId && p.variants.some((v) => v.available),
  );
  const same = product.categoryId ? others.filter((p) => p.categoryId === product.categoryId) : [];
  const featured = others.filter((p) => p.featured);
  const order =
    settings.source === 'category'
      ? [...same, ...featured, ...others]
      : settings.source === 'featured'
        ? [...featured, ...others]
        : others;
  return [...new Map(order.map((p) => [p.productId, p])).values()].slice(0, settings.limit);
}

/** A titled row of products under the product. */
export function ProductRow({
  title,
  products,
  variant,
  quickAdd,
  testId,
}: {
  title: string;
  products: StoreProduct[];
  variant: 'grid' | 'carousel';
  quickAdd: boolean;
  testId: string;
}): ReactNode {
  if (products.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h2 className="text-lg font-bold">{title}</h2>
      <ProductGrid products={products} variant={variant} quickAdd={quickAdd} testId={testId} />
    </section>
  );
}

/**
 * The products this shopper opened in this store, newest first, kept on the shopper's device
 * only (nothing is sent). Recorded only while the merchant shows them.
 */
export function useRecentlyViewed(slug: string, productId: string, enabled: boolean): string[] {
  const storageKey = `arabat.recent.${slug}`;
  // Read once: the product view is mounted again for every product.
  const [before] = useState(() => readRecent(storageKey));
  useEffect(() => {
    if (!enabled) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify([productId, ...before.filter((id) => id !== productId)].slice(0, 12)),
      );
    } catch {
      // Private windows may refuse storage; the row just stays empty.
    }
  }, [storageKey, productId, enabled, before]);
  return enabled ? before.filter((id) => id !== productId) : [];
}

function readRecent(storageKey: string): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Reassurance items: emoji, a short title and words (product, cart and checkout pages). */
export function Highlights({ items, testId }: { items: ProductHighlight[]; testId: string }) {
  const text = useText();
  if (items.length === 0) return null;
  return (
    <ul className="grid w-full gap-2 sm:grid-cols-2" data-testid={testId}>
      {items.map((h) => (
        <li
          key={h.id}
          className="flex items-start gap-3 rounded-lg bg-surface-muted p-3 text-start"
        >
          {h.icon ? (
            <span aria-hidden className="text-xl leading-none">
              {h.icon}
            </span>
          ) : null}
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{text(h.title)}</span>
            {text(h.text) ? (
              <span className="block text-xs text-fg-muted">{text(h.text)}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Whether an element is out of the screen, for the phone's bottom bars: `above` only once it
 * has scrolled above the screen (the product page's add button), else whenever it is not seen
 * (the cart's checkout button, often below the lines). Browsers without the observer: never.
 */
export function useOutOfView(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  above = false,
): boolean {
  const [away, setAway] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) =>
      setAway(
        Boolean(entry && !entry.isIntersecting && (!above || entry.boundingClientRect.top < 0)),
      ),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, enabled, above]);
  return enabled && away;
}
