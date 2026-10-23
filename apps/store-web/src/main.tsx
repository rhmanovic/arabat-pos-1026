import '@arabat/ui/fonts';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { i18n } from './i18n/index.js';
import { hostStore } from './address.js';
import { StoreRoot } from './root.js';
import { hostRoutes, routes } from './routes.js';

const host = hostStore();

// Installable storefront (Phase 10): the service worker only caches the app shell (its scope is
// `/store/`, so not on a store's own sub-domain).
if ('serviceWorker' in navigator && import.meta.env.PROD && !host)
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/store/sw.js', { scope: '/store/' }).catch(() => undefined);
  });

// On its own sub-domain the store is at `/` (ADR-0136); otherwise at `/store/{slug}`.
const router = host
  ? createBrowserRouter(hostRoutes)
  : createBrowserRouter(routes, { basename: '/store' });

createRoot(document.getElementById('root')!).render(
  <StoreRoot i18n={i18n}>
    <RouterProvider router={router} />
  </StoreRoot>,
);
