import { createApiClient } from '@arabat/api-client';
import type { AppInterface, MeResponse } from '@arabat/contracts';
import { render } from '@testing-library/react';
import type { i18n as I18nInstance } from 'i18next';
import { RouterProvider, createMemoryRouter, type RouteObject } from 'react-router';
import { AppRoot } from './app-root.js';
import { createQueryClient } from './api-context.js';

/** Builds a fetch stub answering health and `me` like the real API would. */
export type FakeRoute = (body: unknown) => { status: number; body: unknown };

export function problem(status: number, code: string, extra: Record<string, unknown> = {}) {
  return {
    status,
    body: { type: `urn:arabat:error:${code.toLowerCase()}`, title: code, status, code, ...extra },
  };
}

/**
 * Builds a fetch stub answering health and `me` like the real API would. `routes` maps
 * "METHOD /path" (relative to /api/v1) to handlers for other endpoints.
 */
export function fakeApiFetch(
  options: {
    session?: MeResponse | null;
    healthy?: boolean;
    routes?: Record<string, FakeRoute>;
  } = {},
) {
  const { session = null, healthy = true, routes = {} } = options;
  const calls: { method: string; path: string; query: string; body: unknown }[] = [];
  const fetchFn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const [path, query = ''] = url.replace(/^.*\/api\/v1/, '').split('?') as [string, string?];
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, query, body });
    const json = (status: number, payload: unknown, type = 'application/json') =>
      new Response(status === 204 ? null : JSON.stringify(payload), {
        status,
        headers: { 'content-type': status >= 400 ? 'application/problem+json' : type },
      });
    const handler = routes[`${method} ${path}`];
    if (handler) {
      const result = handler(body);
      return json(result.status, result.body);
    }
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
  return Object.assign(fetchFn, { calls });
}

export function makeSession(
  appInterface: AppInterface,
  permissions: string[] = [],
  overrides: Partial<MeResponse> = {},
): MeResponse {
  const merchant = appInterface !== 'platform';
  return {
    interface: appInterface,
    realm: merchant ? 'merchant' : 'platform',
    actor: {
      id: '00000000-0000-7000-8000-000000000001',
      email: 'user@test.arabat',
      fullName: 'Test User',
      preferredLanguage: null,
    },
    merchant: merchant
      ? {
          id: '00000000-0000-7000-8000-000000000002',
          nameEn: 'Test Co',
          nameAr: 'شركة اختبار',
          status: 'active',
        }
      : null,
    branch:
      appInterface === 'pos'
        ? {
            id: '00000000-0000-7000-8000-000000000003',
            nameEn: 'Main branch',
            nameAr: 'الفرع الرئيسي',
          }
        : null,
    isOwner: false,
    permissions,
    availableInterfaces: appInterface === 'platform' ? [] : [appInterface],
    merchantCount: merchant ? 1 : 0,
    session: { expiresAt: '2030-01-01T00:00:00.000Z', idleExpiresAt: '2030-01-01T00:00:00.000Z' },
    ...overrides,
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
