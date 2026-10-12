import { z } from 'zod';
import { moneyAmountSchema, moneySchema } from './catalog.js';
import { quantitySchema } from './inventory.js';
import { discountInputSchema, paymentInputSchema, saleSchema } from './sales.js';

/** Restaurant module contracts (Prompt 15). See BUSINESS_RULES.md BR-130…BR-139. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === '' ? null : v));
const status = z.enum(['active', 'inactive']);
const named = { nameEn: z.string().nullable(), nameAr: z.string().nullable() };
const nameInput = { nameEn: text(80), nameAr: text(80) };
const nameRequired = (v: { nameEn?: string | null; nameAr?: string | null }) =>
  Boolean(v.nameAr || v.nameEn);
const version = z.number().int().positive();

export const ORDER_TYPES = ['dine_in', 'takeaway', 'pickup'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];
export const KITCHEN_STATUSES = [
  'pending',
  'queued',
  'preparing',
  'ready',
  'served',
  'cancelled',
] as const;
export type KitchenStatus = (typeof KITCHEN_STATUSES)[number];

// ---------------------------------------------------------------- settings & configuration
export const restaurantSettingsSchema = z.object({
  enabled: z.boolean(),
  autoSendOnPayment: z.boolean(),
  version: z.number().int(),
});
export type RestaurantSettings = z.infer<typeof restaurantSettingsSchema>;
export const updateRestaurantSettingsSchema = z.object({
  enabled: z.boolean(),
  autoSendOnPayment: z.boolean(),
  version: z.number().int().nonnegative(),
});

export const diningAreaSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  ...named,
  position: z.number().int(),
  status,
  version: z.number().int(),
});
export type DiningArea = z.infer<typeof diningAreaSchema>;
export const saveDiningAreaSchema = z
  .object({
    branchId: z.uuid(),
    ...nameInput,
    position: z.number().int().min(0).default(0),
    status: status.default('active'),
    version: version.optional(),
  })
  .refine(nameRequired, { error: 'A name is required.', path: ['nameAr'] });

export const diningTableSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  areaId: z.string(),
  code: z.string(),
  seats: z.number().int(),
  position: z.number().int(),
  status,
  version: z.number().int(),
});
export type DiningTable = z.infer<typeof diningTableSchema>;
export const saveDiningTableSchema = z.object({
  areaId: z.uuid(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{0,9}$/, { error: 'Code: letters, digits or - (max 10).' }),
  seats: z.number().int().min(1).max(100).default(4),
  position: z.number().int().min(0).default(0),
  status: status.default('active'),
  version: version.optional(),
});

export const kitchenStationSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  ...named,
  isDefault: z.boolean(),
  status,
  categoryIds: z.array(z.string()),
  version: z.number().int(),
});
export type KitchenStation = z.infer<typeof kitchenStationSchema>;
export const saveKitchenStationSchema = z
  .object({
    branchId: z.uuid(),
    ...nameInput,
    isDefault: z.boolean().default(false),
    status: status.default('active'),
    categoryIds: z.array(z.uuid()).max(200).default([]),
    version: version.optional(),
  })
  .refine(nameRequired, { error: 'A name is required.', path: ['nameAr'] });

export const branchLayoutSchema = z.object({
  areas: z.array(diningAreaSchema),
  tables: z.array(diningTableSchema),
  stations: z.array(kitchenStationSchema),
});
export type BranchLayout = z.infer<typeof branchLayoutSchema>;

export const modifierSchema = z.object({
  id: z.string(),
  ...named,
  price: moneySchema,
  position: z.number().int(),
  status,
  componentVariantId: z.string().nullable(),
  componentQuantity: z.string().nullable(),
});
export type Modifier = z.infer<typeof modifierSchema>;
export const modifierGroupSchema = z.object({
  id: z.string(),
  ...named,
  minSelect: z.number().int(),
  maxSelect: z.number().int(),
  status,
  modifiers: z.array(modifierSchema),
  version: z.number().int(),
});
export type ModifierGroup = z.infer<typeof modifierGroupSchema>;
export const saveModifierGroupSchema = z
  .object({
    ...nameInput,
    minSelect: z.number().int().min(0).max(50).default(0),
    maxSelect: z.number().int().min(1).max(50).default(1),
    status: status.default('active'),
    modifiers: z
      .array(
        z
          .object({
            id: z.uuid().optional(),
            ...nameInput,
            price: moneyAmountSchema.default('0'),
            status: status.default('active'),
            componentVariantId: z
              .uuid()
              .nullish()
              .transform((v) => v ?? null),
            componentQuantity: quantitySchema.nullish().transform((v) => v ?? null),
          })
          .refine(nameRequired, { error: 'A name is required.', path: ['nameAr'] })
          .refine((m) => (m.componentVariantId === null) === (m.componentQuantity === null), {
            error: 'Choose the ingredient and its quantity together.',
            path: ['componentQuantity'],
          }),
      )
      .min(1)
      .max(100),
    version: version.optional(),
  })
  .refine(nameRequired, { error: 'A name is required.', path: ['nameAr'] })
  .refine((g) => g.minSelect <= g.maxSelect, {
    error: 'Minimum cannot exceed maximum.',
    path: ['minSelect'],
  });
export type SaveModifierGroup = z.input<typeof saveModifierGroupSchema>;

export const menuItemSchema = z.object({
  productId: z.string(),
  ...named,
  categoryId: z.string().nullable(),
  trackInventory: z.boolean(),
  modifierGroupIds: z.array(z.string()),
  variants: z.array(
    z.object({
      id: z.string(),
      ...named,
      sku: z.string().nullable(),
      price: moneySchema,
      recipe: z.array(
        z.object({
          componentVariantId: z.string(),
          componentName: z.string(),
          quantity: z.string(),
        }),
      ),
    }),
  ),
});
export type MenuItem = z.infer<typeof menuItemSchema>;
export const menuListSchema = z.object({
  items: z.array(menuItemSchema),
  groups: z.array(modifierGroupSchema),
});
export const saveMenuItemSchema = z.object({
  modifierGroupIds: z.array(z.uuid()).max(20),
  recipes: z
    .array(
      z.object({
        variantId: z.uuid(),
        components: z
          .array(z.object({ componentVariantId: z.uuid(), quantity: quantitySchema }))
          .max(50),
      }),
    )
    .max(50),
});
export type SaveMenuItem = z.input<typeof saveMenuItemSchema>;

// ---------------------------------------------------------------- POS
export const posMenuSchema = z.object({
  groups: z.array(modifierGroupSchema),
  /** productId → modifier group ids, in display order. */
  productGroups: z.record(z.string(), z.array(z.string())),
});
export type PosMenu = z.infer<typeof posMenuSchema>;

export const orderSummarySchema = z.object({
  id: z.string(),
  number: z.string(),
  orderType: z.enum(ORDER_TYPES),
  tableId: z.string().nullable(),
  tableCode: z.string().nullable(),
  label: z.string().nullable(),
  guests: z.number().int().nullable(),
  openedAt: z.string(),
  itemCount: z.number().int(),
  /** Unpaid, non-cancelled items at current prices. */
  due: moneySchema,
  pending: z.number().int(),
  inKitchen: z.number().int(),
  ready: z.number().int(),
});
export type OrderSummary = z.infer<typeof orderSummarySchema>;

export const floorSchema = z.object({
  areas: z.array(
    z.object({
      id: z.string(),
      ...named,
      tables: z.array(
        z.object({
          id: z.string(),
          code: z.string(),
          seats: z.number().int(),
          order: orderSummarySchema.nullable(),
        }),
      ),
    }),
  ),
  /** Open takeaway and pickup orders. */
  queue: z.array(orderSummarySchema),
});
export type Floor = z.infer<typeof floorSchema>;

export const restaurantOrderItemSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  variantId: z.string(),
  productId: z.string(),
  ...named,
  variantNameEn: z.string().nullable(),
  variantNameAr: z.string().nullable(),
  quantity: z.string(),
  note: z.string().nullable(),
  modifiers: z.array(z.object({ id: z.string(), ...named, price: moneySchema })),
  /** Current unit price incl. modifiers (the bill uses the price at payment). */
  unitPrice: moneySchema,
  lineTotal: moneySchema,
  kitchenStatus: z.enum(KITCHEN_STATUSES),
  saleId: z.string().nullable(),
  cancelReason: z.string().nullable(),
  wasted: z.boolean().nullable(),
  version: z.number().int(),
});
export type RestaurantOrderItem = z.infer<typeof restaurantOrderItemSchema>;

export const restaurantOrderSchema = orderSummarySchema.extend({
  branchId: z.string(),
  note: z.string().nullable(),
  status: z.enum(['open', 'closed', 'cancelled', 'merged']),
  openedBy: z.string(),
  closedAt: z.string().nullable(),
  items: z.array(restaurantOrderItemSchema),
  bills: z.array(
    z.object({
      saleId: z.string(),
      receiptNumber: z.string(),
      total: moneySchema,
      createdAt: z.string(),
    }),
  ),
  paid: moneySchema,
  version: z.number().int(),
});
export type RestaurantOrder = z.infer<typeof restaurantOrderSchema>;
export const orderListSchema = z.object({ orders: z.array(orderSummarySchema) });

export const createRestaurantOrderSchema = z
  .object({
    orderType: z.enum(ORDER_TYPES),
    tableId: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    guests: z
      .number()
      .int()
      .min(1)
      .max(100)
      .nullish()
      .transform((v) => v ?? null),
    label: text(60),
    note: text(300),
  })
  .refine((o) => o.orderType !== 'dine_in' || o.tableId !== null, {
    error: 'Choose a table.',
    path: ['tableId'],
  });
export type CreateRestaurantOrder = z.input<typeof createRestaurantOrderSchema>;

export const addOrderItemsSchema = z.object({
  version,
  items: z
    .array(
      z.object({
        variantId: z.uuid(),
        quantity: quantitySchema,
        modifierIds: z.array(z.uuid()).max(50).default([]),
        note: text(200),
      }),
    )
    .min(1)
    .max(100),
});
export type AddOrderItems = z.input<typeof addOrderItemsSchema>;

export const cancelOrderItemSchema = z.object({
  reason: z.string().trim().min(1).max(200),
  /** Only for items already sent to the kitchen: were they prepared (stock is consumed)? */
  waste: z.boolean().default(false),
});
export const moveOrderSchema = z.object({ version, tableId: z.uuid() });
export const mergeOrderSchema = z.object({ version, sourceOrderId: z.uuid() });
export const orderVersionSchema = z.object({ version });

export const quoteOrderSchema = z.object({
  itemIds: z.array(z.uuid()).min(1).max(200),
  orderDiscount: discountInputSchema.nullish().transform((v) => v ?? null),
});
export const orderQuoteSchema = z.object({
  subtotal: moneySchema,
  discounts: moneySchema,
  total: moneySchema,
});
export type OrderQuote = z.infer<typeof orderQuoteSchema>;

export const payOrderSchema = z.object({
  idempotencyKey: z.uuid(),
  itemIds: z.array(z.uuid()).min(1).max(200),
  orderDiscount: discountInputSchema.nullish().transform((v) => v ?? null),
  customerId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  payments: z.array(paymentInputSchema).max(10),
  expectedTotal: moneyAmountSchema,
});
export type PayOrder = z.input<typeof payOrderSchema>;
export const payOrderResultSchema = z.object({ order: restaurantOrderSchema, sale: saleSchema });

// ---------------------------------------------------------------- kitchen
export const kitchenTicketSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  orderNumber: z.string(),
  orderType: z.enum(ORDER_TYPES),
  tableCode: z.string().nullable(),
  label: z.string().nullable(),
  stationId: z.string(),
  status: z.enum(['new', 'preparing', 'ready', 'completed', 'cancelled']),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  readyAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  items: z.array(
    z.object({
      id: z.string(),
      ...named,
      variantNameEn: z.string().nullable(),
      variantNameAr: z.string().nullable(),
      quantity: z.string(),
      note: z.string().nullable(),
      modifiers: z.array(z.object(named)),
      kitchenStatus: z.enum(KITCHEN_STATUSES),
    }),
  ),
  version: z.number().int(),
});
export type KitchenTicket = z.infer<typeof kitchenTicketSchema>;
export const kitchenBoardSchema = z.object({
  stations: z.array(z.object({ id: z.string(), ...named })),
  tickets: z.array(kitchenTicketSchema),
});
export type KitchenBoard = z.infer<typeof kitchenBoardSchema>;
export const ticketStatusSchema = z.object({
  status: z.enum(['preparing', 'ready', 'completed']),
  version,
});
