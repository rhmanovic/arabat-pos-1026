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
import { accountBalance, ensureRegisterAccount, registerAccount } from '../payments/cash-ledger.js';
import { PRINT_AGENTS_CHANNEL } from '../printing/print-jobs.service.js';
import { registers } from '../registers/registers.schema.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';

const iso = (v: unknown) => (v ? new Date(v as string | Date).toISOString() : null);
const primaryExists = () =>
  new AppError(409, 'PRIMARY_EXISTS', 'This branch already has a primary device.');
/** The unique index allows one live primary per branch; a race lands here. */
const isPrimaryViolation = (error: unknown) =>
  (error as { code?: string; constraint?: string } | null)?.code === '23505' &&
  /pos_devices_one_primary_per_branch/.test(
    String(
      (error as { constraint?: string; message?: string }).constraint ?? (error as Error).message,
    ),
  );

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
    if (!input.role) {
      const [taken] = await this.database.withMerchantTx(merchantId, async (tx) => {
        const codes = (
          await tx.execute(sql`
            select b.code, exists (select 1 from pos_devices d where d.branch_id = b.id
                     and d.role = 'primary' and d.revoked_at is null) as taken
            from branches b where b.id = ${branch.id}`)
        ).rows as { code: string; taken: boolean }[];
        return codes;
      });
      return {
        status: 'select_role',
        merchantId,
        branch: {
          id: branch.id,
          code: taken?.code ?? '',
          nameEn: branch.nameEn,
          nameAr: branch.nameAr,
        },
        primaryTaken: Boolean(taken?.taken),
      };
    }
    const role: DeviceRole = input.role;
    const deviceId = newId();
    const registerId = newId();
    const token = generateToken();
    const device = await this.database
      .withMerchantTx(merchantId, async (tx) => {
        if (role === 'primary') await this.assertNoPrimary(tx, branch.id, null);
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
        insert into pos_devices (id, merchant_id, branch_id, register_id, name, role, token_hash, registered_by_user_id)
        values (${deviceId}, ${merchantId}, ${branch.id}, ${registerId}, ${input.deviceName}, ${role}, ${hashToken(token)}, ${user.id})`);
        await this.audit.recordIn(tx, {
          merchantId,
          actorType: 'user',
          actorId: user.id,
          action: 'device.registered',
          targetType: 'pos_device',
          targetId: deviceId,
          ip,
          details: { name: input.deviceName, branchId: branch.id, registerId, registerCode, role },
        });
        return {
          id: deviceId,
          name: input.deviceName,
          merchantId,
          branchId: branch.id,
          branchCode: b.code,
          registerId,
          registerCode,
          role,
        };
      })
      .catch((error: unknown) => {
        throw isPrimaryViolation(error) ? primaryExists() : error;
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

  /** One live primary per branch (409 PRIMARY_EXISTS); `except` is the device being changed. */
  private async assertNoPrimary(tx: Transaction, branchId: string, except: string | null) {
    const { rows } = await tx.execute(sql`
      select 1 from pos_devices where branch_id = ${branchId} and role = 'primary'
        and revoked_at is null ${except ? sql`and id <> ${except}` : sql``}`);
    if (rows.length > 0) throw primaryExists();
  }

  async describe(device: Device): Promise<RegisteredDevice> {
    return this.database.withMerchantTx(device.merchantId, async (tx) => {
      const [row] = (
        await tx.execute(sql`
          select d.name, d.role, b.code as branch_code, r.code as register_code
          from pos_devices d join branches b on b.id = d.branch_id join registers r on r.id = d.register_id
          where d.id = ${device.id}`)
      ).rows as { name: string; role: DeviceRole; branch_code: string; register_code: string }[];
      return {
        id: device.id,
        name: row!.name,
        merchantId: device.merchantId,
        branchId: device.branchId,
        branchCode: row!.branch_code,
        registerId: device.registerId,
        registerCode: row!.register_code,
        role: row!.role,
      };
    });
  }

  async list(actor: MerchantActor): Promise<PosDevice[]> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
          select d.id, d.name, d.role, d.branch_id, d.register_id, r.code, d.created_at, d.last_seen_at,
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
          role: r['role'] as DeviceRole,
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
      // A primary connected as print agent is cut off at once.
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
   * The owner changes a device's role or branch (Plan A). Nothing is revoked: the next sync
   * carries the change. A move needs the old register settled (no open shift, no cash) like a
   * deactivation; the device gets a new register in the new branch (a new receipt series) and a
   * full snapshot at its next sync.
   */
  async update(
    actor: MerchantActor,
    id: string,
    input: UpdatePosDevice,
    ip: string,
  ): Promise<PosDevice> {
    if (!actor.access.isOwner)
      throw AppError.forbidden("Only the owner changes a device's role or branch.");
    await this.database
      .withMerchantTx(actor.merchantId, async (tx) => {
        const [d] = (
          await tx.execute(sql`
            select d.name, d.role, d.branch_id, d.register_id, d.revoked_at, r.code as register_code
            from pos_devices d join registers r on r.id = d.register_id
            where d.id = ${id} for update of d`)
        ).rows as {
          name: string;
          role: DeviceRole;
          branch_id: string;
          register_id: string;
          revoked_at: string | null;
          register_code: string;
        }[];
        if (!d) throw AppError.notFound();
        if (d.revoked_at)
          throw new AppError(409, 'DEVICE_REVOKED', 'This device was removed. Register it again.');
        const role = input.role ?? d.role;
        const branchId = input.branchId ?? d.branch_id;
        const moving = branchId !== d.branch_id;
        if (!moving && role === d.role) return;
        let registerId = d.register_id;
        let registerCode = d.register_code;
        if (moving) {
          const [target] = (
            await tx.execute(
              sql`select id from branches where id = ${branchId} and status = 'active'`,
            )
          ).rows as { id: string }[];
          if (!target) throw AppError.notFound('Branch not found.');
          const { rows: open } = await tx.execute(
            sql`select 1 from shifts where register_id = ${d.register_id} and status = 'open'`,
          );
          if (open.length > 0)
            throw new AppError(409, 'REGISTER_BUSY', "Close the device's shift before moving it.");
          const drawer = await registerAccount(tx, d.register_id);
          if ((await accountBalance(tx, drawer.id)) !== 0n)
            throw new AppError(
              409,
              'REGISTER_HAS_CASH',
              'Move the drawer cash to the treasury before moving the device.',
            );
          // The old register keeps its history and stops selling; the new one counts instead.
          await tx.execute(sql`
            update registers set status = 'inactive', version = version + 1, updated_at = now()
            where id = ${d.register_id}`);
          await this.subscriptions.assertCapacity(tx, actor.merchantId, 'registers');
          registerId = newId();
          registerCode = await this.nextRegisterCode(tx, actor.merchantId, branchId);
          const fields = { branchId, code: registerCode, nameEn: d.name, nameAr: d.name };
          await tx
            .insert(registers)
            .values({ id: registerId, merchantId: actor.merchantId, ...fields });
          await ensureRegisterAccount(tx, actor.merchantId, { id: registerId, ...fields });
        }
        if (role === 'primary') await this.assertNoPrimary(tx, branchId, id);
        await tx.execute(sql`
          update pos_devices set role = ${role}, branch_id = ${branchId}, register_id = ${registerId},
            branch_changed_at = ${moving ? sql`now()` : sql`branch_changed_at`}
          where id = ${id}`);
        // Its print-agent connection (if any) ends; it reconnects with the new role and branch.
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
              ...(role !== d.role ? { role: { from: d.role, to: role } } : {}),
              ...(moving
                ? {
                    branchId: { from: d.branch_id, to: branchId },
                    registerCode: { from: d.register_code, to: registerCode },
                  }
                : {}),
            },
          },
        });
      })
      .catch((error: unknown) => {
        throw isPrimaryViolation(error) ? primaryExists() : error;
      });
    const all = await this.list(actor);
    return all.find((x) => x.id === id)!;
  }
}
