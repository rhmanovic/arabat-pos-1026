import type {
  AssistantRequestRecord,
  AssistantUsage,
  assistantUsageQuerySchema,
} from '@arabat/contracts';
import { Injectable } from '@nestjs/common';
import { type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService } from '../../database/database.service.js';
import type { PlatformActor } from '../../kernel/access/session-resolver.js';

type Query = z.output<typeof assistantUsageQuerySchema>;
type Row = Record<string, unknown>;

const num = (v: unknown) => Number(v ?? 0);
const EXPORT_PAGE = 500;

/**
 * The platform's view of every assistant question (ADR-0107 amendment): what was asked and
 * answered, what it cost, per company. Read only through the SECURITY DEFINER functions of
 * migration 0048, in an operator context; no merchant can reach these rows.
 */
@Injectable()
export class AssistantUsageService {
  constructor(private readonly database: DatabaseService) {}

  async usage(actor: PlatformActor, query: Query): Promise<AssistantUsage> {
    const filters = this.filters(query);
    const [rows = [], groups = []] = await this.read(actor, [
      sql`select * from platform_assistant_requests(${filters}, ${query.pageSize}, ${(query.page - 1) * query.pageSize})`,
      sql`select * from platform_assistant_usage(${filters})`,
    ]);
    const byMerchant = groups.map((g) => ({
      merchantId: g['merchant_id'] as string,
      merchantNameEn: (g['merchant_name_en'] as string | null) ?? null,
      merchantNameAr: (g['merchant_name_ar'] as string | null) ?? null,
      requests: num(g['requests']),
      users: num(g['users']),
      inputTokens: num(g['input_tokens']),
      outputTokens: num(g['output_tokens']),
      cacheWriteTokens: num(g['cache_write_tokens']),
      cacheReadTokens: num(g['cache_read_tokens']),
      costMicroUsd: num(g['cost_micro_usd']),
      lastAt: new Date(g['last_at'] as string).toISOString(),
    }));
    const totals = byMerchant.reduce(
      (t, g) => ({
        requests: t.requests + g.requests,
        inputTokens: t.inputTokens + g.inputTokens,
        outputTokens: t.outputTokens + g.outputTokens,
        cacheWriteTokens: t.cacheWriteTokens + g.cacheWriteTokens,
        cacheReadTokens: t.cacheReadTokens + g.cacheReadTokens,
        costMicroUsd: t.costMicroUsd + g.costMicroUsd,
      }),
      {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        costMicroUsd: 0,
      },
    );
    return {
      requests: rows.map(toRecord),
      total: num(rows[0]?.['total_count']),
      page: query.page,
      pageSize: query.pageSize,
      totals,
      byMerchant,
    };
  }

  /**
   * Every matching conversation turn as JSON lines (one per question) for review or model
   * training: the thread as sent, the question, the answer, the lookups and the usage.
   */
  async exportJsonl(actor: PlatformActor, query: Query): Promise<string> {
    const filters = this.filters(query);
    const lines: string[] = [];
    for (let offset = 0; ; offset += EXPORT_PAGE) {
      const [rows = []] = await this.read(actor, [
        sql`select * from platform_assistant_requests(${filters}, ${EXPORT_PAGE}, ${offset})`,
      ]);
      for (const r of rows) {
        const record = toRecord(r);
        const thread = JSON.parse((r['thread'] as string) || '[]') as {
          role: 'user' | 'assistant';
          content: string;
        }[];
        lines.push(
          JSON.stringify({
            id: record.id,
            createdAt: record.createdAt,
            merchantId: record.merchantId,
            conversationId: record.conversationId,
            surface: record.surface,
            language: record.language,
            model: record.model,
            messages: [
              ...thread,
              { role: 'user', content: record.question },
              ...(record.reply ? [{ role: 'assistant', content: record.reply }] : []),
            ],
            toolsUsed: record.toolsUsed,
            outcome: record.outcome,
            usage: {
              inputTokens: record.inputTokens,
              outputTokens: record.outputTokens,
              cacheWriteTokens: record.cacheWriteTokens,
              cacheReadTokens: record.cacheReadTokens,
            },
            costMicroUsd: record.costMicroUsd,
          }),
        );
      }
      if (rows.length < EXPORT_PAGE) break;
    }
    return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
  }

  private filters(query: Query): SQL {
    return sql`${query.merchantId ?? null}::uuid, ${query.surface ?? null}::text, ${query.from ?? null}::date, ${query.to ?? null}::date, ${query.q ?? null}::text`;
  }

  private read(actor: PlatformActor, queries: SQL[]): Promise<Row[][]> {
    return this.database.withPlatformContext(actor.operatorId, null, async (tx) => {
      const out: Row[][] = [];
      for (const q of queries) out.push((await tx.execute(q)).rows as Row[]);
      return out;
    });
  }
}

function toRecord(r: Row): AssistantRequestRecord {
  return {
    id: r['id'] as string,
    merchantId: r['merchant_id'] as string,
    merchantNameEn: (r['merchant_name_en'] as string | null) ?? null,
    merchantNameAr: (r['merchant_name_ar'] as string | null) ?? null,
    userName: r['user_name'] as string,
    userEmail: r['user_email'] as string,
    branchNameEn: (r['branch_name_en'] as string | null) ?? null,
    branchNameAr: (r['branch_name_ar'] as string | null) ?? null,
    surface: r['surface'] as 'pos' | 'manager',
    conversationId: (r['conversation_id'] as string | null) ?? null,
    language: r['language'] as 'ar' | 'en',
    model: r['model'] as string,
    question: r['question'] as string,
    reply: (r['reply'] as string | null) ?? null,
    toolsUsed: (r['tools_used'] as string[] | null) ?? [],
    rounds: num(r['rounds']),
    inputTokens: num(r['input_tokens']),
    outputTokens: num(r['output_tokens']),
    cacheWriteTokens: num(r['cache_write_tokens']),
    cacheReadTokens: num(r['cache_read_tokens']),
    costMicroUsd: r['cost_micro_usd'] === null ? null : num(r['cost_micro_usd']),
    durationMs: num(r['duration_ms']),
    outcome: r['outcome'] as AssistantRequestRecord['outcome'],
    stopReason: (r['stop_reason'] as string | null) ?? null,
    error: (r['error'] as string | null) ?? null,
    createdAt: new Date(r['created_at'] as string).toISOString(),
  };
}
