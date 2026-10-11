import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { generateToken, hashToken } from '../../kernel/crypto/tokens.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { authTickets } from './auth.schema.js';
import { TICKET_MAX_ATTEMPTS, TICKET_TTL_SECONDS } from './session-policy.js';

type Purpose = 'merchant_selection' | 'mfa';
type Subject = { userId: string } | { operatorId: string };

/** Single-use, short-lived tickets for the second step of sign-in. */
@Injectable()
export class TicketService {
  constructor(private readonly database: DatabaseService) {}

  async issue(purpose: Purpose, appInterface: string, subject: Subject): Promise<string> {
    const token = generateToken();
    await this.database.db.insert(authTickets).values({
      id: newId(),
      tokenHash: hashToken(token),
      purpose,
      interface: appInterface,
      userId: 'userId' in subject ? subject.userId : null,
      operatorId: 'operatorId' in subject ? subject.operatorId : null,
      expiresAt: sql`now() + make_interval(secs => ${TICKET_TTL_SECONDS})`,
    });
    return token;
  }

  /** Returns the open ticket and counts the attempt; any problem → TICKET_INVALID. */
  async open(token: string, purpose: Purpose) {
    const [ticket] = await this.database.db
      .update(authTickets)
      .set({ attempts: sql`${authTickets.attempts} + 1` })
      .where(
        and(
          eq(authTickets.tokenHash, hashToken(token)),
          eq(authTickets.purpose, purpose),
          isNull(authTickets.consumedAt),
          gt(authTickets.expiresAt, sql`now()`),
          lt(authTickets.attempts, TICKET_MAX_ATTEMPTS),
        ),
      )
      .returning();
    if (!ticket)
      throw new AppError(
        401,
        'TICKET_INVALID',
        'This sign-in step has expired. Please sign in again.',
      );
    return ticket;
  }

  /** Atomically marks the ticket used; fails if another request consumed it first. */
  async consume(ticketId: string): Promise<void> {
    const consumed = await this.database.db
      .update(authTickets)
      .set({ consumedAt: sql`now()` })
      .where(and(eq(authTickets.id, ticketId), isNull(authTickets.consumedAt)))
      .returning({ id: authTickets.id });
    if (consumed.length === 0)
      throw new AppError(401, 'TICKET_INVALID', 'This sign-in step was already used.');
  }
}
