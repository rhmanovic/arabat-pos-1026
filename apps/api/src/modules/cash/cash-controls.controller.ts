import {
  type CashPayoutRequest,
  type CashVariance,
  VARIANCE_SOURCES,
  cashPayoutRequestQuerySchema,
  cashVarianceQuerySchema,
  createCashDisbursementSchema,
  decidePayoutRequestSchema,
  resolveVarianceSchema,
} from '@arabat/contracts';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { CashControlsService } from './cash-controls.service.js';

const uuid = new ParseUUIDPipe();

/** Manager: disbursement approvals and variance follow-up (ADR-0095, BR-166, BR-167). */
@Controller('manager/cash')
export class CashControlsController {
  constructor(private readonly controls: CashControlsService) {}

  @RequirePermission('manager', 'cash.custody')
  @Get('payout-requests')
  requests(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(cashPayoutRequestQuerySchema))
    query: z.output<typeof cashPayoutRequestQuerySchema>,
  ): Promise<{ requests: CashPayoutRequest[] }> {
    return this.controls.listRequests(actor, query);
  }

  @RequirePermission('manager', 'cash.custody')
  @Post('payout-requests')
  request(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(createCashDisbursementSchema))
    body: z.output<typeof createCashDisbursementSchema>,
    @Req() req: FastifyRequest,
  ): Promise<CashPayoutRequest> {
    return this.controls.createRequest(actor, body, req.ip);
  }

  @RequirePermission('manager', 'cash.custody')
  @Post('payout-requests/:id/decision')
  decide(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(decidePayoutRequestSchema)) body: z.output<typeof decidePayoutRequestSchema>,
    @Req() req: FastifyRequest,
  ): Promise<CashPayoutRequest> {
    return this.controls.decideRequest(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'cash.custody')
  @Post('payout-requests/:id/withdraw')
  withdraw(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<CashPayoutRequest> {
    return this.controls.withdrawRequest(actor, id, req.ip);
  }

  @RequirePermission('manager', 'shifts.view_all')
  @Get('variances')
  variances(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(cashVarianceQuerySchema)) query: z.output<typeof cashVarianceQuerySchema>,
  ): Promise<{ variances: CashVariance[]; openCount: number }> {
    return this.controls.listVariances(actor, query);
  }

  @RequirePermission('manager', 'shifts.view_all')
  @Post('variances/:sourceType/:sourceId/followup')
  followup(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('sourceType', new ZodPipe(z.enum(VARIANCE_SOURCES))) type: CashVariance['sourceType'],
    @Param('sourceId', uuid) sourceId: string,
    @Body(new ZodPipe(resolveVarianceSchema)) body: z.output<typeof resolveVarianceSchema>,
    @Req() req: FastifyRequest,
  ): Promise<CashVariance> {
    return this.controls.resolveVariance(actor, type, sourceId, body, req.ip);
  }
}
