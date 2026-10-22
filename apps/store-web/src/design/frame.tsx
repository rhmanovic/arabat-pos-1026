import { type DesignSection, OWN_TITLE_SECTIONS, type SectionLook } from '@arabat/contracts';
import { cn } from '@arabat/ui';
import { readableOn } from '@arabat/web-core';
import {
  type CSSProperties,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSlug } from '../shared.js';
import { assetUrl, isPreview, useDesign, useText } from './context.js';

/*
 * The frame every designed section sits in (ADR-0128 amendments 3 and 7): its background
 * (colours, gradients, a custom colour or a picture), spacing, width, height, a boxed card,
 * rounded corners and edge shapes, heading (kicker, size, subtitle, alignment), motion on
 * scroll, a direct-link anchor, sticky / overlapping / collapsible behaviour, the screens it
 * shows on, and its schedule.
 */

/** A section that bleeds to the screen edges. */
export const full = 'relative start-1/2 w-screen max-w-none -translate-x-1/2 rtl:translate-x-1/2';

const LookContext = createContext<SectionLook | null>(null);
export const useLook = () => useContext(LookContext);

/** Shown now by its schedule (no dates = always). */
export function sectionLive(look: SectionLook, now = Date.now()): boolean {
  if (look.showFrom && Date.parse(look.showFrom) > now) return false;
  if (look.showUntil && Date.parse(look.showUntil) <= now) return false;
  return true;
}

// A dark band: the store's dark palette, scoped to the section.
const DARK: CSSProperties = {
  '--color-canvas': 'oklch(0.17 0.01 260)',
  '--color-surface': 'oklch(0.22 0.012 260)',
  '--color-surface-muted': 'oklch(0.27 0.014 260)',
  '--color-border': 'oklch(0.33 0.015 260)',
  '--color-border-strong': 'oklch(0.42 0.02 260)',
  '--color-fg': 'oklch(0.96 0.005 260)',
  '--color-fg-muted': 'oklch(0.77 0.01 260)',
  '--color-fg-subtle': 'oklch(0.66 0.01 260)',
  '--color-primary-soft': 'color-mix(in oklch, var(--color-primary) 25%, oklch(0.22 0.012 260))',
} as CSSProperties;
// A band in a strong colour: text in the colour readable on it, buttons inverted.
const onColour = (brand: string, on: string) =>
  ({ '--section-brand': brand, '--section-on': on }) as CSSProperties;
const BRAND_INNER = {
  '--color-fg': 'var(--section-on)',
  '--color-fg-muted': 'color-mix(in oklch, var(--section-on) 78%, transparent)',
  '--color-fg-subtle': 'color-mix(in oklch, var(--section-on) 62%, transparent)',
  '--color-surface': 'color-mix(in oklch, var(--section-on) 10%, transparent)',
  '--color-surface-muted': 'color-mix(in oklch, var(--section-on) 16%, transparent)',
  '--color-border': 'color-mix(in oklch, var(--section-on) 24%, transparent)',
  '--color-primary': 'var(--section-on)',
  '--color-primary-fg': 'var(--section-brand)',
  '--color-primary-soft': 'color-mix(in oklch, var(--section-on) 15%, transparent)',
} as CSSProperties;

/** Ready gradients: the CSS and the text colour readable on them. */
export const GRADIENTS: Record<
  SectionLook['gradient'],
  { css: string; brand: string; on: string }
> = {
  brand: {
    css: 'linear-gradient(135deg, var(--color-primary), color-mix(in oklch, var(--color-primary) 55%, black))',
    brand: 'var(--color-primary)',
    on: 'var(--color-primary-fg)',
  },
  sunset: { css: 'linear-gradient(135deg, #f97316, #db2777)', brand: '#c2410c', on: '#ffffff' },
  ocean: { css: 'linear-gradient(135deg, #0284c7, #4338ca)', brand: '#0369a1', on: '#ffffff' },
  candy: { css: 'linear-gradient(135deg, #fbcfe8, #ddd6fe)', brand: '#ffffff', on: '#2a0f2f' },
  mint: { css: 'linear-gradient(135deg, #a7f3d0, #a5f3fc)', brand: '#ffffff', on: '#062a22' },
  night: { css: 'linear-gradient(135deg, #0f172a, #4c1d95)', brand: '#1e1b4b', on: '#ffffff' },
  peach: { css: 'linear-gradient(135deg, #fde68a, #fca5a5)', brand: '#ffffff', on: '#3b1d0a' },
  aurora: {
    css: 'linear-gradient(120deg, #0e7490, #7e22ce 55%, #be185d)',
    brand: '#581c87',
    on: '#ffffff',
  },
};

const PAD = {
  // Breathing room between plain sections, a little more on larger screens.
  plain: {
    none: 'py-0',
    compact: 'py-2',
    regular: 'py-5 sm:py-7',
    roomy: 'py-10 sm:py-14',
    huge: 'py-16 sm:py-24',
  },
  coloured: { none: 'py-0', compact: 'py-6', regular: 'py-10', roomy: 'py-16', huge: 'py-24' },
} as const;

/** Edge shapes, drawn in the page colour over the top of the band (flipped for the bottom). */
function zigzag(teeth: number, depth: number) {
  const step = 1200 / teeth;
  let d = 'M0,0 H1200 V0';
  for (let i = teeth; i > 0; i--) d += ` L${(i - 0.5) * step},${depth} L${(i - 1) * step},0`;
  return `${d} Z`;
}
const SHAPES: Record<Exclude<SectionLook['dividerTop'], 'none'>, string> = {
  wave: 'M0,0 H1200 V40 C1000,110 800,0 600,50 C400,100 200,0 0,50 Z',
  curve: 'M0,0 H1200 V10 Q600,130 0,10 Z',
  slant: 'M0,0 H1200 L0,90 Z',
  zigzag: zigzag(24, 36),
  peaks: zigzag(4, 90),
};
function EdgeShape({ shape, edge }: { shape: SectionLook['dividerTop']; edge: 'top' | 'bottom' }) {
  if (shape === 'none') return null;
  return (
    <svg
      aria-hidden
      viewBox="0 0 1200 120"
      preserveAspectRatio="none"
      data-edge={`${edge}-${shape}`}
      className={cn(
        'pointer-events-none absolute inset-x-0 z-[1] h-8 w-full sm:h-14',
        edge === 'top' ? 'top-0' : 'bottom-0 -scale-y-100',
      )}
      style={{ fill: 'var(--page-canvas)' }}
    >
      <path d={SHAPES[shape]} />
    </svg>
  );
}

/**
 * Entrance motion: the section starts hidden and shows once its top is on screen, or above it
 * (a fast scroll or a jump never leaves it hidden). Sections already on screen play at once,
 * and changing the animation in the editor plays it again.
 */
function useReveal(animation: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (animation === 'none' || !el || typeof window.requestAnimationFrame !== 'function') return;
    setShown(false);
    let frame = 0;
    const stop = () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
    const check = () => {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.92) {
        setShown(true);
        stop();
      }
    };
    function onScroll() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    }
    const start = window.setTimeout(check, 80);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      clearTimeout(start);
      cancelAnimationFrame(frame);
      stop();
    };
  }, [animation]);
  return { ref, shown };
}

export function SectionFrame({
  section,
  children,
}: {
  section: DesignSection;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const slug = useSlug();
  const text = useText();
  const look = section.look;
  const picture = look.background === 'image' ? assetUrl(slug, look.bgImageId) : null;
  const background =
    (look.background === 'image' && !picture) || (look.background === 'custom' && !look.bgColor)
      ? 'none'
      : look.background;
  const coloured = background !== 'none';
  const rounded = coloured && look.corners !== 'none';
  const bleed = (coloured && !rounded) || look.width === 'full';
  const live = sectionLive(look);
  // The section's own animation, or the page's motion (ADR-0128 amendment 7).
  const { style } = useDesign();
  const animation =
    look.animation === 'off'
      ? 'none'
      : look.animation !== 'none'
        ? look.animation
        : style.motion === 'none'
          ? 'none'
          : 'up';
  const { ref: revealRef, shown } = useReveal(animation);
  const devices =
    look.devices === 'desktop' ? 'max-sm:hidden' : look.devices === 'phone' ? 'sm:hidden' : '';
  const bg = {
    none: '',
    soft: 'bg-surface-muted',
    tinted: 'bg-primary-soft',
    brand: 'bg-primary',
    dark: 'bg-canvas text-fg',
    gradient: '',
    image: 'bg-cover bg-center',
    custom: '',
  }[background];
  // Strong colours carry their own readable text colour (and inverted buttons).
  const strong: { outer: CSSProperties; inner: boolean } | null =
    background === 'brand'
      ? { outer: onColour('var(--color-primary)', 'var(--color-primary-fg)'), inner: true }
      : background === 'gradient'
        ? {
            outer: {
              ...onColour(GRADIENTS[look.gradient].brand, GRADIENTS[look.gradient].on),
              backgroundImage: GRADIENTS[look.gradient].css,
            },
            inner: true,
          }
        : background === 'custom' && look.bgColor
          ? {
              outer: {
                ...onColour(look.bgColor, readableOn(look.bgColor)),
                backgroundColor: look.bgColor,
              },
              inner: true,
            }
          : background === 'image' && picture
            ? {
                outer: {
                  ...(look.bgOverlay === 'light'
                    ? onColour('#ffffff', '#111111')
                    : onColour('#111111', '#ffffff')),
                  backgroundImage: `url("${picture}")`,
                },
                inner: true,
              }
            : null;
  const height =
    look.height === 'screen'
      ? 'flex min-h-[calc(100svh-4rem)] flex-col justify-center'
      : look.height === 'half'
        ? 'flex min-h-[50svh] flex-col justify-center'
        : '';
  const width =
    look.width === 'narrow'
      ? 'mx-auto w-full max-w-3xl px-4'
      : bleed
        ? look.width === 'full'
          ? 'px-4 sm:px-8'
          : 'mx-auto max-w-6xl px-4'
        : '';
  // Sections without a title of their own get the frame's heading (kicker, title, subtitle).
  const frameHeading = !OWN_TITLE_SECTIONS.includes(section.type);
  let content: ReactNode = (
    <LookContext.Provider value={look}>
      {frameHeading ? <SectionTitle>{text(look.heading)}</SectionTitle> : null}
      {children}
    </LookContext.Provider>
  );
  if (look.collapsible)
    content = (
      <details className="group rounded-2xl border border-border bg-surface" data-collapsible>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-lg font-bold [&::-webkit-details-marker]:hidden">
          {text(look.collapseLabel) || t('design.openSection')}
          <span aria-hidden className="transition-transform group-open:rotate-180">
            ⌄
          </span>
        </summary>
        <div className="border-t border-border p-4">{content}</div>
      </details>
    );
  if (look.boxed)
    content = (
      <div
        className="rounded-3xl border border-border bg-surface p-5 shadow-[0_24px_60px_-30px_rgb(0_0_0/0.35)] sm:p-10"
        data-boxed
      >
        {content}
      </div>
    );
  return (
    <div
      ref={revealRef}
      id={`section-${section.id}`}
      data-section={section.type}
      data-background={background}
      data-reveal={animation !== 'none' ? animation : undefined}
      data-shown={animation !== 'none' ? String(shown) : undefined}
      className={cn(
        'relative scroll-mt-20',
        devices,
        !live && 'opacity-60',
        look.sticky && 'sticky top-[var(--store-header-h,0px)] z-20',
        look.overlap && 'z-10 -mt-12 sm:-mt-20',
      )}
      style={{ '--page-canvas': 'var(--color-canvas)' } as CSSProperties}
    >
      {look.anchor ? (
        <span id={look.anchor} aria-hidden className="absolute -top-24 block" />
      ) : null}
      {!live ? (
        // Only the preview shows sections outside their schedule (shoppers never get them).
        <p className="absolute top-2 start-2 z-20 rounded-full bg-fg px-3 py-1 text-xs font-semibold text-canvas">
          {t('design.notLiveNow')}
        </p>
      ) : null}
      <div
        className={cn(
          'relative',
          bleed && full,
          bg,
          rounded && (look.corners === 'round' ? 'rounded-[2rem]' : 'rounded-2xl'),
          rounded && 'overflow-hidden',
          PAD[coloured ? 'coloured' : 'plain'][look.spacing],
          coloured && look.dividerTop !== 'none' && 'pt-14 sm:pt-20',
          coloured && look.dividerBottom !== 'none' && 'pb-14 sm:pb-20',
          height,
        )}
        style={background === 'dark' ? DARK : strong?.outer}
      >
        {background === 'image' && look.bgOverlay !== 'none' ? (
          <span
            aria-hidden
            className={cn(
              'absolute inset-0',
              look.bgOverlay === 'dark' ? 'bg-black/55' : 'bg-white/70',
            )}
          />
        ) : null}
        {coloured ? <EdgeShape shape={look.dividerTop} edge="top" /> : null}
        <div
          className={cn('relative w-full', width, strong?.inner && 'text-fg')}
          style={strong?.inner ? BRAND_INNER : undefined}
        >
          {content}
        </div>
        {coloured ? <EdgeShape shape={look.dividerBottom} edge="bottom" /> : null}
      </div>
    </div>
  );
}

/** The sections a shopper gets now: visible ones within their schedule (all of them in the preview). */
export function shownSections(sections: DesignSection[]): DesignSection[] {
  const preview = isPreview();
  return sections.filter((s) => s.visible && (preview || sectionLive(s.look)));
}

const TITLE_SIZE = {
  small: 'text-lg sm:text-xl',
  regular: 'text-xl sm:text-2xl',
  large: 'text-2xl sm:text-4xl',
  huge: 'text-3xl sm:text-5xl tracking-tight',
} as const;

/** A section's heading with the kicker, size, subtitle and alignment of its frame. */
export function SectionTitle({ children, aside }: { children: string; aside?: ReactNode }) {
  const look = useLook();
  const text = useText();
  const subtitle = look ? text(look.subtitle) : '';
  const eyebrow = look ? text(look.eyebrow) : '';
  const center = look?.titleAlign === 'center';
  if (!children && !subtitle && !eyebrow)
    return aside ? <div className="mb-3 flex justify-end">{aside}</div> : null;
  return (
    <div
      className={cn(
        'mb-4 flex gap-2',
        center ? 'flex-col items-center text-center' : 'items-end justify-between',
      )}
    >
      <div className={cn(center && 'flex flex-col items-center')}>
        {eyebrow ? (
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-primary">
            {eyebrow}
          </p>
        ) : null}
        {children ? (
          <h2 className={cn('font-bold leading-tight', TITLE_SIZE[look?.titleSize ?? 'regular'])}>
            {children}
          </h2>
        ) : null}
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-fg-muted">{subtitle}</p> : null}
      </div>
      {aside}
    </div>
  );
}
