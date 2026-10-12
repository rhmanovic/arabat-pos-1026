import type {
  FinancialAccount,
  PaymentMethod,
  saveFinancialAccountSchema,
  savePaymentMethodSchema,
} from '@arabat/contracts';
import { Money, MoneyError } from '@arabat/money';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { versionConflict } from '../branches/branches.service.js';
import { financialAccounts, paymentMethods } from './payments.schema.js';

type SaveMethod = z.output<typeof savePaymentMethodSchema>;
type SaveAccount = z.output<typeof saveFinancialAccountSchema>;
type MethodRow = typeof paymentMethods.$inferSelect;

const CURRENCY = 'KWD' as const;
const money = (minor: bigint) => Money.ofMinor(minor, CURRENCY).toJSON();

export function parseAmount(value: string, path: string): bigint {
  try {
    return Money.parse(value, CURRENCY).minor;
  } catch (error) {
    if (error instanceof MoneyError)
      throw new AppError(400, 'INVALID_PRICE', 'Invalid amount.', [
        { path, code: 'invalid', message: 'Use up to 3 decimal places.' },
      ]);
    throw error;
  }
}

/** "2.500" → "2.5" (exact string formatting, no float). */
function trimPercent(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

export function toPaymentMethod(r: MethodRow): PaymentMethod {
  return {
    id: r.id,
    kind: r.kind as PaymentMethod['kind'],
    nameEn: r.nameEn,
    nameAr: r.nameAr,
    status: r.status as PaymentMethod['status'],
    availableInPos: r.availableInPos,
    availableOnline: r.availableOnline,
    feeType: r.feeType as PaymentMethod['feeType'],
    feeFixed: money(r.feeFixedMinor),
    feePercent: trimPercent(r.feePercent),
    financialAccountId: r.financialAccountId,
    gatewayProvider: r.gatewayProvider as PaymentMethod['gatewayProvider'],
    gatewayLive: false,
    sortOrder: r.sortOrder,
    version: r.version,
  };
}

/**
 * Payment configuration per merchant (Prompt 9): methods with fees, optional linked
 * internal balances and a placeholder for future gateways (never live here).
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ methods
  async listMethods(actor: MerchantActor): Promise<PaymentMethod[]> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = await tx
        .select()
        .from(paymentMethods)
        .orderBy(asc(paymentMethods.sortOrder), asc(paymentMethods.createdAt));
      return rows.map(toPaymentMethod);
    });
  }

  /** Active methods offered at the POS (no fee or account details for cashiers). */
  async posMethods(actor: MerchantActor) {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = await tx
        .select()
        .from(paymentMethods)
        .where(and(eq(paymentMethods.status, 'active'), eq(paymentMethods.availableInPos, true)))
        .orderBy(asc(paymentMethods.sortOrder), asc(paymentMethods.createdAt));
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind as PaymentMethod['kind'],
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        sortOrder: r.sortOrder,
      }));
    });
  }

  async saveMethod(
    actor: MerchantActor,
    id: string | null,
    input: SaveMethod,
    ip: string,
  ): Promise<PaymentMethod> {
    assertCan(actor, 'payments.settings', null);
    const feeFixedMinor = parseAmount(input.feeFixed, 'feeFixed');
    const fields = {
      kind: input.kind,
      nameEn: input.nameEn,
      nameAr: input.nameAr,
      status: input.status,
      availableInPos: input.availableInPos,
      availableOnline: input.availableOnline,
      feeType: input.feeType,
      // Fee parts that the type does not use are stored as zero (no hidden fees).
      feeFixedMinor:
        input.feeType === 'fixed' || input.feeType === 'fixed_plus_percentage' ? feeFixedMinor : 0n,
      feePercent:
        input.feeType === 'percentage' || input.feeType === 'fixed_plus_percentage'
          ? input.feePercent
          : '0',
      financialAccountId: input.financialAccountId,
      gatewayProvider: input.gatewayProvider,
      sortOrder: input.sortOrder,
    };
    const methodId = id ?? newId();
    try {
      return await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        if (input.financialAccountId) await this.findAccount(tx, input.financialAccountId);
        let before: MethodRow | undefined;
        if (id) {
          if (!input.version)
            throw AppError.validation([
              { path: 'version', code: 'required', message: 'version is required' },
            ]);
          [before] = await tx.select().from(paymentMethods).where(eq(paymentMethods.id, id));
          if (!before) throw AppError.notFound();
          if (before.kind === 'cash' && input.kind !== 'cash')
            throw AppError.conflict('The cash method cannot change its type.');
          const [row] = await tx
            .update(paymentMethods)
            .set({ ...fields, version: sql`${paymentMethods.version} + 1`, updatedAt: sql`now()` })
            .where(and(eq(paymentMethods.id, id), eq(paymentMethods.version, input.version)))
            .returning();
          if (!row) throw versionConflict();
        } else {
          await tx
            .insert(paymentMethods)
            .values({ id: methodId, merchantId: actor.merchantId, ...fields });
        }
        const [row] = await tx.select().from(paymentMethods).where(eq(paymentMethods.id, methodId));
        await this.audit.recordIn(tx, {
          merchantId: actor.merchantId,
          actorType: 'user',
          actorId: actor.userId,
          action: id ? 'payment_method.updated' : 'payment_method.created',
          targetType: 'payment_method',
          targetId: methodId,
          ip,
          details: {
            kind: row!.kind,
            status: row!.status,
            fee: {
              from: before
                ? {
                    type: before.feeType,
                    fixed: before.feeFixedMinor.toString(),
                    percent: before.feePercent,
                  }
                : null,
              to: {
                type: row!.feeType,
                fixed: row!.feeFixedMinor.toString(),
                percent: row!.feePercent,
              },
            },
          },
        });
        return toPaymentMethod(row!);
      });
    } catch (error) {
      const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
      if (cause?.code === '23505' && cause.constraint === 'payment_methods_one_cash')
        throw AppError.conflict('There is already a cash payment method.');
      throw error;
    }
  }

  // ------------------------------------------------------------ financial accounts
  async listAccounts(actor: MerchantActor): Promise<FinancialAccount[]> {
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = (
        await tx.execute(sql`
          select a.*, coalesce((select sum(e.amount_minor) from financial_account_entries e
                                where e.account_id = a.id), 0)::text as balance
          from financial_accounts a
          order by a.created_at`)
      ).rows as Record<string, unknown>[];
      return rows.map((r) => ({
        id: r['id'] as string,
        nameEn: (r['name_en'] as string | null) ?? null,
        nameAr: (r['name_ar'] as string | null) ?? null,
        kind: r['kind'] as FinancialAccount['kind'],
        currency: r['currency'] as string,
        status: r['status'] as FinancialAccount['status'],
        balance: money(BigInt(r['balance'] as string)),
        version: r['version'] as number,
      }));
    });
  }

  async saveAccount(
    actor: MerchantActor,
    id: string | null,
    input: SaveAccount,
    ip: string,
  ): Promise<FinancialAccount> {
    assertCan(actor, 'payments.settings', null);
    const accountId = id ?? newId();
    await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const fields = {
        nameEn: input.nameEn,
        nameAr: input.nameAr,
        kind: input.kind,
        status: input.status,
      };
      if (id) {
        if (!input.version)
          throw AppError.validation([
            { path: 'version', code: 'required', message: 'version is required' },
          ]);
        await this.findAccount(tx, id);
        const [row] = await tx
          .update(financialAccounts)
          .set({ ...fields, version: sql`${financialAccounts.version} + 1`, updatedAt: sql`now()` })
          .where(and(eq(financialAccounts.id, id), eq(financialAccounts.version, input.version)))
          .returning({ id: financialAccounts.id });
        if (!row) throw versionConflict();
      } else {
        await tx
          .insert(financialAccounts)
          .values({ id: accountId, merchantId: actor.merchantId, ...fields });
      }
      await this.audit.recordIn(tx, {
        merchantId: actor.merchantId,
        actorType: 'user',
        actorId: actor.userId,
        action: id ? 'financial_account.updated' : 'financial_account.created',
        targetType: 'financial_account',
        targetId: accountId,
        ip,
      });
    });
    const all = await this.listAccounts(actor);
    return all.find((a) => a.id === accountId)!;
  }

  private async findAccount(tx: Transaction, id: string) {
    const [row] = await tx.select().from(financialAccounts).where(eq(financialAccounts.id, id));
    if (!row) throw AppError.notFound('Financial account not found.');
    return row;
  }
}
