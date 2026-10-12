import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './auth.js';
import { AccessDenied, ErrorState, FullPageLoader } from './components.js';
import { LockScreen } from './lock-screen.js';

export const LOGIN_PATH = '/login';

/**
 * Protected route: renders children only for an authenticated session of this interface.
 * Anything else (loading, anonymous, error) never shows protected content — default deny.
 */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const { state, refresh } = useAuth();
  const location = useLocation();
  switch (state.status) {
    case 'loading':
      return <FullPageLoader />;
    case 'error':
      return <ErrorState error={state.error} onRetry={() => void refresh()} fullPage />;
    case 'anonymous':
      return (
        <Navigate to={LOGIN_PATH} replace state={{ from: location.pathname + location.search }} />
      );
    case 'locked':
      return <LockScreen />;
    case 'authenticated':
      return <>{children ?? <Outlet />}</>;
  }
}

/** Hides a route or element unless the session holds the permission (UX only; API enforces). */
export function RequirePermission({
  permission,
  children,
  fallback,
}: {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { hasPermission } = useAuth();
  return <>{hasPermission(permission) ? children : (fallback ?? <AccessDenied />)}</>;
}

/** For the login route: an already signed-in user is sent to where they came from. */
export function RedirectIfAuthenticated({
  children,
  to = '/',
}: {
  children: ReactNode;
  to?: string;
}) {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === 'loading') return <FullPageLoader />;
  if (state.status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== LOGIN_PATH ? from : to} replace />;
  }
  return <>{children}</>;
}
