import {
  DEVICE_ONLINE_SECONDS,
  type PosDevice,
  type RegisterDevice,
  type RegisterDeviceResult,
  type RegisteredDevice,
} from '@arabat/contracts';
import { can } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { Device } from '../../kernel/access/device-resolver.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { generateToken, hashToken } from '../../kernel/crypto/tokens.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { PasswordService } from '../auth/password.service.js';
import { AUTH_LIMITS, RateLimiterService } from '../auth/rate-limiter.service.js';
import { AccessRepository } from '../iam/access.repository.js';
import { users } from '../iam/iam.schema.js';
import { ensureRegisterAccount } from '../payments/cash-ledger.js';
import { registers } from '../registers/registers.schema.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';

const iso = (v: unknown) => (v ? new Date(v as string | Date).toISOString() : null);

/**
 * Local-first devices (ADR-0112): registration on the device by a manager (online), the
 * managers' device list and revocation. A device is a register of its own with a register code
 * that is never reused.
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly limiter: RateLimiterService,
    private readonly access: AccessRepository,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * E-mail and password of a person holding `registers.manage` at the branch, then the company
   * and branch. Rate-limited and audited like a sign-in; no session is created.
   */
  async register(input: RegisterDevice, ip: string): Promise<RegisterDeviceResult> {
    const failureKey = `device-register:fail:${input.email}`;
    await this.limiter.consume(`login:ip:${ip}`, AUTH_LIMITS.loginPerIp);
    await this.limiter.assertNotLimited(failureKey, AUTH_LIMITS.loginFailuresPerEmail);
    const [user] = await this.database.db.select().from(users).where(eq(users.email, input.email));
    const ok = await this.passwords.verify(user?.passwordHash ?? null, input.password);
    if (!user || !ok) {
      await this.limiter.hitAndCheck(failureKey, AUTH_LIMITS.loginFailuresPerEmail);
      await this.audit.record({
        merchantId: null,
        actorType: 'anonymous',
        action: 'device.register_failed',
        ip,
        details: { email: input.email },
      });
      throw AppError.invalidCredentials();
    }
    await this.limiter.reset(failureKey);
    if (user.status !== 'active')
      throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.');

    // Companies and branches where this person may set up a register.
    const memberships = await this.access.loadUserMemberships(user.id);
    const options = memberships
      .map((m) => ({
        m,
        branches: m.branches.filter((b) => can(m.access, 'registers.manage', b.id)),
      }))
      .filter((o) => o.branches.length > 0);
    if (options.length === 0)
      throw new AppError(403, 'FORBIDDEN', 'You are not allowed to register devices.');
    const chosen = input.merchantId
      ? options.find((o) => o.m.merchantId === input.merchantId)
      : options.length === 1
        ? options[0]
        : undefined;
    const branch = chosen
      ? input.branchId
        ? chosen.branches.find((b) => b.id === input.branchId)
        : chosen.branches.length === 1
          ? chosen.branches[0]
          : undefined
      : undefined;
    if ((input.merchantId && !chosen) || (input.branchId && chosen && !branch))
      throw new AppError(403, 'FORBIDDEN', 'You are not allowed to register devices there.');
    if (!chosen || !branch) {
      const codes = await this.branchCodes(
        options.map((o) => ({
          merchantId: o.m.merchantId,
          branchIds: o.branches.map((b) => b.id),
        })),
      );
      return {
        status: 'select_branch',
        merchants: options.map((o) => ({
          id: o.m.merchantId,
          nameEn: o.m.merchant.nameEn,
          nameAr: o.m.merchant.nameAr,
          branches: o.branches.map((b) => ({
            id: b.id,
            code: codes.get(b.id) ?? '',
            nameEn: b.nameEn,
            nameAr: b.nameAr,
          })),
        })),
      };
    }

    const merchantId = chosen.m.merchantId;
    const deviceId = newId();
    const registerId = newId();
    const token = generateToken();
    const device = await this.database.withMerchantTx(merchantId, async (tx) => {
      await this.subscriptions.assertCapacity(tx, merchantId, 'registers');
      const [b] = (
        await tx.execute(
          sql`select code from branches where id = ${branch.id} and status = 'active'`,
        )
      ).rows as { code: string }[];
      if (!b) throw AppError.notFound('Branch not found.');
      const registerCode = await this.nextRegisterCode(tx, merchantId, branch.id);
      const fields = {
        branchId: branch.id,
        code: registerCode,
        nameEn: input.deviceName,
        nameAr: input.deviceName,
      };
      await tx.insert(registers).values({ id: registerId, merchantId, ...fields });
      await ensureRegisterAccount(tx, merchantId, { id: registerId, ...fields });
      await tx.execute(sql`
        insert into pos_devices (id, merchant_id, branch_id, register_id, name, token_hash, registered_by_user_id)
        values (${deviceId}, ${merchantId}, ${branch.id}, ${registerId}, ${input.deviceName}, ${hashToken(token)}, ${user.id})`);
      await this.audit.recordIn(tx, {
        merchantId,
        actorType: 'user',
        actorId: user.id,
        action: 'device.registered',
        targetType: 'pos_device',
        targetId: deviceId,
        ip,
        details: { name: input.deviceName, branchId: branch.id, registerId, registerCode },
      });
      return {
        id: deviceId,
        name: input.deviceName,
        merchantId,
        branchId: branch.id,
        branchCode: b.code,
        registerId,
        registerCode,
      };
    });
    return { status: 'registered', device, token };
  }

  /** Branch codes, read in each company's own RLS context. */
  private async branchCodes(
    groups: { merchantId: string; branchIds: string[] }[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const g of groups)
      await this.database.withMerchantTx(g.merchantId, async (tx) => {
        const rows = (
          await tx.execute(
            sql`select id, code from branches where id in (${sql.join(
              g.branchIds.map((b) => sql`${b}`),
              sql`, `,
            )})`,
          )
        ).rows as { id: string; code: string }[];
        for (const r of rows) out.set(r.id, r.code);
      });
    return out;
  }

  /**
   * The next device register code of the branch: `R{n}` from a counter that only grows, skipping
   * codes a manual register already uses, so a code is never given twice (ADR-0112 gap C).
   */
  private async nextRegisterCode(tx: Transaction, merchantId: string, branchId: string) {
    const [seq] = (
      await tx.execute(sql`
        insert into register_code_sequences (merchant_id, branch_id, last_number)
        values (${merchantId}, ${branchId}, coalesce((
          select max((substring(code from '^[Rr]([0-9]{1,6})$'))::int) from registers
          where merchant_id = ${merchantId} and branch_id = ${branchId}), 0) + 1)
        on conflict (merchant_id, branch_id)
          do update set last_number = register_code_sequences.last_number + 1
        returning last_number`)
    ).rows as { last_number: number }[];
    let n = seq!.last_number;
    for (;;) {
      const { rows } = await tx.execute(
        sql`select 1 from registers where merchant_id = ${merchantId} and branch_id = ${branchId} and lower(code) = ${`r${n}`}`,
      );
      if (rows.length === 0) break;
      n += 1;
    }
    if (n !== seq!.last_number)
      await tx.execute(sql`
        update register_code_sequences set last_number = ${n}
        where merchant_id = ${merchantId} and branch_id = ${branchId}`);
    return `R${n}`;
  }

  async describe(device: Device): Promise<RegisteredDevice> {
    return this.database.withMerchantTx(device.merchantId, async (tx) => {
      const [row] = (
        await tx.execute(sql`
          select d.name, b.code as branch_code, r.code as register_code
          from pos_devices d join branches b on b.id = d.branch_id join registers r on r.id = d.register_id
          where d.id = ${device.id}`)
      ).rows as { name: string; branch_code: string; register_code: string }[];
      return {
        id: device.id,
        name: row!.name,
        merchantId: device.merchantId,
        branchId: device.branchId,
        branchCode: row!.branch_code,
        registerId: device.registerId,
        registerCode: row!.register_code,
      };
    });
  }

  async list(actor: MerchantActor): Promise<PosDevice[]> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
          select d.id, d.name, d.branch_id, d.register_id, r.code, d.created_at, d.last_seen_at,
                 d.last_sync_at, d.revoked_at,
                 (d.revoked_at is null and d.last_seen_at > now() - make_interval(secs => ${DEVICE_ONLINE_SECONDS})) as online
          from pos_devices d join registers r on r.id = d.register_id
          where d.merchant_id = ${actor.merchantId}
          order by d.revoked_at nulls first, d.created_at, d.id`)
      ).rows as Record<string, unknown>[];
      return rows
        .filter((r) => can(actor.access, 'registers.manage', r['branch_id'] as string))
        .map((r) => ({
          id: r['id'] as string,
          name: r['name'] as string,
          branchId: r['branch_id'] as string,
          registerId: r['register_id'] as string,
          registerCode: r['code'] as string,
          createdAt: iso(r['created_at'])!,
          lastSeenAt: iso(r['last_seen_at']),
          lastSyncAt: iso(r['last_sync_at']),
          revokedAt: iso(r['revoked_at']),
          online: Boolean(r['online']),
        }));
    });
  }

  /** Final: the token stops working at the device's next request (401 `DEVICE_REVOKED`). */
  async revoke(actor: MerchantActor, id: string, ip: string): Promise<void> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [device] = (
        await tx.execute(
          sql`select name, branch_id, revoked_at from pos_devices where id = ${id} for update`,
        )
      ).rows as { name: string; branch_id: string; revoked_at: string | null }[];
      if (!device) throw AppError.notFound();
      assertCan(actor, 'registers.manage', device.branch_id);
      if (device.revoked_at) return;
      await tx.execute(sql`
        update pos_devices set revoked_at = now(), revoked_by_user_id = ${actor.userId} where id = ${id}`);
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'device.revoked',
        targetType: 'pos_device',
        targetId: id,
        ip,
        details: { name: device.name, branchId: device.branch_id },
      });
    });
  }
}
