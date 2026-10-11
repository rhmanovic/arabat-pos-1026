import { type MerchantProfile, updateMerchantProfileSchema } from '@arabat/contracts';
import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { MerchantsService } from './merchants.service.js';

@Controller('manager/merchant')
export class MerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @RequirePermission('manager', 'merchant.settings.read')
  @Get()
  get(@CurrentMerchantActor() actor: MerchantActor): Promise<MerchantProfile> {
    return this.merchants.getProfile(actor);
  }

  @RequirePermission('manager', 'merchant.settings.update')
  @Patch()
  update(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(updateMerchantProfileSchema))
    body: z.output<typeof updateMerchantProfileSchema>,
    @Req() request: FastifyRequest,
  ): Promise<MerchantProfile> {
    return this.merchants.updateProfile(actor, body, request.ip);
  }
}
