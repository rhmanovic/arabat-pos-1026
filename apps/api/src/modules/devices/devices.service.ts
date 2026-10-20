import {
  DEVICE_ONLINE_SECONDS,
  type DeviceRole,
  type PosDevice,
  type RegisterDevice,
  type RegisterDeviceResult,
  type RegisteredDevice,
  type UpdatePosDevice,
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
import { PRINT_AGENTS_CHANNEL } from '../printing/print-jobs.service.js';

const iso = (v: unknown) => (v ? new Date(v as string | Date).toISOString() : null);
/**
 * Local-first devices (ADR-0112): registration on the device by a manager (online), the
 * managers' device list, binding to a register (amendment 4) and revocation. A device has a
 * permanent code in its branch that is never reused (its receipt series).
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly limiter: RateLimiterService,
    private readonly access: AccessRepository,
    private readonly audit: AuditService,
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
    const token = generateToken();
    const device = await this.database.withMerchantTx(merchantId, async (tx) => {
      const [b] = (
        await tx.execute(
          sql`select code from branches where id = ${branch.id} and status = 'active'`,
        )
      ).rows as { code: string }[];
      if (!b) throw AppError.notFound('Branch not found.');
      // A device is not a register (amendment 4): it gets a permanent code and sells into a
      // drawer only once a manager binds one to it.
      const code = await this.nextDeviceCode(tx, merchantId, branch.id);
      await tx.execute(sql`
        insert into pos_devices (id, merchant_id, branch_id, code, name, token_hash, registered_by_user_id)
        values (${deviceId}, ${merchantId}, ${branch.id}, ${code}, ${input.deviceName}, ${hashToken(token)}, ${user.id})`);
      await this.audit.recordIn(tx, {
        merchantId,
        actorType: 'user',
        actorId: user.id,
        action: 'device.registered',
        targetType: 'pos_device',
        targetId: deviceId,
        ip,
        details: { name: input.deviceName, branchId: branch.id, code },
      });
      return {
        id: deviceId,
        name: input.deviceName,
        merchantId,
        branchId: branch.id,
        branchCode: b.code,
        code,
        registerId: null,
        registerCode: null,
        registerName: null,
        role: 'secondary' as DeviceRole,
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
   * The next device code of the branch: `D{n}` from a counter that only grows, so a code (and
   * so a receipt series) is never given twice (ADR-0112 gap C, amendment 4).
   */
  private async nextDeviceCode(tx: Transaction, merchantId: string, branchId: string) {
    const [seq] = (
      await tx.execute(sql`
        insert into register_code_sequences (merchant_id, branch_id, last_number)
        values (${merchantId}, ${branchId}, coalesce((
          select max((substring(code from '^[Dd]([0-9]{1,6})$'))::int) from pos_devices
          where merchant_id = ${merchantId} and branch_id = ${branchId}), 0) + 1)
        on conflict (merchant_id, branch_id)
          do update set last_number = register_code_sequences.last_number + 1
        returning last_number`)
    ).rows as { last_number: number }[];
    let n = seq!.last_number;
    for (;;) {
      const { rows } = await tx.execute(
        sql`select 1 from pos_devices where merchant_id = ${merchantId} and branch_id = ${branchId} and lower(code) = ${`d${n}`}`,
      );
      if (rows.length === 0) break;
      n += 1;
    }
    if (n !== seq!.last_number)
      await tx.execute(sql`
        update register_code_sequences set last_number = ${n}
        where merchant_id = ${merchantId} and branch_id = ${branchId}`);
    return `D${n}`;
  }

  async describe(device: Device): Promise<RegisteredDevice> {
    return this.database.withMerchantTx(device.merchantId, async (tx) => {
      const [row] = (
        await tx.execute(sql`
          select d.name, d.code, d.register_id, b.code as branch_code, r.code as register_code,
                 r.name_en, r.name_ar
          from pos_devices d join branches b on b.id = d.branch_id
          left join registers r on r.id = d.register_id
          where d.id = ${device.id}`)
      ).rows as Record<string, string | null>[];
      return {
        id: device.id,
        name: row!['name']!,
        merchantId: device.merchantId,
        branchId: device.branchId,
        branchCode: row!['branch_code']!,
        code: row!['code']!,
        registerId: row!['register_id'] ?? null,
        registerCode: row!['register_code'] ?? null,
        registerName: row!['register_id']
          ? { nameEn: row!['name_en'] ?? null, nameAr: row!['name_ar'] ?? null }
          : null,
        role: row!['register_id'] ? 'primary' : 'secondary',
      };
    });
  }

  async list(actor: MerchantActor): Promise<PosDevice[]> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
          select d.id, d.name, d.code, d.branch_id, d.register_id, r.code as register_code, r.name_en, r.name_ar,
                 d.created_at, d.last_seen_at, d.last_sync_at, d.revoked_at,
                 (d.revoked_at is null and d.last_seen_at > now() - make_interval(secs => ${DEVICE_ONLINE_SECONDS})) as online
          from pos_devices d left join registers r on r.id = d.register_id
          where d.merchant_id = ${actor.merchantId}
          order by d.revoked_at nulls first, d.created_at, d.id`)
      ).rows as Record<string, unknown>[];
      return rows
        .filter((r) => can(actor.access, 'registers.manage', r['branch_id'] as string))
        .map((r) => ({
          id: r['id'] as string,
          name: r['name'] as string,
          branchId: r['branch_id'] as string,
          code: r['code'] as string,
          registerId: (r['register_id'] as string | null) ?? null,
          registerCode: (r['register_code'] as string | null) ?? null,
          registerName: r['register_id']
            ? {
                nameEn: (r['name_en'] as string | null) ?? null,
                nameAr: (r['name_ar'] as string | null) ?? null,
              }
            : null,
          role: (r['register_id'] ? 'primary' : 'secondary') as DeviceRole,
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
      // The register it was bound to is free again for another device.
      await tx.execute(sql`
        update pos_devices set revoked_at = now(), revoked_by_user_id = ${actor.userId}, register_id = null
        where id = ${id}`);
      // A bound device connected as print agent is cut off at once.
      await tx.execute(
        sql`select pg_notify(${PRINT_AGENTS_CHANNEL}, ${JSON.stringify({ revoked: id })})`,
      );
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

  /**
   * Binding (amendment 4, any manager with `registers.manage` at the branch): the device becomes
   * the register's primary (drawer, cash, shift, browser receipts). A register is bound to one
   * device; binding and unbinding need the registers' shifts closed. Moving a device to another
   * branch (owner only, Plan A) needs it unbound and gives it a new code (a new receipt series)
   * and a full snapshot at its next sync. Nothing is revoked: the next sync carries the change.
   */
  async update(
    actor: MerchantActor,
    id: string,
    input: UpdatePosDevice,
    ip: string,
  ): Promise<PosDevice> {
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const d = await this.lockDevice(tx, id);
      assertCan(actor, 'registers.manage', d.branch_id);
      const branchId = input.branchId ?? d.branch_id;
      const moving = branchId !== d.branch_id;
      if (moving) {
        if (!actor.access.isOwner)
          throw AppError.forbidden('Only the owner moves a device to another branch.');
        const [target] = (
          await tx.execute(
            sql`select id from branches where id = ${branchId} and status = 'active'`,
          )
        ).rows as { id: string }[];
        if (!target) throw AppError.notFound('Branch not found.');
        if (d.register_id && input.registerId !== null)
          throw new AppError(
            409,
            'REGISTER_BOUND',
            'Unbind the device from its register before moving it.',
          );
      }
      if (input.registerId !== undefined && input.registerId !== d.register_id) {
        if (d.register_id)
          await this.assertShiftClosed(
            tx,
            d.register_id,
            "Close the register's shift before unbinding.",
          );
        if (input.registerId) await this.assertBindable(tx, input.registerId, branchId, id);
      }
      let code = d.code;
      if (moving) {
        code = await this.nextDeviceCode(tx, actor.merchantId, branchId);
        await tx.execute(sql`
          update pos_devices set branch_id = ${branchId}, code = ${code}, register_id = null, branch_changed_at = now()
          where id = ${id}`);
      }
      if (input.registerId !== undefined)
        await tx.execute(
          sql`update pos_devices set register_id = ${input.registerId} where id = ${id}`,
        );
      // Its print-agent connection (if any) ends; a bound device reconnects.
      await tx.execute(
        sql`select pg_notify(${PRINT_AGENTS_CHANNEL}, ${JSON.stringify({ revoked: id })})`,
      );
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'device.updated',
        targetType: 'pos_device',
        targetId: id,
        ip,
        details: {
          name: d.name,
          changes: {
            ...(input.registerId !== undefined && input.registerId !== d.register_id
              ? { registerId: { from: d.register_id, to: input.registerId } }
              : {}),
            ...(moving
              ? { branchId: { from: d.branch_id, to: branchId }, code: { from: d.code, to: code } }
              : {}),
          },
        },
      });
    });
    const all = await this.list(actor);
    return all.find((x) => x.id === id)!;
  }

  /** `PUT /manager/registers/:id/device`: the same binding, started from the register. */
  async bindRegister(
    actor: MerchantActor,
    registerId: string,
    deviceId: string | null,
    ip: string,
  ): Promise<void> {
    const [register] = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
            select r.branch_id, (select d.id from pos_devices d where d.register_id = r.id and d.revoked_at is null) as device_id
            from registers r where r.id = ${registerId}`)
      ).rows as { branch_id: string; device_id: string | null }[];
      return rows;
    });
    if (!register) throw AppError.notFound('Register not found.');
    assertCan(actor, 'registers.manage', register.branch_id);
    if (deviceId === register.device_id) return;
    if (register.device_id) await this.update(actor, register.device_id, { registerId: null }, ip);
    if (deviceId) await this.update(actor, deviceId, { registerId }, ip);
  }

  private async lockDevice(tx: Transaction, id: string) {
    const [d] = (
      await tx.execute(sql`
        select name, code, branch_id, register_id, revoked_at from pos_devices where id = ${id} for update`)
    ).rows as {
      name: string;
      code: string;
      branch_id: string;
      register_id: string | null;
      revoked_at: string | null;
    }[];
    if (!d) throw AppError.notFound();
    if (d.revoked_at)
      throw new AppError(409, 'DEVICE_REVOKED', 'This device was removed. Register it again.');
    return d;
  }

  private async assertShiftClosed(tx: Transaction, registerId: string, message: string) {
    const { rows } = await tx.execute(
      sql`select 1 from shifts where register_id = ${registerId} and status = 'open'`,
    );
    if (rows.length > 0) throw new AppError(409, 'REGISTER_BUSY', message);
  }

  /** The register exists in the device's branch, is active, free of another device, and closed. */
  private async assertBindable(
    tx: Transaction,
    registerId: string,
    branchId: string,
    deviceId: string,
  ) {
    const [r] = (
      await tx.execute(sql`
        select r.branch_id, r.status,
               (select d.id from pos_devices d where d.register_id = r.id and d.revoked_at is null and d.id <> ${deviceId}) as other
        from registers r where r.id = ${registerId} for update`)
    ).rows as { branch_id: string; status: string; other: string | null }[];
    if (!r || r.branch_id !== branchId)
      throw AppError.notFound("Register not found in the device's branch.");
    if (r.status !== 'active')
      throw new AppError(409, 'REGISTER_INACTIVE', 'This register is inactive.');
    if (r.other)
      throw new AppError(
        409,
        'REGISTER_BOUND',
        'This register is already bound to another device.',
      );
    await this.assertShiftClosed(tx, registerId, "Close the register's shift before binding it.");
  }
}
