import { type ApiClient, createApiClient } from '@arabat/api-client';
import type { AppInterface } from '@arabat/contracts';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { i18n as I18nInstance } from 'i18next';
import { StrictMode, type ReactNode, useState } from 'react';
import { Direction, ToastProvider } from '@arabat/ui';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { ApiProvider, createQueryClient } from './api-context.js';
import { AuthProvider } from './auth.js';

export interface AppRootProps {
  appInterface: AppInterface;
  i18n: I18nInstance;
  children: ReactNode;
  api?: ApiClient;
  queryClient?: QueryClient;
}

/** Providers shared by every app: i18n, API client, server-state cache, auth state. */
export function AppRoot({ appInterface, i18n, children, api, queryClient }: AppRootProps) {
  // Created once per app instance so re-renders keep the same cache and client.
  const [client] = useState(() => api ?? createApiClient({ getLanguage: () => i18n.language }));
  const [cache] = useState(() => queryClient ?? createQueryClient());
  return (
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={cache}>
          <ApiProvider client={client}>
            <DirectionRoot>
              <ToastProvider>
                <AuthProvider appInterface={appInterface}>{children}</AuthProvider>
              </ToastProvider>
            </DirectionRoot>
          </ApiProvider>
        </QueryClientProvider>
      </I18nextProvider>
    </StrictMode>
  );
}

/** Gives Radix components (menus, dialogs, tabs) the current text direction. */
function DirectionRoot({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  return <Direction.Provider dir={i18n.dir(i18n.language)}>{children}</Direction.Provider>;
}
