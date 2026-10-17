import {
  type OverridablePermission,
  type SaleOverrideGrant,
  type requestOverrideSchema,
} from '@arabat/contracts';
import { can } from '@arabat/permissions';
import {
  assertDifferentSupervisor,
  assertOverrideUsable,
  assertSomethingToLend,
  lendableRights,
} from '@arabat/pos-core';
import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { rules } from '../../kernel/errors/pos-rule.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from '../auth/password.service.js';
import { AUTH_LIMITS, RateLimiterService } from '../auth/rate-limiter.service.js';
import { AccessRepository } from '../iam/access.repository.js';
import { memberships, users } from '../iam/iam.schema.js';
import { ShiftsService } from '../registers/shifts.service.js';
import { saleOverrides } from './sales.schema.js';

type RequestInput = z.output<typeof requestOverrideSchema>;

/** Minutes a grant stays usable: long enough to finish the payment, short enough not to be left behind. */
const GRANT_MINUTES = 10;

/** What a consumed grant lends to the checkout (BR-177). */
export interface OverrideAuthority {
  id: string;
  approverUserId: string;
  approverMembershipId: string;
  approverName: string;
  permissions: OverridablePermission[];
}

/**
 * Supervisor override on a cashier's till (BR-177, remediation R3.1). A second person types
 * their own e-mail and password on the cashier's screen; if they hold, at this branch,
 * overridable selling rights the cashier lacks, a single-use grant valid for a few minutes is
 * issued. The checkout that spends it stays on the cashier's shift and records who authorised
 * which exception; both steps are audited.
 */
@Injectable()
export class OverridesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly limiter: RateLimiterService,
    private readonly access: AccessRepository,
    private readonly shifts: ShiftsService,
    private readonly audit: AuditService,
  ) {}

  async request(actor: MerchantActor, input: RequestInput, ip: string): Promise<SaleOverrideGrant> {
    const branchId = actor.boundBranchId;
    if (!branchId) throw AppError.forbidden();
    // Same throttling as a sign-in: per address, plus wrong passwords per cashier session.
    await this.limiter.consume(`override:ip:${ip}`, AUTH_LIMITS.loginPerIp);
    const failures = `override:session:${actor.sessionId}`;
    await this.limiter.assertNotLimited(failures, AUTH_LIMITS.unlockFailuresPerSession);

    const [user] = await this.database.db
      .select({ id: users.id, passwordHash: users.passwordHash, status: users.status })
      .from(users)
      .where(eq(users.email, input.email));
    const ok = await this.passwords.verify(user?.passwordHash ?? null, input.password);
    if (!user || !ok || user.status !== 'active') {
      await this.limiter.hit(failures, AUTH_LIMITS.unlockFailuresPerSession);
      await this.audit.record({
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'sale.override_refused',
        targetType: 'branch',
        targetId: branchId,
        ip,
        details: { email: input.email, reason: 'invalid_credentials' },
      });
      throw AppError.invalidCredentials();
    }
    await this.limiter.reset(failures);
    rules(() => assertDifferentSupervisor(user.id, actor.userId));

    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const shift = await this.shifts.lockOwnShift(tx, actor);
      const [membership] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.merchantId, actor.merchantId),
            eq(memberships.userId, user.id),
            eq(memberships.status, 'active'),
          ),
        );
      const approver = membership
        ? await this.access.loadMembershipAccess(tx, membership.id)
        : null;
      // Only rights the approver holds here and the cashier lacks are worth lending.
      const permissions = approver
        ? lendableRights(
            (p) => can(approver.access, p, branchId),
            (p) => can(actor.access, p, branchId),
          )
        : [];
      if (!approver || permissions.length === 0) {
        // Recorded outside this transaction, which the refusal rolls back.
        await this.audit.record({
          merchantId: actor.merchantId,
          actorType: 'user',
          actorId: actor.userId,
          action: 'sale.override_refused',
          targetType: 'branch',
          targetId: branchId,
          ip,
          details: { approverUserId: user.id, reason: 'nothing_to_lend' },
        });
        // Always refuses here (no right to lend): OVERRIDE_NOT_ALLOWED.
        rules(() => assertSomethingToLend([]));
      }
      const [name] = await tx
        .select({ fullName: users.fullName })
        .from(users)
        .where(eq(users.id, user.id));
      const id = newId();
      const [row] = await tx
        .insert(saleOverrides)
        .values({
          id,
          merchantId: actor.merchantId,
          branchId,
          shiftId: shift.id,
          cashierMembershipId: actor.membershipId,
          cashierUserId: actor.userId,
          approverMembershipId: approver!.membershipId,
          approverUserId: user.id,
          permissions,
          note: input.note,
          expiresAt: sql`now() + make_interval(mins => ${GRANT_MINUTES})`,
        })
        .returning({ expiresAt: saleOverrides.expiresAt });
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: user.id,
        action: 'sale.override_granted',
        targetType: 'sale_override',
        targetId: id,
        ip,
        details: {
          cashierUserId: actor.userId,
          cashierMembershipId: actor.membershipId,
          shiftId: shift.id,
          branchId,
          permissions,
          note: input.note,
        },
      });
      return {
        id,
        approverName: name?.fullName ?? '',
        permissions,
        expiresAt: row!.expiresAt.toISOString(),
      };
    });
  }

  /**
   * Loads a live grant for this cashier at this branch, inside the checkout transaction.
   * The grant is marked used by `spend` once the sale is written.
   */
  async authority(
    tx: Transaction,
    actor: MerchantActor,
    overrideId: string,
    branchId: string,
  ): Promise<OverrideAuthority> {
    const [row] = (
      await tx.execute(sql`
        select o.id, o.approver_user_id, o.approver_membership_id, o.permissions, u.full_name,
               o.status, o.expires_at, o.cashier_membership_id, o.branch_id, now() as db_now
        from sale_overrides o join users u on u.id = o.approver_user_id
        where o.id = ${overrideId}`)
    ).rows as Record<string, unknown>[];
    // Single use, unexpired, this cashier, this branch (shared rule, ADR-0112), judged by the
    // database clock as before.
    rules(() =>
      assertOverrideUsable(
        row
          ? {
              status: row['status'] as string,
              expiresAt: new Date(row['expires_at'] as string | Date),
              cashierMembershipId: row['cashier_membership_id'] as string,
              branchId: row['branch_id'] as string,
            }
          : null,
        {
          cashierMembershipId: actor.membershipId,
          branchId,
          now: row ? new Date(row['db_now'] as string | Date) : new Date(),
        },
      ),
    );
    return {
      id: row!['id'] as string,
      approverUserId: row!['approver_user_id'] as string,
      approverMembershipId: row!['approver_membership_id'] as string,
      approverName: (row!['full_name'] as string | null) ?? '',
      permissions: row!['permissions'] as OverridablePermission[],
    };
  }

  /** Consumes the grant (granted → used once, trigger-enforced) with the rights it supplied. */
  async spend(tx: Transaction, overrideId: string, kinds: string[]): Promise<void> {
    const updated = await tx
      .update(saleOverrides)
      .set({ status: 'used', kinds, usedAt: sql`now()` })
      .where(and(eq(saleOverrides.id, overrideId), eq(saleOverrides.status, 'granted')))
      .returning({ id: saleOverrides.id });
    if (updated.length === 0)
      throw new AppError(
        409,
        'OVERRIDE_INVALID',
        'The supervisor approval has expired or was already used. Ask again.',
      );
  }
}
