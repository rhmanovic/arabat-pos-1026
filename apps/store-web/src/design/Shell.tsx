import { storePath } from '../address.js';
import { Alert, cn } from '@arabat/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useCart } from '../cart.js';
import { setPageMeta, useAccount, useLocalName, useSlug, useStorefront } from '../shared.js';
import { isPreview, useDesign, useThemeVariables } from './context.js';
import { Footer } from './Footer.js';
import { Drawer, Header, TopBar } from './Header.js';
import { StoreIcon } from './parts.js';

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
      data-motion={design.style.motion}
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
      <NavLink to={storePath(slug)} end className={item}>
        <StoreIcon name="home" />
        {t('nav.home')}
      </NavLink>
      <NavLink to={storePath(slug, `/products`)} className={item}>
        <StoreIcon name="grid" />
        {template === 'restaurant' ? t('nav.menu') : t('nav.catalog')}
      </NavLink>
      <NavLink to={storePath(slug, `/cart`)} className={item}>
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
        <NavLink to={storePath(slug, `/account`)} className={item}>
          <StoreIcon name="user" />
          {t('nav.accountShort')}
        </NavLink>
      ) : null}
    </nav>
  );
}
