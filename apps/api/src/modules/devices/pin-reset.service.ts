import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DatabaseService } from '../../database/database.service.js';
import type { Device } from '../../kernel/access/device-resolver.js';
import { assertAcceptablePin, hashPin } from '../../kernel/crypto/pin.js';
import { generateToken, hashToken } from '../../kernel/crypto/tokens.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { Mailer } from '../../kernel/mail/mailer.js';
import { renderEmail } from '../../kernel/mail/template.js';
import { AuditService } from '../audit/audit.service.js';
import { AUTH_LIMITS, RateLimiterService } from '../auth/rate-limiter.service.js';

/** The link in the e-mail works once, within this long. */
export const PIN_RESET_TTL_MINUTES = 60;
/** One request per person per window, from any device. */
export const PIN_RESET_REQUEST_LIMIT = { limit: 1, windowSeconds: 300 } as const;

const INVALID_LINK = () =>
  new AppError(400, 'RESET_TOKEN_INVALID', 'This PIN link is invalid or has expired.');

type Row = Record<string, unknown>;

/**
 * Self-service device PINs (ADR-0112, owner decision 6, 2026-10-19): nobody but the cashier
 * knows their PIN. The cashier asks for a link from the till (the device token proves which
 * company), the link reaches their own e-mail, and the public page behind it sets the PIN. The
 * manager never sees or chooses it; the manager can only clear it.
 */
@Injectable()
export class PinResetService {
  private readonly logger = new Logger(PinResetService.name);
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly database: DatabaseService,
    private readonly limiter: RateLimiterService,
    private readonly mailer: Mailer,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Asked from a registered device for one of the company's members. Always answers 202; the
   * e-mail goes out after the response (the till never learns whether the address exists).
   * Throws 429 when the person asked less than 5 minutes ago.
   */
  async request(device: Device, membershipId: string, ip: string): Promise<void> {
    await this.limiter.consume(`pin-reset:member:${membershipId}`, PIN_RESET_REQUEST_LIMIT);
    await this.limiter.consume(`pin-reset:device:${device.id}`, AUTH_LIMITS.forgotPerEmail);
    const job = this.issue(device, membershipId, ip)
      .catch((error: Error) => this.logger.error(`PIN reset request failed: ${error.message}`))
      .finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  /** Waits for the e-mails started by `request` (tests, shutdown). */
  async drain(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  private async issue(device: Device, membershipId: string, ip: string): Promise<void> {
    const token = generateToken();
    const sent = await this.database.withMerchantTx(device.merchantId, async (tx) => {
      const [m] = (
        await tx.execute(sql`
          select m.id, m.user_id, u.email, u.full_name from memberships m join users u on u.id = m.user_id
          where m.id = ${membershipId} and m.merchant_id = ${device.merchantId}
            and m.status = 'active' and u.status = 'active'`)
      ).rows as Row[];
      if (!m) return null;
      // Only the newest link works.
      await tx.execute(
        sql`update pin_reset_tokens set used_at = now() where membership_id = ${membershipId} and used_at is null`,
      );
      await tx.execute(sql`
        insert into pin_reset_tokens (id, merchant_id, membership_id, device_id, token_hash, expires_at)
        values (${newId()}, ${device.merchantId}, ${membershipId}, ${device.id}, ${hashToken(token)},
                now() + make_interval(mins => ${PIN_RESET_TTL_MINUTES}))`);
      await this.audit.recordIn(tx, {
        merchantId: device.merchantId,
        actorType: 'user',
        actorId: String(m['user_id']),
        action: 'employee.pin_reset_requested',
        targetType: 'membership',
        targetId: membershipId,
        ip,
        details: { deviceId: device.id },
      });
      return { email: String(m['email']), fullName: String(m['full_name']) };
    });
    if (!sent) return;
    const base = this.env.PUBLIC_POS_URL.replace(/\/$/, '');
    const link = `${base}/pin?token=${encodeURIComponent(token)}`;
    await this.mailer.send({
      to: sent.email,
      ...renderEmail({
        title: { ar: 'تعيين الرقم السري للكاشير', en: 'Set your till PIN' },
        name: sent.fullName,
        intro: {
          ar: `طُلب من جهاز الكاشير تعيين رقم سري جديد لك. اضغط الزر التالي خلال ${PIN_RESET_TTL_MINUTES} دقيقة واختر رقمك السري (من 6 إلى 12 رقمًا). لا أحد غيرك يعرفه.`,
          en: `A till asked to set a new PIN for you. Use the button below within ${PIN_RESET_TTL_MINUTES} minutes and choose your PIN (6 to 12 digits). Nobody else knows it.`,
        },
        action: { label: { ar: 'اختيار الرقم السري', en: 'Choose my PIN' }, url: link },
        note: {
          ar: 'إذا لم تطلب ذلك فتجاهل هذه الرسالة؛ رقمك الحالي لن يتغير.',
          en: 'If you did not ask for this, ignore this e-mail; your current PIN stays unchanged.',
        },
      }),
    });
  }

  /** The public page behind the link: sets the PIN once, within the hour. */
  async complete(token: string, pin: string, ip: string): Promise<void> {
    await this.limiter.consume(`pin-reset:ip:${ip}`, AUTH_LIMITS.resetPerIp);
    assertAcceptablePin(pin);
    const pinHash = await hashPin(pin);
    // The token table is global (no merchant in the link); the membership row is then updated
    // in its company's own RLS context.
    const [claimed] = (
      await this.database.db.execute(sql`
        update pin_reset_tokens set used_at = now()
        where token_hash = ${hashToken(token)} and used_at is null and expires_at > now()
        returning merchant_id, membership_id`)
    ).rows as Row[];
    if (!claimed) throw INVALID_LINK();
    const merchantId = String(claimed['merchant_id']);
    const membershipId = String(claimed['membership_id']);
    await this.database.withMerchantTx(merchantId, async (tx) => {
      const [m] = (
        await tx.execute(sql`
          update memberships set pin_hash = ${pinHash}, pin_set_at = now(), updated_at = now()
          where id = ${membershipId} and status = 'active' returning user_id, pin_hash is not null as had`)
      ).rows as Row[];
      if (!m) throw INVALID_LINK();
      await this.audit.recordIn(tx, {
        merchantId,
        actorType: 'user',
        actorId: String(m['user_id']),
        action: 'employee.pin_set',
        targetType: 'membership',
        targetId: membershipId,
        ip,
        details: { self: true, via: 'email_link' },
      });
    });
  }
}
