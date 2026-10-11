import {
  type AppInterface,
  type MeResponse,
  type ReadyResponse,
  meResponseSchema,
  readyResponseSchema,
} from '@arabat/contracts';
import type { z } from 'zod';
import { ApiError, ContractError, NetworkError, toApiError } from './errors.js';

export interface ApiClientOptions {
  /** Base URL of the versioned API, default "/api/v1" (same origin). */
  baseUrl?: string;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Current UI language, sent as Accept-Language so the API localizes messages. */
  getLanguage?: () => string;
}

export interface RequestOptions<TSchema extends z.ZodType | undefined> {
  body?: unknown;
  schema?: TSchema;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? '/api/v1').replace(/\/$/, '');
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request<TSchema extends z.ZodType | undefined = undefined>(
    method: Method,
    path: string,
    opts: RequestOptions<TSchema> = {},
  ): Promise<TSchema extends z.ZodType ? z.output<TSchema> : unknown> {
    const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
    const language = options.getLanguage?.();
    if (language) headers['accept-language'] = language;
    if (opts.body !== undefined) headers['content-type'] = 'application/json';

    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        headers,
        credentials: 'same-origin',
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new NetworkError(error);
    }

    if (!response.ok) throw await toApiError(response);
    if (response.status === 204) return undefined as never;

    const data: unknown = await response.json();
    if (!opts.schema) return data as never;
    const parsed = opts.schema.safeParse(data);
    if (!parsed.success) throw new ContractError(path, parsed.error);
    return parsed.data as never;
  }

  return {
    request,
    health: {
      /** Readiness also answers 503 with a valid body when the database is down. */
      async ready(signal?: AbortSignal): Promise<ReadyResponse> {
        try {
          return await request('GET', '/health/ready', {
            schema: readyResponseSchema,
            ...(signal ? { signal } : {}),
          });
        } catch (error) {
          if (error instanceof ApiError && error.status === 503) {
            return { status: 'down', version: 'unknown', checks: { database: { status: 'down' } } };
          }
          throw error;
        }
      },
    },
    auth: {
      me(appInterface: AppInterface, signal?: AbortSignal): Promise<MeResponse> {
        return request('GET', `/auth/${appInterface}/me`, {
          schema: meResponseSchema,
          ...(signal ? { signal } : {}),
        });
      },
    },
  };
}
