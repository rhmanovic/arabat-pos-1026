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
import { RegisterPage } from './pages/RegisterPage.js';

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
      { index: true, element: <RegisterPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];
