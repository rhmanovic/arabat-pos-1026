import { type ApiClient, createApiClient } from '@arabat/api-client';
import { Direction, ToastProvider } from '@arabat/ui';
import { ApiProvider, createQueryClient } from '@arabat/web-core';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { i18n as I18nInstance } from 'i18next';
import { StrictMode, type ReactNode, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';

/**
 * Providers of the public storefront. Unlike the business apps it has no session and no
 * AuthProvider: shoppers are anonymous and every call goes to the public `/store` API.
 */
export function StoreRoot({
  i18n,
  children,
  api,
  queryClient,
}: {
  i18n: I18nInstance;
  children: ReactNode;
  api?: ApiClient;
  queryClient?: QueryClient;
}) {
  const [client] = useState(() => api ?? createApiClient({ getLanguage: () => i18n.language }));
  const [cache] = useState(() => queryClient ?? createQueryClient());
  return (
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={cache}>
          <ApiProvider client={client}>
            <DirectionRoot>
              <ToastProvider placement="bottom-end">{children}</ToastProvider>
            </DirectionRoot>
          </ApiProvider>
        </QueryClientProvider>
      </I18nextProvider>
    </StrictMode>
  );
}

function DirectionRoot({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  return <Direction.Provider dir={i18n.dir(i18n.language)}>{children}</Direction.Provider>;
}
