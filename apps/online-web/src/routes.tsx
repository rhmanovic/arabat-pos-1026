import { DesignPage } from './features/design/DesignPage.js';
import {
  NotFound,
  RedirectIfAuthenticated,
  RequireAuth,
  RouteErrorBoundary,
} from '@arabat/web-core';
import type { RouteObject } from 'react-router';
import { OnlineLayout } from './app/OnlineLayout.js';
import { AnalyticsPage } from './features/analytics/AnalyticsPage.js';
import { CategoriesPage } from './features/categories/CategoriesPage.js';
import { CollectionsPage } from './features/collections/CollectionsPage.js';
import { DashboardPage } from './features/dashboard/DashboardPage.js';
import { BranchesPage } from './features/fulfilment/BranchesPage.js';
import { DeliveryAreasPage } from './features/fulfilment/DeliveryAreasPage.js';
import { DiscountsPage } from './features/discounts/DiscountsPage.js';
import { OrdersPage } from './features/orders/OrdersPage.js';
import { ProductsPage } from './features/products/ProductsPage.js';
import { PromotionsPage } from './features/promotions/PromotionsPage.js';
import { SettingsPage } from './features/settings/SettingsPage.js';
import { ForgotPasswordPage, LoginPage } from './pages/LoginPage.js';

/** Route tree of /online (relative to the /online basename). See docs/ROUTES.md §2d. */
export const routes: RouteObject[] = [
  {
    path: '/login',
    errorElement: <RouteErrorBoundary />,
    element: (
      <RedirectIfAuthenticated>
        <LoginPage />
      </RedirectIfAuthenticated>
    ),
  },
  {
    path: '/forgot-password',
    errorElement: <RouteErrorBoundary />,
    element: <ForgotPasswordPage />,
  },
  {
    path: '/',
    errorElement: <RouteErrorBoundary />,
    element: (
      <RequireAuth>
        <OnlineLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'orders', element: <OrdersPage /> },
      { path: 'products', element: <ProductsPage /> },
      { path: 'categories', element: <CategoriesPage /> },
      { path: 'collections', element: <CollectionsPage /> },
      { path: 'delivery-areas', element: <DeliveryAreasPage /> },
      { path: 'branches', element: <BranchesPage /> },
      { path: 'promotions', element: <PromotionsPage /> },
      { path: 'discounts', element: <DiscountsPage /> },
      { path: 'analytics', element: <AnalyticsPage /> },
      { path: 'design', element: <DesignPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];
