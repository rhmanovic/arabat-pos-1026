import type {
  CashPayoutRequest,
  CashVariance,
  cashPayoutRequestQuerySchema,
  cashVarianceQuerySchema,
  createCashDisbursementSchema,
  decidePayoutRequestSchema,
  resolveVarianceSchema,
} from '@arabat/contracts';
import { Money } from '@arabat/money';
import { Injectable } from '@nestjs/common';
import { type SQL, and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import {
  accountBalance,
  assertCovers,
  assertTreasuryCounted,
  branchTreasury,
  lockAccounts,
  postDisbursement,
} from '../payments/cash-ledger.js';
import { cashPayoutRequests, varianceFollowups } from '../payments/payments.schema.js';
import { parseAmount } from '../payments/payments.service.js';
import {
  assertNotOverpaid,
  assertReceiptReference,
  exceedsApprovalLimit,
} from './approval-limits.js';
import { assertPayable, branchScope } from './cash-payouts.service.js';

type RequestInput = z.output<typeof createCashDisbursementSchema>;
type RequestQuery = z.output<typeof cashPayoutRequestQuerySchema>;
type DecisionInput = z.output<typeof decidePayoutRequestSchema>;
type VarianceQuery = z.output<typeof cashVarianceQuerySchema>;
type ResolveInput = z.output<typeof resolveVarianceSchema>;
type Row = Record<string, unknown>;

const CURRENCY = 'KWD' as const;
const money = (minor: bigint) => Money.ofMinor(minor, CURRENCY).toJSON();
const decimal = (minor: bigint) => Money.ofMinor(minor, CURRENCY).toDecimalString();
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const str = (v: unknown) => (v as string | null) ?? null;

/** Cash differences with no follow-up yet, for the dashboard checklist. */
export async function countOpenVariances(tx: Transaction, merchantId: string): Promise<number> {
  const [row] = (
    await tx.execute(sql`select count(*)::int as n from (${varianceRows(merchantId)}) v
      where v.f_status is null`)
  ).rows as { n: number }[];
  return Number(row?.n ?? 0);
}

/**
 * Every cash difference the system has recorded, from its source documents (never a copy):
 * shift closes beyond the tolerance, opening differences between shifts, counts of drawers and
 * treasuries, and branch transfers received short or over; each joined to its follow-up.
 */
function varianceRows(merchantId: string): SQL {
  return sql`
    with v as (
      select 'shift_close'::text as source_type, s.id as source_id, s.branch_id,
             'register'::text as place_kind, r.name_en, r.name_ar,
             s.discrepancy_minor as amount, s.closed_at as occurred_at,
             u.full_name as accountable, s.closing_note as source_note
      from shifts s join registers r on r.id = s.register_id join users u on u.id = s.user_id
      where s.merchant_id = ${merchantId} and s.status = 'closed' and s.discrepancy_minor is not null
        and abs(s.discrepancy_minor) > coalesce(s.discrepancy_tolerance_minor, 0)
      union all
      select 'shift_opening', s.id, s.branch_id, 'register', r.name_en, r.name_ar,
             s.opening_discrepancy_minor, s.opened_at,
             case when s.opening_follows_shift_id is not null then pu.full_name else null end,
             s.opening_note
      from shifts s join registers r on r.id = s.register_id
      left join shifts p on p.id = s.opening_follows_shift_id
      left join users pu on pu.id = p.user_id
      where s.merchant_id = ${merchantId} and s.opening_discrepancy_minor is not null
        and s.opening_discrepancy_minor <> 0 and not s.opening_is_initial
      union all
      select 'account_count', e.id, a.branch_id, a.kind,
             coalesce(r.name_en, a.name_en), coalesce(r.name_ar, a.name_ar),
             e.amount_minor, e.created_at, u.full_name, e.description
      from financial_account_entries e
      join financial_accounts a on a.id = e.account_id
      left join registers r on r.id = a.register_id
      left join users u on u.id = e.created_by_user_id
      where e.merchant_id = ${merchantId} and e.source_type in ('register_count', 'treasury_count')
      union all
      select 'branch_transfer', t.id, t.to_branch_id, 'transfer', t.number, null,
             t.amount_received_minor - t.amount_sent_minor, t.received_at, u.full_name, t.receive_note
      from cash_branch_transfers t left join users u on u.id = t.received_by_user_id
      where t.merchant_id = ${merchantId} and t.status = 'received'
        and t.amount_received_minor <> t.amount_sent_minor
    )
    select v.*, f.status as f_status, f.note as f_note, fu.full_name as f_by, f.resolved_at as f_at
    from v
    left join variance_followups f on f.merchant_id = ${merchantId}
      and f.source_type = v.source_type and f.source_id = v.source_id
    left join users fu on fu.id = f.resolved_by_user_id`;
}

/**
 * Disbursement approvals and variance follow-up (ADR-0095). Requests never touch the cash
 * ledger; approval creates the ordinary disbursement. Follow-ups annotate differences that live
 * in their source documents.
 */
@Injectable()
export class CashControlsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ payout requests
  async listRequests(actor: MerchantActor, query: RequestQuery) {
    const scope = branchScope(actor, 'cash.custody', query.branchId, sql`q.branch_id`);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => ({
      requests: await this.requestRows(
        tx,
        and(
          scope ?? sql`true`,
          query.status === 'pending' ? sql`q.status = 'pending'` : sql`true`,
        )!,
      ),
    }));
  }

  /** Records a treasury expense or supplier payment that waits for a second custody holder. */
  async createRequest(
    actor: MerchantActor,
    input: RequestInput,
    ip: string,
  ): Promise<CashPayoutRequest> {
    assertCan(actor, 'cash.custody', input.branchId);
    const amountMinor = parseAmount(input.amount, 'amount');
    if (amountMinor <= 0n)
      throw AppError.validation([
        { path: 'amount', code: 'too_small', message: 'Amount must be greater than zero.' },
      ]);
    try {
      const id = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const [done] = await tx
          .select({ id: cashPayoutRequests.id })
          .from(cashPayoutRequests)
          .where(eq(cashPayoutRequests.idempotencyKey, input.idempotencyKey));
        if (done) return done.id;
        if (input.kind === 'supplier_payment')
          await assertPayable(tx, input.supplierId!, input.purchaseOrderId ?? null);
        if (await exceedsApprovalLimit(tx, actor.merchantId, input.kind, amountMinor))
          assertReceiptReference(input.receiptReference);
        // The treasury must exist and be counted; the cash itself is checked at approval.
        assertTreasuryCounted(await branchTreasury(tx, input.branchId));
        const requestId = newId();
        await tx.insert(cashPayoutRequests).values({
          id: requestId,
          merchantId: actor.merchantId,
          branchId: input.branchId,
          kind: input.kind,
          category: input.kind === 'expense' ? input.category! : null,
          supplierId: input.kind === 'supplier_payment' ? input.supplierId! : null,
          purchaseOrderId:
            input.kind === 'supplier_payment' ? (input.purchaseOrderId ?? null) : null,
          amountMinor,
          description: input.description,
          receiptReference: input.receiptReference,
          requestedByUserId: actor.userId,
          idempotencyKey: input.idempotencyKey,
        });
        await this.record(tx, actor, 'cash.payout_request.created', requestId, ip, {
          kind: input.kind,
          amount: decimal(amountMinor),
          branchId: input.branchId,
        });
        return requestId;
      });
      return this.requestById(actor, id);
    } catch (error) {
      if (isUniqueViolation(error, 'cash_payout_requests_idempotency_key')) {
        const existing = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
          const [row] = await tx
            .select({ id: cashPayoutRequests.id })
            .from(cashPayoutRequests)
            .where(eq(cashPayoutRequests.idempotencyKey, input.idempotencyKey));
          return row?.id ?? null;
        });
        if (existing) return this.requestById(actor, existing);
      }
      throw error;
    }
  }

  /** A second custody holder approves (paying now) or rejects; nobody decides their own. */
  async decideRequest(
    actor: MerchantActor,
    id: string,
    input: DecisionInput,
    ip: string,
  ): Promise<CashPayoutRequest> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [req] = await tx
        .select()
        .from(cashPayoutRequests)
        .where(eq(cashPayoutRequests.id, id))
        .for('update');
      if (!req) throw AppError.notFound('Payout request not found.');
      assertCan(actor, 'cash.custody', req.branchId);
      if (req.status !== 'pending')
        throw new AppError(409, 'MOVEMENT_DECIDED', 'This request was already decided.');
      const ownerOverride = req.requestedByUserId === actor.userId;
      if (ownerOverride && !actor.access.isOwner)
        throw AppError.forbidden('You cannot approve your own payment request.');
      let disbursementId: string | null = null;
      let overpaid = false;
      if (input.decision === 'approve') {
        if (req.kind === 'supplier_payment') {
          await assertPayable(tx, req.supplierId!, req.purchaseOrderId);
          if (req.purchaseOrderId)
            overpaid = await assertNotOverpaid(
              tx,
              actor,
              req.purchaseOrderId,
              req.amountMinor,
              actor.access.isOwner,
            );
        }
        const treasury = await branchTreasury(tx, req.branchId);
        await lockAccounts(tx, [treasury.id]);
        assertTreasuryCounted(treasury);
        assertCovers(await accountBalance(tx, treasury.id), req.amountMinor, 'treasury');
        disbursementId = await postDisbursement(tx, {
          merchantId: actor.merchantId,
          branchId: req.branchId,
          sourceAccountId: treasury.id,
          shiftId: null,
          kind: req.kind as 'expense' | 'supplier_payment',
          category: req.category,
          supplierId: req.supplierId,
          purchaseOrderId: req.purchaseOrderId,
          amountMinor: req.amountMinor,
          description: req.description,
          receiptReference: req.receiptReference,
          userId: req.requestedByUserId,
        });
      }
      await tx
        .update(cashPayoutRequests)
        .set({
          status: input.decision === 'approve' ? 'approved' : 'rejected',
          decidedByUserId: actor.userId,
          decidedAt: sql`now()`,
          decisionNote: input.note,
          disbursementId,
        })
        .where(eq(cashPayoutRequests.id, id));
      await this.record(
        tx,
        actor,
        input.decision === 'approve'
          ? 'cash.payout_request.approved'
          : 'cash.payout_request.rejected',
        id,
        ip,
        {
          amount: decimal(req.amountMinor),
          requestedBy: req.requestedByUserId,
          note: input.note,
          disbursementId,
          ...(ownerOverride ? { ownerOverride: true } : {}),
          ...(overpaid ? { overpaymentConfirmed: true } : {}),
        },
      );
    });
    return this.requestById(actor, id);
  }

  async withdrawRequest(actor: MerchantActor, id: string, ip: string): Promise<CashPayoutRequest> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [req] = await tx
        .select()
        .from(cashPayoutRequests)
        .where(eq(cashPayoutRequests.id, id))
        .for('update');
      if (!req) throw AppError.notFound('Payout request not found.');
      assertCan(actor, 'cash.custody', req.branchId);
      if (req.requestedByUserId !== actor.userId)
        throw AppError.forbidden('Only the person who made the request can withdraw it.');
      if (req.status !== 'pending')
        throw new AppError(409, 'MOVEMENT_DECIDED', 'This request was already decided.');
      await tx
        .update(cashPayoutRequests)
        .set({ status: 'withdrawn', decidedByUserId: actor.userId, decidedAt: sql`now()` })
        .where(eq(cashPayoutRequests.id, id));
      await this.record(tx, actor, 'cash.payout_request.withdrawn', id, ip, {
        amount: decimal(req.amountMinor),
      });
    });
    return this.requestById(actor, id);
  }

  private async requestById(actor: MerchantActor, id: string): Promise<CashPayoutRequest> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await this.requestRows(tx, sql`q.id = ${id}`);
      if (!row) throw AppError.notFound('Payout request not found.');
      return row;
    });
  }

  private async requestRows(tx: Transaction, where: SQL): Promise<CashPayoutRequest[]> {
    const rows = (
      await tx.execute(sql`
        select q.*, b.name_en as b_en, b.name_ar as b_ar, s.name_en as s_en, s.name_ar as s_ar,
               po.number as po_number, ru.full_name as requested_by, du.full_name as decided_by
        from cash_payout_requests q
        join branches b on b.id = q.branch_id
        left join suppliers s on s.id = q.supplier_id
        left join purchase_orders po on po.id = q.purchase_order_id
        join users ru on ru.id = q.requested_by_user_id
        left join users du on du.id = q.decided_by_user_id
        where ${where}
        order by q.created_at desc, q.id desc
        limit 200`)
    ).rows as Row[];
    return rows.map((r) => ({
      id: r['id'] as string,
      kind: r['kind'] as CashPayoutRequest['kind'],
      category: (r['category'] as CashPayoutRequest['category']) ?? null,
      supplier: r['supplier_id']
        ? { id: r['supplier_id'] as string, nameEn: str(r['s_en']), nameAr: str(r['s_ar']) }
        : null,
      purchaseOrder: r['purchase_order_id']
        ? { id: r['purchase_order_id'] as string, number: r['po_number'] as string }
        : null,
      branch: { id: r['branch_id'] as string, nameEn: str(r['b_en']), nameAr: str(r['b_ar']) },
      amount: money(BigInt(r['amount_minor'] as string)),
      description: str(r['description']),
      receiptReference: str(r['receipt_reference']),
      status: r['status'] as CashPayoutRequest['status'],
      requestedBy: r['requested_by'] as string,
      requestedByUserId: r['requested_by_user_id'] as string,
      createdAt: iso(r['created_at'])!,
      decidedBy: str(r['decided_by']),
      decidedAt: iso(r['decided_at']),
      decisionNote: str(r['decision_note']),
      disbursementId: str(r['disbursement_id']),
    }));
  }

  // ------------------------------------------------------------ variances
  async listVariances(actor: MerchantActor, query: VarianceQuery) {
    const scope = branchScope(actor, 'shifts.view_all', query.branchId, sql`v.branch_id`);
    const filters: SQL[] = [scope ?? sql`true`];
    if (query.status === 'open') filters.push(sql`v.f_status is null`);
    if (query.status === 'resolved') filters.push(sql`v.f_status is not null`);
    if (query.from) filters.push(sql`v.occurred_at >= ${query.from}::date`);
    if (query.to) filters.push(sql`v.occurred_at < ${query.to}::date + 1`);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`select * from (${varianceRows(actor.merchantId)}) v
          where ${and(...filters)} order by v.occurred_at desc limit 200`)
      ).rows as Row[];
      const [open] = (
        await tx.execute(sql`select count(*)::int as n from (${varianceRows(actor.merchantId)}) v
          where ${scope ?? sql`true`} and v.f_status is null`)
      ).rows as { n: number }[];
      return {
        variances: rows.map((r): CashVariance => ({
          sourceType: r['source_type'] as CashVariance['sourceType'],
          sourceId: r['source_id'] as string,
          branchId: r['branch_id'] as string,
          place: {
            kind: r['place_kind'] as CashVariance['place']['kind'],
            nameEn: str(r['name_en']),
            nameAr: str(r['name_ar']),
          },
          amount: money(BigInt(r['amount'] as string)),
          occurredAt: iso(r['occurred_at'])!,
          accountable: str(r['accountable']),
          sourceNote: str(r['source_note']),
          followup: r['f_status']
            ? {
                status: r['f_status'] as 'explained' | 'settled' | 'written_off',
                note: r['f_note'] as string,
                resolvedBy: r['f_by'] as string,
                resolvedAt: iso(r['f_at'])!,
              }
            : null,
        })),
        openCount: Number(open?.n ?? 0),
      };
    });
  }

  /**
   * Records what management decided about a difference. Anyone who monitors shifts may
   * explain it; settling or writing it off needs cash custody at the branch (BR-167).
   */
  async resolveVariance(
    actor: MerchantActor,
    sourceType: CashVariance['sourceType'],
    sourceId: string,
    input: ResolveInput,
    ip: string,
  ) {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [v] = (
        await tx.execute(sql`select * from (${varianceRows(actor.merchantId)}) v
          where v.source_type = ${sourceType} and v.source_id = ${sourceId}`)
      ).rows as Row[];
      if (!v) throw AppError.notFound('This difference does not exist.');
      const branchId = v['branch_id'] as string;
      assertCan(actor, 'shifts.view_all', branchId);
      if (input.status !== 'explained') assertCan(actor, 'cash.custody', branchId);
      const previous = str(v['f_status']);
      await tx
        .insert(varianceFollowups)
        .values({
          id: newId(),
          merchantId: actor.merchantId,
          sourceType,
          sourceId,
          status: input.status,
          note: input.note,
          resolvedByUserId: actor.userId,
        })
        .onConflictDoUpdate({
          target: [
            varianceFollowups.merchantId,
            varianceFollowups.sourceType,
            varianceFollowups.sourceId,
          ],
          set: {
            status: input.status,
            note: input.note,
            resolvedByUserId: actor.userId,
            resolvedAt: sql`now()`,
            updatedAt: sql`now()`,
          },
        });
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'cash.variance.followup',
        targetType: sourceType,
        targetId: sourceId,
        ip,
        details: {
          amount: decimal(BigInt(v['amount'] as string)),
          status: { from: previous, to: input.status },
          note: input.note,
        },
      });
    });
    return this.listVariances(actor, { status: 'all' } as VarianceQuery).then((list) =>
      list.variances.find((x) => x.sourceId === sourceId)!,
    );
  }

  private record(
    tx: Transaction,
    actor: MerchantActor,
    action: string,
    targetId: string,
    ip: string,
    details: Record<string, unknown>,
  ) {
    return this.audit.recordIn(tx, {
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action,
      targetType: 'cash_payout_request',
      targetId,
      ip,
      details,
    });
  }
}
