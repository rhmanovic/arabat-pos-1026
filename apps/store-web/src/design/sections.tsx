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
import { Link, useSearchParams } from 'react-router';
import { toMoney, useCart } from '../cart.js';
import {
  useBranchChoice,
  useLocalName,
  useMoney,
  useSlug,
  useStoreProducts,
  useStorefront,
} from '../shared.js';
import { DesignAnchor } from './parts.js';
import { assetUrl, linkTarget, useCard, useCta, useDesign, useText } from './context.js';

/** One designed page (home, products or categories): its visible sections in order. */
/** The designed page a section is drawn on. */
const PageContext = createContext<DesignPage>('home');

export function DesignedPage({ page }: { page: DesignPage }) {
  const design = useDesign();
  const sections = design.pages[page].filter((s) => s.visible);
  return (
    <PageContext.Provider value={page}>
      <div className="flex flex-col gap-8" data-page={page}>
        {sections.map((s) => (
          <div key={s.id} id={`section-${s.id}`} data-section={s.type} className="scroll-mt-20">
            <Section section={s} />
          </div>
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
  }
}

function SectionTitle({ children }: { children: string }) {
  if (!children) return null;
  return <h2 className="mb-3 text-xl font-bold">{children}</h2>;
}

/** A section that bleeds to the screen edges ("full" variants). */
const full = 'relative start-1/2 w-screen max-w-none -translate-x-1/2 rtl:translate-x-1/2';

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
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), 5000);
    return () => clearInterval(timer);
  }, [s.autoplay, count]);
  useEffect(() => {
    const el = track.current;
    const slide = el?.children[index] as HTMLElement | undefined;
    if (el && slide) el.scrollTo?.({ left: slide.offsetLeft - el.offsetLeft, behavior: 'smooth' });
  }, [index]);
  if (count === 0) return null;
  const tall =
    s.variant === 'full' ? 'aspect-[4/5] sm:aspect-[21/8]' : 'aspect-[4/3] sm:aspect-[21/8]';
  return (
    <section
      aria-roledescription="carousel"
      aria-label={t('design.slider')}
      className={cn(s.variant === 'full' && full)}
    >
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
                <div className="absolute inset-0 flex flex-col justify-end gap-2 bg-gradient-to-t from-black/60 via-black/10 to-transparent p-5 text-white sm:p-10">
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
function BannerSection({ s }: { s: SectionOf<'banner'> }) {
  const slug = useSlug();
  const { data: store } = useStorefront();
  const text = useText();
  const cta = useCta();
  const img =
    s.imageSource === 'store'
      ? (store?.bannerUrl ?? null)
      : s.imageSource === 'upload'
        ? assetUrl(slug, s.imageId)
        : null;
  const title = text(s.title);
  const subtitle = text(s.subtitle);
  const button = text(s.button);
  const hasText = Boolean(title || subtitle || button);
  if (!img && !hasText) return null;
  const testId = s.imageSource === 'store' ? 'store-banner' : undefined;
  const words = (light: boolean) => (
    <div className={cn('flex flex-col gap-2', s.align === 'center' && 'items-center text-center')}>
      {title ? <p className="text-2xl font-bold sm:text-4xl">{title}</p> : null}
      {subtitle ? (
        <p
          className={cn('max-w-xl text-sm sm:text-base', light ? 'text-white/90' : 'text-fg-muted')}
        >
          {subtitle}
        </p>
      ) : null}
      {button ? (
        <DesignAnchor link={s.link} className={cn(cta(light ? 'light' : 'primary'), 'mt-2 w-fit')}>
          {button}
        </DesignAnchor>
      ) : null}
    </div>
  );
  // The store's picture alone (the legacy banner).
  if (!hasText && img)
    return (
      <DesignAnchor link={s.link} className="block">
        <img
          src={img}
          alt=""
          className="aspect-[3/1] w-full rounded-lg object-cover"
          data-testid={testId}
        />
      </DesignAnchor>
    );
  if (s.variant === 'split')
    return (
      <section className="grid items-center gap-6 overflow-hidden rounded-xl bg-surface-muted sm:grid-cols-2">
        {img ? (
          <img
            src={img}
            alt=""
            className="aspect-[4/3] size-full object-cover"
            data-testid={testId}
          />
        ) : null}
        <div className="p-6">{words(false)}</div>
      </section>
    );
  if (s.variant === 'color' || !img)
    return (
      <section className="rounded-xl bg-primary p-8 text-primary-fg sm:p-12">
        <div
          className={cn('flex flex-col gap-2', s.align === 'center' && 'items-center text-center')}
        >
          {title ? <p className="text-2xl font-bold sm:text-4xl">{title}</p> : null}
          {subtitle ? <p className="max-w-xl text-sm opacity-90 sm:text-base">{subtitle}</p> : null}
          {button ? (
            <DesignAnchor link={s.link} className={cn(cta('outline'), 'mt-2 w-fit')}>
              {button}
            </DesignAnchor>
          ) : null}
        </div>
      </section>
    );
  return (
    <section className="relative overflow-hidden rounded-xl">
      <img
        src={img}
        alt=""
        className="absolute inset-0 size-full object-cover"
        data-testid={testId}
      />
      <div
        className={cn(
          'relative flex min-h-64 flex-col justify-end bg-gradient-to-t from-black/65 via-black/20 to-transparent p-6 text-white sm:min-h-96 sm:p-12',
          s.align === 'center' && 'justify-center bg-black/40',
        )}
      >
        {words(true)}
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------- products
const lowestPrice = (p: StoreProduct) =>
  p.variants.map((v) => toMoney(v.price)).reduce((a, b) => (b.compare(a) < 0 ? b : a));

export function ProductCard({
  p,
  variant = 'grid',
}: {
  p: StoreProduct;
  variant?: 'grid' | 'list';
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
  return (
    <Link
      to={`/${slug}/products/${p.productId}`}
      className={cn(
        'group flex h-full flex-col overflow-hidden rounded-lg hover:border-primary',
        card,
      )}
    >
      <div className="aspect-square overflow-hidden bg-surface-muted">
        {p.imageUrl ? (
          <img
            src={p.imageUrl}
            alt=""
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="font-medium">{name(p)}</p>
        <p className="text-sm tabular-nums text-fg-muted">{price}</p>
        {!available ? <Badge tone="warning">{t('catalog.unavailable')}</Badge> : null}
      </div>
    </Link>
  );
}

const COLS: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4',
};

export function ProductGrid({
  products,
  testId,
  columns = 4,
  variant = 'grid',
}: {
  products: StoreProduct[];
  testId?: string;
  columns?: number;
  variant?: 'grid' | 'list' | 'carousel';
}) {
  if (variant === 'carousel')
    return (
      <ul
        className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none]"
        data-testid={testId}
      >
        {products.map((p) => (
          <li key={p.productId} className="w-40 shrink-0 snap-start sm:w-52">
            <ProductCard p={p} />
          </li>
        ))}
      </ul>
    );
  return (
    <ul
      className={cn(
        'grid gap-3',
        variant === 'list' ? 'sm:grid-cols-2' : (COLS[columns] ?? COLS[4]),
      )}
      data-testid={testId}
    >
      {products.map((p) => (
        <li key={p.productId}>
          <ProductCard p={p} variant={variant === 'list' ? 'list' : 'grid'} />
        </li>
      ))}
    </ul>
  );
}

function ProductsSection({ s }: { s: SectionOf<'products'> }) {
  const products = useStoreProducts();
  const text = useText();
  const slug = useSlug();
  const { t } = useTranslation();
  if (!products.data) return null;
  const all = products.data.products;
  const chosen =
    s.source === 'featured'
      ? all.filter((p) => p.featured)
      : s.source === 'category'
        ? all.filter((p) => p.categoryId === s.categoryId)
        : s.source === 'manual'
          ? s.productIds
              .map((id) => all.find((p) => p.productId === id))
              .filter((p): p is StoreProduct => Boolean(p))
          : all;
  const shown = chosen.slice(0, s.limit);
  if (shown.length === 0) return null;
  const more =
    s.source === 'category' && s.categoryId
      ? `/${slug}/products?category=${s.categoryId}`
      : `/${slug}/products`;
  return (
    <section aria-label={text(s.title) || undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <SectionTitle>{text(s.title)}</SectionTitle>
        {chosen.length > shown.length || s.variant === 'carousel' ? (
          <Link to={more} className="text-sm font-medium text-primary hover:underline">
            {t('design.seeAll')}
          </Link>
        ) : null}
      </div>
      <ProductGrid products={shown} columns={s.columns} variant={s.variant} />
    </section>
  );
}

// ------------------------------------------------------------------------- categories
function CategoriesSection({ s }: { s: SectionOf<'categories'> }) {
  const page = useContext(PageContext);
  const slug = useSlug();
  const { data: store } = useStorefront();
  const name = useLocalName();
  const text = useText();
  const card = useCard();
  const { t } = useTranslation();
  if (!store) return null;
  const all = store.categories;
  const list =
    s.categoryIds.length > 0
      ? s.categoryIds
          .map((id) => all.find((c) => c.id === id))
          .filter((c): c is (typeof all)[number] => Boolean(c))
      : all;
  // On the categories page an empty store says so; elsewhere the section just stays out.
  if (list.length === 0)
    return page === 'categories' ? <EmptyState title={t('design.noCategories')} /> : null;
  const to = (id: string) => `/${slug}/products?category=${id}`;
  const initial = (label: string) => (
    <span aria-hidden className="text-2xl font-bold text-primary">
      {label.slice(0, 1)}
    </span>
  );
  return (
    <section aria-label={text(s.title) || t('nav.categories')}>
      <SectionTitle>{text(s.title)}</SectionTitle>
      {s.variant === 'circles' ? (
        <ul className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
          {list.map((c) => (
            <li key={c.id} className="shrink-0">
              <Link
                to={to(c.id)}
                className="flex w-20 flex-col items-center gap-2 text-center text-xs font-medium sm:w-24"
              >
                <span className="grid size-20 place-items-center overflow-hidden rounded-full bg-primary-soft ring-2 ring-transparent transition hover:ring-primary sm:size-24">
                  {c.imageUrl ? (
                    <img src={c.imageUrl} alt="" className="size-full object-cover" />
                  ) : (
                    initial(name(c))
                  )}
                </span>
                {name(c)}
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
              </Link>
            </li>
          ))}
        </ul>
      ) : s.variant === 'list' ? (
        <ul className={cn('divide-y divide-border overflow-hidden rounded-lg', card)}>
          {list.map((c) => (
            <li key={c.id}>
              <Link to={to(c.id)} className="flex items-center gap-3 p-3 hover:bg-surface-muted">
                <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-primary-soft">
                  {c.imageUrl ? (
                    <img src={c.imageUrl} alt="" className="size-full object-cover" />
                  ) : (
                    initial(name(c))
                  )}
                </span>
                <span className="flex-1 font-medium">{name(c)}</span>
                <span aria-hidden className="text-fg-subtle rtl:-scale-x-100">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((c) => (
            <li key={c.id}>
              <Link
                to={to(c.id)}
                className={cn('group relative block aspect-[4/3] overflow-hidden rounded-lg', card)}
              >
                {c.imageUrl ? (
                  <img
                    src={c.imageUrl}
                    alt=""
                    className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <span className="absolute inset-0 grid place-items-center bg-primary-soft">
                    {initial(name(c))}
                  </span>
                )}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 text-sm font-semibold text-white">
                  {name(c)}
                </span>
              </Link>
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
  const title = text(s.title);
  const body = text(s.body);
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
    </section>
  );
}

function FeaturesSection({ s }: { s: SectionOf<'features'> }) {
  const text = useText();
  const card = useCard();
  if (s.items.length === 0) return null;
  return (
    <ul
      className={cn(
        'grid gap-3',
        s.variant === 'row'
          ? 'grid-cols-1 sm:grid-flow-col sm:auto-cols-fr'
          : 'grid-cols-2 lg:grid-cols-3',
      )}
    >
      {s.items.map((f) => (
        <li
          key={f.id}
          className={cn(
            'flex items-center gap-3 rounded-lg p-4',
            s.variant === 'cards' ? card : 'bg-surface-muted',
            s.variant === 'grid' && 'flex-col text-center',
          )}
        >
          {f.icon ? (
            <span
              aria-hidden
              className="grid size-11 shrink-0 place-items-center rounded-full bg-surface text-xl"
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
        </li>
      ))}
    </ul>
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
    s.categoryIds.length > 0
      ? s.categoryIds.map((id) => store.categories.find((c) => c.id === id))
      : store.categories
  )
    .filter((c): c is (typeof store.categories)[number] => Boolean(c))
    .map((c) => ({ ...c, items: all.filter((p) => p.categoryId === c.id) }))
    .filter((c) => c.items.length > 0);
  const others =
    s.categoryIds.length > 0
      ? []
      : all.filter((p) => !store.categories.some((c) => c.id === p.categoryId));
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
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [category, setCategory] = useState<string | null>(params.get('category'));
  // The header's search bar opens this page with `?q=`.
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [sort, setSort] = useState<'default' | 'name' | 'priceAsc' | 'priceDesc'>('default');
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
      (!category || p.categoryId === category) &&
      (!term || `${p.nameEn ?? ''} ${p.nameAr ?? ''}`.toLowerCase().includes(term)),
  );
  // Featured products open the page while nothing is filtered (ADR-0121).
  const featured = s.showFeatured && !category && !term ? visible.filter((p) => p.featured) : [];
  const used = new Set(products.data.products.map((p) => p.categoryId));
  const categories = (store?.categories ?? []).filter((c) => used.has(c.id));

  if (products.data.products.length === 0) return <EmptyState title={t('catalog.empty')} />;
  return (
    <div className="flex flex-col gap-4">
      {s.showSearch || s.showSort || (s.showCategories && categories.length > 0) ? (
        <div className="flex flex-wrap items-center gap-2">
          {s.showSearch ? (
            <Input
              type="search"
              aria-label={t('catalog.search')}
              placeholder={t('catalog.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
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
          {s.showCategories && categories.length > 0 ? (
            <div className="flex flex-wrap gap-2" role="group">
              {[
                { id: null, label: t('catalog.all') },
                ...categories.map((c) => ({ id: c.id, label: name(c), imageUrl: c.imageUrl })),
              ].map((c: { id: string | null; label: string; imageUrl?: string | null }) => (
                <button
                  key={c.id ?? 'all'}
                  type="button"
                  aria-pressed={category === c.id}
                  onClick={() => setCategory(c.id)}
                  className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pe-3 ps-1 text-sm aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-fg"
                >
                  {'imageUrl' in c && c.imageUrl ? (
                    <img src={c.imageUrl} alt="" className="size-6 rounded-full object-cover" />
                  ) : (
                    <span className="w-2" aria-hidden />
                  )}
                  {c.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {featured.length > 0 ? (
        <section aria-label={t('catalog.featured')} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t('catalog.featured')}</h2>
          <ProductGrid products={featured} testId="featured-grid" columns={s.columns} />
        </section>
      ) : null}
      {visible.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('design.noMatch')}</p>
      ) : (
        <ProductGrid
          products={visible}
          testId="product-grid"
          columns={s.columns}
          variant={s.variant}
        />
      )}
    </div>
  );
}

/** Where a design link points, for components that need the address itself. */
export function useLinkTo() {
  const slug = useSlug();
  return (link: Parameters<typeof linkTarget>[1]) => linkTarget(slug, link);
}
