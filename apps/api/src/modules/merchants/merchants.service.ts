import type {
  MerchantProfile,
  UpdateMerchantProfile,
  updateMerchantProfileSchema,
} from '@arabat/contracts';
import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { diffFields } from '../../kernel/audit-diff.js';
import { assertTimezone } from '../../kernel/time/period.js';
import { AuditService } from '../audit/audit.service.js';
import { merchants } from './merchants.schema.js';
import { OwnershipService } from './ownership.service.js';

/** Company profile of the session's merchant. The merchant id always comes from the session. */
@Injectable()
export class MerchantsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly ownership: OwnershipService,
  ) {}

  getProfile(actor: MerchantActor): Promise<MerchantProfile> {
    return this.database.withMerchantTx(actor.merchantId, (tx) => this.load(tx, actor));
  }

  async updateProfile(
    actor: MerchantActor,
    input: z.output<typeof updateMerchantProfileSchema> & Pick<UpdateMerchantProfile, 'version'>,
    ip: string,
  ): Promise<MerchantProfile> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [current] = await tx
        .select()
        .from(merchants)
        .where(eq(merchants.id, actor.merchantId))
        .for('update');
      if (!current) throw AppError.notFound();
      // Before / after values of what changed (BR-191, FND-105); contact data is company data.
      const next = {
        displayNameEn: input.nameEn,
        displayNameAr: input.nameAr,
        legalName: input.legalName,
        commercialRegistrationNo: input.commercialRegistrationNo,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        defaultLanguage: input.defaultLanguage,
      };
      const changes = diffFields(current, next, Object.keys(next) as (keyof typeof next)[]);
      // The time zone is the single cut-off rule (BR-184): a change re-cuts every past day,
      // so it is applied only when asked for, stamped and audited on its own.
      const timezone = input.timezone === undefined ? null : assertTimezone(input.timezone);
      const timezoneChanged = timezone !== null && timezone !== current.timezone;
      const updated = await tx
        .update(merchants)
        .set({
          displayNameEn: input.nameEn,
          displayNameAr: input.nameAr,
          legalName: input.legalName,
          commercialRegistrationNo: input.commercialRegistrationNo,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
          defaultLanguage: input.defaultLanguage,
          ...(timezoneChanged ? { timezone, timezoneChangedAt: sql`now()` } : {}),
          version: sql`${merchants.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(merchants.id, actor.merchantId), eq(merchants.version, input.version)))
        .returning({ id: merchants.id });
      if (updated.length === 0) {
        throw new AppError(
          409,
          'VERSION_CONFLICT',
          'The company profile was changed by someone else. Reload and try again.',
        );
      }
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: 'merchant.profile.updated',
        targetType: 'merchant',
        targetId: actor.merchantId,
        ip,
        details: { changes },
      });
      if (timezoneChanged)
        await this.audit.recordIn(tx, {
          merchantId: actor.merchantId,
          actorType: 'user',
          actorId: actor.userId,
          action: 'merchant.timezone_changed',
          targetType: 'merchant',
          targetId: actor.merchantId,
          ip,
          details: { from: current.timezone, to: timezone },
        });
      return this.load(tx, actor);
    });
  }

  private async load(tx: Transaction, actor: MerchantActor): Promise<MerchantProfile> {
    const merchantId = actor.merchantId;
    const [row] = await tx.select().from(merchants).where(eq(merchants.id, merchantId));
    if (!row) throw AppError.notFound();
    return {
      id: row.id,
      nameEn: row.displayNameEn,
      nameAr: row.displayNameAr,
      legalName: row.legalName,
      commercialRegistrationNo: row.commercialRegistrationNo,
      contactEmail: row.contactEmail,
      contactPhone: row.contactPhone,
      countryCode: row.countryCode,
      defaultCurrency: row.defaultCurrency,
      defaultLanguage: row.defaultLanguage as 'ar' | 'en',
      timezone: row.timezone,
      timezoneChangedAt: row.timezoneChangedAt?.toISOString() ?? null,
      status: row.status as MerchantProfile['status'],
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      pendingOwnershipTransfer: await this.ownership.pending(tx, merchantId, actor.membershipId),
    };
  }
}
