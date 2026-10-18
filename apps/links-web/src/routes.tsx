import {
  NotFound,
  RedirectIfAuthenticated,
  RequireAuth,
  RouteErrorBoundary,
} from '@arabat/web-core';
import type { RouteObject } from 'react-router';
import { EditorPage } from './pages/EditorPage.js';
import { LinksLayout } from './pages/LinksLayout.js';
import { ForgotPasswordPage, LoginPage } from './pages/LoginPage.js';

/** Route tree of /links (relative to the /links basename). See docs/ROUTES.md. */
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
        <LinksLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <EditorPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];
