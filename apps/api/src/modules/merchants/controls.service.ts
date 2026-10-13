import type { ControlsChecklist } from '@arabat/contracts';
import { Money } from '@arabat/money';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';

type Row = Record<string, unknown>;

/**
 * Internal-control checklist for the dashboard (BR-165, remediation R1.6): read-only facts
 * about the company's set-up that weaken control, computed from the live tables so they can
 * never go stale. Nothing here changes data.
 */
@Injectable()
export class ControlsService {
  constructor(private readonly database: DatabaseService) {}

  async checklist(actor: MerchantActor): Promise<ControlsChecklist> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [treasurer] = (
        await tx.execute(sql`
          select exists (
            select 1 from role_assignments ra
            join memberships ms on ms.id = ra.membership_id
            join role_permissions rp on rp.role_id = ra.role_id
            where ms.merchant_id = ${actor.merchantId} and ms.status = 'active' and not ms.is_owner
              and rp.permission_key = 'cash.custody'
          ) as assigned`)
      ).rows as { assigned: boolean }[];
      const withoutRoles = (
        await tx.execute(sql`
          select ms.id, u.full_name from memberships ms join users u on u.id = ms.user_id
          where ms.merchant_id = ${actor.merchantId} and ms.status = 'active' and not ms.is_owner
            and not exists (select 1 from role_assignments ra where ra.membership_id = ms.id)
          order by u.full_name`)
      ).rows as Row[];
      const [policy] = (
        await tx.execute(sql`
          select coalesce((select max_register_tolerance_minor from sales_settings
                           where merchant_id = ${actor.merchantId}), 1000)::text as max_tolerance`)
      ).rows as { max_tolerance: string }[];
      const above = (
        await tx.execute(sql`
          select id, branch_id, name_en, name_ar, discrepancy_tolerance_minor::text as tolerance
          from registers
          where merchant_id = ${actor.merchantId} and status = 'active'
            and discrepancy_tolerance_minor > ${policy!.max_tolerance}::bigint
          order by code`)
      ).rows as Row[];
      const [pending] = (
        await tx.execute(sql`
          select count(*)::int as n from cash_movements m join shifts s on s.id = m.shift_id
          where m.merchant_id = ${actor.merchantId} and m.status = 'pending' and s.status = 'open'`)
      ).rows as { n: number }[];
      return {
        treasurerAssigned: Boolean(treasurer?.assigned),
        membersWithoutRoles: withoutRoles.map((r) => ({
          membershipId: r['id'] as string,
          fullName: r['full_name'] as string,
        })),
        registersAboveTolerance: above.map((r) => ({
          registerId: r['id'] as string,
          branchId: r['branch_id'] as string,
          nameEn: (r['name_en'] as string | null) ?? null,
          nameAr: (r['name_ar'] as string | null) ?? null,
          tolerance: Money.ofMinor(BigInt(r['tolerance'] as string), 'KWD').toJSON(),
        })),
        pendingCashMovements: Number(pending?.n ?? 0),
      };
    });
  }
}
