import type {
  OnlinePromotion,
  StoreQuoteResult,
  saveOnlinePromotionSchema,
} from '@arabat/contracts';
import { Money, divideHalfUp, parseDecimal, pow10 } from '@arabat/money';
import { can } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { parseAmount } from '../payments/payments.service.js';

type Row = Record<string, unknown>;
const CURRENCY = 'KWD' as const;
const money = (minor: bigint | string) => Money.ofMinor(BigInt(minor), CURRENCY).toJSON();
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const str = (v: unknown) => (v as string | null) ?? null;

/** A cart line as the promotion engine sees it. */
export type PromotionLine = {
  productId: string;
  categoryId: string | null;
  onlineCategoryId: string | null;
  netMinor: bigint;
};
export type CodeIssue = NonNullable<StoreQuoteResult['codeIssue']>;
export type AppliedPromotion = {
  id: string;
  code: string | null;
  nameEn: string | null;
  nameAr: string | null;
  discountMinor: bigint;
  freeDelivery: boolean;
};

/**
 * Store promotions (ADR-0125): discount codes and automatic offers. One promotion applies to
 * an order: the entered code when it fits, else the best automatic offer. The discount is an
 * order discount shared over the lines of the sale; "free delivery" zeroes the delivery fee.
 */
@Injectable()
export class PromotionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private assertManage(actor: MerchantActor) {
    if (!can(actor.access, 'online.manage')) throw AppError.forbidden();
  }

  private view(r: Row): OnlinePromotion {
    return {
      id: r['id'] as string,
      nameEn: str(r['name_en']),
      nameAr: str(r['name_ar']),
      kind: r['kind'] as 'code',
      code: str(r['code']),
      discountType: r['discount_type'] as 'percentage',
      percent: r['percent'] === null ? null : String(r['percent']),
      amount: r['amount_minor'] === null ? null : money(r['amount_minor'] as string),
      minimumOrder: money(r['minimum_order_minor'] as string),
      maxUses: (r['max_uses'] as number | null) ?? null,
      usesCount: r['uses_count'] as number,
      maxUsesPerCustomer: (r['max_uses_per_customer'] as number | null) ?? null,
      startsAt: iso(r['starts_at']),
      endsAt: iso(r['ends_at']),
      status: r['status'] as 'active',
      appliesTo: r['applies_to'] as 'order',
      targetIds: (r['target_ids'] as string[]) ?? [],
      position: r['position'] as number,
      version: r['version'] as number,
    };
  }

  private async rows(tx: Transaction): Promise<OnlinePromotion[]> {
    const rows = (
      await tx.execute(sql`select * from online_promotions order by position, created_at`)
    ).rows as Row[];
    return rows.map((r) => this.view(r));
  }

  async list(actor: MerchantActor): Promise<{ promotions: OnlinePromotion[] }> {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => ({
      promotions: await this.rows(tx),
    }));
  }

  private values(input: z.output<typeof saveOnlinePromotionSchema>) {
    return {
      nameEn: input.nameEn,
      nameAr: input.nameAr,
      kind: input.kind,
      code: input.kind === 'code' ? input.code : null,
      discountType: input.discountType,
      percent: input.discountType === 'percentage' ? input.percent : null,
      amountMinor: input.discountType === 'fixed' ? parseAmount(input.amount!, 'amount') : null,
      minimumOrderMinor: parseAmount(input.minimumOrder, 'minimumOrder'),
      maxUses: input.maxUses,
      maxUsesPerCustomer: input.maxUsesPerCustomer,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: input.status,
      appliesTo: input.appliesTo,
      targetIds: JSON.stringify(input.appliesTo === 'order' ? [] : input.targetIds),
    };
  }

  async create(
    actor: MerchantActor,
    input: z.output<typeof saveOnlinePromotionSchema>,
    ip: string,
  ): Promise<OnlinePromotion> {
    this.assertManage(actor);
    const id = newId();
    const v = this.values(input);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      await this.assertCodeFree(tx, v.code, null);
      await tx.execute(sql`
        insert into online_promotions (id, merchant_id, name_en, name_ar, kind, code, discount_type, percent, amount_minor,
          minimum_order_minor, max_uses, max_uses_per_customer, starts_at, ends_at, status, applies_to, target_ids, position)
        values (${id}, ${actor.merchantId}, ${v.nameEn}, ${v.nameAr}, ${v.kind}, ${v.code}, ${v.discountType}, ${v.percent},
          ${v.amountMinor}, ${v.minimumOrderMinor}, ${v.maxUses}, ${v.maxUsesPerCustomer},
          ${v.startsAt}::timestamptz, ${v.endsAt}::timestamptz, ${v.status}, ${v.appliesTo}, ${v.targetIds}::jsonb,
          coalesce((select max(position) + 1 from online_promotions), 0))`);
      await this.record(tx, actor, 'online.promotion_created', id, ip, {
        name: v.nameAr ?? v.nameEn,
        code: v.code,
        type: v.discountType,
      });
    });
    return this.get(actor, id);
  }

  async update(
    actor: MerchantActor,
    id: string,
    input: z.output<typeof saveOnlinePromotionSchema>,
    ip: string,
  ): Promise<OnlinePromotion> {
    this.assertManage(actor);
    const v = this.values(input);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = (
        await tx.execute(sql`select version from online_promotions where id = ${id} for update`)
      ).rows as Row[];
      if (!row) throw AppError.notFound('Promotion not found.');
      if (input.version !== undefined && row['version'] !== input.version) throw versionConflict();
      await this.assertCodeFree(tx, v.code, id);
      await tx.execute(sql`
        update online_promotions set name_en = ${v.nameEn}, name_ar = ${v.nameAr}, kind = ${v.kind}, code = ${v.code},
          discount_type = ${v.discountType}, percent = ${v.percent}, amount_minor = ${v.amountMinor},
          minimum_order_minor = ${v.minimumOrderMinor}, max_uses = ${v.maxUses}, max_uses_per_customer = ${v.maxUsesPerCustomer},
          starts_at = ${v.startsAt}::timestamptz, ends_at = ${v.endsAt}::timestamptz, status = ${v.status},
          applies_to = ${v.appliesTo}, target_ids = ${v.targetIds}::jsonb, version = version + 1, updated_at = now()
        where id = ${id}`);
      await this.record(tx, actor, 'online.promotion_updated', id, ip, {
        name: v.nameAr ?? v.nameEn,
        code: v.code,
        status: v.status,
      });
    });
    return this.get(actor, id);
  }

  /** A promotion that was ever used is paused, never deleted (its uses are facts). */
  async remove(actor: MerchantActor, id: string, ip: string) {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [row] = (
        await tx.execute(
          sql`select uses_count, name_en, name_ar from online_promotions where id = ${id} for update`,
        )
      ).rows as Row[];
      if (!row) throw AppError.notFound('Promotion not found.');
      if ((row['uses_count'] as number) > 0) {
        await tx.execute(
          sql`update online_promotions set status = 'paused', version = version + 1, updated_at = now() where id = ${id}`,
        );
        await this.record(tx, actor, 'online.promotion_paused', id, ip, { usedBefore: true });
      } else {
        await tx.execute(sql`delete from online_promotions where id = ${id}`);
        await this.record(tx, actor, 'online.promotion_deleted', id, ip, {
          name: row['name_ar'] ?? row['name_en'],
        });
      }
      return { promotions: await this.rows(tx) };
    });
  }

  async order(actor: MerchantActor, ids: string[], ip: string) {
    this.assertManage(actor);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const existing = (
        (await tx.execute(sql`select id from online_promotions for update`)).rows as {
          id: string;
        }[]
      ).map((r) => r.id);
      if (
        ids.length !== existing.length ||
        new Set(ids).size !== ids.length ||
        !ids.every((i) => existing.includes(i))
      )
        throw AppError.validation([
          { path: 'ids', code: 'invalid', message: 'Send every promotion exactly once.' },
        ]);
      for (const [position, id] of ids.entries())
        await tx.execute(
          sql`update online_promotions set position = ${position}, updated_at = now() where id = ${id}`,
        );
      await this.record(tx, actor, 'online.promotions_reordered', actor.merchantId, ip, {
        count: ids.length,
      });
      return { promotions: await this.rows(tx) };
    });
  }

  private async get(actor: MerchantActor, id: string): Promise<OnlinePromotion> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [r] = (await tx.execute(sql`select * from online_promotions where id = ${id}`))
        .rows as Row[];
      if (!r) throw AppError.notFound('Promotion not found.');
      return this.view(r);
    });
  }

  private async assertCodeFree(tx: Transaction, code: string | null, exceptId: string | null) {
    if (!code) return;
    const [dup] = (
      await tx.execute(
        sql`select 1 from online_promotions where code = ${code} and id is distinct from ${exceptId}`,
      )
    ).rows;
    if (dup)
      throw new AppError(409, 'DUPLICATE_CODE', 'Another promotion already uses this code.', [
        { path: 'code', code: 'duplicate', message: 'This code is taken.' },
      ]);
  }

  // ------------------------------------------------------------ checkout (in a merchant tx)
  /**
   * The promotion for a cart: the entered code when it fits (else `codeIssue` says why), or
   * the best automatic offer (largest discount; free delivery counts as the delivery fee).
   */
  async apply(
    tx: Transaction,
    cart: {
      lines: PromotionLine[];
      subtotalMinor: bigint;
      deliveryFeeMinor: bigint;
      code: string | null;
      customerPhone: string | null;
      now?: Date;
    },
  ): Promise<{ promotion: AppliedPromotion | null; codeIssue: CodeIssue | null }> {
    const now = cart.now ?? new Date();
    const rows = (
      await tx.execute(sql`
        select p.*, (select count(*)::int from online_promotion_uses u
                     where u.promotion_id = p.id and u.customer_phone = ${cart.customerPhone ?? ''}) as customer_uses
        from online_promotions p
        where p.kind = 'automatic' or p.code = ${cart.code}
        order by p.position`)
    ).rows as Row[];
    const evaluate = (r: Row): { issue: CodeIssue | null; applied: AppliedPromotion | null } => {
      if (r['status'] !== 'active') return { issue: 'inactive', applied: null };
      if (r['starts_at'] && new Date(r['starts_at'] as string) > now)
        return { issue: 'not_started', applied: null };
      if (r['ends_at'] && new Date(r['ends_at'] as string) <= now)
        return { issue: 'expired', applied: null };
      if (cart.subtotalMinor < BigInt(r['minimum_order_minor'] as string))
        return { issue: 'minimum', applied: null };
      if (r['max_uses'] !== null && (r['uses_count'] as number) >= (r['max_uses'] as number))
        return { issue: 'used_up', applied: null };
      if (
        r['max_uses_per_customer'] !== null &&
        cart.customerPhone &&
        (r['customer_uses'] as number) >= (r['max_uses_per_customer'] as number)
      )
        return { issue: 'customer_limit', applied: null };
      const targets = new Set((r['target_ids'] as string[]) ?? []);
      const base =
        r['applies_to'] === 'order'
          ? cart.subtotalMinor
          : cart.lines
              .filter((l) =>
                r['applies_to'] === 'product'
                  ? targets.has(l.productId)
                  : (l.categoryId !== null && targets.has(l.categoryId)) ||
                    (l.onlineCategoryId !== null && targets.has(l.onlineCategoryId)),
              )
              .reduce((sum, l) => sum + l.netMinor, 0n);
      const type = r['discount_type'] as string;
      let discountMinor = 0n;
      if (type === 'percentage') {
        if (base <= 0n) return { issue: 'no_match', applied: null };
        const { units, scale } = parseDecimal(String(r['percent']));
        discountMinor = divideHalfUp(base * units, pow10(scale) * 100n);
      } else if (type === 'fixed') {
        if (base <= 0n) return { issue: 'no_match', applied: null };
        discountMinor = BigInt(r['amount_minor'] as string);
        if (discountMinor > base) discountMinor = base;
      }
      // The order keeps a positive total: a discount never covers the whole order.
      if (discountMinor >= cart.subtotalMinor) discountMinor = cart.subtotalMinor - 1n;
      if (discountMinor < 0n) discountMinor = 0n;
      const freeDelivery = type === 'free_delivery';
      if (freeDelivery && cart.deliveryFeeMinor === 0n) return { issue: 'no_match', applied: null };
      return {
        issue: null,
        applied: {
          id: r['id'] as string,
          code: str(r['code']),
          nameEn: str(r['name_en']),
          nameAr: str(r['name_ar']),
          discountMinor,
          freeDelivery,
        },
      };
    };
    let codeIssue: CodeIssue | null = null;
    if (cart.code) {
      const row = rows.find((r) => r['code'] === cart.code);
      if (!row) codeIssue = 'unknown';
      else {
        const { issue, applied } = evaluate(row);
        if (applied) return { promotion: applied, codeIssue: null };
        codeIssue = issue;
      }
    }
    let best: AppliedPromotion | null = null;
    for (const r of rows.filter((x) => x['kind'] === 'automatic')) {
      const { applied } = evaluate(r);
      if (!applied) continue;
      const worth = applied.freeDelivery ? cart.deliveryFeeMinor : applied.discountMinor;
      const bestWorth = best
        ? best.freeDelivery
          ? cart.deliveryFeeMinor
          : best.discountMinor
        : -1n;
      if (worth > bestWorth) best = applied;
    }
    return { promotion: best, codeIssue };
  }

  /** Records the use on the placed order and counts it on the promotion (append-only). */
  async recordUse(
    tx: Transaction,
    merchantId: string,
    use: {
      promotionId: string;
      orderId: string;
      customerId: string | null;
      customerPhone: string;
      discountMinor: bigint;
    },
  ) {
    await tx.execute(sql`
      insert into online_promotion_uses (id, merchant_id, promotion_id, order_id, customer_id, customer_phone, discount_minor)
      values (${newId()}, ${merchantId}, ${use.promotionId}, ${use.orderId}, ${use.customerId}, ${use.customerPhone}, ${use.discountMinor})`);
    await tx.execute(
      sql`update online_promotions set uses_count = uses_count + 1, updated_at = now() where id = ${use.promotionId}`,
    );
  }

  private record(
    tx: Transaction,
    actor: MerchantActor,
    action: string,
    id: string,
    ip: string,
    details: Row,
  ) {
    return this.audit.recordIn(tx, {
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action,
      targetType: 'online_promotion',
      targetId: id,
      ip,
      details,
    });
  }
}
