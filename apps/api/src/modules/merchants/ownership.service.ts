import type { MerchantProfile, startOwnershipTransferSchema } from '@arabat/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { generateToken, hashToken } from '../../kernel/crypto/tokens.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { Mailer } from '../../kernel/mail/mailer.js';
import { renderEmail } from '../../kernel/mail/template.js';
import { AuditService } from '../audit/audit.service.js';
import { sessions } from '../auth/auth.schema.js';
import { PasswordService } from '../auth/password.service.js';
import { memberships, users } from '../iam/iam.schema.js';
import { merchants, ownershipTransfers } from './merchants.schema.js';

type StartInput = z.output<typeof startOwnershipTransferSchema>;

const TRANSFER_TTL_HOURS = 72;
const INVALID = () =>
  new AppError(
    400,
    'TRANSFER_INVALID',
    'This ownership transfer is invalid, expired, cancelled or already completed.',
  );

interface MemberRow {
  membershipId: string;
  userId: string;
  fullName: string;
  email: string;
  status: string;
  isOwner: boolean;
}

/**
 * Ownership transfer (BR-020, R5.2). Owner-initiated: the owner names an active member and
 * re-enters their password; the member receives a token by e-mail and confirms while signed
 * in. Platform-initiated: `transfer()` is called directly by the platform service with a
 * recorded reason. Either way the swap is one audited transaction: the old owner stays a
 * member (with no implicit rights) and the new owner holds everything from the next request.
 */
@Injectable()
export class OwnershipService {
  private readonly logger = new Logger(OwnershipService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The pending transfer of the merchant for the profile (null when none). */
  async pending(
    tx: Transaction,
    merchantId: string,
    membershipId: string,
  ): Promise<MerchantProfile['pendingOwnershipTransfer']> {
    await this.expireStale(tx, merchantId);
    const [row] = await tx
      .select({
        id: ownershipTransfers.id,
        toMembershipId: ownershipTransfers.toMembershipId,
        expiresAt: ownershipTransfers.expiresAt,
        createdAt: ownershipTransfers.createdAt,
        toName: users.fullName,
        toEmail: users.email,
      })
      .from(ownershipTransfers)
      .innerJoin(memberships, eq(memberships.id, ownershipTransfers.toMembershipId))
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(ownershipTransfers.merchantId, merchantId),
          eq(ownershipTransfers.status, 'pending'),
        ),
      );
    if (!row) return null;
    return {
      id: row.id,
      toMembershipId: row.toMembershipId,
      toName: row.toName,
      toEmail: row.toEmail,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      forMe: row.toMembershipId === membershipId,
    };
  }

  async start(actor: MerchantActor, input: StartInput, ip: string): Promise<void> {
    if (!actor.access.isOwner) throw AppError.forbidden('Only the owner can transfer ownership.');
    const [user] = await this.database.db
      .select({ passwordHash: users.passwordHash, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, actor.userId));
    if (!user || !(await this.passwords.verify(user.passwordHash, input.password)))
      throw AppError.invalidCredentials();
    const token = generateToken();
    const target = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const target = await this.member(tx, input.toMembershipId);
      if (target.isOwner || target.status !== 'active')
        throw AppError.validation([
          { path: 'toMembershipId', code: 'invalid', message: 'Name an active, non-owner member.' },
        ]);
      await this.expireStale(tx, actor.merchantId);
      // One pending transfer at a time: a new one replaces the previous.
      await tx
        .update(ownershipTransfers)
        .set({ status: 'cancelled', cancelledAt: sql`now()` })
        .where(
          and(
            eq(ownershipTransfers.merchantId, actor.merchantId),
            eq(ownershipTransfers.status, 'pending'),
          ),
        );
      const id = newId();
      await tx.insert(ownershipTransfers).values({
        id,
        merchantId: actor.merchantId,
        fromMembershipId: actor.membershipId,
        toMembershipId: target.membershipId,
        initiatedBy: 'owner',
        tokenHash: hashToken(token).toString('hex'),
        expiresAt: sql`now() + make_interval(hours => ${TRANSFER_TTL_HOURS})`,
      });
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'merchant.ownership_transfer.started',
        targetType: 'ownership_transfer',
        targetId: id,
        ip,
        details: { toMembershipId: target.membershipId, toName: target.fullName },
      });
      return target;
    });
    await this.send(target.email, target.fullName, {
      ar: `عرض عليك ${user.fullName} ملكية الشركة. سجّل الدخول إلى لوحة الإدارة وافتح إعدادات الشركة ثم أدخل رمز التأكيد خلال ${TRANSFER_TTL_HOURS} ساعة:`,
      en: `${user.fullName} is handing the ownership of the company to you. Sign in to the management dashboard, open Company settings and enter this confirmation code within ${TRANSFER_TTL_HOURS} hours:`,
      token,
    });
  }

  async cancel(actor: MerchantActor, ip: string): Promise<void> {
    if (!actor.access.isOwner) throw AppError.forbidden('Only the owner can cancel a transfer.');
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const cancelled = await tx
        .update(ownershipTransfers)
        .set({ status: 'cancelled', cancelledAt: sql`now()` })
        .where(
          and(
            eq(ownershipTransfers.merchantId, actor.merchantId),
            eq(ownershipTransfers.status, 'pending'),
          ),
        )
        .returning({ id: ownershipTransfers.id });
      if (!cancelled.length) throw INVALID();
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'merchant.ownership_transfer.cancelled',
        targetType: 'ownership_transfer',
        targetId: cancelled[0]!.id,
        ip,
      });
    });
  }

  /** The named member, signed in, confirms with the e-mailed token. */
  async accept(actor: MerchantActor, token: string, ip: string): Promise<void> {
    const notify = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      await this.expireStale(tx, actor.merchantId);
      const [row] = await tx
        .select()
        .from(ownershipTransfers)
        .where(
          and(
            eq(ownershipTransfers.merchantId, actor.merchantId),
            eq(ownershipTransfers.status, 'pending'),
            eq(ownershipTransfers.toMembershipId, actor.membershipId),
            eq(ownershipTransfers.tokenHash, hashToken(token).toString('hex')),
          ),
        );
      if (!row) throw INVALID();
      await tx
        .update(ownershipTransfers)
        .set({ status: 'accepted', acceptedAt: sql`now()` })
        .where(eq(ownershipTransfers.id, row.id));
      return this.transfer(tx, {
        merchantId: actor.merchantId,
        fromMembershipId: row.fromMembershipId,
        toMembershipId: row.toMembershipId,
        actor: { type: 'user', id: actor.userId },
        initiatedBy: 'owner',
        reason: null,
        transferId: row.id,
        ip,
      });
    });
    await this.notifyBoth(notify);
  }

  /**
   * The swap itself, inside the caller's transaction: the old owner becomes a plain member,
   * the new owner takes the single owner slot, the old owner's sessions on this merchant end.
   */
  async transfer(
    tx: Transaction,
    input: {
      merchantId: string;
      fromMembershipId: string;
      toMembershipId: string;
      actor: { type: 'user' | 'operator'; id: string };
      initiatedBy: 'owner' | 'platform';
      reason: string | null;
      transferId: string | null;
      ip: string;
    },
  ): Promise<{ from: MemberRow; to: MemberRow; merchantName: string }> {
    const from = await this.member(tx, input.fromMembershipId);
    const to = await this.member(tx, input.toMembershipId);
    if (!from.isOwner)
      throw new AppError(409, 'INVALID_STATE', 'The transfer no longer starts from the owner.');
    if (to.isOwner || to.status !== 'active')
      throw new AppError(409, 'INVALID_STATE', 'The new owner must be an active member.');
    await tx
      .update(memberships)
      .set({ isOwner: false, updatedAt: sql`now()` })
      .where(eq(memberships.id, from.membershipId));
    await tx
      .update(memberships)
      .set({ isOwner: true, updatedAt: sql`now()` })
      .where(eq(memberships.id, to.membershipId));
    await tx
      .update(sessions)
      .set({ revokedAt: sql`now()`, revokeReason: 'ownership_transferred' })
      .where(and(eq(sessions.membershipId, from.membershipId), sql`${sessions.revokedAt} is null`));
    const [m] = await tx
      .select({ nameEn: merchants.displayNameEn, nameAr: merchants.displayNameAr })
      .from(merchants)
      .where(eq(merchants.id, input.merchantId));
    await this.audit.recordIn(tx, {
      merchantId: input.merchantId,
      actorType: input.actor.type,
      actorId: input.actor.id,
      action: 'merchant.ownership_transferred',
      targetType: 'merchant',
      targetId: input.merchantId,
      ip: input.ip,
      details: {
        initiatedBy: input.initiatedBy,
        fromMembershipId: from.membershipId,
        fromName: from.fullName,
        toMembershipId: to.membershipId,
        toName: to.fullName,
        reason: input.reason,
        transferId: input.transferId,
      },
    });
    return { from, to, merchantName: m?.nameAr ?? m?.nameEn ?? '' };
  }

  async notifyBoth(r: { from: MemberRow; to: MemberRow; merchantName: string }): Promise<void> {
    await this.send(r.to.email, r.to.fullName, {
      ar: `أصبحت الآن مالك شركة "${r.merchantName}".`,
      en: `You are now the owner of "${r.merchantName}".`,
      token: null,
    });
    await this.send(r.from.email, r.from.fullName, {
      ar: `انتقلت ملكية شركة "${r.merchantName}" إلى ${r.to.fullName}. ما زال حسابك عضواً في الشركة بلا صلاحيات ضمنية.`,
      en: `The ownership of "${r.merchantName}" passed to ${r.to.fullName}. Your account remains a member without implicit rights.`,
      token: null,
    });
  }

  private async member(tx: Transaction, membershipId: string): Promise<MemberRow> {
    const [row] = await tx
      .select({
        membershipId: memberships.id,
        userId: memberships.userId,
        fullName: users.fullName,
        email: users.email,
        status: memberships.status,
        isOwner: memberships.isOwner,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.id, membershipId));
    if (!row) throw AppError.notFound('Member not found.');
    return row;
  }

  private async expireStale(tx: Transaction, merchantId: string) {
    await tx
      .update(ownershipTransfers)
      .set({ status: 'expired' })
      .where(
        and(
          eq(ownershipTransfers.merchantId, merchantId),
          eq(ownershipTransfers.status, 'pending'),
          sql`${ownershipTransfers.expiresAt} < now()`,
        ),
      );
  }

  private async send(
    to: string,
    name: string,
    body: { ar: string; en: string; token: string | null },
  ) {
    const link = `${this.env.PUBLIC_MANAGER_URL.replace(/\/$/, '')}/settings`;
    try {
      await this.mailer.send({
        to,
        ...renderEmail({
          title: { ar: 'ملكية الشركة', en: 'Company ownership' },
          name,
          intro: body,
          ...(body.token
            ? {
                code: body.token,
                action: {
                  label: { ar: 'فتح إعدادات الشركة', en: 'Open company settings' },
                  url: link,
                },
              }
            : {}),
        }),
      });
    } catch (error) {
      this.logger.error(`Ownership e-mail failed: ${(error as Error).message}`);
    }
  }
}
