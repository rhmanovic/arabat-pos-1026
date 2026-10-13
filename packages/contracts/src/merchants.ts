import { z } from 'zod';
import { languageSchema } from './interfaces.js';

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();

/** Company profile of the current merchant (`/api/v1/manager/merchant`). */
export const merchantProfileSchema = z.object({
  id: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  legalName: z.string().nullable(),
  commercialRegistrationNo: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  countryCode: z.string(),
  defaultCurrency: z.string(),
  defaultLanguage: languageSchema,
  /** The single cut-off time zone of every list, statement and report (BR-184). */
  timezone: z.string(),
  /** Last time the time zone was changed after registration; null = never. */
  timezoneChangedAt: z.string().nullable().default(null),
  status: z.enum(['active', 'suspended', 'closed']),
  version: z.number().int(),
  createdAt: z.string(),
  /** The owner's pending transfer, if any (BR-020); visible to the owner and the named member. */
  pendingOwnershipTransfer: z
    .object({
      id: z.string(),
      toMembershipId: z.string(),
      toName: z.string(),
      toEmail: z.string(),
      expiresAt: z.string(),
      createdAt: z.string(),
      /** True when the signed-in member is the one named: they may accept with the e-mailed token. */
      forMe: z.boolean(),
    })
    .nullable()
    .default(null),
});
export type MerchantProfile = z.infer<typeof merchantProfileSchema>;

/** The owner names a member and re-enters their password (BR-020, R5.2). */
export const startOwnershipTransferSchema = z.object({
  toMembershipId: z.uuid(),
  password: z.string().min(1).max(128),
});
export type StartOwnershipTransfer = z.input<typeof startOwnershipTransferSchema>;
/** The named member confirms with the token from their e-mail. */
export const acceptOwnershipTransferSchema = z.object({ token: z.string().min(10).max(200) });
export type AcceptOwnershipTransfer = z.input<typeof acceptOwnershipTransferSchema>;

/** IANA zone names accepted for a company (validated again on the server). */
export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/, { error: 'Not an IANA time zone name.' });

export const updateMerchantProfileSchema = z
  .object({
    version: z.number().int().positive(),
    nameEn: nullableText(120),
    nameAr: nullableText(120),
    legalName: nullableText(200),
    commercialRegistrationNo: nullableText(50),
    contactEmail: z
      .string()
      .trim()
      .toLowerCase()
      .transform((v) => (v === '' ? null : v))
      .pipe(z.email().max(254).nullable())
      .nullable(),
    contactPhone: nullableText(30),
    defaultLanguage: languageSchema,
    /** Omitted = unchanged. A change re-cuts every past day: audited and warned (BR-184). */
    timezone: timezoneSchema.optional(),
  })
  .refine((v) => Boolean(v.nameAr || v.nameEn), {
    error: 'A company name in Arabic or English is required.',
    path: ['nameAr'],
  });
export type UpdateMerchantProfile = z.input<typeof updateMerchantProfileSchema>;

export const branchSchema = z.object({
  id: z.string(),
  code: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  isMain: z.boolean(),
  status: z.string(),
});
export type Branch = z.infer<typeof branchSchema>;
export const branchListResponseSchema = z.object({ branches: z.array(branchSchema) });
