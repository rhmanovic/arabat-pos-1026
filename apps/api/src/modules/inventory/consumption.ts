import { quantityValue } from '@arabat/money';
import { sql } from 'drizzle-orm';
import type { Transaction } from '../../database/database.service.js';
import type { AppliedLine } from './stock-ledger.service.js';

export interface ConsumptionInput {
  variantId: string;
  quantityMilli: bigint;
  modifierIds: readonly string[];
}

export interface ConsumptionLine {
  /** Index of the input (sale line / order item) this stock line belongs to. */
  owner: number;
  /** True for the input's own variant (not a recipe or modifier ingredient). */
  own: boolean;
  variantId: string;
  quantityMilli: bigint;
}

/** Exact milli-quantity product (half-up): 1.5 × 0.333 = 0.500. */
function times(aMilli: bigint, bMilli: bigint): bigint {
  return (2n * aMilli * bMilli + 1000n) / 2000n;
}

/**
 * What selling (or wasting) items takes out of stock (ADR-0074): an item with a recipe
 * consumes its ingredients instead of itself; chosen modifiers add their ingredient. The
 * caller passes the result to `StockLedgerService.apply` once, so stock is deducted at a
 * single point in time and never twice.
 */
export async function stockConsumption(
  tx: Transaction,
  inputs: readonly ConsumptionInput[],
): Promise<ConsumptionLine[]> {
  const variantIds = [...new Set(inputs.map((i) => i.variantId))];
  const modifierIds = [...new Set(inputs.flatMap((i) => i.modifierIds))];
  const list = (ids: string[]) =>
    sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    );
  const recipes = new Map<string, { componentVariantId: string; quantityMilli: bigint }[]>();
  if (variantIds.length) {
    const rows = (
      await tx.execute(sql`
        select variant_id, component_variant_id, (quantity * 1000)::bigint::text as qty
        from recipe_components where variant_id in (${list(variantIds)})
        order by variant_id, component_variant_id`)
    ).rows as { variant_id: string; component_variant_id: string; qty: string }[];
    for (const r of rows) {
      const parts = recipes.get(r.variant_id) ?? [];
      parts.push({ componentVariantId: r.component_variant_id, quantityMilli: BigInt(r.qty) });
      recipes.set(r.variant_id, parts);
    }
  }
  const extras = new Map<string, { componentVariantId: string; quantityMilli: bigint }>();
  if (modifierIds.length) {
    const rows = (
      await tx.execute(sql`
        select id, component_variant_id, (component_quantity * 1000)::bigint::text as qty
        from modifiers where id in (${list(modifierIds)}) and component_variant_id is not null`)
    ).rows as { id: string; component_variant_id: string; qty: string }[];
    for (const r of rows)
      extras.set(r.id, {
        componentVariantId: r.component_variant_id,
        quantityMilli: BigInt(r.qty),
      });
  }
  const out: ConsumptionLine[] = [];
  inputs.forEach((input, owner) => {
    const recipe = recipes.get(input.variantId);
    if (recipe)
      for (const c of recipe)
        out.push({
          owner,
          own: false,
          variantId: c.componentVariantId,
          quantityMilli: times(input.quantityMilli, c.quantityMilli),
        });
    else
      out.push({
        owner,
        own: true,
        variantId: input.variantId,
        quantityMilli: input.quantityMilli,
      });
    for (const m of input.modifierIds) {
      const e = extras.get(m);
      if (e)
        out.push({
          owner,
          own: false,
          variantId: e.componentVariantId,
          quantityMilli: times(input.quantityMilli, e.quantityMilli),
        });
    }
  });
  return out;
}

/**
 * Cost per input from the applied ledger lines: Σ quantity × unit cost of every stock line
 * it owns (null when any part has no known cost). `fallback` supplies the catalog cost for
 * the input's own variant when it is not stock-tracked.
 */
export function consumptionCosts(
  count: number,
  lines: readonly ConsumptionLine[],
  applied: readonly AppliedLine[],
  fallback: (owner: number) => bigint | null,
): { total: (bigint | null)[]; own: (bigint | null)[]; tracked: boolean[] } {
  const total: (bigint | null)[] = Array.from({ length: count }, () => 0n);
  const own: (bigint | null)[] = Array.from({ length: count }, () => null);
  const tracked: boolean[] = Array.from({ length: count }, () => false);
  lines.forEach((line, i) => {
    const a = applied[i]!;
    const unit = a.tracked ? a.unitCostMinor : line.own ? fallback(line.owner) : null;
    if (line.own) {
      own[line.owner] = unit;
      tracked[line.owner] = a.tracked;
    }
    if (unit === null) total[line.owner] = null;
    else if (total[line.owner] !== null)
      total[line.owner] = total[line.owner]! + quantityValue(line.quantityMilli, unit);
  });
  return { total, own, tracked };
}
