import type {
  CreatedPinLink,
  PinLinkList,
  PinSignInBranch,
  PinSignInRequest,
} from '@arabat/contracts';
import { can } from '@arabat/permissions';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { generateToken, hashToken } from '../../kernel/crypto/tokens.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { AuditService } from '../audit/audit.service.js';
import { AccessRepository, eligibleBranches } from '../iam/access.repository.js';
import { type LoginOutcome, LoginService } from './login.service.js';
import { PasswordService } from './password.service.js';
import { RateLimiterService } from './rate-limiter.service.js';
import type { ClientInfo } from './session.service.js';

/** 3 wrong PINs lock that person for 5 minutes (Plan A, the same count as the tills). */
export const PIN_SIGN_IN_FAILURES = { limit: 3, windowSeconds: 300 } as const;
/** Reading a branch's staff list or trying PINs from one address. */
const PIN_SIGN_IN_PER_IP = { limit: 60, windowSeconds: 600 } as const;

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

const invalidLink = () =>
  new AppError(404, 'PIN_LINK_INVALID', 'This sign-in link is not valid any more.');

/**
 * Browser POS sign-in with name + PIN (Plan A). A manager makes a branch link; the page behind it
 * lists the branch's people with POS access, and each signs in with the PIN they chose for the
 * tills. Only the key's SHA-256 is stored; a new link replaces the old one.
 */
@Injectable()
export class PinSignInService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessRepository,
    private readonly passwords: PasswordService,
    private readonly limiter: RateLimiterService,
    private readonly logins: LoginService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ------------------------------------------------------------ manager
  async links(actor: MerchantActor): Promise<PinLinkList> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
          select id, pin_link_key_hash is not null as active from branches
          where merchant_id = ${actor.merchantId} order by is_main desc, code`)
      ).rows as Row[];
      return {
        branches: rows
          .filter((r) => can(actor.access, 'registers.manage', String(r['id'])))
          .map((r) => ({ branchId: String(r['id']), active: Boolean(r['active']) })),
      };
    });
  }

  async createLink(actor: MerchantActor, branchId: string, ip: string): Promise<CreatedPinLink> {
    assertCan(actor, 'registers.manage', branchId);
    const key = generateToken();
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const updated = (
        await tx.execute(sql`
          update branches set pin_link_key_hash = ${hashToken(key)}
          where id = ${branchId} and merchant_id = ${actor.merchantId} and status = 'active'
          returning id`)
      ).rows;
      if (updated.length === 0) throw AppError.notFound('Branch not found.');
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'branch.pin_link_created',
        targetType: 'branch',
        targetId: branchId,
        ip,
      });
    });
    return { branchId, key, url: `${this.env.PUBLIC_POS_URL}/pin-sign-in#${key}` };
  }

  async removeLink(actor: MerchantActor, branchId: string, ip: string): Promise<void> {
    assertCan(actor, 'registers.manage', branchId);
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      await tx.execute(sql`
        update branches set pin_link_key_hash = null
        where id = ${branchId} and merchant_id = ${actor.merchantId}`);
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'branch.pin_link_removed',
        targetType: 'branch',
        targetId: branchId,
        ip,
      });
    });
  }

  // ------------------------------------------------------------ public
  /** The branch behind a link and the people who may sign in there (POS access). */
  async branch(key: string, ip: string): Promise<PinSignInBranch> {
    await this.limiter.consume(`pin-sign-in:ip:${ip}`, PIN_SIGN_IN_PER_IP);
    const { merchantId, branchId } = await this.resolve(key);
    return this.database.withMerchantTx(merchantId, async (tx) => {
      const [m] = (
        await tx.execute(sql`
          select display_name_en, display_name_ar, owner_frozen_at, status from merchants
          where id = ${merchantId}`)
      ).rows as Row[];
      if (m?.['status'] !== 'active') throw invalidLink();
      const [b] = (
        await tx.execute(sql`select code, name_en, name_ar from branches where id = ${branchId}`)
      ).rows as Row[];
      return {
        merchant: { nameEn: str(m['display_name_en']), nameAr: str(m['display_name_ar']) },
        branch: {
          id: branchId,
          code: String(b!['code']),
          nameEn: str(b!['name_en']),
          nameAr: str(b!['name_ar']),
        },
        staff: (await this.staff(tx, merchantId, branchId, Boolean(m['owner_frozen_at']))).map(
          (s) => ({
            membershipId: s.membershipId,
            fullName: s.fullName,
            hasPin: s.pinHash !== null,
          }),
        ),
      };
    });
  }

  async signIn(input: PinSignInRequest, client: ClientInfo): Promise<LoginOutcome> {
    await this.limiter.consume(`pin-sign-in:ip:${client.ip}`, PIN_SIGN_IN_PER_IP);
    const failureKey = `pin-sign-in:fail:${input.membershipId}`;
    await this.limiter.assertNotLimited(failureKey, PIN_SIGN_IN_FAILURES);
    const { merchantId, branchId } = await this.resolve(input.key);
    const person = await this.database.withMerchantTx(merchantId, async (tx) => {
      const [m] = (
        await tx.execute(sql`select owner_frozen_at from merchants where id = ${merchantId}`)
      ).rows as Row[];
      const staff = await this.staff(tx, merchantId, branchId, Boolean(m?.['owner_frozen_at']));
      return staff.find((s) => s.membershipId === input.membershipId) ?? null;
    });
    if (!person) throw AppError.invalidCredentials();
    if (!person.pinHash)
      throw new AppError(409, 'PIN_NOT_SET', 'Set your PIN from the till app first.');
    if (!(await this.passwords.verify(person.pinHash, input.pin))) {
      await this.limiter.hitAndCheck(failureKey, PIN_SIGN_IN_FAILURES);
      await this.audit.record({
        merchantId,
        actorType: 'anonymous',
        action: 'auth.pin_login.failed',
        targetType: 'membership',
        targetId: person.membershipId,
        ip: client.ip,
        details: { branchId },
      });
      throw AppError.invalidCredentials();
    }
    await this.limiter.reset(failureKey);
    const memberships = await this.access.loadUserMemberships(person.userId);
    const membership = memberships.find((x) => x.membershipId === person.membershipId);
    const branch = membership
      ? eligibleBranches(membership, 'pos').find((x) => x.id === branchId)
      : undefined;
    if (!membership || !branch) throw AppError.forbidden('You do not have POS access here.');
    return this.logins.complete(
      person.userId,
      membership,
      'pos',
      branch,
      client,
      'auth.pin_login.succeeded',
    );
  }

  private async resolve(key: string): Promise<{ merchantId: string; branchId: string }> {
    const [row] = (
      await this.database.db.execute(
        sql`select merchant_id, branch_id from branch_by_pin_link(${hashToken(key)})`,
      )
    ).rows as Row[];
    if (!row) throw invalidLink();
    return { merchantId: String(row['merchant_id']), branchId: String(row['branch_id']) };
  }

  /** Active people with POS access at the branch, as the tills see them. */
  private async staff(tx: Transaction, merchantId: string, branchId: string, ownerFrozen: boolean) {
    const rows = (
      await tx.execute(sql`
        select m.id, m.user_id, m.is_owner, m.pin_hash, u.full_name
        from memberships m join users u on u.id = m.user_id
        where m.merchant_id = ${merchantId} and m.status = 'active' and u.status = 'active'
        order by u.full_name, m.id`)
    ).rows as Row[];
    const out: {
      membershipId: string;
      userId: string;
      fullName: string;
      pinHash: string | null;
    }[] = [];
    for (const r of rows) {
      if (r['is_owner'] && ownerFrozen) continue;
      const m = await this.access.loadMembershipAccess(tx, String(r['id']));
      if (!m || !can(m.access, 'pos.access', branchId)) continue;
      out.push({
        membershipId: m.membershipId,
        userId: m.userId,
        fullName: String(r['full_name']),
        pinHash: str(r['pin_hash']),
      });
    }
    return out;
  }
}
