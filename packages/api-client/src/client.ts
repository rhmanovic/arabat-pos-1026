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
  type CreateTransfer,
  type PurchaseOrderListQuery,
  type ReceivePurchase,
  type SavePurchaseOrder,
  type SaveSupplier,
  type TransferListQuery,
  type TransferQuantities,
  purchaseOrderListSchema,
  purchaseOrderSchema,
  supplierListSchema,
  supplierSchema,
  transferListSchema,
  transferSchema,
  type CreateRefund,
  type Exchange,
  type RefundListQuery,
  type VoidSale,
  refundActivitySchema,
  refundListSchema,
  refundPreviewSchema,
  refundReceiptSchema,
  refundSchema,
  refundableSaleSchema,
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
  type CreateCustomer,
  type CustomerListQuery,
  type SaveCustomer,
  customerListSchema,
  customerNoteListSchema,
  customerRefundListSchema,
  customerSchema,
  posCustomerListSchema,
  posCustomerSchema,
  type ReportQuery,
  inventoryReportSchema,
  paymentsReportSchema,
  purchasingReportSchema,
  salesReportSchema,
  shiftsReportSchema,
  type AddOrderItems,
  type CreateRestaurantOrder,
  type PayOrder,
  type SaveMenuItem,
  type SaveModifierGroup,
  branchLayoutSchema,
  floorSchema,
  kitchenBoardSchema,
  kitchenTicketSchema,
  menuListSchema,
  modifierGroupSchema,
  orderQuoteSchema,
  payOrderResultSchema,
  posMenuSchema,
  restaurantOrderSchema,
  restaurantSettingsSchema,
  type OnlineOrderListQuery,
  type SaveOnlineStore,
  type StoreCheckout,
  listingListSchema,
  mockPaymentSchema,
  onlineOrderListSchema,
  onlineOrderSchema,
  onlineStoreSchema,
  publicOrderSchema,
  storeCheckoutResultSchema,
  storeProductListSchema,
  storeProductSchema,
  storefrontSchema,
  type ChangeSubscription,
  type CreateMerchant,
  type PlatformAuditQuery,
  type PlatformMerchantQuery,
  type SavePlan,
  managerSubscriptionSchema,
  planCheckSchema,
  planListSchema,
  planSchema,
  platformAuditListSchema,
  platformMerchantDetailSchema,
  platformMerchantListSchema,
  platformOverviewSchema,
  subscriptionViewSchema,
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
    /** The signed-in merchant's own subscription (Prompt 17). */
    subscription: {
      get: () => request('GET', '/manager/subscription', { schema: managerSubscriptionSchema }),
    },
    /** SaaS operator console (platform realm only). */
    platform: {
      overview: () => request('GET', '/platform/overview', { schema: platformOverviewSchema }),
      merchants: (query: PlatformMerchantQuery = {}) =>
        request('GET', `/platform/merchants?${toParams(query)}`, {
          schema: platformMerchantListSchema,
        }),
      merchant: (id: string) =>
        request('GET', `/platform/merchants/${id}`, { schema: platformMerchantDetailSchema }),
      createMerchant: (body: CreateMerchant) =>
        request('POST', '/platform/merchants', { body, schema: platformMerchantDetailSchema }),
      setStatus: (
        id: string,
        body: { status: 'active' | 'suspended' | 'closed'; reason: string; version: number },
      ) =>
        request('POST', `/platform/merchants/${id}/status`, {
          body,
          schema: platformMerchantDetailSchema,
        }),
      planCheck: (id: string, planId: string) =>
        request('GET', `/platform/merchants/${id}/plan-check?${toParams({ planId })}`, {
          schema: planCheckSchema,
        }),
      changeSubscription: (id: string, body: ChangeSubscription) =>
        request('PUT', `/platform/merchants/${id}/subscription`, {
          body,
          schema: subscriptionViewSchema,
        }),
      plans: () => request('GET', '/platform/plans', { schema: planListSchema }),
      savePlan: (id: string | null, body: SavePlan) =>
        request(id ? 'PUT' : 'POST', id ? `/platform/plans/${id}` : '/platform/plans', {
          body,
          schema: planSchema,
        }),
      audit: (query: PlatformAuditQuery = {}) =>
        request('GET', `/platform/audit?${toParams(query)}`, { schema: platformAuditListSchema }),
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
      updateSettings: (body: {
        maxDiscountPercent: string;
        refundWindowDays: number;
        refundApprovalLimit: string;
        version: number;
      }) => request('PUT', '/manager/sales-settings', { body, schema: salesSettingsSchema }),
    },
    refunds: {
      lookup: (receipt: string) =>
        request('GET', `/pos/refunds/lookup?${toParams({ receipt })}`, {
          schema: refundableSaleSchema,
        }),
      preview: (body: { saleId: string; lines: { position: number; quantity: string }[] }) =>
        request('POST', '/pos/refunds/preview', { body, schema: refundPreviewSchema }),
      create: (body: CreateRefund) =>
        request('POST', '/pos/refunds', { body, schema: refundSchema }),
      exchange: (body: Exchange) =>
        request('POST', '/pos/exchanges', {
          body,
          schema: z.object({ refund: refundSchema, sale: saleSchema }),
        }),
      voidSale: (saleId: string, body: VoidSale) =>
        request('POST', `/pos/sales/${saleId}/void`, { body, schema: refundSchema }),
      posReceipt: (id: string) =>
        request('GET', `/pos/refunds/${id}/receipt`, { schema: refundReceiptSchema }),
      posApprove: (id: string, note: string | null = null) =>
        request('POST', `/pos/refunds/${id}/approve`, { body: { note }, schema: refundSchema }),
      posCancel: (id: string) =>
        request('POST', `/pos/refunds/${id}/cancel`, { body: {}, schema: refundSchema }),
      list: (query: RefundListQuery = {}) =>
        request('GET', `/manager/refunds?${toParams(query)}`, { schema: refundListSchema }),
      get: (id: string) => request('GET', `/manager/refunds/${id}`, { schema: refundSchema }),
      approve: (id: string, note: string | null = null) =>
        request('POST', `/manager/refunds/${id}/approve`, { body: { note }, schema: refundSchema }),
      reject: (id: string, note: string | null = null) =>
        request('POST', `/manager/refunds/${id}/reject`, { body: { note }, schema: refundSchema }),
      activity: (query: { branchId?: string; from?: string; to?: string } = {}) =>
        request('GET', `/manager/refunds/activity?${toParams(query)}`, {
          schema: refundActivitySchema,
        }),
    },
    purchasing: {
      suppliers: () => request('GET', '/manager/suppliers', { schema: supplierListSchema }),
      createSupplier: (body: SaveSupplier) =>
        request('POST', '/manager/suppliers', { body, schema: supplierSchema }),
      updateSupplier: (id: string, body: SaveSupplier) =>
        request('PATCH', `/manager/suppliers/${id}`, { body, schema: supplierSchema }),
      orders: (query: PurchaseOrderListQuery = {}) =>
        request('GET', `/manager/purchase-orders?${toParams(query)}`, {
          schema: purchaseOrderListSchema,
        }),
      order: (id: string) =>
        request('GET', `/manager/purchase-orders/${id}`, { schema: purchaseOrderSchema }),
      createOrder: (body: SavePurchaseOrder) =>
        request('POST', '/manager/purchase-orders', { body, schema: purchaseOrderSchema }),
      updateOrder: (id: string, body: SavePurchaseOrder) =>
        request('PATCH', `/manager/purchase-orders/${id}`, { body, schema: purchaseOrderSchema }),
      orderAction: (
        id: string,
        action: 'submit' | 'approve' | 'cancel' | 'close',
        body: { version: number; reason?: string | null },
      ) =>
        request('POST', `/manager/purchase-orders/${id}/${action}`, {
          body,
          schema: purchaseOrderSchema,
        }),
      receive: (id: string, body: ReceivePurchase) =>
        request('POST', `/manager/purchase-orders/${id}/receipts`, {
          body,
          schema: purchaseOrderSchema,
        }),
    },
    online: {
      store: () => request('GET', '/manager/online/store', { schema: onlineStoreSchema }),
      saveStore: (body: SaveOnlineStore) =>
        request('PUT', '/manager/online/store', { body, schema: onlineStoreSchema }),
      listings: () => request('GET', '/manager/online/listings', { schema: listingListSchema }),
      setListings: (body: { productIds: string[]; listed: boolean }) =>
        request('PUT', '/manager/online/listings', { body, schema: listingListSchema }),
      orders: (query: OnlineOrderListQuery = {}) =>
        request('GET', `/manager/online/orders?${toParams(query)}`, {
          schema: onlineOrderListSchema,
        }),
      order: (id: string) =>
        request('GET', `/manager/online/orders/${id}`, { schema: onlineOrderSchema }),
      act: (
        id: string,
        body: {
          action: 'preparing' | 'ready' | 'out_for_delivery' | 'completed' | 'cancel';
          note?: string | null;
          version: number;
        },
      ) =>
        request('POST', `/manager/online/orders/${id}/action`, { body, schema: onlineOrderSchema }),
      /** Re-checks unpaid orders with their gateway and expires overdue ones. */
      reconcile: () =>
        request('POST', '/manager/online/reconcile', {
          schema: z.object({ checked: z.number(), paid: z.number(), expired: z.number() }),
        }),
    },
    /** Public storefront (no session). */
    store: {
      info: (slug: string) =>
        request('GET', `/store/${encodeURIComponent(slug)}`, { schema: storefrontSchema }),
      products: (slug: string) =>
        request('GET', `/store/${encodeURIComponent(slug)}/products`, {
          schema: storeProductListSchema,
        }),
      product: (slug: string, productId: string) =>
        request('GET', `/store/${encodeURIComponent(slug)}/products/${productId}`, {
          schema: storeProductSchema,
        }),
      checkout: (slug: string, body: StoreCheckout) =>
        request('POST', `/store/${encodeURIComponent(slug)}/checkout`, {
          body,
          schema: storeCheckoutResultSchema,
        }),
      order: (slug: string, token: string) =>
        request('GET', `/store/${encodeURIComponent(slug)}/orders/${token}`, {
          schema: publicOrderSchema,
        }),
      mockPayment: (reference: string) =>
        request('GET', `/payments/mock/${encodeURIComponent(reference)}`, {
          schema: mockPaymentSchema,
        }),
      mockComplete: (reference: string, outcome: 'succeeded' | 'failed' | 'cancelled') =>
        request('POST', `/payments/mock/${encodeURIComponent(reference)}`, {
          body: { outcome },
          schema: mockPaymentSchema,
        }),
    },
    restaurant: {
      settings: () =>
        request('GET', '/manager/restaurant/settings', { schema: restaurantSettingsSchema }),
      updateSettings: (body: { enabled: boolean; autoSendOnPayment: boolean; version: number }) =>
        request('PUT', '/manager/restaurant/settings', { body, schema: restaurantSettingsSchema }),
      layout: (branchId: string) =>
        request('GET', `/manager/restaurant/layout?${toParams({ branchId })}`, {
          schema: branchLayoutSchema,
        }),
      saveArea: (
        id: string | null,
        body: {
          branchId: string;
          nameEn?: string | null;
          nameAr?: string | null;
          position?: number;
          status?: 'active' | 'inactive';
          version?: number;
        },
      ) =>
        request(
          id ? 'PUT' : 'POST',
          id ? `/manager/restaurant/areas/${id}` : '/manager/restaurant/areas',
          { body, schema: branchLayoutSchema },
        ),
      saveTable: (
        id: string | null,
        body: {
          areaId: string;
          code: string;
          seats?: number;
          position?: number;
          status?: 'active' | 'inactive';
          version?: number;
        },
      ) =>
        request(
          id ? 'PUT' : 'POST',
          id ? `/manager/restaurant/tables/${id}` : '/manager/restaurant/tables',
          { body, schema: branchLayoutSchema },
        ),
      saveStation: (
        id: string | null,
        body: {
          branchId: string;
          nameEn?: string | null;
          nameAr?: string | null;
          isDefault?: boolean;
          status?: 'active' | 'inactive';
          categoryIds?: string[];
          version?: number;
        },
      ) =>
        request(
          id ? 'PUT' : 'POST',
          id ? `/manager/restaurant/stations/${id}` : '/manager/restaurant/stations',
          { body, schema: branchLayoutSchema },
        ),
      menu: () => request('GET', '/manager/restaurant/menu', { schema: menuListSchema }),
      saveMenuItem: (productId: string, body: SaveMenuItem) =>
        request('PUT', `/manager/restaurant/menu/${productId}`, { body, schema: menuListSchema }),
      saveGroup: (id: string | null, body: SaveModifierGroup) =>
        request(
          id ? 'PUT' : 'POST',
          id ? `/manager/restaurant/modifier-groups/${id}` : '/manager/restaurant/modifier-groups',
          { body, schema: modifierGroupSchema },
        ),
      // POS
      posSettings: () =>
        request('GET', '/pos/restaurant/settings', { schema: restaurantSettingsSchema }),
      posMenu: () => request('GET', '/pos/restaurant/menu', { schema: posMenuSchema }),
      floor: () => request('GET', '/pos/restaurant/floor', { schema: floorSchema }),
      open: (body: CreateRestaurantOrder) =>
        request('POST', '/pos/restaurant/orders', { body, schema: restaurantOrderSchema }),
      order: (id: string) =>
        request('GET', `/pos/restaurant/orders/${id}`, { schema: restaurantOrderSchema }),
      addItems: (id: string, body: AddOrderItems) =>
        request('POST', `/pos/restaurant/orders/${id}/items`, {
          body,
          schema: restaurantOrderSchema,
        }),
      send: (id: string) =>
        request('POST', `/pos/restaurant/orders/${id}/send`, {
          body: {},
          schema: restaurantOrderSchema,
        }),
      cancelItem: (id: string, itemId: string, body: { reason: string; waste: boolean }) =>
        request('POST', `/pos/restaurant/orders/${id}/items/${itemId}/cancel`, {
          body,
          schema: restaurantOrderSchema,
        }),
      move: (id: string, body: { version: number; tableId: string }) =>
        request('POST', `/pos/restaurant/orders/${id}/move`, {
          body,
          schema: restaurantOrderSchema,
        }),
      merge: (id: string, body: { version: number; sourceOrderId: string }) =>
        request('POST', `/pos/restaurant/orders/${id}/merge`, {
          body,
          schema: restaurantOrderSchema,
        }),
      cancel: (id: string, version: number) =>
        request('POST', `/pos/restaurant/orders/${id}/cancel`, { body: { version } }),
      quote: (
        id: string,
        body: {
          itemIds: string[];
          orderDiscount?: { type: 'percent' | 'amount'; value: string } | null;
        },
      ) =>
        request('POST', `/pos/restaurant/orders/${id}/quote`, { body, schema: orderQuoteSchema }),
      pay: (id: string, body: PayOrder) =>
        request('POST', `/pos/restaurant/orders/${id}/pay`, { body, schema: payOrderResultSchema }),
      kitchen: (stationId?: string) =>
        request('GET', `/pos/kitchen/tickets?${toParams({ stationId })}`, {
          schema: kitchenBoardSchema,
        }),
      ticketStatus: (
        id: string,
        body: { status: 'preparing' | 'ready' | 'completed'; version: number },
      ) =>
        request('POST', `/pos/kitchen/tickets/${id}/status`, { body, schema: kitchenTicketSchema }),
    },
    reports: {
      sales: (query: ReportQuery) =>
        request('GET', `/manager/reports/sales?${toParams(query)}`, { schema: salesReportSchema }),
      payments: (query: ReportQuery) =>
        request('GET', `/manager/reports/payments?${toParams(query)}`, {
          schema: paymentsReportSchema,
        }),
      shifts: (query: ReportQuery) =>
        request('GET', `/manager/reports/shifts?${toParams(query)}`, {
          schema: shiftsReportSchema,
        }),
      inventory: (query: ReportQuery) =>
        request('GET', `/manager/reports/inventory?${toParams(query)}`, {
          schema: inventoryReportSchema,
        }),
      purchasing: (query: ReportQuery) =>
        request('GET', `/manager/reports/purchasing?${toParams(query)}`, {
          schema: purchasingReportSchema,
        }),
    },
    customers: {
      list: (query: CustomerListQuery = {}) =>
        request('GET', `/manager/customers?${toParams(query)}`, { schema: customerListSchema }),
      get: (id: string) => request('GET', `/manager/customers/${id}`, { schema: customerSchema }),
      create: (body: SaveCustomer) =>
        request('POST', '/manager/customers', { body, schema: customerSchema }),
      update: (id: string, body: SaveCustomer) =>
        request('PATCH', `/manager/customers/${id}`, { body, schema: customerSchema }),
      sales: (id: string, query: { page?: number; pageSize?: number } = {}) =>
        request('GET', `/manager/customers/${id}/sales?${toParams(query)}`, {
          schema: saleListSchema,
        }),
      refunds: (id: string) =>
        request('GET', `/manager/customers/${id}/refunds`, { schema: customerRefundListSchema }),
      notes: (id: string) =>
        request('GET', `/manager/customers/${id}/notes`, { schema: customerNoteListSchema }),
      addNote: (id: string, body: string) =>
        request('POST', `/manager/customers/${id}/notes`, {
          body: { body },
          schema: customerNoteListSchema,
        }),
      posSearch: (q: string) =>
        request('GET', `/pos/customers?${toParams({ q })}`, { schema: posCustomerListSchema }),
      posCreate: (body: CreateCustomer) =>
        request('POST', '/pos/customers', { body, schema: posCustomerSchema }),
    },
    transfers: {
      list: (query: TransferListQuery = {}) =>
        request('GET', `/manager/transfers?${toParams(query)}`, { schema: transferListSchema }),
      get: (id: string) => request('GET', `/manager/transfers/${id}`, { schema: transferSchema }),
      create: (body: CreateTransfer) =>
        request('POST', '/manager/transfers', { body, schema: transferSchema }),
      action: (id: string, action: 'approve' | 'cancel', version: number) =>
        request('POST', `/manager/transfers/${id}/${action}`, {
          body: { version },
          schema: transferSchema,
        }),
      dispatch: (id: string, body: TransferQuantities) =>
        request('POST', `/manager/transfers/${id}/dispatch`, { body, schema: transferSchema }),
      receive: (id: string, body: TransferQuantities) =>
        request('POST', `/manager/transfers/${id}/receive`, { body, schema: transferSchema }),
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
