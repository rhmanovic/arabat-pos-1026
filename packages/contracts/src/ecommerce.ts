import { z } from 'zod';
import { moneyAmountSchema, moneySchema } from './catalog.js';
import { quantitySchema } from './inventory.js';
import { optionalId } from './optional-id.js';
import { paymentInputSchema } from './sales.js';

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
  'placed',
  'confirmed',
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
/** gateway: paid online before fulfilment · on_receipt: collected on hand-over (ADR-0118). */
export const PAYMENT_MODES = ['gateway', 'on_receipt'] as const;
export type OnlinePaymentMode = (typeof PAYMENT_MODES)[number];
export const GATEWAY_STATUSES = [
  'initiated',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
] as const;

// ---------------------------------------------------------------- manager: store settings
/**
 * Store addresses that cannot be chosen: paths of the storefront app (`/store/pay/...`,
 * `/store/links/...`), the platform's own apps and words kept for later use.
 */
export const RESERVED_STORE_SLUGS: readonly string[] = [
  'pay',
  'links',
  'assets',
  'api',
  'admin',
  'store',
  'manager',
  'pos',
  'platform',
  'device',
  'online',
  'start',
  'pricing',
  'www',
  'mail',
  'app',
  'apps',
  'help',
  'support',
  'arabat',
  // Host names of the platform's own DNS zone (stores answer at `{slug}.arabatapp.com`, ADR-0136).
  'stores',
  'send',
  'rsend',
  'smtp',
  'ftp',
  'cdn',
  'static',
  'status',
  'docs',
  'blog',
  'dev',
  'staging',
  'ns1',
  'ns2',
];
export const STORE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,40}$/;
/**
 * Whether a store address can be its own sub-domain (ADR-0136): a valid DNS label (no dash at
 * the end, no `xx--` prefix kept for encoded names) that is not reserved. Others keep the
 * `/store/{slug}` address.
 */
export const isStoreSubdomain = (slug: string): boolean =>
  /^[a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?$/.test(slug) &&
  slug.slice(2, 4) !== '--' &&
  !RESERVED_STORE_SLUGS.includes(slug);
// ---------------------------------------------------------------- hours and slots (ADR-0123)
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
/** HH:MM; 24:00 is allowed as a closing time (open until midnight). */
const clock = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, { error: 'Use HH:MM.' });
export const hoursRangeSchema = z
  .object({ open: clock, close: clock })
  .refine((r) => r.close > r.open, { error: 'Closing time must be after opening time.' });
/** Opening hours per weekday; an empty list = closed that day. Null = always open. */
const dayRanges = z.array(hoursRangeSchema).max(4);
export const hoursSchema = z
  .object({
    mon: dayRanges,
    tue: dayRanges,
    wed: dayRanges,
    thu: dayRanges,
    fri: dayRanges,
    sat: dayRanges,
    sun: dayRanges,
  })
  .nullable();
export type StoreHours = z.infer<typeof hoursSchema>;

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
  /** Shoppers may order without paying online and pay on hand-over (ADR-0118). */
  payOnReceiptEnabled: z.boolean(),
  /** Store logo and banner (ADR-0121), served by the API; null when not uploaded. */
  logoUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  /** Leave products with nothing available out of the storefront. */
  hideOutOfStock: z.boolean(),
  /** Opening hours (null = always open), time slots and merchant e-mails (ADR-0123). */
  hours: hoursSchema,
  schedulingEnabled: z.boolean(),
  slotMinutes: z.number().int(),
  slotCapacity: z.number().int().nullable(),
  notifyEmail: z.boolean(),
  /** Shoppers may create an account and sign in (ADR-0124); guests still order. */
  accountsEnabled: z.boolean(),
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
      .regex(STORE_SLUG_PATTERN, {
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
    payOnReceiptEnabled: z.boolean().default(true),
    hideOutOfStock: z.boolean().default(false),
    hours: hoursSchema.default(null),
    schedulingEnabled: z.boolean().default(false),
    slotMinutes: z.number().int().min(15).max(240).default(30),
    slotCapacity: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .nullish()
      .transform((v) => v ?? null),
    notifyEmail: z.boolean().default(true),
    accountsEnabled: z.boolean().default(true),
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

/** `GET /manager/online/slug-availability?slug=`: can this merchant take the address? */
export const slugAvailabilityQuerySchema = z.object({
  slug: z.string().trim().toLowerCase().max(80),
});
export const slugAvailabilitySchema = z.object({
  slug: z.string(),
  available: z.boolean(),
  /** Why not: invalid format, reserved word, taken by another store or link page, or renamed too recently. */
  reason: z.enum(['invalid', 'reserved', 'taken', 'rename_limit']).nullable(),
  /** Free alternatives when the address is not available. */
  suggestions: z.array(z.string()),
});
export type SlugAvailability = z.infer<typeof slugAvailabilitySchema>;

/** Tenders staff may record for a pay-on-receipt order (active POS methods without a gateway). */
export const onlineTenderListSchema = z.object({
  tenders: z.array(
    z.object({
      id: z.string(),
      ...named,
      kind: z.string(),
      /** Non-cash tenders need a reference when the company requires one (BR-181). */
      requiresReference: z.boolean(),
    }),
  ),
});

/** Store image limits (logo, banner, category, collection): same as link-page pictures. */
export const MAX_STORE_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * The shared catalog category as the store shows it (ADR-0130): one category tree for the point
 * of sale and the store; the store keeps whether it is shown, its order, an optional store name
 * and a picture.
 */
export const storeCategorySchema = z.object({
  id: z.string(),
  /** The shared name (point of sale and store). */
  ...named,
  parentId: z.string().nullable(),
  /** The store's own name; null = the shared name. */
  onlineNameEn: z.string().nullable(),
  onlineNameAr: z.string().nullable(),
  /** Shown in the store's navigation. */
  visible: z.boolean(),
  position: z.number().int(),
  imageUrl: z.string().nullable(),
  /** Active products in this category. */
  productCount: z.number().int(),
  version: z.number().int(),
});
export type StoreCategory = z.infer<typeof storeCategorySchema>;
export const storeCategoryListSchema = z.object({
  categories: z.array(storeCategorySchema),
  /** Active products without a category: shoppers find them only in "All products". */
  uncategorized: z.number().int(),
});
export type StoreCategoryList = z.infer<typeof storeCategoryListSchema>;
/**
 * `POST|PUT /manager/online/categories`: the shared name needs `catalog.manage` (it changes the
 * point of sale too); the store settings need `online.manage`.
 */
export const saveStoreCategorySchema = z
  .object({
    nameEn: text(80),
    nameAr: text(80),
    onlineNameEn: text(80),
    onlineNameAr: text(80),
    visible: z.boolean().default(true),
    version: z.number().int().positive().optional(),
  })
  .refine((c) => Boolean(c.nameAr || c.nameEn), {
    error: 'A category name is required.',
    path: ['nameAr'],
  });
export type SaveStoreCategory = z.input<typeof saveStoreCategorySchema>;
export const storeCategoryOrderSchema = z.object({ ids: z.array(z.uuid()).max(1000) });

/** Marketing collections of the store (ADR-0130): "Offers", "New in"…; a product may be in several. */
export const ONLINE_COLLECTION_STATUSES = ['active', 'hidden'] as const;
export const onlineCollectionSchema = z.object({
  id: z.string(),
  ...named,
  position: z.number().int(),
  status: z.enum(ONLINE_COLLECTION_STATUSES),
  imageUrl: z.string().nullable(),
  /** Products in this collection, in the collection's order. */
  productIds: z.array(z.string()),
  version: z.number().int(),
});
export type OnlineCollection = z.infer<typeof onlineCollectionSchema>;
export const onlineCollectionListSchema = z.object({
  collections: z.array(onlineCollectionSchema),
});
export const saveOnlineCollectionSchema = z
  .object({
    nameEn: text(80),
    nameAr: text(80),
    status: z.enum(ONLINE_COLLECTION_STATUSES).default('active'),
    /** When given, the collection's products in this order (replaces the previous list). */
    productIds: z.array(z.uuid()).max(5000).optional(),
    version: z.number().int().positive().optional(),
  })
  .refine((c) => Boolean(c.nameAr || c.nameEn), {
    error: 'A collection name is required.',
    path: ['nameAr'],
  });
export type SaveOnlineCollection = z.input<typeof saveOnlineCollectionSchema>;
export const onlineCollectionOrderSchema = z.object({ ids: z.array(z.uuid()).max(500) });

export const listingSchema = z.object({
  productId: z.string(),
  ...named,
  /** Shown to shoppers on the website (the store console's switch, ADR-0130). */
  visible: z.boolean(),
  /** Offered at the point of sale (changed in the point-of-sale management only). */
  posVisible: z.boolean(),
  variants: z.number().int(),
  price: moneySchema.nullable(),
  trackInventory: z.boolean(),
  /** Display order in the store. */
  position: z.number().int(),
  /** What the store says on top of the catalog (ADR-0121); null = the catalog's text. */
  titleEn: z.string().nullable(),
  titleAr: z.string().nullable(),
  descriptionEn: z.string().nullable(),
  descriptionAr: z.string().nullable(),
  featured: z.boolean(),
  /** Units of one variant per order; null = the store default (20). */
  maxPerOrder: z.number().int().nullable(),
  /** The shared catalog category (ADR-0130). */
  category: z.object({ id: z.string(), ...named }).nullable(),
  collectionIds: z.array(z.string()),
  /** Catalog images (managed in the catalog), served by the API. */
  images: z.array(z.object({ id: z.string(), url: z.string() })),
});
export type Listing = z.infer<typeof listingSchema>;
export const listingListSchema = z.object({ products: z.array(listingSchema) });
/** `PUT /manager/online/listings`: bulk actions on selected products. */
export const saveListingsSchema = z
  .object({
    productIds: z.array(z.uuid()).max(5000),
    /** Show on or hide from the website. */
    visible: z.boolean().optional(),
    /** Put the products in this shared category (null = none); needs `catalog.manage`. */
    categoryId: z.uuid().nullable().optional(),
    /** Add the products to this collection. */
    addToCollectionId: z.uuid().optional(),
  })
  .refine(
    (b) =>
      b.visible !== undefined || b.categoryId !== undefined || b.addToCollectionId !== undefined,
    { error: 'Choose an action.', path: ['productIds'] },
  );
export type SaveListings = z.input<typeof saveListingsSchema>;
/** `PUT /manager/online/listings/:productId`: the store's own text and options for one product. */
export const saveListingSchema = z.object({
  titleEn: text(120),
  titleAr: text(120),
  descriptionEn: text(2000),
  descriptionAr: text(2000),
  featured: z.boolean(),
  maxPerOrder: z.number().int().min(1).max(20).nullable(),
  visible: z.boolean().optional(),
  /** The shared category; a change needs `catalog.manage`. Omitted = unchanged. */
  categoryId: z.uuid().nullable().optional(),
  collectionIds: z.array(z.uuid()).max(100).optional(),
});
export type SaveListing = z.input<typeof saveListingSchema>;
/** `PUT /manager/online/listings/order`: every active product exactly once, in display order. */
export const listingOrderSchema = z.object({ productIds: z.array(z.uuid()).max(5000) });

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
  /** Order discount of the applied promotion (ADR-0125); zero without one. */
  discount: moneySchema,
  promotion: z.object({ code: z.string().nullable(), name: z.string() }).nullable(),
  deliveryFee: moneySchema,
  total: moneySchema,
  createdAt: z.string(),
  paymentMode: z.enum(PAYMENT_MODES),
  paidAt: z.string().nullable(),
  /** Gateway orders only: when the stock reservation ends. */
  reservedUntil: z.string().nullable(),
  trackingToken: z.string(),
  /** Where to send the customer to pay (while pending payment). */
  paymentUrl: z.string().nullable(),
  /** Requested slot start (ADR-0123); null = as soon as possible. */
  scheduledFor: z.string().nullable(),
  /** The area's name as it was at checkout (kept if the area is deleted). */
  deliveryAreaName: z.string().nullable(),
  /** The area's current names while it exists (for the visitor's language). */
  deliveryArea: z.object(named).nullable(),
  /** The branch that prepares the order (pickup address for the shopper). */
  branch: z.object({ ...named, address: z.string().nullable(), phone: z.string().nullable() }),
  timeline: z.array(z.object({ status: z.enum(ONLINE_ORDER_STATUSES), at: z.string() })),
});
export type PublicOrder = z.infer<typeof publicOrderSchema>;

export const onlineOrderSchema = publicOrderSchema.extend({
  id: z.string(),
  branchId: z.string(),
  customerPhone: z.string(),
  customerEmail: z.string().nullable(),
  deliveryAddress: z.string().nullable(),
  deliveryAreaId: z.string().nullable(),
  note: z.string().nullable(),
  customerId: z.string().nullable(),
  saleId: z.string().nullable(),
  receiptNumber: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  /** Null for a pay-on-receipt order whose payment is not recorded yet. */
  paymentMethod: z.object(named).extend({ provider: z.string() }).nullable(),
  /** Reference of the tender recorded by staff (pay on receipt). */
  paymentReference: z.string().nullable(),
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
export const ONLINE_ORDER_ACTIONS = [
  'confirm',
  'mark_paid',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'cancel',
] as const;
export type OnlineOrderAction = (typeof ONLINE_ORDER_ACTIONS)[number];
export const onlineOrderActionSchema = z
  .object({
    action: z.enum(ONLINE_ORDER_ACTIONS),
    note: text(300),
    /** `mark_paid`: the tender the money was received with. */
    paymentMethodId: z.uuid().nullish(),
    /** `mark_paid`: reference of a non-cash tender. */
    reference: text(80),
    version: z.number().int().positive(),
  })
  .refine((a) => a.action !== 'mark_paid' || Boolean(a.paymentMethodId), {
    error: 'Choose the payment method.',
    path: ['paymentMethodId'],
  });
export type OnlineOrderActionInput = z.input<typeof onlineOrderActionSchema>;

// ---------------------------------------------------------------- delivery areas and branches (ADR-0123)
export const onlineDeliveryAreaSchema = z.object({
  id: z.string(),
  ...named,
  fee: moneySchema,
  minimumOrder: moneySchema,
  /** Orders at or above this amount are delivered free; null = never. */
  freeDeliveryFrom: moneySchema.nullable(),
  estimatedMinutes: z.number().int().nullable(),
  /** Serving branch; null = the store's fulfilment branch. */
  branchId: z.string().nullable(),
  position: z.number().int(),
  active: z.boolean(),
  version: z.number().int(),
});
export type OnlineDeliveryArea = z.infer<typeof onlineDeliveryAreaSchema>;
export const onlineDeliveryAreaListSchema = z.object({
  areas: z.array(onlineDeliveryAreaSchema),
});
export const saveOnlineDeliveryAreaSchema = z
  .object({
    nameEn: text(80),
    nameAr: text(80),
    fee: moneyAmountSchema,
    minimumOrder: moneyAmountSchema.default('0.000'),
    freeDeliveryFrom: moneyAmountSchema.nullish().transform((v) => v ?? null),
    estimatedMinutes: z
      .number()
      .int()
      .min(1)
      .max(1440)
      .nullish()
      .transform((v) => v ?? null),
    branchId: optionalId(),
    active: z.boolean().default(true),
    version: z.number().int().positive().optional(),
  })
  .refine((a) => Boolean(a.nameAr || a.nameEn), {
    error: 'An area name is required.',
    path: ['nameAr'],
  });
export type SaveOnlineDeliveryArea = z.input<typeof saveOnlineDeliveryAreaSchema>;
export const onlineDeliveryAreaOrderSchema = z.object({ ids: z.array(z.uuid()).max(500) });

export const onlineStoreBranchSchema = z.object({
  branchId: z.string(),
  ...named,
  address: z.string().nullable(),
  phone: z.string().nullable(),
  pickupEnabled: z.boolean(),
  deliveryEnabled: z.boolean(),
  preparationMinutes: z.number().int(),
  /** Null = the store's hours. */
  hours: hoursSchema,
  position: z.number().int(),
  active: z.boolean(),
  version: z.number().int(),
});
export type OnlineStoreBranch = z.infer<typeof onlineStoreBranchSchema>;
export const onlineStoreBranchListSchema = z.object({
  branches: z.array(onlineStoreBranchSchema),
});
export const saveOnlineStoreBranchSchema = z
  .object({
    pickupEnabled: z.boolean().default(true),
    deliveryEnabled: z.boolean().default(false),
    preparationMinutes: z.number().int().min(0).max(1440).default(30),
    hours: hoursSchema.default(null),
    active: z.boolean().default(true),
    version: z.number().int().positive().optional(),
  })
  .refine((b) => b.pickupEnabled || b.deliveryEnabled, {
    error: 'Enable pickup or delivery.',
    path: ['pickupEnabled'],
  });
export type SaveOnlineStoreBranch = z.input<typeof saveOnlineStoreBranchSchema>;
export const onlineStoreBranchOrderSchema = z.object({ branchIds: z.array(z.uuid()).max(200) });

// ---------------------------------------------------------------- POS hand-over (ADR-0123)
export const posOnlineOrderSchema = z.object({
  id: z.string(),
  number: z.string(),
  status: z.enum(ONLINE_ORDER_STATUSES),
  fulfillment: z.enum(FULFILLMENTS),
  paymentMode: z.enum(PAYMENT_MODES),
  customerName: z.string(),
  customerPhone: z.string(),
  total: moneySchema,
  /** Set once the money was received (gateway, console or till). */
  paid: z.boolean(),
  scheduledFor: z.string().nullable(),
  createdAt: z.string(),
  lines: z.array(onlineOrderLineSchema),
  note: z.string().nullable(),
  version: z.number().int(),
});
export type PosOnlineOrder = z.infer<typeof posOnlineOrderSchema>;
export const posOnlineOrderListSchema = z.object({ orders: z.array(posOnlineOrderSchema) });
export const posOnlineOrderPaySchema = z.object({
  idempotencyKey: z.uuid(),
  payments: z.array(paymentInputSchema).min(1).max(10),
  /** The total shown to the cashier; refused if the order changed meanwhile. */
  expectedTotal: moneyAmountSchema,
  version: z.number().int().positive(),
});
export type PosOnlineOrderPay = z.input<typeof posOnlineOrderPaySchema>;
export const posOnlineOrderCompleteSchema = z.object({ version: z.number().int().positive() });

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
  /** Orders may be placed without paying online (collected on pickup / delivery). */
  payOnReceipt: z.boolean(),
  logoUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  /** The shared catalog categories shown in the store, in the store's order (ADR-0130). */
  categories: z.array(
    z.object({
      id: z.string(),
      ...named,
      parentId: z.string().nullable(),
      imageUrl: z.string().nullable(),
    }),
  ),
  /** Active collections that hold products shown on the website. */
  collections: z.array(z.object({ id: z.string(), ...named, imageUrl: z.string().nullable() })),
  /** Branches serving the store (ADR-0123); one entry = the single fulfilment branch. */
  branches: z.array(
    z.object({
      id: z.string(),
      ...named,
      address: z.string().nullable(),
      phone: z.string().nullable(),
      pickupEnabled: z.boolean(),
      deliveryEnabled: z.boolean(),
      preparationMinutes: z.number().int(),
      hours: hoursSchema,
      /** Open right now by its hours (always true without hours). */
      openNow: z.boolean(),
    }),
  ),
  /** Products, stock and prices come from this branch unless the shopper picks another. */
  defaultBranchId: z.string(),
  /** Delivery areas to pick from (ADR-0123); empty = the flat `deliveryFee` applies. */
  deliveryAreas: z.array(
    z.object({
      id: z.string(),
      ...named,
      fee: moneySchema,
      minimumOrder: moneySchema,
      freeDeliveryFrom: moneySchema.nullable(),
      estimatedMinutes: z.number().int().nullable(),
      branchId: z.string(),
    }),
  ),
  scheduling: z.object({ enabled: z.boolean(), slotMinutes: z.number().int() }),
  timezone: z.string(),
  /** Shoppers may sign in (ADR-0124). */
  accountsEnabled: z.boolean(),
});
export type Storefront = z.infer<typeof storefrontSchema>;
export const storeSlotListSchema = z.object({
  slots: z.array(z.object({ start: z.string(), end: z.string(), available: z.boolean() })),
});
export type StoreSlotList = z.infer<typeof storeSlotListSchema>;

export const storeProductSchema = z.object({
  productId: z.string(),
  /** The store's title when set, else the catalog name (same for the description). */
  ...named,
  descriptionEn: z.string().nullable(),
  descriptionAr: z.string().nullable(),
  /** Id in the storefront's `categories`; null = none shown. */
  categoryId: z.string().nullable(),
  /** Ids in the storefront's `collections`. */
  collectionIds: z.array(z.string()),
  imageUrl: z.string().nullable(),
  /** Every catalog image, first one = `imageUrl`. */
  images: z.array(z.string()),
  featured: z.boolean(),
  position: z.number().int(),
  variants: z.array(
    z.object({
      variantId: z.string(),
      ...named,
      sku: z.string().nullable(),
      /** The price now: the discounted one while a product discount is in force (ADR-0133). */
      price: moneySchema,
      /** The price before the discount, only while one is in force (shown struck through). */
      regularPrice: moneySchema.nullable().default(null),
      /** When the discount in force ends, if it has an end. */
      discountEndsAt: z.string().nullable().default(null),
      /** Whether it can be ordered now (stock minus reservations, or untracked). */
      available: z.boolean(),
      /** Upper bound offered in the cart (never the exact stock). */
      maxQuantity: z.number().int(),
      /**
       * Units left, only when at or under the store's "only N left" setting (ADR-0128
       * amendment 4); null otherwise, so the stock stays private unless the merchant shows it.
       */
      fewLeft: z.number().int().nullable().default(null),
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
    /** The branch that prepares the order (ADR-0123); null = the store's default branch. */
    branchId: optionalId(),
    /** Required when the store defines delivery areas and the order is delivered. */
    deliveryAreaId: optionalId(),
    /** Requested slot start (ISO 8601); null = as soon as possible. */
    scheduledFor: z.iso
      .datetime({ offset: true })
      .nullish()
      .transform((v) => v ?? null),
    note: text(300),
    /** A promotion code entered by the shopper (ADR-0125); automatic offers need none. */
    promotionCode: z
      .string()
      .trim()
      .toUpperCase()
      .max(20)
      .nullish()
      .transform((v) => v || null),
    /** Signed-in shoppers: keep the delivery address on the account (ADR-0124). */
    saveAddress: z.boolean().default(false),
    /** An online method, or null to pay on receipt (when the store allows it). */
    paymentMethodId: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    /** The total the customer saw; refused if prices changed. */
    expectedTotal: moneyAmountSchema,
  })
  .refine((c) => c.fulfillment !== 'delivery' || c.deliveryAddress !== null, {
    error: 'Enter the delivery address.',
    path: ['deliveryAddress'],
  });
export type StoreCheckout = z.input<typeof storeCheckoutSchema>;
export const storeCheckoutResultSchema = z.object({ order: publicOrderSchema });

// ---------------------------------------------------------------- quote (ADR-0125)
export const storeQuoteSchema = z.object({
  lines: z
    .array(z.object({ variantId: z.uuid(), quantity: quantitySchema }))
    .min(1)
    .max(50),
  fulfillment: z.enum(FULFILLMENTS),
  deliveryAreaId: optionalId(),
  branchId: optionalId(),
  promotionCode: z
    .string()
    .trim()
    .toUpperCase()
    .max(20)
    .nullish()
    .transform((v) => v || null),
});
export type StoreQuote = z.input<typeof storeQuoteSchema>;
export const storeQuoteResultSchema = z.object({
  subtotal: moneySchema,
  discount: moneySchema,
  deliveryFee: moneySchema,
  total: moneySchema,
  /** The promotion applied (a code, or the best automatic offer), or none. */
  promotion: z.object({ code: z.string().nullable(), ...named }).nullable(),
  /** Why the entered code was not applied, if it was not. */
  codeIssue: z
    .enum([
      'unknown',
      'inactive',
      'expired',
      'not_started',
      'minimum',
      'used_up',
      'customer_limit',
      'no_match',
    ])
    .nullable(),
});
export type StoreQuoteResult = z.infer<typeof storeQuoteResultSchema>;

// ---------------------------------------------------------------- shopper accounts (ADR-0124)
const passwordSchema = z.string().min(8).max(100);
export const customerAccountSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  phone: z.string(),
  email: z.string(),
  createdAt: z.string(),
});
export type CustomerAccount = z.infer<typeof customerAccountSchema>;
export const customerAddressSchema = z.object({
  id: z.string(),
  label: z.string().nullable(),
  deliveryAreaId: z.string().nullable(),
  address: z.string(),
  isDefault: z.boolean(),
});
export type CustomerAddress = z.infer<typeof customerAddressSchema>;
export const accountViewSchema = z.object({
  account: customerAccountSchema,
  addresses: z.array(customerAddressSchema),
});
export type AccountView = z.infer<typeof accountViewSchema>;
export const accountSessionSchema = z.object({ token: z.string(), account: customerAccountSchema });
export type AccountSession = z.infer<typeof accountSessionSchema>;
export const accountRegisterSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(6).max(30),
  email: z.email().trim().toLowerCase().max(254),
  password: passwordSchema,
});
export type AccountRegister = z.input<typeof accountRegisterSchema>;
export const accountLoginSchema = z.object({
  email: z.email().trim().toLowerCase().max(254),
  password: z.string().min(1).max(100),
});
export type AccountLogin = z.input<typeof accountLoginSchema>;
export const accountUpdateSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(6).max(30),
});
export type AccountUpdate = z.input<typeof accountUpdateSchema>;
export const accountPasswordSchema = z.object({
  current: z.string().min(1).max(100),
  next: passwordSchema,
});
export type AccountPassword = z.input<typeof accountPasswordSchema>;
export const accountForgotSchema = z.object({ email: z.email().trim().toLowerCase().max(254) });
export const accountResetSchema = z.object({
  token: z.string().min(10).max(200),
  password: passwordSchema,
});
export type AccountReset = z.input<typeof accountResetSchema>;
export const saveCustomerAddressSchema = z.object({
  label: text(40),
  deliveryAreaId: optionalId(),
  address: z.string().trim().min(1).max(300),
  isDefault: z.boolean().default(false),
});
export type SaveCustomerAddress = z.input<typeof saveCustomerAddressSchema>;
export const accountOrderListSchema = z.object({
  orders: z.array(
    publicOrderSchema.omit({ lines: true, timeline: true }).extend({ lineCount: z.number().int() }),
  ),
});
export type AccountOrderList = z.infer<typeof accountOrderListSchema>;

// ---------------------------------------------------------------- promotions (ADR-0125, manager)
export const PROMOTION_KINDS = ['code', 'automatic'] as const;
export const PROMOTION_TYPES = ['percentage', 'fixed', 'free_delivery'] as const;
export const PROMOTION_TARGETS = ['order', 'category', 'product'] as const;
export const onlinePromotionSchema = z.object({
  id: z.string(),
  ...named,
  kind: z.enum(PROMOTION_KINDS),
  code: z.string().nullable(),
  discountType: z.enum(PROMOTION_TYPES),
  percent: z.string().nullable(),
  amount: moneySchema.nullable(),
  minimumOrder: moneySchema,
  maxUses: z.number().int().nullable(),
  usesCount: z.number().int(),
  maxUsesPerCustomer: z.number().int().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  status: z.enum(['active', 'paused']),
  appliesTo: z.enum(PROMOTION_TARGETS),
  targetIds: z.array(z.string()),
  /** Also discounts items already lowered by a product discount (ADR-0133); off by default. */
  stacksWithDiscounts: z.boolean(),
  position: z.number().int(),
  version: z.number().int(),
});
export type OnlinePromotion = z.infer<typeof onlinePromotionSchema>;
export const onlinePromotionListSchema = z.object({ promotions: z.array(onlinePromotionSchema) });
export const saveOnlinePromotionSchema = z
  .object({
    nameEn: text(80),
    nameAr: text(80),
    kind: z.enum(PROMOTION_KINDS).default('code'),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{3,20}$/, { error: 'Letters and digits, 3–20 characters.' })
      .nullish()
      .transform((v) => v || null),
    discountType: z.enum(PROMOTION_TYPES),
    percent: z
      .string()
      .regex(/^\d{1,3}(\.\d{1,2})?$/)
      .nullish()
      .transform((v) => v || null),
    amount: moneyAmountSchema.nullish().transform((v) => v || null),
    minimumOrder: moneyAmountSchema.default('0.000'),
    maxUses: z
      .number()
      .int()
      .min(1)
      .nullish()
      .transform((v) => v ?? null),
    maxUsesPerCustomer: z
      .number()
      .int()
      .min(1)
      .nullish()
      .transform((v) => v ?? null),
    startsAt: z.iso
      .datetime({ offset: true })
      .nullish()
      .transform((v) => v ?? null),
    endsAt: z.iso
      .datetime({ offset: true })
      .nullish()
      .transform((v) => v ?? null),
    status: z.enum(['active', 'paused']).default('active'),
    appliesTo: z.enum(PROMOTION_TARGETS).default('order'),
    targetIds: z.array(z.uuid()).max(200).default([]),
    stacksWithDiscounts: z.boolean().default(false),
    version: z.number().int().positive().optional(),
  })
  .refine((p) => Boolean(p.nameAr || p.nameEn), { error: 'A name is required.', path: ['nameAr'] })
  .refine((p) => p.kind !== 'code' || p.code !== null, { error: 'Enter the code.', path: ['code'] })
  .refine(
    (p) =>
      p.discountType !== 'percentage' ||
      (p.percent !== null && Number(p.percent) > 0 && Number(p.percent) <= 100),
    {
      error: 'Enter a percentage between 0 and 100.',
      path: ['percent'],
    },
  )
  .refine((p) => p.discountType !== 'fixed' || (p.amount !== null && Number(p.amount) > 0), {
    error: 'Enter the discount amount.',
    path: ['amount'],
  })
  .refine((p) => p.appliesTo === 'order' || p.targetIds.length > 0, {
    error: 'Choose at least one category or product.',
    path: ['targetIds'],
  });
export type SaveOnlinePromotion = z.input<typeof saveOnlinePromotionSchema>;
export const onlinePromotionOrderSchema = z.object({ ids: z.array(z.uuid()).max(500) });

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
