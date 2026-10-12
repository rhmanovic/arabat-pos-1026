import {
  type Refund,
  type RefundActivity,
  type RefundPreview,
  type RefundReceipt,
  type RefundableSale,
  createRefundSchema,
  exchangeSchema,
  refundActivityQuerySchema,
  refundDecisionSchema,
  refundListQuerySchema,
  refundPreviewRequestSchema,
  voidSaleSchema,
} from '@arabat/contracts';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { RefundsService } from './refunds.service.js';

const uuid = new ParseUUIDPipe();
const lookupQuery = z.object({ receipt: z.string().trim().min(1).max(40) });

/** POS returns at the session's branch. */
@Controller('pos')
export class PosRefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @RequirePermission('pos', 'refunds.create')
  @Get('refunds/lookup')
  lookup(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(lookupQuery)) query: z.output<typeof lookupQuery>,
  ): Promise<RefundableSale> {
    return this.refunds.lookup(actor, query.receipt);
  }

  @RequirePermission('pos', 'refunds.create')
  @Post('refunds/preview')
  preview(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(refundPreviewRequestSchema))
    body: z.output<typeof refundPreviewRequestSchema>,
  ): Promise<RefundPreview> {
    return this.refunds.preview(actor, body);
  }

  @RequirePermission('pos', 'refunds.create')
  @Post('refunds')
  create(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(createRefundSchema)) body: z.output<typeof createRefundSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Refund> {
    return this.refunds.create(actor, body, req.ip);
  }

  @RequirePermission('pos', 'refunds.create')
  @Post('exchanges')
  exchange(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(exchangeSchema)) body: z.output<typeof exchangeSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.refunds.exchange(actor, body, req.ip);
  }

  @RequirePermission('pos', 'sales.void')
  @Post('sales/:id/void')
  voidSale(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(voidSaleSchema)) body: z.output<typeof voidSaleSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Refund> {
    return this.refunds.voidSale(actor, id, body, req.ip);
  }

  @RequirePermission('pos', 'refunds.create')
  @Get('refunds/:id/receipt')
  receipt(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
  ): Promise<RefundReceipt> {
    return this.refunds.receipt(actor, id);
  }

  /** Supervisor approval at the till. */
  @RequirePermission('pos', 'refunds.approve')
  @Post('refunds/:id/approve')
  approve(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(refundDecisionSchema)) body: z.output<typeof refundDecisionSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Refund> {
    return this.refunds.approve(actor, id, body.note, req.ip);
  }

  @RequirePermission('pos', 'refunds.create')
  @Post('refunds/:id/cancel')
  cancel(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<Refund> {
    return this.refunds.cancel(actor, id, req.ip);
  }
}

/** Manager review: history, approvals and unusual activity. */
@Controller('manager/refunds')
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @RequirePermission('manager', 'sales.read')
  @Get()
  list(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(refundListQuerySchema)) query: z.output<typeof refundListQuerySchema>,
  ) {
    return this.refunds.list(actor, query);
  }

  @RequirePermission('manager', 'sales.read')
  @Get('activity')
  activity(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(refundActivityQuerySchema))
    query: z.output<typeof refundActivityQuerySchema>,
  ): Promise<RefundActivity> {
    return this.refunds.activity(actor, query);
  }

  @RequirePermission('manager', 'sales.read')
  @Get(':id')
  get(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
  ): Promise<Refund> {
    return this.refunds.get(actor, id, 'manager');
  }

  @RequirePermission('manager', 'refunds.approve')
  @Post(':id/approve')
  approve(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(refundDecisionSchema)) body: z.output<typeof refundDecisionSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Refund> {
    return this.refunds.approve(actor, id, body.note, req.ip);
  }

  @RequirePermission('manager', 'refunds.approve')
  @Post(':id/reject')
  reject(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(refundDecisionSchema)) body: z.output<typeof refundDecisionSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Refund> {
    return this.refunds.reject(actor, id, body.note, req.ip);
  }
}
