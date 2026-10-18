import type { LinkFont, LinkItemKind, LinkPageStyle, PublicLinkPage } from '@arabat/contracts';
import { cn } from '@arabat/ui';
import { type CSSProperties, type ReactNode, useEffect } from 'react';

/** What the page view needs: the public page, or the editor's page with hidden links removed. */
export type LinkPageViewData = Omit<PublicLinkPage, 'slug'>;

const RADIUS: Record<PublicLinkPage['buttonStyle'], string> = {
  rounded: 'rounded-xl',
  pill: 'rounded-full',
  square: 'rounded-none',
};

/** CSS font family of each typeface (ADR-0116 amendment 2). */
export const LINK_FONT_FAMILY: Record<LinkFont, string> = {
  default: "'IBM Plex Sans Arabic', ui-sans-serif, system-ui, sans-serif",
  cairo: "'Cairo', ui-sans-serif, system-ui, sans-serif",
  tajawal: "'Tajawal', ui-sans-serif, system-ui, sans-serif",
  almarai: "'Almarai', ui-sans-serif, system-ui, sans-serif",
  changa: "'Changa', ui-sans-serif, system-ui, sans-serif",
  'el-messiri': "'El Messiri', ui-sans-serif, system-ui, sans-serif",
  amiri: "'Amiri', ui-serif, Georgia, serif",
  'reem-kufi': "'Reem Kufi', ui-sans-serif, system-ui, sans-serif",
};

/** Self-hosted font files, loaded only when a page uses them (CSP: fonts from self only). */
const FONT_LOADERS: Record<Exclude<LinkFont, 'default'>, () => Promise<unknown>> = {
  cairo: () =>
    Promise.all([import('@fontsource/cairo/400.css'), import('@fontsource/cairo/700.css')]),
  tajawal: () =>
    Promise.all([import('@fontsource/tajawal/400.css'), import('@fontsource/tajawal/700.css')]),
  almarai: () =>
    Promise.all([import('@fontsource/almarai/400.css'), import('@fontsource/almarai/700.css')]),
  changa: () =>
    Promise.all([import('@fontsource/changa/400.css'), import('@fontsource/changa/700.css')]),
  'el-messiri': () =>
    Promise.all([
      import('@fontsource/el-messiri/400.css'),
      import('@fontsource/el-messiri/700.css'),
    ]),
  amiri: () =>
    Promise.all([import('@fontsource/amiri/400.css'), import('@fontsource/amiri/700.css')]),
  'reem-kufi': () =>
    Promise.all([import('@fontsource/reem-kufi/400.css'), import('@fontsource/reem-kufi/700.css')]),
};

export function loadLinkFont(font: LinkFont): void {
  if (font !== 'default') void FONT_LOADERS[font]().catch(() => undefined);
}

/** Black or white text, whichever reads better on `hex` (WCAG relative luminance). */
export function readableOn(hex: string): '#000000' | '#ffffff' {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return l > 0.179 ? '#000000' : '#ffffff';
}

type ThemeInput = Pick<
  LinkPageStyle,
  | 'themeColor'
  | 'background'
  | 'backgroundColor'
  | 'backgroundColor2'
  | 'textColor'
  | 'buttonTextColor'
  | 'buttonVariant'
>;

/**
 * Colours of the page (BR-198, ADR-0116 amendment 2). Text colours left empty are chosen for
 * contrast against the background or the button.
 */
export function linkPageTheme(page: ThemeInput) {
  const brand = page.themeColor;
  const base =
    page.background === 'dark'
      ? '#0f172a'
      : page.background === 'brand'
        ? brand
        : page.background === 'custom' || page.background === 'gradient'
          ? (page.backgroundColor ?? '#f8fafc')
          : '#f8fafc';
  const text = page.textColor ?? (page.background === 'dark' ? '#f8fafc' : readableOn(base));
  const pageStyle: CSSProperties =
    page.background === 'gradient'
      ? {
          backgroundImage: `linear-gradient(160deg, ${base}, ${page.backgroundColor2 ?? base})`,
          backgroundColor: base,
          color: text,
        }
      : { backgroundColor: base, color: text };
  // On a brand-coloured page the buttons are white so they stand out.
  const fill = page.background === 'brand' ? '#ffffff' : brand;
  const onFill = page.buttonTextColor ?? readableOn(fill);
  const button: CSSProperties =
    page.buttonVariant === 'outline'
      ? {
          backgroundColor: 'transparent',
          border: `2px solid ${fill}`,
          color: page.buttonTextColor ?? text,
        }
      : page.buttonVariant === 'soft'
        ? { backgroundColor: `${fill}2e`, color: page.buttonTextColor ?? text }
        : page.buttonVariant === 'shadow'
          ? {
              backgroundColor: fill,
              color: onFill,
              border: `2px solid ${text}`,
              boxShadow: `4px 4px 0 ${text}`,
            }
          : { backgroundColor: fill, color: onFill };
  return {
    page: pageStyle,
    button,
    /** The round placeholder of a page without a picture. */
    avatar: { backgroundColor: fill, color: readableOn(fill) } as CSSProperties,
    muted: 'opacity-80',
  };
}

/** The page itself, shared by the public route and the editor's live preview. */
export function LinkPageView({
  page,
  language,
  emptyLabel,
  onOpen,
  toolbar,
  className,
}: {
  page: LinkPageViewData;
  language: string;
  emptyLabel: string;
  /** Called when a visitor opens a link (counting, BR-201). */
  onOpen?: (itemId: string) => void;
  /** Shown above the picture (the language switch on the public page). */
  toolbar?: ReactNode;
  className?: string;
}) {
  const ar = language.startsWith('ar');
  const pick = (a: string | null, e: string | null) => (ar ? a || e : e || a) ?? '';
  const theme = linkPageTheme(page);
  const title = pick(page.titleAr, page.titleEn);
  const bio = pick(page.bioAr, page.bioEn);
  useEffect(() => loadLinkFont(page.font), [page.font]);
  const enter = page.animation === 'none' ? '' : `lp-enter-${page.animation}`;
  const delay = (i: number): CSSProperties => ({ animationDelay: `${i * 70}ms` });
  return (
    <div
      className={cn('min-h-full', className)}
      style={{ ...theme.page, fontFamily: LINK_FONT_FAMILY[page.font] }}
      data-font={page.font}
    >
      {/* Re-keyed on the motion so the editor's preview replays it when it changes. */}
      <div
        key={page.animation}
        className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 pb-12 pt-6"
      >
        {toolbar ? <div className="self-end">{toolbar}</div> : null}
        {page.avatarUrl ? (
          <img
            src={page.avatarUrl}
            alt=""
            className={cn(
              'size-24 rounded-full border-4 border-white/70 object-cover shadow',
              enter,
            )}
          />
        ) : (
          <div
            aria-hidden
            className={cn(
              'flex size-24 items-center justify-center rounded-full text-3xl font-bold shadow',
              enter,
            )}
            style={theme.avatar}
          >
            {title.slice(0, 1)}
          </div>
        )}
        <div className={cn('text-center', enter)} style={delay(1)}>
          <h1 className="text-2xl font-bold">{title}</h1>
          {bio ? <p className={`mt-1 whitespace-pre-line ${theme.muted}`}>{bio}</p> : null}
        </div>
        {page.items.length === 0 ? (
          <p className={theme.muted}>{emptyLabel}</p>
        ) : (
          <ul className="flex w-full flex-col gap-3">
            {page.items.map((item, index) => (
              <li key={item.id} className={enter} style={delay(index + 2)}>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  onClick={() => onOpen?.(item.id)}
                  data-effect={item.effect}
                  className={cn(
                    'flex min-h-14 w-full items-center gap-3 px-4 py-3 font-medium shadow-sm transition hover:scale-[1.02] hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
                    RADIUS[page.buttonStyle],
                    item.effect !== 'none' && `lp-fx-${item.effect}`,
                  )}
                  style={theme.button}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center">
                    {item.emoji ? (
                      <span className="text-xl leading-none" aria-hidden>
                        {item.emoji}
                      </span>
                    ) : (
                      <LinkIcon kind={item.kind} />
                    )}
                  </span>
                  <span className="flex-1 text-center">{pick(item.labelAr, item.labelEn)}</span>
                  <span className="size-6 shrink-0" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const svg = (children: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    width="22"
    height="22"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {children}
  </svg>
);

/** Simple outline glyphs per link kind (no third-party logos are bundled). */
export function LinkIcon({ kind }: { kind: LinkItemKind }) {
  switch (kind) {
    case 'instagram':
      return svg(
        <>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" />
        </>,
      );
    case 'whatsapp':
    case 'phone':
      return svg(
        <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />,
      );
    case 'email':
      return svg(
        <>
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="m22 7-10 6L2 7" />
        </>,
      );
    case 'location':
      return svg(
        <>
          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
          <circle cx="12" cy="10" r="3" />
        </>,
      );
    case 'store':
      return svg(
        <>
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
          <path d="M3 6h18" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </>,
      );
    case 'youtube':
      return svg(
        <>
          <rect x="2" y="5" width="20" height="14" rx="4" />
          <path d="m10 9 5 3-5 3z" />
        </>,
      );
    case 'tiktok':
      return svg(
        <>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </>,
      );
    case 'x':
      return svg(<path d="M4 4l16 16M20 4 4 20" />);
    case 'facebook':
      return svg(<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />);
    case 'telegram':
      return svg(
        <>
          <path d="m22 2-7 20-4-9-9-4z" />
          <path d="M22 2 11 13" />
        </>,
      );
    case 'snapchat':
      return svg(
        <path d="M12 3a5 5 0 0 0-5 5v3l-2 1 2 1c-1 2-2 3-4 4 2 1 3 1 4 2 1 1 3 2 5 2s4-1 5-2c1-1 2-1 4-2-2-1-3-2-4-4l2-1-2-1V8a5 5 0 0 0-5-5z" />,
      );
    case 'website':
      return svg(
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
        </>,
      );
    default:
      return svg(
        <>
          <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
          <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
        </>,
      );
  }
}
