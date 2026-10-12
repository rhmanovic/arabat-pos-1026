import {
  NotFound,
  RedirectIfAuthenticated,
  RequireAuth,
  RouteErrorBoundary,
} from '@arabat/web-core';
import type { RouteObject } from 'react-router';
import { POSLayout } from './layouts/POSLayout.js';
import {
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
  AcceptInvitePage,
} from './pages/LoginPage.js';
import { RequireShift, ShiftPage } from './pages/ShiftPages.js';
import { ReturnsPage } from './sale/ReturnsPage.js';
import { SalePage } from './sale/SalePage.js';

/** Route tree of /pos (relative to the /pos basename). See docs/ROUTES.md. */
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
  { path: '/reset-password', errorElement: <RouteErrorBoundary />, element: <ResetPasswordPage /> },
  { path: '/accept-invite', errorElement: <RouteErrorBoundary />, element: <AcceptInvitePage /> },
  {
    path: '/',
    errorElement: <RouteErrorBoundary />,
    element: (
      <RequireAuth>
        <POSLayout />
      </RequireAuth>
    ),
    children: [
      {
        index: true,
        element: (
          <RequireShift>
            <SalePage />
          </RequireShift>
        ),
      },
      { path: 'shift', element: <ShiftPage /> },
      {
        path: 'returns',
        element: (
          <RequireShift>
            <ReturnsPage />
          </RequireShift>
        ),
      },
      { path: '*', element: <NotFound /> },
    ],
  },
];
