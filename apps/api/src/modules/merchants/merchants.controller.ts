import {
  type ControlsChecklist,
  type MerchantProfile,
  acceptOwnershipTransferSchema,
  startOwnershipTransferSchema,
  updateMerchantProfileSchema,
} from '@arabat/contracts';
import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { Authenticated, RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { ControlsService } from './controls.service.js';
import { MerchantsService } from './merchants.service.js';
import { OwnershipService } from './ownership.service.js';

@Controller('manager/merchant')
export class MerchantsController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly controls: ControlsService,
    private readonly ownership: OwnershipService,
  ) {}

  /** The owner names the next owner with their password (BR-020); the service checks the owner. */
  @Authenticated('manager')
  @Post('ownership-transfers')
  @HttpCode(202)
  async startTransfer(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(startOwnershipTransferSchema))
    body: z.output<typeof startOwnershipTransferSchema>,
    @Req() request: FastifyRequest,
  ): Promise<MerchantProfile> {
    await this.ownership.start(actor, body, request.ip);
    return this.merchants.getProfile(actor);
  }

  @Authenticated('manager')
  @Delete('ownership-transfers')
  cancelTransfer(
    @CurrentMerchantActor() actor: MerchantActor,
    @Req() request: FastifyRequest,
  ): Promise<MerchantProfile> {
    return this.ownership.cancel(actor, request.ip).then(() => this.merchants.getProfile(actor));
  }

  /** The named member confirms with the e-mailed code. */
  @Authenticated('manager')
  @Post('ownership-transfers/accept')
  @HttpCode(200)
  async acceptTransfer(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(acceptOwnershipTransferSchema))
    body: z.output<typeof acceptOwnershipTransferSchema>,
    @Req() request: FastifyRequest,
  ): Promise<{ status: 'accepted' }> {
    await this.ownership.accept(actor, body.token, request.ip);
    return { status: 'accepted' };
  }

  /** Internal-control checklist for the dashboard (BR-165). */
  @RequirePermission('manager', 'merchant.settings.read')
  @Get('controls')
  checklist(@CurrentMerchantActor() actor: MerchantActor): Promise<ControlsChecklist> {
    return this.controls.checklist(actor);
  }

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
