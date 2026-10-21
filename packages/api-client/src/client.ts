import { imageForm } from './image.js';
import {
  type SaveLinkItem,
  type SaveLinkPage,
  linkPageSchema,
  publicLinkPageSchema,
} from '@arabat/contracts';
import {
  type DeviceTrialStatus,
  type LeadStage,
  type SaveTrialSettings,
  type UpdateDeviceTrial,
  deviceTrialRequestListSchema,
  deviceTrialRequestSchema,
  funnelStatsSchema,
  leadListSchema,
  trialDeviceStockSchema,
  trialSettingsSchema,
} from '@arabat/contracts';
import {
  type SaveOfferItem,
  type SalesRequestStatus,
  type UpdateSalesRequest,
  offerItemListSchema,
  offerItemSchema,
  salesRequestListSchema,
  salesRequestSchema,
} from '@arabat/contracts';
import { type SaveSiteApp, siteAppListSchema, siteAppSchema } from '@arabat/contracts';
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
  type PinSignInRequest,
  pinSignInBranchSchema,
  pinLinkListSchema,
  createdPinLinkSchema,
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
  type RecallTransfer,
  type ClaimTransferLoss,
  type DecideTransferLoss,
  inTransitSummarySchema,
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
  type CartEvent,
  type Checkout,
  type RequestOverride,
  saleOverrideGrantSchema,
  type SaleListQuery,
  type SuspendOrder,
  receiptSchema,
  saleListSchema,
  saleSchema,
  saleSummarySchema,
  salesSettingsSchema,
  type AuditListQuery,
  auditListSchema,
  type AssistantChat,
  type AssistantUsageQuery,
  assistantConversationListSchema,
  assistantConversationSchema,
  assistantReplySchema,
  assistantStatusSchema,
  assistantUsageSchema,
  posShiftSchema,
  type DecideCashMovement,
  controlsChecklistSchema,
  type CashPayoutRequestQuery,
  type CashVarianceQuery,
  type DecidePayoutRequest,
  type ResolveVariance,
  cashPayoutRequestListSchema,
  cashPayoutRequestSchema,
  cashVarianceListSchema,
  cashVarianceSchema,
  suspendedOrderListSchema,
  suspendedOrderSchema,
  type CloseShift,
  type ForceCloseShift,
  type CashCount,
  type CancelCashBranchTransfer,
  type CashDisbursementQuery,
  type CreateBankDeposit,
  type CreateBankReconciliation,
  type SettleDeposit,
  bankReconciliationStateSchema,
  bankReconciliationSchema,
  depositInTransitListSchema,
  type CreateCashBranchTransfer,
  type CreateCashDisbursement,
  type ReceiveCashBranchTransfer,
  type ReverseCashDisbursement,
  bankAccountOptionsSchema,
  cashBranchTransferListSchema,
  cashBranchTransferSchema,
  cashDisbursementListSchema,
  cashDisbursementSchema,
  supplierOptionsSchema,
  supplierPaymentsSchema,
  supplierStatementSchema,
  type SupplierStatementQuery,
  type CreateCashTransfer,
  cashBranchSchema,
  cashOverviewSchema,
  cashStatementSchema,
  type CashStatementQuery,
  cashTransferListSchema,
  cashTransferSchema,
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
  createdPrintAgentSchema,
  deviceExceptionSchema,
  deviceSettingsSchema,
  posDeviceSchema,
  type UpdatePosDevice,
  printAgentSchema,
  printJobSchema,
  salePrintStatusSchema,
  printSettingsSchema,
  type PrintSettings,
  registerSchema,
  shiftListSchema,
  shiftSchema,
  type AdjustmentListQuery,
  type CreateAdjustment,
  type DamagedReturnQuery,
  type DecideAdjustment,
  type DisposeDamagedReturn,
  damagedReturnListSchema,
  damagedReturnSchema,
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
  todaySummarySchema,
  periodListSchema,
  periodPackSchema,
  type ClosePeriod,
  type ReportExport,
  shiftsReportSchema,
  expensesReportSchema,
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
  type OnlineOrderActionInput,
  type SaveListing,
  type SaveListings,
  type SaveOnlineCollection,
  type SaveStoreCategory,
  type SaveOnlineStore,
  type StoreCheckout,
  listingListSchema,
  mockPaymentSchema,
  onlineCollectionListSchema,
  onlineCollectionSchema,
  storeCategoryListSchema,
  storeCategorySchema,
  onlineOrderListSchema,
  onlineOrderSchema,
  onlineStoreSchema,
  onlineTenderListSchema,
  publicOrderSchema,
  slugAvailabilitySchema,
  storeCheckoutResultSchema,
  storeProductListSchema,
  storeProductSchema,
  storefrontSchema,
  storeSlotListSchema,
  onlineDeliveryAreaSchema,
  onlineDeliveryAreaListSchema,
  type SaveOnlineDeliveryArea,
  onlineStoreBranchSchema,
  onlineStoreBranchListSchema,
  type SaveOnlineStoreBranch,
  posOnlineOrderSchema,
  posOnlineOrderListSchema,
  type PosOnlineOrderPay,
  type StoreQuote,
  storeQuoteResultSchema,
  type AccountRegister,
  type AccountLogin,
  type AccountUpdate,
  type AccountPassword,
  type AccountReset,
  type SaveCustomerAddress,
  accountSessionSchema,
  accountViewSchema,
  accountOrderListSchema,
  onlinePromotionSchema,
  onlinePromotionListSchema,
  type SaveOnlinePromotion,
  type StoreDesignInput,
  storeDesignStateSchema,
  storeAssetSchema,
  storeAssetListSchema,
  publicStoreDesignSchema,
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
  type StartOwnershipTransfer,
  type AcceptOwnershipTransfer,
  type BranchStatus,
  type ChangePassword,
  sessionListSchema,
  type OwnerFreeze,
  type PlatformOwnershipTransfer,
  priceHistorySchema,
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

  /** Multipart upload of one `file` field; the reply is parsed with the given schema. */
  async function uploadImage<T extends z.ZodType>(
    path: string,
    file: Blob,
    schema: T,
  ): Promise<z.output<T>> {
    const form = await imageForm(file);
    const response = await doFetch(`${baseUrl}${path}`, {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
    }).catch((error: unknown) => {
      throw new NetworkError(error);
    });
    if (!response.ok) throw await toApiError(response);
    return schema.parse(await response.json()) as z.output<T>;
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
      /** The page behind the e-mailed PIN link (ADR-0112): sets the cashier's own device PIN. */
      completePinReset: (body: { token: string; pin: string }) =>
        request('POST', '/device/pin-reset/complete', { body }),
      /** Browser POS sign-in with name + PIN behind a branch link (Plan A). */
      pinSignInBranch: (key: string) =>
        request('POST', '/auth/pos/pin-sign-in/branch', {
          body: { key },
          schema: pinSignInBranchSchema,
        }),
      pinSignIn: (body: PinSignInRequest): Promise<LoginResult> =>
        request('POST', '/auth/pos/pin-sign-in', { body, schema: loginResultSchema }),
      logout: (appInterface: AppInterface) =>
        request('POST', `/auth/${appInterface}/logout`, { body: {} }),
      /** Account hygiene (BR-193): own password and sessions. */
      changePassword: (body: ChangePassword) => request('POST', '/auth/manager/password', { body }),
      sessions: () => request('GET', '/auth/manager/sessions', { schema: sessionListSchema }),
      revokeSession: (id: string) => request('DELETE', `/auth/manager/sessions/${id}`),
      revokeOtherSessions: () =>
        request('POST', '/auth/manager/sessions/revoke-others', {
          body: {},
          schema: z.object({ ended: z.number().int() }),
        }),
      /** POS screen lock (server-enforced until the password is entered again). */
      posLock: () => request('POST', '/auth/pos/lock', { body: {} }),
      posUnlock: (password: string) => request('POST', '/auth/pos/unlock', { body: { password } }),
      posLockedSignOut: () => request('POST', '/auth/pos/lock/sign-out', { body: {} }),
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
      freezeOwner: (id: string, body: OwnerFreeze) =>
        request('POST', `/platform/merchants/${id}/owner-freeze`, {
          body,
          schema: platformMerchantDetailSchema,
        }),
      releaseOwner: (id: string, body: OwnerFreeze) =>
        request('POST', `/platform/merchants/${id}/owner-release`, {
          body,
          schema: platformMerchantDetailSchema,
        }),
      transferOwnership: (id: string, body: PlatformOwnershipTransfer) =>
        request('POST', `/platform/merchants/${id}/ownership-transfer`, {
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
      /** Public pricing page offer and purchase requests (ADR-0114). */
      offerItems: () => request('GET', '/platform/offer-items', { schema: offerItemListSchema }),
      saveOfferItem: (id: string | null, body: SaveOfferItem) =>
        request(id ? 'PUT' : 'POST', id ? `/platform/offer-items/${id}` : '/platform/offer-items', {
          body,
          schema: offerItemSchema,
        }),
      async uploadOfferImage(id: string, file: Blob) {
        const form = await imageForm(file);
        const response = await doFetch(`${baseUrl}/platform/offer-items/${id}/image`, {
          method: 'POST',
          body: form,
          credentials: 'same-origin',
        }).catch((error: unknown) => {
          throw new NetworkError(error);
        });
        if (!response.ok) throw await toApiError(response);
        return offerItemSchema.parse(await response.json());
      },
      removeOfferImage: (id: string) =>
        request('DELETE', `/platform/offer-items/${id}/image`, { schema: offerItemSchema }),
      /** The public site's "Our apps" menu (ADR-0117). */
      siteApps: () => request('GET', '/platform/site-apps', { schema: siteAppListSchema }),
      saveSiteApp: (id: string | null, body: SaveSiteApp) =>
        request(id ? 'PUT' : 'POST', id ? `/platform/site-apps/${id}` : '/platform/site-apps', {
          body,
          schema: siteAppSchema,
        }),
      deleteSiteApp: (id: string) => request('DELETE', `/platform/site-apps/${id}`),
      /** Free trials, leads and the funnel (ADR-0115). */
      trialSettings: () =>
        request('GET', '/platform/trials/settings', { schema: trialSettingsSchema }),
      saveTrialSettings: (body: SaveTrialSettings) =>
        request('PUT', '/platform/trials/settings', { body, schema: trialSettingsSchema }),
      trialStock: () =>
        request('GET', '/platform/trials/stock', {
          schema: z.object({ devices: z.array(trialDeviceStockSchema) }),
        }),
      saveTrialStock: (itemId: string, body: { trialStock: number; version: number }) =>
        request('PUT', `/platform/trials/stock/${itemId}`, {
          body,
          schema: z.object({ devices: z.array(trialDeviceStockSchema) }),
        }),
      leads: (stage?: LeadStage) =>
        request('GET', `/platform/trials/leads${stage ? `?stage=${stage}` : ''}`, {
          schema: leadListSchema,
        }),
      deviceTrials: (status?: DeviceTrialStatus) =>
        request('GET', `/platform/trials/devices${status ? `?status=${status}` : ''}`, {
          schema: deviceTrialRequestListSchema,
        }),
      updateDeviceTrial: (id: string, body: UpdateDeviceTrial) =>
        request('PUT', `/platform/trials/devices/${id}`, {
          body,
          schema: deviceTrialRequestSchema,
        }),
      funnel: (days: number) =>
        request('GET', `/platform/trials/funnel?days=${days}`, { schema: funnelStatsSchema }),
      salesRequests: (status?: SalesRequestStatus) =>
        request('GET', `/platform/sales-requests${status ? `?status=${status}` : ''}`, {
          schema: salesRequestListSchema,
        }),
      salesRequest: (id: string) =>
        request('GET', `/platform/sales-requests/${id}`, { schema: salesRequestSchema }),
      updateSalesRequest: (id: string, body: UpdateSalesRequest) =>
        request('PUT', `/platform/sales-requests/${id}`, { body, schema: salesRequestSchema }),
      audit: (query: PlatformAuditQuery = {}) =>
        request('GET', `/platform/audit?${toParams(query)}`, { schema: platformAuditListSchema }),
      assistantUsage: (query: AssistantUsageQuery = {}) =>
        request('GET', `/platform/assistant?${toParams(query)}`, { schema: assistantUsageSchema }),
      /** JSONL of the matching conversations (training export); the browser saves the text. */
      assistantExportUrl: (query: AssistantUsageQuery = {}) =>
        `${baseUrl}/platform/assistant/export?${toParams(query)}`,
    },
    managerAssistant: {
      status: () => request('GET', '/manager/assistant', { schema: assistantStatusSchema }),
      chat: (body: AssistantChat) =>
        request('POST', '/manager/assistant/chat', { body, schema: assistantReplySchema }),
      conversations: () =>
        request('GET', '/manager/assistant/conversations', {
          schema: assistantConversationListSchema,
        }),
      conversation: (id: string) =>
        request('GET', `/manager/assistant/conversations/${id}`, {
          schema: assistantConversationSchema,
        }),
    },
    merchant: {
      get: () => request('GET', '/manager/merchant', { schema: merchantProfileSchema }),
      controls: () =>
        request('GET', '/manager/merchant/controls', { schema: controlsChecklistSchema }),
      update: (body: UpdateMerchantProfile) =>
        request('PATCH', '/manager/merchant', { body, schema: merchantProfileSchema }),
      /** Ownership transfer (BR-020): the owner starts or cancels, the named member accepts. */
      startOwnershipTransfer: (body: StartOwnershipTransfer) =>
        request('POST', '/manager/merchant/ownership-transfers', {
          body,
          schema: merchantProfileSchema,
        }),
      cancelOwnershipTransfer: () =>
        request('DELETE', '/manager/merchant/ownership-transfers', {
          schema: merchantProfileSchema,
        }),
      acceptOwnershipTransfer: (body: AcceptOwnershipTransfer) =>
        request('POST', '/manager/merchant/ownership-transfers/accept', { body }),
    },
    branches: {
      list: () => request('GET', '/manager/branches', { schema: branchDetailListSchema }),
      get: (id: string) =>
        request('GET', `/manager/branches/${id}`, { schema: branchDetailSchema }),
      create: (body: CreateBranch) =>
        request('POST', '/manager/branches', { body, schema: branchDetailSchema }),
      update: (id: string, body: UpdateBranch) =>
        request('PATCH', `/manager/branches/${id}`, { body, schema: branchDetailSchema }),
      setStatus: (id: string, body: BranchStatus) =>
        request('POST', `/manager/branches/${id}/status`, { body, schema: branchDetailSchema }),
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
      priceHistory: (id: string) =>
        request('GET', `/manager/products/${id}/price-history`, { schema: priceHistorySchema }),
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
        const form = await imageForm(file);
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
      decideAdjustment: (id: string, body: DecideAdjustment) =>
        request('POST', `/manager/inventory/adjustments/${id}/decision`, {
          body,
          schema: adjustmentSchema,
        }),
      withdrawAdjustment: (id: string) =>
        request('POST', `/manager/inventory/adjustments/${id}/withdraw`, {
          body: {},
          schema: adjustmentSchema,
        }),
      damagedReturns: (query: DamagedReturnQuery = {}) =>
        request('GET', `/manager/inventory/damaged-returns?${toParams(query)}`, {
          schema: damagedReturnListSchema,
        }),
      disposeDamagedReturn: (id: string, body: DisposeDamagedReturn) =>
        request('POST', `/manager/inventory/damaged-returns/${id}/dispose`, {
          body,
          schema: damagedReturnSchema,
        }),
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
    cash: {
      overview: (branchId?: string | null) =>
        request('GET', `/manager/cash/overview?${toParams({ branchId })}`, {
          schema: cashOverviewSchema,
        }),
      statement: (accountId: string, query: CashStatementQuery = {}) =>
        request('GET', `/manager/cash/accounts/${accountId}/entries?${toParams(query)}`, {
          schema: cashStatementSchema,
        }),
      count: (accountId: string, body: CashCount) =>
        request('POST', `/manager/cash/accounts/${accountId}/counts`, {
          body,
          schema: cashBranchSchema,
        }),
      transfers: (query: { branchId?: string | null; page?: number; pageSize?: number } = {}) =>
        request('GET', `/manager/cash/transfers?${toParams(query)}`, {
          schema: cashTransferListSchema,
        }),
      transfer: (body: CreateCashTransfer) =>
        request('POST', '/manager/cash/transfers', { body, schema: cashTransferSchema }),
      disbursements: (query: CashDisbursementQuery = {}) =>
        request('GET', `/manager/cash/disbursements?${toParams(query)}`, {
          schema: cashDisbursementListSchema,
        }),
      disburse: (body: CreateCashDisbursement) =>
        request('POST', '/manager/cash/disbursements', { body, schema: cashDisbursementSchema }),
      reverse: (id: string, body: ReverseCashDisbursement) =>
        request('POST', `/manager/cash/disbursements/${id}/reverse`, {
          body,
          schema: cashDisbursementSchema,
        }),
      suppliers: () => request('GET', '/manager/cash/suppliers', { schema: supplierOptionsSchema }),
      payableOrders: (supplierId: string) =>
        request('GET', `/manager/cash/suppliers/${supplierId}/orders`, {
          schema: z.object({ orders: z.array(z.object({ id: z.string(), number: z.string() })) }),
        }),
      bankAccounts: () =>
        request('GET', '/manager/cash/bank-accounts', { schema: bankAccountOptionsSchema }),
      deposit: (body: CreateBankDeposit) =>
        request('POST', '/manager/cash/deposits', { body, schema: cashTransferSchema }),
      branchTransfers: (
        query: { status?: string; branchId?: string | null; page?: number; pageSize?: number } = {},
      ) =>
        request('GET', `/manager/cash/branch-transfers?${toParams(query)}`, {
          schema: cashBranchTransferListSchema,
        }),
      sendToBranch: (body: CreateCashBranchTransfer) =>
        request('POST', '/manager/cash/branch-transfers', {
          body,
          schema: cashBranchTransferSchema,
        }),
      receiveFromBranch: (id: string, body: ReceiveCashBranchTransfer) =>
        request('POST', `/manager/cash/branch-transfers/${id}/receive`, {
          body,
          schema: cashBranchTransferSchema,
        }),
      cancelBranchTransfer: (id: string, body: CancelCashBranchTransfer) =>
        request('POST', `/manager/cash/branch-transfers/${id}/cancel`, {
          body,
          schema: cashBranchTransferSchema,
        }),
      supplierPayments: (supplierId: string) =>
        request('GET', `/manager/suppliers/${supplierId}/payments`, {
          schema: supplierPaymentsSchema,
        }),
      supplierStatement: (supplierId: string, query: SupplierStatementQuery = {}) =>
        request('GET', `/manager/suppliers/${supplierId}/statement?${toParams(query)}`, {
          schema: supplierStatementSchema,
        }),
      payoutRequests: (query: CashPayoutRequestQuery = {}) =>
        request('GET', `/manager/cash/payout-requests?${toParams(query)}`, {
          schema: cashPayoutRequestListSchema,
        }),
      requestPayout: (body: CreateCashDisbursement) =>
        request('POST', '/manager/cash/payout-requests', {
          body,
          schema: cashPayoutRequestSchema,
        }),
      decidePayoutRequest: (id: string, body: DecidePayoutRequest) =>
        request('POST', `/manager/cash/payout-requests/${id}/decision`, {
          body,
          schema: cashPayoutRequestSchema,
        }),
      withdrawPayoutRequest: (id: string) =>
        request('POST', `/manager/cash/payout-requests/${id}/withdraw`, {
          body: {},
          schema: cashPayoutRequestSchema,
        }),
      variances: (query: CashVarianceQuery = {}) =>
        request('GET', `/manager/cash/variances?${toParams(query)}`, {
          schema: cashVarianceListSchema,
        }),
      resolveVariance: (sourceType: string, sourceId: string, body: ResolveVariance) =>
        request('POST', `/manager/cash/variances/${sourceType}/${sourceId}/followup`, {
          body,
          schema: cashVarianceSchema,
        }),
      depositsInTransit: (branchId?: string | null) =>
        request('GET', `/manager/cash/deposits/pending?${toParams({ branchId })}`, {
          schema: depositInTransitListSchema,
        }),
      settleDeposit: (id: string, body: SettleDeposit) =>
        request('POST', `/manager/cash/deposits/${id}/settle`, {
          body,
          schema: cashTransferSchema,
        }),
      bankReconciliation: (accountId: string) =>
        request('GET', `/manager/cash/bank-accounts/${accountId}/reconciliation`, {
          schema: bankReconciliationStateSchema,
        }),
      reconcileBank: (accountId: string, body: CreateBankReconciliation) =>
        request('POST', `/manager/cash/bank-accounts/${accountId}/reconciliations`, {
          body,
          schema: bankReconciliationSchema,
        }),
      posBankAccounts: () =>
        request('GET', '/pos/cash/bank-accounts', { schema: bankAccountOptionsSchema }),
      posSuppliers: () => request('GET', '/pos/cash/suppliers', { schema: supplierOptionsSchema }),
    },
    audit: {
      list: (query: AuditListQuery = {}) =>
        request('GET', `/manager/audit?${toParams(query)}`, { schema: auditListSchema }),
    },
    /** Local-first devices (ADR-0112). */
    devices: {
      list: () =>
        request('GET', '/manager/devices', {
          schema: z.object({ devices: z.array(posDeviceSchema) }),
        }),
      revoke: (id: string) => request('POST', `/manager/devices/${id}/revoke`, { body: {} }),
      /** The browser POS's PIN sign-in link per branch (Plan A); the key is shown once. */
      pinLinks: () => request('GET', '/manager/pin-links', { schema: pinLinkListSchema }),
      createPinLink: (branchId: string) =>
        request('POST', `/manager/pin-links/${branchId}`, {
          body: {},
          schema: createdPinLinkSchema,
        }),
      removePinLink: (branchId: string) => request('DELETE', `/manager/pin-links/${branchId}`),
      /** Managers: the bound register (`registerId`, null unbinds); owner: the branch. */
      update: (id: string, body: UpdatePosDevice) =>
        request('PUT', `/manager/devices/${id}`, { body, schema: posDeviceSchema }),
      settings: () => request('GET', '/manager/device-settings', { schema: deviceSettingsSchema }),
      updateSettings: (body: { offlineLimitHours: number }) =>
        request('PUT', '/manager/device-settings', { body, schema: deviceSettingsSchema }),
      exceptions: (status: 'open' | 'resolved') =>
        request('GET', `/manager/device-exceptions?${toParams({ status })}`, {
          schema: z.object({ exceptions: z.array(deviceExceptionSchema) }),
        }),
      resolveException: (id: string, note: string) =>
        request('POST', `/manager/device-exceptions/${id}/resolve`, { body: { note } }),
    },
    /** Server-side receipt printing (ADR-0111). */
    printing: {
      agents: () =>
        request('GET', '/manager/print-agents', {
          schema: z.object({ agents: z.array(printAgentSchema) }),
        }),
      createAgent: (body: { name: string; branchId: string | null }) =>
        request('POST', '/manager/print-agents', { body, schema: createdPrintAgentSchema }),
      deleteAgent: (id: string) => request('DELETE', `/manager/print-agents/${id}`),
      settings: () => request('GET', '/manager/print-settings', { schema: printSettingsSchema }),
      updateSettings: (body: PrintSettings) =>
        request('PUT', '/manager/print-settings', { body, schema: printSettingsSchema }),
      printSale: (saleId: string) =>
        request('POST', `/manager/sales/${saleId}/print`, { schema: printJobSchema }),
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
      /** Binds the drawer to one device (its primary), or frees it with null (ADR-0112 amendment 4). */
      bindDevice: (id: string, deviceId: string | null) =>
        request('PUT', `/manager/registers/${id}/device`, { body: { deviceId } }),
    },
    shifts: {
      list: (query: ShiftListQuery = {}) =>
        request('GET', `/manager/shifts?${toParams(query)}`, { schema: shiftListSchema }),
      get: (id: string) => request('GET', `/manager/shifts/${id}`, { schema: shiftSchema }),
      discrepancies: (query: DiscrepancyReportQuery = {}) =>
        request('GET', `/manager/shifts/discrepancies?${toParams(query)}`, {
          schema: discrepancyReportSchema,
        }),
      forceClose: (id: string, body: ForceCloseShift) =>
        request('POST', `/manager/shifts/${id}/force-close`, { body, schema: shiftSchema }),
      decideMovement: (id: string, movementId: string, body: DecideCashMovement) =>
        request('POST', `/manager/shifts/${id}/movements/${movementId}/decision`, {
          body,
          schema: shiftSchema,
        }),
      withdrawMovement: (movementId: string) =>
        request('POST', `/pos/shifts/current/cash-movements/${movementId}/withdraw`, {
          body: {},
          schema: posShiftSchema,
        }),
      posRegisters: () => request('GET', '/pos/registers', { schema: posRegisterListSchema }),
      current: () => request('GET', '/pos/shifts/current', { schema: currentShiftSchema }),
      open: (body: OpenShift) => request('POST', '/pos/shifts', { body, schema: posShiftSchema }),
      cashMovement: (body: RecordCashMovement) =>
        request('POST', '/pos/shifts/current/cash-movements', { body, schema: posShiftSchema }),
      close: (body: CloseShift) =>
        request('POST', '/pos/shifts/current/close', { body, schema: shiftSchema }),
    },
    assistant: {
      status: () => request('GET', '/pos/assistant', { schema: assistantStatusSchema }),
      chat: (body: AssistantChat) =>
        request('POST', '/pos/assistant/chat', { body, schema: assistantReplySchema }),
      conversations: () =>
        request('GET', '/pos/assistant/conversations', { schema: assistantConversationListSchema }),
      conversation: (id: string) =>
        request('GET', `/pos/assistant/conversations/${id}`, {
          schema: assistantConversationSchema,
        }),
    },
    sales: {
      settings: () => request('GET', '/pos/sales/settings', { schema: salesSettingsSchema }),
      checkout: (body: Checkout) => request('POST', '/pos/sales', { body, schema: saleSchema }),
      requestOverride: (body: RequestOverride) =>
        request('POST', '/pos/overrides', { body, schema: saleOverrideGrantSchema }),
      lookup: (receipt: string) =>
        request('GET', `/pos/sales/lookup?${toParams({ receipt })}`, { schema: saleSchema }),
      /** A numbered receipt copy, printed by the branch's print agent (ADR-0111). */
      print: (id: string) =>
        request('POST', `/pos/sales/${id}/print`, { body: {}, schema: printJobSchema }),
      /** The sale's latest print job, followed until it settles (Plan A). */
      printStatus: (id: string) =>
        request('GET', `/pos/sales/${id}/print-status`, { schema: salePrintStatusSchema }),
      cartEvent: (body: CartEvent) => request('POST', '/pos/cart-events', { body }),
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
        blindCashCount: boolean;
        cashOutOtherLimit: string;
        cashOutOtherShiftLimit: string;
        maxRegisterTolerance: string;
        expenseApprovalLimit: string;
        supplierPaymentApprovalLimit: string;
        adjustmentApprovalLimit?: string;
        blindStockCount?: boolean;
        priceOverrideFloorPercent?: string | null;
        priceOverrideCeilingPercent?: string | null;
        priceOverrideBelowCost?: boolean;
        refundOwnSalesNeedApproval?: boolean;
        requireTenderReference?: boolean;
        heldSaleExpiryHours?: number;
        cartClearLogThreshold?: string;
        unusualRefundRatePercent?: string;
        unusualActivityDays?: number;
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
      /** Can the merchant take this store address? With free alternatives when not. */
      slugAvailability: (slug: string) =>
        request('GET', `/manager/online/store/slug-availability?slug=${encodeURIComponent(slug)}`, {
          schema: slugAvailabilitySchema,
        }),
      /** Tenders staff may record for a pay-on-receipt order. */
      tenders: () => request('GET', '/manager/online/tenders', { schema: onlineTenderListSchema }),
      listings: () => request('GET', '/manager/online/listings', { schema: listingListSchema }),
      /** Bulk actions: show on / hide from the website, category, add to a collection. */
      setListings: (body: SaveListings) =>
        request('PUT', '/manager/online/listings', { body, schema: listingListSchema }),
      /** The store's own text and options for one product (ADR-0121, ADR-0130). */
      saveListing: (productId: string, body: SaveListing) =>
        request('PUT', `/manager/online/listings/${productId}`, {
          body,
          schema: listingListSchema,
        }),
      /** Every active product exactly once, in display order. */
      orderListings: (productIds: string[]) =>
        request('PUT', '/manager/online/listings/order', {
          body: { productIds },
          schema: listingListSchema,
        }),
      /** The shared catalog categories with the store's settings (ADR-0130). */
      categories: () =>
        request('GET', '/manager/online/categories', { schema: storeCategoryListSchema }),
      createCategory: (body: SaveStoreCategory) =>
        request('POST', '/manager/online/categories', { body, schema: storeCategorySchema }),
      updateCategory: (id: string, body: SaveStoreCategory) =>
        request('PUT', `/manager/online/categories/${id}`, { body, schema: storeCategorySchema }),
      orderCategories: (ids: string[]) =>
        request('PUT', '/manager/online/categories/order', {
          body: { ids },
          schema: storeCategoryListSchema,
        }),
      async uploadCategoryImage(id: string, file: Blob) {
        return uploadImage(`/manager/online/categories/${id}/image`, file, storeCategorySchema);
      },
      removeCategoryImage: (id: string) =>
        request('DELETE', `/manager/online/categories/${id}/image`, {
          schema: storeCategorySchema,
        }),
      /** Marketing collections (ADR-0130). */
      collections: () =>
        request('GET', '/manager/online/collections', { schema: onlineCollectionListSchema }),
      createCollection: (body: SaveOnlineCollection) =>
        request('POST', '/manager/online/collections', { body, schema: onlineCollectionSchema }),
      updateCollection: (id: string, body: SaveOnlineCollection) =>
        request('PUT', `/manager/online/collections/${id}`, {
          body,
          schema: onlineCollectionSchema,
        }),
      deleteCollection: (id: string) =>
        request('DELETE', `/manager/online/collections/${id}`, {
          schema: onlineCollectionListSchema,
        }),
      orderCollections: (ids: string[]) =>
        request('PUT', '/manager/online/collections/order', {
          body: { ids },
          schema: onlineCollectionListSchema,
        }),
      async uploadCollectionImage(id: string, file: Blob) {
        return uploadImage(`/manager/online/collections/${id}/image`, file, onlineCollectionSchema);
      },
      removeCollectionImage: (id: string) =>
        request('DELETE', `/manager/online/collections/${id}/image`, {
          schema: onlineCollectionSchema,
        }),
      /** Store logo or banner (ADR-0121). */
      async uploadStoreImage(kind: 'logo' | 'banner', file: Blob) {
        return uploadImage(`/manager/online/store/${kind}`, file, onlineStoreSchema);
      },
      removeStoreImage: (kind: 'logo' | 'banner') =>
        request('DELETE', `/manager/online/store/${kind}`, { schema: onlineStoreSchema }),
      orders: (query: OnlineOrderListQuery = {}) =>
        request('GET', `/manager/online/orders?${toParams(query)}`, {
          schema: onlineOrderListSchema,
        }),
      order: (id: string) =>
        request('GET', `/manager/online/orders/${id}`, { schema: onlineOrderSchema }),
      act: (id: string, body: OnlineOrderActionInput) =>
        request('POST', `/manager/online/orders/${id}/action`, { body, schema: onlineOrderSchema }),
      /** Re-checks unpaid orders with their gateway and expires overdue ones. */
      reconcile: () =>
        request('POST', '/manager/online/reconcile', {
          schema: z.object({ checked: z.number(), paid: z.number(), expired: z.number() }),
        }),
      // Delivery areas and serving branches (ADR-0123).
      deliveryAreas: () =>
        request('GET', '/manager/online/delivery-areas', { schema: onlineDeliveryAreaListSchema }),
      createDeliveryArea: (body: SaveOnlineDeliveryArea) =>
        request('POST', '/manager/online/delivery-areas', {
          body,
          schema: onlineDeliveryAreaSchema,
        }),
      updateDeliveryArea: (id: string, body: SaveOnlineDeliveryArea) =>
        request('PUT', `/manager/online/delivery-areas/${id}`, {
          body,
          schema: onlineDeliveryAreaSchema,
        }),
      deleteDeliveryArea: (id: string) =>
        request('DELETE', `/manager/online/delivery-areas/${id}`, {
          schema: onlineDeliveryAreaListSchema,
        }),
      orderDeliveryAreas: (ids: string[]) =>
        request('PUT', '/manager/online/delivery-areas/order', {
          body: { ids },
          schema: onlineDeliveryAreaListSchema,
        }),
      storeBranches: () =>
        request('GET', '/manager/online/branches', { schema: onlineStoreBranchListSchema }),
      saveStoreBranch: (branchId: string, body: SaveOnlineStoreBranch) =>
        request('PUT', `/manager/online/branches/${branchId}`, {
          body,
          schema: onlineStoreBranchSchema,
        }),
      removeStoreBranch: (branchId: string) =>
        request('DELETE', `/manager/online/branches/${branchId}`, {
          schema: onlineStoreBranchListSchema,
        }),
      orderStoreBranches: (branchIds: string[]) =>
        request('PUT', '/manager/online/branches/order', {
          body: { branchIds },
          schema: onlineStoreBranchListSchema,
        }),
      // Promotions (ADR-0125).
      promotions: () =>
        request('GET', '/manager/online/promotions', { schema: onlinePromotionListSchema }),
      createPromotion: (body: SaveOnlinePromotion) =>
        request('POST', '/manager/online/promotions', { body, schema: onlinePromotionSchema }),
      updatePromotion: (id: string, body: SaveOnlinePromotion) =>
        request('PUT', `/manager/online/promotions/${id}`, { body, schema: onlinePromotionSchema }),
      deletePromotion: (id: string) =>
        request('DELETE', `/manager/online/promotions/${id}`, {
          schema: onlinePromotionListSchema,
        }),
      orderPromotions: (ids: string[]) =>
        request('PUT', '/manager/online/promotions/order', {
          body: { ids },
          schema: onlinePromotionListSchema,
        }),
      /** Store design (ADR-0128): draft, publish, discard and the design pictures. */
      design: () => request('GET', '/manager/online/design', { schema: storeDesignStateSchema }),
      saveDesign: (body: { design: StoreDesignInput; version: number }) =>
        request('PUT', '/manager/online/design', { body, schema: storeDesignStateSchema }),
      publishDesign: (version: number) =>
        request('POST', '/manager/online/design/publish', {
          body: { version },
          schema: storeDesignStateSchema,
        }),
      discardDesign: (version: number) =>
        request('POST', '/manager/online/design/discard', {
          body: { version },
          schema: storeDesignStateSchema,
        }),
      designAssets: () =>
        request('GET', '/manager/online/design/assets', { schema: storeAssetListSchema }),
      async uploadDesignAsset(file: Blob) {
        return uploadImage('/manager/online/design/assets', file, storeAssetSchema);
      },
      removeDesignAsset: (id: string) =>
        request('DELETE', `/manager/online/design/assets/${id}`, { schema: storeAssetListSchema }),
      /** The own store as shoppers would see it, also while it is a draft (preview). */
      previewStorefront: () =>
        request('GET', '/manager/online/preview/storefront', { schema: storefrontSchema }),
      previewProducts: (branchId?: string | null) =>
        request('GET', `/manager/online/preview/products${branchId ? `?branch=${branchId}` : ''}`, {
          schema: storeProductListSchema,
        }),
      previewProduct: (productId: string, branchId?: string | null) =>
        request(
          'GET',
          `/manager/online/preview/products/${productId}${branchId ? `?branch=${branchId}` : ''}`,
          { schema: storeProductSchema },
        ),
    },
    /** Online orders handed over at the till (ADR-0123). */
    posOnline: {
      orders: () => request('GET', '/pos/online-orders', { schema: posOnlineOrderListSchema }),
      pay: (id: string, body: PosOnlineOrderPay) =>
        request('POST', `/pos/online-orders/${id}/pay`, { body, schema: saleSchema }),
      complete: (id: string, version: number) =>
        request('POST', `/pos/online-orders/${id}/complete`, {
          body: { version },
          schema: posOnlineOrderSchema,
        }),
    },
    /** Link page ("link in bio", ADR-0116). */
    linkPage: {
      get: () => request('GET', '/manager/link-page', { schema: linkPageSchema }),
      save: (body: SaveLinkPage) =>
        request('PUT', '/manager/link-page', { body, schema: linkPageSchema }),
      saveItem: (id: string | null, body: SaveLinkItem) =>
        request(
          id ? 'PUT' : 'POST',
          id ? `/manager/link-page/items/${id}` : '/manager/link-page/items',
          {
            body,
            schema: linkPageSchema,
          },
        ),
      deleteItem: (id: string) =>
        request('DELETE', `/manager/link-page/items/${id}`, { schema: linkPageSchema }),
      reorder: (ids: string[]) =>
        request('PUT', '/manager/link-page/items/order', { body: { ids }, schema: linkPageSchema }),
      async uploadAvatar(file: Blob) {
        const form = await imageForm(file);
        const response = await doFetch(`${baseUrl}/manager/link-page/avatar`, {
          method: 'POST',
          body: form,
          credentials: 'same-origin',
        }).catch((error: unknown) => {
          throw new NetworkError(error);
        });
        if (!response.ok) throw await toApiError(response);
        return linkPageSchema.parse(await response.json());
      },
      removeAvatar: () =>
        request('DELETE', '/manager/link-page/avatar', { schema: linkPageSchema }),
      /** Public page (no session). */
      public: (slug: string) =>
        request('GET', `/public/links/${encodeURIComponent(slug)}`, {
          schema: publicLinkPageSchema,
        }),
      /** Address that counts one open of a link (sent with navigator.sendBeacon). */
      clickUrl: (slug: string, itemId: string) =>
        `${baseUrl}/public/links/${encodeURIComponent(slug)}/items/${itemId}/click`,
    },
    /** Public storefront (no session). */
    store: {
      info: (slug: string) =>
        request('GET', `/store/${encodeURIComponent(slug)}`, { schema: storefrontSchema }),
      products: (slug: string, branchId?: string | null) =>
        request(
          'GET',
          `/store/${encodeURIComponent(slug)}/products${branchId ? `?branch=${branchId}` : ''}`,
          { schema: storeProductListSchema },
        ),
      /** Time slots a shopper may pick for the next days (ADR-0123). */
      slots: (
        slug: string,
        query: { branch?: string | null; fulfillment: 'pickup' | 'delivery' },
      ) =>
        request(
          'GET',
          `/store/${encodeURIComponent(slug)}/slots?${toParams({
            fulfillment: query.fulfillment,
            ...(query.branch ? { branch: query.branch } : {}),
          })}`,
          { schema: storeSlotListSchema },
        ),
      product: (slug: string, productId: string) =>
        request('GET', `/store/${encodeURIComponent(slug)}/products/${productId}`, {
          schema: storeProductSchema,
        }),
      /** The published design, or the legacy layout (ADR-0128). */
      design: (slug: string) =>
        request('GET', `/store/${encodeURIComponent(slug)}/design`, {
          schema: publicStoreDesignSchema,
        }),
      checkout: (slug: string, body: StoreCheckout, token?: string | null) =>
        request('POST', `/store/${encodeURIComponent(slug)}/checkout`, {
          body,
          schema: storeCheckoutResultSchema,
          ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
        }),
      order: (slug: string, token: string) =>
        request('GET', `/store/${encodeURIComponent(slug)}/orders/${token}`, {
          schema: publicOrderSchema,
        }),
      /** Totals with the promotion that applies (ADR-0125), before placing the order. */
      quote: (slug: string, body: StoreQuote, token?: string | null) =>
        request('POST', `/store/${encodeURIComponent(slug)}/quote`, {
          body,
          schema: storeQuoteResultSchema,
          ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
        }),
      /** Shopper accounts (ADR-0124): a bearer token kept by the storefront. */
      account: {
        register: (slug: string, body: AccountRegister) =>
          request('POST', `/store/${encodeURIComponent(slug)}/account/register`, {
            body,
            schema: accountSessionSchema,
          }),
        login: (slug: string, body: AccountLogin) =>
          request('POST', `/store/${encodeURIComponent(slug)}/account/login`, {
            body,
            schema: accountSessionSchema,
          }),
        logout: (slug: string, token: string) =>
          request('POST', `/store/${encodeURIComponent(slug)}/account/logout`, {
            headers: { authorization: `Bearer ${token}` },
          }),
        me: (slug: string, token: string) =>
          request('GET', `/store/${encodeURIComponent(slug)}/account`, {
            schema: accountViewSchema,
            headers: { authorization: `Bearer ${token}` },
          }),
        update: (slug: string, token: string, body: AccountUpdate) =>
          request('PUT', `/store/${encodeURIComponent(slug)}/account`, {
            body,
            schema: accountViewSchema,
            headers: { authorization: `Bearer ${token}` },
          }),
        changePassword: (slug: string, token: string, body: AccountPassword) =>
          request('PUT', `/store/${encodeURIComponent(slug)}/account/password`, {
            body,
            headers: { authorization: `Bearer ${token}` },
          }),
        forgot: (slug: string, email: string) =>
          request('POST', `/store/${encodeURIComponent(slug)}/account/forgot`, {
            body: { email },
          }),
        reset: (slug: string, body: AccountReset) =>
          request('POST', `/store/${encodeURIComponent(slug)}/account/reset`, { body }),
        orders: (slug: string, token: string) =>
          request('GET', `/store/${encodeURIComponent(slug)}/account/orders`, {
            schema: accountOrderListSchema,
            headers: { authorization: `Bearer ${token}` },
          }),
        addAddress: (slug: string, token: string, body: SaveCustomerAddress) =>
          request('POST', `/store/${encodeURIComponent(slug)}/account/addresses`, {
            body,
            schema: accountViewSchema,
            headers: { authorization: `Bearer ${token}` },
          }),
        updateAddress: (slug: string, token: string, id: string, body: SaveCustomerAddress) =>
          request('PUT', `/store/${encodeURIComponent(slug)}/account/addresses/${id}`, {
            body,
            schema: accountViewSchema,
            headers: { authorization: `Bearer ${token}` },
          }),
        deleteAddress: (slug: string, token: string, id: string) =>
          request('DELETE', `/store/${encodeURIComponent(slug)}/account/addresses/${id}`, {
            schema: accountViewSchema,
            headers: { authorization: `Bearer ${token}` },
          }),
      },
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
      today: () => request('GET', '/manager/reports/today', { schema: todaySummarySchema }),
      /** A CSV built in the browser: recorded in the audit log (BR-187). */
      logExport: (body: ReportExport) => request('POST', '/manager/reports/exports', { body }),
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
      expenses: (query: ReportQuery) =>
        request('GET', `/manager/reports/expenses?${toParams(query)}`, {
          schema: expensesReportSchema,
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
    periods: {
      list: () => request('GET', '/manager/periods', { schema: periodListSchema }),
      get: (period: string) =>
        request('GET', `/manager/periods/${period}`, { schema: periodPackSchema }),
      close: (period: string, body: ClosePeriod) =>
        request('POST', `/manager/periods/${period}/close`, { body, schema: periodPackSchema }),
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
      recall: (id: string, body: RecallTransfer) =>
        request('POST', `/manager/transfers/${id}/recall`, { body, schema: transferSchema }),
      claimLoss: (id: string, body: ClaimTransferLoss) =>
        request('POST', `/manager/transfers/${id}/losses`, { body, schema: transferSchema }),
      decideLoss: (id: string, lossId: string, body: DecideTransferLoss) =>
        request('POST', `/manager/transfers/${id}/losses/${lossId}/decision`, {
          body,
          schema: transferSchema,
        }),
      inTransit: (branchId?: string | null) =>
        request('GET', `/manager/transfers/in-transit?${toParams({ branchId })}`, {
          schema: inTransitSummarySchema,
        }),
    },
    employees: {
      list: () => request('GET', '/manager/employees', { schema: employeeListSchema }),
      get: (id: string) => request('GET', `/manager/employees/${id}`, { schema: employeeSchema }),
      /** Device PIN (ADR-0112): 6–12 digits; 204. */
      clearPin: (id: string) => request('DELETE', `/manager/employees/${id}/pin`),
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
      revokeSessions: (id: string) =>
        request('POST', `/manager/employees/${id}/sessions/revoke`, {
          body: {},
          schema: z.object({ ended: z.number().int() }),
        }),
      unlock: (id: string) => request('POST', `/manager/employees/${id}/unlock`, { body: {} }),
    },
  };
}

function toParams(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  return params.toString();
}
