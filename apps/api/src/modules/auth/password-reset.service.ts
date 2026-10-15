import type { MerchantInterface } from '@arabat/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { generateToken, hashToken } from '../../kernel/crypto/tokens.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { Mailer } from '../../kernel/mail/mailer.js';
import { renderEmail } from '../../kernel/mail/template.js';
import { AuditService } from '../audit/audit.service.js';
import { users } from '../iam/iam.schema.js';
import { passwordResetTokens } from './auth.schema.js';
import { PasswordService } from './password.service.js';
import { AUTH_LIMITS, RateLimiterService } from './rate-limiter.service.js';
import { RESET_TOKEN_TTL_SECONDS } from './session-policy.js';
import { type ClientInfo, SessionService } from './session.service.js';

const SETUP_TOKEN_TTL_HOURS = 72;

const INVALID_TOKEN = () =>
  new AppError(400, 'RESET_TOKEN_INVALID', 'This password reset link is invalid or has expired.');

/** Password recovery for merchant users (platform operators reset via the CLI). */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  /** Background work started by requestReset (awaited by tests and on shutdown). */
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly limiter: RateLimiterService,
    private readonly sessions: SessionService,
    private readonly mailer: Mailer,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Always answers the same way and in the same time: everything that depends on whether
   * the account exists (lookup, token, e-mail) runs in the background after the response.
   */
  async requestReset(
    email: string,
    appInterface: MerchantInterface,
    client: ClientInfo,
  ): Promise<void> {
    await this.limiter.consume(`forgot:ip:${client.ip}`, AUTH_LIMITS.forgotPerIp);
    await this.limiter.consume(`forgot:email:${email}`, AUTH_LIMITS.forgotPerEmail);
    const job = this.issueReset(email, appInterface, client)
      .catch((error: Error) => this.logger.error(`Password reset request failed: ${error.message}`))
      .finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  async drain(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  private async issueReset(
    email: string,
    appInterface: MerchantInterface,
    client: ClientInfo,
  ): Promise<void> {
    const [user] = await this.database.db
      .select({ id: users.id, status: users.status, fullName: users.fullName })
      .from(users)
      .where(eq(users.email, email));
    if (user?.status !== 'active') return;

    const token = generateToken();
    await this.database.withTransaction(async (tx) => {
      // Only the newest link works.
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: sql`now()` })
        .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));
      await tx.insert(passwordResetTokens).values({
        id: newId(),
        tokenHash: hashToken(token),
        userId: user.id,
        expiresAt: sql`now() + make_interval(secs => ${RESET_TOKEN_TTL_SECONDS})`,
        requestedIp: client.ip,
      });
      await this.audit.recordIn(tx, {
        merchantId: null,
        actorType: 'user',
        actorId: user.id,
        action: 'auth.password_reset.requested',
        ip: client.ip,
      });
    });

    const base = appInterface === 'pos' ? this.env.PUBLIC_POS_URL : this.env.PUBLIC_MANAGER_URL;
    const link = `${base.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
    const minutes = RESET_TOKEN_TTL_SECONDS / 60;
    await this.mailer.send({
      to: email,
      ...renderEmail({
        title: { ar: 'إعادة تعيين كلمة المرور', en: 'Reset your password' },
        name: user.fullName,
        intro: {
          ar: `وصلنا طلب لإعادة تعيين كلمة المرور لحسابك. اضغط الزر التالي خلال ${minutes} دقيقة لاختيار كلمة مرور جديدة:`,
          en: `We received a request to reset the password of your account. Use the button below within ${minutes} minutes to choose a new password:`,
        },
        action: { label: { ar: 'إعادة تعيين كلمة المرور', en: 'Reset password' }, url: link },
        note: {
          ar: 'إذا لم تطلب ذلك فتجاهل هذه الرسالة؛ كلمة المرور الحالية لن تتغير.',
          en: 'If you did not request this, ignore this e-mail; your current password stays unchanged.',
        },
      }),
    });
  }

  /**
   * Account set-up link for an owner created by the platform (Prompt 17): the same single-use
   * reset token, valid for 72 hours, sent as a welcome e-mail. Runs in the caller's
   * transaction; the e-mail is sent after it commits (`send`).
   */
  async issueAccountSetup(
    tx: Transaction,
    user: { id: string; email: string; fullName: string },
    companyName: string,
  ): Promise<{ send: () => Promise<void> }> {
    const token = generateToken();
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: sql`now()` })
      .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));
    await tx.insert(passwordResetTokens).values({
      id: newId(),
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt: sql`now() + make_interval(hours => ${SETUP_TOKEN_TTL_HOURS})`,
      requestedIp: null,
    });
    const link = `${this.env.PUBLIC_MANAGER_URL.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
    return {
      send: () =>
        this.mailer.send({
          to: user.email,
          ...renderEmail({
            title: { ar: `حساب ${companyName} جاهز`, en: `Your ${companyName} account is ready` },
            name: user.fullName,
            intro: {
              ar: `تم إنشاء حساب شركتك "${companyName}" على Arabat POS. اضغط الزر التالي خلال ${SETUP_TOKEN_TTL_HOURS} ساعة لتعيين كلمة المرور والدخول إلى لوحة الإدارة:`,
              en: `Your company account "${companyName}" has been created on Arabat POS. Use the button below within ${SETUP_TOKEN_TTL_HOURS} hours to set your password and open the management dashboard:`,
            },
            action: { label: { ar: 'تعيين كلمة المرور', en: 'Set my password' }, url: link },
            note: {
              ar: 'الرابط صالح لمرة واحدة. إن انتهت صلاحيته فاطلب إعادة تعيين كلمة المرور من صفحة الدخول.',
              en: 'The link works once. If it expires, request a password reset from the sign-in page.',
            },
          }),
        }),
    };
  }

  async resetPassword(token: string, newPassword: string, client: ClientInfo): Promise<void> {
    await this.limiter.consume(`reset:ip:${client.ip}`, AUTH_LIMITS.resetPerIp);
    const passwordHash = await this.passwords.hash(newPassword);

    await this.database.withTransaction(async (tx) => {
      // Single use: the row is claimed atomically.
      const [claimed] = await tx
        .update(passwordResetTokens)
        .set({ usedAt: sql`now()` })
        .where(
          and(
            eq(passwordResetTokens.tokenHash, hashToken(token)),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, sql`now()`),
          ),
        )
        .returning({ userId: passwordResetTokens.userId });
      if (!claimed) throw INVALID_TOKEN();

      const [user] = await tx
        .update(users)
        .set({ passwordHash, passwordChangedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(users.id, claimed.userId), eq(users.status, 'active')))
        .returning({ id: users.id, email: users.email });
      if (!user) throw INVALID_TOKEN();

      await this.sessions.revokeAllForUser(user.id, 'password_reset', tx);
      await this.audit.recordIn(tx, {
        merchantId: null,
        actorType: 'user',
        actorId: user.id,
        action: 'auth.password_reset.completed',
        ip: client.ip,
      });
      await this.limiter.reset(`login:fail:${user.email}`);
    });
  }
}
