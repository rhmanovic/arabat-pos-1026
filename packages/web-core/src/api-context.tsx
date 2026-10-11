import { type ApiClient, ApiError, NetworkError } from '@arabat/api-client';
import { QueryClient } from '@tanstack/react-query';
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
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}
