import { z } from 'zod';
import { REFUND_REASONS, returnLineInputSchema } from './refunds.js';
import { discountInputSchema } from './sales.js';

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

/* Sync upload: POST /device/sync (ADR-0112 §5, §6, §7b, docs/DEVICE_API.md). */

/** Money on the device wire, never negative. */
const amountMinor = z.string().regex(/^\d{1,13}$/);
const note = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v ? v : null));
const recordBase = {
  /** UUIDv7 made by the device: the same id on the device and the server, and the idempotency key. */
  id: z.uuid(),
  /** The device's clock when it happened (ISO 8601 with offset). */
  occurredAt: z.iso.datetime({ offset: true }),
  /** Who did it at the till (signed in with their PIN). */
  membershipId: z.uuid(),
};

export const deviceShiftOpenSchema = z.object({
  kind: z.literal('shift_open'),
  ...recordBase,
  countedCashMinor: amountMinor,
  note,
});

export const deviceCashMovementSchema = z.object({
  kind: z.literal('cash_movement'),
  ...recordBase,
  shiftId: z.uuid(),
  /** Pay-in / pay-out of the drawer ("other"); custody moves (safe drops, deposits) stay online. */
  direction: z.enum(['cash_in', 'cash_out']),
  amountMinor,
  note,
});

export const deviceSaleSchema = z.object({
  kind: z.literal('sale'),
  ...recordBase,
  shiftId: z.uuid(),
  /** `{branch code}-{register code}-{6 digits}`, gap-free per device. */
  receiptNumber: z.string().regex(/^[A-Za-z0-9_-]{1,40}-\d{6}$/),
  /** `catalogVersion` of the snapshot the sale was priced with. */
  catalogVersion: z.string().max(64),
  lines: z
    .array(
      z.object({
        variantId: z.uuid(),
        quantity: z.string().regex(/^\d{1,9}(\.\d{1,3})?$/),
        /** The catalog price on the device. */
        listUnitPriceMinor: amountMinor,
        /** The price charged (differs from the list price only for a price change). */
        unitPriceMinor: amountMinor,
        priceOverrideReason: note,
        discount: discountInputSchema.nullable(),
        grossMinor: amountMinor,
        lineDiscountMinor: amountMinor,
        orderDiscountMinor: amountMinor,
        netMinor: amountMinor,
      }),
    )
    .min(1)
    .max(200),
  orderDiscount: discountInputSchema.nullable(),
  subtotalMinor: amountMinor,
  lineDiscountsMinor: amountMinor,
  orderDiscountMinor: amountMinor,
  totalMinor: amountMinor,
  payments: z
    .array(
      z.object({
        id: z.uuid(),
        methodId: z.uuid(),
        amountMinor,
        tenderedMinor: amountMinor.nullable(),
        changeMinor: amountMinor,
        feeMinor: amountMinor,
        reference: z
          .string()
          .trim()
          .max(80)
          .nullish()
          .transform((v) => (v ? v : null)),
      }),
    )
    .max(10),
  /** The device decided a discount or price beyond the limit was allowed (pos-core). */
  aboveLimit: z.boolean(),
  zeroTotalReason: note,
  /** A supervisor who typed their PIN at the till to lend rights (BR-177). */
  override: z
    .object({
      approverMembershipId: z.uuid(),
      rights: z.array(z.string().max(64)).min(1).max(10),
      note,
    })
    .nullable(),
  /** The device has no printer: print on the branch's print agents (gap A). Default false. */
  requestRemotePrint: z.boolean().default(false),
});

export const deviceRefundSchema = z.object({
  kind: z.literal('refund'),
  ...recordBase,
  shiftId: z.uuid(),
  /** A sale this device made (owner decision 4). */
  saleId: z.uuid(),
  lines: z.array(returnLineInputSchema).min(1).max(200),
  reason: z.enum(REFUND_REASONS),
  note,
  /** Pay-back per original payment (pos-core `paybackAllocation`). */
  payback: z
    .array(
      z.object({
        paymentId: z.uuid(),
        amountMinor,
        reference: z
          .string()
          .trim()
          .max(80)
          .nullish()
          .transform((v) => (v ? v : null)),
      }),
    )
    .max(10),
  /** Second person who approved at the till (pos-core `refundApprovalReasons`), if any. */
  approval: z
    .object({
      approverMembershipId: z.uuid(),
      reasons: z.array(z.enum(['over_limit', 'outside_window', 'own_sale'])).min(1),
    })
    .nullable(),
});

export const deviceShiftCloseSchema = z.object({
  kind: z.literal('shift_close'),
  ...recordBase,
  shiftId: z.uuid(),
  countedCashMinor: amountMinor,
  note,
});

export const deviceRecordSchema = z.discriminatedUnion('kind', [
  deviceShiftOpenSchema,
  deviceCashMovementSchema,
  deviceSaleSchema,
  deviceRefundSchema,
  deviceShiftCloseSchema,
]);
export type DeviceRecord = z.infer<typeof deviceRecordSchema>;

/**
 * Records in causal order (shift open → sales / cash movements / refunds → shift close). Each
 * record is checked on its own, so one bad record does not block the others.
 */
export const deviceUploadSchema = z.object({
  records: z
    .array(
      z
        .object({ kind: z.string().max(32), id: z.uuid(), occurredAt: z.string().max(64) })
        .passthrough(),
    )
    .min(1)
    .max(200),
});

export const deviceRecordResultSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  status: z.enum(['accepted', 'duplicate', 'refused']),
  /** Accepted: what the server created (e.g. the refund number). */
  result: z.record(z.string(), z.unknown()).nullable(),
  /** Refused: an `ErrorCode` and a message. */
  code: z.string().nullable(),
  message: z.string().nullable(),
  /** The record's device time looked wrong; accepted anyway and shown to managers (gap B). */
  clockSkew: z.boolean(),
});
export type DeviceRecordResult = z.infer<typeof deviceRecordResultSchema>;

export const deviceUploadResultSchema = z.object({
  serverTime: z.string(),
  results: z.array(deviceRecordResultSchema),
});
export type DeviceUploadResult = z.infer<typeof deviceUploadResultSchema>;

/* Device exceptions for managers (ADR-0112 §5, gap B). */

export const DEVICE_EXCEPTION_KINDS = ['negative_stock', 'clock_skew', 'refused'] as const;

export const deviceExceptionQuerySchema = z.object({
  status: z.enum(['open', 'resolved']).default('open'),
});

export const deviceExceptionSchema = z.object({
  id: z.uuid(),
  kind: z.enum(DEVICE_EXCEPTION_KINDS),
  branchId: z.uuid(),
  deviceId: z.uuid(),
  deviceName: z.string(),
  registerCode: z.string(),
  recordId: z.uuid(),
  recordKind: z.string(),
  /** negative_stock: variantId, productName, balance, receiptNumber; clock_skew: occurredAt,
   *  receivedAt, outsideShift; refused: code, message. */
  details: z.record(z.string(), z.unknown()),
  occurredAt: z.string(),
  receivedAt: z.string(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  resolvedByName: z.string().nullable(),
  resolutionNote: z.string().nullable(),
  /** Refused records only: what the device sent, kept so nothing is lost. */
  payload: z.record(z.string(), z.unknown()).nullable(),
});
export type DeviceException = z.infer<typeof deviceExceptionSchema>;

export const resolveDeviceExceptionSchema = z.object({
  note: z.string().trim().min(1).max(500),
});

/* Self-service PINs (ADR-0112, owner decision 6): asked from the till, set through an e-mailed link. */

export const devicePinResetRequestSchema = z.object({ membershipId: z.uuid() });
export const devicePinResetCompleteSchema = z.object({
  token: z.string().min(20).max(200),
  pin: z.string().regex(/^\d{6,12}$/),
});
