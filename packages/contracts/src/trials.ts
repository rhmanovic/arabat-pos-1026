import { z } from 'zod';
import { emailSchema, newPasswordSchema } from './auth.js';
import { moneySchema } from './catalog.js';
import { publicOfferItemSchema } from './pricing.js';

/**
 * Free trials and the sign-up funnel of the public site (ADR-0115). The operator sets every
 * number in the platform: trial lengths, devices available for trial, waiting list.
 */
export const BUSINESS_TYPES = ['retail', 'restaurant', 'cafe', 'other'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
/** Anonymous funnel steps; `account` = the trial account was opened. */
export const FUNNEL_STEPS = ['business', 'devices', 'account'] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];
export const DEVICE_TRIAL_STATUSES = [
  'pending',
  'waitlist',
  'approved',
  'delivered',
  'returned',
  'rejected',
] as const;
export type DeviceTrialStatus = (typeof DEVICE_TRIAL_STATUSES)[number];
export const LEAD_STAGES = ['receipt', 'started', 'trial'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

const sessionId = z.uuid();
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

// ---------------------------------------------------------------- public funnel
export const trialDeviceSchema = publicOfferItemSchema.extend({
  /** Whether at least one is free for a trial now. */
  available: z.boolean(),
});
export const publicTrialOfferSchema = z.object({
  trialDaysOwn: z.number().int(),
  trialDaysDevices: z.number().int(),
  waitlistEnabled: z.boolean(),
  systemNameAr: z.string(),
  systemNameEn: z.string(),
  systemPrice: moneySchema,
  devices: z.array(trialDeviceSchema),
});
export type PublicTrialOffer = z.infer<typeof publicTrialOfferSchema>;

export const funnelEventSchema = z.object({ sessionId, step: z.enum(FUNNEL_STEPS) });

export const startTrialSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: emailSchema,
  password: newPasswordSchema,
  companyName: optionalText(120),
  businessType: z.enum(BUSINESS_TYPES),
  language: z.enum(['ar', 'en']),
  sessionId,
  devices: z
    .array(z.object({ itemId: z.uuid(), quantity: z.number().int().min(1).max(20) }))
    .max(20),
});
export type StartTrial = z.input<typeof startTrialSchema>;
/** The account is open and the owner signed in (no e-mail confirmation in this phase). */
export const trialStartedSchema = z.object({
  trialDays: z.number().int(),
  devices: z.enum(['none', 'pending', 'waitlist']),
  redirectTo: z.string(),
});
export type TrialStarted = z.infer<typeof trialStartedSchema>;

// ---------------------------------------------------------------- platform
export const trialSettingsSchema = z.object({
  trialDaysOwn: z.number().int(),
  trialDaysDevices: z.number().int(),
  waitlistEnabled: z.boolean(),
  version: z.number().int(),
});
export type TrialSettings = z.infer<typeof trialSettingsSchema>;
export const saveTrialSettingsSchema = z.object({
  trialDaysOwn: z.number().int().min(1).max(365),
  trialDaysDevices: z.number().int().min(1).max(365),
  waitlistEnabled: z.boolean(),
  version: z.number().int().nonnegative(),
});
export type SaveTrialSettings = z.input<typeof saveTrialSettingsSchema>;

export const trialDeviceStockSchema = z.object({
  itemId: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  status: z.enum(['active', 'hidden']),
  trialStock: z.number().int(),
  /** Approved or delivered and not returned. */
  out: z.number().int(),
  available: z.number().int(),
  waiting: z.number().int(),
  version: z.number().int(),
});
export type TrialDeviceStock = z.infer<typeof trialDeviceStockSchema>;
export const saveTrialStockSchema = z.object({
  trialStock: z.number().int().min(0).max(10000),
  version: z.number().int().nonnegative(),
});

export const leadSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string().nullable(),
  companyName: z.string().nullable(),
  businessType: z.enum(BUSINESS_TYPES).nullable(),
  language: z.enum(['ar', 'en']),
  stage: z.enum(LEAD_STAGES),
  merchantId: z.string().nullable(),
  devices: z.enum(DEVICE_TRIAL_STATUSES).nullable(),
  trialEndsAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  salesCount: z.number().int(),
  lastSaleAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Lead = z.infer<typeof leadSchema>;
export const leadListSchema = z.object({
  leads: z.array(leadSchema),
  counts: z.record(z.enum(LEAD_STAGES), z.number().int()),
});
export const leadQuerySchema = z.object({ stage: z.enum(LEAD_STAGES).optional() });

export const deviceTrialRequestSchema = z.object({
  id: z.string(),
  merchantId: z.string(),
  companyName: z.string().nullable(),
  contactName: z.string().nullable(),
  email: z.string(),
  status: z.enum(DEVICE_TRIAL_STATUSES),
  note: z.string().nullable(),
  lines: z.array(z.object({ nameAr: z.string(), nameEn: z.string(), quantity: z.number().int() })),
  deliveredAt: z.string().nullable(),
  trialEndsAt: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int(),
});
export type DeviceTrialRequest = z.infer<typeof deviceTrialRequestSchema>;
export const deviceTrialRequestListSchema = z.object({
  requests: z.array(deviceTrialRequestSchema),
  counts: z.record(z.enum(DEVICE_TRIAL_STATUSES), z.number().int()),
});
export const deviceTrialQuerySchema = z.object({
  status: z.enum(DEVICE_TRIAL_STATUSES).optional(),
});
export const updateDeviceTrialSchema = z.object({
  status: z.enum(DEVICE_TRIAL_STATUSES),
  note: optionalText(1000),
  version: z.number().int().nonnegative(),
});
export type UpdateDeviceTrial = z.input<typeof updateDeviceTrialSchema>;

export const funnelStatsSchema = z.object({
  days: z.number().int(),
  steps: z.array(z.object({ step: z.enum(FUNNEL_STEPS), sessions: z.number().int() })),
});
export type FunnelStats = z.infer<typeof funnelStatsSchema>;
export const funnelStatsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});
