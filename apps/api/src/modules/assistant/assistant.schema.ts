import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, merchantId } from '../../database/schema/columns.js';

/**
 * One row per assistant question (ADR-0105 amendment, 2026-10-14): the conversation turn, the
 * lookups it ran, the provider's token counts and the estimated cost. Platform-owned data:
 * merchant code inserts its own rows and can never read them; the platform's super admin
 * reads them through `platform_assistant_requests()` for monitoring, abuse detection and
 * model training. Append-only.
 */
export const assistantRequests = pgTable(
  'assistant_requests',
  {
    id: id(),
    merchantId: merchantId(),
    userId: uuid().notNull(),
    membershipId: uuid().notNull(),
    /** The cashier's bound branch, or the branch selected in the manager's top bar. */
    branchId: uuid(),
    surface: text().notNull(),
    /** Browser-generated id shared by the turns of one conversation (null from older clients). */
    conversationId: uuid(),
    language: text().notNull(),
    model: text().notNull(),
    /** The question of this turn and the whole thread sent with it (previous turns), for training. */
    question: text().notNull(),
    thread: text().notNull(),
    reply: text(),
    toolsUsed: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    rounds: integer().notNull().default(0),
    inputTokens: bigint({ mode: 'number' }).notNull().default(0),
    outputTokens: bigint({ mode: 'number' }).notNull().default(0),
    cacheWriteTokens: bigint({ mode: 'number' }).notNull().default(0),
    cacheReadTokens: bigint({ mode: 'number' }).notNull().default(0),
    /** Estimated cost in micro-USD at the list price of the model (null for an unknown model). */
    costMicroUsd: bigint({ mode: 'number' }),
    durationMs: integer().notNull().default(0),
    outcome: text().notNull(),
    stopReason: text(),
    error: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('assistant_requests_merchant_time_idx').on(t.merchantId, t.createdAt),
    index('assistant_requests_time_idx').on(t.createdAt),
    check('assistant_requests_surface_valid', sql`${t.surface} in ('pos', 'manager')`),
    check(
      'assistant_requests_outcome_valid',
      sql`${t.outcome} in ('answered', 'fallback', 'refused', 'failed')`,
    ),
  ],
);
