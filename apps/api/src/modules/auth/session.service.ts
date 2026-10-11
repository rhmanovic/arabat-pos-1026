import type { AppInterface } from '@arabat/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ENV } from '../../config/config.module.js';
import { cookieSecure, type Env } from '../../config/env.js';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { generateToken, hashToken } from '../../kernel/crypto/tokens.js';
import { newId } from '../../kernel/ids.js';
import { sessions } from './auth.schema.js';
import { COOKIE_PATH, SESSION_POLICY, TOUCH_INTERVAL_SECONDS } from './session-policy.js';

export type NewSession =
  | {
      realm: 'merchant';
      interface: 'manager' | 'pos';
      userId: string;
      merchantId: string;
      membershipId: string;
      branchId: string | null;
    }
  | { realm: 'platform'; interface: 'platform'; operatorId: string };

export interface ClientInfo {
  ip: string;
  userAgent: string | null;
}

export function clientInfo(request: FastifyRequest): ClientInfo {
  const ua = request.headers['user-agent'];
  return { ip: request.ip, userAgent: typeof ua === 'string' ? ua.slice(0, 300) : null };
}

/** Server-side sessions: opaque random token in an HttpOnly cookie, hash in the database. */
@Injectable()
export class SessionService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async create(
    input: NewSession,
    client: ClientInfo,
    tx?: Transaction,
  ): Promise<{ token: string; id: string }> {
    const policy = SESSION_POLICY[input.interface];
    const token = generateToken();
    const id = newId();
    const values = {
      id,
      tokenHash: hashToken(token),
      realm: input.realm,
      interface: input.interface,
      userId: input.realm === 'merchant' ? input.userId : null,
      operatorId: input.realm === 'platform' ? input.operatorId : null,
      merchantId: input.realm === 'merchant' ? input.merchantId : null,
      membershipId: input.realm === 'merchant' ? input.membershipId : null,
      branchId: input.realm === 'merchant' ? input.branchId : null,
      idleExpiresAt: sql`now() + make_interval(secs => ${policy.idleSeconds})`,
      expiresAt: sql`now() + make_interval(secs => ${policy.absoluteSeconds})`,
      ip: client.ip,
      userAgent: client.userAgent,
    };
    await (tx ?? this.database.db).insert(sessions).values(values);
    return { token, id };
  }

  /** Finds a live (not revoked, not expired) session of the interface by its token. */
  async findLive(token: string, appInterface: AppInterface) {
    const [row] = await this.database.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, hashToken(token)),
          eq(sessions.interface, appInterface),
          isNull(sessions.revokedAt),
          sql`${sessions.expiresAt} > now()`,
          sql`${sessions.idleExpiresAt} > now()`,
        ),
      );
    return row ?? null;
  }

  /** Sliding idle expiry, capped by the absolute expiry. */
  async touch(session: { id: string; interface: string; lastSeenAt: Date }): Promise<void> {
    if (Date.now() - session.lastSeenAt.getTime() < TOUCH_INTERVAL_SECONDS * 1000) return;
    const policy = SESSION_POLICY[session.interface as AppInterface];
    await this.database.db
      .update(sessions)
      .set({
        lastSeenAt: sql`now()`,
        idleExpiresAt: sql`least(${sessions.expiresAt}, now() + make_interval(secs => ${policy.idleSeconds}))`,
      })
      .where(eq(sessions.id, session.id));
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.database.db
      .update(sessions)
      .set({ revokedAt: sql`now()`, revokeReason: reason })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  async revokeAllForUser(userId: string, reason: string, tx?: Transaction): Promise<void> {
    await (tx ?? this.database.db)
      .update(sessions)
      .set({ revokedAt: sql`now()`, revokeReason: reason })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  readCookie(request: FastifyRequest, appInterface: AppInterface): string | null {
    const value = request.cookies?.[SESSION_POLICY[appInterface].cookie];
    return value && value.length >= 20 && value.length <= 200 ? value : null;
  }

  setCookie(reply: FastifyReply, appInterface: AppInterface, token: string): void {
    const policy = SESSION_POLICY[appInterface];
    void reply.setCookie(policy.cookie, token, {
      path: COOKIE_PATH,
      httpOnly: true,
      secure: cookieSecure(this.env),
      sameSite: policy.sameSite,
      maxAge: policy.absoluteSeconds,
    });
  }

  clearCookie(reply: FastifyReply, appInterface: AppInterface): void {
    const policy = SESSION_POLICY[appInterface];
    void reply.clearCookie(policy.cookie, {
      path: COOKIE_PATH,
      httpOnly: true,
      secure: cookieSecure(this.env),
      sameSite: policy.sameSite,
    });
  }
}
