import {
  NotFound,
  RedirectIfAuthenticated,
  RequireAuth,
  RequirePermission,
  RouteErrorBoundary,
} from '@arabat/web-core';
import type { ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { ManagerLayout } from './layouts/ManagerLayout.js';
import { BranchesPage } from './features/branches/BranchesPage.js';
import { CompanySettingsPage } from './features/company/CompanySettingsPage.js';
import { DashboardPage } from './features/dashboard/DashboardPage.js';
import { EmployeeDetailPage } from './features/employees/EmployeeDetailPage.js';
import { EmployeesPage } from './features/employees/EmployeesPage.js';
import { RolesPage } from './features/roles/RolesPage.js';
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  AcceptInvitePage,
} from './pages/LoginPage.js';

/** Route tree of /manager (paths are relative to the /manager basename). See docs/ROUTES.md. */
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
    path: '/register',
    errorElement: <RouteErrorBoundary />,
    element: (
      <RedirectIfAuthenticated>
        <RegisterPage />
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
        <ManagerLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'branches', element: guard('branches.read', <BranchesPage />) },
      { path: 'employees', element: guard('employees.read', <EmployeesPage />) },
      { path: 'employees/:membershipId', element: guard('employees.read', <EmployeeDetailPage />) },
      { path: 'roles', element: guard('employees.read', <RolesPage />) },
      { path: 'settings', element: guard('merchant.settings.read', <CompanySettingsPage />) },
      { path: '*', element: <NotFound /> },
    ],
  },
];

/** UX guard only: the API enforces the same permission on every request. */
function guard(permission: string, page: ReactNode) {
  return <RequirePermission permission={permission}>{page}</RequirePermission>;
}
