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
  type Checkout,
  type SaleListQuery,
  type SuspendOrder,
  receiptSchema,
  saleListSchema,
  saleSchema,
  saleSummarySchema,
  salesSettingsSchema,
  suspendedOrderListSchema,
  suspendedOrderSchema,
  type CloseShift,
  type DiscrepancyReportQuery,
  type OpenShift,
  type RecordCashMovement,
  type SaveFinancialAccount,
  type SavePaymentMethod,
  type SaveRegister,
  type ShiftListQuery,
  currentShiftSchema,
  discrepancyReportSchema,
  financialAccountListSchema,
  financialAccountSchema,
  paymentMethodListSchema,
  paymentMethodSchema,
  posPaymentMethodListSchema,
  posRegisterListSchema,
  registerListSchema,
  registerSchema,
  shiftListSchema,
  shiftSchema,
  type AdjustmentListQuery,
  type CreateAdjustment,
  type MovementQuery,
  type StockLevelQuery,
  adjustmentListSchema,
  adjustmentSchema,
  inventorySettingsSchema,
  inventorySummarySchema,
  movementListSchema,
  posAvailabilitySchema,
  stockLevelListSchema,
  variantStockSchema,
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
import { z } from 'zod';
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
    inventory: {
      levels: (query: StockLevelQuery = {}) =>
        request('GET', `/manager/inventory/levels?${toParams(query)}`, {
          schema: stockLevelListSchema,
        }),
      summary: (branchId?: string | null) =>
        request('GET', `/manager/inventory/summary?${toParams({ branchId })}`, {
          schema: inventorySummarySchema,
        }),
      variant: (variantId: string) =>
        request('GET', `/manager/inventory/variants/${variantId}`, { schema: variantStockSchema }),
      setThreshold: (body: { branchId: string; variantId: string; threshold: string | null }) =>
        request('PUT', '/manager/inventory/thresholds', { body }),
      movements: (query: MovementQuery = {}) =>
        request('GET', `/manager/inventory/movements?${toParams(query)}`, {
          schema: movementListSchema,
        }),
      adjustments: (query: AdjustmentListQuery = {}) =>
        request('GET', `/manager/inventory/adjustments?${toParams(query)}`, {
          schema: adjustmentListSchema,
        }),
      adjustment: (id: string) =>
        request('GET', `/manager/inventory/adjustments/${id}`, { schema: adjustmentSchema }),
      createAdjustment: (body: CreateAdjustment) =>
        request('POST', '/manager/inventory/adjustments', { body, schema: adjustmentSchema }),
      settings: () =>
        request('GET', '/manager/inventory/settings', { schema: inventorySettingsSchema }),
      updateSettings: (body: { allowNegativeStock: boolean; version: number }) =>
        request('PUT', '/manager/inventory/settings', { body, schema: inventorySettingsSchema }),
      posAvailability: (variantIds?: string[]) =>
        request(
          'GET',
          `/pos/inventory/availability?${toParams({ variantIds: variantIds?.join(',') })}`,
          { schema: posAvailabilitySchema },
        ),
    },
    payments: {
      methods: () =>
        request('GET', '/manager/payment-methods', { schema: paymentMethodListSchema }),
      createMethod: (body: SavePaymentMethod) =>
        request('POST', '/manager/payment-methods', { body, schema: paymentMethodSchema }),
      updateMethod: (id: string, body: SavePaymentMethod) =>
        request('PATCH', `/manager/payment-methods/${id}`, { body, schema: paymentMethodSchema }),
      accounts: () =>
        request('GET', '/manager/financial-accounts', { schema: financialAccountListSchema }),
      createAccount: (body: SaveFinancialAccount) =>
        request('POST', '/manager/financial-accounts', { body, schema: financialAccountSchema }),
      updateAccount: (id: string, body: SaveFinancialAccount) =>
        request('PATCH', `/manager/financial-accounts/${id}`, {
          body,
          schema: financialAccountSchema,
        }),
      posMethods: () =>
        request('GET', '/pos/payment-methods', { schema: posPaymentMethodListSchema }),
    },
    registers: {
      list: (branchId?: string | null) =>
        request('GET', `/manager/registers?${toParams({ branchId })}`, {
          schema: registerListSchema,
        }),
      create: (body: SaveRegister) =>
        request('POST', '/manager/registers', { body, schema: registerSchema }),
      update: (id: string, body: SaveRegister) =>
        request('PATCH', `/manager/registers/${id}`, { body, schema: registerSchema }),
      setStatus: (id: string, status: 'active' | 'inactive') =>
        request('POST', `/manager/registers/${id}/status`, {
          body: { status },
          schema: registerSchema,
        }),
    },
    shifts: {
      list: (query: ShiftListQuery = {}) =>
        request('GET', `/manager/shifts?${toParams(query)}`, { schema: shiftListSchema }),
      get: (id: string) => request('GET', `/manager/shifts/${id}`, { schema: shiftSchema }),
      discrepancies: (query: DiscrepancyReportQuery = {}) =>
        request('GET', `/manager/shifts/discrepancies?${toParams(query)}`, {
          schema: discrepancyReportSchema,
        }),
      forceClose: (id: string, body: CloseShift) =>
        request('POST', `/manager/shifts/${id}/force-close`, { body, schema: shiftSchema }),
      posRegisters: () => request('GET', '/pos/registers', { schema: posRegisterListSchema }),
      current: () => request('GET', '/pos/shifts/current', { schema: currentShiftSchema }),
      open: (body: OpenShift) => request('POST', '/pos/shifts', { body, schema: shiftSchema }),
      cashMovement: (body: RecordCashMovement) =>
        request('POST', '/pos/shifts/current/cash-movements', { body, schema: shiftSchema }),
      close: (body: CloseShift) =>
        request('POST', '/pos/shifts/current/close', { body, schema: shiftSchema }),
    },
    sales: {
      settings: () => request('GET', '/pos/sales/settings', { schema: salesSettingsSchema }),
      checkout: (body: Checkout) => request('POST', '/pos/sales', { body, schema: saleSchema }),
      recent: () =>
        request('GET', '/pos/sales/recent', {
          schema: z.object({ sales: z.array(saleSummarySchema) }),
        }),
      posReceipt: (id: string) =>
        request('GET', `/pos/sales/${id}/receipt`, { schema: receiptSchema }),
      suspend: (body: SuspendOrder) =>
        request('POST', '/pos/orders', { body, schema: suspendedOrderSchema }),
      suspended: () =>
        request('GET', '/pos/orders/suspended', { schema: suspendedOrderListSchema }),
      cancelSuspended: (id: string) => request('POST', `/pos/orders/${id}/cancel`, { body: {} }),
      list: (query: SaleListQuery = {}) =>
        request('GET', `/manager/sales?${toParams(query)}`, { schema: saleListSchema }),
      get: (id: string) => request('GET', `/manager/sales/${id}`, { schema: saleSchema }),
      receipt: (id: string) =>
        request('GET', `/manager/sales/${id}/receipt`, { schema: receiptSchema }),
      managerSettings: () =>
        request('GET', '/manager/sales-settings', { schema: salesSettingsSchema }),
      updateSettings: (body: { maxDiscountPercent: string; version: number }) =>
        request('PUT', '/manager/sales-settings', { body, schema: salesSettingsSchema }),
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

function toParams(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  return params.toString();
}
