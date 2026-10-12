import {
  type Adjustment,
  type AdjustmentKind,
  COSTING_METHOD,
  type InventorySettings,
  type InventorySummary,
  type Movement,
  type MovementType,
  type PosAvailability,
  type StockLevel,
  type VariantStock,
  type adjustmentListQuerySchema,
  type createAdjustmentSchema,
  type movementQuerySchema,
  type setThresholdSchema,
  type stockLevelQuerySchema,
  type updateInventorySettingsSchema,
} from '@arabat/contracts';
import {
  Money,
  MoneyError,
  QuantityError,
  formatQuantity,
  parseQuantity,
  quantityValue,
} from '@arabat/money';
import { can, permissionBranchScope } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { type SQL, and, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { branches } from '../branches/branches.schema.js';
import { merchants } from '../merchants/merchants.schema.js';
import {
  inventorySettings,
  stockAdjustmentLines,
  stockAdjustments,
  stockLevels,
} from './inventory.schema.js';
import { StockLedgerService, stockStatus } from './stock-ledger.service.js';

type CreateAdjustmentInput = z.output<typeof createAdjustmentSchema>;
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
        );
        await tx.insert(stockAdjustments).values({
          id: adjustmentId,
          merchantId: actor.merchantId,
          branchId: input.branchId,
          kind: input.kind,
          reason: input.reason,
          note: input.note,
          idempotencyKey: input.idempotencyKey ?? null,
          requestHash,
          createdByUserId: actor.userId,
        });
        const applied = await this.ledger.apply(
          tx,
          {
            merchantId: actor.merchantId,
            branchId: input.branchId,
            movementType: MOVEMENT_FOR_KIND[input.kind],
            reason: input.reason,
            sourceType: 'stock_adjustment',
            sourceId: adjustmentId,
            note: input.note,
            userId: actor.userId,
            requireNoHistory: input.kind === 'opening',
          },
          lines.map((l) => ({
            variantId: l.variantId,
            mode: input.kind === 'count' ? 'set' : 'delta',
            quantityMilli: input.kind === 'decrease' ? -l.quantityMilli : l.quantityMilli,
            unitCostMinor: l.unitCostMinor,
          })),
        );
        await tx.insert(stockAdjustmentLines).values(
          applied.map((a, i) => ({
            merchantId: actor.merchantId,
            adjustmentId,
            variantId: a.variantId,
            quantity: formatQuantity(lines[i]!.quantityMilli),
            previousOnHand: formatQuantity(a.previousMilli),
            delta: formatQuantity(a.deltaMilli),
            unitCostMinor: a.unitCostMinor,
          })),
        );
        await this.audit.recordIn(tx, {
          merchantId: actor.merchantId,
          actorType: 'user',
          actorId: actor.userId,
          action: 'inventory.adjusted',
          targetType: 'stock_adjustment',
          targetId: adjustmentId,
          ip,
          details: {
            branchId: input.branchId,
            kind: input.kind,
            reason: input.reason,
            lines: applied.map((a) => ({
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

  /** Manual adjustments only for active, stock-tracked items. */
  private async assertAdjustable(tx: Transaction, variantIds: string[]): Promise<void> {
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
      if (r.variant_status !== 'active' || r.product_status !== 'active')
        return [
          { path: `lines.${i}.variantId`, code: 'archived', message: 'This item is archived.' },
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
          select a.id, a.branch_id, a.kind, a.reason, a.note, a.created_at, a.created_by_user_id, u.full_name
          from stock_adjustments a join users u on u.id = a.created_by_user_id
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
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const where = and(
        branchIn(sql`a.branch_id`, scope),
        query.kind ? sql`a.kind = ${query.kind}` : undefined,
      );
      const [total] = (
        await tx.execute(
          sql`select count(*)::int as n from stock_adjustments a where ${where ?? sql`true`}`,
        )
      ).rows as { n: number }[];
      const rows = (
        await tx.execute(sql`
          select a.id, a.branch_id, a.kind, a.reason, a.note, a.created_at, a.created_by_user_id, u.full_name,
                 (select count(*)::int from stock_adjustment_lines l where l.adjustment_id = a.id) as line_count
          from stock_adjustments a join users u on u.id = a.created_by_user_id
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
                 l.low_stock_threshold::text as threshold, l.avg_cost_minor::text as avg_cost
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
                  value: money(avg === null || onHand <= 0n ? 0n : quantityValue(onHand, avg)),
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
      const [merchant] = await tx
        .select({ timezone: merchants.timezone })
        .from(merchants)
        .where(eq(merchants.id, actor.merchantId));
      const tz = merchant?.timezone ?? 'Asia/Kuwait';
      const conditions: SQL[] = [];
      const scoped = branchIn(sql`m.branch_id`, scope);
      if (scoped) conditions.push(scoped);
      if (query.variantId) conditions.push(sql`m.variant_id = ${query.variantId}`);
      if (query.type) conditions.push(sql`m.movement_type = ${query.type}`);
      // Calendar dates in the merchant's time zone (inclusive).
      if (query.from)
        conditions.push(sql`m.created_at >= (${query.from}::date)::timestamp at time zone ${tz}`);
      if (query.to)
        conditions.push(
          sql`m.created_at < ((${query.to}::date + 1)::timestamp at time zone ${tz})`,
        );
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

  // ------------------------------------------------------------ settings
  async getSettings(actor: MerchantActor): Promise<InventorySettings> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(inventorySettings)
        .where(eq(inventorySettings.merchantId, actor.merchantId));
      return {
        allowNegativeStock: row?.allowNegativeStock ?? false,
        costingMethod: COSTING_METHOD,
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
               sum(case when l.on_hand > 0 and l.avg_cost_minor is not null
                        then round(l.on_hand * l.avg_cost_minor) else 0 end) as value_minor,
               bool_or(l.on_hand > 0 and l.avg_cost_minor is null) as unvalued,
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
