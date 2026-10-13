import {
  type Adjustment,
  type AdjustmentKind,
  type AdjustmentStatus,
  COSTING_METHOD,
  type InventorySettings,
  type InventorySummary,
  type Movement,
  type MovementType,
  type PosAvailability,
  type StockLevel,
  type VariantStock,
  type DamagedReturn,
  type adjustmentListQuerySchema,
  type createAdjustmentSchema,
  type damagedReturnQuerySchema,
  type disposeDamagedReturnSchema,
  type decideAdjustmentSchema,
  type movementQuerySchema,
  type setThresholdSchema,
  type stockLevelQuerySchema,
  type updateInventorySettingsSchema,
} from '@arabat/contracts';
import {
  MICRO_PER_MINOR,
  Money,
  MoneyError,
  QuantityError,
  formatQuantity,
  parseQuantity,
  quantityValueMicro,
} from '@arabat/money';
import { can, permissionBranchScope } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { type SQL, and, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { nextDocumentNumber } from '../../database/schema/sequences.schema.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { merchantTimezone, withinLocalDays } from '../../kernel/time/period.js';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { branches } from '../branches/branches.schema.js';
import { stockPolicy } from '../cash/approval-limits.js';
import {
  damagedReturns,
  inventorySettings,
  stockAdjustmentLines,
  stockAdjustments,
  stockLevels,
} from './inventory.schema.js';
import { StockLedgerService, stockStatus } from './stock-ledger.service.js';

type CreateAdjustmentInput = z.output<typeof createAdjustmentSchema>;
type DecisionInput = z.output<typeof decideAdjustmentSchema>;
type DamagedQuery = z.output<typeof damagedReturnQuerySchema>;
type DisposeInput = z.output<typeof disposeDamagedReturnSchema>;
type PlannedLine = { variantId: string; quantityMilli: bigint; unitCostMinor: bigint | null };
type LevelQuery = z.output<typeof stockLevelQuerySchema>;
type MovementQuery = z.output<typeof movementQuerySchema>;
type AdjustmentQuery = z.output<typeof adjustmentListQuerySchema>;

const CURRENCY = 'KWD' as const;
const money = (minor: bigint | string | null) =>
  minor === null ? null : Money.ofMinor(BigInt(minor), CURRENCY).toJSON();
const qty = (value: string | null) =>
  value === null ? null : formatQuantity(parseQuantity(value));
const milli = (value: string | null) => (value === null ? null : parseQuantity(value));
const iso = (value: unknown) =>
  value === null || value === undefined ? null : new Date(value as string).toISOString();

const MOVEMENT_FOR_KIND: Record<AdjustmentKind, MovementType> = {
  opening: 'opening',
  increase: 'adjustment',
  decrease: 'adjustment',
  count: 'count',
};

/** null = every branch of the merchant; otherwise the branch ids the actor may read. */
type BranchScope = string[] | null;

/**
 * Inventory management (Prompt 8): stock documents (opening, increase, decrease, count),
 * balances, history, low-stock thresholds, valuation at moving weighted-average cost and
 * the negative-stock policy. Balances only change through `StockLedgerService`.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly ledger: StockLedgerService,
  ) {}

  // ------------------------------------------------------------ access helpers
  private readScope(actor: MerchantActor, branchId?: string): BranchScope {
    if (branchId) {
      assertCan(actor, 'inventory.read', branchId);
      return [branchId];
    }
    const scope = permissionBranchScope(actor.access, 'inventory.read');
    if (scope.all) return null;
    if (scope.branchIds.length === 0) throw AppError.forbidden();
    return [...scope.branchIds];
  }

  /** Costs and values are visible with `catalog.prices.manage` or `reports.inventory` for the whole scope. */
  private costVisible(actor: MerchantActor, scope: BranchScope): boolean {
    if (can(actor.access, 'catalog.prices.manage', null)) return true;
    const reports = permissionBranchScope(actor.access, 'reports.inventory');
    if (reports.all) return true;
    if (scope === null) return false;
    return scope.every((id) => reports.branchIds.includes(id));
  }

  private async assertBranchActive(tx: Transaction, branchId: string): Promise<void> {
    const [branch] = await tx
      .select({ status: branches.status })
      .from(branches)
      .where(eq(branches.id, branchId));
    if (!branch) throw AppError.notFound('Branch not found.');
    if (branch.status !== 'active')
      throw new AppError(409, 'BRANCH_INACTIVE', 'This branch is inactive.');
  }

  // ------------------------------------------------------------ adjustments
  async createAdjustment(
    actor: MerchantActor,
    input: CreateAdjustmentInput,
    ip: string,
  ): Promise<Adjustment> {
    assertCan(actor, 'inventory.adjust', input.branchId);
    const withCost = input.kind === 'opening' || input.kind === 'increase';
    const issues: { path: string; code: string; message: string }[] = [];
    const lines = input.lines.map((line, i) => {
      let quantityMilli = 0n;
      try {
        quantityMilli = parseQuantity(line.quantity);
      } catch (error) {
        if (!(error instanceof QuantityError)) throw error;
        issues.push({ path: `lines.${i}.quantity`, code: 'invalid', message: 'Invalid quantity.' });
      }
      if (input.kind !== 'count' && quantityMilli <= 0n)
        issues.push({
          path: `lines.${i}.quantity`,
          code: 'too_small',
          message: 'Quantity must be greater than zero.',
        });
      let unitCostMinor: bigint | null = null;
      if (line.unitCost !== null) {
        if (!withCost)
          issues.push({
            path: `lines.${i}.unitCost`,
            code: 'not_allowed',
            message: 'A unit cost is only entered for incoming stock.',
          });
        try {
          unitCostMinor = Money.parse(line.unitCost, CURRENCY).minor;
        } catch (error) {
          if (!(error instanceof MoneyError)) throw error;
          issues.push({ path: `lines.${i}.unitCost`, code: 'invalid', message: 'Invalid cost.' });
        }
      }
      return { variantId: line.variantId, quantityMilli, unitCostMinor };
    });
    if (issues.length > 0)
      throw new AppError(400, 'INVALID_QUANTITY', 'Some quantities are invalid.', issues);
    if (
      lines.some((l) => l.unitCostMinor !== null) &&
      !can(actor.access, 'catalog.prices.manage', null)
    )
      throw AppError.forbidden('Entering costs requires the price management permission.');

    const requestHash = createHash('sha256')
      .update(JSON.stringify({ ...input, idempotencyKey: undefined }))
      .digest('hex');

    if (input.idempotencyKey) {
      const replay = await this.findByIdempotencyKey(actor, input.idempotencyKey, requestHash);
      if (replay) return replay;
    }

    const adjustmentId = newId();
    try {
      await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        await this.assertBranchActive(tx, input.branchId);
        await this.assertAdjustable(
          tx,
          lines.map((l) => l.variantId),
          input.kind,
        );
        // Counts (BR-170): stock that moved since the sheet was started is reported until
        // the counter acknowledges it, so a count never silently overwrites a sale or receipt.
        if (input.kind === 'count' && input.startedAt && !input.acknowledgeMovements)
          await this.assertNoMovementsSince(tx, input.branchId, lines, input.startedAt);
        // Value at cost before anything is posted: above the company limit the document waits
        // for a second person (BR-169, D2); the owner posts directly, flagged. Opening stock
        // is the initial load and never waits.
        const policy = await stockPolicy(tx, actor.merchantId);
        const estimate = await this.estimateValue(tx, input.branchId, input.kind, lines);
        const limitExceeded =
          input.kind !== 'opening' && estimate.valueMinor > policy.adjustmentLimitMinor;
        const pending = limitExceeded && !actor.access.isOwner;
        const number = await nextDocumentNumber(tx, actor.merchantId, 'stock_adjustment', 'ADJ');
        await tx.insert(stockAdjustments).values({
          id: adjustmentId,
          merchantId: actor.merchantId,
          number,
          branchId: input.branchId,
          kind: input.kind,
          reason: input.reason,
          note: input.note,
          status: pending ? 'pending' : 'posted',
          valueMinor: estimate.valueMinor,
          limitExceeded,
          ownerOverride: limitExceeded && actor.access.isOwner,
          startedAt: input.startedAt ? new Date(input.startedAt) : null,
          movementsAcknowledged: Boolean(input.acknowledgeMovements),
          idempotencyKey: input.idempotencyKey ?? null,
          requestHash,
          createdByUserId: actor.userId,
        });
        if (pending) {
          // Lines keep what was asked and the balance seen; nothing moves yet.
          await tx.insert(stockAdjustmentLines).values(
            lines.map((l, i) => ({
              merchantId: actor.merchantId,
              adjustmentId,
              variantId: l.variantId,
              quantity: formatQuantity(l.quantityMilli),
              previousOnHand: formatQuantity(estimate.lines[i]!.previousMilli),
              delta: formatQuantity(estimate.lines[i]!.deltaMilli),
              unitCostMinor: l.unitCostMinor,
            })),
          );
          await this.audit.recordIn(tx, {
            merchantId: actor.merchantId,
            actorType: 'user',
            actorId: actor.userId,
            action: 'inventory.adjustment_requested',
            targetType: 'stock_adjustment',
            targetId: adjustmentId,
            ip,
            details: {
              number,
              branchId: input.branchId,
              kind: input.kind,
              reason: input.reason,
              value: Money.ofMinor(estimate.valueMinor, CURRENCY).toDecimalString(),
              limit: Money.ofMinor(policy.adjustmentLimitMinor, CURRENCY).toDecimalString(),
            },
          });
          return;
        }
        const applied = await this.post(tx, actor.merchantId, actor.userId, {
          id: adjustmentId,
          branchId: input.branchId,
          kind: input.kind,
          reason: input.reason,
          note: input.note,
          lines,
          insertLines: true,
        });
        await this.audit.recordIn(tx, {
          merchantId: actor.merchantId,
          actorType: 'user',
          actorId: actor.userId,
          action: 'inventory.adjusted',
          targetType: 'stock_adjustment',
          targetId: adjustmentId,
          ip,
          details: {
            number,
            branchId: input.branchId,
            kind: input.kind,
            reason: input.reason,
            value: Money.ofMinor(applied.valueMinor, CURRENCY).toDecimalString(),
            ...(limitExceeded ? { limitExceeded: true, ownerOverride: true } : {}),
            ...(input.acknowledgeMovements ? { movementsAcknowledged: true } : {}),
            lines: applied.lines.map((a) => ({
              variantId: a.variantId,
              delta: formatQuantity(a.deltaMilli),
              balance: formatQuantity(a.balanceMilli),
            })),
          },
        });
      });
    } catch (error) {
      // A concurrent retry with the same key won the race: answer with its result.
      if (input.idempotencyKey && isUniqueViolation(error, 'stock_adjustments_idempotency_key')) {
        const replay = await this.findByIdempotencyKey(actor, input.idempotencyKey, requestHash);
        if (replay) return replay;
      }
      throw error;
    }
    return this.getAdjustment(actor, adjustmentId);
  }

  /**
   * Writes the movements of a document through the ledger and records the applied lines.
   * Used when posting directly and when approving a pending document. Returns the value at
   * cost actually posted (Σ |delta| × unit cost).
   */
  private async post(
    tx: Transaction,
    merchantId: string,
    userId: string,
    doc: {
      id: string;
      branchId: string;
      kind: AdjustmentKind;
      reason: string;
      note: string | null;
      lines: PlannedLine[];
      insertLines: boolean;
    },
  ) {
    const applied = await this.ledger.apply(
      tx,
      {
        merchantId,
        branchId: doc.branchId,
        movementType: MOVEMENT_FOR_KIND[doc.kind],
        reason: doc.reason,
        sourceType: 'stock_adjustment',
        sourceId: doc.id,
        note: doc.note,
        userId,
        requireNoHistory: doc.kind === 'opening',
      },
      doc.lines.map((l) => ({
        variantId: l.variantId,
        mode: doc.kind === 'count' ? 'set' : 'delta',
        quantityMilli: doc.kind === 'decrease' ? -l.quantityMilli : l.quantityMilli,
        unitCostMinor: l.unitCostMinor,
      })),
    );
    let valueMinor = 0n;
    for (const a of applied) if (a.valueMinor !== null) valueMinor += abs(a.valueMinor);
    if (doc.insertLines)
      await tx.insert(stockAdjustmentLines).values(
        applied.map((a, i) => ({
          merchantId,
          adjustmentId: doc.id,
          variantId: a.variantId,
          quantity: formatQuantity(doc.lines[i]!.quantityMilli),
          previousOnHand: formatQuantity(a.previousMilli),
          delta: formatQuantity(a.deltaMilli),
          unitCostMinor: a.unitCostMinor,
        })),
      );
    else
      for (const a of applied)
        await tx
          .update(stockAdjustmentLines)
          .set({
            previousOnHand: formatQuantity(a.previousMilli),
            delta: formatQuantity(a.deltaMilli),
            unitCostMinor: a.unitCostMinor,
          })
          .where(
            and(
              eq(stockAdjustmentLines.adjustmentId, doc.id),
              eq(stockAdjustmentLines.variantId, a.variantId),
            ),
          );
    await tx.update(stockAdjustments).set({ valueMinor }).where(eq(stockAdjustments.id, doc.id));
    return { lines: applied, valueMinor };
  }

  /**
   * What the document would move and what it is worth at cost, from the current balances
   * (no locks: the figure decides whether approval is needed; posting recomputes it).
   */
  private async estimateValue(
    tx: Transaction,
    branchId: string,
    kind: AdjustmentKind,
    lines: PlannedLine[],
  ) {
    const rows = (
      await tx.execute(sql`
        select v.id, v.cost_minor::text as cost, coalesce(l.on_hand, 0)::text as on_hand,
               coalesce(l.avg_cost_micro, l.avg_cost_minor * 1000)::text as avg
        from product_variants v
        left join stock_levels l on l.variant_id = v.id and l.branch_id = ${branchId}
        where v.id in (${sql.join(
          lines.map((l) => sql`${l.variantId}`),
          sql`, `,
        )})`)
    ).rows as { id: string; cost: string | null; on_hand: string; avg: string | null }[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    let valueMinor = 0n;
    const planned = lines.map((l) => {
      const r = byId.get(l.variantId);
      const previousMilli = r ? parseQuantity(r.on_hand) : 0n;
      const deltaMilli =
        kind === 'count'
          ? l.quantityMilli - previousMilli
          : kind === 'decrease'
            ? -l.quantityMilli
            : l.quantityMilli;
      const avg = r?.avg ? BigInt(r.avg) : null;
      const catalog = r?.cost ? BigInt(r.cost) * MICRO_PER_MINOR : null;
      const typed = l.unitCostMinor === null ? null : l.unitCostMinor * MICRO_PER_MINOR;
      const cost = deltaMilli > 0n ? (typed ?? avg ?? catalog) : (avg ?? catalog);
      if (cost !== null) valueMinor += quantityValueMicro(abs(deltaMilli), cost);
      return { variantId: l.variantId, previousMilli, deltaMilli };
    });
    return { valueMinor, lines: planned };
  }

  /** Movements of the counted items at the branch since the sheet was started (BR-170). */
  private async assertNoMovementsSince(
    tx: Transaction,
    branchId: string,
    lines: PlannedLine[],
    startedAt: string,
  ) {
    const rows = (
      await tx.execute(sql`
        select m.variant_id, sum(m.quantity)::text as net, count(*)::int as n,
               string_agg(distinct m.movement_type, ',') as types
        from stock_movements m
        where m.branch_id = ${branchId} and m.created_at > ${startedAt}::timestamptz
          and m.variant_id in (${sql.join(
            lines.map((l) => sql`${l.variantId}`),
            sql`, `,
          )})
        group by m.variant_id`)
    ).rows as { variant_id: string; net: string; n: number; types: string }[];
    if (rows.length === 0) return;
    throw new AppError(
      409,
      'STOCK_MOVED_SINCE_COUNT',
      'Stock moved while the count was in progress. Review the movements and confirm the count.',
      rows.map((r) => ({
        path: `lines.${lines.findIndex((l) => l.variantId === r.variant_id)}`,
        code: 'moved_since_count',
        message: `net=${formatQuantity(parseQuantity(r.net))} movements=${r.n} types=${r.types}`,
      })),
    );
  }

  /**
   * A second holder of the adjust right approves (posting the movements now) or rejects a
   * pending document. Nobody decides their own; the owner may, flagged in the audit log.
   */
  async decideAdjustment(
    actor: MerchantActor,
    id: string,
    input: DecisionInput,
    ip: string,
  ): Promise<Adjustment> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [doc] = await tx
        .select()
        .from(stockAdjustments)
        .where(eq(stockAdjustments.id, id))
        .for('update');
      if (!doc) throw AppError.notFound();
      assertCan(actor, 'inventory.adjust', doc.branchId);
      if (doc.status !== 'pending')
        throw new AppError(409, 'ADJUSTMENT_DECIDED', 'This adjustment was already decided.');
      const ownerOverride = doc.createdByUserId === actor.userId;
      if (ownerOverride && !actor.access.isOwner)
        throw AppError.forbidden('You cannot approve your own stock adjustment.');
      let value: bigint | null = doc.valueMinor;
      if (input.decision === 'approve') {
        await this.assertBranchActive(tx, doc.branchId);
        const stored = await tx
          .select()
          .from(stockAdjustmentLines)
          .where(eq(stockAdjustmentLines.adjustmentId, id));
        const lines: PlannedLine[] = stored.map((l) => ({
          variantId: l.variantId,
          quantityMilli: parseQuantity(l.quantity),
          unitCostMinor: l.unitCostMinor,
        }));
        await this.assertAdjustable(
          tx,
          lines.map((l) => l.variantId),
          doc.kind as AdjustmentKind,
        );
        value = (
          await this.post(tx, actor.merchantId, doc.createdByUserId, {
            id,
            branchId: doc.branchId,
            kind: doc.kind as AdjustmentKind,
            reason: doc.reason,
            note: doc.note,
            lines,
            insertLines: false,
          })
        ).valueMinor;
      }
      await tx
        .update(stockAdjustments)
        .set({
          status: input.decision === 'approve' ? 'posted' : 'rejected',
          decidedByUserId: actor.userId,
          decidedAt: sql`now()`,
          decisionNote: input.note,
        })
        .where(eq(stockAdjustments.id, id));
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action:
          input.decision === 'approve'
            ? 'inventory.adjustment_approved'
            : 'inventory.adjustment_rejected',
        targetType: 'stock_adjustment',
        targetId: id,
        ip,
        details: {
          number: doc.number,
          requestedBy: doc.createdByUserId,
          value: value === null ? null : Money.ofMinor(value, CURRENCY).toDecimalString(),
          note: input.note,
          ...(ownerOverride ? { ownerOverride: true } : {}),
        },
      });
    });
    return this.getAdjustment(actor, id);
  }

  /** The requester takes a pending document back. */
  async withdrawAdjustment(actor: MerchantActor, id: string, ip: string): Promise<Adjustment> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [doc] = await tx
        .select()
        .from(stockAdjustments)
        .where(eq(stockAdjustments.id, id))
        .for('update');
      if (!doc) throw AppError.notFound();
      assertCan(actor, 'inventory.adjust', doc.branchId);
      if (doc.status !== 'pending')
        throw new AppError(409, 'ADJUSTMENT_DECIDED', 'This adjustment was already decided.');
      if (doc.createdByUserId !== actor.userId)
        throw AppError.forbidden('Only the requester can withdraw an adjustment.');
      await tx
        .update(stockAdjustments)
        .set({ status: 'withdrawn', decidedByUserId: actor.userId, decidedAt: sql`now()` })
        .where(eq(stockAdjustments.id, id));
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'inventory.adjustment_withdrawn',
        targetType: 'stock_adjustment',
        targetId: id,
        ip,
        details: { number: doc.number },
      });
    });
    return this.getAdjustment(actor, id);
  }

  private async findByIdempotencyKey(
    actor: MerchantActor,
    key: string,
    requestHash: string,
  ): Promise<Adjustment | null> {
    const [existing] = await this.database.withMerchantTx(actor.merchantId, (tx) =>
      tx
        .select({ id: stockAdjustments.id, requestHash: stockAdjustments.requestHash })
        .from(stockAdjustments)
        .where(eq(stockAdjustments.idempotencyKey, key)),
    );
    if (!existing) return null;
    if (existing.requestHash !== requestHash)
      throw new AppError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This request key was already used for a different adjustment.',
      );
    return this.getAdjustment(actor, existing.id);
  }

  /**
   * Manual adjustments only for stock-tracked items; archived items can still be written
   * off or counted (never increased), so no balance is ever frozen (BR-171).
   */
  private async assertAdjustable(
    tx: Transaction,
    variantIds: string[],
    kind: AdjustmentKind = 'increase',
  ): Promise<void> {
    const rows = (
      await tx.execute(sql`
        select v.id, v.status as variant_status, p.status as product_status, p.track_inventory
        from product_variants v join products p on p.id = v.product_id
        where v.id in (${sql.join(
          variantIds.map((id) => sql`${id}`),
          sql`, `,
        )})`)
    ).rows as {
      id: string;
      variant_status: string;
      product_status: string;
      track_inventory: boolean;
    }[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const issues = variantIds.flatMap((id, i) => {
      const r = byId.get(id);
      if (!r)
        return [{ path: `lines.${i}.variantId`, code: 'not_found', message: 'Item not found.' }];
      if (!r.track_inventory)
        return [
          {
            path: `lines.${i}.variantId`,
            code: 'not_tracked',
            message: 'Stock is not tracked for this item.',
          },
        ];
      if (
        (r.variant_status !== 'active' || r.product_status !== 'active') &&
        kind !== 'decrease' &&
        kind !== 'count'
      )
        return [
          {
            path: `lines.${i}.variantId`,
            code: 'archived',
            message: 'This item is archived; it can only be written off or counted.',
          },
        ];
      return [];
    });
    if (issues.length > 0)
      throw new AppError(
        409,
        'NOT_STOCK_TRACKED',
        'Some items cannot be adjusted (not tracked, archived or missing).',
        issues,
      );
  }

  async getAdjustment(actor: MerchantActor, id: string): Promise<Adjustment> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [header] = (
        await tx.execute(sql`
          select a.id, a.number, a.branch_id, a.kind, a.reason, a.note, a.status, a.value_minor::text as value_minor,
                 a.limit_exceeded, a.owner_override, a.decided_at, a.decision_note, a.started_at,
                 a.movements_acknowledged, a.created_at, a.created_by_user_id, u.full_name,
                 d.full_name as decided_by
          from stock_adjustments a join users u on u.id = a.created_by_user_id
          left join users d on d.id = a.decided_by_user_id
          where a.id = ${id}`)
      ).rows as Record<string, string>[];
      if (!header) throw AppError.notFound();
      assertCan(actor, 'inventory.read', header['branch_id']!);
      const costVisible = this.costVisible(actor, [header['branch_id']!]);
      const lines = (
        await tx.execute(sql`
          select l.variant_id, l.quantity, l.previous_on_hand, l.delta, l.unit_cost_minor,
                 p.name_en, p.name_ar, v.name_en as variant_name_en, v.name_ar as variant_name_ar, v.sku
          from stock_adjustment_lines l
          join product_variants v on v.id = l.variant_id
          join products p on p.id = v.product_id
          where l.adjustment_id = ${id}
          order by coalesce(lower(p.name_en), p.name_ar), v.position`)
      ).rows as Record<string, string | null>[];
      return {
        id: header['id']!,
        branchId: header['branch_id']!,
        kind: header['kind'] as AdjustmentKind,
        reason: header['reason']!,
        note: header['note'] ?? null,
        ...controlFields(header as Record<string, unknown>, costVisible),
        startedAt: iso(header['started_at']),
        movementsAcknowledged: Boolean(header['movements_acknowledged']),
        createdAt: iso(header['created_at'])!,
        createdBy: { userId: header['created_by_user_id']!, fullName: header['full_name']! },
        lines: lines.map((l) => ({
          variantId: l['variant_id']!,
          nameEn: l['name_en'] ?? null,
          nameAr: l['name_ar'] ?? null,
          variantNameEn: l['variant_name_en'] ?? null,
          variantNameAr: l['variant_name_ar'] ?? null,
          sku: l['sku'] ?? null,
          quantity: qty(l['quantity']!)!,
          previousOnHand: qty(l['previous_on_hand']!)!,
          delta: qty(l['delta']!)!,
          newOnHand: formatQuantity(
            parseQuantity(l['previous_on_hand']!) + parseQuantity(l['delta']!),
          ),
          ...(costVisible ? { unitCost: money(l['unit_cost_minor'] ?? null) } : {}),
        })),
      };
    });
  }

  async listAdjustments(actor: MerchantActor, query: AdjustmentQuery) {
    const scope = this.readScope(actor, query.branchId);
    const costVisible = this.costVisible(actor, scope);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const where = and(
        branchIn(sql`a.branch_id`, scope),
        query.kind ? sql`a.kind = ${query.kind}` : undefined,
        query.status ? sql`a.status = ${query.status}` : undefined,
      );
      const [total] = (
        await tx.execute(
          sql`select count(*)::int as n from stock_adjustments a where ${where ?? sql`true`}`,
        )
      ).rows as { n: number }[];
      const rows = (
        await tx.execute(sql`
          select a.id, a.number, a.branch_id, a.kind, a.reason, a.note, a.status, a.value_minor::text as value_minor,
                 a.limit_exceeded, a.owner_override, a.decided_at, a.decision_note, d.full_name as decided_by,
                 a.created_at, a.created_by_user_id, u.full_name,
                 (select count(*)::int from stock_adjustment_lines l where l.adjustment_id = a.id) as line_count
          from stock_adjustments a join users u on u.id = a.created_by_user_id
          left join users d on d.id = a.decided_by_user_id
          where ${where ?? sql`true`}
          order by a.created_at desc, a.id desc
          limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`)
      ).rows as Record<string, unknown>[];
      return {
        adjustments: rows.map((r) => ({
          id: r['id'] as string,
          branchId: r['branch_id'] as string,
          kind: r['kind'] as AdjustmentKind,
          reason: r['reason'] as string,
          note: (r['note'] as string | null) ?? null,
          ...controlFields(r, costVisible),
          lineCount: r['line_count'] as number,
          createdAt: iso(r['created_at'])!,
          createdBy: {
            userId: r['created_by_user_id'] as string,
            fullName: r['full_name'] as string,
          },
        })),
        total: total?.n ?? 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  // ------------------------------------------------------------ balances
  async listLevels(actor: MerchantActor, query: LevelQuery) {
    const scope = this.readScope(actor, query.branchId);
    const single = query.branchId ?? null;
    const costVisible = this.costVisible(actor, scope);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const base = levelsBase(scope);
      const filters: SQL[] = [];
      if (query.categoryId) filters.push(sql`p.category_id = ${query.categoryId}`);
      if (query.q) {
        const like = `%${escapeLike(query.q.toLowerCase())}%`;
        filters.push(sql`(lower(p.name_en) like ${like} or lower(p.name_ar) like ${like}
          or lower(v.name_en) like ${like} or lower(v.name_ar) like ${like} or lower(v.sku) like ${like}
          or exists (select 1 from product_barcodes b where b.variant_id = v.id and b.barcode = ${query.q}))`);
      }
      if (query.stock === 'out') filters.push(sql`coalesce(s.on_hand, 0) <= 0`);
      if (query.stock === 'low')
        filters.push(sql`coalesce(s.on_hand, 0) > 0 and coalesce(s.any_low, false)`);
      if (query.stock === 'in_stock')
        filters.push(sql`coalesce(s.on_hand, 0) > 0 and not coalesce(s.any_low, false)`);
      const where = sql.join([base.where, ...filters], sql` and `);
      const dir = sql.raw(query.direction);
      const order =
        query.sort === 'on_hand'
          ? sql`coalesce(s.on_hand, 0) ${dir}, v.id`
          : query.sort === 'updated'
            ? sql`s.last_movement_at ${dir} nulls last, v.id`
            : sql`coalesce(lower(p.name_en), p.name_ar) ${dir}, v.position, v.id`;
      const [total] = (await tx.execute(sql`select count(*)::int as n ${base.from} where ${where}`))
        .rows as { n: number }[];
      const rows = (
        await tx.execute(sql`
          select v.id as variant_id, p.id as product_id, p.name_en, p.name_ar,
                 v.name_en as variant_name_en, v.name_ar as variant_name_ar, v.sku,
                 coalesce(s.on_hand, 0)::text as on_hand, s.threshold::text as threshold, s.any_low,
                 s.avg_cost, s.value_minor::text as value_minor, s.last_movement_at
          ${base.from} where ${where}
          order by ${order}
          limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`)
      ).rows as Record<string, unknown>[];
      const levels: StockLevel[] = rows.map((r) => {
        const onHand = parseQuantity(r['on_hand'] as string);
        const threshold = single ? milli((r['threshold'] as string | null) ?? null) : null;
        return {
          variantId: r['variant_id'] as string,
          productId: r['product_id'] as string,
          nameEn: (r['name_en'] as string | null) ?? null,
          nameAr: (r['name_ar'] as string | null) ?? null,
          variantNameEn: (r['variant_name_en'] as string | null) ?? null,
          variantNameAr: (r['variant_name_ar'] as string | null) ?? null,
          sku: (r['sku'] as string | null) ?? null,
          branchId: single,
          onHand: formatQuantity(onHand),
          lowStockThreshold: threshold === null ? null : formatQuantity(threshold),
          status: onHand > 0n && !single && r['any_low'] ? 'low' : stockStatus(onHand, threshold),
          ...(costVisible
            ? {
                avgCost: single ? money((r['avg_cost'] as string | null) ?? null) : null,
                value: money((r['value_minor'] as string | null) ?? '0'),
              }
            : {}),
          lastMovementAt: iso(r['last_movement_at']),
        };
      });
      return {
        levels,
        total: total?.n ?? 0,
        page: query.page,
        pageSize: query.pageSize,
        costVisible,
      };
    });
  }

  async summary(actor: MerchantActor, branchId?: string): Promise<InventorySummary> {
    const scope = this.readScope(actor, branchId);
    const costVisible = this.costVisible(actor, scope);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const base = levelsBase(scope);
      const [row] = (
        await tx.execute(sql`
          select count(*)::int as tracked,
                 count(*) filter (where coalesce(s.on_hand, 0) > 0 and coalesce(s.any_low, false))::int as low,
                 count(*) filter (where coalesce(s.on_hand, 0) <= 0)::int as out,
                 coalesce(sum(s.value_minor), 0)::text as value_minor,
                 count(*) filter (where coalesce(s.unvalued, false))::int as unvalued
          ${base.from} where ${base.where}`)
      ).rows as Record<string, unknown>[];
      return {
        branchId: branchId ?? null,
        trackedVariants: (row?.['tracked'] as number) ?? 0,
        lowStock: (row?.['low'] as number) ?? 0,
        outOfStock: (row?.['out'] as number) ?? 0,
        ...(costVisible ? { totalValue: money((row?.['value_minor'] as string) ?? '0') } : {}),
        unvaluedVariants: (row?.['unvalued'] as number) ?? 0,
        costingMethod: COSTING_METHOD,
        allowNegativeStock: await this.ledger.allowNegativeStock(tx, actor.merchantId),
      };
    });
  }

  async variantStock(actor: MerchantActor, variantId: string): Promise<VariantStock> {
    const scope = this.readScope(actor);
    const costVisible = this.costVisible(actor, scope);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [variant] = (
        await tx.execute(sql`
          select v.id, p.id as product_id, p.name_en, p.name_ar, v.name_en as variant_name_en,
                 v.name_ar as variant_name_ar, v.sku, p.track_inventory
          from product_variants v join products p on p.id = v.product_id where v.id = ${variantId}`)
      ).rows as Record<string, unknown>[];
      if (!variant) throw AppError.notFound();
      const rows = (
        await tx.execute(sql`
          select b.id, b.name_en, b.name_ar, coalesce(l.on_hand, 0)::text as on_hand,
                 l.low_stock_threshold::text as threshold, l.avg_cost_minor::text as avg_cost,
                 coalesce(l.avg_cost_micro, l.avg_cost_minor * 1000)::text as avg_micro
          from branches b
          left join stock_levels l on l.branch_id = b.id and l.variant_id = ${variantId}
          where ${branchIn(sql`b.id`, scope) ?? sql`true`} and (b.status = 'active' or coalesce(l.on_hand, 0) <> 0)
          order by b.is_main desc, b.name_en, b.name_ar`)
      ).rows as Record<string, string | null>[];
      let total = 0n;
      return {
        variantId,
        productId: variant['product_id'] as string,
        nameEn: (variant['name_en'] as string | null) ?? null,
        nameAr: (variant['name_ar'] as string | null) ?? null,
        variantNameEn: (variant['variant_name_en'] as string | null) ?? null,
        variantNameAr: (variant['variant_name_ar'] as string | null) ?? null,
        sku: (variant['sku'] as string | null) ?? null,
        trackInventory: variant['track_inventory'] as boolean,
        branches: rows.map((r) => {
          const onHand = parseQuantity(r['on_hand']!);
          total += onHand;
          const threshold = milli(r['threshold'] ?? null);
          const avg = r['avg_cost'] ? BigInt(r['avg_cost']) : null;
          const avgMicro = r['avg_micro'] ? BigInt(r['avg_micro']) : null;
          return {
            branchId: r['id']!,
            nameEn: r['name_en'] ?? null,
            nameAr: r['name_ar'] ?? null,
            onHand: formatQuantity(onHand),
            lowStockThreshold: threshold === null ? null : formatQuantity(threshold),
            status: stockStatus(onHand, threshold),
            ...(costVisible
              ? {
                  avgCost: money(avg),
                  value: money(
                    avgMicro === null || onHand === 0n ? 0n : quantityValueMicro(onHand, avgMicro),
                  ),
                }
              : {}),
          };
        }),
        total: formatQuantity(total),
      };
    });
  }

  async setThreshold(
    actor: MerchantActor,
    input: z.output<typeof setThresholdSchema>,
    ip: string,
  ): Promise<void> {
    assertCan(actor, 'inventory.adjust', input.branchId);
    const threshold =
      input.threshold === null ? null : formatQuantity(parseQuantity(input.threshold));
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [branch] = await tx
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.id, input.branchId));
      if (!branch) throw AppError.notFound('Branch not found.');
      await this.assertAdjustable(tx, [input.variantId]);
      await tx
        .insert(stockLevels)
        .values({
          merchantId: actor.merchantId,
          branchId: input.branchId,
          variantId: input.variantId,
          lowStockThreshold: threshold,
        })
        .onConflictDoUpdate({
          target: [stockLevels.merchantId, stockLevels.branchId, stockLevels.variantId],
          set: { lowStockThreshold: threshold, updatedAt: sql`now()` },
        });
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'inventory.threshold_set',
        targetType: 'product_variant',
        targetId: input.variantId,
        ip,
        details: { branchId: input.branchId, threshold },
      });
    });
  }

  // ------------------------------------------------------------ history
  async listMovements(actor: MerchantActor, query: MovementQuery) {
    const scope = this.readScope(actor, query.branchId);
    const costVisible = this.costVisible(actor, scope);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const tz = await merchantTimezone(tx, actor.merchantId);
      const conditions: SQL[] = [];
      const scoped = branchIn(sql`m.branch_id`, scope);
      if (scoped) conditions.push(scoped);
      if (query.variantId) conditions.push(sql`m.variant_id = ${query.variantId}`);
      if (query.type) conditions.push(sql`m.movement_type = ${query.type}`);
      // Calendar days in the merchant's time zone, inclusive (BR-184).
      conditions.push(withinLocalDays(tz, sql`m.created_at`, query.from, query.to));
      const where = conditions.length ? sql.join(conditions, sql` and `) : sql`true`;
      const [total] = (
        await tx.execute(sql`select count(*)::int as n from stock_movements m where ${where}`)
      ).rows as { n: number }[];
      const rows = (
        await tx.execute(sql`
          select m.*, m.quantity::text as qty, m.balance_after::text as balance,
                 p.name_en, p.name_ar, v.name_en as variant_name_en, v.name_ar as variant_name_ar, v.sku,
                 u.full_name
          from stock_movements m
          join product_variants v on v.id = m.variant_id
          join products p on p.id = v.product_id
          left join users u on u.id = m.created_by_user_id
          where ${where}
          order by m.created_at desc, m.id desc
          limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}`)
      ).rows as Record<string, unknown>[];
      const movements: Movement[] = rows.map((r) => ({
        id: r['id'] as string,
        branchId: r['branch_id'] as string,
        variantId: r['variant_id'] as string,
        nameEn: (r['name_en'] as string | null) ?? null,
        nameAr: (r['name_ar'] as string | null) ?? null,
        variantNameEn: (r['variant_name_en'] as string | null) ?? null,
        variantNameAr: (r['variant_name_ar'] as string | null) ?? null,
        sku: (r['sku'] as string | null) ?? null,
        movementType: r['movement_type'] as MovementType,
        reason: (r['reason'] as string | null) ?? null,
        quantity: qty(r['qty'] as string)!,
        balanceAfter: qty(r['balance'] as string)!,
        ...(costVisible
          ? {
              unitCost: money((r['unit_cost_minor'] as string | null) ?? null),
              value: money((r['value_minor'] as string | null) ?? null),
            }
          : {}),
        sourceType: r['source_type'] as string,
        sourceId: r['source_id'] as string,
        note: (r['note'] as string | null) ?? null,
        createdBy: r['created_by_user_id']
          ? { userId: r['created_by_user_id'] as string, fullName: r['full_name'] as string }
          : null,
        createdAt: iso(r['created_at'])!,
      }));
      return { movements, total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
    });
  }

  // ------------------------------------------------------------ returned goods (BR-175)
  async listDamagedReturns(actor: MerchantActor, query: DamagedQuery) {
    const scope = this.readScope(actor, query.branchId);
    const costVisible = this.costVisible(actor, scope);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const where = and(
        branchIn(sql`d.branch_id`, scope),
        query.status === 'all' ? undefined : sql`d.status = ${query.status}`,
      );
      const rows = (
        await tx.execute(sql`
          select d.*, d.quantity::text as qty, d.unit_cost_minor::text as cost, r.refund_number,
                 p.name_en, p.name_ar, v.name_en as v_en, v.name_ar as v_ar, v.sku, u.full_name
          from damaged_returns d
          join refunds r on r.id = d.refund_id
          join product_variants v on v.id = d.variant_id join products p on p.id = v.product_id
          left join users u on u.id = d.disposed_by_user_id
          where ${where ?? sql`true`}
          order by d.status desc, d.created_at desc limit 500`)
      ).rows as Record<string, unknown>[];
      const [held] = (
        await tx.execute(sql`select count(*)::int as n from damaged_returns d
          where d.status = 'held' and ${branchIn(sql`d.branch_id`, scope) ?? sql`true`}`)
      ).rows as { n: number }[];
      return {
        returns: rows.map((r) => this.damagedReturn(r, costVisible)),
        heldCount: Number(held?.n ?? 0),
      };
    });
  }

  /** Records what was done with returned goods kept out of stock (held → disposed, once). */
  async disposeDamagedReturn(
    actor: MerchantActor,
    id: string,
    input: DisposeInput,
    ip: string,
  ): Promise<DamagedReturn> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(damagedReturns)
        .where(eq(damagedReturns.id, id))
        .for('update');
      if (!row) throw AppError.notFound();
      assertCan(actor, 'inventory.adjust', row.branchId);
      if (row.status !== 'held')
        throw new AppError(409, 'INVALID_STATE', 'These goods were already disposed of.');
      await tx
        .update(damagedReturns)
        .set({
          status: 'disposed',
          disposedByUserId: actor.userId,
          disposedAt: sql`now()`,
          disposalNote: input.note,
        })
        .where(eq(damagedReturns.id, id));
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'inventory.damaged_return_disposed',
        targetType: 'damaged_return',
        targetId: id,
        ip,
        details: {
          refundId: row.refundId,
          variantId: row.variantId,
          quantity: formatQuantity(parseQuantity(row.quantity)),
          note: input.note,
        },
      });
    });
    const scope = this.readScope(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [r] = (
        await tx.execute(sql`
          select d.*, d.quantity::text as qty, d.unit_cost_minor::text as cost, r.refund_number,
                 p.name_en, p.name_ar, v.name_en as v_en, v.name_ar as v_ar, v.sku, u.full_name
          from damaged_returns d join refunds r on r.id = d.refund_id
          join product_variants v on v.id = d.variant_id join products p on p.id = v.product_id
          left join users u on u.id = d.disposed_by_user_id where d.id = ${id}`)
      ).rows as Record<string, unknown>[];
      return this.damagedReturn(r!, this.costVisible(actor, scope));
    });
  }

  private damagedReturn(r: Record<string, unknown>, costVisible: boolean): DamagedReturn {
    return {
      id: r['id'] as string,
      refundId: r['refund_id'] as string,
      refundNumber: r['refund_number'] as string,
      branchId: r['branch_id'] as string,
      variantId: r['variant_id'] as string,
      nameEn: (r['name_en'] as string | null) ?? null,
      nameAr: (r['name_ar'] as string | null) ?? null,
      variantNameEn: (r['v_en'] as string | null) ?? null,
      variantNameAr: (r['v_ar'] as string | null) ?? null,
      sku: (r['sku'] as string | null) ?? null,
      quantity: formatQuantity(parseQuantity(r['qty'] as string)),
      ...(costVisible ? { unitCost: money((r['cost'] as string | null) ?? null) } : {}),
      reason: r['reason'] as string,
      status: r['status'] as 'held' | 'disposed',
      createdAt: iso(r['created_at'])!,
      disposedBy: (r['full_name'] as string | null) ?? null,
      disposedAt: iso(r['disposed_at']),
      disposalNote: (r['disposal_note'] as string | null) ?? null,
    };
  }

  // ------------------------------------------------------------ settings
  async getSettings(actor: MerchantActor): Promise<InventorySettings> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(inventorySettings)
        .where(eq(inventorySettings.merchantId, actor.merchantId));
      const policy = await stockPolicy(tx, actor.merchantId);
      return {
        allowNegativeStock: row?.allowNegativeStock ?? false,
        costingMethod: COSTING_METHOD,
        adjustmentApprovalLimit: money(policy.adjustmentLimitMinor)!,
        blindStockCount: policy.blindStockCount,
        version: row?.version ?? 1,
      };
    });
  }

  async updateSettings(
    actor: MerchantActor,
    input: z.output<typeof updateInventorySettingsSchema>,
    ip: string,
  ): Promise<InventorySettings> {
    assertCan(actor, 'merchant.settings.update', null);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(inventorySettings)
        .where(eq(inventorySettings.merchantId, actor.merchantId))
        .for('update');
      if ((row?.version ?? 1) !== input.version) throw versionConflict();
      if (row) {
        await tx
          .update(inventorySettings)
          .set({
            allowNegativeStock: input.allowNegativeStock,
            version: sql`${inventorySettings.version} + 1`,
            updatedAt: sql`now()`,
          })
          .where(eq(inventorySettings.merchantId, actor.merchantId));
      } else {
        await tx.insert(inventorySettings).values({
          merchantId: actor.merchantId,
          allowNegativeStock: input.allowNegativeStock,
          version: 2,
        });
      }
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'inventory.settings_updated',
        targetType: 'merchant',
        targetId: actor.merchantId,
        ip,
        details: {
          allowNegativeStock: {
            from: row?.allowNegativeStock ?? false,
            to: input.allowNegativeStock,
          },
        },
      });
    });
    return this.getSettings(actor);
  }

  // ------------------------------------------------------------ POS
  async posAvailability(actor: MerchantActor, variantIds?: string[]): Promise<PosAvailability> {
    const branchId = actor.boundBranchId;
    if (!branchId) throw AppError.forbidden();
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const filter =
        variantIds && variantIds.length > 0
          ? sql`and v.id in (${sql.join(
              variantIds.map((id) => sql`${id}`),
              sql`, `,
            )})`
          : sql``;
      const rows = (
        await tx.execute(sql`
          select v.id, coalesce(l.on_hand, 0)::text as on_hand, l.low_stock_threshold::text as threshold
          from product_variants v join products p on p.id = v.product_id
          left join stock_levels l on l.variant_id = v.id and l.branch_id = ${branchId}
          where p.track_inventory and p.status = 'active' and v.status = 'active' ${filter}`)
      ).rows as Record<string, string | null>[];
      return {
        branchId,
        allowNegativeStock: await this.ledger.allowNegativeStock(tx, actor.merchantId),
        items: rows.map((r) => {
          const onHand = parseQuantity(r['on_hand']!);
          return {
            variantId: r['id']!,
            onHand: formatQuantity(onHand),
            status: stockStatus(onHand, milli(r['threshold'] ?? null)),
          };
        }),
      };
    });
  }
}

const abs = (v: bigint) => (v < 0n ? -v : v);

/** Approval facts of a document row (BR-169). */
function controlFields(r: Record<string, unknown>, costVisible: boolean) {
  return {
    number: (r['number'] as string | null) ?? null,
    status: r['status'] as AdjustmentStatus,
    ...(costVisible ? { value: money((r['value_minor'] as string | null) ?? null) } : {}),
    limitExceeded: Boolean(r['limit_exceeded']),
    ownerOverride: Boolean(r['owner_override']),
    decidedBy: (r['decided_by'] as string | null) ?? null,
    decidedAt: iso(r['decided_at']),
    decisionNote: (r['decision_note'] as string | null) ?? null,
  };
}

function branchIn(column: SQL, scope: BranchScope): SQL | undefined {
  if (scope === null) return undefined;
  if (scope.length === 0) return sql`false`;
  return sql`${column} in (${sql.join(
    scope.map((id) => sql`${id}`),
    sql`, `,
  )})`;
}

/**
 * Tracked variants with their balance aggregated over the branch scope. Archived items stay
 * listed while they still hold stock. Value counts positive balances at average cost,
 * rounded half-up per balance (PostgreSQL `round` on numeric rounds half away from zero).
 */
function levelsBase(scope: BranchScope): { from: SQL; where: SQL } {
  const scoped = branchIn(sql`l.branch_id`, scope);
  return {
    from: sql`from product_variants v
      join products p on p.id = v.product_id
      left join lateral (
        select sum(l.on_hand) as on_hand,
               max(l.low_stock_threshold) as threshold,
               max(l.avg_cost_minor) as avg_cost,
               bool_or(l.low_stock_threshold is not null and l.on_hand <= l.low_stock_threshold) as any_low,
               -- Balances are valued at the micro-precision average; a negative balance keeps
               -- its cost basis and counts negatively (BR-174).
               sum(case when l.on_hand <> 0 and coalesce(l.avg_cost_micro, l.avg_cost_minor * 1000) is not null
                        then round(l.on_hand * coalesce(l.avg_cost_micro, l.avg_cost_minor * 1000) / 1000) else 0 end) as value_minor,
               bool_or(l.on_hand <> 0 and l.avg_cost_minor is null) as unvalued,
               max(l.last_movement_at) as last_movement_at
        from stock_levels l
        where l.variant_id = v.id ${scoped ? sql`and ${scoped}` : sql``}
      ) s on true`,
    where: sql`p.track_inventory and ((p.status = 'active' and v.status = 'active') or coalesce(s.on_hand, 0) <> 0)`,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
