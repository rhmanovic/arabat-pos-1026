import type {
  AssistantConversation,
  AssistantConversationList,
  AssistantMessage,
} from '@arabat/contracts';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import type { AssistantSurface } from './assistant.prompt.js';

type Row = Record<string, unknown>;
const MAX_CONVERSATIONS = 50;

/**
 * The signed-in user's own past conversations (ADR-0107 amendment, 2026-10-15): read under
 * the `own_select` policy of migration 0049 (merchant and user of the session), per surface.
 * Only questions and answers come back; the platform keeps the tokens and the cost. A question
 * recorded without a conversation id (older browsers) is listed on its own, under its own id.
 */
@Injectable()
export class AssistantHistoryService {
  constructor(private readonly database: DatabaseService) {}

  async conversations(
    actor: MerchantActor,
    surface: AssistantSurface,
  ): Promise<AssistantConversationList> {
    const rows = await this.read(
      actor,
      // A question recorded before the browser sent a conversation id stands on its own.
      sql`select coalesce(conversation_id, id) as conversation_id,
                 min(created_at) as started_at, max(created_at) as last_at,
                 count(*)::int as turns,
                 (array_agg(question order by created_at))[1] as first_question
          from assistant_requests
          where merchant_id = ${actor.merchantId} and user_id = ${actor.userId}
            and surface = ${surface}
          group by coalesce(conversation_id, id)
          order by max(created_at) desc
          limit ${MAX_CONVERSATIONS}`,
    );
    return {
      conversations: rows.map((r) => ({
        id: r['conversation_id'] as string,
        startedAt: iso(r['started_at']),
        lastAt: iso(r['last_at']),
        firstQuestion: r['first_question'] as string,
        turns: Number(r['turns']),
      })),
    };
  }

  /** The conversation as the user saw it: every question and the answers that came back. */
  async conversation(
    actor: MerchantActor,
    surface: AssistantSurface,
    id: string,
  ): Promise<AssistantConversation> {
    const rows = await this.read(
      actor,
      sql`select question, reply, thread, conversation_id, created_at from assistant_requests
          where merchant_id = ${actor.merchantId} and user_id = ${actor.userId}
            and surface = ${surface}
            and (conversation_id = ${id} or (conversation_id is null and id = ${id}))
          order by created_at, id`,
    );
    if (rows.length === 0) throw AppError.notFound('Conversation not found.');
    const messages: AssistantMessage[] = [];
    if (rows.length === 1 && rows[0]!['conversation_id'] === null) {
      // No id was sent: the turns before this question are in the thread it carried.
      const earlier = JSON.parse((rows[0]!['thread'] as string) || '[]') as AssistantMessage[];
      messages.push(...earlier);
    }
    for (const r of rows) {
      messages.push({ role: 'user', content: r['question'] as string });
      const reply = r['reply'] as string | null;
      if (reply) messages.push({ role: 'assistant', content: reply });
    }
    return {
      id,
      startedAt: iso(rows[0]!['created_at']),
      lastAt: iso(rows[rows.length - 1]!['created_at']),
      messages,
    };
  }

  private read(actor: MerchantActor, query: ReturnType<typeof sql>): Promise<Row[]> {
    return this.database.withContext(
      { merchantId: actor.merchantId, userId: actor.userId },
      async (tx) => (await tx.execute(query)).rows as Row[],
    );
  }
}

function iso(v: unknown): string {
  return new Date(v as string).toISOString();
}
