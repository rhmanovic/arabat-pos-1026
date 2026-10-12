import { type ApiClient, ApiError, NetworkError } from '@arabat/api-client';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { type ReactNode, createContext, useContext } from 'react';

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error('useApi must be used inside <ApiProvider>');
  return client;
}

/** Retries only transient failures; 4xx answers are final. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) return error.status >= 500 && failureCount < 2;
  if (error instanceof NetworkError) return failureCount < 2;
  return false;
}

export function createQueryClient(): QueryClient {
  // A request refused because the POS locked itself, or because the session ended (expired,
  // signed out elsewhere, revoked), re-reads the session: the auth state turns "locked" or
  // "unauthenticated" and the guards show the lock screen or the sign-in page, instead of
  // pages that look empty. The session query itself is skipped so a 401 there cannot loop.
  const onError = (error: unknown, queryKey?: readonly unknown[]) => {
    if (queryKey?.[0] === 'auth' || !(error instanceof ApiError)) return;
    if (error.code === 'SESSION_LOCKED' || error.status === 401)
      void client.invalidateQueries({ queryKey: ['auth'] });
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (error, query) => onError(error, query.queryKey) }),
    mutationCache: new MutationCache({ onError: (error) => onError(error) }),
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return client;
}
