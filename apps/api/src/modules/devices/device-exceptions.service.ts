import type { DeviceException } from '@arabat/contracts';
import { can } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { AuditService } from '../audit/audit.service.js';

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v ? new Date(v as string | Date).toISOString() : null);

/**
 * What managers must look at after device uploads (ADR-0112 §5, gap B): sales that drove stock
 * below zero, records whose device clock looked wrong, and records the server refused. The
 * records themselves are never changed here; a manager marks the exception handled with a note.
 */
@Injectable()
export class DeviceExceptionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: MerchantActor, status: 'open' | 'resolved'): Promise<DeviceException[]> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
          select e.id, e.kind, e.branch_id, e.device_id, d.name as device_name, g.code as register_code,
                 e.record_id, r.kind as record_kind, e.details, r.occurred_at, r.received_at, e.created_at,
                 e.resolved_at, u.full_name as resolved_by, e.resolution_note,
                 case when r.status = 'refused' then r.payload end as payload,
                 coalesce(p.name_en, p.name_ar) as product_name_en, coalesce(p.name_ar, p.name_en) as product_name_ar,
                 st.status as stale_status
          from device_exceptions e
          join pos_devices d on d.id = e.device_id
          join registers g on g.id = d.register_id
          join device_records r on r.id = e.record_id
          left join users u on u.id = e.resolved_by_user_id
          left join product_variants v on e.kind = 'negative_stock' and v.id = (e.details->>'variantId')::uuid
          left join products p on p.id = v.product_id
          left join shifts st on e.kind = 'shift_left_open' and st.id = (e.details->>'staleShiftId')::uuid
          where e.merchant_id = ${actor.merchantId}
            and ${status === 'open' ? sql`e.resolved_at is null` : sql`e.resolved_at is not null`}
          order by e.created_at desc, e.id desc
          limit 200`)
      ).rows as Row[];
      return rows
        .filter((r) => can(actor.access, 'registers.manage', r['branch_id'] as string))
        .map((r) => ({
          id: String(r['id']),
          kind: r['kind'] as DeviceException['kind'],
          branchId: String(r['branch_id']),
          deviceId: String(r['device_id']),
          deviceName: String(r['device_name']),
          registerCode: String(r['register_code']),
          recordId: String(r['record_id']),
          recordKind: String(r['record_kind']),
          details: {
            ...(r['details'] as Record<string, unknown>),
            ...(r['kind'] === 'negative_stock'
              ? { productNameEn: r['product_name_en'], productNameAr: r['product_name_ar'] }
              : {}),
            // The stale shift may have been closed meanwhile (online, or by the manager's action).
            ...(r['kind'] === 'shift_left_open'
              ? { staleShiftClosed: r['stale_status'] !== 'open' }
              : {}),
          },
          occurredAt: iso(r['occurred_at'])!,
          receivedAt: iso(r['received_at'])!,
          createdAt: iso(r['created_at'])!,
          resolvedAt: iso(r['resolved_at']),
          resolvedByName: (r['resolved_by'] as string | null) ?? null,
          resolutionNote: (r['resolution_note'] as string | null) ?? null,
          payload: (r['payload'] as Record<string, unknown> | null) ?? null,
        }));
    });
  }

  async resolve(actor: MerchantActor, id: string, note: string, ip: string): Promise<void> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = (
        await tx.execute(sql`
          select branch_id, kind, record_id, resolved_at from device_exceptions where id = ${id} for update`)
      ).rows as Row[];
      if (!row) throw AppError.notFound();
      assertCan(actor, 'registers.manage', row['branch_id'] as string);
      if (row['resolved_at'])
        throw new AppError(409, 'INVALID_STATE', 'This exception is already handled.');
      await tx.execute(sql`
        update device_exceptions set resolved_at = now(), resolved_by_user_id = ${actor.userId},
          resolution_note = ${note}
        where id = ${id}`);
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'device_exception.resolved',
        targetType: 'device_exception',
        targetId: id,
        ip,
        details: { kind: row['kind'], recordId: row['record_id'], note },
      });
    });
  }
}
