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
