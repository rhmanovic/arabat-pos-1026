import { type ColumnBlock, type SectionOf, columnCount } from '@arabat/contracts';
import { cn } from '@arabat/ui';
import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlug } from '../shared.js';
import { assetUrl, useCard, useCta, useText } from './context.js';
import { SectionTitle } from './frame.js';
import { DesignAnchor } from './parts.js';

/*
 * Layout and motion sections (ADR-0128 amendment 7): divider, columns of free content, a picture
 * beside words, card grid, tabs, a sliding ticker, counting numbers and steps.
 */

// ---------------------------------------------------------------------------- divider
export function DividerSection({ s }: { s: SectionOf<'divider'> }) {
  const text = useText();
  const label = text(s.label);
  const colour = {
    border: 'var(--color-border-strong)',
    brand: 'var(--color-primary)',
    fg: 'var(--color-fg)',
  }[s.color];
  const weight = { thin: 1, regular: 2, thick: 4 }[s.thickness];
  const length = { short: 'w-24', half: 'w-1/2', full: 'w-full' }[s.length];
  const line = (grow: boolean) => {
    const style: CSSProperties = { color: colour };
    if (s.variant === 'wave' || s.variant === 'zigzag')
      return (
        <svg
          aria-hidden
          viewBox="0 0 120 12"
          preserveAspectRatio="none"
          className={cn('h-3', grow ? 'flex-1' : length)}
          style={style}
        >
          <path
            d={
              s.variant === 'wave'
                ? 'M0,6 C10,0 20,0 30,6 S50,12 60,6 S80,0 90,6 S110,12 120,6'
                : 'M0,10 L10,2 L20,10 L30,2 L40,10 L50,2 L60,10 L70,2 L80,10 L90,2 L100,10 L110,2 L120,10'
            }
            fill="none"
            stroke="currentColor"
            strokeWidth={weight + 0.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      );
    if (s.variant === 'dots')
      return (
        <span aria-hidden className={cn('flex justify-center gap-2', grow ? 'flex-1' : length)}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="rounded-full"
              style={{ background: colour, width: weight * 3 + 3, height: weight * 3 + 3 }}
            />
          ))}
        </span>
      );
    return (
      <span
        aria-hidden
        className={cn('block', grow ? 'flex-1' : length)}
        style={
          s.variant === 'gradient'
            ? {
                height: weight + 1,
                backgroundImage: `linear-gradient(90deg, transparent, ${colour}, transparent)`,
              }
            : {
                borderTopWidth: s.variant === 'double' ? Math.max(weight, 3) * 1 : weight,
                borderTopStyle: s.variant === 'line' ? 'solid' : s.variant,
                borderColor: colour,
              }
        }
      />
    );
  };
  const middle = label || s.icon;
  return (
    <div
      role="separator"
      aria-label={label || undefined}
      data-variant={s.variant}
      className={cn(
        'flex items-center py-2',
        { start: 'justify-start', center: 'justify-center', end: 'justify-end' }[s.align],
      )}
    >
      {middle ? (
        <div className={cn('flex items-center gap-3', length)}>
          {line(true)}
          <span className="shrink-0 text-sm font-semibold text-fg-muted">
            {s.icon ? <span aria-hidden>{s.icon} </span> : null}
            {label}
          </span>
          {line(true)}
        </div>
      ) : (
        line(false)
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- columns
const TRACKS: Record<SectionOf<'columns'>['layout'], string> = {
  '1': 'sm:grid-cols-1',
  '1-1': 'sm:grid-cols-2',
  '2-1': 'sm:grid-cols-[2fr_1fr]',
  '1-2': 'sm:grid-cols-[1fr_2fr]',
  '1-1-1': 'sm:grid-cols-3',
  '1-2-1': 'sm:grid-cols-[1fr_2fr_1fr]',
  '1-1-1-1': 'sm:grid-cols-2 lg:grid-cols-4',
};

function Block({ b }: { b: ColumnBlock }) {
  const slug = useSlug();
  const text = useText();
  const cta = useCta();
  const words = text(b.text);
  const align = { start: 'text-start', center: 'text-center', end: 'text-end' }[b.align];
  const justify = { start: 'justify-start', center: 'justify-center', end: 'justify-end' }[b.align];
  switch (b.type) {
    case 'heading':
      if (!words) return null;
      return (
        <h3
          className={cn(
            'font-bold',
            align,
            { small: 'text-lg', regular: 'text-2xl', large: 'text-3xl sm:text-4xl' }[b.size],
          )}
        >
          {words}
        </h3>
      );
    case 'text':
      if (!words) return null;
      return (
        <p
          className={cn(
            'whitespace-pre-line text-fg-muted',
            align,
            { small: 'text-sm', regular: 'text-base', large: 'text-lg' }[b.size],
          )}
        >
          {words}
        </p>
      );
    case 'image': {
      const src = assetUrl(slug, b.imageId);
      if (!src) return null;
      const img = (
        <img
          src={src}
          alt={words}
          loading="lazy"
          className={cn(
            'w-full object-cover',
            b.style === 'soft' ? 'aspect-square rounded-full' : 'rounded-xl',
            { small: 'max-h-48', regular: 'max-h-80', large: 'max-h-[32rem]' }[b.size],
          )}
        />
      );
      return b.link ? (
        <DesignAnchor link={b.link} className="block">
          {img}
        </DesignAnchor>
      ) : (
        img
      );
    }
    case 'button':
      if (!words) return null;
      return (
        <div className={cn('flex', justify)}>
          <DesignAnchor
            link={b.link}
            className={cn(
              b.style === 'solid' && cta('primary'),
              b.style === 'outline' && cta('outline'),
              b.style === 'soft' && cn(cta('primary'), 'bg-primary-soft text-primary'),
              b.style === 'link' &&
                'inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline',
              b.size === 'large' && 'min-h-12 px-7 text-base',
              b.size === 'small' && 'min-h-9 px-3 text-xs',
            )}
          >
            {words}
          </DesignAnchor>
        </div>
      );
    case 'list': {
      const lines = words
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length === 0) return null;
      return (
        <ul className={cn('flex flex-col gap-2', align)}>
          {lines.map((l, i) => (
            <li key={i} className="flex items-start gap-2">
              <span aria-hidden className="text-primary">
                {b.icon || '✓'}
              </span>
              <span>{l}</span>
            </li>
          ))}
        </ul>
      );
    }
    case 'icon':
      if (!b.icon) return null;
      return (
        <p
          aria-hidden
          className={cn(
            align,
            { small: 'text-2xl', regular: 'text-4xl', large: 'text-6xl' }[b.size],
          )}
        >
          {b.icon}
        </p>
      );
    case 'divider':
      return <hr className="border-border" />;
    case 'spacer':
      return (
        <div aria-hidden className={{ small: 'h-2', regular: 'h-6', large: 'h-12' }[b.size]} />
      );
  }
}

export function ColumnsSection({ s }: { s: SectionOf<'columns'> }) {
  const text = useText();
  const count = Math.min(columnCount(s.layout), s.columns.length);
  const columns = s.columns.slice(0, count);
  if (columns.every((c) => c.blocks.length === 0)) return null;
  const title = text(s.title);
  const gap = { none: 'gap-0', small: 'gap-3', regular: 'gap-6', large: 'gap-10' }[s.gap];
  const box = {
    plain: '',
    card: 'rounded-2xl border border-border bg-surface p-5 shadow-sm',
    soft: 'rounded-2xl bg-surface-muted p-5',
    outline: 'rounded-2xl border-2 border-primary p-5',
    glass: 'rounded-2xl border border-white/25 bg-white/10 p-5 shadow-xl backdrop-blur-xl',
  }[s.columnStyle];
  return (
    <section aria-label={title || undefined}>
      <SectionTitle>{title}</SectionTitle>
      <div
        data-layout={s.layout}
        className={cn(
          s.phone === 'scroll'
            ? 'max-sm:-mx-4 max-sm:flex max-sm:snap-x max-sm:overflow-x-auto max-sm:px-4 max-sm:[scrollbar-width:none]'
            : 'grid grid-cols-1',
          'sm:grid',
          TRACKS[s.layout],
          gap,
          s.phone === 'scroll' && 'max-sm:gap-3',
          {
            top: 'items-start',
            center: 'items-center',
            bottom: 'items-end',
            stretch: 'items-stretch',
          }[s.verticalAlign],
        )}
      >
        {columns.map((c, i) => (
          <div
            key={c.id}
            data-column={i + 1}
            className={cn(
              'flex min-w-0 flex-col gap-4',
              box,
              s.verticalAlign === 'stretch' && 'h-full',
              s.phone === 'scroll' && 'max-sm:w-[80%] max-sm:shrink-0 max-sm:snap-start',
              s.phone === 'reverse' && 'max-sm:order-[calc(10_-_var(--col))]',
              s.dividers &&
                i > 0 &&
                'sm:border-s sm:border-border sm:ps-6 max-sm:border-t max-sm:pt-4',
            )}
            style={{ '--col': i } as CSSProperties}
          >
            {c.blocks.map((b) => (
              <Block key={b.id} b={b} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------------------ split
const SHAPE = {
  rect: '',
  rounded: 'rounded-2xl',
  circle: 'aspect-square rounded-full',
  arch: 'rounded-t-full rounded-b-2xl',
  blob: 'rounded-[42%_58%_63%_37%/45%_40%_60%_55%]',
} as const;

export function SplitSection({ s }: { s: SectionOf<'split'> }) {
  const slug = useSlug();
  const text = useText();
  const cta = useCta();
  const src = assetUrl(slug, s.imageId);
  const eyebrow = text(s.eyebrow);
  const title = text(s.title);
  const body = text(s.body);
  const button = text(s.button);
  const button2 = text(s.button2);
  if (!src && !title && !body) return null;
  const tracks = {
    even: 'sm:grid-cols-2',
    image: 'sm:grid-cols-[3fr_2fr]',
    text: 'sm:grid-cols-[2fr_3fr]',
  }[s.ratio];
  const tracksReversed = {
    even: 'sm:grid-cols-2',
    image: 'sm:grid-cols-[2fr_3fr]',
    text: 'sm:grid-cols-[3fr_2fr]',
  }[s.ratio];
  const picture = src ? (
    <div className={cn(s.imagePosition === 'end' && 'sm:order-2')}>
      <img
        src={src}
        alt=""
        loading="lazy"
        data-shape={s.imageShape}
        className={cn(
          'w-full object-cover',
          s.imageShape === 'circle' ? '' : 'aspect-[4/5] sm:aspect-[4/3]',
          SHAPE[s.imageShape],
        )}
      />
    </div>
  ) : null;
  return (
    <section
      className={cn(
        'grid gap-6 sm:gap-12',
        src && (s.imagePosition === 'end' ? tracksReversed : tracks),
        s.verticalAlign === 'center' ? 'items-center' : 'items-start',
      )}
      data-testid="split-section"
    >
      {picture}
      <div className="flex flex-col gap-3">
        {eyebrow ? (
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">{eyebrow}</p>
        ) : null}
        {title ? <h2 className="text-2xl font-extrabold sm:text-4xl">{title}</h2> : null}
        {body ? <p className="whitespace-pre-line text-fg-muted sm:text-lg">{body}</p> : null}
        {button || button2 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {button ? (
              <DesignAnchor link={s.link} className={cta('primary')}>
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

// ------------------------------------------------------------------------------ cards
export function CardsSection({ s }: { s: SectionOf<'cards'> }) {
  const slug = useSlug();
  const text = useText();
  const card = useCard();
  const items = s.items.filter((i) => text(i.title) || text(i.text) || i.imageId || i.icon);
  if (items.length === 0) return null;
  const title = text(s.title);
  const cols = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[
    s.columns as 2 | 3 | 4
  ];
  const ratio = { landscape: 'aspect-[4/3]', square: 'aspect-square', portrait: 'aspect-[3/4]' }[
    s.aspect
  ];
  return (
    <section aria-label={title || undefined}>
      <SectionTitle>{title}</SectionTitle>
      <ul
        className={cn('grid gap-4', s.mobileColumns === 2 ? 'grid-cols-2' : 'grid-cols-1', cols)}
        data-variant={s.variant}
      >
        {items.map((i) => {
          const src = assetUrl(slug, i.imageId);
          const label = text(i.button);
          const overlay = s.variant === 'overlay' && src;
          const body = (
            <article
              className={cn(
                'group relative flex h-full flex-col overflow-hidden rounded-2xl transition duration-300',
                s.variant === 'bordered' && 'border border-border bg-surface',
                s.variant === 'shadow' && 'bg-surface shadow-[0_12px_32px_-16px_rgb(0_0_0/0.3)]',
                s.variant === 'plain' && 'bg-transparent',
                s.variant === 'glass' &&
                  'border border-white/25 bg-white/10 shadow-xl backdrop-blur-xl',
                s.variant === 'overlay' && !src && card,
                s.hover === 'lift' && 'hover:-translate-y-1.5 hover:shadow-xl',
                s.hover === 'glow' && 'hover:shadow-[0_0_0_3px_var(--color-primary)]',
                s.align === 'center' && 'text-center',
              )}
            >
              {src ? (
                <div className={cn('overflow-hidden', overlay ? 'absolute inset-0' : ratio)}>
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    className={cn(
                      'size-full object-cover transition-transform duration-500',
                      s.hover === 'zoom' && 'group-hover:scale-110',
                    )}
                  />
                </div>
              ) : null}
              <div
                className={cn(
                  'relative flex flex-1 flex-col gap-2 p-5',
                  overlay &&
                    cn(
                      ratio,
                      'justify-end bg-gradient-to-t from-black/75 via-black/20 to-transparent text-white',
                    ),
                  s.align === 'center' && 'items-center',
                )}
              >
                {i.icon && !src ? (
                  <span aria-hidden className="text-4xl">
                    {i.icon}
                  </span>
                ) : null}
                {text(i.title) ? <h3 className="text-lg font-bold">{text(i.title)}</h3> : null}
                {text(i.text) ? (
                  <p className={cn('text-sm', overlay ? 'opacity-90' : 'text-fg-muted')}>
                    {text(i.text)}
                  </p>
                ) : null}
                {label ? (
                  <span
                    className={cn(
                      'inline-flex pt-2 text-sm font-semibold',
                      overlay ? '' : 'mt-auto text-primary',
                    )}
                  >
                    {label}{' '}
                    <span aria-hidden className="ms-1 rtl:-scale-x-100">
                      →
                    </span>
                  </span>
                ) : null}
              </div>
            </article>
          );
          return (
            <li key={i.id}>
              {i.link ? (
                <DesignAnchor link={i.link} className="block h-full">
                  {body}
                </DesignAnchor>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------------------- tabs
export function TabsSection({ s }: { s: SectionOf<'tabs'> }) {
  const slug = useSlug();
  const text = useText();
  const cta = useCta();
  const base = useId();
  const tabs = s.tabs.filter((tab) => text(tab.label));
  const [active, setActive] = useState(0);
  if (tabs.length === 0) return null;
  const current = tabs[Math.min(active, tabs.length - 1)]!;
  const title = text(s.title);
  const src = assetUrl(slug, current.imageId);
  const vertical = s.variant === 'vertical';
  const move = (delta: number) => setActive((n) => (n + delta + tabs.length) % tabs.length);
  return (
    <section aria-label={title || undefined}>
      <SectionTitle>{title}</SectionTitle>
      <div className={cn('flex gap-4', vertical ? 'flex-col sm:flex-row' : 'flex-col')}>
        <div
          role="tablist"
          aria-orientation={vertical ? 'vertical' : 'horizontal'}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(1);
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(-1);
          }}
          className={cn(
            'flex gap-1 overflow-x-auto [scrollbar-width:none]',
            vertical && 'sm:w-56 sm:shrink-0 sm:flex-col',
            !vertical && s.align === 'center' && 'justify-center',
            s.variant === 'underline' && 'border-b border-border',
            s.variant === 'boxed' && 'w-fit max-w-full rounded-xl bg-surface-muted p-1',
          )}
        >
          {tabs.map((tab, i) => {
            const on = tab.id === current.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`${base}-tab-${i}`}
                aria-selected={on}
                aria-controls={`${base}-panel`}
                tabIndex={on ? 0 : -1}
                onClick={() => setActive(i)}
                className={cn(
                  'shrink-0 px-4 py-2 text-sm font-semibold transition-colors',
                  s.variant === 'pills' &&
                    (on
                      ? 'rounded-full bg-primary text-primary-fg'
                      : 'rounded-full hover:bg-surface-muted'),
                  s.variant === 'underline' &&
                    cn(
                      '-mb-px border-b-2',
                      on ? 'border-primary text-fg' : 'border-transparent text-fg-muted',
                    ),
                  s.variant === 'boxed' &&
                    (on ? 'rounded-lg bg-surface shadow-sm' : 'rounded-lg text-fg-muted'),
                  vertical &&
                    cn(
                      'rounded-lg text-start',
                      on ? 'bg-primary-soft text-primary' : 'hover:bg-surface-muted',
                    ),
                )}
              >
                {text(tab.label)}
              </button>
            );
          })}
        </div>
        <div
          role="tabpanel"
          id={`${base}-panel`}
          aria-labelledby={`${base}-tab-${tabs.indexOf(current)}`}
          className={cn(
            'grid flex-1 gap-6',
            src && s.imagePosition !== 'top' && 'sm:grid-cols-2 sm:items-center',
          )}
        >
          {src ? (
            <img
              key={current.id}
              src={src}
              alt=""
              className={cn(
                'w-full rounded-2xl object-cover',
                s.imagePosition === 'top' ? 'aspect-[21/9]' : 'aspect-[4/3]',
                s.imagePosition === 'end' && 'sm:order-2',
              )}
            />
          ) : null}
          <div className="flex flex-col gap-3">
            {text(current.title) ? (
              <h3 className="text-2xl font-bold">{text(current.title)}</h3>
            ) : null}
            {text(current.text) ? (
              <p className="whitespace-pre-line text-fg-muted">{text(current.text)}</p>
            ) : null}
            {text(current.button) ? (
              <DesignAnchor link={current.link} className={cn(cta('primary'), 'w-fit')}>
                {text(current.button)}
              </DesignAnchor>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------- marquee
export function MarqueeSection({ s }: { s: SectionOf<'marquee'> }) {
  const text = useText();
  const words = s.items.map((i) => ({ id: i.id, text: text(i.text) })).filter((i) => i.text);
  if (words.length === 0) return null;
  const run = (copy: number) => (
    <ul aria-hidden={copy > 0} className="flex shrink-0 items-center">
      {words.map((w) => (
        <li key={`${copy}-${w.id}`} className="flex items-center whitespace-nowrap">
          <span className="px-5">{w.text}</span>
          {s.separator ? <span aria-hidden>{s.separator}</span> : null}
        </li>
      ))}
    </ul>
  );
  // Enough copies to fill wide screens; the track moves by half its width and loops.
  const copies = Math.max(2, Math.ceil(12 / words.length)) * 2;
  return (
    <div
      className={cn('store-marquee-host overflow-hidden', s.variant === 'tilted' && 'py-6')}
      data-pause={s.pauseOnHover}
      data-testid="marquee"
    >
      <div
        className={cn(
          'py-3 font-bold',
          { small: 'text-sm', regular: 'text-lg', large: 'text-3xl sm:text-5xl uppercase' }[s.size],
          s.variant === 'brand' && 'bg-primary text-primary-fg',
          s.variant === 'dark' && 'bg-[#0f0f10] text-white',
          s.variant === 'outline' && 'border-y-2 border-current',
          s.variant === 'tilted' && '-mx-4 -rotate-2 bg-primary text-primary-fg shadow-xl',
        )}
      >
        <p className="sr-only">{words.map((w) => w.text).join(' · ')}</p>
        <div
          className="store-marquee flex w-max"
          data-direction={s.direction}
          style={
            {
              '--marquee-duration': `${{ slow: 60, normal: 35, fast: 18 }[s.speed] * (copies / 4)}s`,
            } as CSSProperties
          }
        >
          {Array.from({ length: copies }, (_, i) => (
            <div key={i} aria-hidden className="flex shrink-0">
              {run(1)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------ stats
/** Counts from 0 to `to` once the number is on screen (at once with reduced motion). */
function useCountUp(to: number, enabled: boolean) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(to);
  useEffect(() => {
    const el = ref.current;
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!enabled || !el || reduced || typeof IntersectionObserver === 'undefined') {
      setValue(to);
      return;
    }
    setValue(0);
    let frame = 0;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / 1400);
        setValue(Math.round(to * (1 - (1 - p) ** 3)));
        if (p < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [to, enabled]);
  return { ref, value };
}

function Stat({
  item,
  countUp,
  boxed,
  variant,
}: {
  item: SectionOf<'stats'>['items'][number];
  countUp: boolean;
  boxed: boolean;
  variant: SectionOf<'stats'>['variant'];
}) {
  const text = useText();
  const { i18n } = useTranslation();
  const card = useCard();
  const { ref, value } = useCountUp(item.value, countUp);
  return (
    <li
      className={cn(
        'flex flex-col items-center gap-1 p-4 text-center',
        variant === 'cards' && cn('rounded-2xl', card),
        boxed && 'rounded-2xl bg-surface',
      )}
    >
      <span className="text-4xl font-extrabold tabular-nums sm:text-5xl" data-value={item.value}>
        {item.prefix}
        <span ref={ref}>{value.toLocaleString(i18n.language.startsWith('ar') ? 'ar' : 'en')}</span>
        {item.suffix}
      </span>
      <span className="text-sm text-fg-muted">{text(item.label)}</span>
    </li>
  );
}

export function StatsSection({ s }: { s: SectionOf<'stats'> }) {
  const text = useText();
  const items = s.items.filter((i) => i.value > 0 || text(i.label));
  if (items.length === 0 || items.every((i) => i.value === 0)) return null;
  const title = text(s.title);
  return (
    <section aria-label={title || undefined}>
      <SectionTitle>{title}</SectionTitle>
      <ul
        className={cn(
          'grid grid-cols-2 gap-4',
          items.length >= 3 && 'sm:grid-cols-3',
          items.length >= 4 && 'lg:grid-cols-4',
          s.variant === 'row' && 'sm:divide-x sm:divide-border rtl:sm:divide-x-reverse',
        )}
      >
        {items.map((item) => (
          <Stat
            key={item.id}
            item={item}
            countUp={s.countUp}
            boxed={s.variant === 'boxed'}
            variant={s.variant}
          />
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------------------ steps
export function StepsSection({ s }: { s: SectionOf<'steps'> }) {
  const text = useText();
  const card = useCard();
  const items = s.items.filter((i) => text(i.title) || text(i.text));
  if (items.length === 0) return null;
  const title = text(s.title);
  const badge = (i: number, icon: string) => (
    <span
      aria-hidden
      className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-lg font-bold text-primary-fg"
    >
      {icon || i + 1}
    </span>
  );
  return (
    <section aria-label={title || undefined}>
      <SectionTitle>{title}</SectionTitle>
      {s.variant === 'timeline' ? (
        <ol className="relative flex flex-col gap-6 border-s-2 border-primary/30 ps-8">
          {items.map((item, i) => (
            <li key={item.id} className="relative">
              <span className="absolute -start-[3.1rem] top-0">{badge(i, item.icon)}</span>
              <h3 className="font-bold">{text(item.title)}</h3>
              {text(item.text) ? <p className="text-sm text-fg-muted">{text(item.text)}</p> : null}
            </li>
          ))}
        </ol>
      ) : (
        <ol
          className={cn(
            'grid gap-4',
            items.length >= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2',
            items.length >= 4 && 'lg:grid-cols-4',
          )}
        >
          {items.map((item, i) => (
            <li
              key={item.id}
              className={cn(
                'relative flex flex-col items-center gap-2 p-4 text-center',
                s.variant === 'cards' && cn('rounded-2xl', card),
              )}
            >
              {badge(i, item.icon)}
              {s.variant === 'numbers' && i < items.length - 1 ? (
                <span
                  aria-hidden
                  className="absolute top-10 hidden h-0.5 w-[calc(100%-4rem)] bg-primary/25 sm:block start-[calc(50%+2rem)]"
                />
              ) : null}
              <h3 className="font-bold">{text(item.title)}</h3>
              {text(item.text) ? <p className="text-sm text-fg-muted">{text(item.text)}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
