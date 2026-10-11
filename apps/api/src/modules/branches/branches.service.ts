import type { BranchDetail, createBranchSchema, updateBranchSchema } from '@arabat/contracts';
import { accessibleBranches, permissionBranchScope } from '@arabat/permissions';
import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService, type Transaction } from '../../database/database.service.js';
import { assertCan } from '../../kernel/access/assert.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { newId } from '../../kernel/ids.js';
import { AuditService } from '../audit/audit.service.js';
import { isUniqueViolation } from '../auth/registration.service.js';
import { roleAssignments } from '../iam/iam.schema.js';
import { branches } from './branches.schema.js';

type CreateInput = z.output<typeof createBranchSchema>;
type UpdateInput = z.output<typeof updateBranchSchema>;

/** Branch administration (Prompt 5). Merchant id always comes from the session. */
@Injectable()
export class BranchesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Branches visible to the actor: all for merchant-wide access, else assigned branches. */
  async list(actor: MerchantActor): Promise<BranchDetail[]> {
    const scope = accessibleBranches(actor.access);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const rows = await tx
        .select()
        .from(branches)
        .where(
          scope.all
            ? undefined
            : inArray(branches.id, scope.branchIds.length ? [...scope.branchIds] : [newId()]),
        )
        .orderBy(desc(branches.isMain), asc(branches.code));
      const counts = await this.employeeCounts(tx);
      return rows.map((r) => toDetail(r, counts.get(r.id) ?? 0));
    });
  }

  async get(actor: MerchantActor, branchId: string): Promise<BranchDetail> {
    assertCan(actor, 'branches.read', branchId);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const row = await this.find(tx, branchId);
      return toDetail(row, (await this.employeeCounts(tx)).get(row.id) ?? 0);
    });
  }

  async create(actor: MerchantActor, input: CreateInput, ip: string): Promise<BranchDetail> {
    assertCan(actor, 'branches.manage', null);
    const id = newId();
    try {
      return await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        const [row] = await tx
          .insert(branches)
          .values({ id, merchantId: actor.merchantId, ...input, isMain: false })
          .returning();
        await this.record(tx, actor, 'branch.created', id, ip, { code: input.code });
        return toDetail(row!, 0);
      });
    } catch (error) {
      throw duplicateCode(error);
    }
  }

  async update(
    actor: MerchantActor,
    branchId: string,
    input: UpdateInput,
    ip: string,
  ): Promise<BranchDetail> {
    assertCan(actor, 'branches.update', branchId);
    const { version, ...fields } = input;
    try {
      return await this.database.withMerchantTx(actor.merchantId, async (tx) => {
        await this.find(tx, branchId);
        const [row] = await tx
          .update(branches)
          .set({ ...fields, version: sql`${branches.version} + 1`, updatedAt: sql`now()` })
          .where(and(eq(branches.id, branchId), eq(branches.version, version)))
          .returning();
        if (!row) throw versionConflict();
        await this.record(tx, actor, 'branch.updated', branchId, ip);
        return toDetail(row, (await this.employeeCounts(tx)).get(row.id) ?? 0);
      });
    } catch (error) {
      throw duplicateCode(error);
    }
  }

  /** Activation is merchant-level; the main branch cannot be deactivated. */
  async setStatus(
    actor: MerchantActor,
    branchId: string,
    status: 'active' | 'inactive',
    ip: string,
  ): Promise<BranchDetail> {
    assertCan(actor, 'branches.manage', null);
    return this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const branch = await this.find(tx, branchId);
      if (status === 'inactive' && branch.isMain) {
        throw AppError.conflict('The main branch cannot be deactivated.');
      }
      const [row] = await tx
        .update(branches)
        .set({ status, version: sql`${branches.version} + 1`, updatedAt: sql`now()` })
        .where(eq(branches.id, branchId))
        .returning();
      await this.record(
        tx,
        actor,
        status === 'active' ? 'branch.activated' : 'branch.deactivated',
        branchId,
        ip,
      );
      return toDetail(row!, (await this.employeeCounts(tx)).get(branchId) ?? 0);
    });
  }

  /** Branch ids where the actor holds a permission (for filtering other modules). */
  scopeFor = permissionBranchScope;

  private async find(tx: Transaction, branchId: string) {
    const [row] = await tx.select().from(branches).where(eq(branches.id, branchId));
    if (!row) throw AppError.notFound('Branch not found.');
    return row;
  }

  private async employeeCounts(tx: Transaction): Promise<Map<string, number>> {
    const rows = await tx
      .select({
        branchId: roleAssignments.branchId,
        n: count(sql`distinct ${roleAssignments.membershipId}`),
      })
      .from(roleAssignments)
      .groupBy(roleAssignments.branchId);
    return new Map(rows.filter((r) => r.branchId).map((r) => [r.branchId!, Number(r.n)]));
  }

  private record(
    tx: Transaction,
    actor: MerchantActor,
    action: string,
    branchId: string,
    ip: string,
    details = {},
  ) {
    return this.audit.recordIn(tx, {
      merchantId: actor.merchantId,
      actorType: 'user',
      actorId: actor.userId,
      action,
      targetType: 'branch',
      targetId: branchId,
      ip,
      details,
    });
  }
}

function toDetail(r: typeof branches.$inferSelect, employeeCount: number): BranchDetail {
  return {
    id: r.id,
    code: r.code,
    nameEn: r.nameEn,
    nameAr: r.nameAr,
    isMain: r.isMain,
    status: r.status as 'active' | 'inactive',
    phone: r.phone,
    address: r.address,
    receiptHeader: r.receiptHeader,
    receiptFooter: r.receiptFooter,
    timezone: r.timezone,
    version: r.version,
    employeeCount,
    createdAt: r.createdAt.toISOString(),
  };
}

export function versionConflict(): AppError {
  return new AppError(
    409,
    'VERSION_CONFLICT',
    'This record was changed by someone else. Reload and try again.',
  );
}

function duplicateCode(error: unknown): unknown {
  return isUniqueViolation(error, 'branches_merchant_code_key')
    ? new AppError(409, 'DUPLICATE_CODE', 'Another branch already uses this code.')
    : error;
}
