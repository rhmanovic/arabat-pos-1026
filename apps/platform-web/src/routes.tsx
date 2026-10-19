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
import { OfferPage } from './pages/OfferPage.js';
import { PlansPage } from './pages/PlansPage.js';
import { SalesRequestsPage } from './pages/SalesRequestsPage.js';
import { SiteAppsPage } from './pages/SiteAppsPage.js';
import { TrialsPage } from './pages/TrialsPage.js';

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
      { path: 'offer', element: <OfferPage /> },
      { path: 'site-apps', element: <SiteAppsPage /> },
      { path: 'trials', element: <TrialsPage /> },
      { path: 'requests', element: <SalesRequestsPage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: 'assistant', element: <AssistantUsagePage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];
