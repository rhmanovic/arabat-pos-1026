import {
  type ProductDiscount,
  type ProductDiscountPreview,
  saveProductDiscountSchema,
} from '@arabat/contracts';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { DiscountsService } from './discounts.service.js';

const uuid = new ParseUUIDPipe();
type Save = z.output<typeof saveProductDiscountSchema>;
const statusSchema = z.object({ status: z.enum(['active', 'paused', 'archived']) });

/** Product discounts (ADR-0133), managed from the store console. */
@Controller('manager/discounts')
export class DiscountsController {
  constructor(private readonly discounts: DiscountsService) {}

  @RequirePermission('manager', 'online.manage')
  @Get()
  list(@CurrentMerchantActor() actor: MerchantActor): Promise<{ discounts: ProductDiscount[] }> {
    return this.discounts.list(actor);
  }

  @RequirePermission('manager', 'online.manage')
  @Post('preview')
  preview(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveProductDiscountSchema)) body: Save,
  ): Promise<ProductDiscountPreview> {
    return this.discounts.preview(actor, body);
  }

  @RequirePermission('manager', 'catalog.prices.manage')
  @Post()
  create(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveProductDiscountSchema)) body: Save,
    @Req() req: FastifyRequest,
  ): Promise<ProductDiscount> {
    return this.discounts.create(actor, body, req.ip);
  }

  @RequirePermission('manager', 'catalog.prices.manage')
  @Put(':id')
  update(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(saveProductDiscountSchema)) body: Save,
    @Req() req: FastifyRequest,
  ): Promise<ProductDiscount> {
    return this.discounts.update(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'catalog.prices.manage')
  @Post(':id/status')
  status(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(statusSchema)) body: z.output<typeof statusSchema>,
    @Req() req: FastifyRequest,
  ): Promise<ProductDiscount> {
    return this.discounts.setStatus(actor, id, body.status, req.ip);
  }
}
