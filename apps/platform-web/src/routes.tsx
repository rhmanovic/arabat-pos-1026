import {
  NotFound,
  RedirectIfAuthenticated,
  RequireAuth,
  RouteErrorBoundary,
} from '@arabat/web-core';
import type { RouteObject } from 'react-router';
import { PlatformLayout } from './layouts/PlatformLayout.js';
import { LoginPage } from './pages/LoginPage.js';
import { AssistantUsagePage } from './pages/AssistantUsagePage.js';
import { AuditPage } from './pages/AuditPage.js';
import { MerchantDetailPage } from './pages/MerchantDetailPage.js';
import { MerchantsPage } from './pages/MerchantsPage.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { PlansPage } from './pages/PlansPage.js';

/** Route tree of /platform (relative to the /platform basename). See docs/ROUTES.md. */
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
    path: '/',
    errorElement: <RouteErrorBoundary />,
    element: (
      <RequireAuth>
        <PlatformLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <OverviewPage /> },
      { path: 'merchants', element: <MerchantsPage /> },
      { path: 'merchants/:merchantId', element: <MerchantDetailPage /> },
      { path: 'plans', element: <PlansPage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: 'assistant', element: <AssistantUsagePage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];
