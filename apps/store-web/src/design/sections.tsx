import {
  type DesignPage,
  type DesignSection,
  type SectionOf,
  type StoreProduct,
  WEEKDAYS,
  videoEmbed,
} from '@arabat/contracts';
import { Badge, EmptyState, Input, Select, Spinner, cn } from '@arabat/ui';
import { ErrorState } from '@arabat/web-core';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useSearchParams } from 'react-router';
import { toMoney, useCart } from '../cart.js';
import {
  type StoreGroup,
  findGroup,
  inGroup,
  navGroups,
  useBranchChoice,
  useLocalName,
  useMoney,
  useSlug,
  useStoreProducts,
  useStorefront,
} from '../shared.js';
import { DesignAnchor, StoreIcon } from './parts.js';
import {
  assetUrl,
  linkTarget,
  useCard,
  useCta,
  useDesign,
  useStyledCta,
  useText,
} from './context.js';
import { SectionFrame, SectionTitle, full, shownSections } from './frame.js';
import {
  CollageSection,
  CountdownSection,
  CtaSection,
  FaqSection,
  GallerySection,
  LogosSection,
  SpacerSection,
  TestimonialsSection,
} from './sections-more.js';
import {
  CardsSection,
  ColumnsSection,
  DividerSection,
  MarqueeSection,
  SplitSection,
  StatsSection,
  StepsSection,
  TabsSection,
} from './sections-layout.js';

/** The designed page a section is drawn on. */
const PageContext = createContext<DesignPage>('home');

/** One designed page (home, products or categories): its shown sections in order. */
export function DesignedPage({ page }: { page: DesignPage }) {
  const design = useDesign();
  const sections = shownSections(design.pages[page]);
  // A link to `/#anchor` scrolls to the section with that anchor (ADR-0128 amendment 7).
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash || hash.length < 2) return;
    const target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (target && typeof target.scrollIntoView === 'function')
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash, sections.length]);
  return (
    <PageContext.Provider value={page}>
      <div className="-my-4 flex flex-col" data-page={page}>
        {sections.map((s) => (
          <SectionFrame key={s.id} section={s}>
            <Section section={s} />
          </SectionFrame>
        ))}
      </div>
    </PageContext.Provider>
  );
}

function Section({ section: s }: { section: DesignSection }) {
  switch (s.type) {
    case 'slider':
      return <SliderSection s={s} />;
    case 'banner':
      return <BannerSection s={s} />;
    case 'products':
      return <ProductsSection s={s} />;
    case 'categories':
      return <CategoriesSection s={s} />;
    case 'image':
      return <ImageSection s={s} />;
    case 'video':
      return <VideoSection s={s} />;
    case 'text':
      return <TextSection s={s} />;
    case 'features':
      return <FeaturesSection s={s} />;
    case 'menu':
      return <MenuSection s={s} />;
    case 'info':
      return <InfoSection s={s} />;
    case 'catalog':
      return <CatalogSection s={s} />;
    case 'countdown':
      return <CountdownSection s={s} />;
    case 'testimonials':
      return <TestimonialsSection s={s} />;
    case 'faq':
      return <FaqSection s={s} />;
    case 'gallery':
      return <GallerySection s={s} />;
    case 'logos':
      return <LogosSection s={s} />;
    case 'collage':
      return <CollageSection s={s} />;
    case 'cta':
      return <CtaSection s={s} />;
    case 'spacer':
      return <SpacerSection s={s} />;
    case 'divider':
      return <DividerSection s={s} />;
    case 'columns':
      return <ColumnsSection s={s} />;
    case 'split':
      return <SplitSection s={s} />;
    case 'cards':
      return <CardsSection s={s} />;
    case 'tabs':
      return <TabsSection s={s} />;
    case 'marquee':
      return <MarqueeSection s={s} />;
    case 'stats':
      return <StatsSection s={s} />;
    case 'steps':
      return <StepsSection s={s} />;
  }
}

/** Shade over pictures so the words on them stay readable. */
export const OVERLAY = {
  none: '',
  light: 'bg-gradient-to-t from-black/40 via-black/5 to-transparent',
  dark: 'bg-gradient-to-t from-black/70 via-black/20 to-transparent',
} as const;

// ---------------------------------------------------------------------------- slider
function SliderSection({ s }: { s: SectionOf<'slider'> }) {
  const slug = useSlug();
  const text = useText();
  const cta = useCta();
  const { t } = useTranslation();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const count = s.slides.length;
  useEffect(() => {
    if (!s.autoplay || count < 2) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), s.interval * 1000);
    return () => clearInterval(timer);
  }, [s.autoplay, s.interval, count]);
  useEffect(() => {
    const el = track.current;
    const slide = el?.children[index] as HTMLElement | undefined;
    if (el && slide) el.scrollTo?.({ left: slide.offsetLeft - el.offsetLeft, behavior: 'smooth' });
  }, [index]);
  if (count === 0) return null;
  const tall = {
    small: 'aspect-[16/10] sm:aspect-[3/1]',
    medium:
      s.variant === 'full' ? 'aspect-[4/5] sm:aspect-[21/8]' : 'aspect-[4/3] sm:aspect-[21/8]',
    large: 'aspect-[4/5] sm:aspect-[16/7]',
  }[s.height];
  const arrow = (by: -1 | 1) => (
    <button
      type="button"
      aria-label={by < 0 ? t('design.prevSlide') : t('design.nextSlide')}
      onClick={() => setIndex((i) => (i + by + count) % count)}
      className={cn(
        'absolute top-1/2 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-[#111] shadow-md backdrop-blur transition hover:bg-white max-sm:hidden',
        by < 0 ? 'start-3' : 'end-3',
      )}
    >
      <StoreIcon
        name="chevron"
        className={cn('size-5', by < 0 ? 'rotate-90 rtl:-rotate-90' : '-rotate-90 rtl:rotate-90')}
      />
    </button>
  );
  return (
    <section
      aria-roledescription="carousel"
      aria-label={t('design.slider')}
      className={cn('relative', s.variant === 'full' && full)}
    >
      {count > 1 && s.showArrows ? (
        <>
          {arrow(-1)}
          {arrow(1)}
        </>
      ) : null}
      <div
        ref={track}
        className={cn(
          'flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]',
          s.variant === 'cards' ? 'gap-3' : '',
        )}
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = Math.round(
            Math.abs(el.scrollLeft) /
              Math.max(1, el.clientWidth * (s.variant === 'cards' ? 0.85 : 1)),
          );
          if (i !== index && i < count) setIndex(i);
        }}
      >
        {s.slides.map((slide, i) => {
          const img = assetUrl(slug, slide.imageId);
          const title = text(slide.title);
          const subtitle = text(slide.subtitle);
          const button = text(slide.button);
          return (
            <div
              key={slide.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} / ${count}`}
              className={cn(
                'relative shrink-0 snap-start overflow-hidden',
                s.variant === 'cards' ? 'w-[85%] rounded-xl sm:w-[60%]' : 'w-full',
                s.variant === 'contained' && 'rounded-xl',
                tall,
              )}
            >
              {img ? (
                <img
                  src={img}
                  alt={title}
                  className="absolute inset-0 size-full object-cover"
                  loading={i === 0 ? 'eager' : 'lazy'}
                />
              ) : (
                <div
                  aria-hidden
                  className="absolute inset-0 bg-gradient-to-br from-primary to-primary-hover"
                />
              )}
              {title || subtitle || button ? (
                <div
                  className={cn(
                    'absolute inset-0 flex flex-col justify-end gap-2 p-5 text-white sm:p-10',
                    OVERLAY[s.overlay],
                    s.textAlign === 'center' && 'items-center justify-center text-center',
                  )}
                >
                  {title ? (
                    <p className="max-w-xl text-2xl font-bold sm:text-4xl">{title}</p>
                  ) : null}
                  {subtitle ? <p className="max-w-xl text-sm sm:text-base">{subtitle}</p> : null}
                  {button && slide.link ? (
                    <DesignAnchor link={slide.link} className={cn(cta('light'), 'mt-2 w-fit')}>
                      {button}
                    </DesignAnchor>
                  ) : null}
                </div>
              ) : slide.link ? (
                <DesignAnchor link={slide.link} className="absolute inset-0">
                  <span className="sr-only">{t('design.open')}</span>
                </DesignAnchor>
              ) : null}
            </div>
          );
        })}
      </div>
      {count > 1 ? (
        <div className="mt-3 flex justify-center gap-2">
          {s.slides.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              aria-label={t('design.goToSlide', { n: i + 1 })}
              aria-current={i === index}
              onClick={() => setIndex(i)}
              className={cn(
                'h-2 rounded-full transition-all',
                i === index ? 'w-6 bg-primary' : 'w-2 bg-border-strong',
              )}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------- banner
const BANNER_SHADE = {
  none: '',
  light: 'bg-gradient-to-t from-black/40 via-black/5 to-transparent',
  medium: 'bg-black/35',
  dark: 'bg-gradient-to-t from-black/70 via-black/20 to-transparent',
  gradient:
    'bg-gradient-to-tr from-black/75 via-[color-mix(in_oklch,var(--color-primary)_35%,transparent)] to-transparent',
} as const;
const BANNER_HEIGHT = {
  small: 'min-h-48 sm:min-h-64',
  medium: 'min-h-64 sm:min-h-96',
  large: 'min-h-80 sm:min-h-[32rem]',
  screen: 'min-h-[calc(100svh-4rem)]',
} as const;
const BANNER_TITLE = {
  regular: 'text-2xl sm:text-4xl',
  large: 'text-3xl sm:text-5xl',
  huge: 'text-4xl sm:text-7xl tracking-tight',
} as const;
const ROUNDED = { none: '', soft: 'rounded-xl', round: 'rounded-[2rem]' } as const;

function BannerSection({ s }: { s: SectionOf<'banner'> }) {
  const slug = useSlug();
  const { data: store } = useStorefront();
  const text = useText();
  const button = useStyledCta();
  const img =
    s.imageSource === 'store'
      ? (store?.bannerUrl ?? null)
      : s.imageSource === 'upload'
        ? assetUrl(slug, s.imageId)
        : null;
  const mobile = s.imageSource === 'upload' ? assetUrl(slug, s.mobileImageId) : null;
  const eyebrow = text(s.eyebrow);
  const title = text(s.title);
  const subtitle = text(s.subtitle);
  const label = text(s.button);
  const label2 = text(s.button2);
  const hasText = Boolean(eyebrow || title || subtitle || label || label2);
  if (!img && !hasText) return null;
  const testId = s.imageSource === 'store' ? 'store-banner' : undefined;
  const align = {
    start: 'items-start text-start',
    center: 'items-center text-center',
    end: 'items-end text-end',
  }[s.align];
  const words = (light: boolean, onColour = false) => (
    <div className={cn('flex flex-col gap-2', align)}>
      {eyebrow ? (
        <p
          className={cn(
            'text-xs font-bold uppercase tracking-[0.2em]',
            light || onColour ? 'opacity-90' : 'text-primary',
          )}
        >
          {eyebrow}
        </p>
      ) : null}
      {title ? <p className={cn('font-bold', BANNER_TITLE[s.titleSize])}>{title}</p> : null}
      {subtitle ? (
        <p
          className={cn(
            'max-w-xl text-sm sm:text-base',
            light ? 'text-white/90' : onColour ? 'opacity-90' : 'text-fg-muted',
          )}
        >
          {subtitle}
        </p>
      ) : null}
      {label || label2 ? (
        <div
          className={cn(
            'mt-2 flex flex-wrap gap-2',
            s.align === 'center' && 'justify-center',
            s.align === 'end' && 'justify-end',
          )}
        >
          {label ? (
            <DesignAnchor
              link={s.link}
              className={cn(
                onColour ? button('outline', false) : button(s.buttonStyle, light),
                'w-fit',
              )}
            >
              {label}
            </DesignAnchor>
          ) : null}
          {label2 ? (
            <DesignAnchor
              link={s.link2}
              className={cn(
                onColour
                  ? 'inline-flex min-h-11 items-center px-3 text-sm font-semibold underline-offset-4 hover:underline'
                  : button(s.buttonStyle, light, false),
                'w-fit',
              )}
            >
              {label2}
            </DesignAnchor>
          ) : null}
        </div>
      ) : null}
    </div>
  );
  // The picture, with another one for phones when chosen.
  const picture = (className: string) =>
    img ? (
      <picture className="contents">
        {mobile ? <source media="(max-width: 639px)" srcSet={mobile} /> : null}
        <img src={img} alt="" className={className} data-testid={testId} />
      </picture>
    ) : null;
  // The store's picture alone (the legacy banner).
  if (!hasText && img)
    return (
      <DesignAnchor link={s.link} className="block">
        {picture(cn('aspect-[3/1] w-full object-cover', ROUNDED[s.rounded] || 'rounded-none'))}
      </DesignAnchor>
    );
  if (s.variant === 'split')
    return (
      <section
        className={cn(
          'grid items-center gap-6 overflow-hidden bg-surface-muted sm:grid-cols-2',
          ROUNDED[s.rounded],
        )}
      >
        {picture('aspect-[4/3] size-full object-cover')}
        <div className="p-6 sm:p-10">{words(false)}</div>
      </section>
    );
  if (s.variant === 'color' || !img)
    return (
      <section className={cn('bg-primary p-8 text-primary-fg sm:p-12', ROUNDED[s.rounded])}>
        {words(false, true)}
      </section>
    );
  const position = {
    top: 'justify-start',
    center: 'justify-center',
    bottom: 'justify-end',
  }[s.position];
  const onCard = s.variant === 'card' || s.variant === 'glass';
  return (
    <section className={cn('relative isolate overflow-hidden', ROUNDED[s.rounded])}>
      {picture(cn('absolute inset-0 -z-10 size-full object-cover', s.zoom && 'store-zoom'))}
      <div
        className={cn(
          'relative flex flex-col p-6 sm:p-12',
          !onCard && 'text-white',
          BANNER_HEIGHT[s.height],
          position,
          !onCard && BANNER_SHADE[s.overlay],
          // Older centred banners keep their even shade.
          !onCard && s.align === 'center' && s.overlay !== 'none' && s.overlay !== 'medium'
            ? 'bg-black/40'
            : null,
          onCard && s.overlay !== 'none' && 'bg-black/20',
          s.align === 'center' && 'items-center',
          s.align === 'end' && 'items-end',
        )}
      >
        {onCard ? (
          <div
            className={cn(
              'max-w-xl rounded-2xl p-6 sm:p-8',
              s.variant === 'glass'
                ? 'border border-white/30 bg-white/15 text-white shadow-2xl backdrop-blur-xl'
                : 'bg-surface text-fg shadow-2xl',
            )}
            data-banner-card
          >
            {words(s.variant === 'glass')}
          </div>
        ) : (
          words(true)
        )}
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------- products
const lowestPrice = (p: StoreProduct) =>
  p.variants.map((v) => toMoney(v.price)).reduce((a, b) => (b.compare(a) < 0 ? b : a));

/** A one-tap "add" for products with a single option (null otherwise). */
function QuickAdd({ p, className }: { p: StoreProduct; className?: string }) {
  const cart = useCart();
  const name = useLocalName();
  const { t } = useTranslation();
  const single = p.variants.length === 1 ? p.variants[0]! : null;
  if (!single || !single.available) return null;
  return (
    <button
      type="button"
      aria-label={t('design.addOne', { name: name(p) })}
      onClick={(e) => {
        e.preventDefault();
        cart.add(
          { variantId: single.variantId, productId: p.productId, quantity: 1 },
          single.maxQuantity,
        );
      }}
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full bg-primary text-lg font-bold text-primary-fg shadow-md transition-transform hover:scale-105',
        className,
      )}
    >
      +
    </button>
  );
}

/** How product cards look in a section (ADR-0128 amendment 7). */
export type CardLook = {
  cardStyle: 'default' | 'minimal' | 'bordered' | 'soft' | 'overlay';
  aspect: 'square' | 'portrait' | 'landscape';
  hoverImage: boolean;
};
const DEFAULT_LOOK: CardLook = { cardStyle: 'default', aspect: 'square', hoverImage: false };
const ASPECT = { square: 'aspect-square', portrait: 'aspect-[4/5]', landscape: 'aspect-[4/3]' };

export function ProductCard({
  p,
  variant = 'grid',
  quickAdd = false,
  look = DEFAULT_LOOK,
}: {
  p: StoreProduct;
  variant?: 'grid' | 'list';
  quickAdd?: boolean;
  look?: CardLook;
}) {
  const slug = useSlug();
  const name = useLocalName();
  const money = useMoney();
  const card = useCard();
  const { t, i18n } = useTranslation();
  const available = p.variants.some((v) => v.available);
  const prices = p.variants.map((v) => toMoney(v.price));
  const lowest = lowestPrice(p);
  const varies = prices.some((m) => !m.equals(lowest));
  const price = varies ? t('catalog.from', { price: money(lowest) }) : money(lowest);
  const description = i18n.language.startsWith('ar')
    ? p.descriptionAr || p.descriptionEn
    : p.descriptionEn || p.descriptionAr;
  if (quickAdd)
    return (
      <div className="relative h-full">
        <ProductCard p={p} variant={variant} look={look} />
        <QuickAdd
          p={p}
          className={cn('absolute z-10', variant === 'list' ? 'bottom-3 end-3' : 'top-2 end-2')}
        />
      </div>
    );
  if (variant === 'list')
    return (
      <Link
        to={`/${slug}/products/${p.productId}`}
        className={cn('flex gap-3 overflow-hidden rounded-lg p-2 hover:border-primary', card)}
      >
        <div className="size-20 shrink-0 overflow-hidden rounded-md bg-surface-muted">
          {p.imageUrl ? (
            <img src={p.imageUrl} alt="" className="size-full object-cover" loading="lazy" />
          ) : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
          <p className="font-medium">{name(p)}</p>
          {description ? <p className="line-clamp-2 text-xs text-fg-muted">{description}</p> : null}
          <p className="mt-auto text-sm font-semibold tabular-nums">{price}</p>
          {!available ? <Badge tone="warning">{t('catalog.unavailable')}</Badge> : null}
        </div>
      </Link>
    );
  const second = look.hoverImage ? (p.images[1] ?? null) : null;
  const pictureBox = (
    <div className={cn('relative overflow-hidden bg-surface-muted', ASPECT[look.aspect])}>
      {p.imageUrl ? (
        <img
          src={p.imageUrl}
          alt=""
          className={cn(
            'size-full object-cover transition-all duration-500',
            second ? 'group-hover:opacity-0' : 'group-hover:scale-105',
          )}
          loading="lazy"
        />
      ) : null}
      {second ? (
        <img
          src={second}
          alt=""
          data-hover-image
          className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          loading="lazy"
        />
      ) : null}
    </div>
  );
  if (look.cardStyle === 'overlay')
    return (
      <Link
        to={`/${slug}/products/${p.productId}`}
        className="group relative flex h-full flex-col overflow-hidden rounded-lg"
        data-card="overlay"
      >
        {pictureBox}
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/75 to-transparent p-3 pt-10 text-white">
          <p className="font-semibold">{name(p)}</p>
          <p className="text-sm tabular-nums opacity-90">{price}</p>
          {!available ? <Badge tone="warning">{t('catalog.unavailable')}</Badge> : null}
        </div>
      </Link>
    );
  return (
    <Link
      to={`/${slug}/products/${p.productId}`}
      className={cn(
        'group flex h-full flex-col overflow-hidden rounded-lg',
        look.cardStyle === 'default' && cn(card, 'hover:border-primary'),
        look.cardStyle === 'bordered' && 'border-2 border-border bg-surface hover:border-primary',
        look.cardStyle === 'soft' && 'bg-surface-muted transition-transform hover:-translate-y-1',
        look.cardStyle === 'minimal' && 'bg-transparent',
      )}
      data-card={look.cardStyle}
    >
      <div className={cn(look.cardStyle === 'minimal' && 'overflow-hidden rounded-lg')}>
        {pictureBox}
      </div>
      <div
        className={cn(
          'flex flex-1 flex-col gap-1',
          look.cardStyle === 'minimal' ? 'px-0.5 py-2' : 'p-3',
        )}
      >
        <p className="font-medium">{name(p)}</p>
        <p className="text-sm tabular-nums text-fg-muted">{price}</p>
        {!available ? <Badge tone="warning">{t('catalog.unavailable')}</Badge> : null}
      </div>
    </Link>
  );
}

const COLS: Record<number, string> = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-3 lg:grid-cols-4',
};

export function ProductGrid({
  products,
  testId,
  columns = 4,
  variant = 'grid',
  quickAdd = false,
  look = DEFAULT_LOOK,
  mobileColumns = 2,
}: {
  products: StoreProduct[];
  testId?: string;
  columns?: number;
  variant?: 'grid' | 'list' | 'carousel';
  quickAdd?: boolean;
  look?: CardLook;
  mobileColumns?: 1 | 2;
}) {
  if (variant === 'carousel')
    return (
      <ul
        className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none]"
        data-testid={testId}
      >
        {products.map((p) => (
          <li key={p.productId} className="w-40 shrink-0 snap-start sm:w-52">
            <ProductCard p={p} quickAdd={quickAdd} look={look} />
          </li>
        ))}
      </ul>
    );
  return (
    <ul
      className={cn(
        'grid gap-3',
        variant === 'list'
          ? 'sm:grid-cols-2'
          : cn(mobileColumns === 1 ? 'grid-cols-1' : 'grid-cols-2', COLS[columns] ?? COLS[4]),
      )}
      data-testid={testId}
    >
      {products.map((p) => (
        <li key={p.productId}>
          <ProductCard
            p={p}
            variant={variant === 'list' ? 'list' : 'grid'}
            quickAdd={quickAdd}
            look={look}
          />
        </li>
      ))}
    </ul>
  );
}

function ProductsSection({ s }: { s: SectionOf<'products'> }) {
  const products = useStoreProducts();
  const text = useText();
  const slug = useSlug();
  const name = useLocalName();
  const { t } = useTranslation();
  if (!products.data) return null;
  const all = products.data.products;
  const chosen =
    s.source === 'featured'
      ? all.filter((p) => p.featured)
      : s.source === 'category'
        ? all.filter((p) => (s.categoryId ? inGroup(p, s.categoryId) : p.categoryId === null))
        : s.source === 'manual'
          ? s.productIds
              .map((id) => all.find((p) => p.productId === id))
              .filter((p): p is StoreProduct => Boolean(p))
          : all;
  const sorted =
    s.sort === 'position'
      ? chosen
      : [...chosen].sort((a, b) =>
          s.sort === 'name'
            ? name(a).localeCompare(name(b))
            : s.sort === 'priceAsc'
              ? lowestPrice(a).compare(lowestPrice(b))
              : lowestPrice(b).compare(lowestPrice(a)),
        );
  const shown = sorted.slice(0, s.limit);
  if (shown.length === 0) return null;
  const more =
    s.source === 'category' && s.categoryId
      ? `/${slug}/products?category=${s.categoryId}`
      : `/${slug}/products`;
  return (
    <section aria-label={text(s.title) || undefined}>
      <SectionTitle
        aside={
          s.showViewAll && (chosen.length > shown.length || s.variant === 'carousel') ? (
            <Link to={more} className="shrink-0 text-sm font-semibold text-primary hover:underline">
              {t('design.seeAll')}
            </Link>
          ) : undefined
        }
      >
        {text(s.title)}
      </SectionTitle>
      <ProductGrid
        products={shown}
        columns={s.columns}
        variant={s.variant}
        quickAdd={s.showAdd}
        look={s}
        mobileColumns={s.mobileColumns}
      />
    </section>
  );
}

// ------------------------------------------------------------------------- categories
function CategoriesSection({ s }: { s: SectionOf<'categories'> }) {
  const page = useContext(PageContext);
  const slug = useSlug();
  const { data: store } = useStorefront();
  const products = useStoreProducts();
  const name = useLocalName();
  const text = useText();
  const card = useCard();
  const { t } = useTranslation();
  if (!store) return null;
  const parentOf = (id: string) => store.categories.find((c) => c.id === id)?.parentId ?? null;
  // Chosen ids may name categories or collections; without a choice, the categories.
  const list: StoreGroup[] =
    s.categoryIds.length > 0
      ? s.categoryIds.map((id) => findGroup(store, id)).filter((c): c is StoreGroup => Boolean(c))
      : navGroups(store).filter((c) => !s.topOnly || !parentOf(c.id));
  // On the categories page an empty store says so; elsewhere the section just stays out.
  if (list.length === 0)
    return page === 'categories' ? <EmptyState title={t('design.noCategories')} /> : null;
  const to = (id: string) => `/${slug}/products?category=${id}`;
  const all = products.data?.products ?? [];
  // A category counts its own products and those of its subcategories.
  const familyOf = (id: string) => [
    id,
    ...store.categories.filter((c) => c.parentId === id).map((c) => c.id),
  ];
  const count = (id: string) => {
    const ids = familyOf(id);
    return all.filter((p) => ids.some((x) => inGroup(p, x))).length;
  };
  const children = (id: string) =>
    s.showSub ? store.categories.filter((c) => c.parentId === id) : [];
  const countLabel = (id: string) =>
    s.showCount && products.data ? t('design.productCount', { count: count(id) }) : null;
  const subLinks = (id: string, className?: string) => {
    const subs = children(id);
    if (subs.length === 0) return null;
    return (
      <ul
        className={cn('flex flex-wrap gap-1.5', className)}
        aria-label={t('design.subcategories')}
      >
        {subs.map((c) => (
          <li key={c.id}>
            <Link
              to={to(c.id)}
              className="inline-block rounded-full bg-surface-muted px-2.5 py-0.5 text-xs hover:text-primary"
            >
              {name(c)}
            </Link>
          </li>
        ))}
      </ul>
    );
  };
  const initial = (label: string) => (
    <span aria-hidden className="text-2xl font-bold text-primary">
      {label.slice(0, 1)}
    </span>
  );
  const phone = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' }[s.mobileColumns];
  const grid = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-3',
    4: 'sm:grid-cols-3 lg:grid-cols-4',
    5: 'sm:grid-cols-3 lg:grid-cols-5',
    6: 'sm:grid-cols-4 lg:grid-cols-6',
  }[s.columns];
  const ratio = { landscape: 'aspect-[4/3]', square: 'aspect-square', portrait: 'aspect-[3/4]' }[
    s.aspect
  ];
  const picture = (c: StoreGroup, className: string) =>
    c.imageUrl ? (
      <img
        src={c.imageUrl}
        alt=""
        className={cn(
          'size-full object-cover transition-transform duration-300',
          s.hover === 'zoom' && 'group-hover:scale-105',
          className,
        )}
      />
    ) : (
      <span className={cn('grid size-full place-items-center bg-primary-soft', className)}>
        {initial(name(c))}
      </span>
    );
  const lift = s.hover === 'lift' && 'transition-transform duration-300 hover:-translate-y-1';
  // A tile: the name over the picture, or under it.
  const tile = (c: StoreGroup) =>
    s.labelPosition === 'below' ? (
      <Link to={to(c.id)} className={cn('group flex flex-col gap-2', lift)}>
        <span className={cn('block overflow-hidden rounded-lg bg-surface-muted', ratio)}>
          {picture(c, '')}
        </span>
        <span className="text-sm font-semibold">
          {name(c)}
          {countLabel(c.id) ? (
            <span className="block text-xs font-normal text-fg-muted">{countLabel(c.id)}</span>
          ) : null}
        </span>
      </Link>
    ) : (
      <Link
        to={to(c.id)}
        className={cn('group relative block overflow-hidden rounded-lg', ratio, card, lift)}
      >
        <span className="absolute inset-0">{picture(c, '')}</span>
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 text-sm font-semibold text-white">
          {name(c)}
          {countLabel(c.id) ? (
            <span className="block text-xs font-normal opacity-90">{countLabel(c.id)}</span>
          ) : null}
        </span>
      </Link>
    );
  return (
    <section aria-label={text(s.title) || t('nav.categories')} data-variant={s.variant}>
      <SectionTitle
        aside={
          s.showViewAll && page !== 'categories' ? (
            <Link
              to={`/${slug}/categories`}
              className="shrink-0 text-sm font-semibold text-primary hover:underline"
            >
              {t('design.seeAll')}
            </Link>
          ) : undefined
        }
      >
        {text(s.title)}
      </SectionTitle>
      {s.variant === 'carousel' ? (
        <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
          {list.map((c) => (
            <li key={c.id} className="w-40 shrink-0 snap-start sm:w-56">
              {tile(c)}
            </li>
          ))}
        </ul>
      ) : s.variant === 'circles' ? (
        <ul className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
          {list.map((c) => (
            <li key={c.id} className="shrink-0">
              <Link
                to={to(c.id)}
                className="group flex w-20 flex-col items-center gap-2 text-center text-xs font-medium sm:w-24"
              >
                <span className="grid size-20 place-items-center overflow-hidden rounded-full bg-primary-soft ring-2 ring-transparent transition group-hover:ring-primary sm:size-24">
                  {picture(c, '')}
                </span>
                {name(c)}
                {countLabel(c.id) ? (
                  <span className="text-[11px] text-fg-muted">{countLabel(c.id)}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : s.variant === 'chips' ? (
        <ul className="flex flex-wrap gap-2">
          {list.map((c) => (
            <li key={c.id}>
              <Link
                to={to(c.id)}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-surface py-1 pe-4 ps-1 text-sm font-medium hover:border-primary"
              >
                {c.imageUrl ? (
                  <img src={c.imageUrl} alt="" className="size-7 rounded-full object-cover" />
                ) : (
                  <span className="w-2" aria-hidden />
                )}
                {name(c)}
                {s.showCount && products.data ? (
                  <span className="text-xs text-fg-muted">({count(c.id)})</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : s.variant === 'list' ? (
        <ul className={cn('divide-y divide-border overflow-hidden rounded-lg', card)}>
          {list.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 p-3">
              <Link to={to(c.id)} className="group flex items-center gap-3 hover:text-primary">
                <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-primary-soft">
                  {picture(c, '')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{name(c)}</span>
                  {countLabel(c.id) ? (
                    <span className="block text-xs text-fg-muted">{countLabel(c.id)}</span>
                  ) : null}
                </span>
                <span aria-hidden className="text-fg-subtle rtl:-scale-x-100">
                  ›
                </span>
              </Link>
              {subLinks(c.id, 'ps-15')}
            </li>
          ))}
        </ul>
      ) : s.variant === 'banners' ? (
        <ul className="flex flex-col gap-3">
          {list.map((c) => (
            <li key={c.id}>
              <Link
                to={to(c.id)}
                className="group relative flex aspect-[5/2] items-end overflow-hidden rounded-xl sm:aspect-[4/1]"
              >
                <span className="absolute inset-0">{picture(c, '')}</span>
                <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                <span className="relative flex w-full items-end justify-between gap-3 p-4 text-white">
                  <span>
                    <span className="block text-lg font-bold sm:text-2xl">{name(c)}</span>
                    {countLabel(c.id) ? (
                      <span className="block text-sm opacity-90">{countLabel(c.id)}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 rounded-full bg-white/90 px-4 py-1.5 text-sm font-semibold text-[#111]">
                    {t('design.shopNow')}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : s.variant === 'cards' ? (
        <ul className={cn('grid gap-3', phone, grid)}>
          {list.map((c) => (
            <li key={c.id} className={cn('flex flex-col overflow-hidden rounded-lg', card, lift)}>
              <Link to={to(c.id)} className="group flex flex-col">
                <span className={cn('block overflow-hidden bg-surface-muted', ratio)}>
                  {picture(c, '')}
                </span>
                <span className="flex flex-col gap-0.5 p-3">
                  <span className="font-semibold">{name(c)}</span>
                  {countLabel(c.id) ? (
                    <span className="text-xs text-fg-muted">{countLabel(c.id)}</span>
                  ) : null}
                </span>
              </Link>
              {subLinks(c.id, 'px-3 pb-3')}
            </li>
          ))}
        </ul>
      ) : (
        <ul className={cn('grid gap-3', phone, grid)}>
          {list.map((c) => (
            <li key={c.id} className="flex flex-col gap-2">
              {tile(c)}
              {subLinks(c.id)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- image, video, text
function ImageSection({ s }: { s: SectionOf<'image'> }) {
  const slug = useSlug();
  const text = useText();
  const img = assetUrl(slug, s.imageId);
  if (!img) return null;
  const aspect = { wide: 'aspect-[21/9]', square: 'aspect-square', tall: 'aspect-[3/4]', auto: '' }[
    s.aspect
  ];
  const picture = (
    <img
      src={img}
      alt={text(s.alt)}
      className={cn('w-full object-cover', aspect, s.variant === 'contained' && 'rounded-xl')}
      loading="lazy"
    />
  );
  return (
    <figure className={cn(s.variant === 'full' && full)}>
      {s.link ? (
        <DesignAnchor link={s.link} className="block">
          {picture}
        </DesignAnchor>
      ) : (
        picture
      )}
    </figure>
  );
}

function VideoSection({ s }: { s: SectionOf<'video'> }) {
  const text = useText();
  const { t } = useTranslation();
  const embed = s.url ? videoEmbed(s.url) : null;
  if (!embed) return null;
  const title = text(s.title);
  return (
    <section className={cn(s.variant === 'full' && full)}>
      <SectionTitle>{title}</SectionTitle>
      <div
        className={cn(
          'overflow-hidden bg-black',
          s.variant === 'contained' && 'rounded-xl',
          s.aspect === 'portrait' ? 'mx-auto aspect-[9/16] max-w-sm' : 'aspect-video',
        )}
      >
        <iframe
          src={embed.src}
          title={title || t('design.video')}
          className="size-full"
          loading="lazy"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
          data-testid="video-embed"
        />
      </div>
    </section>
  );
}

function TextSection({ s }: { s: SectionOf<'text'> }) {
  const text = useText();
  const card = useCard();
  const cta = useCta();
  const title = text(s.title);
  const body = text(s.body);
  const button = text(s.button);
  if (!title && !body) return null;
  return (
    <section
      className={cn(
        'flex flex-col gap-2',
        s.align === 'center' && 'items-center text-center',
        s.variant === 'card' && cn('rounded-xl p-6', card),
        s.variant === 'highlight' && 'rounded-xl bg-primary-soft p-6',
      )}
    >
      {title ? <h2 className="text-xl font-bold">{title}</h2> : null}
      {body ? <p className="max-w-3xl whitespace-pre-line text-fg-muted">{body}</p> : null}
      {button && s.link ? (
        <DesignAnchor link={s.link} className={cn(cta('primary'), 'mt-2 w-fit')}>
          {button}
        </DesignAnchor>
      ) : null}
    </section>
  );
}

const ICON_BOX = { small: 'size-9 text-lg', regular: 'size-11 text-xl', large: 'size-16 text-3xl' };

function FeaturesSection({ s }: { s: SectionOf<'features'> }) {
  const text = useText();
  const card = useCard();
  if (s.items.length === 0) return null;
  const stacked = s.align === 'center' || (s.align === 'auto' && s.variant === 'grid');
  const columns =
    s.columns === 0
      ? 'grid-cols-2 lg:grid-cols-3'
      : {
          2: 'grid-cols-1 sm:grid-cols-2',
          3: 'grid-cols-2 lg:grid-cols-3',
          4: 'grid-cols-2 lg:grid-cols-4',
        }[s.columns];
  return (
    <section aria-label={text(s.title) || undefined}>
      <SectionTitle>{text(s.title)}</SectionTitle>
      <ul
        className={cn(
          s.variant === 'list' ? 'flex flex-col divide-y divide-border' : 'grid gap-3',
          s.variant === 'row' && 'grid-cols-1 sm:grid-flow-col sm:auto-cols-fr',
          (s.variant === 'grid' || s.variant === 'cards') && columns,
        )}
      >
        {s.items.map((f) => {
          const body = (
            <>
              {f.icon ? (
                <span
                  aria-hidden
                  data-icon-style={s.iconStyle}
                  className={cn(
                    'grid shrink-0 place-items-center',
                    s.iconStyle !== 'plain' && ICON_BOX[s.iconSize],
                    s.iconStyle === 'plain' &&
                      { small: 'text-xl', regular: 'text-3xl', large: 'text-5xl' }[s.iconSize],
                    s.iconStyle === 'circle' && 'rounded-full bg-surface',
                    s.iconStyle === 'square' && 'rounded-xl bg-primary text-primary-fg',
                    s.iconStyle === 'outline' && 'rounded-full border-2 border-primary',
                  )}
                >
                  {f.icon}
                </span>
              ) : null}
              <span className="min-w-0">
                <span className="block font-semibold">{text(f.title)}</span>
                {text(f.text) ? (
                  <span className="block text-sm text-fg-muted">{text(f.text)}</span>
                ) : null}
              </span>
            </>
          );
          const box = cn(
            'flex items-center gap-3',
            s.variant === 'list' ? 'py-3' : 'rounded-lg p-4',
            s.variant === 'cards' ? card : s.variant !== 'list' && 'bg-surface-muted',
            stacked && 'flex-col text-center',
          );
          return (
            <li key={f.id}>
              {f.link ? (
                <DesignAnchor link={f.link} className={cn(box, 'h-full hover:text-primary')}>
                  {body}
                </DesignAnchor>
              ) : (
                <div className={cn(box, 'h-full')}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------- restaurant menu
function MenuSection({ s }: { s: SectionOf<'menu'> }) {
  const { data: store } = useStorefront();
  const products = useStoreProducts();
  const name = useLocalName();
  const text = useText();
  const money = useMoney();
  const cart = useCart();
  const card = useCard();
  const { t, i18n } = useTranslation();
  const [active, setActive] = useState<string | null>(null);
  if (!store || !products.data)
    return products.isPending ? <Spinner label={t('common:status.loading')} /> : null;
  const all = products.data.products;
  const categories = (
    s.categoryIds.length > 0 ? s.categoryIds.map((id) => findGroup(store, id)) : navGroups(store)
  )
    .filter((c): c is StoreGroup => Boolean(c))
    .map((c) => ({ ...c, items: all.filter((p) => inGroup(p, c.id)) }))
    .filter((c) => c.items.length > 0);
  const others =
    s.categoryIds.length > 0
      ? []
      : all.filter((p) => !navGroups(store).some((c) => inGroup(p, c.id)));
  const groups = [
    ...categories,
    ...(others.length > 0
      ? [
          {
            id: 'other',
            nameEn: t('design.other'),
            nameAr: t('design.other'),
            imageUrl: null,
            items: others,
          },
        ]
      : []),
  ];
  if (groups.length === 0) return <EmptyState title={t('catalog.empty')} />;
  const ar = i18n.language.startsWith('ar');
  return (
    <section aria-label={text(s.title) || t('nav.menu')}>
      <SectionTitle>{text(s.title)}</SectionTitle>
      {groups.length > 1 ? (
        <nav
          aria-label={t('design.menuCategories')}
          className={cn(
            '-mx-4 mb-4 flex gap-2 overflow-x-auto bg-canvas/95 px-4 py-2 backdrop-blur [scrollbar-width:none]',
            s.stickyTabs && 'sticky top-16 z-20',
          )}
        >
          {groups.map((g) => (
            <a
              key={g.id}
              href={`#menu-${s.id}-${g.id}`}
              onClick={() => setActive(g.id)}
              className={cn(
                'shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium whitespace-nowrap',
                active === g.id
                  ? 'border-primary bg-primary text-primary-fg'
                  : 'border-border bg-surface',
              )}
            >
              {name(g)}
            </a>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-col gap-8">
        {groups.map((g) => (
          <div key={g.id} id={`menu-${s.id}-${g.id}`} className="scroll-mt-32">
            <h3 className="mb-3 text-lg font-bold">{name(g)}</h3>
            <ul
              className={cn(
                'grid gap-3',
                s.variant === 'grid'
                  ? 'grid-cols-2 sm:grid-cols-3'
                  : s.variant === 'compact'
                    ? ''
                    : 'sm:grid-cols-2',
              )}
            >
              {g.items.map((p) => {
                const single = p.variants.length === 1 ? p.variants[0]! : null;
                const description = ar
                  ? p.descriptionAr || p.descriptionEn
                  : p.descriptionEn || p.descriptionAr;
                const available = p.variants.some((v) => v.available);
                const lowest = lowestPrice(p);
                const add =
                  single && single.available ? (
                    <button
                      type="button"
                      aria-label={t('design.addOne', { name: name(p) })}
                      onClick={(e) => {
                        e.preventDefault();
                        cart.add(
                          { variantId: single.variantId, productId: p.productId, quantity: 1 },
                          single.maxQuantity,
                        );
                      }}
                      className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-lg font-bold text-primary-fg shadow"
                    >
                      +
                    </button>
                  ) : null;
                if (s.variant === 'compact')
                  return (
                    <li
                      key={p.productId}
                      className="flex items-center gap-3 border-b border-dashed border-border py-2"
                    >
                      <Link
                        to={`/${store.slug}/products/${p.productId}`}
                        className="min-w-0 flex-1 font-medium hover:underline"
                      >
                        {name(p)}
                      </Link>
                      <span className="tabular-nums text-fg-muted">{money(lowest)}</span>
                      {add}
                    </li>
                  );
                return (
                  <li
                    key={p.productId}
                    className={cn(
                      'relative overflow-hidden rounded-lg',
                      card,
                      s.variant === 'grid' ? 'flex flex-col' : 'flex gap-3 p-3',
                    )}
                  >
                    {s.showImages ? (
                      <div
                        className={cn(
                          'overflow-hidden bg-surface-muted',
                          s.variant === 'grid' ? 'aspect-square' : 'size-24 shrink-0 rounded-md',
                        )}
                      >
                        {p.imageUrl ? (
                          <img
                            src={p.imageUrl}
                            alt=""
                            className="size-full object-cover"
                            loading="lazy"
                          />
                        ) : null}
                      </div>
                    ) : null}
                    <div
                      className={cn(
                        'flex min-w-0 flex-1 flex-col gap-1',
                        s.variant === 'grid' && 'p-3',
                      )}
                    >
                      <Link
                        to={`/${store.slug}/products/${p.productId}`}
                        className="font-semibold after:absolute after:inset-0"
                      >
                        {name(p)}
                      </Link>
                      {s.showDescriptions && description ? (
                        <p className="line-clamp-2 text-xs text-fg-muted">{description}</p>
                      ) : null}
                      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                        <span className="font-semibold tabular-nums">
                          {p.variants.length > 1
                            ? t('catalog.from', { price: money(lowest) })
                            : money(lowest)}
                        </span>
                        {!available ? (
                          <Badge tone="warning">{t('catalog.unavailable')}</Badge>
                        ) : (
                          <span className="relative z-10">{add}</span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// -------------------------------------------------------------------------- store info
function InfoSection({ s }: { s: SectionOf<'info'> }) {
  const { data: store } = useStorefront();
  const { branch } = useBranchChoice();
  const name = useLocalName();
  const money = useMoney();
  const card = useCard();
  const { t } = useTranslation();
  if (!store || !branch) return null;
  const today = WEEKDAYS[(new Date().getDay() + 6) % 7]!;
  const hoursToday = branch.hours ? branch.hours[today] : null;
  const items: { key: string; icon: string; label: string; value: string }[] = [];
  if (s.showHours)
    items.push({
      key: 'open',
      icon: branch.openNow ? '🟢' : '🔴',
      label: branch.openNow ? t('info.openNow') : t('info.closedNow'),
      value:
        hoursToday === null
          ? t('info.alwaysOpen')
          : hoursToday.length === 0
            ? t('info.closedDay')
            : hoursToday.map((r) => `${r.open}–${r.close}`).join(', '),
    });
  if (s.showDelivery) {
    if (branch.preparationMinutes > 0)
      items.push({
        key: 'prep',
        icon: '⏱️',
        label: t('info.ready'),
        value: t('info.minutes', { count: branch.preparationMinutes }),
      });
    if (store.deliveryEnabled)
      items.push({
        key: 'delivery',
        icon: '🛵',
        label: t('info.delivery'),
        value: store.deliveryAreas.length > 0 ? t('info.byArea') : money(store.deliveryFee),
      });
    if (store.pickupEnabled)
      items.push({
        key: 'pickup',
        icon: '🛍️',
        label: t('info.pickup'),
        value: t('info.available'),
      });
    if (!toMoney(store.minimumOrder).isZero())
      items.push({
        key: 'min',
        icon: '🧾',
        label: t('info.minimum'),
        value: money(store.minimumOrder),
      });
  }
  if (s.showContact && store.contactPhone)
    items.push({ key: 'phone', icon: '📞', label: t('info.call'), value: store.contactPhone });
  return (
    <section aria-label={t('info.title')} className="flex flex-col gap-3">
      {items.length > 0 ? (
        <ul
          className={cn(
            s.variant === 'strip'
              ? '-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]'
              : 'grid grid-cols-2 gap-3 sm:grid-cols-4',
          )}
        >
          {items.map((i) => (
            <li
              key={i.key}
              className={cn(
                'flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm',
                s.variant === 'strip'
                  ? 'bg-surface-muted'
                  : cn('flex-col rounded-lg p-4 text-center', card),
              )}
            >
              <span aria-hidden>{i.icon}</span>
              <span className="font-semibold">{i.label}</span>
              <span className="text-fg-muted" dir="auto">
                {i.value}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {s.showBranches && store.branches.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {store.branches.map((b) => (
            <li key={b.id} className={cn('rounded-lg p-4 text-sm', card)}>
              <p className="font-semibold">{name(b)}</p>
              {b.address ? <p className="text-fg-muted">{b.address}</p> : null}
              {b.phone ? (
                <a href={`tel:${b.phone}`} dir="ltr" className="text-primary hover:underline">
                  {b.phone}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------- catalog
/** Search, sort and category filter over every product (the legacy catalog page). */
export function CatalogSection({ s }: { s: SectionOf<'catalog'> }) {
  const { data: store } = useStorefront();
  const products = useStoreProducts();
  const name = useLocalName();
  const text = useText();
  const { t } = useTranslation();
  const [pages, setPages] = useState(1);
  const [params] = useSearchParams();
  const [category, setCategory] = useState<string | null>(params.get('category'));
  // The header's search bar opens this page with `?q=`.
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [sort, setSort] = useState<'default' | 'name' | 'priceAsc' | 'priceDesc'>(s.defaultSort);
  const wantsSearch = params.get('search') === '1';
  useEffect(() => {
    if (wantsSearch) document.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
  }, [wantsSearch]);
  // A link to another category of the same page (drawer, footer) changes the filter.
  const fromUrl = params.get('category');
  const query = params.get('q');
  const [seen, setSeen] = useState(fromUrl);
  const [seenQuery, setSeenQuery] = useState(query);
  if (seenQuery !== query) {
    setSeenQuery(query);
    setSearch(query ?? '');
  }
  if (seen !== fromUrl) {
    setSeen(fromUrl);
    setCategory(fromUrl);
  }

  if (products.isPending) return <Spinner label={t('common:status.loading')} />;
  if (products.isError)
    return <ErrorState error={products.error} onRetry={() => void products.refetch()} />;

  const term = search.trim().toLowerCase();
  const sorted = [...products.data.products].sort((a, b) => {
    if (sort === 'name') return name(a).localeCompare(name(b));
    if (sort === 'priceAsc') return lowestPrice(a).compare(lowestPrice(b));
    if (sort === 'priceDesc') return lowestPrice(b).compare(lowestPrice(a));
    return a.position - b.position;
  });
  const visible = sorted.filter(
    (p) =>
      (!category || inGroup(p, category)) &&
      (!term || `${p.nameEn ?? ''} ${p.nameAr ?? ''}`.toLowerCase().includes(term)),
  );
  // Featured products open the page while nothing is filtered (ADR-0121).
  const featured = s.showFeatured && !category && !term ? visible.filter((p) => p.featured) : [];
  // The buttons are the store's sections (its categories). A special list (collection) is not a
  // button of its own (ADR-0130 amendment 1); one opened from a link is shown while it is chosen.
  const all = products.data.products;
  const groups = navGroups(store).filter((c) => all.some((p) => inGroup(p, c.id)));
  const chosen = category && store ? findGroup(store, category) : undefined;
  const categories: StoreGroup[] =
    chosen && !groups.some((c) => c.id === chosen.id) ? [...groups, chosen] : groups;

  if (products.data.products.length === 0) return <EmptyState title={t('catalog.empty')} />;
  const options = [
    { id: null, label: t('catalog.all'), imageUrl: null },
    ...categories.map((c) => ({ id: c.id, label: name(c), imageUrl: c.imageUrl })),
  ] as { id: string | null; label: string; imageUrl: string | null }[];
  const choose = (id: string | null) => {
    setCategory(id);
    setPages(1);
  };
  const filters =
    s.showCategories && categories.length > 0 ? (
      s.filterStyle === 'dropdown' ? (
        <Select
          aria-label={t('catalog.category')}
          className="w-48"
          value={category ?? ''}
          onChange={(e) => choose(e.target.value || null)}
        >
          {options.map((c) => (
            <option key={c.id ?? 'all'} value={c.id ?? ''}>
              {c.label}
            </option>
          ))}
        </Select>
      ) : (
        <div
          className={cn(
            'flex gap-2',
            s.filterStyle === 'tabs'
              ? '-mb-px w-full overflow-x-auto border-b border-border [scrollbar-width:none]'
              : 'flex-wrap',
          )}
          role="group"
          data-filter-style={s.filterStyle}
        >
          {options.map((c) =>
            s.filterStyle === 'tabs' ? (
              <button
                key={c.id ?? 'all'}
                type="button"
                aria-pressed={category === c.id}
                onClick={() => choose(c.id)}
                className="shrink-0 border-b-2 border-transparent px-3 py-2 text-sm font-semibold text-fg-muted aria-pressed:border-primary aria-pressed:text-fg"
              >
                {c.label}
              </button>
            ) : (
              <button
                key={c.id ?? 'all'}
                type="button"
                aria-pressed={category === c.id}
                onClick={() => choose(c.id)}
                className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pe-3 ps-1 text-sm aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-fg"
              >
                {c.imageUrl ? (
                  <img src={c.imageUrl} alt="" className="size-6 rounded-full object-cover" />
                ) : (
                  <span className="w-2" aria-hidden />
                )}
                {c.label}
              </button>
            ),
          )}
        </div>
      )
    ) : null;
  const perPage = s.pageSize === 0 ? visible.length : s.pageSize;
  const page = visible.slice(0, perPage * pages);
  return (
    <div className="flex flex-col gap-4">
      {s.showSearch || s.showSort || filters ? (
        <div
          className={cn(
            'flex flex-wrap items-center gap-2',
            s.stickyFilters &&
              'sticky top-[var(--store-header-h,0px)] z-10 -mx-4 bg-canvas/90 px-4 py-2 backdrop-blur-md',
          )}
          data-sticky-filters={s.stickyFilters || undefined}
        >
          {s.showSearch ? (
            <Input
              type="search"
              aria-label={t('catalog.search')}
              placeholder={text(s.searchPlaceholder) || t('catalog.search')}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPages(1);
              }}
              className="max-w-xs"
            />
          ) : null}
          {s.showSort ? (
            <Select
              aria-label={t('catalog.sort')}
              className="w-44"
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
            >
              {(['default', 'name', 'priceAsc', 'priceDesc'] as const).map((o) => (
                <option key={o} value={o}>
                  {t(`catalog.sort_${o}`)}
                </option>
              ))}
            </Select>
          ) : null}
          {filters}
        </div>
      ) : null}
      {featured.length > 0 ? (
        <section aria-label={t('catalog.featured')} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t('catalog.featured')}</h2>
          <ProductGrid
            products={featured}
            testId="featured-grid"
            columns={s.columns}
            look={s}
            mobileColumns={s.mobileColumns}
            quickAdd={s.showAdd}
          />
        </section>
      ) : null}
      {s.showCount ? (
        <p className="text-sm text-fg-muted" data-testid="catalog-count">
          {t('design.productCount', { count: visible.length })}
        </p>
      ) : null}
      {visible.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('design.noMatch')}</p>
      ) : (
        <ProductGrid
          products={page}
          testId="product-grid"
          columns={s.columns}
          variant={s.variant}
          look={s}
          mobileColumns={s.mobileColumns}
          quickAdd={s.showAdd}
        />
      )}
      {page.length < visible.length ? (
        <button
          type="button"
          onClick={() => setPages((n) => n + 1)}
          className="mx-auto rounded-full border border-border bg-surface px-6 py-2.5 text-sm font-semibold hover:border-primary"
        >
          {t('design.showMore', { count: visible.length - page.length })}
        </button>
      ) : null}
    </div>
  );
}

/** Where a design link points, for components that need the address itself. */
export function useLinkTo() {
  const slug = useSlug();
  return (link: Parameters<typeof linkTarget>[1]) => linkTarget(slug, link);
}
