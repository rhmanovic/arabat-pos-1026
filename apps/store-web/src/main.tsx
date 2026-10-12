import '@arabat/ui/fonts';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { i18n } from './i18n/index.js';
import { StoreRoot } from './root.js';
import { routes } from './routes.js';

const router = createBrowserRouter(routes, { basename: '/store' });

createRoot(document.getElementById('root')!).render(
  <StoreRoot i18n={i18n}>
    <RouterProvider router={router} />
  </StoreRoot>,
);
