import { createApiClient } from '@arabat/api-client';
import type { AppInterface, MeResponse } from '@arabat/contracts';
import { render } from '@testing-library/react';
import type { i18n as I18nInstance } from 'i18next';
import { RouterProvider, createMemoryRouter, type RouteObject } from 'react-router';
import { AppRoot } from './app-root.js';
import { createQueryClient } from './api-context.js';

/** Builds a fetch stub answering health and `me` like the real API would. */
export function fakeApiFetch(options: { session?: MeResponse | null; healthy?: boolean } = {}) {
  const { session = null, healthy = true } = options;
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const json = (status: number, body: unknown, type = 'application/json') =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });
    if (url.endsWith('/health/ready')) {
      return healthy
        ? json(200, {
            status: 'ok',
            version: 'test',
            checks: { database: { status: 'ok', latencyMs: 1 } },
          })
        : json(503, { status: 'down', version: 'test', checks: { database: { status: 'down' } } });
    }
    if (url.includes('/auth/') && url.endsWith('/me')) {
      return session
        ? json(200, session)
        : json(
            401,
            {
              type: 'urn:arabat:error:unauthenticated',
              title: 'Authentication required',
              status: 401,
              code: 'UNAUTHENTICATED',
              requestId: 't-1',
            },
            'application/problem+json',
          );
    }
    return json(
      404,
      { type: 'x', title: 'Route not found', status: 404, code: 'ROUTE_NOT_FOUND' },
      'application/problem+json',
    );
  };
}

export function makeSession(appInterface: AppInterface, permissions: string[] = []): MeResponse {
  return {
    interface: appInterface,
    realm: appInterface === 'platform' ? 'platform' : 'merchant',
    actorId: '00000000-0000-7000-8000-000000000001',
    merchantId: appInterface === 'platform' ? null : '00000000-0000-7000-8000-000000000002',
    boundBranchId: appInterface === 'pos' ? '00000000-0000-7000-8000-000000000003' : null,
    permissions,
  };
}

/** Renders an app's route tree in memory with real providers and a fake API. */
export function renderApp(options: {
  routes: RouteObject[];
  appInterface: AppInterface;
  i18n: I18nInstance;
  path?: string;
  fetch?: typeof fetch;
}) {
  const router = createMemoryRouter(options.routes, { initialEntries: [options.path ?? '/'] });
  const api = createApiClient({ fetch: options.fetch ?? fakeApiFetch() });
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  const result = render(
    <AppRoot
      appInterface={options.appInterface}
      i18n={options.i18n}
      api={api}
      queryClient={queryClient}
    >
      <RouterProvider router={router} />
    </AppRoot>,
  );
  return { ...result, router };
}
