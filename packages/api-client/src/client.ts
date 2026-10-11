import {
  type AppInterface,
  type ForgotPasswordRequest,
  type LoginRequest,
  type LoginResult,
  type MeResponse,
  type MerchantInterface,
  type PlatformLoginRequest,
  type PlatformMfaRequest,
  type ReadyResponse,
  type RegisterRequest,
  type ResetPasswordRequest,
  type SelectMerchantRequest,
  type SwitchInterfaceRequest,
  type SwitchMerchantRequest,
  type UpdateMerchantProfile,
  type AcceptInvitation,
  acceptInvitationResultSchema,
  invitationPreviewSchema,
  type CreateBranch,
  type ProductListQuery,
  type SaveCategory,
  type SaveProduct,
  categoryListSchema,
  categorySchema,
  posCatalogSchema,
  productListSchema,
  productSchema,
  type CreateRole,
  type InviteEmployee,
  type SetAssignments,
  type UpdateBranch,
  type UpdateEmployee,
  type UpdateRole,
  branchDetailListSchema,
  branchDetailSchema,
  employeeListSchema,
  employeeSchema,
  invitationSchema,
  permissionCatalogSchema,
  roleListSchema,
  roleSchema,
  loginResultSchema,
  meResponseSchema,
  merchantListResponseSchema,
  merchantProfileSchema,
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
      register: (body: RegisterRequest): Promise<LoginResult> =>
        request('POST', '/auth/register', { body, schema: loginResultSchema }),
      login: (body: LoginRequest): Promise<LoginResult> =>
        request('POST', '/auth/login', { body, schema: loginResultSchema }),
      selectMerchant: (body: SelectMerchantRequest): Promise<LoginResult> =>
        request('POST', '/auth/login/select', { body, schema: loginResultSchema }),
      platformLogin: (body: PlatformLoginRequest): Promise<LoginResult> =>
        request('POST', '/auth/platform/login', { body, schema: loginResultSchema }),
      platformMfa: (body: PlatformMfaRequest): Promise<LoginResult> =>
        request('POST', '/auth/platform/mfa', { body, schema: loginResultSchema }),
      forgotPassword: (body: ForgotPasswordRequest) =>
        request('POST', '/auth/password/forgot', { body }),
      resetPassword: (body: ResetPasswordRequest) =>
        request('POST', '/auth/password/reset', { body }),
      logout: (appInterface: AppInterface) =>
        request('POST', `/auth/${appInterface}/logout`, { body: {} }),
      merchants: (appInterface: MerchantInterface) =>
        request('GET', `/auth/${appInterface}/merchants`, { schema: merchantListResponseSchema }),
      switchMerchant: (
        appInterface: MerchantInterface,
        body: SwitchMerchantRequest,
      ): Promise<LoginResult> =>
        request('POST', `/auth/${appInterface}/switch-merchant`, {
          body,
          schema: loginResultSchema,
        }),
      switchInterface: (
        from: MerchantInterface,
        body: SwitchInterfaceRequest,
      ): Promise<LoginResult> =>
        request('POST', `/auth/${from}/switch-interface`, { body, schema: loginResultSchema }),
      switchBranch: (branchId: string): Promise<LoginResult> =>
        request('POST', '/auth/pos/switch-branch', {
          body: { branchId },
          schema: loginResultSchema,
        }),
      previewInvitation: (token: string) =>
        request('POST', '/auth/invitations/preview', {
          body: { token },
          schema: invitationPreviewSchema,
        }),
      acceptInvitation: (body: AcceptInvitation) =>
        request('POST', '/auth/invitations/accept', { body, schema: acceptInvitationResultSchema }),
    },
    merchant: {
      get: () => request('GET', '/manager/merchant', { schema: merchantProfileSchema }),
      update: (body: UpdateMerchantProfile) =>
        request('PATCH', '/manager/merchant', { body, schema: merchantProfileSchema }),
    },
    branches: {
      list: () => request('GET', '/manager/branches', { schema: branchDetailListSchema }),
      get: (id: string) =>
        request('GET', `/manager/branches/${id}`, { schema: branchDetailSchema }),
      create: (body: CreateBranch) =>
        request('POST', '/manager/branches', { body, schema: branchDetailSchema }),
      update: (id: string, body: UpdateBranch) =>
        request('PATCH', `/manager/branches/${id}`, { body, schema: branchDetailSchema }),
      setStatus: (id: string, status: 'active' | 'inactive') =>
        request('POST', `/manager/branches/${id}/status`, {
          body: { status },
          schema: branchDetailSchema,
        }),
    },
    roles: {
      catalog: () => request('GET', '/manager/permissions', { schema: permissionCatalogSchema }),
      list: () => request('GET', '/manager/roles', { schema: roleListSchema }),
      create: (body: CreateRole) => request('POST', '/manager/roles', { body, schema: roleSchema }),
      update: (id: string, body: UpdateRole) =>
        request('PATCH', `/manager/roles/${id}`, { body, schema: roleSchema }),
      remove: (id: string) => request('DELETE', `/manager/roles/${id}`),
    },
    catalog: {
      categories: () => request('GET', '/manager/categories', { schema: categoryListSchema }),
      createCategory: (body: SaveCategory) =>
        request('POST', '/manager/categories', { body, schema: categorySchema }),
      updateCategory: (id: string, body: SaveCategory) =>
        request('PATCH', `/manager/categories/${id}`, { body, schema: categorySchema }),
      setCategoryStatus: (id: string, status: 'active' | 'archived') =>
        request('POST', `/manager/categories/${id}/status`, {
          body: { status },
          schema: categorySchema,
        }),
      products: (query: ProductListQuery = {}) => {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(query))
          if (value !== undefined && value !== '') params.set(key, String(value));
        return request('GET', `/manager/products?${params.toString()}`, {
          schema: productListSchema,
        });
      },
      product: (id: string) => request('GET', `/manager/products/${id}`, { schema: productSchema }),
      createProduct: (body: SaveProduct) =>
        request('POST', '/manager/products', { body, schema: productSchema }),
      updateProduct: (id: string, body: SaveProduct) =>
        request('PATCH', `/manager/products/${id}`, { body, schema: productSchema }),
      setProductStatus: (id: string, status: 'active' | 'archived') =>
        request('POST', `/manager/products/${id}/status`, {
          body: { status },
          schema: productSchema,
        }),
      deleteImage: (id: string, imageId: string) =>
        request('DELETE', `/manager/products/${id}/images/${imageId}`, { schema: productSchema }),
      /** Multipart upload; returns the updated product. */
      async uploadImage(id: string, file: Blob) {
        const form = new FormData();
        form.append('file', file);
        const response = await doFetch(`${baseUrl}/manager/products/${id}/images`, {
          method: 'POST',
          body: form,
          credentials: 'same-origin',
        }).catch((error: unknown) => {
          throw new NetworkError(error);
        });
        if (!response.ok) throw await toApiError(response);
        return productSchema.parse(await response.json());
      },
      posCatalog: () => request('GET', '/pos/catalog', { schema: posCatalogSchema }),
    },
    employees: {
      list: () => request('GET', '/manager/employees', { schema: employeeListSchema }),
      get: (id: string) => request('GET', `/manager/employees/${id}`, { schema: employeeSchema }),
      invite: (body: InviteEmployee) =>
        request('POST', '/manager/employees/invitations', { body, schema: invitationSchema }),
      resendInvitation: (id: string) =>
        request('POST', `/manager/employees/invitations/${id}/resend`, {
          body: {},
          schema: invitationSchema,
        }),
      revokeInvitation: (id: string) =>
        request('POST', `/manager/employees/invitations/${id}/revoke`, { body: {} }),
      update: (id: string, body: UpdateEmployee) =>
        request('PATCH', `/manager/employees/${id}`, { body, schema: employeeSchema }),
      setStatus: (id: string, status: 'active' | 'inactive') =>
        request('POST', `/manager/employees/${id}/status`, {
          body: { status },
          schema: employeeSchema,
        }),
      setAssignments: (id: string, body: SetAssignments) =>
        request('PUT', `/manager/employees/${id}/assignments`, { body, schema: employeeSchema }),
      sendPasswordReset: (id: string) =>
        request('POST', `/manager/employees/${id}/password-reset`, { body: {} }),
    },
  };
}
