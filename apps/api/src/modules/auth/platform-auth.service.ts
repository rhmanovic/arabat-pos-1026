import type { LoginResult } from '@arabat/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, lt, sql } from 'drizzle-orm';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DatabaseService } from '../../database/database.service.js';
import { SecretBox } from '../../kernel/crypto/secret-box.js';
import { verifyTotp } from '../../kernel/crypto/totp.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { platformOperators } from '../platform-admin/platform.schema.js';
import { PasswordService } from './password.service.js';
import { AUTH_LIMITS, RateLimiterService } from './rate-limiter.service.js';
import { INTERFACE_HOME } from './session-policy.js';
import { type ClientInfo, SessionService } from './session.service.js';
import { TicketService } from './ticket.service.js';

/** Platform operator sign-in: password, then a mandatory TOTP code (AUTH.md §8). */
@Injectable()
export class PlatformAuthService {
  private readonly secrets: SecretBox;

  constructor(
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly limiter: RateLimiterService,
    private readonly sessions: SessionService,
    private readonly tickets: TicketService,
    private readonly audit: AuditService,
    @Inject(ENV) env: Env,
  ) {
    this.secrets = new SecretBox(env.MFA_ENCRYPTION_KEY);
  }

  async login(email: string, password: string, client: ClientInfo): Promise<LoginResult> {
    const failureKey = `platform:fail:${email}`;
    await this.limiter.consume(`platform:ip:${client.ip}`, AUTH_LIMITS.platformLoginPerIp);
    await this.limiter.assertNotLimited(failureKey, AUTH_LIMITS.platformFailuresPerEmail);

    const [operator] = await this.database.db
      .select()
      .from(platformOperators)
      .where(eq(platformOperators.email, email));
    const ok = await this.passwords.verify(operator?.passwordHash ?? null, password);
    // A disabled operator gets the same answer as a wrong password at this step.
    if (!operator || !ok || operator.status !== 'active') {
      await this.limiter.hit(failureKey, AUTH_LIMITS.platformFailuresPerEmail);
      await this.audit.record({
        merchantId: null,
        actorType: 'anonymous',
        action: 'platform.login.failed',
        ip: client.ip,
        details: { email },
      });
      throw AppError.invalidCredentials();
    }
    const ticket = await this.tickets.issue('mfa', 'platform', { operatorId: operator.id });
    return { status: 'mfa_required', ticket };
  }

  async verifyMfa(
    ticketToken: string,
    code: string,
    client: ClientInfo,
  ): Promise<{ result: LoginResult; token: string }> {
    await this.limiter.consume(`mfa:ip:${client.ip}`, AUTH_LIMITS.mfaPerIp);
    const ticket = await this.tickets.open(ticketToken, 'mfa');
    if (!ticket.operatorId) throw new AppError(401, 'TICKET_INVALID', 'Invalid sign-in step.');

    const [operator] = await this.database.db
      .select()
      .from(platformOperators)
      .where(eq(platformOperators.id, ticket.operatorId));
    if (operator?.status !== 'active')
      throw new AppError(401, 'TICKET_INVALID', 'Invalid sign-in step.');

    const step = verifyTotp(
      this.secrets.decrypt(operator.mfaSecretEnc),
      code,
      operator.mfaLastStep,
    );
    // Claim the time step atomically so the same code cannot be used twice, even concurrently.
    const claimed =
      step === null
        ? []
        : await this.database.db
            .update(platformOperators)
            .set({ mfaLastStep: step, lastLoginAt: sql`now()` })
            .where(
              and(eq(platformOperators.id, operator.id), lt(platformOperators.mfaLastStep, step)),
            )
            .returning({ id: platformOperators.id });
    if (claimed.length === 0) {
      await this.audit.record({
        merchantId: null,
        actorType: 'operator',
        actorId: operator.id,
        action: 'platform.mfa.failed',
        ip: client.ip,
      });
      throw new AppError(401, 'MFA_INVALID', 'The verification code is incorrect.');
    }

    await this.tickets.consume(ticket.id);
    const session = await this.sessions.create(
      { realm: 'platform', interface: 'platform', operatorId: operator.id },
      client,
    );
    await this.audit.record({
      merchantId: null,
      actorType: 'operator',
      actorId: operator.id,
      action: 'platform.login.succeeded',
      targetType: 'session',
      targetId: session.id,
      ip: client.ip,
    });
    return {
      result: {
        status: 'authenticated',
        interface: 'platform',
        redirectTo: INTERFACE_HOME.platform,
      },
      token: session.token,
    };
  }
}
