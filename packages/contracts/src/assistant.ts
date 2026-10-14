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
