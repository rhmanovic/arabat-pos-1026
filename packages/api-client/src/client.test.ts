import { describe, expect, it, vi } from 'vitest';
import { ApiError, ContractError, NetworkError, createApiClient } from './index.js';

function jsonResponse(status: number, body: unknown, contentType = 'application/json') {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } });
}

describe('api client', () => {
  it('sends same-origin requests with the language header', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { status: 'ok', version: '1', checks: { database: { status: 'ok' } } }),
      );
    const api = createApiClient({ fetch, getLanguage: () => 'ar' });
    await api.health.ready();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/v1/health/ready');
    expect(init.credentials).toBe('same-origin');
    expect(init.headers['accept-language']).toBe('ar');
  });

  it('turns problem+json responses into ApiError with code and request id', async () => {
    const problem = {
      type: 'urn:arabat:error:unauthenticated',
      title: 'Authentication required',
      status: 401,
      code: 'UNAUTHENTICATED',
      requestId: 'req-1',
    };
    const api = createApiClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse(401, problem, 'application/problem+json')),
    });
    const error = await api.auth.me('manager').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('UNAUTHENTICATED');
    expect((error as ApiError).isUnauthenticated).toBe(true);
    expect((error as ApiError).requestId).toBe('req-1');
  });

  it('synthesizes an ApiError when the error body is not problem details', async () => {
    const api = createApiClient({
      fetch: vi.fn().mockResolvedValue(new Response('oops', { status: 502 })),
    });
    const error = (await api.auth.me('pos').catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.code).toBe('INTERNAL_ERROR');
  });

  it('reports unreachable servers as NetworkError', async () => {
    const api = createApiClient({
      fetch: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });
    await expect(api.auth.me('platform')).rejects.toBeInstanceOf(NetworkError);
  });

  it('validates responses against the contract', async () => {
    const api = createApiClient({
      fetch: vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: true })),
    });
    await expect(api.auth.me('manager')).rejects.toBeInstanceOf(ContractError);
  });

  it('maps a 503 readiness answer to a "down" status', async () => {
    const problem = {
      type: 'x',
      title: 'Service unavailable',
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    };
    const api = createApiClient({ fetch: vi.fn().mockResolvedValue(jsonResponse(503, problem)) });
    await expect(api.health.ready()).resolves.toMatchObject({ status: 'down' });
  });
});
