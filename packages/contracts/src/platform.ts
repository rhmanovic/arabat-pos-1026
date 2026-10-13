import { z } from 'zod';
import { moneySchema } from './catalog.js';
import { languageSchema } from './interfaces.js';

/** Platform administration and subscriptions (Prompt 17). See BUSINESS_RULES.md BR-150…BR-158. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));

export const PLAN_FEATURES = ['restaurant', 'ecommerce'] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];
export const PLAN_LIMITS = ['branches', 'employees', 'products', 'registers'] as const;
export type PlanLimit = (typeof PLAN_LIMITS)[number];
export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'expired',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
/** Stored status, or `trial_ended` / `expired` when its dates have passed. */
export const EFFECTIVE_SUBSCRIPTION_STATUSES = [...SUBSCRIPTION_STATUSES, 'trial_ended'] as const;
export const MERCHANT_STATUSES = ['active', 'suspended', 'closed'] as const;

// ---------------------------------------------------------------- plans
export const planSchema = z.object({
  id: z.string(),
  code: z.string(),
  nameEn: z.string(),
  nameAr: z.string(),
  descriptionEn: z.string().nullable(),
  descriptionAr: z.string().nullable(),
  status: z.enum(['active', 'archived']),
  isDefault: z.boolean(),
  isPublic: z.boolean(),
  /** null = unlimited. */
  limits: z.object({
    branches: z.number().int().nullable(),
    employees: z.number().int().nullable(),
    products: z.number().int().nullable(),
    registers: z.number().int().nullable(),
  }),
  features: z.array(z.enum(PLAN_FEATURES)),
  /** Informational only: nothing is billed automatically (BR-155). */
  price: moneySchema.nullable(),
  billingPeriod: z.enum(['month', 'year']).nullable(),
  trialDays: z.number().int(),
  sortOrder: z.number().int(),
  merchantCount: z.number().int(),
  version: z.number().int(),
});
export type Plan = z.infer<typeof planSchema>;
export const planListSchema = z.object({ plans: z.array(planSchema) });

const limit = z
  .union([z.number().int().min(0).max(100000), z.null()])
  .optional()
  .transform((v) => v ?? null);
export const savePlanSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9_-]{1,39}$/),
    nameEn: z.string().trim().min(1).max(80),
    nameAr: z.string().trim().min(1).max(80),
    descriptionEn: text(300),
    descriptionAr: text(300),
    status: z.enum(['active', 'archived']),
    isDefault: z.boolean(),
    isPublic: z.boolean(),
    limits: z.object({ branches: limit, employees: limit, products: limit, registers: limit }),
    features: z.array(z.enum(PLAN_FEATURES)).max(PLAN_FEATURES.length),
    price: z
      .string()
      .trim()
      .regex(/^\d{1,9}(\.\d{1,3})?$/)
      .nullish()
      .or(z.literal(''))
      .transform((v) => v || null),
    billingPeriod: z
      .enum(['month', 'year'])
      .nullish()
      .transform((v) => v ?? null),
    trialDays: z.number().int().min(0).max(365),
    sortOrder: z.number().int().min(0).max(10000),
    version: z.number().int().nonnegative(),
  })
  .refine((p) => p.limits.branches !== 0 && p.limits.registers !== 0, {
    error: 'At least one branch and one register.',
    path: ['limits'],
  })
  .refine((p) => !p.isDefault || p.status === 'active', {
    error: 'The default plan must be active.',
    path: ['isDefault'],
  })
  .refine((p) => (p.price === null) === (p.billingPeriod === null), {
    error: 'Set both a price and a billing period, or neither.',
    path: ['billingPeriod'],
  });
export type SavePlan = z.input<typeof savePlanSchema>;

// ---------------------------------------------------------------- subscription view
export const usageSchema = z.object({
  branches: z.object({ used: z.number().int(), max: z.number().int().nullable() }),
  employees: z.object({ used: z.number().int(), max: z.number().int().nullable() }),
  products: z.object({ used: z.number().int(), max: z.number().int().nullable() }),
  registers: z.object({ used: z.number().int(), max: z.number().int().nullable() }),
});
export type Usage = z.infer<typeof usageSchema>;

export const subscriptionViewSchema = z.object({
  id: z.string(),
  plan: planSchema.omit({ merchantCount: true }),
  status: z.enum(SUBSCRIPTION_STATUSES),
  effectiveStatus: z.enum(EFFECTIVE_SUBSCRIPTION_STATUSES),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  trialEndsAt: z.string().nullable(),
  usage: usageSchema,
  version: z.number().int(),
});
export type SubscriptionView = z.infer<typeof subscriptionViewSchema>;

/** `/manager/subscription`: the merchant's own plan only, plus public plans for comparison. */
export const managerSubscriptionSchema = subscriptionViewSchema.extend({
  availablePlans: z.array(planSchema.omit({ merchantCount: true })),
});
export type ManagerSubscription = z.infer<typeof managerSubscriptionSchema>;

export const planCheckSchema = z.object({
  fits: z.boolean(),
  direction: z.enum(['upgrade', 'downgrade', 'same', 'change']),
  issues: z.array(
    z.object({
      kind: z.enum(['limit', 'feature']),
      key: z.string(),
      used: z.number().int().nullable(),
      max: z.number().int().nullable(),
    }),
  ),
});
export type PlanCheck = z.infer<typeof planCheckSchema>;

export const changeSubscriptionSchema = z
  .object({
    planId: z.uuid(),
    status: z.enum(SUBSCRIPTION_STATUSES),
    endsAt: z.iso
      .datetime({ offset: true })
      .nullish()
      .transform((v) => v ?? null),
    trialEndsAt: z.iso
      .datetime({ offset: true })
      .nullish()
      .transform((v) => v ?? null),
    reason: z.string().trim().min(3).max(500),
    version: z.number().int().positive(),
  })
  .refine((s) => s.status !== 'trialing' || s.trialEndsAt !== null, {
    error: 'A trial needs an end date.',
    path: ['trialEndsAt'],
  });
export type ChangeSubscription = z.input<typeof changeSubscriptionSchema>;

// ---------------------------------------------------------------- merchants (platform)
export const platformMerchantSchema = z.object({
  id: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  status: z.enum(MERCHANT_STATUSES),
  contactEmail: z.string().nullable(),
  createdAt: z.string(),
  ownerEmail: z.string().nullable(),
  ownerName: z.string().nullable(),
  branchCount: z.number().int(),
  employeeCount: z.number().int(),
  planCode: z.string().nullable(),
  planNameEn: z.string().nullable(),
  planNameAr: z.string().nullable(),
  subscriptionStatus: z.enum(EFFECTIVE_SUBSCRIPTION_STATUSES).nullable(),
  lastSaleAt: z.string().nullable(),
});
export type PlatformMerchant = z.infer<typeof platformMerchantSchema>;
export const platformMerchantListSchema = z.object({
  merchants: z.array(platformMerchantSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export const platformMerchantQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
  status: z.enum(MERCHANT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PlatformMerchantQuery = z.input<typeof platformMerchantQuerySchema>;

export const subscriptionEventSchema = z.object({
  id: z.string(),
  kind: z.enum(['created', 'changed']),
  fromPlan: z.string().nullable(),
  toPlan: z.string().nullable(),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
  operatorName: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});

export const platformAuditEntrySchema = z.object({
  id: z.string(),
  merchantId: z.string().nullable(),
  merchantNameEn: z.string().nullable(),
  merchantNameAr: z.string().nullable(),
  actorType: z.string(),
  actorName: z.string().nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  ip: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  occurredAt: z.string(),
});
export const platformAuditListSchema = z.object({
  entries: z.array(platformAuditEntrySchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export const platformAuditQuerySchema = z.object({
  merchantId: z.uuid().optional(),
  action: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => v || undefined),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type PlatformAuditQuery = z.input<typeof platformAuditQuerySchema>;

export const platformMerchantDetailSchema = z.object({
  id: z.string(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  legalName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  defaultLanguage: languageSchema,
  status: z.enum(MERCHANT_STATUSES),
  createdAt: z.string(),
  version: z.number().int(),
  owner: z
    .object({
      fullName: z.string(),
      email: z.string(),
      lastLoginAt: z.string().nullable(),
    })
    .nullable(),
  /** Emergency freeze of the owner's access (BR-020, R5.2). */
  ownerFrozenAt: z.string().nullable().default(null),
  ownerFrozenReason: z.string().nullable().default(null),
  /** Active members an operator may name as the new owner. */
  members: z
    .array(
      z.object({
        membershipId: z.string(),
        fullName: z.string(),
        email: z.string(),
        isOwner: z.boolean(),
      }),
    )
    .default([]),
  subscription: subscriptionViewSchema,
  /** Onboarding progress (oversight only; no business documents). */
  onboarding: z.object({
    ownerSignedIn: z.boolean(),
    hasProducts: z.boolean(),
    hasSales: z.boolean(),
    firstSaleAt: z.string().nullable(),
    lastSaleAt: z.string().nullable(),
    salesLast30Days: z.number().int(),
    onlineStoreStatus: z.enum(['none', 'draft', 'published', 'paused']),
  }),
  branches: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      nameEn: z.string().nullable(),
      nameAr: z.string().nullable(),
      status: z.string(),
      employees: z.number().int(),
    }),
  ),
  subscriptionEvents: z.array(subscriptionEventSchema),
  audit: z.array(platformAuditEntrySchema),
});
export type PlatformMerchantDetail = z.infer<typeof platformMerchantDetailSchema>;

export const createMerchantSchema = z
  .object({
    nameEn: text(120),
    nameAr: text(120),
    legalName: text(200),
    contactPhone: text(30),
    defaultLanguage: languageSchema,
    planId: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    owner: z.object({
      fullName: z.string().trim().min(1).max(120),
      email: z.email().trim().toLowerCase().max(254),
    }),
  })
  .refine((m) => Boolean(m.nameAr || m.nameEn), {
    error: 'A company name in Arabic or English is required.',
    path: ['nameAr'],
  });
export type CreateMerchant = z.input<typeof createMerchantSchema>;

export const merchantStatusChangeSchema = z.object({
  status: z.enum(MERCHANT_STATUSES),
  reason: z.string().trim().min(3).max(500),
  version: z.number().int().positive(),
});
/** Freeze or release the owner's access (R5.2). */
export const ownerFreezeSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  version: z.number().int().positive(),
});
export type OwnerFreeze = z.input<typeof ownerFreezeSchema>;
/** Operator-initiated ownership transfer (R5.2): recorded reason, both parties notified. */
export const platformOwnershipTransferSchema = z.object({
  toMembershipId: z.uuid(),
  reason: z.string().trim().min(3).max(500),
  version: z.number().int().positive(),
});
export type PlatformOwnershipTransfer = z.input<typeof platformOwnershipTransferSchema>;

export const platformOverviewSchema = z.object({
  merchants: z.object({
    total: z.number().int(),
    active: z.number().int(),
    suspended: z.number().int(),
    closed: z.number().int(),
    newLast30Days: z.number().int(),
  }),
  subscriptions: z.object({
    trialsEndingIn7Days: z.number().int(),
    lapsed: z.number().int(),
    byPlan: z.array(
      z.object({
        code: z.string(),
        nameEn: z.string(),
        nameAr: z.string(),
        merchants: z.number().int(),
      }),
    ),
  }),
  usage: z.object({
    activeBranches: z.number().int(),
    activeMemberships: z.number().int(),
    salesLast24Hours: z.number().int(),
    onlineOrdersLast24Hours: z.number().int(),
  }),
  recentMerchants: z.array(platformMerchantSchema),
});
export type PlatformOverview = z.infer<typeof platformOverviewSchema>;
