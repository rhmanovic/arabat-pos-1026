import {
  type Transfer,
  createTransferSchema,
  transferActionSchema,
  transferListQuerySchema,
  transferQuantitiesSchema,
} from '@arabat/contracts';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { TransfersService } from './transfers.service.js';

const uuid = new ParseUUIDPipe();
type Action = z.output<typeof transferActionSchema>;
type Quantities = z.output<typeof transferQuantitiesSchema>;

/** Branch transfers; every step is checked at the branch it acts on (source or destination). */
@Controller('manager/transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @RequirePermission('manager', 'inventory.read')
  @Get()
  list(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(transferListQuerySchema)) query: z.output<typeof transferListQuerySchema>,
  ) {
    return this.transfers.list(actor, query);
  }

  @RequirePermission('manager', 'inventory.read')
  @Get(':id')
  get(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
  ): Promise<Transfer> {
    return this.transfers.get(actor, id);
  }

  @RequirePermission('manager', 'inventory.transfer')
  @Post()
  create(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(createTransferSchema)) body: z.output<typeof createTransferSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Transfer> {
    return this.transfers.create(actor, body, req.ip);
  }

  @RequirePermission('manager', 'inventory.transfer.approve')
  @Post(':id/approve')
  approve(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(transferActionSchema)) body: Action,
    @Req() req: FastifyRequest,
  ) {
    return this.transfers.approve(actor, id, body.version, req.ip);
  }

  /** Service checks: the requester, or `inventory.transfer.approve` at the source. */
  @RequirePermission('manager', 'inventory.transfer')
  @Post(':id/cancel')
  cancel(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(transferActionSchema)) body: Action,
    @Req() req: FastifyRequest,
  ) {
    return this.transfers.cancel(actor, id, body.version, req.ip);
  }

  @RequirePermission('manager', 'inventory.transfer')
  @Post(':id/dispatch')
  dispatch(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(transferQuantitiesSchema)) body: Quantities,
    @Req() req: FastifyRequest,
  ) {
    return this.transfers.dispatch(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'inventory.transfer')
  @Post(':id/receive')
  receive(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(transferQuantitiesSchema)) body: Quantities,
    @Req() req: FastifyRequest,
  ) {
    return this.transfers.receive(actor, id, body, req.ip);
  }
}
