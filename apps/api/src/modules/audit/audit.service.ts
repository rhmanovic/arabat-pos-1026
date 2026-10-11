import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { newId } from '../../kernel/ids.js';
import { auditLog } from './audit.schema.js';

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
