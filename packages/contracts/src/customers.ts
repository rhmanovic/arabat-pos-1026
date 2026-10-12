import { z } from 'zod';
import { moneySchema } from './catalog.js';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

/**
 * Canonical phone form used for uniqueness and search (BR-111): digits with a leading "+".
 * "00" becomes "+"; a local 8-digit number gets the Kuwait code (+965). Returns null when
 * the input is not a plausible phone number.
 */
export function normalizePhone(input: string): string | null {
  let s = input.trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (!/^\+?\d+$/.test(s)) return null;
  if (!s.startsWith('+')) s = s.length === 8 ? `+965${s}` : `+${s}`;
  const digits = s.length - 1;
  return digits >= 8 && digits <= 15 ? s : null;
}

const phoneField = z
  .string()
  .nullish()
  .transform((v, ctx) => {
    if (v == null || v.trim() === '') return null;
    const phone = normalizePhone(v);
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number.' });
      return z.NEVER;
    }
    return phone;
  });

const emailField = z
  .email()
  .max(200)
  .nullish()
  .or(z.literal(''))
  .transform((v) => (v ? v.toLowerCase() : null));

export const CUSTOMER_STATUSES = ['active', 'inactive'] as const;

/** What the POS sees (BR-113): enough to identify the customer at the till. */
export const posCustomerSchema = z.object({
  id: z.string(),
  code: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  status: z.enum(CUSTOMER_STATUSES),
});
export type PosCustomer = z.infer<typeof posCustomerSchema>;
export const posCustomerListSchema = z.object({ customers: z.array(posCustomerSchema) });

export const customerStatsSchema = z.object({
  salesCount: z.number().int(),
  salesTotal: moneySchema,
  refundsCount: z.number().int(),
  refundedTotal: moneySchema,
  netTotal: moneySchema,
  averageSale: moneySchema,
  firstPurchaseAt: z.string().nullable(),
  lastPurchaseAt: z.string().nullable(),
});
export type CustomerStats = z.infer<typeof customerStatsSchema>;

export const customerSchema = posCustomerSchema.extend({
  email: z.string().nullable(),
  address: z.string().nullable(),
  preferredLanguage: z.enum(['ar', 'en']).nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  stats: customerStatsSchema,
  version: z.number().int(),
});
export type Customer = z.infer<typeof customerSchema>;

export const customerListSchema = z.object({
  customers: z.array(customerSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export const customerListQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(CUSTOMER_STATUSES).optional(),
  sort: z.enum(['recent', 'name', 'spend']).default('recent'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type CustomerListQuery = z.input<typeof customerListQuerySchema>;

export const posCustomerSearchSchema = z.object({ q: z.string().trim().min(1).max(80) });

/** Basic profile a cashier may create at the till (`customers.create`). */
export const createCustomerSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  phone: phoneField,
  email: emailField,
});
export type CreateCustomer = z.input<typeof createCustomerSchema>;

export const saveCustomerSchema = createCustomerSchema.extend({
  address: text(300),
  preferredLanguage: z
    .enum(['ar', 'en'])
    .nullish()
    .transform((v) => v ?? null),
  status: z.enum(CUSTOMER_STATUSES).default('active'),
  version: z.number().int().positive().optional(),
});
export type SaveCustomer = z.input<typeof saveCustomerSchema>;

export const customerNoteSchema = z.object({
  id: z.string(),
  body: z.string(),
  author: z.string(),
  createdAt: z.string(),
});
export type CustomerNote = z.infer<typeof customerNoteSchema>;
export const customerNoteListSchema = z.object({ notes: z.array(customerNoteSchema) });
export const addCustomerNoteSchema = z.object({ body: z.string().trim().min(1).max(2000) });

/** Refunds of the customer's sales (history tab). */
export const customerRefundSchema = z.object({
  id: z.string(),
  refundNumber: z.string(),
  saleId: z.string(),
  receiptNumber: z.string(),
  branchId: z.string(),
  kind: z.string(),
  status: z.string(),
  total: moneySchema,
  createdAt: z.string(),
});
export const customerRefundListSchema = z.object({ refunds: z.array(customerRefundSchema) });
