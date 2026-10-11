import {
  NotFound,
  RedirectIfAuthenticated,
  RequireAuth,
  RouteErrorBoundary,
} from '@arabat/web-core';
import type { RouteObject } from 'react-router';
import { PlatformLayout } from './layouts/PlatformLayout.js';
import { LoginPage } from './pages/LoginPage.js';
import { OverviewPage } from './pages/OverviewPage.js';

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
      { path: '*', element: <NotFound /> },
    ],
  },
];
