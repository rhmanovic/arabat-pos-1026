import { type InvitationPreview, newPasswordSchema } from '@arabat/contracts';
import { Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { hashToken } from '../../kernel/crypto/tokens.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from '../auth/password.service.js';
import { AUTH_LIMITS, RateLimiterService } from '../auth/rate-limiter.service.js';
import type { ClientInfo } from '../auth/session.service.js';
import { branches } from '../branches/branches.schema.js';
import { merchants } from '../merchants/merchants.schema.js';
import { AccessRepository, interfacesFor } from './access.repository.js';
import {
  invitationAssignments,
  invitations,
  memberships,
  roleAssignments,
  roles,
  users,
} from './iam.schema.js';

const INVALID = () =>
  new AppError(400, 'INVITATION_INVALID', 'This invitation is invalid, expired or already used.');

/** Public side of invitations: the invited person previews and accepts with their own password. */
@Injectable()
export class InvitationAcceptanceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly limiter: RateLimiterService,
    private readonly access: AccessRepository,
    private readonly audit: AuditService,
  ) {}

  async preview(token: string, client: ClientInfo): Promise<InvitationPreview> {
    await this.limiter.consume(`invite:ip:${client.ip}`, AUTH_LIMITS.resetPerIp);
    const invitation = await this.find(token);
    const [merchant] = await this.database.withMerchantTx(invitation.merchantId, (tx) =>
      tx
        .select({ nameEn: merchants.displayNameEn, nameAr: merchants.displayNameAr })
        .from(merchants),
    );
    const [user] = await this.database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, invitation.email));
    return {
      email: invitation.email,
      fullName: invitation.fullName,
      merchant: { nameEn: merchant?.nameEn ?? null, nameAr: merchant?.nameAr ?? null },
      existingAccount: Boolean(user),
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  async accept(
    token: string,
    password: string,
    language: 'ar' | 'en' | undefined,
    client: ClientInfo,
  ) {
    await this.limiter.consume(`invite:ip:${client.ip}`, AUTH_LIMITS.resetPerIp);
    const invitation = await this.find(token);
    const [existingUser] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.email, invitation.email));

    let userId: string;
    let newUserHash: string | null = null;
    if (existingUser) {
      // An existing account proves ownership with its current password.
      if (!(await this.passwords.verify(existingUser.passwordHash, password)))
        throw AppError.invalidCredentials();
      if (existingUser.status !== 'active')
        throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.');
      userId = existingUser.id;
    } else {
      const parsed = newPasswordSchema.safeParse(password);
      if (!parsed.success) {
        throw AppError.validation(
          parsed.error.issues.map((i) => ({ path: 'password', code: i.code, message: i.message })),
        );
      }
      newUserHash = await this.passwords.hash(password);
      userId = newId();
    }

    const membershipId = newId();
    await this.database.withContext({ merchantId: invitation.merchantId, userId }, async (tx) => {
      // Claim the invitation atomically (single use, even with concurrent requests).
      const [claimed] = await tx
        .update(invitations)
        .set({
          status: 'accepted',
          acceptedAt: sql`now()`,
          acceptedMembershipId: membershipId,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(invitations.id, invitation.id),
            eq(invitations.status, 'pending'),
            gt(invitations.expiresAt, sql`now()`),
          ),
        )
        .returning({ id: invitations.id });
      if (!claimed) throw INVALID();

      if (newUserHash) {
        await tx.insert(users).values({
          id: userId,
          email: invitation.email,
          passwordHash: newUserHash,
          fullName: invitation.fullName,
          preferredLanguage: language ?? null,
          emailVerifiedAt: sql`now()`,
        });
      }
      // Filter by merchant: the user-context RLS also exposes the user's memberships elsewhere.
      const [already] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(eq(memberships.userId, userId), eq(memberships.merchantId, invitation.merchantId)),
        );
      if (already)
        throw new AppError(409, 'ALREADY_MEMBER', 'You are already a member of this company.');

      await tx.insert(memberships).values({
        id: membershipId,
        merchantId: invitation.merchantId,
        userId,
        status: 'active',
        jobTitle: invitation.jobTitle,
        phone: invitation.phone,
        employeeCode: invitation.employeeCode,
      });
      // Only grants whose role still exists and whose branch is still active are applied.
      const grants = await tx
        .select({ roleId: invitationAssignments.roleId, branchId: invitationAssignments.branchId })
        .from(invitationAssignments)
        .innerJoin(roles, eq(roles.id, invitationAssignments.roleId))
        .where(eq(invitationAssignments.invitationId, invitation.id));
      const branchIds = grants.map((g) => g.branchId).filter((b): b is string => b !== null);
      const active = new Set(
        branchIds.length
          ? (
              await tx
                .select({ id: branches.id })
                .from(branches)
                .where(and(inArray(branches.id, branchIds), eq(branches.status, 'active')))
            ).map((b) => b.id)
          : [],
      );
      const valid = grants.filter((g) => g.branchId === null || active.has(g.branchId));
      if (valid.length) {
        await tx
          .insert(roleAssignments)
          .values(
            valid.map((g) => ({
              id: newId(),
              merchantId: invitation.merchantId,
              membershipId,
              roleId: g.roleId,
              branchId: g.branchId,
            })),
          );
      }
      await this.audit.recordIn(tx, {
        merchantId: invitation.merchantId,
        actorType: 'user',
        actorId: userId,
        action: 'employee.invitation_accepted',
        targetType: 'membership',
        targetId: membershipId,
        ip: client.ip,
        details: { invitationId: invitation.id, newAccount: Boolean(newUserHash) },
      });
    });

    const access = await this.database.withMerchantTx(invitation.merchantId, (tx) =>
      this.access.loadMembershipAccess(tx, membershipId),
    );
    return {
      status: 'accepted' as const,
      availableInterfaces: access ? interfacesFor(access) : [],
    };
  }

  private async find(token: string) {
    const tokenHash = hashToken(token);
    const [invitation] = await this.database.withContext({ inviteHash: tokenHash }, (tx) =>
      tx
        .select()
        .from(invitations)
        .where(
          and(
            eq(invitations.tokenHash, tokenHash),
            eq(invitations.status, 'pending'),
            gt(invitations.expiresAt, sql`now()`),
          ),
        ),
    );
    if (!invitation) throw INVALID();
    return invitation;
  }
}
