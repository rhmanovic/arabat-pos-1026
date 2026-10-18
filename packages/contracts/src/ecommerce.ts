import { z } from 'zod';
import { moneyAmountSchema, moneySchema } from './catalog.js';
import { quantitySchema } from './inventory.js';
import { optionalId } from './optional-id.js';

/** Online store contracts (Prompt 16). See BUSINESS_RULES.md BR-140…BR-149. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));
const named = { nameEn: z.string().nullable(), nameAr: z.string().nullable() };

export const STORE_STATUSES = ['draft', 'published', 'paused'] as const;
export const ONLINE_ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'expired',
  'payment_failed',
  'cancelled',
  'needs_attention',
] as const;
export type OnlineOrderStatus = (typeof ONLINE_ORDER_STATUSES)[number];
export const FULFILLMENTS = ['pickup', 'delivery'] as const;
export const GATEWAY_STATUSES = [
  'initiated',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
] as const;

// ---------------------------------------------------------------- manager: store settings
/** Paths of the storefront app that cannot be store addresses (`/store/pay/...`, `/store/links/...`). */
export const RESERVED_STORE_SLUGS: readonly string[] = ['pay', 'links', 'assets', 'api', 'admin'];
export const onlineStoreSchema = z.object({
  slug: z.string(),
  status: z.enum(STORE_STATUSES),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  taglineEn: z.string().nullable(),
  taglineAr: z.string().nullable(),
  announcementEn: z.string().nullable(),
  announcementAr: z.string().nullable(),
  primaryColor: z.string(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  fulfillmentBranchId: z.string().nullable(),
  pickupEnabled: z.boolean(),
  deliveryEnabled: z.boolean(),
  deliveryFee: moneySchema,
  minimumOrder: moneySchema,
  reservationMinutes: z.number().int(),
  /** Payment methods available online (`availableOnline` and a gateway provider). */
  paymentMethods: z.array(
    z.object({
      id: z.string(),
      ...named,
      provider: z.string(),
      /** Only the mock gateway processes payments today; others need credentials and approval. */
      ready: z.boolean(),
    }),
  ),
  url: z.string(),
  version: z.number().int(),
});
export type OnlineStore = z.infer<typeof onlineStoreSchema>;
export const saveOnlineStoreSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]{1,40}$/, {
        error: 'Letters, digits and dashes (2–41 characters).',
      })
      .refine((slug) => !RESERVED_STORE_SLUGS.includes(slug), {
        error: 'This address is reserved.',
      }),
    status: z.enum(STORE_STATUSES),
    nameEn: text(80),
    nameAr: text(80),
    taglineEn: text(160),
    taglineAr: text(160),
    announcementEn: text(300),
    announcementAr: text(300),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    contactPhone: text(40),
    contactEmail: z
      .email()
      .nullish()
      .or(z.literal(''))
      .transform((v) => v || null),
    fulfillmentBranchId: optionalId(),
    pickupEnabled: z.boolean(),
    deliveryEnabled: z.boolean(),
    deliveryFee: moneyAmountSchema,
    minimumOrder: moneyAmountSchema,
    reservationMinutes: z.number().int().min(5).max(1440),
    version: z.number().int().nonnegative(),
  })
  .refine((s) => Boolean(s.nameAr || s.nameEn), {
    error: 'A store name is required.',
    path: ['nameAr'],
  })
  .refine((s) => s.status === 'draft' || s.fulfillmentBranchId !== null, {
    error: 'Choose the branch that fulfils online orders.',
    path: ['fulfillmentBranchId'],
  })
  .refine((s) => s.pickupEnabled || s.deliveryEnabled, {
    error: 'Enable pickup or delivery.',
    path: ['pickupEnabled'],
  });
export type SaveOnlineStore = z.input<typeof saveOnlineStoreSchema>;

export const listingSchema = z.object({
  productId: z.string(),
  ...named,
  listed: z.boolean(),
  variants: z.number().int(),
  price: moneySchema.nullable(),
});
export const listingListSchema = z.object({ products: z.array(listingSchema) });
export const saveListingsSchema = z.object({
  productIds: z.array(z.uuid()).max(5000),
  listed: z.boolean(),
});

// ---------------------------------------------------------------- orders (shared shapes)
export const onlineOrderLineSchema = z.object({
  position: z.number().int(),
  variantId: z.string(),
  productId: z.string(),
  ...named,
  variantNameEn: z.string().nullable(),
  variantNameAr: z.string().nullable(),
  sku: z.string().nullable(),
  quantity: z.string(),
  unitPrice: moneySchema,
  lineTotal: moneySchema,
});

export const publicOrderSchema = z.object({
  number: z.string(),
  status: z.enum(ONLINE_ORDER_STATUSES),
  fulfillment: z.enum(FULFILLMENTS),
  customerName: z.string(),
  lines: z.array(onlineOrderLineSchema),
  subtotal: moneySchema,
  deliveryFee: moneySchema,
  total: moneySchema,
  createdAt: z.string(),
  paidAt: z.string().nullable(),
  reservedUntil: z.string(),
  trackingToken: z.string(),
  /** Where to send the customer to pay (while pending payment). */
  paymentUrl: z.string().nullable(),
  timeline: z.array(z.object({ status: z.enum(ONLINE_ORDER_STATUSES), at: z.string() })),
});
export type PublicOrder = z.infer<typeof publicOrderSchema>;

export const onlineOrderSchema = publicOrderSchema.extend({
  id: z.string(),
  branchId: z.string(),
  customerPhone: z.string(),
  customerEmail: z.string().nullable(),
  deliveryAddress: z.string().nullable(),
  note: z.string().nullable(),
  customerId: z.string().nullable(),
  saleId: z.string().nullable(),
  receiptNumber: z.string().nullable(),
  paymentMethod: z.object(named).extend({ provider: z.string() }),
  payments: z.array(
    z.object({
      id: z.string(),
      provider: z.string(),
      providerReference: z.string().nullable(),
      status: z.enum(GATEWAY_STATUSES),
      amount: moneySchema,
      failureReason: z.string().nullable(),
      createdAt: z.string(),
      completedAt: z.string().nullable(),
    }),
  ),
  statusNote: z.string().nullable(),
  version: z.number().int(),
});
export type OnlineOrder = z.infer<typeof onlineOrderSchema>;
export const onlineOrderListSchema = z.object({
  orders: z.array(onlineOrderSchema.omit({ lines: true, payments: true, timeline: true })),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  counts: z.record(z.string(), z.number().int()),
});
export const onlineOrderListQuerySchema = z.object({
  status: z.enum(ONLINE_ORDER_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type OnlineOrderListQuery = z.input<typeof onlineOrderListQuerySchema>;
export const onlineOrderActionSchema = z.object({
  action: z.enum(['preparing', 'ready', 'out_for_delivery', 'completed', 'cancel']),
  note: text(300),
  version: z.number().int().positive(),
});

// ---------------------------------------------------------------- storefront (public)
export const storefrontSchema = z.object({
  slug: z.string(),
  ...named,
  taglineEn: z.string().nullable(),
  taglineAr: z.string().nullable(),
  announcementEn: z.string().nullable(),
  announcementAr: z.string().nullable(),
  primaryColor: z.string(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  /** paused: browsing only, no new orders. */
  acceptingOrders: z.boolean(),
  pickupEnabled: z.boolean(),
  deliveryEnabled: z.boolean(),
  deliveryFee: moneySchema,
  minimumOrder: moneySchema,
  paymentMethods: z.array(z.object({ id: z.string(), ...named, provider: z.string() })),
  categories: z.array(z.object({ id: z.string(), ...named })),
});
export type Storefront = z.infer<typeof storefrontSchema>;

export const storeProductSchema = z.object({
  productId: z.string(),
  ...named,
  descriptionEn: z.string().nullable(),
  descriptionAr: z.string().nullable(),
  categoryId: z.string().nullable(),
  imageUrl: z.string().nullable(),
  variants: z.array(
    z.object({
      variantId: z.string(),
      ...named,
      sku: z.string().nullable(),
      price: moneySchema,
      /** Whether it can be ordered now (stock minus reservations, or untracked). */
      available: z.boolean(),
      /** Upper bound offered in the cart (never the exact stock). */
      maxQuantity: z.number().int(),
    }),
  ),
});
export type StoreProduct = z.infer<typeof storeProductSchema>;
export const storeProductListSchema = z.object({ products: z.array(storeProductSchema) });

export const storeCheckoutSchema = z
  .object({
    idempotencyKey: z.uuid(),
    lines: z
      .array(z.object({ variantId: z.uuid(), quantity: quantitySchema }))
      .min(1)
      .max(50),
    fulfillment: z.enum(FULFILLMENTS),
    customer: z.object({
      name: z.string().trim().min(1).max(120),
      phone: z.string().trim().min(6).max(30),
      email: z
        .email()
        .nullish()
        .or(z.literal(''))
        .transform((v) => v || null),
    }),
    deliveryAddress: text(300),
    note: text(300),
    paymentMethodId: z.uuid(),
    /** The total the customer saw; refused if prices changed. */
    expectedTotal: moneyAmountSchema,
  })
  .refine((c) => c.fulfillment !== 'delivery' || c.deliveryAddress !== null, {
    error: 'Enter the delivery address.',
    path: ['deliveryAddress'],
  });
export type StoreCheckout = z.input<typeof storeCheckoutSchema>;
export const storeCheckoutResultSchema = z.object({ order: publicOrderSchema });

// ---------------------------------------------------------------- mock gateway (test only)
export const mockPaymentSchema = z.object({
  paymentId: z.string(),
  merchantName: z.string(),
  orderNumber: z.string(),
  amount: moneySchema,
  status: z.enum(GATEWAY_STATUSES),
  returnUrl: z.string(),
});
export type MockPayment = z.infer<typeof mockPaymentSchema>;
export const mockPaymentOutcomeSchema = z.object({
  outcome: z.enum(['succeeded', 'failed', 'cancelled']),
});
