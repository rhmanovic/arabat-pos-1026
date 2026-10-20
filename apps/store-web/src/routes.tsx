import { NotFound, RouteErrorBoundary } from '@arabat/web-core';
import type { RouteObject } from 'react-router';
import {
  AccountAddressesPage,
  AccountLayout,
  AccountOrdersPage,
  AccountProfilePage,
  ForgotPasswordPage,
  ResetPasswordPage,
} from './pages/AccountPages.js';
import { CartPage } from './pages/CartPage.js';
import { CheckoutPage } from './pages/CheckoutPage.js';
import { DesignedPage } from './design/sections.js';
import { HomePage } from './pages/HomePage.js';
import { LinksPage } from './pages/LinksPage.js';
import { OrderPage } from './pages/OrderPage.js';
import { PayPage } from './pages/PayPage.js';
import { ProductPage } from './pages/ProductPage.js';
import { StoreLayout } from './pages/StoreLayout.js';

/** Route tree of /store (relative to the /store basename). See docs/ROUTES.md. */
export const routes: RouteObject[] = [
  { path: '/', element: <HomePage />, errorElement: <RouteErrorBoundary /> },
  // Sandbox gateway page (mock adapter only; 'pay' is a reserved store address).
  { path: '/pay/:reference', element: <PayPage />, errorElement: <RouteErrorBoundary /> },
  // Link page of a merchant (ADR-0116; 'links' is a reserved store address).
  { path: '/links/:slug', element: <LinksPage />, errorElement: <RouteErrorBoundary /> },
  {
    path: '/:slug',
    element: <StoreLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      // Pages built from the store design's sections (ADR-0128).
      { index: true, element: <DesignedPage page="home" /> },
      { path: 'products', element: <DesignedPage page="products" /> },
      { path: 'categories', element: <DesignedPage page="categories" /> },
      { path: 'products/:productId', element: <ProductPage /> },
      { path: 'cart', element: <CartPage /> },
      { path: 'checkout', element: <CheckoutPage /> },
      { path: 'orders/:token', element: <OrderPage /> },
      { path: 'account/forgot', element: <ForgotPasswordPage /> },
      { path: 'account/reset/:token', element: <ResetPasswordPage /> },
      {
        path: 'account',
        element: <AccountLayout />,
        children: [
          { index: true, element: <AccountOrdersPage /> },
          { path: 'addresses', element: <AccountAddressesPage /> },
          { path: 'profile', element: <AccountProfilePage /> },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
];
