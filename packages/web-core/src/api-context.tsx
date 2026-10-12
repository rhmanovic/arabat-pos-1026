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
  // Any request refused because the POS locked itself re-reads the session, which turns
  // the auth state to "locked" and shows the lock screen.
  const onError = (error: unknown) => {
    if (error instanceof ApiError && error.code === 'SESSION_LOCKED')
      void client.invalidateQueries({ queryKey: ['auth'] });
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return client;
}
