import {
  NotFound,
  RedirectIfAuthenticated,
  RequireAuth,
  RequirePermission,
  RouteErrorBoundary,
  useAuth,
} from '@arabat/web-core';
import { Navigate, type RouteObject } from 'react-router';
import { POSLayout } from './layouts/POSLayout.js';
import {
  ForgotPasswordPage,
  LoginPage,
  PinPage,
  ResetPasswordPage,
  AcceptInvitePage,
} from './pages/LoginPage.js';
import { RequireShift, ShiftPage } from './pages/ShiftPages.js';
import { KitchenPage } from './restaurant/KitchenPage.js';
import { FloorPage, OrderPage } from './restaurant/RestaurantPages.js';
import { ReturnsPage } from './sale/ReturnsPage.js';
import { SalePage } from './sale/SalePage.js';

/** Kitchen-only staff start on the kitchen display; everyone else on the sale screen. */
function Home() {
  const { hasPermission } = useAuth();
  if (!hasPermission('sales.create') && hasPermission('kitchen.access'))
    return <Navigate to="/kitchen" replace />;
  return (
    <RequireShift>
      <SalePage />
    </RequireShift>
  );
}

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
  { path: '/pin', errorElement: <RouteErrorBoundary />, element: <PinPage /> },
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
      { index: true, element: <Home /> },
      {
        path: 'tables',
        element: (
          <RequireShift>
            <FloorPage />
          </RequireShift>
        ),
      },
      {
        path: 'tables/orders/:orderId',
        element: (
          <RequireShift>
            <OrderPage />
          </RequireShift>
        ),
      },
      {
        path: 'kitchen',
        element: (
          <RequirePermission permission="kitchen.access">
            <KitchenPage />
          </RequirePermission>
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
