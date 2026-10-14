import { z } from 'zod';
import { moneyAmountSchema } from './catalog.js';

/**
 * Assistant (ADR-0105): a read-only chat helper on the cashier's screen and in the
 * management app. The browser keeps the conversation and sends it whole on every turn; the
 * server stores nothing.
 */
export const ASSISTANT_MAX_TURNS = 20;
export const ASSISTANT_MAX_MESSAGE_CHARS = 2000;

export const assistantMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(ASSISTANT_MAX_MESSAGE_CHARS),
});
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;

/** What is on the till right now, as the cashier sees it (display values only). */
export const assistantCartSchema = z.object({
  lines: z
    .array(
      z.object({
        name: z.string().trim().max(200),
        quantity: z.string().trim().max(20),
        unitPrice: moneyAmountSchema,
        lineTotal: moneyAmountSchema,
      }),
    )
    .max(100),
  total: moneyAmountSchema.nullable(),
  customer: z.string().trim().max(120).nullable(),
});
export type AssistantCart = z.infer<typeof assistantCartSchema>;

export const assistantChatSchema = z
  .object({
    messages: z.array(assistantMessageSchema).min(1).max(ASSISTANT_MAX_TURNS),
    language: z.enum(['ar', 'en']),
    /** POS only: what is on the till. */
    cart: assistantCartSchema.nullable().default(null),
    /** Manager only: the branch selected in the top bar; null for "all branches". */
    branchId: z.uuid().nullable().default(null),
    /** Browser-generated id of the conversation; new on "New conversation". */
    conversationId: z.uuid().nullable().default(null),
  })
  .refine(
    (v) => v.messages[0]?.role === 'user' && v.messages[v.messages.length - 1]?.role === 'user',
    { error: 'The conversation must start and end with the user.', path: ['messages'] },
  );
export type AssistantChat = z.input<typeof assistantChatSchema>;

export const assistantReplySchema = z.object({
  reply: z.string(),
  /** Names of the read-only lookups the assistant ran for this answer. */
  toolsUsed: z.array(z.string()),
});
export type AssistantReply = z.infer<typeof assistantReplySchema>;

export const assistantStatusSchema = z.object({
  /** False until the platform configures the model provider (no key, no calls, no cost). */
  enabled: z.boolean(),
});
export type AssistantStatus = z.infer<typeof assistantStatusSchema>;

// ---------------------------------------------------------------- platform: usage records
/** What the platform's super admin sees of every assistant question (ADR-0105 amendment). */
export const assistantRequestRecordSchema = z.object({
  id: z.string(),
  merchantId: z.string(),
  merchantNameEn: z.string().nullable(),
  merchantNameAr: z.string().nullable(),
  userName: z.string(),
  userEmail: z.string(),
  branchNameEn: z.string().nullable(),
  branchNameAr: z.string().nullable(),
  surface: z.enum(['pos', 'manager']),
  conversationId: z.string().nullable(),
  language: z.enum(['ar', 'en']),
  model: z.string(),
  question: z.string(),
  reply: z.string().nullable(),
  toolsUsed: z.array(z.string()),
  rounds: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  /** Micro-USD at list price; null when the model is not in the price table. */
  costMicroUsd: z.number().int().nullable(),
  durationMs: z.number().int(),
  outcome: z.enum(['answered', 'fallback', 'refused', 'failed']),
  stopReason: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type AssistantRequestRecord = z.infer<typeof assistantRequestRecordSchema>;

export const assistantUsageTotalsSchema = z.object({
  requests: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  costMicroUsd: z.number().int(),
});
export type AssistantUsageTotals = z.infer<typeof assistantUsageTotalsSchema>;

export const assistantUsageByMerchantSchema = assistantUsageTotalsSchema.extend({
  merchantId: z.string(),
  merchantNameEn: z.string().nullable(),
  merchantNameAr: z.string().nullable(),
  users: z.number().int(),
  lastAt: z.string(),
});

export const assistantUsageSchema = z.object({
  requests: z.array(assistantRequestRecordSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** Over every request matching the filter, not only the page. */
  totals: assistantUsageTotalsSchema,
  byMerchant: z.array(assistantUsageByMerchantSchema),
});
export type AssistantUsage = z.infer<typeof assistantUsageSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const assistantUsageQuerySchema = z.object({
  merchantId: z.uuid().optional(),
  surface: z.enum(['pos', 'manager']).optional(),
  /** Inclusive calendar days (UTC). */
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || undefined),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type AssistantUsageQuery = z.input<typeof assistantUsageQuerySchema>;
