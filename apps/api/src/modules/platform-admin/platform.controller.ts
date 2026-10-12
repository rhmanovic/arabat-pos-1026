import {
  type Plan,
  type PlanCheck,
  type PlatformMerchantDetail,
  type PlatformOverview,
  type SubscriptionView,
  changeSubscriptionSchema,
  createMerchantSchema,
  merchantStatusChangeSchema,
  platformAuditQuerySchema,
  platformMerchantQuerySchema,
  savePlanSchema,
} from '@arabat/contracts';
import type { PlatformRole } from '@arabat/permissions';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { RequirePlatformRole } from '../../kernel/access/access.decorators.js';
import { CurrentPlatformActor } from '../../kernel/access/current-actor.js';
import type { PlatformActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { PlatformService } from './platform.service.js';

const uuid = new ParseUUIDPipe();
type O<T extends z.ZodType> = z.output<T>;

/** Who may do what in the platform console (AUTH.md §8). */
const ANY: PlatformRole[] = ['platform.super_admin', 'platform.support', 'platform.billing'];
const SUPPORT: PlatformRole[] = ['platform.super_admin', 'platform.support'];
const BILLING: PlatformRole[] = ['platform.super_admin', 'platform.billing'];

@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @RequirePlatformRole(...ANY)
  @Get('overview')
  overview(): Promise<PlatformOverview> {
    return this.platform.overview();
  }

  @RequirePlatformRole(...ANY)
  @Get('merchants')
  merchants(
    @Query(new ZodPipe(platformMerchantQuerySchema)) q: O<typeof platformMerchantQuerySchema>,
  ) {
    return this.platform.merchants(q);
  }

  @RequirePlatformRole(...SUPPORT)
  @Post('merchants')
  createMerchant(
    @CurrentPlatformActor() actor: PlatformActor,
    @Body(new ZodPipe(createMerchantSchema)) body: O<typeof createMerchantSchema>,
    @Req() req: FastifyRequest,
  ): Promise<PlatformMerchantDetail> {
    return this.platform.createMerchant(actor, body, req.ip);
  }

  @RequirePlatformRole(...ANY)
  @Get('merchants/:id')
  merchant(
    @CurrentPlatformActor() actor: PlatformActor,
    @Param('id', uuid) id: string,
  ): Promise<PlatformMerchantDetail> {
    return this.platform.merchant(actor, id);
  }

  /** Suspend / reactivate (support, super admin); close (super admin, checked in the service). */
  @RequirePlatformRole(...SUPPORT)
  @Post('merchants/:id/status')
  @HttpCode(200)
  setStatus(
    @CurrentPlatformActor() actor: PlatformActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(merchantStatusChangeSchema)) body: O<typeof merchantStatusChangeSchema>,
    @Req() req: FastifyRequest,
  ): Promise<PlatformMerchantDetail> {
    return this.platform.setStatus(actor, id, body, req.ip);
  }

  @RequirePlatformRole(...ANY)
  @Get('merchants/:id/plan-check')
  planCheck(
    @CurrentPlatformActor() actor: PlatformActor,
    @Param('id', uuid) id: string,
    @Query('planId', uuid) planId: string,
  ): Promise<PlanCheck> {
    return this.platform.planCheck(actor, id, planId);
  }

  @RequirePlatformRole(...BILLING)
  @Put('merchants/:id/subscription')
  changeSubscription(
    @CurrentPlatformActor() actor: PlatformActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(changeSubscriptionSchema)) body: O<typeof changeSubscriptionSchema>,
    @Req() req: FastifyRequest,
  ): Promise<SubscriptionView> {
    return this.platform.changeSubscription(actor, id, body, req.ip);
  }

  @RequirePlatformRole(...ANY)
  @Get('plans')
  async plans(): Promise<{ plans: Plan[] }> {
    return { plans: await this.platform.plans() };
  }

  @RequirePlatformRole(...BILLING)
  @Post('plans')
  createPlan(
    @CurrentPlatformActor() actor: PlatformActor,
    @Body(new ZodPipe(savePlanSchema)) body: O<typeof savePlanSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Plan> {
    return this.platform.savePlan(actor, null, body, req.ip);
  }

  @RequirePlatformRole(...BILLING)
  @Put('plans/:id')
  updatePlan(
    @CurrentPlatformActor() actor: PlatformActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(savePlanSchema)) body: O<typeof savePlanSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Plan> {
    return this.platform.savePlan(actor, id, body, req.ip);
  }

  @RequirePlatformRole(...SUPPORT)
  @Get('audit')
  auditLog(@Query(new ZodPipe(platformAuditQuerySchema)) q: O<typeof platformAuditQuerySchema>) {
    return this.platform.auditLog(q);
  }
}
