import { NotFound, RouteErrorBoundary } from '@arabat/web-core';
import type { RouteObject } from 'react-router';
import { CartPage } from './pages/CartPage.js';
import { CatalogPage } from './pages/CatalogPage.js';
import { CheckoutPage } from './pages/CheckoutPage.js';
import { HomePage } from './pages/HomePage.js';
import { OrderPage } from './pages/OrderPage.js';
import { PayPage } from './pages/PayPage.js';
import { ProductPage } from './pages/ProductPage.js';
import { StoreLayout } from './pages/StoreLayout.js';

/** Route tree of /store (relative to the /store basename). See docs/ROUTES.md. */
export const routes: RouteObject[] = [
  { path: '/', element: <HomePage />, errorElement: <RouteErrorBoundary /> },
  // Sandbox gateway page (mock adapter only; 'pay' is a reserved store address).
  { path: '/pay/:reference', element: <PayPage />, errorElement: <RouteErrorBoundary /> },
  {
    path: '/:slug',
    element: <StoreLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <CatalogPage /> },
      { path: 'products/:productId', element: <ProductPage /> },
      { path: 'cart', element: <CartPage /> },
      { path: 'checkout', element: <CheckoutPage /> },
      { path: 'orders/:token', element: <OrderPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];
