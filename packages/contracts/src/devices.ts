import { z } from 'zod';

/**
 * Local-first devices (ADR-0112). The device contract is `docs/DEVICE_API.md`; these schemas are
 * the source of truth for its shapes.
 */

/** A device counts as online when it was seen less than this long ago. */
export const DEVICE_ONLINE_SECONDS = 120;

/**
 * Registration, done once on the device by a manager (online): e-mail and password, then the
 * company and branch. Without `merchantId` / `branchId` the answer lists the choices.
 */
export const registerDeviceSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(256),
  deviceName: z.string().trim().min(1).max(80),
  merchantId: z.uuid().optional(),
  branchId: z.uuid().optional(),
});
export type RegisterDevice = z.infer<typeof registerDeviceSchema>;

export const registeredDeviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  merchantId: z.uuid(),
  branchId: z.uuid(),
  branchCode: z.string(),
  registerId: z.uuid(),
  /** Never reused within the branch (`R1`, `R2`, …); the receipt series is `{branch}-{register}-`. */
  registerCode: z.string(),
});
export type RegisteredDevice = z.infer<typeof registeredDeviceSchema>;

/** A branch where the person may register a device. */
export const deviceBranchOptionSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
});

export const registerDeviceResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('select_branch'),
    /** Companies and branches where this person may register a device (`registers.manage`). */
    merchants: z.array(
      z.object({
        id: z.uuid(),
        nameEn: z.string().nullable(),
        nameAr: z.string().nullable(),
        branches: z.array(deviceBranchOptionSchema),
      }),
    ),
  }),
  z.object({
    status: z.literal('registered'),
    device: registeredDeviceSchema,
    /** The device's bearer token: shown only here, store it in the OS keychain. */
    token: z.string(),
  }),
]);
export type RegisterDeviceResult = z.infer<typeof registerDeviceResultSchema>;

/** A device as managers see it (`/manager/devices`). */
export const posDeviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  branchId: z.uuid(),
  registerId: z.uuid(),
  registerCode: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  online: z.boolean(),
});
export type PosDevice = z.infer<typeof posDeviceSchema>;

/* Sync download: GET /device/sync?since=<version> (ADR-0112 §7a). */

/** Money on the device wire: integer fils as a decimal string (e.g. "1250" = 1.250 KWD). */
const minor = z.string().regex(/^-?\d+$/);

export const deviceSnapshotSchema = z.object({
  /** Opaque cursor: send it back as `since` next time. */
  version: z.string(),
  /** true: every collection is complete (replace local data); false: only changes since `since`. */
  full: z.boolean(),
  /** Latest catalog change; record it on every sale priced with this catalog. */
  catalogVersion: z.string(),
  serverTime: z.string(),
  offlineLimitHours: z.number().int(),
  device: registeredDeviceSchema,
  merchant: z.object({
    id: z.uuid(),
    nameEn: z.string().nullable(),
    nameAr: z.string().nullable(),
    currency: z.literal('KWD'),
    timezone: z.string(),
  }),
  branch: z.object({
    id: z.uuid(),
    code: z.string(),
    nameEn: z.string().nullable(),
    nameAr: z.string().nullable(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
    receiptHeader: z.string().nullable(),
    receiptFooter: z.string().nullable(),
  }),
  register: z.object({
    id: z.uuid(),
    code: z.string(),
    defaultOpeningFloatMinor: minor,
    discrepancyToleranceMinor: minor,
  }),
  /** Selling rules for `@arabat/pos-core` (always complete). */
  settings: z.object({
    maxDiscountPercent: z.string(),
    priceOverrideFloorPercent: z.string().nullable(),
    priceOverrideCeilingPercent: z.string().nullable(),
    priceOverrideBelowCost: z.boolean(),
    requireTenderReference: z.boolean(),
    blindCashCount: z.boolean(),
    cashOutOtherLimitMinor: minor,
    cashOutOtherShiftLimitMinor: minor,
    refundWindowDays: z.number().int(),
    refundApprovalLimitMinor: minor,
    refundOwnSalesNeedApproval: z.boolean(),
    allowNegativeStock: z.boolean(),
    /** Held sales are discarded after this many hours; 0 = never. */
    heldSaleExpiryHours: z.number().int(),
  }),
  /** The device's own counters as the server last saw them (if local data was lost, continue above). */
  counters: z.object({ lastReceiptNumber: z.string().nullable() }),
  /** Always complete. */
  paymentMethods: z.array(
    z.object({
      id: z.uuid(),
      kind: z.string(),
      status: z.string(),
      availableInPos: z.boolean(),
      gatewayProvider: z.string().nullable(),
      financialAccountId: z.uuid().nullable(),
      nameEn: z.string().nullable(),
      nameAr: z.string().nullable(),
      feeType: z.enum(['none', 'fixed', 'percentage', 'fixed_plus_percentage']),
      feeFixedMinor: minor,
      feePercent: z.string(),
      sortOrder: z.number().int(),
    }),
  ),
  /** Always complete: active members who may use the POS at the branch. */
  staff: z.array(
    z.object({
      membershipId: z.uuid(),
      userId: z.uuid(),
      fullName: z.string(),
      isOwner: z.boolean(),
      /** argon2id PHC string; null = no PIN yet (cannot sign in on devices). */
      pinHash: z.string().nullable(),
      /** Permission keys held at this branch (`@arabat/permissions`). */
      permissions: z.array(z.string()),
    }),
  ),
  /** Always complete. */
  categories: z.array(
    z.object({
      id: z.uuid(),
      parentId: z.uuid().nullable(),
      nameEn: z.string().nullable(),
      nameAr: z.string().nullable(),
      sortOrder: z.number().int(),
      status: z.string(),
    }),
  ),
  /**
   * Products changed since `since` (all when `full`). `sellable` false = archived or no longer
   * sold at this branch: hide it, keep it for old receipts.
   */
  products: z.array(
    z.object({
      id: z.uuid(),
      categoryId: z.uuid().nullable(),
      nameEn: z.string().nullable(),
      nameAr: z.string().nullable(),
      type: z.string(),
      trackInventory: z.boolean(),
      sellable: z.boolean(),
      updatedAt: z.string(),
      variants: z.array(
        z.object({
          id: z.uuid(),
          nameEn: z.string().nullable(),
          nameAr: z.string().nullable(),
          sku: z.string().nullable(),
          priceMinor: minor,
          /** For the "not below cost" price-change rule. */
          costMinor: minor.nullable(),
          isDefault: z.boolean(),
          status: z.string(),
          barcodes: z.array(z.string()),
        }),
      ),
    }),
  ),
});
export type DeviceSnapshot = z.infer<typeof deviceSnapshotSchema>;

export const deviceSyncQuerySchema = z.object({ since: z.string().max(64).optional() });

export const deviceSettingsSchema = z.object({
  offlineLimitHours: z.number().int().min(1).max(720),
});
export type DeviceSettings = z.infer<typeof deviceSettingsSchema>;
