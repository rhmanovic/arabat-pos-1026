import type {
  Assignment,
  Employee,
  Invitation,
  inviteEmployeeSchema,
  updateEmployeeSchema,
} from '@arabat/contracts';
import {
  type MerchantActorAccess,
  canGrant,
  canManageMember,
  permissionBranchScope,
} from '@arabat/permissions';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { generateToken, hashToken } from '../../kernel/crypto/tokens.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { Mailer } from '../../kernel/mail/mailer.js';
import { renderEmail } from '../../kernel/mail/template.js';
import { diffFields } from '../../kernel/audit-diff.js';
import { AuditService } from '../audit/audit.service.js';
import { sessions } from '../auth/auth.schema.js';
import { PasswordResetService } from '../auth/password-reset.service.js';
import { RateLimiterService } from '../auth/rate-limiter.service.js';
import { branches } from '../branches/branches.schema.js';
import { merchants } from '../merchants/merchants.schema.js';
import {
  invitationAssignments,
  invitations,
  memberships,
  roleAssignments,
  users,
} from './iam.schema.js';
import { RolesService, escalation } from './roles.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';

export const INVITATION_TTL_DAYS = 7;

type InviteInput = z.output<typeof inviteEmployeeSchema>;
type UpdateInput = z.output<typeof updateEmployeeSchema>;

interface Member {
  membershipId: string;
  userId: string;
  fullName: string;
  email: string;
  jobTitle: string | null;
  phone: string | null;
  employeeCode: string | null;
  isOwner: boolean;
  status: string;
  userStatus: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  assignments: Assignment[];
}

/**
 * Employee administration (Prompt 5). Employees are created only by invitation from an
 * authorized manager; managers never see or set passwords. Every change is bounded by the
 * manager's own authority (canGrant / canManageMember) and audited.
 */
@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly roles: RolesService,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
    private readonly resets: PasswordResetService,
    private readonly subscriptions: SubscriptionsService,
    private readonly limiter: RateLimiterService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Ends every session of the member at once, without deactivating them (BR-193). */
  async revokeSessions(actor: MerchantActor, membershipId: string, ip: string): Promise<number> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const member = await this.manageableMember(tx, actor, membershipId, { allowSelf: false });
      const ended = await tx
        .update(sessions)
        .set({ revokedAt: sql`now()`, revokeReason: 'manager_revoked' })
        .where(and(eq(sessions.userId, member.userId), sql`${sessions.revokedAt} is null`))
        .returning({ id: sessions.id });
      await this.record(tx, actor, 'employee.sessions_revoked', 'membership', membershipId, ip, {
        ended: ended.length,
      });
      return ended.length;
    });
  }

  /** Clears a sign-in lock caused by wrong passwords (BR-193, FND-110). */
  async unlock(actor: MerchantActor, membershipId: string, ip: string): Promise<void> {
    const email = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const member = await this.manageableMember(tx, actor, membershipId, { allowSelf: false });
      await this.record(tx, actor, 'employee.login_unlocked', 'membership', membershipId, ip);
      return member.email;
    });
    await this.limiter.reset(`login:fail:${email}`);
  }

  async list(actor: MerchantActor): Promise<{ employees: Employee[]; invitations: Invitation[] }> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const members = await this.loadMembers(tx);
      const rolePerms = await this.roles.permissionsByRole(tx);
      const visible = this.visibleFilter(actor);
      const employees = members
        .filter((m) => visible(m.assignments, m.isOwner))
        .map((m) => this.toEmployee(actor, m, rolePerms));
      const pending = await this.loadInvitations(tx);
      return { employees, invitations: pending.filter((i) => visible(i.assignments, false)) };
    });
  }

  async get(actor: MerchantActor, membershipId: string): Promise<Employee> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const member = await this.findMember(tx, membershipId);
      if (!this.visibleFilter(actor)(member.assignments, member.isOwner))
        throw AppError.notFound('Employee not found.');
      return this.toEmployee(actor, member, await this.roles.permissionsByRole(tx));
    });
  }

  /** Creates an invitation. The invited person sets their own password via the e-mailed link. */
  async invite(actor: MerchantActor, input: InviteInput, ip: string): Promise<Invitation> {
    const token = generateToken();
    const invitation = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      await this.assertGrantable(tx, actor, input.assignments);
      // Pending invitations count towards the employee limit (BR-151).
      await this.subscriptions.assertCapacity(tx, actor.merchantId, 'employees');
      const [member] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(users.email, input.email));
      if (member)
        throw new AppError(
          409,
          'ALREADY_MEMBER',
          'This person is already an employee of the company.',
        );

      // A newer invitation replaces a pending one for the same e-mail.
      await tx
        .update(invitations)
        .set({ status: 'revoked', updatedAt: sql`now()` })
        .where(and(eq(invitations.email, input.email), eq(invitations.status, 'pending')));
      const id = newId();
      await tx.insert(invitations).values({
        id,
        merchantId: actor.merchantId,
        email: input.email,
        fullName: input.fullName,
        jobTitle: input.jobTitle ?? null,
        phone: input.phone ?? null,
        employeeCode: input.employeeCode ?? null,
        tokenHash: hashToken(token),
        invitedBy: actor.membershipId,
        expiresAt: sql`now() + make_interval(days => ${INVITATION_TTL_DAYS})`,
      });
      await tx.insert(invitationAssignments).values(
        input.assignments.map((a) => ({
          merchantId: actor.merchantId,
          invitationId: id,
          roleId: a.roleId,
          branchId: a.branchId,
        })),
      );
      await this.record(tx, actor, 'employee.invited', 'invitation', id, ip, {
        email: input.email,
        assignments: input.assignments,
      });
      return (await this.loadInvitations(tx)).find((i) => i.id === id)!;
    });
    await this.sendInvitation(
      actor.merchantId,
      input.email,
      input.fullName,
      token,
      input.interface,
    );
    return invitation;
  }

  async resendInvitation(
    actor: MerchantActor,
    invitationId: string,
    ip: string,
  ): Promise<Invitation> {
    const token = generateToken();
    const invitation = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const current = (await this.loadInvitations(tx)).find(
        (i) => i.id === invitationId && i.status === 'pending',
      );
      if (!current) throw AppError.notFound('Invitation not found.');
      await this.assertGrantable(tx, actor, current.assignments);
      await tx
        .update(invitations)
        .set({
          tokenHash: hashToken(token),
          expiresAt: sql`now() + make_interval(days => ${INVITATION_TTL_DAYS})`,
          updatedAt: sql`now()`,
        })
        .where(eq(invitations.id, invitationId));
      await this.record(tx, actor, 'employee.invitation_resent', 'invitation', invitationId, ip);
      return (await this.loadInvitations(tx)).find((i) => i.id === invitationId)!;
    });
    const rolePerms = await this.database.withMerchantTx(actor.merchantId, (tx) =>
      this.roles.permissionsByRole(tx),
    );
    await this.sendInvitation(
      actor.merchantId,
      invitation.email,
      invitation.fullName,
      token,
      preferredInterface(invitation.assignments, rolePerms),
    );
    return invitation;
  }

  async revokeInvitation(actor: MerchantActor, invitationId: string, ip: string): Promise<void> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const current = (await this.loadInvitations(tx)).find(
        (i) => i.id === invitationId && i.status === 'pending',
      );
      if (!current) throw AppError.notFound('Invitation not found.');
      await this.assertGrantable(tx, actor, current.assignments);
      await tx
        .update(invitations)
        .set({ status: 'revoked', updatedAt: sql`now()` })
        .where(eq(invitations.id, invitationId));
      await this.record(tx, actor, 'employee.invitation_revoked', 'invitation', invitationId, ip);
    });
  }

  async updateProfile(
    actor: MerchantActor,
    membershipId: string,
    input: UpdateInput,
    ip: string,
  ): Promise<Employee> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const member = await this.manageableMember(tx, actor, membershipId, { allowSelf: false });
      const next = {
        jobTitle: input.jobTitle,
        phone: input.phone,
        employeeCode: input.employeeCode,
      };
      await tx
        .update(memberships)
        .set({ ...next, updatedAt: sql`now()` })
        .where(eq(memberships.id, member.membershipId));
      await this.record(tx, actor, 'employee.updated', 'membership', membershipId, ip, {
        changes: diffFields(member, next, ['jobTitle', 'phone', 'employeeCode']),
      });
      return this.toEmployee(
        actor,
        await this.findMember(tx, membershipId),
        await this.roles.permissionsByRole(tx),
      );
    });
  }

  /** Deactivation takes effect immediately: the member's sessions are revoked. */
  async setStatus(
    actor: MerchantActor,
    membershipId: string,
    status: 'active' | 'inactive',
    ip: string,
  ): Promise<Employee> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const member = await this.manageableMember(tx, actor, membershipId, { allowSelf: false });
      if (status === 'active' && member.status !== 'active')
        await this.subscriptions.assertCapacity(tx, actor.merchantId, 'employees');
      await tx
        .update(memberships)
        .set({ status, updatedAt: sql`now()` })
        .where(eq(memberships.id, membershipId));
      let invitationsRevoked = 0;
      if (status === 'inactive') {
        await tx
          .update(sessions)
          .set({ revokedAt: sql`now()`, revokeReason: 'membership_deactivated' })
          .where(and(eq(sessions.membershipId, membershipId), sql`${sessions.revokedAt} is null`));
        // Invitations stand on the inviter's authority: they fall with it (BR-193, FND-108).
        const revoked = await tx
          .update(invitations)
          .set({ status: 'revoked', updatedAt: sql`now()` })
          .where(and(eq(invitations.invitedBy, membershipId), eq(invitations.status, 'pending')))
          .returning({ id: invitations.id });
        invitationsRevoked = revoked.length;
      }
      await this.record(
        tx,
        actor,
        status === 'active' ? 'employee.activated' : 'employee.deactivated',
        'membership',
        membershipId,
        ip,
        invitationsRevoked ? { invitationsRevoked } : {},
      );
      return this.toEmployee(
        actor,
        await this.findMember(tx, membershipId),
        await this.roles.permissionsByRole(tx),
      );
    });
  }

  /** Replaces the member's role assignments; both old and new grants must be within the actor's authority. */
  async setAssignments(
    actor: MerchantActor,
    membershipId: string,
    assignments: Assignment[],
    ip: string,
  ): Promise<Employee> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const member = await this.manageableMember(tx, actor, membershipId, { allowSelf: false });
      await this.assertGrantable(tx, actor, assignments);
      await tx.delete(roleAssignments).where(eq(roleAssignments.membershipId, membershipId));
      const unique = dedupe(assignments);
      if (unique.length) {
        await tx.insert(roleAssignments).values(
          unique.map((a) => ({
            id: newId(),
            merchantId: actor.merchantId,
            membershipId,
            roleId: a.roleId,
            branchId: a.branchId,
          })),
        );
      }
      await this.record(tx, actor, 'employee.roles_changed', 'membership', membershipId, ip, {
        before: member.assignments,
        after: unique,
      });
      return this.toEmployee(
        actor,
        await this.findMember(tx, membershipId),
        await this.roles.permissionsByRole(tx),
      );
    });
  }

  /** Sends the employee a password reset link; the manager never sees a password. */
  async sendPasswordReset(actor: MerchantActor, membershipId: string, ip: string): Promise<void> {
    const { member, rolePerms } = await this.database.withMerchantTx(
      actor.merchantId,
      async (tx) => {
        const m = await this.manageableMember(tx, actor, membershipId, { allowSelf: false });
        await this.record(
          tx,
          actor,
          'employee.password_reset_sent',
          'membership',
          membershipId,
          ip,
        );
        return { member: m, rolePerms: await this.roles.permissionsByRole(tx) };
      },
    );
    await this.resets.requestReset(
      member.email,
      preferredInterface(member.assignments, rolePerms),
      { ip, userAgent: null },
    );
  }

  // ------------------------------------------------------------ helpers

  /** Every assignment must reference a role and an active branch of this merchant and be grantable. */
  private async assertGrantable(
    tx: Transaction,
    actor: MerchantActor,
    assignments: Assignment[],
  ): Promise<void> {
    const rolePerms = await this.roles.permissionsByRole(tx);
    const branchIds = [
      ...new Set(assignments.map((a) => a.branchId).filter((b): b is string => b !== null)),
    ];
    const activeBranches = branchIds.length
      ? await tx
          .select({ id: branches.id })
          .from(branches)
          .where(and(inArray(branches.id, branchIds), eq(branches.status, 'active')))
      : [];
    const active = new Set(activeBranches.map((b) => b.id));
    const missing: string[] = [];
    for (const a of assignments) {
      const perms = rolePerms.get(a.roleId);
      if (!perms) throw AppError.notFound('Role not found.');
      if (a.branchId !== null && !active.has(a.branchId))
        throw AppError.notFound('Branch not found or inactive.');
      const result = canGrant(actor.access, perms, a.branchId);
      if (!result.ok) missing.push(...result.missing);
    }
    if (missing.length) throw escalation([...new Set(missing)]);
  }

  private async manageableMember(
    tx: Transaction,
    actor: MerchantActor,
    membershipId: string,
    _opts: { allowSelf: boolean },
  ): Promise<Member> {
    const member = await this.findMember(tx, membershipId);
    const rolePerms = await this.roles.permissionsByRole(tx);
    if (!this.visibleFilter(actor)(member.assignments, member.isOwner))
      throw AppError.notFound('Employee not found.');
    if (
      !canManageMember(
        actor.access,
        this.accessOf(member, rolePerms),
        member.membershipId === actor.membershipId,
      )
    ) {
      throw escalation([]);
    }
    return member;
  }

  private accessOf(member: Member, rolePerms: Map<string, string[]>): MerchantActorAccess {
    return {
      isOwner: member.isOwner,
      membershipActive: member.status === 'active',
      merchantActive: true,
      assignments: member.assignments.map((a) => ({
        branchId: a.branchId,
        permissions: rolePerms.get(a.roleId) ?? [],
      })),
    };
  }

  /** employees.read scope: everyone for merchant-wide access; otherwise members assigned to those branches. */
  private visibleFilter(actor: MerchantActor) {
    const scope = permissionBranchScope(actor.access, 'employees.read');
    return (assignments: Assignment[], isOwner: boolean) => {
      if (scope.all) return true;
      if (isOwner) return false;
      return assignments.some((a) => a.branchId !== null && scope.branchIds.includes(a.branchId));
    };
  }

  private toEmployee(actor: MerchantActor, m: Member, rolePerms: Map<string, string[]>): Employee {
    return {
      membershipId: m.membershipId,
      userId: m.userId,
      fullName: m.fullName,
      email: m.email,
      jobTitle: m.jobTitle,
      phone: m.phone,
      employeeCode: m.employeeCode,
      isOwner: m.isOwner,
      status: m.status as Employee['status'],
      userStatus: m.userStatus as Employee['userStatus'],
      lastLoginAt: m.lastLoginAt?.toISOString() ?? null,
      assignments: m.assignments,
      manageable: canManageMember(
        actor.access,
        this.accessOf(m, rolePerms),
        m.membershipId === actor.membershipId,
      ),
      createdAt: m.createdAt.toISOString(),
    };
  }

  private async loadMembers(tx: Transaction, membershipId?: string): Promise<Member[]> {
    const rows = await tx
      .select({
        membershipId: memberships.id,
        userId: users.id,
        fullName: users.fullName,
        email: users.email,
        jobTitle: memberships.jobTitle,
        phone: memberships.phone,
        employeeCode: memberships.employeeCode,
        isOwner: memberships.isOwner,
        status: memberships.status,
        userStatus: users.status,
        lastLoginAt: users.lastLoginAt,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(membershipId ? eq(memberships.id, membershipId) : undefined)
      .orderBy(desc(memberships.isOwner), users.fullName);
    const assignments = await tx
      .select({
        membershipId: roleAssignments.membershipId,
        roleId: roleAssignments.roleId,
        branchId: roleAssignments.branchId,
      })
      .from(roleAssignments);
    return rows.map((r) => ({
      ...r,
      assignments: assignments
        .filter((a) => a.membershipId === r.membershipId)
        .map(({ roleId, branchId }) => ({ roleId, branchId })),
    }));
  }

  private async findMember(tx: Transaction, membershipId: string): Promise<Member> {
    const [member] = await this.loadMembers(tx, membershipId);
    if (!member) throw AppError.notFound('Employee not found.');
    return member;
  }

  private async loadInvitations(tx: Transaction): Promise<Invitation[]> {
    const rows = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.status, 'pending'))
      .orderBy(desc(invitations.createdAt));
    const assigned = await tx.select().from(invitationAssignments);
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      fullName: r.fullName,
      jobTitle: r.jobTitle,
      status: r.status as Invitation['status'],
      expired: r.expiresAt.getTime() < now,
      assignments: assigned
        .filter((a) => a.invitationId === r.id)
        .map((a) => ({ roleId: a.roleId, branchId: a.branchId })),
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async sendInvitation(
    merchantId: string,
    email: string,
    fullName: string,
    token: string,
    appInterface: 'manager' | 'pos',
  ) {
    const [merchant] = await this.database.withMerchantTx(merchantId, (tx) =>
      tx
        .select({ nameAr: merchants.displayNameAr, nameEn: merchants.displayNameEn })
        .from(merchants),
    );
    const company = merchant?.nameAr ?? merchant?.nameEn ?? '';
    const base = appInterface === 'pos' ? this.env.PUBLIC_POS_URL : this.env.PUBLIC_MANAGER_URL;
    const link = `${base.replace(/\/$/, '')}/accept-invite?token=${encodeURIComponent(token)}`;
    // The address the employee keeps using after the first sign-in (owner request, 2026-10-16).
    const appName =
      appInterface === 'pos'
        ? { ar: 'نقطة البيع (الكاشير)', en: 'the register (POS)' }
        : { ar: 'تطبيق الإدارة', en: 'the management app' };
    try {
      const companyEn = merchant?.nameEn ?? company;
      await this.mailer.send({
        to: email,
        ...renderEmail({
          title: { ar: `دعوة للانضمام إلى ${company}`, en: `Invitation to join ${companyEn}` },
          name: fullName,
          intro: {
            ar: `تمت دعوتك للانضمام إلى فريق ${company} على Arabat POS. اضغط الزر التالي خلال ${INVITATION_TTL_DAYS} أيام لإعداد حسابك واختيار كلمة المرور:`,
            en: `You have been invited to join the ${companyEn} team on Arabat POS. Use the button below within ${INVITATION_TTL_DAYS} days to set up your account and choose a password:`,
          },
          action: { label: { ar: 'قبول الدعوة', en: 'Accept invitation' }, url: link },
          note: {
            ar: `بعد اختيار كلمة المرور ادخل ${appName.ar} كل يوم من: ${base} — إن لم تكن تتوقع هذه الدعوة فتجاهل الرسالة.`,
            en: `After choosing your password, open ${appName.en} every day at: ${base} — if you were not expecting this invitation, ignore this e-mail.`,
          },
        }),
      });
    } catch (error) {
      // The invitation exists; the manager can resend it.
      this.logger.error(`Invitation e-mail failed: ${(error as Error).message}`);
    }
  }

  private record(
    tx: Transaction,
    actor: MerchantActor,
    action: string,
    targetType: string,
    targetId: string,
    ip: string,
    details = {},
  ) {
    return this.audit.recordIn(tx, {
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action,
      targetType,
      targetId,
      ip,
      details,
    });
  }
}

/** Links in e-mails open the management app when any granted role includes it, else the POS. */
export function preferredInterface(
  assignments: Assignment[],
  rolePerms: Map<string, string[]>,
): 'manager' | 'pos' {
  return assignments.some((a) => rolePerms.get(a.roleId)?.includes('manager.access'))
    ? 'manager'
    : 'pos';
}

function dedupe(assignments: Assignment[]): Assignment[] {
  const seen = new Set<string>();
  return assignments.filter((a) => {
    const key = `${a.roleId}:${a.branchId ?? '*'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
