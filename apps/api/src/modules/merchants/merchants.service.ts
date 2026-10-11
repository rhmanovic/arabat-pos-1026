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
import { AuditService } from '../audit/audit.service.js';
import { merchants } from './merchants.schema.js';

/** Company profile of the session's merchant. The merchant id always comes from the session. */
@Injectable()
export class MerchantsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  getProfile(actor: MerchantActor): Promise<MerchantProfile> {
    return this.database.withMerchantTx(actor.merchantId, (tx) => this.load(tx, actor.merchantId));
  }

  async updateProfile(
    actor: MerchantActor,
    input: z.output<typeof updateMerchantProfileSchema> & Pick<UpdateMerchantProfile, 'version'>,
    ip: string,
  ): Promise<MerchantProfile> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
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
      });
      return this.load(tx, actor.merchantId);
    });
  }

  private async load(tx: Transaction, merchantId: string): Promise<MerchantProfile> {
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
      status: row.status as MerchantProfile['status'],
      version: row.version,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
