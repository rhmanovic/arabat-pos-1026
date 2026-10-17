import type { ControlsChecklist } from '@arabat/contracts';
import { Money } from '@arabat/money';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { countOpenVariances } from '../cash/cash-controls.service.js';

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
      const [payouts] = (
        await tx.execute(sql`
          select count(*)::int as n from cash_payout_requests
          where merchant_id = ${actor.merchantId} and status = 'pending'`)
      ).rows as { n: number }[];
      const openVariances = await countOpenVariances(tx, actor.merchantId);
      const [deposits] = (
        await tx.execute(sql`
          select count(*)::int as n from cash_transfers t join financial_accounts d on d.id = t.to_account_id
          where t.merchant_id = ${actor.merchantId} and d.kind = 'deposit_transit'
            and not exists (select 1 from cash_transfers c where c.confirms_transfer_id = t.id)`)
      ).rows as { n: number }[];
      const [unreconciled] = (
        await tx.execute(sql`
          select count(*)::int as n from financial_account_entries e
          join financial_accounts a on a.id = e.account_id
          where e.merchant_id = ${actor.merchantId} and a.kind = 'bank' and a.status = 'active'
            and e.created_at < now() - interval '7 days'
            and not exists (select 1 from bank_reconciliation_items i where i.entry_id = e.id)`)
      ).rows as { n: number }[];
      const [adjustments] = (
        await tx.execute(sql`
          select count(*)::int as n from stock_adjustments
          where merchant_id = ${actor.merchantId} and status = 'pending'`)
      ).rows as { n: number }[];
      const [losses] = (
        await tx.execute(sql`
          select count(*)::int as n from stock_transfer_losses
          where merchant_id = ${actor.merchantId} and status = 'pending'`)
      ).rows as { n: number }[];
      // Received short, nothing pending and not fully written off: somebody must claim or decide.
      const [shortages] = (
        await tx.execute(sql`
          select count(*)::int as n from stock_transfers t
          where t.merchant_id = ${actor.merchantId} and t.status = 'received'
            and not exists (select 1 from stock_transfer_losses x where x.transfer_id = t.id and x.status = 'pending')
            and (select coalesce(sum(greatest(l.dispatched_quantity - coalesce(l.received_quantity, 0)
                   - coalesce((select sum(ll.quantity) from stock_transfer_loss_lines ll
                               join stock_transfer_losses x on x.id = ll.loss_id
                               where x.transfer_id = t.id and x.status = 'posted' and ll.position = l.position), 0), 0)), 0)
                 from stock_transfer_lines l where l.transfer_id = t.id) > 0`)
      ).rows as { n: number }[];
      const [deviceExceptions] = (
        await tx.execute(sql`
          select count(*)::int as n from device_exceptions
          where merchant_id = ${actor.merchantId} and resolved_at is null`)
      ).rows as { n: number }[];
      return {
        pendingPayoutRequests: Number(payouts?.n ?? 0),
        openVariances,
        depositsInTransit: Number(deposits?.n ?? 0),
        unreconciledBankEntries: Number(unreconciled?.n ?? 0),
        pendingAdjustments: Number(adjustments?.n ?? 0),
        pendingTransferLosses: Number(losses?.n ?? 0),
        unresolvedTransferShortages: Number(shortages?.n ?? 0),
        openDeviceExceptions: Number(deviceExceptions?.n ?? 0),
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
