import type { SectionOf } from '@arabat/contracts';
import { cn } from '@arabat/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlug } from '../shared.js';
import { assetUrl, isPreview, useCard, useCta, useText } from './context.js';
import { SectionTitle } from './frame.js';
import { DesignAnchor } from './parts.js';

/*
 * Section types added with ADR-0128 amendment 3: offer countdown, customer words, questions and
 * answers, picture gallery, brand logos, promotion collage, call to action and spacer.
 */

// -------------------------------------------------------------------------- countdown
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function CountdownSection({ s }: { s: SectionOf<'countdown'> }) {
  const text = useText();
  const cta = useCta();
  const card = useCard();
  const { t } = useTranslation();
  const end = s.endsAt ? Date.parse(s.endsAt) : null;
  const now = useNow(end !== null);
  const left = end === null ? 0 : Math.max(0, end - now);
  if (end === null || left === 0)
    // An offer without an end, or one that ended, is not shown (the preview says why).
    return isPreview() ? (
      <p className="rounded-xl border border-dashed border-border-strong p-4 text-center text-sm text-fg-muted">
        {end === null ? t('design.countdownNoEnd') : t('design.countdownEnded')}
      </p>
    ) : null;
  const seconds = Math.floor(left / 1000);
  const parts = [
    { key: 'days', value: Math.floor(seconds / 86400) },
    { key: 'hours', value: Math.floor((seconds % 86400) / 3600) },
    { key: 'minutes', value: Math.floor((seconds % 3600) / 60) },
    { key: 'seconds', value: seconds % 60 },
  ];
  const title = text(s.title);
  const subtitle = text(s.subtitle);
  const button = text(s.button);
  const onBrand = s.variant === 'banner';
  const clock = (
    <ol
      className="flex gap-2 tabular-nums sm:gap-3"
      aria-label={t('design.timeLeft')}
      data-testid="countdown"
      dir="ltr"
    >
      {parts.map((p) => (
        <li
          key={p.key}
          className={cn(
            'flex min-w-14 flex-col items-center rounded-xl px-2 py-2 sm:min-w-16',
            onBrand ? 'bg-white/15' : 'bg-surface-muted',
          )}
        >
          <span className="text-2xl font-extrabold leading-none sm:text-3xl">
            {String(p.value).padStart(2, '0')}
          </span>
          <span className="mt-1 text-[0.65rem] font-semibold uppercase opacity-75">
            {t(`design.unit_${p.key}`)}
          </span>
        </li>
      ))}
    </ol>
  );
  if (s.variant === 'minimal')
    return (
      <section
        aria-label={title || t('design.offer')}
        className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center"
      >
        {title ? <p className="font-bold">{title}</p> : null}
        {clock}
        {button ? (
          <DesignAnchor link={s.link} className={cn(cta('primary'), 'min-h-9')}>
            {button}
          </DesignAnchor>
        ) : null}
      </section>
    );
  return (
    <section
      aria-label={title || t('design.offer')}
      className={cn(
        'flex flex-col items-center gap-4 rounded-2xl p-6 text-center sm:flex-row sm:justify-between sm:p-8 sm:text-start',
        onBrand ? 'bg-primary text-primary-fg' : card,
      )}
    >
      <div>
        {title ? <h2 className="text-2xl font-extrabold">{title}</h2> : null}
        {subtitle ? <p className="mt-1 text-sm opacity-85">{subtitle}</p> : null}
      </div>
      <div className="flex flex-col items-center gap-3 sm:items-end">
        {clock}
        {button ? (
          <DesignAnchor link={s.link} className={cta(onBrand ? 'light' : 'primary')}>
            {button}
          </DesignAnchor>
        ) : null}
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------- testimonials
function Stars({ value }: { value: number }) {
  const { t } = useTranslation();
  if (value === 0) return null;
  return (
    <span className="text-amber-500" role="img" aria-label={t('design.stars', { count: value })}>
      {'★'.repeat(value)}
      <span className="opacity-30">{'★'.repeat(5 - value)}</span>
    </span>
  );
}

export function TestimonialsSection({ s }: { s: SectionOf<'testimonials'> }) {
  const text = useText();
  const card = useCard();
  const { t } = useTranslation();
  const items = s.items.filter((i) => text(i.quote));
  const [index, setIndex] = useState(0);
  if (items.length === 0) return null;
  const quote = (i: (typeof items)[number], big = false) => (
    <figure
      className={cn(
        'flex h-full flex-col gap-3 rounded-2xl p-5',
        big ? 'items-center text-center' : card,
      )}
    >
      <Stars value={i.rating} />
      <blockquote
        className={cn('leading-relaxed', big ? 'max-w-2xl text-lg sm:text-xl' : 'text-sm')}
      >
        “{text(i.quote)}”
      </blockquote>
      <figcaption className="mt-auto text-sm">
        {i.name ? <span className="font-bold">{i.name}</span> : null}
        {text(i.detail) ? <span className="text-fg-muted"> · {text(i.detail)}</span> : null}
      </figcaption>
    </figure>
  );
  const title = text(s.title);
  if (s.variant === 'quote') {
    const current = items[index % items.length]!;
    return (
      <section aria-label={title || t('design.reviews')}>
        <SectionTitle>{title}</SectionTitle>
        {quote(current, true)}
        {items.length > 1 ? (
          <div className="mt-2 flex justify-center gap-2">
            {items.map((i, n) => (
              <button
                key={i.id}
                type="button"
                aria-label={t('design.goToReview', { n: n + 1 })}
                aria-current={n === index % items.length}
                onClick={() => setIndex(n)}
                className={cn(
                  'h-2 rounded-full transition-all',
                  n === index % items.length ? 'w-6 bg-primary' : 'w-2 bg-border-strong',
                )}
              />
            ))}
          </div>
        ) : null}
      </section>
    );
  }
  return (
    <section aria-label={title || t('design.reviews')}>
      <SectionTitle>{title}</SectionTitle>
      <ul
        className={cn(
          s.variant === 'carousel'
            ? '-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none]'
            : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3',
        )}
      >
        {items.map((i) => (
          <li key={i.id} className={cn(s.variant === 'carousel' && 'w-72 shrink-0 snap-start')}>
            {quote(i)}
          </li>
        ))}
      </ul>
    </section>
  );
}

// -------------------------------------------------------------------------------- faq
export function FaqSection({ s }: { s: SectionOf<'faq'> }) {
  const text = useText();
  const card = useCard();
  const { t } = useTranslation();
  // A question without an answer stays out until the merchant writes one.
  const items = s.items.filter((i) => text(i.question) && text(i.answer));
  if (items.length === 0) return null;
  const title = text(s.title);
  return (
    <section aria-label={title || t('design.faq')}>
      <SectionTitle>{title}</SectionTitle>
      <div className={cn('grid gap-2', s.variant === 'columns' && 'sm:grid-cols-2 sm:gap-3')}>
        {items.map((i) => (
          <details key={i.id} className={cn('group rounded-xl', card)}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 font-semibold [&::-webkit-details-marker]:hidden">
              {text(i.question)}
              <span
                aria-hidden
                className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-muted text-lg leading-none transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="px-4 pb-4 text-sm leading-relaxed whitespace-pre-line text-fg-muted">
              {text(i.answer)}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------- gallery
export function GallerySection({ s }: { s: SectionOf<'gallery'> }) {
  const slug = useSlug();
  const text = useText();
  const { t } = useTranslation();
  const items = s.items
    .map((i) => ({ ...i, src: assetUrl(slug, i.imageId) }))
    .filter((i): i is typeof i & { src: string } => Boolean(i.src));
  if (items.length === 0) return null;
  const title = text(s.title);
  const cols = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4' }[s.columns];
  const picture = (i: (typeof items)[number], className: string) => {
    const caption = text(i.caption);
    const body = (
      <figure
        className={cn(
          'group relative h-full overflow-hidden rounded-xl bg-surface-muted',
          className,
        )}
      >
        <img
          src={i.src}
          alt={caption}
          loading="lazy"
          className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        {caption ? (
          <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 text-sm font-semibold text-white">
            {caption}
          </figcaption>
        ) : null}
      </figure>
    );
    return i.link ? (
      <DesignAnchor link={i.link} className="block h-full">
        {body}
      </DesignAnchor>
    ) : (
      body
    );
  };
  return (
    <section aria-label={title || t('design.gallery')}>
      <SectionTitle>{title}</SectionTitle>
      {s.variant === 'carousel' ? (
        <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
          {items.map((i) => (
            <li key={i.id} className="w-64 shrink-0 snap-start sm:w-80">
              {picture(i, 'aspect-[4/5]')}
            </li>
          ))}
        </ul>
      ) : s.variant === 'mosaic' ? (
        <ul className="grid auto-rows-[9rem] grid-cols-2 gap-3 sm:auto-rows-[12rem] sm:grid-cols-4">
          {items.map((i, n) => (
            <li key={i.id} className={cn(n % 5 === 0 && 'col-span-2 row-span-2')}>
              {picture(i, '')}
            </li>
          ))}
        </ul>
      ) : (
        <ul className={cn('grid grid-cols-2 gap-3', cols)}>
          {items.map((i) => (
            <li key={i.id}>{picture(i, 'aspect-square')}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------------------ logos
export function LogosSection({ s }: { s: SectionOf<'logos'> }) {
  const slug = useSlug();
  const text = useText();
  const { t } = useTranslation();
  const items = s.items
    .map((i) => ({ ...i, src: assetUrl(slug, i.imageId) }))
    .filter((i): i is typeof i & { src: string } => Boolean(i.src));
  if (items.length === 0) return null;
  const title = text(s.title);
  return (
    <section aria-label={title || t('design.brands')}>
      <SectionTitle>{title}</SectionTitle>
      <ul
        className={cn(
          s.variant === 'row'
            ? '-mx-4 flex items-center gap-8 overflow-x-auto px-4 py-2 [scrollbar-width:none] sm:justify-center'
            : 'grid grid-cols-3 items-center gap-6 sm:grid-cols-4 lg:grid-cols-6',
        )}
      >
        {items.map((i) => {
          const logo = (
            <img
              src={i.src}
              alt={text(i.alt)}
              loading="lazy"
              className={cn(
                'h-12 w-auto max-w-32 object-contain transition sm:h-14',
                s.grayscale && 'opacity-70 grayscale hover:opacity-100 hover:grayscale-0',
              )}
            />
          );
          return (
            <li key={i.id} className="flex shrink-0 justify-center">
              {i.link ? <DesignAnchor link={i.link}>{logo}</DesignAnchor> : logo}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------- collage
export function CollageSection({ s }: { s: SectionOf<'collage'> }) {
  const slug = useSlug();
  const text = useText();
  const cta = useCta();
  const tiles = s.tiles.filter((x) => text(x.title) || x.imageId);
  if (tiles.length === 0) return null;
  const mosaic = s.variant === 'mosaic' && tiles.length >= 3;
  return (
    <ul
      className={cn(
        'grid gap-3',
        mosaic
          ? 'auto-rows-[11rem] grid-cols-2 sm:auto-rows-[13rem] lg:grid-cols-3'
          : tiles.length === 2
            ? 'auto-rows-[13rem] sm:grid-cols-2'
            : tiles.length === 3
              ? 'auto-rows-[13rem] sm:grid-cols-3'
              : 'auto-rows-[12rem] grid-cols-2 lg:grid-cols-4',
      )}
      data-testid="collage"
    >
      {tiles.map((tile, n) => {
        const img = assetUrl(slug, tile.imageId);
        const title = text(tile.title);
        const subtitle = text(tile.subtitle);
        const button = text(tile.button);
        return (
          <li
            key={tile.id}
            className={cn(mosaic && n === 0 && 'col-span-2 row-span-2 lg:col-span-2')}
          >
            <DesignAnchor
              link={tile.link}
              className="group relative flex h-full flex-col justify-end overflow-hidden rounded-2xl p-5 text-white"
            >
              {img ? (
                <img
                  src={img}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <span
                  aria-hidden
                  className={cn(
                    'absolute inset-0 bg-gradient-to-br',
                    n % 3 === 0
                      ? 'from-primary to-primary-hover'
                      : n % 3 === 1
                        ? 'from-fuchsia-600 to-rose-500'
                        : 'from-amber-500 to-orange-600',
                  )}
                />
              )}
              <span
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"
              />
              <span className="relative flex flex-col gap-1">
                {title ? (
                  <span
                    className={cn('font-extrabold', mosaic && n === 0 ? 'text-3xl' : 'text-xl')}
                  >
                    {title}
                  </span>
                ) : null}
                {subtitle ? <span className="text-sm opacity-90">{subtitle}</span> : null}
                {button ? (
                  <span className={cn(cta('light'), 'mt-2 min-h-9 w-fit')}>{button}</span>
                ) : null}
              </span>
            </DesignAnchor>
          </li>
        );
      })}
    </ul>
  );
}

// -------------------------------------------------------------------- call to action
export function CtaSection({ s }: { s: SectionOf<'cta'> }) {
  const slug = useSlug();
  const text = useText();
  const cta = useCta();
  const title = text(s.title);
  const body = text(s.text);
  const button = text(s.button);
  const button2 = text(s.button2);
  const img = s.variant === 'image' ? assetUrl(slug, s.imageId) : null;
  if (!title && !body && !button) return null;
  const dark = s.variant === 'brand' || s.variant === 'image';
  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl p-8 sm:p-12',
        s.variant === 'brand' && 'bg-primary text-primary-fg',
        s.variant === 'soft' && 'bg-primary-soft',
        s.variant === 'outline' && 'border-2 border-primary',
        s.variant === 'image' && 'bg-[#111] text-white',
      )}
      data-testid="cta-section"
    >
      {img ? (
        <>
          <img
            src={img}
            alt=""
            className="absolute inset-0 size-full object-cover"
            loading="lazy"
          />
          <span aria-hidden className="absolute inset-0 bg-black/55" />
        </>
      ) : null}
      <div
        className={cn(
          'relative flex flex-col gap-3',
          s.align === 'center' ? 'items-center text-center' : 'items-start',
        )}
      >
        {title ? <h2 className="text-2xl font-extrabold sm:text-3xl">{title}</h2> : null}
        {body ? (
          <p className={cn('max-w-2xl', dark ? 'opacity-90' : 'text-fg-muted')}>{body}</p>
        ) : null}
        {button || button2 ? (
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {button ? (
              <DesignAnchor link={s.link} className={cta(dark ? 'light' : 'primary')}>
                {button}
              </DesignAnchor>
            ) : null}
            {button2 ? (
              <DesignAnchor link={s.link2} className={cta('outline')}>
                {button2}
              </DesignAnchor>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------------- spacer
export function SpacerSection({ s }: { s: SectionOf<'spacer'> }) {
  const size = { small: 'h-4', medium: 'h-10', large: 'h-20' }[s.size];
  return (
    <div aria-hidden className={cn('flex items-center', size)}>
      {s.line ? <hr className="w-full border-border" /> : null}
    </div>
  );
}
