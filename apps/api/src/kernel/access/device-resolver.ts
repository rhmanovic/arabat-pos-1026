import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { DatabaseService } from '../../database/database.service.js';
import { hashToken } from '../crypto/tokens.js';

/** A registered device (ADR-0112) authenticated by its bearer token. */
export type Device = {
  id: string;
  merchantId: string;
  branchId: string;
  registerId: string;
  revoked: boolean;
  /** `primary` devices also act as their branch's print agent (Plan A). */
  role: 'primary' | 'secondary';
};

/** Device tokens are 256-bit base64url strings (`generateToken`). */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Checks device tokens; a live device's last-seen time is stamped (`device_authenticate`). */
@Injectable()
export class DeviceResolver {
  constructor(private readonly database: DatabaseService) {}

  fromRequest(request: FastifyRequest): Promise<Device | null> {
    const header = request.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    return this.fromToken(match?.[1]);
  }

  async fromToken(token: unknown): Promise<Device | null> {
    if (typeof token !== 'string' || !TOKEN.test(token)) return null;
    const { rows } = await this.database.db.execute(
      sql`select id, merchant_id, branch_id, register_id, revoked, role from device_authenticate(${hashToken(token)})`,
    );
    const row = rows[0] as
      | {
          id: string;
          merchant_id: string;
          branch_id: string;
          register_id: string;
          revoked: boolean;
          role: 'primary' | 'secondary';
        }
      | undefined;
    return row
      ? {
          id: row.id,
          merchantId: row.merchant_id,
          branchId: row.branch_id,
          registerId: row.register_id,
          revoked: row.revoked,
          role: row.role,
        }
      : null;
  }
}
