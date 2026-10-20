import type { DesignSection, SectionLook } from '@arabat/contracts';
import { cn } from '@arabat/ui';
import { type CSSProperties, type ReactNode, createContext, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { isPreview, useText } from './context.js';

/*
 * The frame every designed section sits in (ADR-0128 amendment 3): its background, spacing,
 * width, heading alignment and subtitle, the screens it shows on, and its schedule.
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
// A band in the brand colour: text in the colour readable on it, buttons inverted.
const BRAND_OUTER = {
  '--section-brand': 'var(--color-primary)',
  '--section-on': 'var(--color-primary-fg)',
} as CSSProperties;
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

const PAD = {
  plain: { compact: 'py-1', regular: 'py-4', roomy: 'py-8' },
  coloured: { compact: 'py-6', regular: 'py-10', roomy: 'py-16' },
} as const;

export function SectionFrame({
  section,
  children,
}: {
  section: DesignSection;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const look = section.look;
  const coloured = look.background !== 'none';
  const bleed = coloured || look.width === 'full';
  const live = sectionLive(look);
  const devices =
    look.devices === 'desktop' ? 'max-sm:hidden' : look.devices === 'phone' ? 'sm:hidden' : '';
  const bg = {
    none: '',
    soft: 'bg-surface-muted',
    tinted: 'bg-primary-soft',
    brand: 'bg-primary',
    dark: 'bg-canvas text-fg',
  }[look.background];
  return (
    <div
      id={`section-${section.id}`}
      data-section={section.type}
      data-background={look.background}
      className={cn('relative scroll-mt-20', devices, !live && 'opacity-60')}
    >
      {!live ? (
        // Only the preview shows sections outside their schedule (shoppers never get them).
        <p className="absolute top-2 start-2 z-20 rounded-full bg-fg px-3 py-1 text-xs font-semibold text-canvas">
          {t('design.notLiveNow')}
        </p>
      ) : null}
      <div
        className={cn(bleed && full, bg, PAD[coloured ? 'coloured' : 'plain'][look.spacing])}
        style={
          look.background === 'dark' ? DARK : look.background === 'brand' ? BRAND_OUTER : undefined
        }
      >
        <div
          className={cn(
            bleed && (look.width === 'full' ? 'px-4 sm:px-8' : 'mx-auto max-w-6xl px-4'),
            look.background === 'brand' && 'text-fg',
          )}
          style={look.background === 'brand' ? BRAND_INNER : undefined}
        >
          <LookContext.Provider value={look}>{children}</LookContext.Provider>
        </div>
      </div>
    </div>
  );
}

/** The sections a shopper gets now: visible ones within their schedule (all of them in the preview). */
export function shownSections(sections: DesignSection[]): DesignSection[] {
  const preview = isPreview();
  return sections.filter((s) => s.visible && (preview || sectionLive(s.look)));
}

/** A section's heading with the subtitle and alignment of its frame. */
export function SectionTitle({ children, aside }: { children: string; aside?: ReactNode }) {
  const look = useLook();
  const text = useText();
  const subtitle = look ? text(look.subtitle) : '';
  const center = look?.titleAlign === 'center';
  if (!children && !subtitle)
    return aside ? <div className="mb-3 flex justify-end">{aside}</div> : null;
  return (
    <div
      className={cn(
        'mb-4 flex gap-2',
        center ? 'flex-col items-center text-center' : 'items-end justify-between',
      )}
    >
      <div className={cn(center && 'flex flex-col items-center')}>
        {children ? <h2 className="text-xl font-bold sm:text-2xl">{children}</h2> : null}
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-fg-muted">{subtitle}</p> : null}
      </div>
      {aside}
    </div>
  );
}
