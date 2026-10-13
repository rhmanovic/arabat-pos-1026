import type { SessionInfo, changePasswordSchema } from '@arabat/contracts';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService } from '../../database/database.service.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { users } from '../iam/iam.schema.js';
import { merchants } from '../merchants/merchants.schema.js';
import { sessions } from './auth.schema.js';
import { PasswordService } from './password.service.js';
import { type ClientInfo, SessionService } from './session.service.js';

type ChangeInput = z.output<typeof changePasswordSchema>;

/**
 * Self-service account hygiene (BR-193, R5.4): a signed-in user changes their own password
 * (current password required; every other session ends) and sees and ends their sessions.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /** Returns the replacement session for the current interface (the old one is ended too). */
  async changePassword(
    actor: MerchantActor,
    input: ChangeInput,
    client: ClientInfo,
  ): Promise<{ token: string }> {
    const [user] = await this.database.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, actor.userId));
    if (!user || !(await this.passwords.verify(user.passwordHash, input.currentPassword)))
      throw AppError.invalidCredentials();
    if (await this.passwords.verify(user.passwordHash, input.newPassword))
      throw AppError.validation([
        { path: 'newPassword', code: 'same', message: 'Choose a different password.' },
      ]);
    const hash = await this.passwords.hash(input.newPassword);
    // `password_changed_at` ends every session created before it on its next request.
    await this.database.db
      .update(users)
      .set({ passwordHash: hash, passwordChangedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(users.id, actor.userId));
    await this.sessions.revokeAllForUser(actor.userId, 'password_changed');
    const [current] = await this.database.db
      .select({ branchId: sessions.branchId })
      .from(sessions)
      .where(eq(sessions.id, actor.sessionId));
    const issued = await this.sessions.create(
      {
        realm: 'merchant',
        interface: actor.interface,
        userId: actor.userId,
        merchantId: actor.merchantId,
        membershipId: actor.membershipId,
        branchId: current?.branchId ?? null,
      },
      client,
    );
    await this.audit.record({
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action: 'auth.password_changed',
      targetType: 'user',
      targetId: actor.userId,
      ip: client.ip,
      details: { interface: actor.interface },
    });
    return { token: issued.token };
  }

  /** Live sessions of the signed-in user across merchants and interfaces. */
  async list(actor: MerchantActor): Promise<SessionInfo[]> {
    const rows = await this.database.db
      .select({
        id: sessions.id,
        interface: sessions.interface,
        ip: sessions.ip,
        userAgent: sessions.userAgent,
        createdAt: sessions.createdAt,
        lastSeenAt: sessions.lastSeenAt,
        nameEn: merchants.displayNameEn,
        nameAr: merchants.displayNameAr,
      })
      .from(sessions)
      .leftJoin(merchants, eq(merchants.id, sessions.merchantId))
      .where(
        and(
          eq(sessions.userId, actor.userId),
          isNull(sessions.revokedAt),
          sql`${sessions.expiresAt} > now()`,
          sql`${sessions.idleExpiresAt} > now()`,
        ),
      )
      .orderBy(desc(sessions.lastSeenAt));
    return rows.map((r) => ({
      id: r.id,
      interface: r.interface as 'manager' | 'pos',
      merchantName: r.nameAr ?? r.nameEn ?? null,
      ip: r.ip,
      userAgent: r.userAgent,
      createdAt: r.createdAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
      current: r.id === actor.sessionId,
    }));
  }

  /** Ends one of the user's own sessions (never somebody else's). */
  async revoke(actor: MerchantActor, sessionId: string, ip: string): Promise<void> {
    const ended = await this.database.db
      .update(sessions)
      .set({ revokedAt: sql`now()`, revokeReason: 'user_revoked' })
      .where(
        and(
          eq(sessions.id, sessionId),
          eq(sessions.userId, actor.userId),
          isNull(sessions.revokedAt),
        ),
      )
      .returning({ id: sessions.id });
    if (!ended.length) throw AppError.notFound('Session not found.');
    await this.audit.record({
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action: 'auth.session_revoked',
      targetType: 'session',
      targetId: sessionId,
      ip,
    });
  }

  /** "Sign out everywhere else". */
  async revokeOthers(actor: MerchantActor, ip: string): Promise<number> {
    const ended = await this.database.db
      .update(sessions)
      .set({ revokedAt: sql`now()`, revokeReason: 'user_revoked_others' })
      .where(
        and(
          eq(sessions.userId, actor.userId),
          isNull(sessions.revokedAt),
          sql`${sessions.id} <> ${actor.sessionId}`,
        ),
      )
      .returning({ id: sessions.id });
    await this.audit.record({
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action: 'auth.sessions_revoked_others',
      targetType: 'user',
      targetId: actor.userId,
      ip,
      details: { ended: ended.length },
    });
    return ended.length;
  }
}
