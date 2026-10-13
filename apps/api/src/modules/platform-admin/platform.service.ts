import type {
  Plan,
  PlanCheck,
  PlatformMerchant,
  PlatformMerchantDetail,
  PlatformOverview,
  SubscriptionView,
  changeSubscriptionSchema,
  createMerchantSchema,
  merchantStatusChangeSchema,
  platformAuditQuerySchema,
  platformMerchantQuerySchema,
  savePlanSchema,
  ownerFreezeSchema,
  platformOwnershipTransferSchema,
} from '@arabat/contracts';
import { parseAmount } from '../payments/payments.service.js';
import { Injectable } from '@nestjs/common';
import { type SQL, asc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import type { PlatformActor } from '../../kernel/access/session-resolver.js';
import { generateToken } from '../../kernel/crypto/tokens.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { sessions } from '../auth/auth.schema.js';
import { PasswordResetService } from '../auth/password-reset.service.js';
import { PasswordService } from '../auth/password.service.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import { users } from '../iam/iam.schema.js';
import { merchants } from '../merchants/merchants.schema.js';
import { OwnershipService } from '../merchants/ownership.service.js';
import { provisionMerchant } from '../merchants/provision.js';
import { plans, subscriptionEvents, subscriptions } from '../subscriptions/subscriptions.schema.js';
import {
  SubscriptionsService,
  effectiveStatus,
  toPlan,
} from '../subscriptions/subscriptions.service.js';

type Row = Record<string, unknown>;
type O<T extends z.ZodType> = z.output<T>;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const num = (v: unknown) => Number(v ?? 0);
const versionConflict = () =>
  new AppError(409, 'VERSION_CONFLICT', 'This record was changed by someone else. Reload it.');

/**
 * SaaS operator administration (Prompt 17, ADR-0080). Cross-merchant reads go through the
 * `platform_*` SQL functions (summaries only); anything about one merchant runs in
 * `withPlatformContext`, i.e. inside that merchant's RLS context with the operator id set.
 * Every change is audited with the operator as actor and the merchant as owner of the event.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionsService,
    private readonly passwords: PasswordService,
    private readonly resets: PasswordResetService,
    private readonly ownership: OwnershipService,
  ) {}

  // ------------------------------------------------------------ overview & lists
  async overview(actor: PlatformActor): Promise<PlatformOverview> {
    const [o] = (await this.read(actor, sql`select * from platform_overview()`)) as Row[];
    const counts = await this.planCounts(actor);
    const allPlans = await this.database.db.select().from(plans).orderBy(asc(plans.sortOrder));
    const recent = await this.merchants(actor, { q: undefined, page: 1, pageSize: 5 });
    return {
      merchants: {
        total: num(o!['merchants_total']),
        active: num(o!['merchants_active']),
        suspended: num(o!['merchants_suspended']),
        closed: num(o!['merchants_closed']),
        newLast30Days: num(o!['merchants_new_30d']),
      },
      subscriptions: {
        trialsEndingIn7Days: num(o!['trials_ending_7d']),
        lapsed: num(o!['subscriptions_lapsed']),
        byPlan: allPlans
          .map((p) => ({
            code: p.code,
            nameEn: p.nameEn,
            nameAr: p.nameAr,
            merchants: counts.get(p.id) ?? 0,
          }))
          .filter((p) => p.merchants > 0),
      },
      usage: {
        activeBranches: num(o!['branches_active']),
        activeMemberships: num(o!['employees_active']),
        salesLast24Hours: num(o!['sales_24h']),
        onlineOrdersLast24Hours: num(o!['online_orders_24h']),
      },
      recentMerchants: recent.merchants,
    };
  }

  async merchants(actor: PlatformActor, query: O<typeof platformMerchantQuerySchema>) {
    const rows = await this.read(
      actor,
      sql`select * from platform_merchants(${query.q ?? null}, ${query.status ?? null}, ${query.pageSize}, ${(query.page - 1) * query.pageSize})`,
    );
    return {
      merchants: rows.map(toMerchant),
      total: num(rows[0]?.['total_count']),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async auditLog(actor: PlatformActor, query: O<typeof platformAuditQuerySchema>) {
    const rows = await this.read(
      actor,
      sql`select * from platform_audit(${query.merchantId ?? null}, ${query.action ?? null}, ${query.pageSize}, ${(query.page - 1) * query.pageSize})`,
    );
    return {
      entries: rows.map(toAuditEntry),
      total: num(rows[0]?.['total_count']),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  // ------------------------------------------------------------ one merchant
  async merchant(actor: PlatformActor, merchantId: string): Promise<PlatformMerchantDetail> {
    return this.database.withPlatformContext(actor.operatorId, merchantId, (tx) =>
      this.detailIn(tx, merchantId),
    );
  }

  private async detailIn(tx: Transaction, merchantId: string): Promise<PlatformMerchantDetail> {
    const [m] = await tx.select().from(merchants).where(eq(merchants.id, merchantId));
    if (!m) throw AppError.notFound('Merchant not found.');
    const [owner] = (
      await tx.execute(sql`
        select u.full_name, u.email,
               greatest(u.last_login_at, (select max(se.created_at) from sessions se where se.membership_id = ms.id)) as last_login_at
        from memberships ms join users u on u.id = ms.user_id
        where ms.merchant_id = ${merchantId} and ms.is_owner limit 1`)
    ).rows as Row[];
    const [stats] = (
      await tx.execute(sql`
        select (select count(*)::int from products where merchant_id = ${merchantId}) as products,
               (select min(created_at) from sales where merchant_id = ${merchantId}) as first_sale,
               (select max(created_at) from sales where merchant_id = ${merchantId}) as last_sale,
               (select count(*)::int from sales where merchant_id = ${merchantId} and created_at > now() - interval '30 days') as sales_30d,
               (select status from online_stores where merchant_id = ${merchantId}) as store`)
    ).rows as Row[];
    const branchRows = (
      await tx.execute(sql`
        select b.id, b.code, b.name_en, b.name_ar, b.status,
               (select count(distinct ra.membership_id)::int from role_assignments ra
                  join memberships ms on ms.id = ra.membership_id and ms.status = 'active'
                  where ra.merchant_id = ${merchantId} and (ra.branch_id = b.id or ra.branch_id is null)) as employees
        from branches b where b.merchant_id = ${merchantId} order by b.is_main desc, b.code`)
    ).rows as Row[];
    const events = (
      await tx.execute(sql`
        select e.id, e.kind, fp.code as from_plan, tp.code as to_plan, e.from_status, e.to_status,
               op.full_name as operator_name, e.reason, e.created_at
        from subscription_events e
        left join plans fp on fp.id = e.from_plan_id
        left join plans tp on tp.id = e.to_plan_id
        left join platform_operators op on op.id = e.operator_id
        where e.merchant_id = ${merchantId} order by e.created_at desc, e.id desc limit 50`)
    ).rows as Row[];
    const audit = (await tx.execute(sql`select * from platform_audit(${merchantId}, null, 20, 0)`))
      .rows as Row[];
    return {
      id: m.id,
      nameEn: m.displayNameEn,
      nameAr: m.displayNameAr,
      legalName: m.legalName,
      contactEmail: m.contactEmail,
      contactPhone: m.contactPhone,
      defaultLanguage: m.defaultLanguage as 'ar' | 'en',
      status: m.status as PlatformMerchantDetail['status'],
      createdAt: m.createdAt.toISOString(),
      version: m.version,
      owner: owner
        ? {
            fullName: owner['full_name'] as string,
            email: owner['email'] as string,
            lastLoginAt: iso(owner['last_login_at']),
          }
        : null,
      ownerFrozenAt: m.ownerFrozenAt?.toISOString() ?? null,
      ownerFrozenReason: m.ownerFrozenReason,
      members: (
        (
          await tx.execute(sql`
            select ms.id, u.full_name, u.email, ms.is_owner
            from memberships ms join users u on u.id = ms.user_id
            where ms.merchant_id = ${merchantId} and ms.status = 'active'
            order by ms.is_owner desc, u.full_name`)
        ).rows as Row[]
      ).map((r) => ({
        membershipId: r['id'] as string,
        fullName: r['full_name'] as string,
        email: r['email'] as string,
        isOwner: Boolean(r['is_owner']),
      })),
      subscription: await this.subscriptions.view(tx, merchantId),
      onboarding: {
        ownerSignedIn: Boolean(owner?.['last_login_at']),
        hasProducts: num(stats!['products']) > 0,
        hasSales: Boolean(stats!['first_sale']),
        firstSaleAt: iso(stats!['first_sale']),
        lastSaleAt: iso(stats!['last_sale']),
        salesLast30Days: num(stats!['sales_30d']),
        onlineStoreStatus: ((stats!['store'] as string | null) ??
          'none') as PlatformMerchantDetail['onboarding']['onlineStoreStatus'],
      },
      branches: branchRows.map((b) => ({
        id: b['id'] as string,
        code: b['code'] as string,
        nameEn: (b['name_en'] as string | null) ?? null,
        nameAr: (b['name_ar'] as string | null) ?? null,
        status: b['status'] as string,
        employees: num(b['employees']),
      })),
      subscriptionEvents: events.map((e) => ({
        id: e['id'] as string,
        kind: e['kind'] as 'created' | 'changed',
        fromPlan: (e['from_plan'] as string | null) ?? null,
        toPlan: (e['to_plan'] as string | null) ?? null,
        fromStatus: (e['from_status'] as string | null) ?? null,
        toStatus: (e['to_status'] as string | null) ?? null,
        operatorName: (e['operator_name'] as string | null) ?? null,
        reason: (e['reason'] as string | null) ?? null,
        createdAt: iso(e['created_at'])!,
      })),
      audit: audit.map(toAuditEntry),
    };
  }

  /**
   * Onboards a merchant on behalf of its owner: company, main branch, defaults, roles,
   * subscription, and an account set-up e-mail. An existing user becomes the owner of the
   * new company without changing their password.
   */
  async createMerchant(
    actor: PlatformActor,
    input: O<typeof createMerchantSchema>,
    ip: string,
  ): Promise<PlatformMerchantDetail> {
    const merchantId = newId();
    const membershipId = newId();
    const [existing] = await this.database.db
      .select({ id: users.id, status: users.status, fullName: users.fullName })
      .from(users)
      .where(eq(users.email, input.owner.email));
    if (existing && existing.status !== 'active')
      throw new AppError(409, 'ACCOUNT_DISABLED', 'This owner account is disabled.');
    const userId = existing?.id ?? newId();
    const passwordHash = existing ? null : await this.passwords.hash(generateToken());
    const companyName = input.nameEn ?? input.nameAr ?? '';

    let send: (() => Promise<void>) | null = null;
    const detail = await this.database
      .withPlatformContext(actor.operatorId, merchantId, async (tx) => {
        if (passwordHash)
          await tx.insert(users).values({
            id: userId,
            email: input.owner.email,
            passwordHash,
            fullName: input.owner.fullName,
            preferredLanguage: input.defaultLanguage,
          });
        const { branchId } = await provisionMerchant(tx, {
          merchantId,
          ownerUserId: userId,
          membershipId,
          nameEn: input.nameEn,
          nameAr: input.nameAr,
          legalName: input.legalName,
          contactEmail: input.owner.email,
          contactPhone: input.contactPhone,
          defaultLanguage: input.defaultLanguage,
        });
        await this.subscriptions.createInitial(
          tx,
          merchantId,
          input.planId,
          'Created by the platform',
        );
        if (passwordHash)
          send = (
            await this.resets.issueAccountSetup(
              tx,
              { id: userId, email: input.owner.email, fullName: input.owner.fullName },
              companyName,
            )
          ).send;
        await this.record(
          tx,
          actor,
          merchantId,
          'platform.merchant.created',
          'merchant',
          merchantId,
          ip,
          {
            branchId,
            ownerEmail: input.owner.email,
            existingOwnerAccount: Boolean(existing),
            planId: input.planId,
          },
        );
        return this.detailIn(tx, merchantId);
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error, 'users_email_key'))
          throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'This e-mail was just registered.');
        throw error;
      });
    const deliver = send as (() => Promise<void>) | null;
    if (deliver) await deliver();
    return detail;
  }

  /**
   * Activates, suspends or closes a merchant (BR-152, BR-153). Suspension and closing end
   * every session of the merchant at once; closing is final and reserved to super admins.
   */
  async setStatus(
    actor: PlatformActor,
    merchantId: string,
    input: O<typeof merchantStatusChangeSchema>,
    ip: string,
  ): Promise<PlatformMerchantDetail> {
    if (input.status === 'closed' && actor.role !== 'platform.super_admin')
      throw AppError.forbidden('Only a super administrator can close a merchant.');
    return this.database.withPlatformContext(actor.operatorId, merchantId, async (tx) => {
      const [m] = await tx
        .select()
        .from(merchants)
        .where(eq(merchants.id, merchantId))
        .for('update');
      if (!m) throw AppError.notFound('Merchant not found.');
      if (m.version !== input.version) throw versionConflict();
      if (m.status === 'closed')
        throw new AppError(409, 'INVALID_STATE', 'A closed merchant cannot be changed.');
      if (m.status === input.status)
        throw new AppError(409, 'INVALID_STATE', `The merchant is already ${input.status}.`);
      await tx
        .update(merchants)
        .set({
          status: input.status,
          version: sql`${merchants.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(merchants.id, merchantId));
      let revoked = 0;
      if (input.status !== 'active') {
        const ended = await tx
          .update(sessions)
          .set({ revokedAt: sql`now()`, revokeReason: `merchant_${input.status}` })
          .where(sql`${sessions.merchantId} = ${merchantId} and ${sessions.revokedAt} is null`)
          .returning({ id: sessions.id });
        revoked = ended.length;
      }
      const action =
        input.status === 'active'
          ? 'platform.merchant.reactivated'
          : input.status === 'suspended'
            ? 'platform.merchant.suspended'
            : 'platform.merchant.closed';
      await this.record(tx, actor, merchantId, action, 'merchant', merchantId, ip, {
        from: m.status,
        to: input.status,
        reason: input.reason,
        sessionsEnded: revoked,
      });
      return this.detailIn(tx, merchantId);
    });
  }

  /** Emergency freeze (BR-020, R5.2): the owner's sessions end and the owner cannot sign in. */
  async freezeOwner(
    actor: PlatformActor,
    merchantId: string,
    input: O<typeof ownerFreezeSchema>,
    ip: string,
    freeze: boolean,
  ): Promise<PlatformMerchantDetail> {
    return this.database.withPlatformContext(actor.operatorId, merchantId, async (tx) => {
      const [m] = await tx
        .select()
        .from(merchants)
        .where(eq(merchants.id, merchantId))
        .for('update');
      if (!m) throw AppError.notFound('Merchant not found.');
      if (m.version !== input.version) throw versionConflict();
      if (freeze === Boolean(m.ownerFrozenAt))
        throw new AppError(
          409,
          'INVALID_STATE',
          freeze ? 'The owner is already frozen.' : 'The owner is not frozen.',
        );
      await tx
        .update(merchants)
        .set({
          ownerFrozenAt: freeze ? sql`now()` : null,
          ownerFrozenReason: freeze ? input.reason : null,
          version: sql`${merchants.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(merchants.id, merchantId));
      let ended = 0;
      if (freeze) {
        const rows = await tx
          .update(sessions)
          .set({ revokedAt: sql`now()`, revokeReason: 'owner_frozen' })
          .where(
            sql`${sessions.merchantId} = ${merchantId} and ${sessions.revokedAt} is null
            and ${sessions.membershipId} in (select id from memberships where merchant_id = ${merchantId} and is_owner)`,
          )
          .returning({ id: sessions.id });
        ended = rows.length;
      }
      await this.record(
        tx,
        actor,
        merchantId,
        freeze ? 'platform.merchant.owner_frozen' : 'platform.merchant.owner_released',
        'merchant',
        merchantId,
        ip,
        { reason: input.reason, sessionsEnded: ended },
      );
      return this.detailIn(tx, merchantId);
    });
  }

  /** Operator-initiated ownership transfer (BR-020): immediate, reasoned, both parties told. */
  async transferOwnership(
    actor: PlatformActor,
    merchantId: string,
    input: O<typeof platformOwnershipTransferSchema>,
    ip: string,
  ): Promise<PlatformMerchantDetail> {
    const result = await this.database.withPlatformContext(
      actor.operatorId,
      merchantId,
      async (tx) => {
        const [m] = await tx
          .select()
          .from(merchants)
          .where(eq(merchants.id, merchantId))
          .for('update');
        if (!m) throw AppError.notFound('Merchant not found.');
        if (m.version !== input.version) throw versionConflict();
        const [owner] = (
          await tx.execute(
            sql`select id from memberships where merchant_id = ${merchantId} and is_owner`,
          )
        ).rows as { id: string }[];
        if (!owner) throw new AppError(409, 'INVALID_STATE', 'The merchant has no owner.');
        const done = await this.ownership.transfer(tx, {
          merchantId,
          fromMembershipId: owner.id,
          toMembershipId: input.toMembershipId,
          actor: { type: 'operator', id: actor.operatorId },
          initiatedBy: 'platform',
          reason: input.reason,
          transferId: null,
          ip,
        });
        await tx
          .update(merchants)
          .set({ version: sql`${merchants.version} + 1`, updatedAt: sql`now()` })
          .where(eq(merchants.id, merchantId));
        await this.record(
          tx,
          actor,
          merchantId,
          'platform.merchant.ownership_transferred',
          'merchant',
          merchantId,
          ip,
          { reason: input.reason, toMembershipId: input.toMembershipId, toName: done.to.fullName },
        );
        return { done, detail: await this.detailIn(tx, merchantId) };
      },
    );
    await this.ownership.notifyBoth(result.done);
    return result.detail;
  }

  async planCheck(actor: PlatformActor, merchantId: string, planId: string): Promise<PlanCheck> {
    return this.database.withPlatformContext(actor.operatorId, merchantId, async (tx) => {
      await this.assertMerchant(tx, merchantId);
      return this.subscriptions.planCheck(tx, merchantId, await this.plan(tx, planId));
    });
  }

  /**
   * Assigns a plan and/or changes the subscription status and dates (BR-154). A plan the
   * merchant's current usage does not fit is refused with the reasons (no silent data loss).
   */
  async changeSubscription(
    actor: PlatformActor,
    merchantId: string,
    input: O<typeof changeSubscriptionSchema>,
    ip: string,
  ): Promise<SubscriptionView> {
    return this.database.withPlatformContext(actor.operatorId, merchantId, async (tx) => {
      await this.assertMerchant(tx, merchantId);
      const { subscription: current } = await this.subscriptions.current(tx, merchantId, {
        lock: true,
      });
      if (current.version !== input.version) throw versionConflict();
      const target = await this.plan(tx, input.planId);
      if (target.id !== current.planId) {
        if (target.status !== 'active')
          throw new AppError(409, 'INVALID_STATE', 'Archived plans cannot be assigned.');
        const check = await this.subscriptions.planCheck(tx, merchantId, target);
        if (!check.fits)
          throw new AppError(
            409,
            'PLAN_CHANGE_BLOCKED',
            'The merchant uses more than this plan allows.',
            check.issues.map((i) => ({
              path: i.key,
              code: i.kind,
              message: i.kind === 'limit' ? `${i.used}/${i.max}` : 'in use',
            })),
          );
      }
      const endsAt = input.endsAt ? new Date(input.endsAt) : null;
      if (endsAt && endsAt <= current.startsAt)
        throw AppError.validation([
          { path: 'endsAt', code: 'invalid', message: 'The end must be after the start.' },
        ]);
      await tx
        .update(subscriptions)
        .set({
          planId: target.id,
          status: input.status,
          endsAt,
          trialEndsAt: input.trialEndsAt ? new Date(input.trialEndsAt) : null,
          version: sql`${subscriptions.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(eq(subscriptions.id, current.id));
      await tx.insert(subscriptionEvents).values({
        id: newId(),
        merchantId,
        subscriptionId: current.id,
        kind: 'changed',
        fromPlanId: current.planId,
        toPlanId: target.id,
        fromStatus: current.status,
        toStatus: input.status,
        operatorId: actor.operatorId,
        reason: input.reason,
      });
      await this.record(
        tx,
        actor,
        merchantId,
        'platform.subscription.changed',
        'subscription',
        current.id,
        ip,
        {
          fromPlanId: current.planId,
          toPlanId: target.id,
          fromStatus: current.status,
          toStatus: input.status,
          endsAt: input.endsAt,
          trialEndsAt: input.trialEndsAt,
          reason: input.reason,
        },
      );
      return this.subscriptions.view(tx, merchantId);
    });
  }

  // ------------------------------------------------------------ plans
  async plans(actor: PlatformActor): Promise<Plan[]> {
    const rows = await this.database.db
      .select()
      .from(plans)
      .orderBy(asc(plans.sortOrder), asc(plans.code));
    const counts = await this.planCounts(actor);
    return rows.map((p) => ({ ...toPlan(p), merchantCount: counts.get(p.id) ?? 0 }));
  }

  async savePlan(
    actor: PlatformActor,
    id: string | null,
    input: O<typeof savePlanSchema>,
    ip: string,
  ): Promise<Plan> {
    const values = {
      code: input.code,
      nameEn: input.nameEn,
      nameAr: input.nameAr,
      descriptionEn: input.descriptionEn,
      descriptionAr: input.descriptionAr,
      status: input.status,
      isDefault: input.isDefault,
      isPublic: input.isPublic,
      maxBranches: input.limits.branches,
      maxEmployees: input.limits.employees,
      maxProducts: input.limits.products,
      maxRegisters: input.limits.registers,
      features: input.features,
      priceMinor: input.price === null ? null : parseAmount(input.price, 'price'),
      billingPeriod: input.billingPeriod,
      trialDays: input.trialDays,
      sortOrder: input.sortOrder,
    };
    const planId = id ?? newId();
    try {
      await this.database.withPlatformContext(actor.operatorId, null, async (tx) => {
        if (id) {
          const [current] = await tx.select().from(plans).where(eq(plans.id, id)).for('update');
          if (!current) throw AppError.notFound('Plan not found.');
          if (current.version !== input.version) throw versionConflict();
          if (current.isDefault && !input.isDefault)
            throw new AppError(
              409,
              'INVALID_STATE',
              'Choose another default plan instead of removing the default.',
            );
          if (input.isDefault && !current.isDefault)
            await tx.update(plans).set({ isDefault: false }).where(eq(plans.isDefault, true));
          await tx
            .update(plans)
            .set({ ...values, version: sql`${plans.version} + 1`, updatedAt: sql`now()` })
            .where(eq(plans.id, id));
        } else {
          if (input.isDefault)
            await tx.update(plans).set({ isDefault: false }).where(eq(plans.isDefault, true));
          await tx.insert(plans).values({ id: planId, ...values });
        }
        await this.record(
          tx,
          actor,
          null,
          id ? 'platform.plan.updated' : 'platform.plan.created',
          'plan',
          planId,
          ip,
          {
            code: input.code,
            limits: input.limits,
            features: input.features,
            price: input.price,
            status: input.status,
            isDefault: input.isDefault,
          },
        );
      });
    } catch (error) {
      if (isUniqueViolation(error, 'plans_code_key'))
        throw new AppError(409, 'DUPLICATE_CODE', 'Another plan uses this code.', [
          { path: 'code', code: 'duplicate', message: 'Another plan uses this code.' },
        ]);
      throw error;
    }
    return (await this.plans(actor)).find((p) => p.id === planId)!;
  }

  // ------------------------------------------------------------ helpers
  /** Cross-merchant summaries run only inside the operator's context (ADR-0080). */
  private read(actor: PlatformActor, query: SQL): Promise<Row[]> {
    return this.database.withPlatformContext(
      actor.operatorId,
      null,
      async (tx) => (await tx.execute(query)).rows as Row[],
    );
  }

  private async planCounts(actor: PlatformActor): Promise<Map<string, number>> {
    const rows = await this.read(actor, sql`select * from platform_plan_counts()`);
    return new Map(rows.map((r) => [r['plan_id'] as string, num(r['merchants'])]));
  }

  private async plan(tx: Transaction, planId: string) {
    const [plan] = await tx.select().from(plans).where(eq(plans.id, planId));
    if (!plan) throw AppError.notFound('Plan not found.');
    return plan;
  }

  private async assertMerchant(tx: Transaction, merchantId: string) {
    const [m] = await tx
      .select({ id: merchants.id })
      .from(merchants)
      .where(eq(merchants.id, merchantId));
    if (!m) throw AppError.notFound('Merchant not found.');
  }

  private record(
    tx: Transaction,
    actor: PlatformActor,
    merchantId: string | null,
    action: string,
    targetType: string,
    targetId: string,
    ip: string,
    details: Record<string, unknown>,
  ) {
    return this.audit.recordIn(tx, {
      merchantId,
      actorType: 'operator',
      actorId: actor.operatorId,
      action,
      targetType,
      targetId,
      ip,
      details: { ...details, operatorRole: actor.role },
    });
  }
}

function toMerchant(r: Row): PlatformMerchant {
  const status = r['subscription_status'] as string | null;
  return {
    id: r['id'] as string,
    nameEn: (r['display_name_en'] as string | null) ?? null,
    nameAr: (r['display_name_ar'] as string | null) ?? null,
    status: r['status'] as PlatformMerchant['status'],
    contactEmail: (r['contact_email'] as string | null) ?? null,
    createdAt: iso(r['created_at'])!,
    ownerEmail: (r['owner_email'] as string | null) ?? null,
    ownerName: (r['owner_name'] as string | null) ?? null,
    branchCount: num(r['branch_count']),
    employeeCount: num(r['employee_count']),
    planCode: (r['plan_code'] as string | null) ?? null,
    planNameEn: (r['plan_name_en'] as string | null) ?? null,
    planNameAr: (r['plan_name_ar'] as string | null) ?? null,
    subscriptionStatus: status
      ? effectiveStatus({
          status,
          trialEndsAt: r['trial_ends_at'] ? new Date(r['trial_ends_at'] as string) : null,
          endsAt: r['ends_at'] ? new Date(r['ends_at'] as string) : null,
        })
      : null,
    lastSaleAt: iso(r['last_sale_at']),
  };
}

function toAuditEntry(r: Row) {
  return {
    id: r['id'] as string,
    merchantId: (r['merchant_id'] as string | null) ?? null,
    merchantNameEn: (r['merchant_name_en'] as string | null) ?? null,
    merchantNameAr: (r['merchant_name_ar'] as string | null) ?? null,
    actorType: r['actor_type'] as string,
    actorName: (r['actor_name'] as string | null) ?? null,
    action: r['action'] as string,
    targetType: (r['target_type'] as string | null) ?? null,
    targetId: (r['target_id'] as string | null) ?? null,
    ip: (r['ip'] as string | null) ?? null,
    details: (r['details'] as Record<string, unknown> | null) ?? {},
    occurredAt: iso(r['occurred_at'])!,
  };
}
