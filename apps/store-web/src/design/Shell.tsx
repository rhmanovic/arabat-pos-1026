import { type FooterBlock, WEEKDAYS } from '@arabat/contracts';
import { Alert, cn } from '@arabat/ui';
import { useEffect, useState } from 'react';
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
import { isPreview, useDesign, useText, useThemeVariables } from './context.js';
import { Drawer, Header, TopBar } from './Header.js';
import { DesignAnchor, SocialLinks, StoreIcon, useSocialLinks } from './parts.js';

export { DesignAnchor, StoreIcon } from './parts.js';

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
      <TopBar />
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
