import '@arabat/ui/fonts';
import './styles.css';
import { AppRoot } from '@arabat/web-core';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { i18n } from './i18n/index.js';
import { routes } from './routes.js';

const router = createBrowserRouter(routes, { basename: '/platform' });

createRoot(document.getElementById('root')!).render(
  <AppRoot appInterface="platform" i18n={i18n}>
    <RouterProvider router={router} />
  </AppRoot>,
);
