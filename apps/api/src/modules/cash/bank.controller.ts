import {
  type BankReconciliation,
  type BankReconciliationState,
  type CashTransfer,
  type DepositInTransitList,
  createBankReconciliationSchema,
  depositInTransitQuerySchema,
  settleDepositSchema,
} from '@arabat/contracts';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { BankService } from './bank.service.js';

const uuid = new ParseUUIDPipe();

/**
 * Manager: deposits in transit and bank reconciliation (BR-168). Everything needs
 * `cash.deposit`; the branch of a deposit is checked in the service.
 */
@Controller('manager/cash')
export class BankController {
  constructor(private readonly bank: BankService) {}

  @RequirePermission('manager', 'cash.deposit')
  @Get('deposits/pending')
  pending(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(depositInTransitQuerySchema))
    query: z.output<typeof depositInTransitQuerySchema>,
  ): Promise<DepositInTransitList> {
    return this.bank.pendingDeposits(actor, query);
  }

  @RequirePermission('manager', 'cash.deposit')
  @Post('deposits/:id/settle')
  settle(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(settleDepositSchema)) body: z.output<typeof settleDepositSchema>,
    @Req() req: FastifyRequest,
  ): Promise<CashTransfer> {
    return this.bank.settleDeposit(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'cash.deposit')
  @Get('bank-accounts/:id/reconciliation')
  reconciliation(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
  ): Promise<BankReconciliationState> {
    return this.bank.reconciliationState(actor, id);
  }

  @RequirePermission('manager', 'cash.deposit')
  @Post('bank-accounts/:id/reconciliations')
  reconcile(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(createBankReconciliationSchema))
    body: z.output<typeof createBankReconciliationSchema>,
    @Req() req: FastifyRequest,
  ): Promise<BankReconciliation> {
    return this.bank.reconcile(actor, id, body, req.ip);
  }
}
