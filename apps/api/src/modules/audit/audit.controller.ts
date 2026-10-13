import { type AuditList, auditListQuerySchema } from '@arabat/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import type { z } from 'zod';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { AuditService } from './audit.service.js';

/** Merchant audit trail (BR-163): the company reviews its own recorded events. */
@Controller('manager')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @RequirePermission('manager', 'audit.read')
  @Get('audit')
  list(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(auditListQuerySchema)) query: z.output<typeof auditListQuerySchema>,
  ): Promise<AuditList> {
    return this.audit.listForMerchant(actor, query);
  }
}
