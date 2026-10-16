import type {
  BranchOption,
  LoginRequest,
  LoginResult,
  MerchantInterface,
  SelectMerchantRequest,
} from '@arabat/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { Mailer } from '../../kernel/mail/mailer.js';
import { renderEmail } from '../../kernel/mail/template.js';
import { AuditService } from '../audit/audit.service.js';
import {
  AccessRepository,
  type MembershipAccess,
  eligibleBranches,
  interfacesFor,
  toMerchantOption,
} from '../iam/access.repository.js';
import { users } from '../iam/iam.schema.js';
import { merchants } from '../merchants/merchants.schema.js';
import { PasswordService } from './password.service.js';
import { AUTH_LIMITS, RateLimiterService } from './rate-limiter.service.js';
import { INTERFACE_HOME } from './session-policy.js';
import { type ClientInfo, SessionService } from './session.service.js';
import { TicketService } from './ticket.service.js';

export interface IssuedSession {
  interface: MerchantInterface;
  token: string;
}

export interface LoginOutcome {
  result: LoginResult;
  session?: IssuedSession;
}

/** Merchant sign-in for /manager and /pos (AUTH.md §2). */
@Injectable()
export class LoginService {
  private readonly logger = new Logger(LoginService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly limiter: RateLimiterService,
    private readonly sessions: SessionService,
    private readonly tickets: TicketService,
    private readonly access: AccessRepository,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
  ) {}

  async login(input: LoginRequest & { email: string }, client: ClientInfo): Promise<LoginOutcome> {
    const failureKey = `login:fail:${input.email}`;
    await this.limiter.consume(`login:ip:${client.ip}`, AUTH_LIMITS.loginPerIp);
    await this.limiter.assertNotLimited(failureKey, AUTH_LIMITS.loginFailuresPerEmail);

    const [user] = await this.database.db.select().from(users).where(eq(users.email, input.email));
    const passwordOk = await this.passwords.verify(user?.passwordHash ?? null, input.password);
    if (!user || !passwordOk) {
      const { justLocked } = await this.limiter.hitAndCheck(
        failureKey,
        AUTH_LIMITS.loginFailuresPerEmail,
      );
      await this.audit.record({
        merchantId: null,
        actorType: 'anonymous',
        action: 'auth.login.failed',
        ip: client.ip,
        details: { email: input.email, interface: input.interface },
      });
      // The account holder learns of a lock-out at once (BR-193, FND-110); the caller does not.
      if (justLocked && user) await this.notifyLocked(user.email, user.fullName, client.ip);
      throw AppError.invalidCredentials();
    }
    await this.limiter.reset(failureKey);

    // From here the password is proven, so specific answers do not enable enumeration.
    if (user.status !== 'active') {
      throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.');
    }

    const memberships = await this.access.loadUserMemberships(user.id);
    const eligible = memberships.filter((m) => eligibleBranches(m, input.interface).length > 0);
    if (eligible.length === 0) throw noAccessError(memberships);

    const single = eligible.length === 1 ? eligible[0]! : null;
    const branches = single ? eligibleBranches(single, input.interface) : [];
    if (single && (input.interface === 'manager' || branches.length === 1)) {
      return this.complete(user.id, single, input.interface, branches[0] ?? null, client);
    }

    const ticket = await this.tickets.issue('merchant_selection', input.interface, {
      userId: user.id,
    });
    return {
      result: {
        status: 'select_merchant',
        ticket,
        merchants: eligible.map((m) => toMerchantOption(m, input.interface)),
      },
    };
  }

  /** Second step: the user picks a merchant (and, for the POS, a branch). */
  async select(input: SelectMerchantRequest, client: ClientInfo): Promise<LoginOutcome> {
    await this.limiter.consume(`select:ip:${client.ip}`, AUTH_LIMITS.selectPerIp);
    const ticket = await this.tickets.open(input.ticket, 'merchant_selection');
    const appInterface = ticket.interface as MerchantInterface;
    if (!ticket.userId) throw new AppError(401, 'TICKET_INVALID', 'Invalid sign-in step.');

    const [user] = await this.database.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, ticket.userId));
    if (user?.status !== 'active')
      throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.');

    const memberships = await this.access.loadUserMemberships(ticket.userId);
    const membership = memberships.find((m) => m.merchantId === input.merchantId);
    const branches = membership ? eligibleBranches(membership, appInterface) : [];
    if (!membership || branches.length === 0)
      throw AppError.forbidden('You do not have access to this merchant.');

    let branch: BranchOption | null = null;
    if (appInterface === 'pos') {
      branch = input.branchId
        ? (branches.find((b) => b.id === input.branchId) ?? null)
        : branches.length === 1
          ? branches[0]!
          : null;
      if (!branch) throw AppError.forbidden('You do not have POS access at this branch.');
    }

    await this.tickets.consume(ticket.id);
    return this.complete(ticket.userId, membership, appInterface, branch, client);
  }

  /** Creates the session with an explicit merchant (and POS branch) context. */
  async complete(
    userId: string,
    membership: MembershipAccess,
    appInterface: MerchantInterface,
    branch: BranchOption | null,
    client: ClientInfo,
    action = 'auth.login.succeeded',
  ): Promise<LoginOutcome> {
    if (membership.access.isOwner) {
      // Read inside the merchant context: RLS hides the merchant row otherwise.
      const [m] = await this.database.withMerchantTx(membership.merchantId, (tx) =>
        tx
          .select({ frozen: merchants.ownerFrozenAt })
          .from(merchants)
          .where(eq(merchants.id, membership.merchantId)),
      );
      if (m?.frozen)
        throw new AppError(
          403,
          'OWNER_FROZEN',
          'The owner account of this company is frozen by the platform.',
        );
    }
    const session = await this.database.withMerchantTx(membership.merchantId, async (tx) => {
      const created = await this.sessions.create(
        {
          realm: 'merchant',
          interface: appInterface,
          userId,
          merchantId: membership.merchantId,
          membershipId: membership.membershipId,
          branchId: appInterface === 'pos' ? (branch?.id ?? null) : null,
        },
        client,
        tx,
      );
      await tx
        .update(users)
        .set({ lastLoginAt: sql`now()` })
        .where(eq(users.id, userId));
      await this.audit.recordIn(tx, {
        merchantId: membership.merchantId,
        actorType: 'user',
        actorId: userId,
        action,
        targetType: 'session',
        targetId: created.id,
        ip: client.ip,
        details: { interface: appInterface, branchId: branch?.id ?? null },
      });
      return created;
    });
    return {
      result: {
        status: 'authenticated',
        interface: appInterface,
        redirectTo: INTERFACE_HOME[appInterface],
      },
      session: { interface: appInterface, token: session.token },
    };
  }

  private async notifyLocked(email: string, fullName: string, ip: string) {
    const minutes = this.limiter.windowMinutes(AUTH_LIMITS.loginFailuresPerEmail);
    await this.audit.record({
      merchantId: null,
      actorType: 'anonymous',
      action: 'auth.account_locked',
      ip,
      details: { email, minutes },
    });
    try {
      await this.mailer.send({
        to: email,
        ...renderEmail({
          title: { ar: 'قفل تسجيل الدخول مؤقتاً', en: 'Sign-in temporarily locked' },
          name: fullName,
          intro: {
            ar: `جرى إدخال كلمة مرور خاطئة عدة مرات لحسابك، فأُوقف تسجيل الدخول ${minutes} دقيقة.`,
            en: `Several wrong passwords were entered for your account, so sign-in is paused for ${minutes} minutes.`,
          },
          note: {
            ar: 'إن لم تكن أنت، غيّر كلمة المرور بعد انتهاء المهلة أو اطلب من مديرك فك القفل.',
            en: 'If this was not you, change your password once the pause ends or ask your manager to clear the lock.',
          },
        }),
      });
    } catch (error) {
      this.logger.error(`Lock-out e-mail failed: ${(error as Error).message}`);
    }
  }
}

function noAccessError(memberships: MembershipAccess[]): AppError {
  // Every company of this user is suspended or closed by the platform (BR-153).
  if (memberships.length > 0 && memberships.every((m) => !m.access.merchantActive))
    return new AppError(
      403,
      'MERCHANT_SUSPENDED',
      'This company account is suspended. Contact the platform support.',
    );
  const available = [...new Set(memberships.flatMap((m) => interfacesFor(m)))];
  if (available.length > 0) {
    return new AppError(
      403,
      'INTERFACE_NOT_PERMITTED',
      'Your account cannot use this application. Use the application you are authorized for.',
      undefined,
      { availableInterfaces: available },
    );
  }
  return new AppError(403, 'NO_MERCHANT_ACCESS', 'Your account is not active in any company.');
}
