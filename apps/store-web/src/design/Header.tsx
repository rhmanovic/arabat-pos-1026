import type { DesignLink, HeaderAction, NavItem } from '@arabat/contracts';
import { cn } from '@arabat/ui';
import { LanguageSwitcher } from '@arabat/web-core';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { useCart } from '../cart.js';
import { navGroups, useAccount, useLocalName, useSlug, useStorefront } from '../shared.js';
import { linkTarget, useDesign, useText } from './context.js';
import { BranchPicker, DesignAnchor, LanguageButton, SocialLinks, StoreIcon } from './parts.js';

/*
 * The storefront header (ADR-0128 amendment 1): a top bar, seven layouts, menus with sub-menus
 * and a category mega-menu, header items in the merchant's order, scroll behaviour and a phone
 * layout. Every element exists once and is placed by screen size, so links never repeat.
 */

type Item = {
  id: string;
  label: string;
  link: DesignLink;
  kind: NavItem['kind'];
  children: { id: string; label: string; link: DesignLink }[];
};

/** Navigation items; without any, the three designed pages (categories as a menu). */
function useNavItems(): Item[] {
  const { navbar, template } = useDesign();
  const text = useText();
  const { t } = useTranslation();
  if (navbar.items.length > 0)
    return navbar.items.map((i) => ({
      id: i.id,
      label: text(i.label),
      link: i.link,
      kind: i.kind,
      children: i.children.map((c) => ({ id: c.id, label: text(c.label), link: c.link })),
    }));
  return [
    {
      id: 'home',
      label: t('nav.home'),
      link: { kind: 'page', page: 'home' },
      kind: 'link',
      children: [],
    },
    {
      id: 'products',
      label: template === 'restaurant' ? t('nav.menu') : t('nav.catalog'),
      link: { kind: 'page', page: 'products' },
      kind: 'link',
      children: [],
    },
    {
      id: 'categories',
      label: t('nav.categories'),
      link: { kind: 'page', page: 'categories' },
      kind: 'categories',
      children: [],
    },
  ];
}

// --------------------------------------------------------------------------- top bar
export function TopBar() {
  const { data: store } = useStorefront();
  const { announcement, social } = useDesign();
  const text = useText();
  const { t, i18n } = useTranslation();
  const ar = i18n.language.startsWith('ar');
  const own = store
    ? ar
      ? store.announcementAr || store.announcementEn
      : store.announcementEn || store.announcementAr
    : null;
  const messages = [own, ...announcement.messages.map((m) => text(m))].filter((m): m is string =>
    Boolean(m),
  );
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (messages.length < 2) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % messages.length), 4500);
    return () => clearInterval(timer);
  }, [messages.length]);
  const contact = announcement.showContact && (store?.contactPhone || social.whatsapp);
  const socials = announcement.showSocial;
  if (!store || (messages.length === 0 && !contact && !socials)) return null;
  const tone = {
    brand: 'bg-primary text-primary-fg',
    dark: 'bg-[#111] text-white',
    soft: 'bg-primary-soft text-fg',
  }[announcement.style];
  return (
    <div className={cn('text-xs font-medium sm:text-sm', tone)} data-testid="top-bar">
      <div className="mx-auto flex min-h-9 max-w-6xl items-center gap-3 px-4 py-1.5">
        <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
          {contact && store.contactPhone ? (
            <a
              href={`tel:${store.contactPhone}`}
              dir="ltr"
              className="inline-flex items-center gap-1.5 opacity-90 hover:opacity-100"
            >
              <StoreIcon name="phone" className="size-3.5" />
              {store.contactPhone}
            </a>
          ) : null}
          {contact && social.whatsapp ? (
            <a
              href={`https://wa.me/${social.whatsapp.replace(/^\+/, '')}`}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 opacity-90 hover:opacity-100"
            >
              <StoreIcon name="whatsapp" className="size-3.5" />
              {t('social.whatsapp')}
            </a>
          ) : null}
        </div>
        <p
          className="min-w-0 flex-1 truncate text-center md:flex-[2]"
          aria-live="polite"
          data-testid="announcement"
        >
          {messages[index % Math.max(1, messages.length)] ?? ''}
        </p>
        <div className="hidden flex-1 justify-end md:flex">
          {socials ? <SocialLinks size="sm" /> : null}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------- scrolling
/** Hidden while scrolling down (past the header), shown again when scrolling up. */
function useHiddenOnScroll(enabled: boolean) {
  const [hidden, setHidden] = useState(false);
  const last = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const onScroll = () => {
      const y = window.scrollY;
      setHidden(y > 120 && y > last.current);
      last.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [enabled]);
  return enabled && hidden;
}

// ---------------------------------------------------------------------------- header
export function Header({ tagline, onMenu }: { tagline: string | null; onMenu: () => void }) {
  const { header, navbar, drawer } = useDesign();
  const { t } = useTranslation();
  const hidden = useHiddenOnScroll(header.sticky && header.hideOnScroll);
  const layout = header.layout;
  const bg = layout === 'bold' && header.background === 'light' ? 'brand' : header.background;
  const tone = {
    light: 'bg-surface text-fg',
    brand: 'bg-primary text-primary-fg',
    dark: 'bg-[#0f0f10] text-white',
    glass: 'bg-surface/75 text-fg backdrop-blur-xl backdrop-saturate-150',
  }[bg];
  const border = {
    none: '',
    line: bg === 'light' || bg === 'glass' ? 'border-b border-border' : 'border-b border-white/10',
    shadow: 'shadow-[0_8px_24px_-16px_rgb(0_0_0/0.35)]',
  }[header.border];
  const rowHeight = { compact: 'h-14', regular: 'h-16', tall: 'h-20' }[header.height];
  const width = header.width === 'full' ? 'px-4 sm:px-8' : 'mx-auto max-w-6xl px-4';
  const navShown = navbar.style !== 'hidden' && layout !== 'minimal';
  const items = useNavItems();
  const half = Math.ceil(items.length / 2);
  // The menu button: always on phones, on large screens when the menu lives in the side panel.
  const desktopMenu = drawer.enabled || !navShown;
  const menu = (
    <button
      type="button"
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-current/10',
        !desktopMenu && 'lg:hidden',
      )}
      aria-label={t('nav.openMenu')}
      onClick={onMenu}
    >
      <StoreIcon name="menu" />
    </button>
  );
  const centeredBrand = layout === 'centered' || layout === 'split' || layout === 'minimal';
  const brand = (
    <Brand
      tagline={tagline}
      className={cn(
        'pointer-events-auto',
        centeredBrand && 'lg:max-w-[40%]',
        header.mobileLayout === 'center' && 'max-lg:max-w-[55%]',
        layout === 'bold' && 'lg:text-2xl',
      )}
      stacked={layout === 'centered' || layout === 'bold'}
    />
  );
  const searchShown = header.actions.some((a) => a.type === 'search' && a.visible);
  const searchBar = searchShown && (layout === 'stacked' || header.searchStyle === 'bar');
  // On phones the bar sits under the header row; the row then leaves out the search button.
  const phoneSearchBar = searchBar || (searchShown && header.mobileSearch);
  const navRowBelow = layout === 'centered' || layout === 'stacked' || layout === 'bold';
  const nav = (part?: 'first' | 'second') => (
    <Nav
      items={
        part === 'first' ? items.slice(0, half) : part === 'second' ? items.slice(half) : items
      }
      className={cn('max-lg:hidden', part === 'second' && 'justify-end')}
    />
  );

  const row = (
    <div
      className={cn('relative flex items-center gap-2', rowHeight, layout === 'bold' && 'lg:h-24')}
    >
      {menu}
      {layout === 'split' && navShown ? (
        <div className="flex min-w-0 flex-1 justify-start max-lg:hidden">{nav('first')}</div>
      ) : null}
      {/* A centred logo sits over the whole row, so both sides keep their room. */}
      <div
        className={cn(
          'min-w-0',
          centeredBrand
            ? 'lg:pointer-events-none lg:absolute lg:inset-0 lg:flex lg:items-center lg:justify-center'
            : 'lg:flex-none',
          header.mobileLayout === 'center'
            ? 'max-lg:pointer-events-none max-lg:absolute max-lg:inset-0 max-lg:flex max-lg:items-center max-lg:justify-center'
            : 'max-lg:flex-1',
        )}
      >
        {brand}
      </div>
      {layout === 'classic' || layout === 'floating' ? (
        navShown ? (
          <div
            className={cn(
              'flex min-w-0 flex-1 max-lg:hidden',
              { start: 'justify-start ps-6', center: 'justify-center', end: 'justify-end pe-2' }[
                navbar.align
              ],
            )}
          >
            {nav()}
          </div>
        ) : (
          <div className="flex-1 max-lg:hidden" />
        )
      ) : layout === 'stacked' ? (
        <div className="mx-4 max-w-2xl flex-1 max-lg:hidden xl:mx-10">
          {searchBar ? <SearchBar /> : null}
        </div>
      ) : layout === 'split' && navShown ? (
        <div className="flex min-w-0 flex-1 justify-end max-lg:hidden">{nav('second')}</div>
      ) : (
        <div className="flex-1 max-lg:hidden" />
      )}
      {/* Beside a centred logo the search stays a button; its bar would cover the logo. */}
      <Actions
        searchBar={searchBar && !centeredBrand}
        searchInRow={layout === 'stacked'}
        phoneSearchBar={phoneSearchBar}
      />
    </div>
  );

  const content = (
    <>
      <div className={width}>{row}</div>
      {/* The search bar sits under the main row on phones (and on the search-first layout). */}
      {phoneSearchBar ? (
        <div className={cn(width, 'pb-3 lg:hidden')}>
          <SearchBar />
        </div>
      ) : null}
      {navShown && navRowBelow ? (
        <div
          className={cn(
            'max-lg:hidden',
            layout === 'bold' ? 'bg-black/15' : 'border-t border-current/10',
          )}
        >
          <div
            className={cn(
              width,
              'flex h-12 items-center',
              { start: 'justify-start', center: 'justify-center', end: 'justify-end' }[
                layout === 'stacked' ? navbar.align : 'center'
              ],
            )}
          >
            <Nav items={items} />
          </div>
        </div>
      ) : null}
    </>
  );

  if (layout === 'floating')
    return (
      <div
        className={cn(
          'z-30 px-3 pt-3 transition-transform duration-300',
          header.sticky && 'sticky top-0',
          hidden && '-translate-y-[120%]',
        )}
      >
        <header
          className={cn(
            'mx-auto max-w-6xl rounded-2xl border border-current/10 shadow-[0_12px_32px_-18px_rgb(0_0_0/0.45)]',
            tone,
          )}
          data-testid="store-header"
          data-layout={layout}
        >
          <div className="px-3 sm:px-4">{row}</div>
          {phoneSearchBar ? (
            <div className="px-3 pb-3 lg:hidden">
              <SearchBar />
            </div>
          ) : null}
        </header>
      </div>
    );

  return (
    <header
      className={cn(
        'z-30 transition-transform duration-300',
        tone,
        border,
        header.sticky && 'sticky top-0',
        hidden && '-translate-y-full',
      )}
      data-testid="store-header"
      data-layout={layout}
    >
      {content}
    </header>
  );
}

// ----------------------------------------------------------------------------- brand
function Brand({
  tagline,
  className,
  stacked,
}: {
  tagline: string | null;
  className?: string;
  stacked?: boolean;
}) {
  const slug = useSlug();
  const { data: store } = useStorefront();
  const name = useLocalName();
  const { header } = useDesign();
  if (!store) return null;
  const size = { small: 'size-8', medium: 'size-10', large: 'size-12 lg:size-14' }[header.logoSize];
  const nameSize = { small: 'text-base', medium: 'text-lg', large: 'text-xl lg:text-2xl' }[
    header.logoSize
  ];
  const showName = header.showName || !store.logoUrl;
  return (
    <Link
      to={`/${slug}`}
      className={cn(
        'flex min-w-0 items-center gap-2.5',
        stacked && 'lg:flex-col lg:gap-1 lg:text-center',
        className,
      )}
      aria-label={showName ? undefined : name(store)}
    >
      {store.logoUrl ? (
        <img
          src={store.logoUrl}
          alt=""
          className={cn('shrink-0 rounded-full object-cover', size)}
          data-testid="store-logo"
        />
      ) : null}
      {showName ? (
        <span className="min-w-0">
          <span
            className={cn('block truncate font-extrabold leading-tight tracking-tight', nameSize)}
          >
            {name(store)}
          </span>
          {header.showTagline && tagline ? (
            <span className="block truncate text-xs opacity-70 max-sm:hidden">{tagline}</span>
          ) : null}
        </span>
      ) : null}
    </Link>
  );
}

// ------------------------------------------------------------------------ navigation
const MENU_CLOSE_DELAY_MS = 400;

function Nav({ items, className }: { items: Item[]; className?: string }) {
  const slug = useSlug();
  const { navbar } = useDesign();
  const location = useLocation();
  // Hover shows a menu; a click pins it open until clicked again, Escape or a page change.
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  // Leaving an item closes its menu only after a short grace, so the pointer can cross the gap
  // between the item and its menu (the mega-menu hangs from the bottom of the header row).
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const enter = (id: string) => {
    cancelClose();
    setHovered(id);
  };
  const leave = (id: string) => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setHovered((o) => (o === id ? null : o));
    }, MENU_CLOSE_DELAY_MS);
  };
  useEffect(() => cancelClose, []);
  const [path, setPath] = useState(location.pathname + location.search);
  if (path !== location.pathname + location.search) {
    setPath(location.pathname + location.search);
    setHovered(null);
    setPinned(null);
  }
  const style = navbar.style;
  const base = cn(
    'inline-flex items-center gap-1 whitespace-nowrap text-sm font-semibold transition-colors',
    style === 'links' && 'rounded-md px-3 py-2 opacity-75 hover:opacity-100',
    style === 'underline' && 'border-b-2 border-transparent px-3 py-2 hover:border-current/30',
    style === 'pills' && 'rounded-full px-4 py-2 hover:bg-current/10',
    style === 'boxed' && 'rounded-lg px-4 py-2 hover:bg-current/10',
  );
  const active = cn(
    style === 'links' && 'opacity-100',
    style === 'underline' && 'border-current',
    style === 'pills' && 'bg-primary text-primary-fg hover:bg-primary',
    style === 'boxed' && 'bg-current/10',
  );
  return (
    <ul
      className={cn(
        'flex items-center',
        style === 'boxed' ? 'gap-1 rounded-xl bg-current/5 p-1' : 'gap-0.5',
        className,
      )}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setHovered(null);
          setPinned(null);
        }
      }}
    >
      {items.map((item) => {
        const target = linkTarget(slug, item.link);
        if (!target) return null;
        const hasMenu = item.kind === 'categories' || item.children.length > 0;
        const label = target.external ? (
          <a href={target.to} target="_blank" rel="noreferrer noopener" className={base}>
            {item.label}
          </a>
        ) : (
          <NavLink
            to={target.to}
            end={target.to === `/${slug}`}
            className={({ isActive }) => cn(base, isActive && active)}
          >
            {item.label}
          </NavLink>
        );
        if (!hasMenu) return <li key={item.id}>{label}</li>;
        const isOpen = pinned === item.id || (pinned === null && hovered === item.id);
        const mega = item.kind === 'categories' && navbar.menuStyle === 'mega';
        return (
          <li
            key={item.id}
            className={cn('flex items-center', !mega && 'relative')}
            onMouseEnter={() => enter(item.id)}
            onMouseLeave={() => leave(item.id)}
          >
            {label}
            <SubmenuToggle
              label={item.label}
              open={isOpen}
              onToggle={() => setPinned(pinned === item.id ? null : item.id)}
            />
            {isOpen ? (
              item.kind === 'categories' ? (
                <CategoryMenu mega={mega} />
              ) : (
                <div className="absolute top-full start-0 z-40 pt-2">
                  <ul className="min-w-56 rounded-xl border border-border bg-surface p-1.5 text-fg shadow-xl">
                    {item.children.map((c) => (
                      <li key={c.id}>
                        <DesignAnchor
                          link={c.link}
                          className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-muted"
                        >
                          {c.label}
                        </DesignAnchor>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function SubmenuToggle({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={t('nav.submenu', { name: label })}
      onClick={onToggle}
      className="-ms-2 grid size-7 place-items-center rounded-full opacity-70 hover:opacity-100"
    >
      <StoreIcon
        name="chevron"
        className={cn('size-4 transition-transform', open && 'rotate-180')}
      />
    </button>
  );
}

/** The store's categories under a menu item: a list, or a picture mega-menu across the header. */
function CategoryMenu({ mega }: { mega: boolean }) {
  const slug = useSlug();
  const { data: store } = useStorefront();
  const name = useLocalName();
  const { t } = useTranslation();
  const categories = navGroups(store);
  if (mega)
    return (
      <div
        className="absolute inset-x-0 top-full z-40 border-t border-border bg-surface text-fg shadow-2xl"
        data-testid="mega-menu"
      >
        <div className="mx-auto max-w-6xl p-6">
          {categories.length === 0 ? (
            <p className="text-sm text-fg-muted">{t('design.noCategories')}</p>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,8.5rem))] gap-4">
              {categories.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/${slug}/products?category=${c.id}`}
                    className="group flex flex-col items-center gap-2 rounded-2xl p-2 text-center text-sm font-semibold transition-colors hover:bg-surface-muted"
                  >
                    <span className="grid aspect-square w-full place-items-center overflow-hidden rounded-xl bg-primary-soft">
                      {c.imageUrl ? (
                        <img
                          src={c.imageUrl}
                          alt=""
                          className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <span aria-hidden className="text-3xl font-bold text-primary">
                          {name(c).slice(0, 1)}
                        </span>
                      )}
                    </span>
                    {name(c)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link
            to={`/${slug}/categories`}
            className="mt-5 inline-flex text-sm font-semibold text-primary hover:underline"
          >
            {t('nav.allCategories')}
          </Link>
        </div>
      </div>
    );
  return (
    <div className="absolute top-full start-0 z-40 pt-2">
      <ul className="max-h-[70vh] min-w-60 overflow-y-auto rounded-xl border border-border bg-surface p-1.5 text-fg shadow-xl">
        {categories.map((c) => (
          <li key={c.id}>
            <Link
              to={`/${slug}/products?category=${c.id}`}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-surface-muted"
            >
              {c.imageUrl ? (
                <img src={c.imageUrl} alt="" className="size-8 rounded-md object-cover" />
              ) : null}
              {name(c)}
            </Link>
          </li>
        ))}
        <li className="mt-1 border-t border-border pt-1">
          <Link
            to={`/${slug}/categories`}
            className="block rounded-lg px-3 py-2 text-sm font-semibold text-primary hover:bg-surface-muted"
          >
            {t('nav.allCategories')}
          </Link>
        </li>
      </ul>
    </div>
  );
}

// --------------------------------------------------------------------------- actions
function SearchBar({ className }: { className?: string }) {
  const slug = useSlug();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void navigate(`/${slug}/products?q=${encodeURIComponent(q.trim())}`);
  };
  return (
    <form role="search" onSubmit={submit} className={cn('relative w-full', className)}>
      <StoreIcon
        name="search"
        className="pointer-events-none absolute top-1/2 start-3.5 size-4 -translate-y-1/2 opacity-60"
      />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label={t('nav.searchStore')}
        placeholder={t('nav.searchPlaceholder')}
        className="h-11 w-full rounded-full border border-border bg-surface-muted ps-10 pe-4 text-sm text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-primary focus:bg-surface"
      />
    </form>
  );
}

function Actions({
  searchBar,
  searchInRow,
  phoneSearchBar,
}: {
  searchBar: boolean;
  searchInRow: boolean;
  phoneSearchBar: boolean;
}) {
  const slug = useSlug();
  const { data: store } = useStorefront();
  const { header, social } = useDesign();
  const cart = useCart();
  const { token } = useAccount();
  const { t } = useTranslation();
  const icon =
    'inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-current/10';
  const render = (type: HeaderAction): ReactNode => {
    switch (type) {
      case 'search':
        // The search-first layout shows its bar in the middle of the header instead.
        if (searchInRow) return null;
        return searchBar ? (
          <div className="w-72 max-lg:hidden xl:w-96">
            <SearchBar />
          </div>
        ) : (
          <Link
            to={`/${slug}/products?search=1`}
            className={cn(icon, phoneSearchBar && 'max-lg:hidden')}
            aria-label={t('catalog.search')}
          >
            <StoreIcon name="search" />
          </Link>
        );
      case 'account':
        return store?.accountsEnabled || token ? (
          <Link to={`/${slug}/account`} className={cn(icon, 'max-sm:hidden')}>
            <StoreIcon name="user" />
            <span className="sr-only">{token ? t('nav.account') : t('nav.signIn')}</span>
          </Link>
        ) : null;
      case 'branch':
        return <BranchPicker className="max-lg:hidden" />;
      case 'language':
        return header.languageStyle === 'full' ? (
          <div className="max-lg:hidden">
            <LanguageSwitcher />
          </div>
        ) : (
          <LanguageButton className="max-lg:hidden" />
        );
      case 'whatsapp':
        return social.whatsapp ? (
          <a
            href={`https://wa.me/${social.whatsapp.replace(/^\+/, '')}`}
            target="_blank"
            rel="noreferrer noopener"
            className={cn(icon, 'max-sm:hidden')}
            aria-label={t('social.whatsapp')}
          >
            <StoreIcon name="whatsapp" />
          </a>
        ) : null;
      case 'cart': {
        const label = t('nav.cartCount', { count: cart.count });
        const badge =
          cart.count > 0 ? (
            <span
              aria-hidden
              className="absolute -top-0.5 -end-0.5 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[0.65rem] font-bold leading-5 text-primary-fg"
            >
              {cart.count}
            </span>
          ) : null;
        if (header.cartStyle === 'pill')
          return (
            <Link
              to={`/${slug}/cart`}
              className="relative inline-flex h-10 items-center gap-2 rounded-full bg-current/[0.07] px-2.5 text-sm font-semibold whitespace-nowrap transition-colors hover:bg-current/15 sm:px-4"
            >
              <StoreIcon name="bag" />
              <span className="max-sm:sr-only">{label}</span>
              <span className="sm:hidden">{badge}</span>
            </Link>
          );
        if (header.cartStyle === 'text')
          return (
            <Link
              to={`/${slug}/cart`}
              className="inline-flex h-10 items-center px-2 text-sm font-semibold whitespace-nowrap hover:underline"
            >
              {label}
            </Link>
          );
        return (
          <Link to={`/${slug}/cart`} className={cn(icon, 'relative')}>
            <StoreIcon name="bag" />
            <span className="sr-only">{label}</span>
            {badge}
          </Link>
        );
      }
    }
  };
  return (
    <div className="ms-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
      {header.actions
        .filter((a) => a.visible)
        .map((a) => (
          <span key={a.type} className="contents">
            {render(a.type)}
          </span>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------- drawer
export function Drawer({ onClose }: { onClose: () => void }) {
  const slug = useSlug();
  const { data: store } = useStorefront();
  const { drawer } = useDesign();
  const name = useLocalName();
  const items = useNavItems();
  const { token } = useAccount();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!store) return null;
  const full = drawer.style === 'full';
  const row =
    'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-base font-semibold hover:bg-surface-muted';
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal aria-label={t('nav.menuLabel')}>
      <button
        type="button"
        aria-label={t('nav.closeMenu')}
        className="absolute inset-0 bg-black/45 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          'absolute flex flex-col overflow-y-auto bg-surface text-fg shadow-2xl',
          full ? 'inset-0' : 'inset-y-0 start-0 w-[22rem] max-w-[88vw] rounded-e-3xl',
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border p-4">
          <div className="flex min-w-0 items-center gap-3">
            {store.logoUrl ? (
              <img src={store.logoUrl} alt="" className="size-10 rounded-full object-cover" />
            ) : null}
            <p className="truncate text-lg font-extrabold">{name(store)}</p>
          </div>
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-full bg-surface-muted hover:bg-border"
            aria-label={t('nav.closeMenu')}
            onClick={onClose}
          >
            <StoreIcon name="close" />
          </button>
        </div>
        <nav aria-label={t('nav.menuLabel')} className="flex flex-col gap-0.5 p-3">
          {items.map((item) => {
            const target = linkTarget(slug, item.link);
            if (!target) return null;
            const sub = item.kind === 'categories' ? [] : item.children;
            const link = target.external ? (
              <a href={target.to} target="_blank" rel="noreferrer noopener" className={row}>
                {item.label}
              </a>
            ) : (
              <NavLink
                to={target.to}
                end={target.to === `/${slug}`}
                className={({ isActive }) => cn(row, isActive && 'bg-primary-soft text-primary')}
              >
                {item.label}
              </NavLink>
            );
            if (sub.length === 0) return <div key={item.id}>{link}</div>;
            return (
              <div key={item.id}>
                <div className="flex items-center">
                  <div className="flex-1">{link}</div>
                  <SubmenuToggle
                    label={item.label}
                    open={expanded === item.id}
                    onToggle={() => setExpanded(expanded === item.id ? null : item.id)}
                  />
                </div>
                {expanded === item.id ? (
                  <ul className="ms-4 border-s border-border ps-2">
                    {sub.map((c) => (
                      <li key={c.id}>
                        <DesignAnchor
                          link={c.link}
                          className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-muted"
                        >
                          {c.label}
                        </DesignAnchor>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </nav>
        {drawer.showCategories && navGroups(store).length > 0 ? (
          <div className="px-3 pb-3">
            <p className="px-3 pb-2 text-xs font-bold tracking-wide text-fg-subtle">
              {t('nav.categories')}
            </p>
            <ul className={cn('grid gap-2', full ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-3')}>
              {navGroups(store).map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/${slug}/products?category=${c.id}`}
                    className="flex flex-col items-center gap-1.5 rounded-xl p-2 text-center text-xs font-semibold hover:bg-surface-muted"
                  >
                    <span className="grid size-14 place-items-center overflow-hidden rounded-full bg-primary-soft">
                      {c.imageUrl ? (
                        <img src={c.imageUrl} alt="" className="size-full object-cover" />
                      ) : (
                        <span aria-hidden className="text-lg font-bold text-primary">
                          {name(c).slice(0, 1)}
                        </span>
                      )}
                    </span>
                    <span className="line-clamp-2">{name(c)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="mt-auto flex flex-col gap-4 border-t border-border p-4">
          <div className="flex flex-wrap items-center gap-3">
            {store.accountsEnabled || token ? (
              <Link
                to={`/${slug}/account`}
                className="inline-flex items-center gap-2 rounded-full bg-surface-muted px-4 py-2 text-sm font-semibold"
              >
                <StoreIcon name="user" className="size-4" />
                {token ? t('nav.account') : t('nav.signIn')}
              </Link>
            ) : null}
            <BranchPicker />
            <LanguageSwitcher />
          </div>
          {drawer.showContact && (store.contactPhone || store.contactEmail) ? (
            <div className="flex flex-col gap-1.5 text-sm text-fg-muted">
              {store.contactPhone ? (
                <a
                  href={`tel:${store.contactPhone}`}
                  dir="ltr"
                  className="inline-flex items-center gap-2 hover:text-fg"
                >
                  <StoreIcon name="phone" className="size-4" />
                  {store.contactPhone}
                </a>
              ) : null}
              {store.contactEmail ? (
                <a href={`mailto:${store.contactEmail}`} className="hover:text-fg">
                  {store.contactEmail}
                </a>
              ) : null}
            </div>
          ) : null}
          {drawer.showSocial ? <SocialLinks /> : null}
        </div>
      </div>
    </div>
  );
}
