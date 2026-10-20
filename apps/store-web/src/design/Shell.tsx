import { type DesignLink, type FooterBlock, WEEKDAYS } from '@arabat/contracts';
import { Alert, Select, cn } from '@arabat/ui';
import { LanguageSwitcher } from '@arabat/web-core';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useCart } from '../cart.js';
import {
  setPageMeta,
  useAccount,
  useBranchChoice,
  useLocalName,
  useSlug,
  useStorefront,
} from '../shared.js';
import { isPreview, linkTarget, useDesign, useText, useThemeVariables } from './context.js';

// ----------------------------------------------------------------------------- icons
const ICONS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M18 6 6 18M6 6l12 12',
  cart: 'M6 6h15l-1.5 9h-12zM6 6 5 3H2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
} as const;
export function StoreIcon({ name, className }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className ?? 'size-5'}
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

/** A design link as a router link or an outside link (opened in a new tab). */
export function DesignAnchor({
  link,
  className,
  children,
}: {
  link: DesignLink | null;
  className?: string;
  children: ReactNode;
}) {
  const slug = useSlug();
  const target = linkTarget(slug, link);
  if (!target) return <span className={className}>{children}</span>;
  return target.external ? (
    <a href={target.to} target="_blank" rel="noreferrer noopener" className={className}>
      {children}
    </a>
  ) : (
    <Link to={target.to} className={className}>
      {children}
    </Link>
  );
}

const SOCIAL = {
  instagram: (h: string) => `https://instagram.com/${h}`,
  tiktok: (h: string) => `https://www.tiktok.com/@${h}`,
  snapchat: (h: string) => `https://www.snapchat.com/add/${h}`,
  x: (h: string) => `https://x.com/${h}`,
  youtube: (h: string) => `https://www.youtube.com/@${h}`,
  whatsapp: (h: string) => `https://wa.me/${h.replace(/^\+/, '')}`,
} as const;

function useSocialLinks() {
  const { social } = useDesign();
  const { t } = useTranslation();
  return (Object.keys(SOCIAL) as (keyof typeof SOCIAL)[])
    .filter((k) => social[k])
    .map((k) => ({ key: k, href: SOCIAL[k](social[k]), label: t(`social.${k}`) }));
}

/** Header and drawer navigation; without items the three designed pages. */
function useNavItems(): { id: string; label: string; link: DesignLink }[] {
  const { navbar, template } = useDesign();
  const text = useText();
  const { t } = useTranslation();
  if (navbar.items.length > 0)
    return navbar.items.map((i) => ({ id: i.id, label: text(i.label), link: i.link }));
  return [
    { id: 'home', label: t('nav.home'), link: { kind: 'page', page: 'home' } },
    {
      id: 'products',
      label: template === 'restaurant' ? t('nav.menu') : t('nav.catalog'),
      link: { kind: 'page', page: 'products' },
    },
    { id: 'categories', label: t('nav.categories'), link: { kind: 'page', page: 'categories' } },
  ];
}

// ----------------------------------------------------------------------------- shell
/** Public storefront shell (ADR-0128): every part follows the published design. */
export function StoreShell() {
  const { data: store } = useStorefront();
  const design = useDesign();
  const name = useLocalName();
  const { t, i18n } = useTranslation();
  const [drawer, setDrawer] = useState(false);
  const location = useLocation();
  useThemeVariables(store?.primaryColor ?? '#0f766e');
  const storeName = store ? name(store) : '';
  const ar = i18n.language.startsWith('ar');
  const tagline = store
    ? ar
      ? store.taglineAr || store.taglineEn
      : store.taglineEn || store.taglineAr
    : null;
  useEffect(() => {
    if (storeName)
      setPageMeta({
        title: storeName,
        description: tagline,
        image: store?.logoUrl ?? store?.bannerUrl ?? null,
        jsonLd: null,
      });
  }, [storeName, tagline, store?.logoUrl, store?.bannerUrl]);
  // A page change closes the side menu.
  const [path, setPath] = useState(location.pathname);
  if (path !== location.pathname) {
    setPath(location.pathname);
    setDrawer(false);
  }
  if (!store) return null;
  const announcement = ar
    ? store.announcementAr || store.announcementEn
    : store.announcementEn || store.announcementAr;
  const bar = design.mobileBar.enabled;
  return (
    <div
      className={cn(
        'flex min-h-dvh flex-col overflow-x-clip bg-canvas text-fg',
        bar && 'max-sm:pb-16',
      )}
    >
      {isPreview() ? (
        <p className="bg-fg py-1 text-center text-xs font-medium text-canvas">
          {t('design.previewBadge')}
        </p>
      ) : null}
      {announcement ? (
        <p
          className={cn(
            'px-4 py-2 text-center text-sm font-medium',
            design.announcement.style === 'brand' && 'bg-primary text-primary-fg',
            design.announcement.style === 'dark' && 'bg-[#111] text-white',
            design.announcement.style === 'soft' && 'bg-primary-soft text-fg',
          )}
          data-testid="announcement"
        >
          {announcement}
        </p>
      ) : null}
      <Header tagline={tagline} onMenu={() => setDrawer(true)} />
      {drawer ? <Drawer onClose={() => setDrawer(false)} /> : null}
      <main className="mx-auto w-full max-w-6xl flex-1 p-4">
        {!store.acceptingOrders ? (
          <Alert tone="warning" className="mb-4">
            {t('closed')}
          </Alert>
        ) : null}
        <Outlet />
      </main>
      <Footer />
      {bar ? <MobileBar /> : null}
    </div>
  );
}

function Brand({ tagline, centered = false }: { tagline: string | null; centered?: boolean }) {
  const slug = useSlug();
  const { data: store } = useStorefront();
  const name = useLocalName();
  const { header } = useDesign();
  if (!store) return null;
  return (
    <Link
      to={`/${slug}`}
      className={cn('flex min-w-0 items-center gap-3', centered && 'flex-col gap-1 text-center')}
    >
      {store.logoUrl ? (
        <img
          src={store.logoUrl}
          alt=""
          className={cn(
            'shrink-0 rounded-full border border-current/10 object-cover',
            centered ? 'size-14' : 'size-10',
          )}
          data-testid="store-logo"
        />
      ) : null}
      <span className="min-w-0">
        <span className="block truncate text-lg font-bold leading-tight">{name(store)}</span>
        {header.showTagline && tagline ? (
          <span className="block truncate text-xs opacity-75">{tagline}</span>
        ) : null}
      </span>
    </Link>
  );
}

function Nav({ className, vertical = false }: { className?: string; vertical?: boolean }) {
  const slug = useSlug();
  const { navbar } = useDesign();
  const items = useNavItems();
  const style = vertical ? 'links' : navbar.style;
  return (
    <ul className={cn('flex gap-1', vertical ? 'flex-col' : 'flex-wrap items-center', className)}>
      {items.map((item) => {
        const target = linkTarget(slug, item.link);
        if (!target) return null;
        const base = cn(
          'inline-flex items-center whitespace-nowrap text-sm font-medium transition-colors',
          vertical && 'w-full rounded-md px-3 py-3 hover:bg-surface-muted',
          !vertical && style === 'links' && 'px-3 py-2 opacity-80 hover:opacity-100',
          !vertical && style === 'underline' && 'border-b-2 border-transparent px-3 py-2',
          !vertical && style === 'pills' && 'rounded-full px-4 py-1.5',
        );
        return (
          <li key={item.id}>
            {target.external ? (
              <a href={target.to} target="_blank" rel="noreferrer noopener" className={base}>
                {item.label}
              </a>
            ) : (
              <NavLink
                to={target.to}
                end={target.to === `/${slug}`}
                className={({ isActive }) =>
                  cn(
                    base,
                    isActive && style === 'links' && 'opacity-100',
                    isActive && style === 'underline' && 'border-current',
                    isActive && style === 'pills' && 'bg-primary text-primary-fg',
                    isActive && vertical && 'bg-surface-muted font-semibold',
                  )
                }
              >
                {item.label}
              </NavLink>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function BranchPicker({ className }: { className?: string }) {
  const { data: store } = useStorefront();
  const { branchId, setBranchId } = useBranchChoice();
  const name = useLocalName();
  const { t } = useTranslation();
  const pickup = store?.branches.filter((b) => b.pickupEnabled) ?? [];
  if (pickup.length <= 1) return null;
  return (
    <Select
      aria-label={t('nav.branch')}
      className={cn('w-40 text-fg', className)}
      value={branchId ?? ''}
      onChange={(e) => setBranchId(e.target.value || null)}
    >
      {pickup.map((b) => (
        <option key={b.id} value={b.id}>
          {name(b)}
        </option>
      ))}
    </Select>
  );
}

function Actions({ onMenu }: { onMenu: () => void }) {
  const slug = useSlug();
  const { data: store } = useStorefront();
  const { header } = useDesign();
  const cart = useCart();
  const { token } = useAccount();
  const { t } = useTranslation();
  const icon =
    'inline-flex size-10 shrink-0 items-center justify-center gap-2 rounded-full hover:bg-current/10';
  return (
    <div className="flex shrink-0 items-center gap-1">
      <BranchPicker className="max-md:hidden" />
      {header.showSearch ? (
        <Link to={`/${slug}/products?search=1`} className={icon} aria-label={t('catalog.search')}>
          <StoreIcon name="search" />
        </Link>
      ) : null}
      {store?.accountsEnabled || token ? (
        <Link
          to={`/${slug}/account`}
          className="inline-flex h-10 items-center gap-2 rounded-full px-2 text-sm font-medium hover:bg-current/10 sm:px-3"
        >
          <StoreIcon name="user" />
          <span className="max-sm:sr-only">{token ? t('nav.account') : t('nav.signIn')}</span>
        </Link>
      ) : null}
      <Link
        to={`/${slug}/cart`}
        className="relative inline-flex h-10 items-center gap-2 rounded-full border border-current/20 px-3 text-sm font-semibold whitespace-nowrap hover:bg-current/10"
      >
        <StoreIcon name="cart" />
        <span className="max-sm:sr-only">{t('nav.cartCount', { count: cart.count })}</span>
        {cart.count > 0 ? (
          <span
            aria-hidden
            className="grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[0.7rem] font-bold text-primary-fg sm:hidden"
          >
            {cart.count}
          </span>
        ) : null}
      </Link>
      <div className="max-sm:hidden">
        <LanguageSwitcher />
      </div>
      <button
        type="button"
        className={cn(icon, 'sm:hidden')}
        aria-label={t('nav.openMenu')}
        onClick={onMenu}
      >
        <StoreIcon name="menu" />
      </button>
    </div>
  );
}

function Header({ tagline, onMenu }: { tagline: string | null; onMenu: () => void }) {
  const { header, navbar, drawer } = useDesign();
  const { t } = useTranslation();
  const tone = {
    light: 'border-b border-border bg-surface text-fg',
    brand: 'bg-primary text-primary-fg',
    dark: 'bg-[#111] text-white',
  }[header.background];
  const showNav = navbar.style !== 'hidden' && header.layout !== 'minimal';
  const menuButton = drawer.enabled ? (
    <button
      type="button"
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-current/10',
        showNav && 'max-sm:hidden lg:hidden',
      )}
      aria-label={t('nav.openMenu')}
      onClick={onMenu}
    >
      <StoreIcon name="menu" />
    </button>
  ) : null;
  return (
    <header className={cn(tone, header.sticky && 'sticky top-0 z-30')} data-testid="store-header">
      {header.layout === 'centered' ? (
        <div className="mx-auto max-w-6xl px-4">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-3">
            <div className="flex items-center">{menuButton}</div>
            <Brand tagline={tagline} centered />
            <div className="flex justify-end">
              <Actions onMenu={onMenu} />
            </div>
          </div>
          {showNav ? <Nav className="justify-center pb-2 max-sm:hidden" /> : null}
        </div>
      ) : (
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          {menuButton}
          <div className="min-w-0 flex-1 sm:flex-none">
            <Brand tagline={tagline} />
          </div>
          {showNav ? (
            <Nav className="flex-1 justify-center max-lg:hidden" />
          ) : (
            <div className="flex-1 max-sm:hidden" />
          )}
          <Actions onMenu={onMenu} />
        </div>
      )}
    </header>
  );
}

// ---------------------------------------------------------------------------- drawer
function Drawer({ onClose }: { onClose: () => void }) {
  const slug = useSlug();
  const { data: store } = useStorefront();
  const { drawer } = useDesign();
  const name = useLocalName();
  const social = useSocialLinks();
  const { token } = useAccount();
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!store) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal aria-label={t('nav.menuLabel')}>
      <button
        type="button"
        aria-label={t('nav.closeMenu')}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="absolute inset-y-0 start-0 flex w-80 max-w-[85vw] flex-col gap-4 overflow-y-auto bg-surface p-4 text-fg shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-lg font-bold">{name(store)}</p>
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-full hover:bg-surface-muted"
            aria-label={t('nav.closeMenu')}
            onClick={onClose}
          >
            <StoreIcon name="close" />
          </button>
        </div>
        <Nav vertical />
        {drawer.showCategories && store.categories.length > 0 ? (
          <div>
            <p className="px-3 pb-1 text-xs font-semibold text-fg-subtle">{t('nav.categories')}</p>
            <ul className="flex flex-col">
              {store.categories.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/${slug}/products?category=${c.id}`}
                    className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-surface-muted"
                  >
                    {c.imageUrl ? (
                      <img src={c.imageUrl} alt="" className="size-7 rounded-full object-cover" />
                    ) : null}
                    {name(c)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <BranchPicker className="w-full" />
          {store.accountsEnabled || token ? (
            <Link to={`/${slug}/account`} className="text-sm font-medium hover:underline">
              {token ? t('nav.account') : t('nav.signIn')}
            </Link>
          ) : null}
          <LanguageSwitcher />
        </div>
        {drawer.showContact && (store.contactPhone || store.contactEmail) ? (
          <div className="flex flex-col gap-1 text-sm text-fg-muted">
            {store.contactPhone ? (
              <a href={`tel:${store.contactPhone}`} dir="ltr" className="hover:underline">
                {store.contactPhone}
              </a>
            ) : null}
            {store.contactEmail ? (
              <a href={`mailto:${store.contactEmail}`} className="hover:underline">
                {store.contactEmail}
              </a>
            ) : null}
          </div>
        ) : null}
        {drawer.showSocial && social.length > 0 ? <SocialLinks /> : null}
      </div>
    </div>
  );
}

function SocialLinks({ className }: { className?: string }) {
  const links = useSocialLinks();
  return (
    <ul className={cn('flex flex-wrap gap-2', className)}>
      {links.map((s) => (
        <li key={s.key}>
          <a
            href={s.href}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex rounded-full border border-current/20 px-3 py-1 text-xs font-medium hover:bg-current/10"
          >
            {s.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------- footer
function FooterBlockView({ block }: { block: FooterBlock }) {
  const slug = useSlug();
  const { data: store } = useStorefront();
  const { branch } = useBranchChoice();
  const text = useText();
  const name = useLocalName();
  const social = useSocialLinks();
  const { t, i18n } = useTranslation();
  if (!store) return null;
  const ar = i18n.language.startsWith('ar');
  const title = text(block.title);
  // A block with nothing to show stays out of the footer.
  if (block.type === 'social' && social.length === 0) return null;
  if (block.type === 'categories' && store.categories.length === 0) return null;
  if (block.type === 'links' && block.links.length === 0) return null;
  if (block.type === 'payments' && store.paymentMethods.length === 0 && !store.payOnReceipt)
    return null;
  const heading = title ? <h2 className="mb-2 text-sm font-bold">{title}</h2> : null;
  switch (block.type) {
    case 'about': {
      const body =
        text(block.text) ||
        (ar ? store.taglineAr || store.taglineEn : store.taglineEn || store.taglineAr);
      return (
        <div>
          {heading}
          <p className="text-sm whitespace-pre-line opacity-80">{body ?? name(store)}</p>
        </div>
      );
    }
    case 'links':
      return (
        <div>
          {heading}
          <ul className="flex flex-col gap-1 text-sm opacity-80">
            {block.links.map((l) => (
              <li key={l.id}>
                <DesignAnchor link={l.link} className="hover:underline">
                  {text(l.label)}
                </DesignAnchor>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'categories':
      return (
        <div>
          {heading}
          <ul className="flex flex-col gap-1 text-sm opacity-80">
            {store.categories.slice(0, 8).map((c) => (
              <li key={c.id}>
                <Link to={`/${slug}/products?category=${c.id}`} className="hover:underline">
                  {name(c)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'contact':
      if (!store.contactPhone && !store.contactEmail && !branch?.address) return null;
      return (
        <div>
          {heading}
          <ul className="flex flex-col gap-1 text-sm opacity-80">
            {store.contactPhone ? (
              <li>
                <a href={`tel:${store.contactPhone}`} dir="ltr" className="hover:underline">
                  {store.contactPhone}
                </a>
              </li>
            ) : null}
            {store.contactEmail ? (
              <li>
                <a href={`mailto:${store.contactEmail}`} className="hover:underline">
                  {store.contactEmail}
                </a>
              </li>
            ) : null}
            {branch?.address && title ? <li>{branch.address}</li> : null}
          </ul>
        </div>
      );
    case 'hours':
      return (
        <div>
          {heading}
          {branch?.hours ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm opacity-80">
              {WEEKDAYS.map((d) => (
                <div key={d} className="contents">
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
            <p className="text-sm opacity-80">{t('info.alwaysOpen')}</p>
          )}
        </div>
      );
    case 'social':
      return (
        <div>
          {heading}
          <SocialLinks />
        </div>
      );
    case 'payments':
      return (
        <div>
          {heading}
          <ul className="flex flex-wrap gap-2 text-xs">
            {store.paymentMethods.map((m) => (
              <li key={m.id} className="rounded-md border border-current/20 px-2 py-1">
                {name(m)}
              </li>
            ))}
            {store.payOnReceipt ? (
              <li className="rounded-md border border-current/20 px-2 py-1">
                {t('info.payOnReceipt')}
              </li>
            ) : null}
          </ul>
        </div>
      );
  }
}

function Footer() {
  const { data: store } = useStorefront();
  const { footer } = useDesign();
  const name = useLocalName();
  const { t } = useTranslation();
  if (!store) return null;
  const blocks = footer.blocks.map((b) => <FooterBlockView key={b.id} block={b} />);
  const powered = footer.showPoweredBy ? (
    <a
      href="https://www.arabatapp.com"
      target="_blank"
      rel="noreferrer noopener"
      className="opacity-70 hover:opacity-100"
    >
      {t('footer.poweredBy')}
    </a>
  ) : null;
  if (footer.style === 'simple') {
    if (footer.blocks.length === 0 && !powered) return null;
    return (
      <footer
        className="mx-auto w-full max-w-6xl p-4 text-sm text-fg-muted"
        data-testid="store-footer"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          {blocks}
          {powered}
        </div>
      </footer>
    );
  }
  const dark = footer.style === 'dark';
  return (
    <footer
      className={cn(
        'mt-8 border-t border-border',
        dark ? 'border-transparent bg-[#111] text-white' : 'bg-surface text-fg',
      )}
      data-testid="store-footer"
    >
      <div
        className={cn(
          'mx-auto grid max-w-6xl gap-8 px-4 py-10',
          footer.style === 'centered'
            ? 'justify-items-center text-center'
            : 'sm:grid-cols-2 lg:grid-cols-4',
        )}
      >
        {blocks}
      </div>
      <div className={cn('border-t px-4 py-4 text-xs', dark ? 'border-white/10' : 'border-border')}>
        <div
          className={cn(
            'mx-auto flex max-w-6xl flex-wrap items-center gap-2',
            footer.style === 'centered' ? 'justify-center' : 'justify-between',
          )}
        >
          <span className="opacity-70">
            © {new Date().getFullYear()} {name(store)}
          </span>
          {powered}
        </div>
      </div>
    </footer>
  );
}

// ------------------------------------------------------------------------ mobile bar
function MobileBar() {
  const slug = useSlug();
  const { data: store } = useStorefront();
  const { template } = useDesign();
  const cart = useCart();
  const { token } = useAccount();
  const { t } = useTranslation();
  const item = ({ isActive }: { isActive: boolean }) =>
    cn(
      'relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.7rem] font-medium',
      isActive ? 'text-primary' : 'text-fg-muted',
    );
  return (
    <nav
      aria-label={t('nav.quick')}
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface/95 backdrop-blur sm:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <NavLink to={`/${slug}`} end className={item}>
        <StoreIcon name="home" />
        {t('nav.home')}
      </NavLink>
      <NavLink to={`/${slug}/products`} className={item}>
        <StoreIcon name="grid" />
        {template === 'restaurant' ? t('nav.menu') : t('nav.catalog')}
      </NavLink>
      <NavLink to={`/${slug}/cart`} className={item}>
        <StoreIcon name="cart" />
        {t('nav.cart')}
        {cart.count > 0 ? (
          <span
            aria-hidden
            className="absolute top-1 start-1/2 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[0.65rem] font-bold text-primary-fg ltr:ms-1.5 rtl:me-1.5"
          >
            {cart.count}
          </span>
        ) : null}
      </NavLink>
      {store?.accountsEnabled || token ? (
        <NavLink to={`/${slug}/account`} className={item}>
          <StoreIcon name="user" />
          {t('nav.accountShort')}
        </NavLink>
      ) : null}
    </nav>
  );
}
