import type { AuditEntry, AuditList, auditListQuerySchema } from '@arabat/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { type SQL, and, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { newId } from '../../kernel/ids.js';
import { merchantTimezone, withinLocalDays } from '../../kernel/time/period.js';
import { auditLog } from './audit.schema.js';

type AuditQuery = z.output<typeof auditListQuerySchema>;
type Row = Record<string, unknown>;

export interface AuditEvent {
  merchantId: string | null;
  actorType: 'user' | 'operator' | 'anonymous' | 'system';
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string | null;
  ip?: string | null;
  details?: Record<string, unknown>;
}

/** Append-only audit trail for security and financial events (CLAUDE.md §4). */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly database: DatabaseService) {}

  /** Records inside the caller's transaction so the event commits or rolls back with it. */
  async recordIn(tx: Transaction, event: AuditEvent): Promise<void> {
    await tx.insert(auditLog).values({
      id: newId(),
      merchantId: event.merchantId,
      actorType: event.actorType,
      actorId: event.actorId ?? null,
      action: event.action,
      targetType: event.targetType ?? null,
      targetId: event.targetId ?? null,
      ip: event.ip ?? null,
      details: event.details ?? {},
    });
  }

  /**
   * The company's own audit trail (BR-163, FND-101). Row-level security limits the rows to
   * the merchant of the session; events without a merchant (failed sign-ins, platform-only
   * actions) are never visible here. Periods are local days of the merchant.
   */
  async listForMerchant(actor: MerchantActor, query: AuditQuery): Promise<AuditList> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const tz = await merchantTimezone(tx, actor.merchantId);
      const where: SQL[] = [sql`a.merchant_id = ${actor.merchantId}`];
      where.push(withinLocalDays(tz, sql`a.occurred_at`, query.from, query.to));
      if (query.action) where.push(sql`position(lower(${query.action}) in lower(a.action)) > 0`);
      if (query.targetType) where.push(sql`a.target_type = ${query.targetType}`);
      if (query.actorId) where.push(sql`a.actor_id = ${query.actorId}`);
      const rows = (
        await tx.execute(sql`
          select a.id, a.actor_type, a.actor_id, a.action, a.target_type, a.target_id, a.ip,
                 a.details, a.occurred_at, u.full_name, count(*) over () as total_count
          from audit_log a
          left join users u on a.actor_type = 'user' and u.id = a.actor_id
          where ${and(...where)}
          order by a.occurred_at desc, a.id desc
          limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`)
      ).rows as Row[];
      const actions = (
        await tx.execute(sql`
          select distinct action from audit_log where merchant_id = ${actor.merchantId}
          order by action`)
      ).rows as { action: string }[];
      return {
        entries: rows.map((r): AuditEntry => ({
          id: r['id'] as string,
          occurredAt: new Date(r['occurred_at'] as string).toISOString(),
          actorType: r['actor_type'] as AuditEntry['actorType'],
          actorId: (r['actor_id'] as string | null) ?? null,
          actorName: (r['full_name'] as string | null) ?? null,
          action: r['action'] as string,
          targetType: (r['target_type'] as string | null) ?? null,
          targetId: (r['target_id'] as string | null) ?? null,
          ip: (r['ip'] as string | null) ?? null,
          details: (r['details'] as Record<string, unknown> | null) ?? {},
        })),
        total: Number(rows[0]?.['total_count'] ?? 0),
        page: query.page,
        pageSize: query.pageSize,
        actions: actions.map((a) => a.action),
      };
    });
  }

  /** Records in its own transaction (e.g. a failed sign-in, which has no other writes). */
  async record(event: AuditEvent): Promise<void> {
    try {
      await this.database.withContext(
        event.merchantId ? { merchantId: event.merchantId } : {},
        (tx) => this.recordIn(tx, event),
      );
    } catch (error) {
      // Auditing must never turn a rejected sign-in into a server error; log loudly instead.
      this.logger.error(`Audit write failed for ${event.action}: ${(error as Error).message}`);
    }
  }
}
