import type { MovementType, StockStatus } from '@arabat/contracts';
import {
  MICRO_PER_MINOR,
  formatQuantity,
  microToMinor,
  parseQuantity,
  quantityValue,
  quantityValueMicro,
  weightedAverageCostMicro,
} from '@arabat/money';
import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Transaction } from '../../database/database.service.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { productVariants, products } from '../catalog/catalog.schema.js';
import { inventorySettings, stockLevels, stockMovements } from './inventory.schema.js';

/** One requested change of a balance. */
export interface StockLineInput {
  variantId: string;
  /**
   * `delta`: signed change in milli-units (negative = out).
   * `set`: target balance (stock count); the change is computed under the row lock.
   */
  mode: 'delta' | 'set';
  quantityMilli: bigint;
  /** Unit cost of incoming stock (minor units). Defaults to the current average, then the variant cost. */
  unitCostMinor?: bigint | null;
}

export interface MovementContext {
  merchantId: string;
  branchId: string;
  movementType: MovementType;
  reason?: string | null;
  sourceType: string;
  sourceId: string;
  note?: string | null;
  userId: string | null;
  /**
   * Negative-stock policy for decreases: 'policy' follows the merchant setting (default
   * deny), 'deny' always refuses. Increases are never limited.
   */
  negative?: 'policy' | 'deny';
  /** Opening stock: refused when the item already has movements at the branch. */
  requireNoHistory?: boolean;
  /**
   * Online order whose own reservation this movement consumes (ADR-0079). Sales and
   * transfers out never take stock reserved for *other* unpaid online orders.
   */
  reservationOrderId?: string | null;
}

/** Movements that must leave stock reserved for online orders alone. */
const RESPECTS_RESERVATIONS: readonly MovementType[] = ['sale', 'transfer_out'];

export interface AppliedLine {
  variantId: string;
  tracked: boolean;
  previousMilli: bigint;
  deltaMilli: bigint;
  balanceMilli: bigint;
  unitCostMinor: bigint | null;
  /** Signed value of the movement at its (micro-precision) unit cost; null when unknown. */
  valueMinor: bigint | null;
  movementId: string | null;
}

/** Incoming stock at a typed cost is exact fils; everything else values at the micro cost. */
function movementValue(deltaMilli: bigint, unitCostMicro: bigint | null): bigint | null {
  if (unitCostMicro === null) return null;
  return unitCostMicro % MICRO_PER_MINOR === 0n
    ? quantityValue(deltaMilli, unitCostMicro / MICRO_PER_MINOR)
    : quantityValueMicro(deltaMilli, unitCostMicro);
}

export function stockStatus(onHandMilli: bigint, thresholdMilli: bigint | null): StockStatus {
  if (onHandMilli < 0n) return 'negative';
  if (onHandMilli === 0n) return 'out';
  if (thresholdMilli !== null && onHandMilli <= thresholdMilli) return 'low';
  return 'in_stock';
}

/**
 * The inventory engine (Prompt 8). The single place where stock balances change: every
 * change writes a ledger row (stock_movements) and updates the balance in the caller's
 * transaction, under `SELECT … FOR UPDATE` row locks taken in a fixed order (variant id),
 * so concurrent sales, refunds and adjustments serialize per item without deadlocks and
 * never lose an update. Sales (Prompt 10), refunds (11), purchasing and transfers (12)
 * call `apply` with their own source document.
 */
@Injectable()
export class StockLedgerService {
  async allowNegativeStock(tx: Transaction, merchantId: string): Promise<boolean> {
    const [row] = await tx
      .select({ allow: inventorySettings.allowNegativeStock })
      .from(inventorySettings)
      .where(eq(inventorySettings.merchantId, merchantId));
    return row?.allow ?? false;
  }

  async apply(
    tx: Transaction,
    ctx: MovementContext,
    lines: readonly StockLineInput[],
  ): Promise<AppliedLine[]> {
    if (lines.length === 0) return [];
    const variantIds = [...new Set(lines.map((l) => l.variantId))].sort();

    const variants = await tx
      .select({
        id: productVariants.id,
        costMinor: productVariants.costMinor,
        trackInventory: products.trackInventory,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.id, variantIds));
    const variantMap = new Map(variants.map((v) => [v.id, v]));
    for (const id of variantIds) {
      if (!variantMap.has(id)) throw AppError.notFound('Product variant not found.');
    }
    const tracked = variantIds.filter((id) => variantMap.get(id)!.trackInventory);

    // Lock (creating when missing) every affected balance in a deterministic order. The
    // average is carried at micro precision (BR-174); rows from before it are promoted.
    const levels = new Map<string, { onHand: bigint; avg: bigint | null }>();
    if (tracked.length > 0) {
      await tx
        .insert(stockLevels)
        .values(
          tracked.map((variantId) => ({
            merchantId: ctx.merchantId,
            branchId: ctx.branchId,
            variantId,
          })),
        )
        .onConflictDoNothing();
      const locked = await tx
        .select({
          variantId: stockLevels.variantId,
          onHand: stockLevels.onHand,
          avg: stockLevels.avgCostMinor,
          avgMicro: stockLevels.avgCostMicro,
        })
        .from(stockLevels)
        .where(and(eq(stockLevels.branchId, ctx.branchId), inArray(stockLevels.variantId, tracked)))
        .orderBy(stockLevels.variantId)
        .for('update');
      for (const l of locked)
        levels.set(l.variantId, {
          onHand: parseQuantity(l.onHand),
          avg: l.avgMicro ?? (l.avg === null ? null : l.avg * MICRO_PER_MINOR),
        });
    }

    if (ctx.requireNoHistory && tracked.length > 0) {
      const existing = await tx
        .selectDistinct({ variantId: stockMovements.variantId })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.branchId, ctx.branchId),
            inArray(stockMovements.variantId, tracked),
          ),
        );
      if (existing.length > 0) {
        throw new AppError(
          409,
          'OPENING_STOCK_EXISTS',
          'Opening stock can only be set before any other stock movement. Use an adjustment or a count.',
          existing.map((e) => ({
            path: `lines.${lines.findIndex((l) => l.variantId === e.variantId)}`,
            code: 'opening_stock_exists',
            message: e.variantId,
          })),
        );
      }
    }

    const allowNegative =
      (ctx.negative ?? 'policy') === 'policy'
        ? await this.allowNegativeStock(tx, ctx.merchantId)
        : false;
    const reserved =
      RESPECTS_RESERVATIONS.includes(ctx.movementType) && !allowNegative
        ? await this.reservedQuantities(tx, ctx.branchId, tracked, ctx.reservationOrderId ?? null)
        : new Map<string, bigint>();

    // Compute everything first so a shortage on any line rejects the whole document.
    const planned: (AppliedLine & { avgAfter: bigint | null; unitCostMicro: bigint | null })[] = [];
    const shortages: { index: number; variantId: string; available: bigint; requested: bigint }[] =
      [];
    lines.forEach((line, index) => {
      const variant = variantMap.get(line.variantId)!;
      const level = levels.get(line.variantId);
      if (!variant.trackInventory || !level) {
        planned.push({
          variantId: line.variantId,
          tracked: false,
          previousMilli: 0n,
          deltaMilli: 0n,
          balanceMilli: 0n,
          unitCostMinor: null,
          unitCostMicro: null,
          valueMinor: null,
          movementId: null,
          avgAfter: null,
        });
        return;
      }
      const previous = level.onHand;
      const delta = line.mode === 'set' ? line.quantityMilli - previous : line.quantityMilli;
      const balance = previous + delta;
      const held = reserved.get(line.variantId) ?? 0n;
      if (delta < 0n && balance < held && !allowNegative) {
        shortages.push({
          index,
          variantId: line.variantId,
          available: previous - held,
          requested: -delta,
        });
      }
      // Costs in micro units (BR-174); a typed cost is exact fils, an average may carry
      // fractions of a fils.
      let unitCostMicro: bigint | null;
      let avgAfter = level.avg;
      const catalogMicro = variant.costMinor === null ? null : variant.costMinor * MICRO_PER_MINOR;
      if (delta > 0n) {
        unitCostMicro =
          line.unitCostMinor != null
            ? line.unitCostMinor * MICRO_PER_MINOR
            : (level.avg ?? catalogMicro);
        if (unitCostMicro !== null)
          avgAfter = weightedAverageCostMicro(previous, level.avg, delta, unitCostMicro);
      } else {
        // Outgoing stock leaves at the current average cost; the average itself is unchanged.
        // Stock that goes negative with no average yet adopts the cost it left at as its basis.
        unitCostMicro = level.avg ?? catalogMicro;
        if (avgAfter === null && balance < 0n) avgAfter = unitCostMicro;
      }
      level.onHand = balance;
      level.avg = avgAfter;
      planned.push({
        variantId: line.variantId,
        tracked: true,
        previousMilli: previous,
        deltaMilli: delta,
        balanceMilli: balance,
        unitCostMinor: unitCostMicro === null ? null : microToMinor(unitCostMicro),
        unitCostMicro,
        valueMinor: movementValue(delta, unitCostMicro),
        movementId: delta === 0n ? null : newId(),
        avgAfter,
      });
    });

    if (shortages.length > 0) {
      throw new AppError(
        409,
        'INSUFFICIENT_STOCK',
        'Not enough stock for one or more items.',
        shortages.map((s) => ({
          path: `lines.${s.index}`,
          code: 'insufficient_stock',
          message: `available=${formatQuantity(s.available)} requested=${formatQuantity(s.requested)}`,
        })),
      );
    }

    const movements = planned.filter((p) => p.tracked && p.movementId);
    if (movements.length > 0) {
      await tx.insert(stockMovements).values(
        movements.map((p) => ({
          id: p.movementId!,
          merchantId: ctx.merchantId,
          branchId: ctx.branchId,
          variantId: p.variantId,
          movementType: ctx.movementType,
          reason: ctx.reason ?? null,
          quantity: formatQuantity(p.deltaMilli),
          balanceAfter: formatQuantity(p.balanceMilli),
          unitCostMinor: p.unitCostMinor,
          valueMinor: p.valueMinor,
          avgCostAfterMinor: p.avgAfter === null ? null : microToMinor(p.avgAfter),
          avgCostMicroAfter: p.avgAfter,
          sourceType: ctx.sourceType,
          sourceId: ctx.sourceId,
          note: ctx.note ?? null,
          createdByUserId: ctx.userId,
        })),
      );
    }
    // Final balance per variant (a variant may appear in several lines).
    for (const [variantId, level] of levels) {
      if (!movements.some((m) => m.variantId === variantId)) continue;
      await tx
        .update(stockLevels)
        .set({
          onHand: formatQuantity(level.onHand),
          avgCostMinor: level.avg === null ? null : microToMinor(level.avg),
          avgCostMicro: level.avg,
          lastMovementAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(stockLevels.branchId, ctx.branchId), eq(stockLevels.variantId, variantId)));
    }
    return planned.map(({ avgAfter: _avgAfter, unitCostMicro: _micro, ...rest }) => rest);
  }

  /** Active, unexpired reservations per variant at a branch (milli-units). */
  async reservedQuantities(
    tx: Transaction,
    branchId: string,
    variantIds: readonly string[],
    excludeOrderId: string | null,
  ): Promise<Map<string, bigint>> {
    const result = new Map<string, bigint>();
    if (variantIds.length === 0) return result;
    const rows = (
      await tx.execute(sql`
        select variant_id, (sum(quantity) * 1000)::bigint::text as qty from stock_reservations
        where branch_id = ${branchId} and status = 'active' and expires_at > now()
          and variant_id in (${sql.join(
            variantIds.map((v) => sql`${v}`),
            sql`, `,
          )})
          ${excludeOrderId ? sql`and online_order_id <> ${excludeOrderId}` : sql``}
        group by variant_id`)
    ).rows as { variant_id: string; qty: string }[];
    for (const r of rows) result.set(r.variant_id, BigInt(r.qty));
    return result;
  }

  /**
   * Holds stock for an unpaid online order until `expiresAt` (ADR-0079), under the same
   * row locks as every stock change, so a reservation and a POS sale can never both take
   * the last unit. Untracked items need no reservation.
   */
  async reserve(
    tx: Transaction,
    ctx: { merchantId: string; branchId: string; onlineOrderId: string; expiresAt: Date },
    lines: readonly { variantId: string; quantityMilli: bigint }[],
  ): Promise<void> {
    if (lines.length === 0) return;
    const variantIds = [...new Set(lines.map((l) => l.variantId))].sort();
    const variants = await tx
      .select({ id: productVariants.id, trackInventory: products.trackInventory })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.id, variantIds));
    const tracked = variants
      .filter((v) => v.trackInventory)
      .map((v) => v.id)
      .sort();
    if (tracked.length === 0) return;
    await tx
      .insert(stockLevels)
      .values(
        tracked.map((variantId) => ({
          merchantId: ctx.merchantId,
          branchId: ctx.branchId,
          variantId,
        })),
      )
      .onConflictDoNothing();
    const locked = await tx
      .select({ variantId: stockLevels.variantId, onHand: stockLevels.onHand })
      .from(stockLevels)
      .where(and(eq(stockLevels.branchId, ctx.branchId), inArray(stockLevels.variantId, tracked)))
      .orderBy(stockLevels.variantId)
      .for('update');
    const allowNegative = await this.allowNegativeStock(tx, ctx.merchantId);
    const held = await this.reservedQuantities(tx, ctx.branchId, tracked, null);
    const wanted = new Map<string, bigint>();
    for (const l of lines)
      if (tracked.includes(l.variantId))
        wanted.set(l.variantId, (wanted.get(l.variantId) ?? 0n) + l.quantityMilli);
    const shortages = locked.flatMap((l) => {
      const available = parseQuantity(l.onHand) - (held.get(l.variantId) ?? 0n);
      const want = wanted.get(l.variantId) ?? 0n;
      return want > available && !allowNegative
        ? [{ variantId: l.variantId, available, requested: want }]
        : [];
    });
    if (shortages.length)
      throw new AppError(
        409,
        'INSUFFICIENT_STOCK',
        'Not enough stock for one or more items.',
        shortages.map((s) => ({
          path: `lines.${lines.findIndex((l) => l.variantId === s.variantId)}`,
          code: 'insufficient_stock',
          message: `available=${formatQuantity(s.available < 0n ? 0n : s.available)} requested=${formatQuantity(s.requested)}`,
        })),
      );
    await tx.execute(sql`
      insert into stock_reservations (id, merchant_id, branch_id, variant_id, online_order_id, quantity, expires_at)
      values ${sql.join(
        [...wanted].map(
          ([variantId, qty]) =>
            sql`(${newId()}, ${ctx.merchantId}, ${ctx.branchId}, ${variantId}, ${ctx.onlineOrderId}, ${formatQuantity(qty)}, ${ctx.expiresAt.toISOString()})`,
        ),
        sql`, `,
      )}`);
  }

  /** Current balances (milli-units) at a branch; variants without a balance row are 0. */
  async balances(
    tx: Transaction,
    branchId: string,
    variantIds: readonly string[],
  ): Promise<Map<string, bigint>> {
    const result = new Map<string, bigint>(variantIds.map((id) => [id, 0n]));
    if (variantIds.length === 0) return result;
    const rows = await tx
      .select({ variantId: stockLevels.variantId, onHand: stockLevels.onHand })
      .from(stockLevels)
      .where(
        and(eq(stockLevels.branchId, branchId), inArray(stockLevels.variantId, [...variantIds])),
      );
    for (const r of rows) result.set(r.variantId, parseQuantity(r.onHand));
    return result;
  }
}
