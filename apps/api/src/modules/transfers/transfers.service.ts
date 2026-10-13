import type {
  InTransitSummary,
  Transfer,
  TransferLoss,
  claimTransferLossSchema,
  createTransferSchema,
  decideTransferLossSchema,
  recallTransferSchema,
  transferListQuerySchema,
  transferQuantitiesSchema,
} from '@arabat/contracts';
import { Money, formatQuantity, parseQuantity, quantityValue } from '@arabat/money';
import { can, permissionBranchScope } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { type SQL, asc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { nextDocumentNumber } from '../../database/schema/sequences.schema.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { stockPolicy } from '../cash/approval-limits.js';
import { StockLedgerService } from '../inventory/stock-ledger.service.js';
import { assertStockItems } from '../purchasing/purchasing.service.js';
import {
  stockTransferLines,
  stockTransferLossLines,
  stockTransferLosses,
  stockTransfers,
} from './transfers.schema.js';

type CreateInput = z.output<typeof createTransferSchema>;
type QuantitiesInput = z.output<typeof transferQuantitiesSchema>;
type ListQuery = z.output<typeof transferListQuerySchema>;
type RecallInput = z.output<typeof recallTransferSchema>;
type ClaimInput = z.output<typeof claimTransferLossSchema>;
type LossDecision = z.output<typeof decideTransferLossSchema>;
type LineRow = typeof stockTransferLines.$inferSelect;

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const money = (minor: bigint) => Money.ofMinor(minor, 'KWD').toJSON();
const decimal = (minor: bigint) => Money.ofMinor(minor, 'KWD').toDecimalString();
const q = (v: string | null | undefined) => (v == null ? 0n : parseQuantity(v));

/** Quantity of a line still on the road: dispatched − received − recalled − posted losses. */
function inTransitOf(line: LineRow, lostMilli: bigint): bigint {
  const left =
    q(line.dispatchedQuantity) - q(line.receivedQuantity) - q(line.recalledQuantity) - lostMilli;
  return left > 0n ? left : 0n;
}

/**
 * Branch-to-branch stock transfers (Prompt 12), on the existing inventory ledger:
 * dispatch = `transfer_out` at the source (never below zero, regardless of the merchant's
 * negative-stock policy); receipt = `transfer_in` at the destination at the dispatch cost.
 * Between the two the goods are in transit. Each step locks the transfer row and checks
 * its status and version, so a step can never run twice.
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly ledger: StockLedgerService,
  ) {}

  async create(actor: MerchantActor, input: CreateInput, ip: string): Promise<Transfer> {
    if (
      !can(actor.access, 'inventory.transfer', input.sourceBranchId) &&
      !can(actor.access, 'inventory.transfer', input.destinationBranchId)
    )
      throw AppError.forbidden();
    const lines = input.lines.map((l, i) => {
      const q = parseQuantity(l.quantity);
      if (q <= 0n)
        throw new AppError(400, 'INVALID_QUANTITY', 'Quantity must be positive.', [
          { path: `lines.${i}.quantity`, code: 'too_small', message: 'Quantity must be positive.' },
        ]);
      return { variantId: l.variantId, quantityMilli: q };
    });
    const id = newId();
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      for (const b of [input.sourceBranchId, input.destinationBranchId]) {
        const [row] = (await tx.execute(sql`select status from branches where id = ${b}`)).rows as {
          status: string;
        }[];
        if (!row) throw AppError.notFound('Branch not found.');
        if (row.status !== 'active')
          throw new AppError(409, 'BRANCH_INACTIVE', 'Both branches must be active.');
      }
      await assertStockItems(
        tx,
        lines.map((l) => l.variantId),
      );
      const number = await nextDocumentNumber(tx, actor.merchantId, 'transfer', 'TR');
      await tx.insert(stockTransfers).values({
        id,
        merchantId: actor.merchantId,
        number,
        sourceBranchId: input.sourceBranchId,
        destinationBranchId: input.destinationBranchId,
        note: input.note,
        requestedByUserId: actor.userId,
      });
      await tx.insert(stockTransferLines).values(
        lines.map((l, position) => ({
          merchantId: actor.merchantId,
          transferId: id,
          position,
          variantId: l.variantId,
          requestedQuantity: formatQuantity(l.quantityMilli),
        })),
      );
      await this.record(tx, actor, 'transfer.requested', id, ip, { number });
    });
    return this.get(actor, id);
  }

  async approve(actor: MerchantActor, id: string, version: number, ip: string): Promise<Transfer> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const t = await this.lock(tx, id, version);
      assertCan(actor, 'inventory.transfer.approve', t.sourceBranchId);
      if (t.status !== 'requested') throw this.state('Only requested transfers can be approved.');
      await this.update(tx, id, {
        status: 'approved',
        approvedByUserId: actor.userId,
        approvedAt: sql`now()`,
      });
      await this.record(tx, actor, 'transfer.approved', id, ip);
    });
    return this.get(actor, id);
  }

  async cancel(actor: MerchantActor, id: string, version: number, ip: string): Promise<Transfer> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const t = await this.lock(tx, id, version);
      const allowed =
        t.requestedByUserId === actor.userId ||
        can(actor.access, 'inventory.transfer.approve', t.sourceBranchId);
      if (!allowed) throw AppError.forbidden();
      if (!['requested', 'approved'].includes(t.status))
        throw this.state('Transfers can only be cancelled before dispatch.');
      await this.update(tx, id, {
        status: 'cancelled',
        cancelledByUserId: actor.userId,
        cancelledAt: sql`now()`,
      });
      await this.record(tx, actor, 'transfer.cancelled', id, ip);
    });
    return this.get(actor, id);
  }

  /** Stock leaves the source branch and is in transit. */
  async dispatch(
    actor: MerchantActor,
    id: string,
    input: QuantitiesInput,
    ip: string,
  ): Promise<Transfer> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const t = await this.lock(tx, id, input.version);
      assertCan(actor, 'inventory.transfer', t.sourceBranchId);
      if (t.status !== 'approved') throw this.state('Only approved transfers can be dispatched.');
      const lines = await tx
        .select()
        .from(stockTransferLines)
        .where(eq(stockTransferLines.transferId, id))
        .orderBy(asc(stockTransferLines.position));
      const quantities = this.quantities(
        input,
        lines.map((l) => ({ position: l.position, maxMilli: parseQuantity(l.requestedQuantity) })),
      );
      const moving = lines.filter((l) => (quantities.get(l.position) ?? 0n) > 0n);
      if (moving.length === 0)
        throw AppError.validation([
          { path: 'lines', code: 'empty', message: 'Dispatch at least one item.' },
        ]);
      // Goods on the road are valued at dispatch cost (BR-173): an item with no average and
      // no catalog cost cannot leave until a cost is set (FND-623).
      await this.assertCostsKnown(tx, t.sourceBranchId, moving);
      const applied = await this.ledger.apply(
        tx,
        {
          merchantId: actor.merchantId,
          branchId: t.sourceBranchId,
          movementType: 'transfer_out',
          sourceType: 'transfer',
          sourceId: id,
          note: t.number,
          userId: actor.userId,
          negative: 'deny',
        },
        moving.map((l) => ({
          variantId: l.variantId,
          mode: 'delta' as const,
          quantityMilli: -quantities.get(l.position)!,
        })),
      );
      for (const l of lines) {
        const idx = moving.indexOf(l);
        await tx
          .update(stockTransferLines)
          .set({
            dispatchedQuantity: formatQuantity(quantities.get(l.position) ?? 0n),
            unitCostMinor: idx >= 0 ? applied[idx]!.unitCostMinor : null,
          })
          .where(
            sql`${stockTransferLines.transferId} = ${id} and ${stockTransferLines.position} = ${l.position}`,
          );
      }
      await this.update(tx, id, {
        status: 'in_transit',
        dispatchedByUserId: actor.userId,
        dispatchedAt: sql`now()`,
      });
      await this.record(tx, actor, 'transfer.dispatched', id, ip, {
        lines: lines.map((l) => ({
          position: l.position,
          quantity: formatQuantity(quantities.get(l.position) ?? 0n),
        })),
      });
    });
    return this.get(actor, id);
  }

  /** The destination confirms what arrived; anything missing is recorded as a discrepancy. */
  async receive(
    actor: MerchantActor,
    id: string,
    input: QuantitiesInput,
    ip: string,
  ): Promise<Transfer> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const t = await this.lock(tx, id, input.version);
      assertCan(actor, 'inventory.transfer', t.destinationBranchId);
      if (t.status !== 'in_transit') throw this.state('Only transfers in transit can be received.');
      const lines = await tx
        .select()
        .from(stockTransferLines)
        .where(eq(stockTransferLines.transferId, id))
        .orderBy(asc(stockTransferLines.position));
      // Surplus is allowed and explained (BR-172, FND-622): the cap is lifted for receipt.
      const quantities = this.quantities(
        input,
        lines.map((l) => ({ position: l.position, maxMilli: null })),
      );
      const short = lines.some(
        (l) => (quantities.get(l.position) ?? 0n) < parseQuantity(l.dispatchedQuantity ?? '0'),
      );
      const over = lines.some(
        (l) => (quantities.get(l.position) ?? 0n) > parseQuantity(l.dispatchedQuantity ?? '0'),
      );
      if ((short || over) && !input.note)
        throw AppError.validation([
          {
            path: 'note',
            code: 'required',
            message: short ? 'Explain the missing quantity.' : 'Explain the surplus quantity.',
          },
        ]);
      const arriving = lines.filter((l) => (quantities.get(l.position) ?? 0n) > 0n);
      if (arriving.length > 0)
        await this.ledger.apply(
          tx,
          {
            merchantId: actor.merchantId,
            branchId: t.destinationBranchId,
            movementType: 'transfer_in',
            sourceType: 'transfer',
            sourceId: id,
            note: t.number,
            userId: actor.userId,
          },
          arriving.map((l) => ({
            variantId: l.variantId,
            mode: 'delta' as const,
            quantityMilli: quantities.get(l.position)!,
            unitCostMinor: l.unitCostMinor,
          })),
        );
      for (const l of lines)
        await tx
          .update(stockTransferLines)
          .set({ receivedQuantity: formatQuantity(quantities.get(l.position) ?? 0n) })
          .where(
            sql`${stockTransferLines.transferId} = ${id} and ${stockTransferLines.position} = ${l.position}`,
          );
      await this.update(tx, id, {
        status: 'received',
        receivedByUserId: actor.userId,
        receivedAt: sql`now()`,
        discrepancyNote: short || over ? input.note : null,
      });
      await this.record(
        tx,
        actor,
        short || over ? 'transfer.received_with_discrepancy' : 'transfer.received',
        id,
        ip,
        {
          lines: lines.map((l) => ({
            position: l.position,
            dispatched: l.dispatchedQuantity,
            received: formatQuantity(quantities.get(l.position) ?? 0n),
          })),
        },
      );
      // What did not arrive is written off explicitly, with the receiver's explanation; above
      // the company limit the source approver decides first (BR-172).
      if (short)
        await this.createLoss(
          tx,
          actor,
          { id, sourceBranchId: t.sourceBranchId },
          lines.map((l) => ({
            line: l,
            quantityMilli:
              parseQuantity(l.dispatchedQuantity ?? '0') - (quantities.get(l.position) ?? 0n),
          })),
          input.note!,
          ip,
        );
    });
    return this.get(actor, id);
  }

  /** Claims what is still on the road after receipt as a loss (after a rejection, or later). */
  async claimLoss(
    actor: MerchantActor,
    id: string,
    input: ClaimInput,
    ip: string,
  ): Promise<Transfer> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [t] = await tx
        .select()
        .from(stockTransfers)
        .where(eq(stockTransfers.id, id))
        .for('share');
      if (!t) throw AppError.notFound();
      assertCan(actor, 'inventory.transfer', t.destinationBranchId);
      if (t.status !== 'received') throw this.state('Only received transfers can carry a loss.');
      const lines = await this.lines(tx, id);
      const lost = await this.lostByPosition(tx, id, ['posted', 'pending']);
      const remaining = lines.map((line) => ({
        line,
        quantityMilli: inTransitOf(line, lost.get(line.position) ?? 0n),
      }));
      if (!remaining.some((r) => r.quantityMilli > 0n))
        throw this.state('Nothing of this transfer is unaccounted for.');
      await this.createLoss(
        tx,
        actor,
        { id, sourceBranchId: t.sourceBranchId },
        remaining,
        input.explanation,
        ip,
      );
    });
    return this.get(actor, id);
  }

  private async createLoss(
    tx: Transaction,
    actor: MerchantActor,
    t: { id: string; sourceBranchId: string },
    lines: { line: LineRow; quantityMilli: bigint }[],
    explanation: string,
    ip: string,
  ) {
    const losing = lines.filter((l) => l.quantityMilli > 0n);
    let valueMinor = 0n;
    for (const l of losing)
      if (l.line.unitCostMinor !== null)
        valueMinor += quantityValue(l.quantityMilli, l.line.unitCostMinor);
    const policy = await stockPolicy(tx, actor.merchantId);
    const limitExceeded = valueMinor > policy.adjustmentLimitMinor;
    const pending = limitExceeded && !actor.access.isOwner;
    const lossId = newId();
    const number = await nextDocumentNumber(tx, actor.merchantId, 'transfer_loss', 'TL');
    await tx.insert(stockTransferLosses).values({
      id: lossId,
      merchantId: actor.merchantId,
      transferId: t.id,
      number,
      status: pending ? 'pending' : 'posted',
      valueMinor,
      explanation,
      limitExceeded,
      ownerOverride: limitExceeded && actor.access.isOwner,
      claimedByUserId: actor.userId,
    });
    await tx.insert(stockTransferLossLines).values(
      losing.map((l) => ({
        merchantId: actor.merchantId,
        lossId,
        position: l.line.position,
        variantId: l.line.variantId,
        quantity: formatQuantity(l.quantityMilli),
        unitCostMinor: l.line.unitCostMinor,
      })),
    );
    await this.record(
      tx,
      actor,
      pending ? 'transfer.loss_requested' : 'transfer.loss_posted',
      t.id,
      ip,
      {
        lossId,
        number,
        value: decimal(valueMinor),
        limit: decimal(policy.adjustmentLimitMinor),
        lines: losing.map((l) => ({
          position: l.line.position,
          quantity: formatQuantity(l.quantityMilli),
        })),
        ...(limitExceeded && !pending ? { limitExceeded: true, ownerOverride: true } : {}),
      },
    );
  }

  /** The source approver accepts the write-off or rejects it (the shortage stays open). */
  async decideLoss(
    actor: MerchantActor,
    id: string,
    lossId: string,
    input: LossDecision,
    ip: string,
  ): Promise<Transfer> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [loss] = await tx
        .select()
        .from(stockTransferLosses)
        .where(eq(stockTransferLosses.id, lossId))
        .for('update');
      if (!loss || loss.transferId !== id) throw AppError.notFound();
      const [t] = await tx.select().from(stockTransfers).where(eq(stockTransfers.id, id));
      assertCan(actor, 'inventory.transfer.approve', t!.sourceBranchId);
      if (loss.status !== 'pending')
        throw new AppError(409, 'LOSS_DECIDED', 'This transfer loss was already decided.');
      const ownerOverride = loss.claimedByUserId === actor.userId;
      if (ownerOverride && !actor.access.isOwner)
        throw AppError.forbidden('You cannot approve a loss you claimed yourself.');
      await tx
        .update(stockTransferLosses)
        .set({
          status: input.decision === 'approve' ? 'posted' : 'rejected',
          decidedByUserId: actor.userId,
          decidedAt: sql`now()`,
          decisionNote: input.note,
        })
        .where(eq(stockTransferLosses.id, lossId));
      await this.record(
        tx,
        actor,
        input.decision === 'approve' ? 'transfer.loss_approved' : 'transfer.loss_rejected',
        id,
        ip,
        {
          lossId,
          number: loss.number,
          value: decimal(loss.valueMinor),
          claimedBy: loss.claimedByUserId,
          note: input.note,
          ...(ownerOverride ? { ownerOverride: true } : {}),
        },
      );
    });
    return this.get(actor, id);
  }

  /** Goods in transit come back to the source before receipt (BR-173). */
  async recall(
    actor: MerchantActor,
    id: string,
    input: RecallInput,
    ip: string,
  ): Promise<Transfer> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const t = await this.lock(tx, id, input.version);
      assertCan(actor, 'inventory.transfer', t.sourceBranchId);
      if (t.status !== 'in_transit') throw this.state('Only transfers in transit can be recalled.');
      const lines = (await this.lines(tx, id)).filter((l) => q(l.dispatchedQuantity) > 0n);
      await this.ledger.apply(
        tx,
        {
          merchantId: actor.merchantId,
          branchId: t.sourceBranchId,
          movementType: 'transfer_in',
          sourceType: 'transfer',
          sourceId: id,
          note: `${t.number} recalled`,
          userId: actor.userId,
        },
        lines.map((l) => ({
          variantId: l.variantId,
          mode: 'delta' as const,
          quantityMilli: q(l.dispatchedQuantity),
          unitCostMinor: l.unitCostMinor,
        })),
      );
      for (const l of lines)
        await tx
          .update(stockTransferLines)
          .set({ recalledQuantity: l.dispatchedQuantity })
          .where(
            sql`${stockTransferLines.transferId} = ${id} and ${stockTransferLines.position} = ${l.position}`,
          );
      await this.update(tx, id, {
        status: 'recalled',
        recalledByUserId: actor.userId,
        recalledAt: sql`now()`,
        recallNote: input.note,
      });
      await this.record(tx, actor, 'transfer.recalled', id, ip, {
        note: input.note,
        lines: lines.map((l) => ({ position: l.position, quantity: l.dispatchedQuantity })),
      });
    });
    return this.get(actor, id);
  }

  /** Everything on the road right now (BR-173): per transfer, valued at dispatch cost, aged. */
  async inTransit(actor: MerchantActor, branchId?: string): Promise<InTransitSummary> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
          select t.id, t.number, t.source_branch_id, t.destination_branch_id, t.status, t.dispatched_at,
                 coalesce(sum(greatest(l.dispatched_quantity - coalesce(l.received_quantity, 0)
                   - coalesce(l.recalled_quantity, 0) - coalesce(lp.lost, 0), 0)), 0)::text as qty,
                 coalesce(sum(round(greatest(l.dispatched_quantity - coalesce(l.received_quantity, 0)
                   - coalesce(l.recalled_quantity, 0) - coalesce(lp.lost, 0), 0) * coalesce(l.unit_cost_minor, 0))), 0)::text as value,
                 exists (select 1 from stock_transfer_losses x where x.transfer_id = t.id and x.status = 'pending') as pending_loss
          from stock_transfers t
          join stock_transfer_lines l on l.transfer_id = t.id
          left join lateral (
            select sum(ll.quantity) as lost from stock_transfer_loss_lines ll
            join stock_transfer_losses x on x.id = ll.loss_id
            where x.transfer_id = t.id and x.status = 'posted' and ll.position = l.position) lp on true
          where t.status in ('in_transit', 'received') and t.dispatched_at is not null and ${this.scope(actor, branchId)}
          group by t.id
          having sum(greatest(l.dispatched_quantity - coalesce(l.received_quantity, 0)
                   - coalesce(l.recalled_quantity, 0) - coalesce(lp.lost, 0), 0)) > 0
          order by t.dispatched_at`)
      ).rows as Record<string, unknown>[];
      const costVisible =
        can(actor.access, 'catalog.prices.manage', null) ||
        can(actor.access, 'reports.inventory', branchId ?? null);
      let quantity = 0n;
      let value = 0n;
      const transfers = rows.map((r) => {
        const qty = parseQuantity(r['qty'] as string);
        const val = BigInt(r['value'] as string);
        quantity += qty;
        value += val;
        const dispatchedAt = new Date(r['dispatched_at'] as string);
        return {
          id: r['id'] as string,
          number: r['number'] as string,
          sourceBranchId: r['source_branch_id'] as string,
          destinationBranchId: r['destination_branch_id'] as string,
          status: r['status'] as Transfer['status'],
          dispatchedAt: dispatchedAt.toISOString(),
          ageDays: Math.floor((Date.now() - dispatchedAt.getTime()) / 86_400_000),
          quantity: formatQuantity(qty),
          ...(costVisible ? { value: money(val) } : {}),
          unresolved: r['status'] === 'received',
          pendingLoss: Boolean(r['pending_loss']),
        };
      });
      return {
        transfers,
        quantity: formatQuantity(quantity),
        ...(costVisible ? { value: money(value) } : {}),
      };
    });
  }

  private async lines(tx: Transaction, id: string) {
    return tx
      .select()
      .from(stockTransferLines)
      .where(eq(stockTransferLines.transferId, id))
      .orderBy(asc(stockTransferLines.position));
  }

  /** Quantity covered by losses of the given statuses, per transfer line. */
  private async lostByPosition(tx: Transaction, id: string, statuses: string[]) {
    const rows = (
      await tx.execute(sql`
        select ll.position, sum(ll.quantity)::text as qty from stock_transfer_loss_lines ll
        join stock_transfer_losses x on x.id = ll.loss_id
        where x.transfer_id = ${id} and x.status in (${sql.join(
          statuses.map((s) => sql`${s}`),
          sql`, `,
        )})
        group by ll.position`)
    ).rows as { position: number; qty: string }[];
    return new Map(rows.map((r) => [Number(r.position), parseQuantity(r.qty)]));
  }

  private async assertCostsKnown(tx: Transaction, branchId: string, lines: LineRow[]) {
    const rows = (
      await tx.execute(sql`
        select v.id, coalesce(l.avg_cost_minor, v.cost_minor) as cost
        from product_variants v left join stock_levels l on l.variant_id = v.id and l.branch_id = ${branchId}
        where v.id in (${sql.join(
          lines.map((l) => sql`${l.variantId}`),
          sql`, `,
        )})`)
    ).rows as { id: string; cost: string | null }[];
    const unknown = rows.filter((r) => r.cost === null).map((r) => r.id);
    if (unknown.length > 0)
      throw new AppError(
        409,
        'COST_UNKNOWN',
        'Some items have no cost yet; set a cost on the product before dispatching them.',
        lines
          .filter((l) => unknown.includes(l.variantId))
          .map((l) => ({
            path: `lines.${l.position}`,
            code: 'cost_unknown',
            message: l.variantId,
          })),
      );
  }

  private quantities(
    input: QuantitiesInput,
    lines: { position: number; maxMilli: bigint | null }[],
  ): Map<number, bigint> {
    const result = new Map<number, bigint>();
    input.lines.forEach((l, i) => {
      const line = lines.find((x) => x.position === l.position);
      if (!line)
        throw AppError.validation([
          { path: `lines.${i}.position`, code: 'not_found', message: 'Not a transfer line.' },
        ]);
      if (result.has(l.position))
        throw AppError.validation([
          { path: 'lines', code: 'duplicate', message: 'Each line may appear only once.' },
        ]);
      const quantity = parseQuantity(l.quantity);
      if (line.maxMilli !== null && quantity > line.maxMilli)
        throw new AppError(409, 'RECEIVE_EXCEEDS_ORDER', 'More than requested or dispatched.', [
          {
            path: `lines.${i}.quantity`,
            code: 'too_big',
            message: `max=${formatQuantity(line.maxMilli)}`,
          },
        ]);
      result.set(l.position, quantity);
    });
    return result;
  }

  // ------------------------------------------------------------ reads
  async list(actor: MerchantActor, query: ListQuery) {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const c: SQL[] = [this.scope(actor, query.branchId)];
      if (query.status) c.push(sql`t.status = ${query.status}`);
      const where = sql.join(c, sql` and `);
      const [total] = (
        await tx.execute(sql`select count(*)::int as n from stock_transfers t where ${where}`)
      ).rows as { n: number }[];
      const ids = (
        await tx.execute(sql`select t.id from stock_transfers t where ${where} order by t.created_at desc, t.id desc
                             limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`)
      ).rows as { id: string }[];
      const transfers = [];
      for (const { id } of ids) {
        const { lines: _l, losses: _x, ...rest } = await this.load(tx, actor, id);
        transfers.push(rest);
      }
      return { transfers, total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
    });
  }

  async get(actor: MerchantActor, id: string): Promise<Transfer> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const t = await this.load(tx, actor, id);
      if (
        !can(actor.access, 'inventory.read', t.sourceBranchId) &&
        !can(actor.access, 'inventory.read', t.destinationBranchId)
      )
        throw AppError.forbidden();
      return t;
    });
  }

  private scope(actor: MerchantActor, branchId?: string): SQL {
    if (branchId) {
      assertCan(actor, 'inventory.read', branchId);
      return sql`(t.source_branch_id = ${branchId} or t.destination_branch_id = ${branchId})`;
    }
    const s = permissionBranchScope(actor.access, 'inventory.read');
    if (s.all) return sql`true`;
    if (s.branchIds.length === 0) throw AppError.forbidden();
    const list = sql.join(
      s.branchIds.map((b) => sql`${b}`),
      sql`, `,
    );
    return sql`(t.source_branch_id in (${list}) or t.destination_branch_id in (${list}))`;
  }

  private async load(tx: Transaction, actor: MerchantActor, id: string): Promise<Transfer> {
    const [t] = (
      await tx.execute(sql`
        select t.*, ru.full_name as requested_by, au.full_name as approved_by, du.full_name as dispatched_by,
               cu.full_name as received_by, xu.full_name as recalled_by
        from stock_transfers t join users ru on ru.id = t.requested_by_user_id
        left join users au on au.id = t.approved_by_user_id left join users du on du.id = t.dispatched_by_user_id
        left join users cu on cu.id = t.received_by_user_id left join users xu on xu.id = t.recalled_by_user_id
        where t.id = ${id}`)
    ).rows as Record<string, unknown>[];
    if (!t) throw AppError.notFound();
    const lines = (
      await tx.execute(sql`
        select l.*, l.requested_quantity::text as req, l.dispatched_quantity::text as disp, l.received_quantity::text as rec,
               l.recalled_quantity::text as rcl, l.unit_cost_minor::text as cost,
               p.name_en, p.name_ar, v.name_en as v_en, v.name_ar as v_ar, v.sku
        from stock_transfer_lines l join product_variants v on v.id = l.variant_id join products p on p.id = v.product_id
        where l.transfer_id = ${id} order by l.position`)
    ).rows as Record<string, unknown>[];
    const costVisible =
      can(actor.access, 'catalog.prices.manage', null) ||
      can(actor.access, 'reports.inventory', t['source_branch_id'] as string);
    const lossRows = (
      await tx.execute(sql`
        select x.*, x.value_minor::text as value, cu.full_name as claimed_by, du.full_name as decided_by,
               coalesce((select json_agg(json_build_object('position', ll.position, 'quantity', ll.quantity::text) order by ll.position)
                         from stock_transfer_loss_lines ll where ll.loss_id = x.id), '[]'::json) as lines
        from stock_transfer_losses x join users cu on cu.id = x.claimed_by_user_id
        left join users du on du.id = x.decided_by_user_id
        where x.transfer_id = ${id} order by x.created_at, x.id`)
    ).rows as Record<string, unknown>[];
    const losses: TransferLoss[] = lossRows.map((x) => ({
      id: x['id'] as string,
      number: x['number'] as string,
      status: x['status'] as TransferLoss['status'],
      ...(costVisible ? { value: money(BigInt(x['value'] as string)) } : {}),
      explanation: x['explanation'] as string,
      limitExceeded: Boolean(x['limit_exceeded']),
      ownerOverride: Boolean(x['owner_override']),
      claimedBy: x['claimed_by'] as string,
      claimedByUserId: x['claimed_by_user_id'] as string,
      createdAt: iso(x['created_at'])!,
      decidedBy: (x['decided_by'] as string | null) ?? null,
      decidedAt: iso(x['decided_at']),
      decisionNote: (x['decision_note'] as string | null) ?? null,
      lines: (x['lines'] as { position: number; quantity: string }[]).map((l) => ({
        position: l.position,
        quantity: formatQuantity(parseQuantity(l.quantity)),
      })),
    }));
    const lostBy = new Map<number, bigint>();
    for (const x of losses)
      if (x.status === 'posted')
        for (const l of x.lines)
          lostBy.set(l.position, (lostBy.get(l.position) ?? 0n) + parseQuantity(l.quantity));
    let discrepancy = 0n;
    let inTransit = 0n;
    let inTransitValue = 0n;
    let lost = 0n;
    return {
      id,
      number: t['number'] as string,
      sourceBranchId: t['source_branch_id'] as string,
      destinationBranchId: t['destination_branch_id'] as string,
      status: t['status'] as Transfer['status'],
      note: (t['note'] as string | null) ?? null,
      discrepancyNote: (t['discrepancy_note'] as string | null) ?? null,
      requestedBy: t['requested_by'] as string,
      approvedBy: (t['approved_by'] as string | null) ?? null,
      dispatchedBy: (t['dispatched_by'] as string | null) ?? null,
      receivedBy: (t['received_by'] as string | null) ?? null,
      recalledBy: (t['recalled_by'] as string | null) ?? null,
      recallNote: (t['recall_note'] as string | null) ?? null,
      createdAt: iso(t['created_at'])!,
      dispatchedAt: iso(t['dispatched_at']),
      receivedAt: iso(t['received_at']),
      recalledAt: iso(t['recalled_at']),
      lines: lines.map((l) => {
        const disp = l['disp'] === null ? null : parseQuantity(l['disp'] as string);
        const rec = l['rec'] === null ? null : parseQuantity(l['rec'] as string);
        const rcl = l['rcl'] === null ? null : parseQuantity(l['rcl'] as string);
        const diff = disp !== null && rec !== null ? disp - rec : null;
        if (diff) discrepancy += diff;
        const position = l['position'] as number;
        const lineLost = lostBy.get(position) ?? 0n;
        lost += lineLost;
        const left = disp === null ? 0n : disp - (rec ?? 0n) - (rcl ?? 0n) - lineLost;
        const onRoad = left > 0n ? left : 0n;
        inTransit += onRoad;
        const cost = l['cost'] === null ? null : BigInt(l['cost'] as string);
        if (cost !== null) inTransitValue += quantityValue(onRoad, cost);
        return {
          position,
          variantId: l['variant_id'] as string,
          nameEn: (l['name_en'] as string | null) ?? null,
          nameAr: (l['name_ar'] as string | null) ?? null,
          variantNameEn: (l['v_en'] as string | null) ?? null,
          variantNameAr: (l['v_ar'] as string | null) ?? null,
          sku: (l['sku'] as string | null) ?? null,
          requestedQuantity: formatQuantity(parseQuantity(l['req'] as string)),
          dispatchedQuantity: disp === null ? null : formatQuantity(disp),
          receivedQuantity: rec === null ? null : formatQuantity(rec),
          recalledQuantity: rcl === null ? null : formatQuantity(rcl),
          discrepancyQuantity: diff === null ? null : formatQuantity(diff),
          lostQuantity: formatQuantity(lineLost),
          inTransitQuantity: formatQuantity(onRoad),
          ...(costVisible ? { unitCost: cost === null ? null : money(cost) } : {}),
        };
      }),
      discrepancyQuantity: formatQuantity(discrepancy),
      inTransitQuantity: formatQuantity(inTransit),
      ...(costVisible ? { inTransitValue: money(inTransitValue) } : {}),
      lostQuantity: formatQuantity(lost),
      losses,
      version: t['version'] as number,
    };
  }

  private state(message: string) {
    return new AppError(409, 'INVALID_STATE', message);
  }

  private async lock(tx: Transaction, id: string, version: number) {
    const [t] = await tx
      .select()
      .from(stockTransfers)
      .where(eq(stockTransfers.id, id))
      .for('update');
    if (!t) throw AppError.notFound();
    if (t.version !== version) throw versionConflict();
    return t;
  }

  private async update(
    tx: Transaction,
    id: string,
    set: {
      [K in keyof typeof stockTransfers.$inferInsert]?:
        (typeof stockTransfers.$inferInsert)[K] | SQL;
    },
  ) {
    await tx
      .update(stockTransfers)
      .set({ ...set, version: sql`${stockTransfers.version} + 1`, updatedAt: sql`now()` })
      .where(eq(stockTransfers.id, id));
  }

  private record(
    tx: Transaction,
    actor: MerchantActor,
    action: string,
    id: string,
    ip: string,
    details: Record<string, unknown> = {},
  ) {
    return this.audit.recordIn(tx, {
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action,
      targetType: 'stock_transfer',
      targetId: id,
      ip,
      details,
    });
  }
}
