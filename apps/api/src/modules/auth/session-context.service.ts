import type { LoginResult, MeResponse, MerchantInterface, MerchantOption } from '@arabat/contracts';
import { PERMISSIONS, type PermissionKey, can } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import type { MerchantActor, PlatformActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import {
  AccessRepository,
  type MembershipAccess,
  eligibleBranches,
  interfacesFor,
  toMerchantOption,
} from '../iam/access.repository.js';
import { users } from '../iam/iam.schema.js';
import { platformOperators } from '../platform-admin/platform.schema.js';
import { sessions } from './auth.schema.js';
import { type LoginOutcome, LoginService } from './login.service.js';
import { type ClientInfo, SessionService } from './session.service.js';

/** Current-user / merchant context APIs and controlled interface or merchant switching. */
@Injectable()
export class SessionContextService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessRepository,
    private readonly logins: LoginService,
    private readonly sessions: SessionService,
  ) {}

  async merchantMe(actor: MerchantActor): Promise<MeResponse> {
    const memberships = await this.access.loadUserMemberships(actor.userId);
    const current = memberships.find((m) => m.membershipId === actor.membershipId);
    if (!current) throw AppError.unauthenticated();
    const [user] = await this.database.db
      .select({
        email: users.email,
        fullName: users.fullName,
        preferredLanguage: users.preferredLanguage,
      })
      .from(users)
      .where(eq(users.id, actor.userId));
    const session = await this.sessionTimes(actor.sessionId);
    const branch = actor.boundBranchId
      ? (current.branches.find((b) => b.id === actor.boundBranchId) ?? null)
      : null;

    return {
      interface: actor.interface,
      realm: 'merchant',
      actor: {
        id: actor.userId,
        email: user!.email,
        fullName: user!.fullName,
        preferredLanguage: (user!.preferredLanguage as 'ar' | 'en' | null) ?? null,
      },
      merchant: { id: current.merchantId, ...current.merchant },
      branch,
      isOwner: current.access.isOwner,
      permissions: effectivePermissions(current, actor),
      availableInterfaces: interfacesFor(current),
      merchantCount: memberships.filter((m) => interfacesFor(m).length > 0).length,
      session,
    };
  }

  async platformMe(actor: PlatformActor): Promise<MeResponse> {
    const [operator] = await this.database.db
      .select({ email: platformOperators.email, fullName: platformOperators.fullName })
      .from(platformOperators)
      .where(eq(platformOperators.id, actor.operatorId));
    return {
      interface: 'platform',
      realm: 'platform',
      actor: {
        id: actor.operatorId,
        email: operator!.email,
        fullName: operator!.fullName,
        preferredLanguage: null,
      },
      merchant: null,
      branch: null,
      isOwner: false,
      permissions: [actor.role],
      availableInterfaces: [],
      merchantCount: 0,
      session: await this.sessionTimes(actor.sessionId),
    };
  }

  async listMerchants(actor: MerchantActor): Promise<MerchantOption[]> {
    const memberships = await this.access.loadUserMemberships(actor.userId);
    return memberships
      .filter((m) => eligibleBranches(m, actor.interface).length > 0)
      .map((m) => toMerchantOption(m, actor.interface));
  }

  /** Opens the other merchant application for the same merchant, if authorized. */
  async switchInterface(
    actor: MerchantActor,
    target: MerchantInterface,
    branchId: string | undefined,
    client: ClientInfo,
  ): Promise<LoginOutcome> {
    const membership = await this.currentMembership(actor);
    return this.openIn(
      actor.userId,
      membership,
      target,
      branchId,
      client,
      'auth.interface.switched',
    );
  }

  /** POS: move the session to another branch where the user holds `pos.access`. */
  async switchBranch(
    actor: MerchantActor,
    branchId: string,
    client: ClientInfo,
  ): Promise<LoginOutcome> {
    const membership = await this.currentMembership(actor);
    if (!eligibleBranches(membership, 'pos').some((b) => b.id === branchId)) {
      throw AppError.forbidden('You do not have POS access at this branch.');
    }
    const outcome = await this.openIn(
      actor.userId,
      membership,
      'pos',
      branchId,
      client,
      'auth.branch.switched',
    );
    await this.sessions.revoke(actor.sessionId, 'branch_switched');
    return outcome;
  }

  /** Moves the current interface to another merchant the user belongs to. */
  async switchMerchant(
    actor: MerchantActor,
    merchantId: string,
    branchId: string | undefined,
    client: ClientInfo,
  ): Promise<LoginOutcome> {
    const memberships = await this.access.loadUserMemberships(actor.userId);
    const membership = memberships.find((m) => m.merchantId === merchantId);
    if (!membership) throw AppError.forbidden('You do not have access to this merchant.');
    const outcome = await this.openIn(
      actor.userId,
      membership,
      actor.interface,
      branchId,
      client,
      'auth.merchant.switched',
    );
    if (outcome.session) await this.sessions.revoke(actor.sessionId, 'merchant_switched');
    return outcome;
  }

  private async openIn(
    userId: string,
    membership: MembershipAccess,
    target: MerchantInterface,
    branchId: string | undefined,
    client: ClientInfo,
    action: string,
  ): Promise<LoginOutcome> {
    const branches = eligibleBranches(membership, target);
    if (branches.length === 0) {
      throw new AppError(
        403,
        'INTERFACE_NOT_PERMITTED',
        'You are not authorized for this application.',
        undefined,
        {
          availableInterfaces: interfacesFor(membership),
        },
      );
    }
    if (target === 'manager')
      return this.logins.complete(userId, membership, 'manager', null, client, action);

    const branch = branchId
      ? branches.find((b) => b.id === branchId)
      : branches.length === 1
        ? branches[0]
        : undefined;
    if (branchId && !branch) throw AppError.forbidden('You do not have POS access at this branch.');
    if (!branch) {
      const result: LoginResult = { status: 'select_branch', branches };
      return { result };
    }
    return this.logins.complete(userId, membership, 'pos', branch, client, action);
  }

  private async currentMembership(actor: MerchantActor): Promise<MembershipAccess> {
    const membership = await this.database.withMerchantTx(actor.merchantId, (tx) =>
      this.access.loadMembershipAccess(tx, actor.membershipId),
    );
    if (!membership) throw AppError.unauthenticated();
    return membership;
  }

  private async sessionTimes(sessionId: string) {
    const [row] = await this.database.db
      .select({ expiresAt: sessions.expiresAt, idleExpiresAt: sessions.idleExpiresAt })
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    return {
      expiresAt: row!.expiresAt.toISOString(),
      idleExpiresAt: row!.idleExpiresAt.toISOString(),
    };
  }
}

/** Keys effective in this session: at the bound branch for the POS, anywhere for /manager. */
function effectivePermissions(membership: MembershipAccess, actor: MerchantActor): string[] {
  const keys = Object.keys(PERMISSIONS) as PermissionKey[];
  return keys.filter((key) =>
    actor.interface === 'pos'
      ? can(membership.access, key, actor.boundBranchId)
      : can(membership.access, key, null) ||
        membership.branches.some((b) => can(membership.access, key, b.id)),
  );
}
