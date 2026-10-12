import type { registerRequestSchema } from '@arabat/contracts';
import { ROLE_TEMPLATES } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService } from '../../database/database.service.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { branches } from '../branches/branches.schema.js';
import { memberships, rolePermissions, roles, users } from '../iam/iam.schema.js';
import {
  ensureDefaultPaymentMethods,
  ensureDefaultRegister,
} from '../payments/merchant-defaults.js';
import { merchants } from '../merchants/merchants.schema.js';
import type { LoginOutcome } from './login.service.js';
import { PasswordService } from './password.service.js';
import { AUTH_LIMITS, RateLimiterService } from './rate-limiter.service.js';
import { INTERFACE_HOME } from './session-policy.js';
import { type ClientInfo, SessionService } from './session.service.js';

type RegisterInput = z.output<typeof registerRequestSchema>;

const EMAIL_TAKEN = () =>
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
    const userId = newId();
    const merchantId = newId();
    const membershipId = newId();
    const language = input.company.defaultLanguage;

    try {
      const token = await this.database.withContext({ merchantId, userId }, async (tx) => {
        await tx.insert(users).values({
          id: userId,
          email: input.owner.email,
          passwordHash,
          fullName: input.owner.fullName,
          preferredLanguage: language,
        });
        await tx.insert(merchants).values({
          id: merchantId,
          displayNameAr: input.company.nameAr ?? null,
          displayNameEn: input.company.nameEn ?? null,
          legalName: input.company.legalName ?? null,
          contactEmail: input.owner.email,
          defaultLanguage: language,
        });
        const branchId = newId();
        await tx.insert(branches).values({
          id: branchId,
          merchantId,
          code: 'MAIN',
          nameAr: 'الفرع الرئيسي',
          nameEn: 'Main branch',
          isMain: true,
        });
        await tx
          .insert(memberships)
          .values({ id: membershipId, merchantId, userId, isOwner: true, status: 'active' });
        await ensureDefaultPaymentMethods(tx, merchantId);
        await ensureDefaultRegister(tx, merchantId, branchId);

        for (const [templateKey, template] of Object.entries(ROLE_TEMPLATES)) {
          const roleId = newId();
          await tx.insert(roles).values({
            id: roleId,
            merchantId,
            templateKey,
            nameEn: template.nameEn,
            nameAr: template.nameAr,
          });
          await tx
            .insert(rolePermissions)
            .values(
              template.permissions.map((permissionKey) => ({ merchantId, roleId, permissionKey })),
            );
        }

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
          details: { branchId },
        });
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
