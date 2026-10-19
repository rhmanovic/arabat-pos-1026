import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { DatabaseService } from '../../database/database.service.js';
import { hashToken } from '../crypto/tokens.js';
import { DeviceResolver } from './device-resolver.js';

/**
 * Who prints queued receipts (ADR-0111): a standalone print agent, or the branch's primary
 * device with its own device token (Plan A). `id` is the agent's or the device's id.
 */
export type PrintAgent = {
  kind: 'agent' | 'device';
  id: string;
  merchantId: string;
  branchId: string | null;
};

/** `not_primary`: a live device token that is not its branch's primary (403). */
export type PrintAgentCheck = PrintAgent | 'not_primary' | null;

/** Agent tokens are 256-bit base64url strings (`generateToken`). */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Checks print agent tokens for the agent API and the `/print-agent` socket namespace. Every
 * successful check stamps the agent's (or device's) last-seen time.
 */
@Injectable()
export class PrintAgentResolver {
  constructor(
    private readonly database: DatabaseService,
    private readonly devices: DeviceResolver,
  ) {}

  fromRequest(request: FastifyRequest): Promise<PrintAgentCheck> {
    const header = request.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    return this.fromToken(match?.[1]);
  }

  async fromToken(token: unknown): Promise<PrintAgentCheck> {
    if (typeof token !== 'string' || !TOKEN.test(token)) return null;
    const { rows } = await this.database.db.execute(
      sql`select id, merchant_id, branch_id from print_agent_authenticate(${hashToken(token)})`,
    );
    const row = rows[0] as
      { id: string; merchant_id: string; branch_id: string | null } | undefined;
    if (row)
      return { kind: 'agent', id: row.id, merchantId: row.merchant_id, branchId: row.branch_id };
    // The branch's primary device prints the browser queue without a separate agent token.
    const device = await this.devices.fromToken(token);
    if (!device || device.revoked) return null;
    if (device.role !== 'primary') return 'not_primary';
    return {
      kind: 'device',
      id: device.id,
      merchantId: device.merchantId,
      branchId: device.branchId,
    };
  }
}
