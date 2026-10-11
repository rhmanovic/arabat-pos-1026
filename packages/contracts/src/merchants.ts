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
  timezone: z.string(),
  status: z.enum(['active', 'suspended', 'closed']),
  version: z.number().int(),
  createdAt: z.string(),
});
export type MerchantProfile = z.infer<typeof merchantProfileSchema>;

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
