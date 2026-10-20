import '@arabat/ui/fonts';
import './styles.css';
import { AppRoot } from '@arabat/web-core';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { i18n } from './i18n/index.js';
import { routes } from './routes.js';

const router = createBrowserRouter(routes, { basename: '/online' });

// The online store console signs in with the management session: same account, same cookie
// (ADR-0119, like the link-page editor). The backend, catalog, stock and customers are shared.
createRoot(document.getElementById('root')!).render(
  <AppRoot appInterface="manager" i18n={i18n}>
    <RouterProvider router={router} />
  </AppRoot>,
);
