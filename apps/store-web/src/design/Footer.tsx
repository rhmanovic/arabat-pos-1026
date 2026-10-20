import { type FooterBlock, type FooterDesign, WEEKDAYS } from '@arabat/contracts';
import { cn } from '@arabat/ui';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useBranchChoice, useLocalName, useSlug, useStorefront } from '../shared.js';
import { useDesign, useText } from './context.js';
import { DesignAnchor, LanguageButton, SocialLinks, StoreIcon, useSocialLinks } from './parts.js';

/*
 * Store footer (ADR-0128 amendment 2): seven layouts, four colours, an edge shape, a call to
 * action, reassurance badges, the store's brand, up to six blocks that fold on phones, and a
 * bottom line (copyright, policy links, payment methods, language, back to top).
 */

const TONE: Record<FooterDesign['background'], { box: string; edge: string; line: string }> = {
  light: { box: 'bg-surface text-fg', edge: 'text-surface', line: 'border-border' },
  tinted: { box: 'bg-primary-soft text-fg', edge: 'text-primary-soft', line: 'border-current/10' },
  brand: { box: 'bg-primary text-primary-fg', edge: 'text-primary', line: 'border-white/15' },
  dark: { box: 'bg-[#111] text-white', edge: 'text-[#111]', line: 'border-white/10' },
};
const SPACING: Record<FooterDesign['spacing'], string> = {
  compact: 'py-6 gap-6',
  regular: 'py-10 gap-8',
  roomy: 'py-16 gap-10',
};
const GRID = ['', 'lg:grid-cols-1', 'lg:grid-cols-2', 'lg:grid-cols-3', 'lg:grid-cols-4'];
/** Blocks with a title that fold into a tappable row on phones. */
const FOLDING = new Set<FooterBlock['type']>([
  'about',
  'links',
  'categories',
  'contact',
  'hours',
  'branches',
  'text',
]);

/** A wave or a curve in the footer's colour, drawn over the bottom of the page. */
function Edge({ shape, className }: { shape: 'wave' | 'curve'; className: string }) {
  const d =
    shape === 'wave'
      ? 'M0 48V24C240 0 480 48 720 24S1200 0 1440 24V48Z'
      : 'M0 48C480 0 960 0 1440 48Z';
  return (
    <svg
      viewBox="0 0 1440 48"
      preserveAspectRatio="none"
      aria-hidden
      focusable="false"
      className={cn('-mb-px block h-8 w-full sm:h-12', className)}
    >
      <path d={d} fill="currentColor" />
    </svg>
  );
}

export function Footer() {
  const { data: store } = useStorefront();
  const { footer } = useDesign();
  if (!store) return null;
  const tone = TONE[footer.background];
  const plain = footer.layout === 'simple' && footer.background === 'light';
  const width = footer.width === 'full' ? 'w-full px-4 sm:px-8' : 'mx-auto w-full max-w-6xl px-4';
  const curved = footer.topEdge === 'wave' || footer.topEdge === 'curve';
  return (
    <div className={cn(footer.layout !== 'simple' && 'mt-10')}>
      {curved && !plain ? (
        <Edge shape={footer.topEdge as 'wave' | 'curve'} className={tone.edge} />
      ) : null}
      <footer
        className={cn(
          plain ? 'text-fg-muted' : tone.box,
          footer.topEdge === 'line' && !plain && cn('border-t', tone.line),
        )}
        data-testid="store-footer"
        data-layout={footer.layout}
      >
        {footer.layout === 'simple' ? (
          <SimpleFooter width={width} />
        ) : footer.layout === 'minimal' ? (
          <div className={width}>
            <Cta />
            <BottomBar inline />
          </div>
        ) : (
          <>
            <div className={cn(width, 'flex flex-col', SPACING[footer.spacing])}>
              <Cta />
              <Body />
            </div>
            <div className={cn('border-t', tone.line)}>
              <div className={width}>
                <BottomBar />
              </div>
            </div>
          </>
        )}
      </footer>
    </div>
  );
}

/** The first footer: blocks in a row, then the small print (legacy stores keep this look). */
function SimpleFooter({ width }: { width: string }) {
  const { footer } = useDesign();
  return (
    <div className={cn(width, 'py-4 text-sm')}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        {footer.blocks.map((b) => (
          <BlockView key={b.id} block={b} fold={false} />
        ))}
      </div>
      <BottomBar inline />
    </div>
  );
}

function Body() {
  const { footer } = useDesign();
  const blocks = footer.blocks;
  const hasSocialBlock = blocks.some((b) => b.type === 'social');
  const fold = footer.mobileCollapse;
  const count = (max: number) =>
    Math.min(max, footer.columns === 'auto' ? Math.max(blocks.length, 1) : Number(footer.columns));
  const grid = (max: number, extra?: string) =>
    blocks.length > 0 ? (
      <div
        className={cn(
          'grid sm:grid-cols-2 sm:gap-8',
          fold ? 'gap-0 max-sm:divide-y max-sm:divide-current/10' : 'gap-6',
          GRID[count(max)],
          extra,
        )}
      >
        {blocks.map((b) => (
          <BlockView key={b.id} block={b} fold={fold} />
        ))}
      </div>
    ) : null;
  switch (footer.layout) {
    case 'split':
      return (
        <>
          <Badges />
          <div className="flex flex-col gap-8 lg:flex-row lg:gap-12">
            <Brand social={!hasSocialBlock} className="lg:w-80 lg:shrink-0" />
            <div className="min-w-0 flex-1">{grid(3)}</div>
          </div>
        </>
      );
    case 'stacked':
      return (
        <>
          <Brand
            social={!hasSocialBlock}
            row
            className="border-b border-current/10 pb-8 max-sm:items-center max-sm:text-center"
          />
          <Badges />
          {grid(4)}
        </>
      );
    case 'centered':
      return (
        <>
          <Brand social={!hasSocialBlock} center />
          <Badges />
          {blocks.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-x-12 gap-y-6 text-center">
              {blocks.map((b) => (
                <BlockView key={b.id} block={b} fold={false} center />
              ))}
            </div>
          ) : null}
        </>
      );
    case 'cards':
      return (
        <>
          <Badges />
          <div className={cn('grid gap-4 sm:grid-cols-2', GRID[count(3) + 1] ?? 'lg:grid-cols-4')}>
            <Brand social={!hasSocialBlock} className="rounded-2xl bg-current/[0.06] p-5" />
            {blocks.map((b) => (
              <div key={b.id} className="rounded-2xl bg-current/[0.06] p-5">
                <BlockView block={b} fold={false} />
              </div>
            ))}
          </div>
        </>
      );
    default:
      return (
        <>
          <Badges />
          {grid(4)}
        </>
      );
  }
}

// ---------------------------------------------------------------------- brand
function Brand({
  social,
  center = false,
  row = false,
  className,
}: {
  social: boolean;
  center?: boolean;
  row?: boolean;
  className?: string;
}) {
  const { data: store } = useStorefront();
  const { footer } = useDesign();
  const slug = useSlug();
  const name = useLocalName();
  const text = useText();
  const { i18n } = useTranslation();
  if (!store) return null;
  const ar = i18n.language.startsWith('ar');
  const words =
    text(footer.brand.text) ||
    (footer.brand.showTagline
      ? (ar ? store.taglineAr || store.taglineEn : store.taglineEn || store.taglineAr) || ''
      : '');
  const logo = footer.brand.showLogo && store.logoUrl;
  if (!logo && !footer.brand.showName && !words && !social) return null;
  return (
    <div
      className={cn(
        'flex flex-col gap-4',
        center && 'items-center text-center',
        row && 'sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
      data-testid="footer-brand"
    >
      <div className={cn('flex flex-col gap-3', center && 'items-center')}>
        {logo || footer.brand.showName ? (
          <Link to={`/${slug}`} className="inline-flex items-center gap-3">
            {logo ? (
              <img src={store.logoUrl!} alt="" className="size-12 rounded-full object-cover" />
            ) : null}
            {footer.brand.showName ? (
              <span className="text-xl font-extrabold tracking-tight">{name(store)}</span>
            ) : (
              <span className="sr-only">{name(store)}</span>
            )}
          </Link>
        ) : null}
        {words ? (
          <p className="max-w-md text-sm leading-relaxed whitespace-pre-line opacity-80">{words}</p>
        ) : null}
      </div>
      {social ? <SocialLinks variant={footer.socialStyle} /> : null}
    </div>
  );
}

// ------------------------------------------------------------- call to action
function Cta() {
  const { footer } = useDesign();
  const text = useText();
  const { cta } = footer;
  const title = text(cta.title);
  const button = text(cta.button);
  if (!cta.enabled || (!title && !button)) return null;
  const onColour = footer.background === 'brand' || footer.background === 'dark';
  return (
    <section
      className={cn(
        'my-6 flex flex-col items-start gap-4 rounded-2xl p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8',
        onColour ? 'bg-white/10' : 'bg-primary text-primary-fg',
      )}
      data-testid="footer-cta"
    >
      <div>
        {title ? <h2 className="text-xl font-extrabold sm:text-2xl">{title}</h2> : null}
        {text(cta.text) ? <p className="mt-1 text-sm opacity-85">{text(cta.text)}</p> : null}
      </div>
      {button ? (
        <DesignAnchor
          link={cta.link}
          className="inline-flex h-11 shrink-0 items-center rounded-full bg-white px-6 text-sm font-bold text-[#111] shadow-sm transition-transform hover:-translate-y-0.5"
        >
          {button}
        </DesignAnchor>
      ) : null}
    </section>
  );
}

// -------------------------------------------------------------------- badges
function Badges() {
  const { footer } = useDesign();
  const text = useText();
  const badges = footer.badges.filter((b) => text(b.title));
  if (badges.length === 0) return null;
  return (
    <ul
      className={cn(
        'grid grid-cols-1 gap-3 sm:grid-cols-2',
        badges.length >= 3 ? 'lg:grid-cols-3' : '',
        badges.length === 4 ? 'xl:grid-cols-4' : '',
      )}
      data-testid="footer-badges"
    >
      {badges.map((b) => (
        <li key={b.id} className="flex items-center gap-3 rounded-2xl bg-current/[0.06] p-3 sm:p-4">
          {b.icon ? (
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-full bg-current/10 text-lg sm:size-11 sm:text-xl"
            >
              {b.icon}
            </span>
          ) : null}
          <span className="min-w-0">
            <span className="block text-sm font-bold">{text(b.title)}</span>
            {text(b.text) ? <span className="block text-xs opacity-75">{text(b.text)}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

// -------------------------------------------------------------------- blocks
/** A block's title; on phones a titled block can fold into a button that opens it. */
function Fold({
  title,
  fold,
  center,
  children,
}: {
  title: string;
  fold: boolean;
  center: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!title) return <div>{children}</div>;
  if (!fold)
    return (
      <div>
        <h2 className={cn('mb-3 text-sm font-bold', center && 'text-center')}>{title}</h2>
        {children}
      </div>
    );
  return (
    <div>
      <h2 className="mb-3 text-sm font-bold max-sm:hidden">{title}</h2>
      <button
        type="button"
        className="flex w-full items-center justify-between py-4 text-start text-sm font-bold sm:hidden"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {title}
        <StoreIcon
          name="chevron"
          className={cn('size-4 transition-transform', open && 'rotate-180')}
        />
      </button>
      <div id={id} className={cn(!open && 'max-sm:hidden', 'max-sm:pb-4')}>
        {children}
      </div>
    </div>
  );
}

function BlockView({
  block,
  fold,
  center = false,
}: {
  block: FooterBlock;
  fold: boolean;
  center?: boolean;
}) {
  const slug = useSlug();
  const { data: store } = useStorefront();
  const { branch } = useBranchChoice();
  const { footer } = useDesign();
  const text = useText();
  const name = useLocalName();
  const social = useSocialLinks();
  const { t, i18n } = useTranslation();
  if (!store) return null;
  const ar = i18n.language.startsWith('ar');
  const title = text(block.title);
  const list = cn('flex flex-col gap-2 text-sm opacity-85', center && 'items-center');
  const frame = (children: ReactNode) => (
    <Fold title={title} fold={fold && FOLDING.has(block.type)} center={center}>
      {children}
    </Fold>
  );
  // A block with nothing to show stays out of the footer.
  switch (block.type) {
    case 'about': {
      const body =
        text(block.text) ||
        (ar ? store.taglineAr || store.taglineEn : store.taglineEn || store.taglineAr) ||
        name(store);
      return frame(
        <p className="text-sm leading-relaxed whitespace-pre-line opacity-85">{body}</p>,
      );
    }
    case 'text':
      return text(block.text)
        ? frame(
            <p className="text-sm leading-relaxed whitespace-pre-line opacity-85">
              {text(block.text)}
            </p>,
          )
        : null;
    case 'links':
      if (block.links.length === 0) return null;
      return frame(
        <ul className={list}>
          {block.links.map((l) => (
            <li key={l.id}>
              <DesignAnchor link={l.link} className="hover:underline">
                {text(l.label)}
              </DesignAnchor>
            </li>
          ))}
        </ul>,
      );
    case 'categories':
      if (store.categories.length === 0) return null;
      return frame(
        <ul className={list}>
          {store.categories.slice(0, 8).map((c) => (
            <li key={c.id}>
              <Link to={`/${slug}/products?category=${c.id}`} className="hover:underline">
                {name(c)}
              </Link>
            </li>
          ))}
        </ul>,
      );
    case 'contact': {
      const whatsapp = social.find((s) => s.key === 'whatsapp');
      if (!store.contactPhone && !store.contactEmail && !branch?.address && !whatsapp) return null;
      const row = 'inline-flex items-center gap-2 hover:underline';
      return frame(
        <ul className={list}>
          {store.contactPhone ? (
            <li>
              <a href={`tel:${store.contactPhone}`} className={row}>
                <StoreIcon name="phone" className="size-4 shrink-0" />
                <span dir="ltr">{store.contactPhone}</span>
              </a>
            </li>
          ) : null}
          {whatsapp ? (
            <li>
              <a href={whatsapp.href} target="_blank" rel="noreferrer noopener" className={row}>
                <StoreIcon name="whatsapp" className="size-4 shrink-0" />
                {whatsapp.label}
              </a>
            </li>
          ) : null}
          {store.contactEmail ? (
            <li>
              <a href={`mailto:${store.contactEmail}`} className={row}>
                <StoreIcon name="mail" className="size-4 shrink-0" />
                {store.contactEmail}
              </a>
            </li>
          ) : null}
          {branch?.address && title ? (
            <li className="inline-flex items-start gap-2">
              <StoreIcon name="pin" className="mt-0.5 size-4 shrink-0" />
              {branch.address}
            </li>
          ) : null}
        </ul>,
      );
    }
    case 'hours': {
      const today = WEEKDAYS[(new Date().getDay() + 6) % 7];
      return frame(
        branch?.hours ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm opacity-85">
            {WEEKDAYS.map((d) => (
              <div key={d} className={cn('contents', d === today && 'font-bold')}>
                <dt>{t(`days.${d}`)}</dt>
                <dd dir="ltr" className="text-end tabular-nums">
                  {branch.hours![d].length === 0
                    ? t('info.closedDay')
                    : branch.hours![d].map((r) => `${r.open}–${r.close}`).join(', ')}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="inline-flex items-center gap-2 text-sm opacity-85">
            <StoreIcon name="clock" className="size-4" />
            {t('info.alwaysOpen')}
          </p>
        ),
      );
    }
    case 'branches':
      if (store.branches.length === 0) return null;
      return frame(
        <ul className="flex flex-col gap-3 text-sm">
          {store.branches.map((b) => (
            <li key={b.id} className={cn('flex flex-col gap-0.5', center && 'items-center')}>
              <span className="inline-flex items-center gap-2 font-semibold">
                {name(b)}
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[0.65rem] font-bold',
                    b.openNow ? 'bg-emerald-500/15' : 'bg-current/10',
                  )}
                >
                  {b.openNow ? t('info.openNow') : t('info.closedNow')}
                </span>
              </span>
              {b.address ? (
                <span className="inline-flex items-start gap-1.5 opacity-80">
                  <StoreIcon name="pin" className="mt-0.5 size-3.5 shrink-0" />
                  {b.address}
                </span>
              ) : null}
              {b.phone ? (
                <a href={`tel:${b.phone}`} dir="ltr" className="w-fit opacity-80 hover:underline">
                  {b.phone}
                </a>
              ) : null}
            </li>
          ))}
        </ul>,
      );
    case 'social':
      if (social.length === 0) return null;
      return frame(
        <SocialLinks variant={footer.socialStyle} className={cn(center && 'justify-center')} />,
      );
    case 'payments':
      return <PaymentChips title={title} center={center} />;
  }
}

function PaymentChips({ title, center = false }: { title?: string; center?: boolean }) {
  const { data: store } = useStorefront();
  const name = useLocalName();
  const { t } = useTranslation();
  if (!store || (store.paymentMethods.length === 0 && !store.payOnReceipt)) return null;
  const chip =
    'inline-flex items-center gap-1.5 rounded-lg border border-current/20 px-2.5 py-1 text-xs font-semibold';
  return (
    <div>
      {title ? (
        <h2 className={cn('mb-3 text-sm font-bold', center && 'text-center')}>{title}</h2>
      ) : null}
      <ul
        className={cn('flex flex-wrap gap-2', center && 'justify-center')}
        aria-label={t('footer.payments')}
      >
        {store.paymentMethods.map((m) => (
          <li key={m.id} className={chip}>
            <StoreIcon name="card" className="size-3.5" />
            {name(m)}
          </li>
        ))}
        {store.payOnReceipt ? <li className={chip}>{t('info.payOnReceipt')}</li> : null}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- bottom line
function BottomBar({ inline = false }: { inline?: boolean }) {
  const { data: store } = useStorefront();
  const { footer } = useDesign();
  const name = useLocalName();
  const text = useText();
  const { t } = useTranslation();
  if (!store) return null;
  const { bottom } = footer;
  const minimal = footer.layout === 'minimal';
  const copyright = bottom.showCopyright
    ? text(bottom.copyright) ||
      t('footer.copyright', { year: new Date().getFullYear(), name: name(store) })
    : null;
  const centered = footer.layout === 'centered';
  const items = [
    copyright ? (
      <span key="copyright" className="opacity-75">
        {copyright}
      </span>
    ) : null,
    bottom.links.length > 0 ? (
      <ul key="links" className="flex flex-wrap gap-x-4 gap-y-1">
        {bottom.links.map((l) => (
          <li key={l.id}>
            <DesignAnchor link={l.link} className="opacity-80 hover:underline hover:opacity-100">
              {text(l.label)}
            </DesignAnchor>
          </li>
        ))}
      </ul>
    ) : null,
    minimal ? <SocialLinks key="social" size="sm" variant={footer.socialStyle} /> : null,
    bottom.showPayments ? <PaymentChips key="payments" /> : null,
    bottom.showLanguage ? <LanguageButton key="language" /> : null,
    footer.showPoweredBy ? (
      <a
        key="powered"
        href="https://www.arabatapp.com"
        target="_blank"
        rel="noreferrer noopener"
        className="opacity-70 hover:opacity-100"
      >
        {t('footer.poweredBy')}
      </a>
    ) : null,
    bottom.showBackToTop ? (
      <button
        key="top"
        type="button"
        onClick={() => window.scrollTo?.({ top: 0, behavior: 'smooth' })}
        aria-label={t('footer.backToTop')}
        title={t('footer.backToTop')}
        className="grid size-9 place-items-center rounded-full bg-current/10 transition-colors hover:bg-current/20"
      >
        <StoreIcon name="arrowUp" className="size-4" />
      </button>
    ) : null,
  ].filter(Boolean);
  if (items.length === 0) return null;
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-6 gap-y-3 text-xs',
        inline ? 'pt-4' : 'py-5',
        minimal && 'py-5',
        centered ? 'justify-center text-center' : 'justify-between',
      )}
      data-testid="footer-bottom"
    >
      {items}
    </div>
  );
}
