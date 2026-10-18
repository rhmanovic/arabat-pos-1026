import type { registerRequestSchema } from '@arabat/contracts';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { users } from '../iam/iam.schema.js';
import { provisionMerchant } from '../merchants/provision.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import type { LoginOutcome } from './login.service.js';
import { PasswordService } from './password.service.js';
import { AUTH_LIMITS, RateLimiterService } from './rate-limiter.service.js';
import { INTERFACE_HOME } from './session-policy.js';
import { type ClientInfo, SessionService } from './session.service.js';

type RegisterInput = z.output<typeof registerRequestSchema>;

export const EMAIL_TAKEN = () =>
  new AppError(
    409,
    'EMAIL_ALREADY_REGISTERED',
    'This e-mail is already registered. Sign in or reset the password.',
  );

/**
 * Self-service registration of a merchant owner (owner decision in Prompt 4, resolves OQ-010).
 * One transaction creates: user, merchant, main branch, owner membership, role templates,
 * audit event and the owner's first manager session — all or nothing.
 */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly limiter: RateLimiterService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async register(
    input: RegisterInput,
    client: ClientInfo,
  ): Promise<LoginOutcome & { merchantId: string }> {
    await this.limiter.consume(`register:ip:${client.ip}`, AUTH_LIMITS.registerPerIp);

    // Registration necessarily tells whether an e-mail is free; it is rate limited per IP.
    // Sign-in and password recovery never reveal account existence (AUTH.md §2.2).
    const [existing] = await this.database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.owner.email));
    if (existing) throw EMAIL_TAKEN();

    const passwordHash = await this.passwords.hash(input.owner.password);
    return this.createAccount(
      {
        email: input.owner.email,
        fullName: input.owner.fullName,
        passwordHash,
        nameAr: input.company.nameAr ?? null,
        nameEn: input.company.nameEn ?? null,
        legalName: input.company.legalName ?? null,
        language: input.company.defaultLanguage,
        ...(input.company.timezone ? { timezone: input.company.timezone } : {}),
      },
      client,
      { reason: 'Self-service registration' },
    );
  }

  /**
   * The registration transaction itself, shared with the trial funnel (ADR-0115), which checks
   * the e-mail and hashes the password before the code is verified. `after` runs inside the
   * same transaction with the new merchant's ids.
   */
  async createAccount(
    account: {
      email: string;
      fullName: string;
      passwordHash: string;
      nameAr: string | null;
      nameEn: string | null;
      legalName: string | null;
      language: 'ar' | 'en';
      timezone?: string;
    },
    client: ClientInfo,
    options: {
      reason: string;
      trialDays?: number;
      after?: (tx: Transaction, ids: { merchantId: string; userId: string }) => Promise<void>;
    },
  ): Promise<LoginOutcome & { merchantId: string }> {
    const userId = newId();
    const merchantId = newId();
    const membershipId = newId();
    const language = account.language;

    try {
      const token = await this.database.withContext({ merchantId, userId }, async (tx) => {
        await tx.insert(users).values({
          id: userId,
          email: account.email,
          passwordHash: account.passwordHash,
          fullName: account.fullName,
          preferredLanguage: language,
        });
        const { branchId } = await provisionMerchant(tx, {
          merchantId,
          ownerUserId: userId,
          membershipId,
          nameEn: account.nameEn,
          nameAr: account.nameAr,
          legalName: account.legalName,
          contactEmail: account.email,
          defaultLanguage: language,
          ...(account.timezone ? { timezone: account.timezone } : {}),
        });
        await this.subscriptions.createInitial(
          tx,
          merchantId,
          null,
          options.reason,
          options.trialDays,
        );

        const session = await this.sessions.create(
          {
            realm: 'merchant',
            interface: 'manager',
            userId,
            merchantId,
            membershipId,
            branchId: null,
          },
          client,
          tx,
        );
        await this.audit.recordIn(tx, {
          merchantId,
          actorType: 'user',
          actorId: userId,
          action: 'merchant.registered',
          targetType: 'merchant',
          targetId: merchantId,
          ip: client.ip,
          details: { branchId, via: options.reason },
        });
        if (options.after) await options.after(tx, { merchantId, userId });
        return session.token;
      });

      return {
        merchantId,
        result: {
          status: 'authenticated',
          interface: 'manager',
          redirectTo: INTERFACE_HOME.manager,
        },
        session: { interface: 'manager', token },
      };
    } catch (error) {
      // Concurrent registration with the same e-mail: the unique index decides.
      if (isUniqueViolation(error, 'users_email_key')) throw EMAIL_TAKEN();
      throw error;
    }
  }
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause =
    (error as { cause?: { code?: string; constraint?: string } }).cause ??
    (error as { code?: string; constraint?: string });
  return cause?.code === '23505' && cause.constraint === constraint;
}
