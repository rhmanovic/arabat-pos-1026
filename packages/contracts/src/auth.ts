import { z } from 'zod';
import { languageSchema } from './interfaces.js';
import { timezoneSchema } from './merchants.js';

export const merchantInterfaceSchema = z.enum(['manager', 'pos']);
export type MerchantInterface = z.infer<typeof merchantInterfaceSchema>;

/** Email is trimmed and lower-cased so lookups are case-insensitive. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Password policy (AUTH.md §2.2): 10–128 characters; never trimmed. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, {
    error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
  })
  .max(PASSWORD_MAX_LENGTH);

/** Passwords submitted for sign-in are only length-bounded (no policy leak). */
const passwordInputSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);

const optionalName = z
  .string()
  .trim()
  .max(120)
  .transform((v) => (v === '' ? null : v))
  .nullish();

// ---------------------------------------------------------------- registration
export const registerRequestSchema = z.object({
  company: z
    .object({
      nameAr: optionalName,
      nameEn: optionalName,
      legalName: optionalName,
      defaultLanguage: languageSchema.default('ar'),
      /** Set once at registration (BR-184); defaults to Asia/Kuwait. */
      timezone: timezoneSchema.optional(),
    })
    .refine((c) => Boolean(c.nameAr || c.nameEn), {
      error: 'A company name in Arabic or English is required.',
      path: ['nameAr'],
    }),
  owner: z.object({
    fullName: z.string().trim().min(2).max(120),
    email: emailSchema,
    password: newPasswordSchema,
  }),
});
export type RegisterRequest = z.input<typeof registerRequestSchema>;

// ---------------------------------------------------------------- sign-in
export const loginRequestSchema = z.object({
  interface: merchantInterfaceSchema,
  email: emailSchema,
  password: passwordInputSchema,
});
export type LoginRequest = z.input<typeof loginRequestSchema>;

export const branchOptionSchema = z.object({
  id: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
});
export type BranchOption = z.infer<typeof branchOptionSchema>;

export const merchantOptionSchema = z.object({
  id: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  /** Branches where the user may open the POS (only for the POS interface). */
  branches: z.array(branchOptionSchema),
});
export type MerchantOption = z.infer<typeof merchantOptionSchema>;

export const loginResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('authenticated'),
    interface: z.enum(['manager', 'pos', 'platform']),
    redirectTo: z.string(),
  }),
  z.object({
    status: z.literal('select_merchant'),
    ticket: z.string(),
    merchants: z.array(merchantOptionSchema),
  }),
  z.object({ status: z.literal('select_branch'), branches: z.array(branchOptionSchema) }),
  z.object({ status: z.literal('mfa_required'), ticket: z.string() }),
]);
export type LoginResult = z.infer<typeof loginResultSchema>;

export const selectMerchantRequestSchema = z.object({
  ticket: z.string().min(20).max(200),
  merchantId: z.uuid(),
  branchId: z.uuid().optional(),
});
export type SelectMerchantRequest = z.input<typeof selectMerchantRequestSchema>;

export const platformLoginRequestSchema = z.object({
  email: emailSchema,
  password: passwordInputSchema,
});
export type PlatformLoginRequest = z.input<typeof platformLoginRequestSchema>;

export const platformMfaRequestSchema = z.object({
  ticket: z.string().min(20).max(200),
  code: z.string().regex(/^\d{6}$/),
});
export type PlatformMfaRequest = z.input<typeof platformMfaRequestSchema>;

// ---------------------------------------------------------------- password recovery
export const forgotPasswordRequestSchema = z.object({
  email: emailSchema,
  interface: merchantInterfaceSchema.default('manager'),
});
export type ForgotPasswordRequest = z.input<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(20).max(200),
  password: newPasswordSchema,
});
export type ResetPasswordRequest = z.input<typeof resetPasswordRequestSchema>;

export const acceptedResponseSchema = z.object({ status: z.literal('accepted') });

// ---------------------------------------------------------------- session context
export const switchInterfaceRequestSchema = z.object({
  target: merchantInterfaceSchema,
  branchId: z.uuid().optional(),
});
export type SwitchInterfaceRequest = z.input<typeof switchInterfaceRequestSchema>;

export const switchMerchantRequestSchema = z.object({
  merchantId: z.uuid(),
  branchId: z.uuid().optional(),
});
export type SwitchMerchantRequest = z.input<typeof switchMerchantRequestSchema>;

export const merchantListResponseSchema = z.object({ merchants: z.array(merchantOptionSchema) });

/**
 * Response of `GET /api/v1/auth/{interface}/me`: the authenticated session of that interface.
 * The frontend uses `permissions` and `availableInterfaces` only to adapt the UI; the
 * backend enforces every permission on every request.
 */
export const meResponseSchema = z.object({
  interface: z.enum(['manager', 'pos', 'platform']),
  realm: z.enum(['merchant', 'platform']),
  actor: z.object({
    id: z.string(),
    email: z.string(),
    fullName: z.string(),
    preferredLanguage: languageSchema.nullable(),
  }),
  merchant: z
    .object({
      id: z.string(),
      nameEn: z.string().nullable(),
      nameAr: z.string().nullable(),
      status: z.string(),
    })
    .nullable(),
  branch: branchOptionSchema.nullable(),
  isOwner: z.boolean(),
  permissions: z.array(z.string()),
  availableInterfaces: z.array(merchantInterfaceSchema),
  merchantCount: z.number().int(),
  session: z.object({ expiresAt: z.string(), idleExpiresAt: z.string() }),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const switchBranchRequestSchema = z.object({ branchId: z.uuid() });

/** POS screen lock (AUTH.md §2.1): after this long without input the till locks itself. */
export const POS_IDLE_LOCK_SECONDS = 300;
export const unlockRequestSchema = z.object({ password: z.string().min(1).max(200) });

// ---------------------------------------------------------------- account hygiene (R5.4)
/** Self-service password change: the current password is required; other sessions end. */
export const changePasswordSchema = z.object({
  currentPassword: passwordInputSchema,
  newPassword: newPasswordSchema,
});
export type ChangePassword = z.input<typeof changePasswordSchema>;

export const sessionInfoSchema = z.object({
  id: z.string(),
  interface: z.enum(['manager', 'pos']),
  merchantName: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  current: z.boolean(),
});
export const sessionListSchema = z.object({ sessions: z.array(sessionInfoSchema) });
export type SessionInfo = z.infer<typeof sessionInfoSchema>;

/*
 * Browser POS sign-in with name + PIN (Plan A). A branch link (`/pos/pin-sign-in#<key>`, made by a
 * manager) lists the branch's cashiers; each signs in with the PIN they chose for the tills
 * (same argon2id hash, 3 wrong PINs lock that person for 5 minutes).
 */
export const PIN_LINK_KEY = /^[A-Za-z0-9_-]{43}$/;

export const pinSignInBranchSchema = z.object({
  merchant: z.object({ nameEn: z.string().nullable(), nameAr: z.string().nullable() }),
  branch: z.object({
    id: z.uuid(),
    code: z.string(),
    nameEn: z.string().nullable(),
    nameAr: z.string().nullable(),
  }),
  staff: z.array(z.object({ membershipId: z.uuid(), fullName: z.string(), hasPin: z.boolean() })),
});
export type PinSignInBranch = z.infer<typeof pinSignInBranchSchema>;

export const pinSignInRequestSchema = z.object({
  key: z.string().regex(PIN_LINK_KEY),
  membershipId: z.uuid(),
  pin: z.string().regex(/^\d{6,12}$/),
});
export type PinSignInRequest = z.infer<typeof pinSignInRequestSchema>;

/** Managers: which branches have a PIN sign-in link (the key itself is shown once). */
export const pinLinkListSchema = z.object({
  branches: z.array(z.object({ branchId: z.uuid(), active: z.boolean() })),
});
export type PinLinkList = z.infer<typeof pinLinkListSchema>;
export const createdPinLinkSchema = z.object({
  branchId: z.uuid(),
  key: z.string(),
  url: z.string(),
});
export type CreatedPinLink = z.infer<typeof createdPinLinkSchema>;
