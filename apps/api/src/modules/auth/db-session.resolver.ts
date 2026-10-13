import type { AppInterface } from '@arabat/contracts';
import { PLATFORM_ROLES, type PlatformRole } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { DatabaseService } from '../../database/database.service.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { type Actor, SessionResolver } from '../../kernel/access/session-resolver.js';
import { AccessRepository, eligibleBranches } from '../iam/access.repository.js';
import { users } from '../iam/iam.schema.js';
import { merchants } from '../merchants/merchants.schema.js';
import { platformOperators } from '../platform-admin/platform.schema.js';
import { SessionService } from './session.service.js';

/**
 * Database-backed session resolution (replaces the M0 deny-all resolver, ADR-0022).
 * Every request re-checks user, membership and merchant status, so deactivation and
 * suspension take effect immediately (BR-023); invalid sessions are revoked on sight.
 */
@Injectable()
export class DbSessionResolver extends SessionResolver {
  constructor(
    private readonly sessions: SessionService,
    private readonly database: DatabaseService,
    private readonly accessRepository: AccessRepository,
  ) {
    super();
  }

  async resolve(request: FastifyRequest, appInterface: AppInterface): Promise<Actor | null> {
    const token = this.sessions.readCookie(request, appInterface);
    if (!token) return null;
    const session = await this.sessions.findLive(token, appInterface);
    if (!session) return null;
    // A locked POS answers nothing until the password is entered again (POST /auth/pos/unlock).
    if (session.lockedAt)
      throw new AppError(401, 'SESSION_LOCKED', 'The POS is locked. Enter your password.');

    const actor =
      session.realm === 'platform'
        ? await this.platformActor(session)
        : await this.merchantActor(session);
    if (!actor) {
      await this.sessions.revoke(session.id, 'context_invalid');
      return null;
    }
    await this.sessions.touch(session);
    return actor;
  }

  private async platformActor(session: {
    id: string;
    operatorId: string | null;
    createdAt: Date;
  }): Promise<Actor | null> {
    if (!session.operatorId) return null;
    const [operator] = await this.database.db
      .select({ status: platformOperators.status, role: platformOperators.platformRole })
      .from(platformOperators)
      .where(eq(platformOperators.id, session.operatorId));
    if (operator?.status !== 'active' || !PLATFORM_ROLES.includes(operator.role as PlatformRole))
      return null;
    return {
      realm: 'platform',
      interface: 'platform',
      sessionId: session.id,
      operatorId: session.operatorId,
      role: operator.role as PlatformRole,
    };
  }

  private async ownerFrozen(merchantId: string): Promise<boolean> {
    const [m] = await this.database.withMerchantTx(merchantId, (tx) =>
      tx
        .select({ frozen: merchants.ownerFrozenAt })
        .from(merchants)
        .where(eq(merchants.id, merchantId)),
    );
    return Boolean(m?.frozen);
  }

  private async merchantActor(session: {
    id: string;
    interface: string;
    userId: string | null;
    merchantId: string | null;
    membershipId: string | null;
    branchId: string | null;
    createdAt: Date;
  }): Promise<Actor | null> {
    const { userId, merchantId, membershipId } = session;
    if (!userId || !merchantId || !membershipId) return null;

    const [user] = await this.database.db
      .select({ status: users.status, passwordChangedAt: users.passwordChangedAt })
      .from(users)
      .where(eq(users.id, userId));
    if (user?.status !== 'active') return null;
    // A password change ends every session created before it.
    if (user.passwordChangedAt.getTime() > session.createdAt.getTime() + 1000) return null;

    const membership = await this.database.withMerchantTx(merchantId, (tx) =>
      this.accessRepository.loadMembershipAccess(tx, membershipId),
    );
    if (!membership || membership.userId !== userId) return null;
    if (!membership.access.membershipActive || !membership.access.merchantActive) return null;
    // An owner frozen by the platform (BR-020) is out until released.
    if (membership.access.isOwner && (await this.ownerFrozen(merchantId))) return null;
    // The interface permission must still hold: revoking `manager.access` or `pos.access`
    // (or deactivating the bound branch) ends the session on its next request.
    const allowed = eligibleBranches(membership, session.interface as 'manager' | 'pos');
    if (session.interface === 'pos' && !allowed.some((b) => b.id === session.branchId)) return null;
    if (session.interface === 'manager' && allowed.length === 0) return null;

    return {
      realm: 'merchant',
      interface: session.interface as 'manager' | 'pos',
      sessionId: session.id,
      userId,
      merchantId,
      membershipId,
      boundBranchId: session.interface === 'pos' ? session.branchId : null,
      access: membership.access,
    };
  }
}
