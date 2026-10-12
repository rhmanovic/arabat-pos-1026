import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { DatabaseService } from '../../database/database.service.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { users } from '../iam/iam.schema.js';
import { PasswordService } from './password.service.js';
import { AUTH_LIMITS, RateLimiterService } from './rate-limiter.service.js';
import { type ClientInfo, SessionService } from './session.service.js';

/**
 * POS screen lock (audit finding, Prompt 18; AUTH.md §2.1). The till locks itself after
 * inactivity or on request; the server then refuses the session until the same user enters
 * their password. Too many wrong passwords end the session (full sign-in required).
 */
@Injectable()
export class PosLockService {
  constructor(
    private readonly database: DatabaseService,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
    private readonly limiter: RateLimiterService,
    private readonly audit: AuditService,
  ) {}

  async lock(sessionId: string, merchantId: string, userId: string, client: ClientInfo) {
    await this.sessions.lock(sessionId);
    await this.audit.record({
      merchantId,
      actorType: 'user',
      actorId: userId,
      action: 'auth.pos.locked',
      targetType: 'session',
      targetId: sessionId,
      ip: client.ip,
    });
  }

  /** Unlocks the POS session of this browser (cookie) with its user's password. */
  async unlock(request: FastifyRequest, password: string, client: ClientInfo): Promise<void> {
    await this.limiter.consume(`unlock:ip:${client.ip}`, AUTH_LIMITS.loginPerIp);
    const session = await this.liveSession(request);
    const failures = `unlock:session:${session.id}`;
    const [user] = await this.database.db
      .select({ passwordHash: users.passwordHash, status: users.status })
      .from(users)
      .where(eq(users.id, session.userId!));
    const ok =
      user?.status === 'active' && (await this.passwords.verify(user.passwordHash, password));
    if (!ok) {
      await this.limiter.hit(failures, AUTH_LIMITS.unlockFailuresPerSession);
      try {
        await this.limiter.assertNotLimited(failures, AUTH_LIMITS.unlockFailuresPerSession);
      } catch {
        // Too many wrong passwords: the session ends; a full sign-in is needed.
        await this.sessions.revoke(session.id, 'unlock_failed');
        throw new AppError(401, 'UNAUTHENTICATED', 'Too many attempts. Sign in again.');
      }
      throw AppError.invalidCredentials();
    }
    await this.limiter.reset(failures);
    await this.sessions.unlock(session.id);
    await this.audit.record({
      merchantId: session.merchantId,
      actorType: 'user',
      actorId: session.userId,
      action: 'auth.pos.unlocked',
      targetType: 'session',
      targetId: session.id,
      ip: client.ip,
    });
  }

  /** "Sign in as someone else" from the lock screen: ends the locked session. */
  async end(request: FastifyRequest): Promise<void> {
    const token = this.sessions.readCookie(request, 'pos');
    const session = token ? await this.sessions.findLive(token, 'pos') : null;
    if (session) await this.sessions.revoke(session.id, 'logout');
  }

  private async liveSession(request: FastifyRequest) {
    const token = this.sessions.readCookie(request, 'pos');
    const session = token ? await this.sessions.findLive(token, 'pos') : null;
    if (!session || !session.userId) throw AppError.unauthenticated();
    return session;
  }
}
