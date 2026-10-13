import {
  type CashBranch,
  type CashOverview,
  type CashStatement,
  type CashTransfer,
  cashCountSchema,
  cashTransferQuerySchema,
  createCashTransferSchema,
  cashStatementQuerySchema,
} from '@arabat/contracts';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { CashService } from './cash.service.js';

const uuid = new ParseUUIDPipe();
const branchQuery = z.object({ branchId: z.uuid().optional() });

/** Manager: cash custody — balances, statements, transfers and counts (ADR-0090). */
@Controller('manager/cash')
export class CashController {
  constructor(private readonly cash: CashService) {}

  @RequirePermission('manager', 'cash.custody')
  @Get('overview')
  overview(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(branchQuery)) query: z.output<typeof branchQuery>,
  ): Promise<CashOverview> {
    return this.cash.overview(actor, query.branchId);
  }

  @RequirePermission('manager', 'cash.custody')
  @Get('accounts/:id/entries')
  statement(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Query(new ZodPipe(cashStatementQuerySchema)) query: z.output<typeof cashStatementQuerySchema>,
  ): Promise<CashStatement> {
    return this.cash.statement(actor, id, query);
  }

  @RequirePermission('manager', 'cash.custody')
  @Post('accounts/:id/counts')
  count(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(cashCountSchema)) body: z.output<typeof cashCountSchema>,
    @Req() req: FastifyRequest,
  ): Promise<CashBranch> {
    return this.cash.count(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'cash.custody')
  @Get('transfers')
  transfers(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(cashTransferQuerySchema)) query: z.output<typeof cashTransferQuerySchema>,
  ) {
    return this.cash.listTransfers(actor, query);
  }

  @RequirePermission('manager', 'cash.custody')
  @Post('transfers')
  transfer(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(createCashTransferSchema)) body: z.output<typeof createCashTransferSchema>,
    @Req() req: FastifyRequest,
  ): Promise<CashTransfer> {
    return this.cash.transfer(actor, body, req.ip);
  }
}
