import { ApiError } from '@arabat/api-client';
import type { AppInterface, MeResponse } from '@arabat/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, createContext, useCallback, useContext, useMemo } from 'react';
import { useApi } from './api-context.js';

export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; session: MeResponse }
  /** POS screen lock: the session exists but needs the password again. */
  | { status: 'locked' }
  | { status: 'error'; error: unknown };

export interface AuthContextValue {
  appInterface: AppInterface;
  state: AuthState;
  /** UI hint only: hides controls the user cannot use. The API enforces every permission. */
  hasPermission: (permission: string) => boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const authQueryKey = (appInterface: AppInterface) => ['auth', appInterface, 'me'] as const;

/**
 * Shared authentication state for one interface. Each app has its own session
 * (separate cookie per interface, AUTH.md §2.1), so the provider is bound to one interface.
 */
export function AuthProvider({
  appInterface,
  children,
}: {
  appInterface: AppInterface;
  children: ReactNode;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: authQueryKey(appInterface),
    queryFn: async ({ signal }) => {
      try {
        return await api.auth.me(appInterface, signal);
      } catch (error) {
        if (error instanceof ApiError && error.code === 'SESSION_LOCKED') return 'locked' as const;
        if (error instanceof ApiError && error.isUnauthenticated) return null;
        throw error;
      }
    },
    staleTime: 60_000,
  });

  const state: AuthState = query.isPending
    ? { status: 'loading' }
    : query.isError
      ? { status: 'error', error: query.error }
      : query.data === 'locked'
        ? { status: 'locked' }
        : query.data
          ? { status: 'authenticated', session: query.data }
          : { status: 'anonymous' };

  const permissions = state.status === 'authenticated' ? state.session.permissions : null;
  const hasPermission = useCallback(
    (permission: string) => permissions?.includes(permission) ?? false,
    [permissions],
  );
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: authQueryKey(appInterface) }),
    [queryClient, appInterface],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ appInterface, state, hasPermission, refresh }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state is derived from query fields
    [appInterface, query.status, query.data, query.error, hasPermission, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** Test/preview helper: provides a fixed auth state without calling the API. */
export function StaticAuthProvider({
  value,
  children,
}: {
  value: AuthContextValue;
  children: ReactNode;
}) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
