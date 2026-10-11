import type { Branch } from '@arabat/contracts';
import { accessibleBranches } from '@arabat/permissions';
import { Controller, Get } from '@nestjs/common';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { branches } from './branches.schema.js';

/** Branch list of the session's merchant, limited to the branches the user may access. */
@Controller('manager/branches')
export class BranchesController {
  constructor(private readonly database: DatabaseService) {}

  @RequirePermission('manager', 'branches.read')
  @Get()
  async list(@CurrentMerchantActor() actor: MerchantActor): Promise<{ branches: Branch[] }> {
    const scope = accessibleBranches(actor.access);
    const rows = await this.database.withMerchantTx(actor.merchantId, (tx) =>
      tx
        .select({
          id: branches.id,
          code: branches.code,
          nameEn: branches.nameEn,
          nameAr: branches.nameAr,
          isMain: branches.isMain,
          status: branches.status,
        })
        .from(branches)
        .where(
          scope.all
            ? eq(branches.merchantId, actor.merchantId)
            : inArray(branches.id, [...scope.branchIds]),
        )
        .orderBy(desc(branches.isMain), asc(branches.code)),
    );
    return { branches: rows };
  }
}
