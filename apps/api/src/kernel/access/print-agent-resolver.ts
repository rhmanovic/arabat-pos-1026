import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { DatabaseService } from '../../database/database.service.js';
import { hashToken } from '../crypto/tokens.js';

/** A print agent authenticated by its bearer token (ADR-0111). */
export type PrintAgent = { id: string; merchantId: string; branchId: string | null };

/** Agent tokens are 256-bit base64url strings (`generateToken`). */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Checks print agent tokens for the agent API and the `/print-agent` socket namespace. Every
 * successful check stamps the agent's last-seen time (`print_agent_authenticate`).
 */
@Injectable()
export class PrintAgentResolver {
  constructor(private readonly database: DatabaseService) {}

  fromRequest(request: FastifyRequest): Promise<PrintAgent | null> {
    const header = request.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    return this.fromToken(match?.[1]);
  }

  async fromToken(token: unknown): Promise<PrintAgent | null> {
    if (typeof token !== 'string' || !TOKEN.test(token)) return null;
    const { rows } = await this.database.db.execute(
      sql`select id, merchant_id, branch_id from print_agent_authenticate(${hashToken(token)})`,
    );
    const row = rows[0] as
      { id: string; merchant_id: string; branch_id: string | null } | undefined;
    return row ? { id: row.id, merchantId: row.merchant_id, branchId: row.branch_id } : null;
  }
}
