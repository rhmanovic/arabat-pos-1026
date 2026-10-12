import type {
  ManagerSubscription,
  Plan,
  PlanCheck,
  PlanFeature,
  PlanLimit,
  SubscriptionView,
  Usage,
} from '@arabat/contracts';
import { PLAN_LIMITS } from '@arabat/contracts';
import { Money } from '@arabat/money';
import { Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { plans, subscriptionEvents, subscriptions } from './subscriptions.schema.js';

type PlanRow = typeof plans.$inferSelect;
type SubscriptionRow = typeof subscriptions.$inferSelect;
type Row = Record<string, unknown>;

const LIMIT_COLUMN: Record<PlanLimit, keyof PlanRow> = {
  branches: 'maxBranches',
  employees: 'maxEmployees',
  products: 'maxProducts',
  registers: 'maxRegisters',
};

export function toPlan(p: PlanRow): Omit<Plan, 'merchantCount'> {
  return {
    id: p.id,
    code: p.code,
    nameEn: p.nameEn,
    nameAr: p.nameAr,
    descriptionEn: p.descriptionEn,
    descriptionAr: p.descriptionAr,
    status: p.status as Plan['status'],
    isDefault: p.isDefault,
    isPublic: p.isPublic,
    limits: {
      branches: p.maxBranches,
      employees: p.maxEmployees,
      products: p.maxProducts,
      registers: p.maxRegisters,
    },
    features: p.features as PlanFeature[],
    price: p.priceMinor === null ? null : Money.ofMinor(p.priceMinor, p.currency as 'KWD').toJSON(),
    billingPeriod: p.billingPeriod as Plan['billingPeriod'],
    trialDays: p.trialDays,
    sortOrder: p.sortOrder,
    version: p.version,
  };
}

/** Stored status, adjusted for dates that have passed (nothing is billed automatically). */
export function effectiveStatus(
  s: Pick<SubscriptionRow, 'status' | 'endsAt' | 'trialEndsAt'>,
  now = new Date(),
): SubscriptionView['effectiveStatus'] {
  if (s.status === 'trialing' && s.trialEndsAt && s.trialEndsAt < now) return 'trial_ended';
  if (s.endsAt && s.endsAt < now && ['active', 'trialing', 'past_due'].includes(s.status))
    return 'expired';
  return s.status as SubscriptionView['effectiveStatus'];
}

/**
 * Subscription plans and their limits (Prompt 17, ADR-0081). Every limit check runs inside
 * the caller's merchant transaction and locks the merchant's subscription row first, so two
 * concurrent creations cannot both take the last free slot.
 */
@Injectable()
export class SubscriptionsService {
  constructor(private readonly database: DatabaseService) {}

  async defaultPlan(tx: Transaction): Promise<PlanRow> {
    const [plan] = await tx.select().from(plans).where(eq(plans.isDefault, true));
    if (!plan) throw new Error('No default subscription plan is configured.');
    return plan;
  }

  /** Creates the merchant's first subscription (registration, platform onboarding, seeds). */
  async createInitial(
    tx: Transaction,
    merchantId: string,
    planId: string | null,
    reason: string,
  ): Promise<void> {
    const plan = planId
      ? (await tx.select().from(plans).where(eq(plans.id, planId)))[0]
      : await this.defaultPlan(tx);
    if (!plan || plan.status !== 'active')
      throw AppError.validation([
        { path: 'planId', code: 'invalid', message: 'Choose an active plan.' },
      ]);
    const id = newId();
    const trialing = plan.trialDays > 0;
    const inserted = await tx
      .insert(subscriptions)
      .values({
        id,
        merchantId,
        planId: plan.id,
        status: trialing ? 'trialing' : 'active',
        trialEndsAt: trialing ? sql`now() + make_interval(days => ${plan.trialDays})` : null,
      })
      .onConflictDoNothing({ target: subscriptions.merchantId })
      .returning({ id: subscriptions.id });
    if (inserted.length === 0) return;
    await tx.insert(subscriptionEvents).values({
      id: newId(),
      merchantId,
      subscriptionId: id,
      kind: 'created',
      toPlanId: plan.id,
      toStatus: trialing ? 'trialing' : 'active',
      reason,
    });
  }

  /** The merchant's subscription and plan; creates the default one if missing. */
  async current(
    tx: Transaction,
    merchantId: string,
    /** `update`: limit checks and plan changes; `share`: creations on unlimited plans. */
    options: { lock?: boolean | 'share' } = {},
  ): Promise<{ subscription: SubscriptionRow; plan: PlanRow }> {
    const read = async () => {
      const query = tx
        .select({ subscription: subscriptions, plan: plans })
        .from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .where(eq(subscriptions.merchantId, merchantId));
      if (options.lock === 'share') return (await query.for('share', { of: subscriptions }))[0];
      return (options.lock ? await query.for('update', { of: subscriptions }) : await query)[0];
    };
    const found = await read();
    if (found) return found;
    await this.createInitial(tx, merchantId, null, 'Created on first use');
    return (await read())!;
  }

  async usage(tx: Transaction, merchantId: string): Promise<Record<PlanLimit, number>> {
    const [row] = (
      await tx.execute(sql`
        select
          (select count(*)::int from branches where merchant_id = ${merchantId} and status = 'active') as branches,
          (select count(*)::int from memberships where merchant_id = ${merchantId} and status = 'active' and not is_owner)
            + (select count(*)::int from invitations where merchant_id = ${merchantId} and status = 'pending' and expires_at > now())
            as employees,
          (select count(*)::int from products where merchant_id = ${merchantId} and status = 'active') as products,
          (select count(*)::int from registers where merchant_id = ${merchantId} and status = 'active') as registers`)
    ).rows as Row[];
    return {
      branches: Number(row!['branches']),
      employees: Number(row!['employees']),
      products: Number(row!['products']),
      registers: Number(row!['registers']),
    };
  }

  /**
   * Refuses when adding `adding` more of `limit` would exceed the plan (BR-151). Call it in
   * the same transaction as the insert/reactivation it guards.
   */
  async assertCapacity(
    tx: Transaction,
    merchantId: string,
    limit: PlanLimit,
    adding = 1,
  ): Promise<void> {
    // One lock per transaction (never share-then-update: concurrent upgrades deadlock).
    // Unlimited plans take a shared lock: creations run in parallel, while a concurrent plan
    // change waits for them and then counts them. Limited plans serialise on the row.
    const unlocked = await this.current(tx, merchantId);
    if (unlocked.plan[LIMIT_COLUMN[limit]] === null) {
      const shared = await this.current(tx, merchantId, { lock: 'share' });
      if (shared.plan[LIMIT_COLUMN[limit]] === null) return;
    }
    const { plan } = await this.current(tx, merchantId, { lock: true });
    const max = plan[LIMIT_COLUMN[limit]] as number | null;
    if (max === null) return;
    const used = (await this.usage(tx, merchantId))[limit];
    if (used + adding > max)
      throw new AppError(
        409,
        'PLAN_LIMIT_REACHED',
        `Your plan allows ${max} ${limit}; ${used} in use. Ask the platform to change your plan.`,
        [{ path: limit, code: 'limit', message: `${used}/${max}` }],
      );
  }

  async assertFeature(tx: Transaction, merchantId: string, feature: PlanFeature): Promise<void> {
    const { plan } = await this.current(tx, merchantId);
    if (!plan.features.includes(feature))
      throw new AppError(
        409,
        'PLAN_FEATURE_UNAVAILABLE',
        `Your plan does not include ${feature}. Ask the platform to change your plan.`,
        [{ path: feature, code: 'feature', message: feature }],
      );
  }

  async view(tx: Transaction, merchantId: string): Promise<SubscriptionView> {
    const { subscription: s, plan } = await this.current(tx, merchantId);
    const used = await this.usage(tx, merchantId);
    const usage = Object.fromEntries(
      PLAN_LIMITS.map((k) => [k, { used: used[k], max: plan[LIMIT_COLUMN[k]] as number | null }]),
    ) as Usage;
    return {
      id: s.id,
      plan: toPlan(plan),
      status: s.status as SubscriptionView['status'],
      effectiveStatus: effectiveStatus(s),
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt?.toISOString() ?? null,
      trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
      usage,
      version: s.version,
    };
  }

  /** What would block moving the merchant to `target` (usage above limits, features in use). */
  async planCheck(tx: Transaction, merchantId: string, target: PlanRow): Promise<PlanCheck> {
    const { plan: from } = await this.current(tx, merchantId);
    const used = await this.usage(tx, merchantId);
    const issues: PlanCheck['issues'] = [];
    for (const key of PLAN_LIMITS) {
      const max = target[LIMIT_COLUMN[key]] as number | null;
      if (max !== null && used[key] > max)
        issues.push({ kind: 'limit', key, used: used[key], max });
    }
    const [inUse] = (
      await tx.execute(sql`
        select
          coalesce((select enabled from restaurant_settings where merchant_id = ${merchantId}), false) as restaurant,
          coalesce((select status in ('published', 'paused') from online_stores where merchant_id = ${merchantId}), false) as ecommerce`)
    ).rows as Row[];
    for (const feature of ['restaurant', 'ecommerce'] as const)
      if (inUse![feature] === true && !target.features.includes(feature))
        issues.push({ kind: 'feature', key: feature, used: null, max: null });

    const score = (p: PlanRow) =>
      PLAN_LIMITS.map((k) => (p[LIMIT_COLUMN[k]] as number | null) ?? Number.POSITIVE_INFINITY);
    const a = score(from);
    const b = score(target);
    const more =
      b.some((v, i) => v > a[i]!) || target.features.some((f) => !from.features.includes(f));
    const less =
      b.some((v, i) => v < a[i]!) || from.features.some((f) => !target.features.includes(f));
    const direction =
      from.id === target.id
        ? 'same'
        : more && !less
          ? 'upgrade'
          : less && !more
            ? 'downgrade'
            : 'change';
    return { fits: issues.length === 0, direction, issues };
  }

  /** The signed-in merchant's own subscription (never another merchant's). */
  async managerView(actor: MerchantActor): Promise<ManagerSubscription> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const view = await this.view(tx, actor.merchantId);
      const available = await tx
        .select()
        .from(plans)
        .where(sql`${plans.status} = 'active' and ${plans.isPublic}`)
        .orderBy(asc(plans.sortOrder), asc(plans.code));
      return { ...view, availablePlans: available.map(toPlan) };
    });
  }
}
