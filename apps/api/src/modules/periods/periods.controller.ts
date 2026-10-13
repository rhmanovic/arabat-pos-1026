import {
  type PeriodList,
  type PeriodPack,
  closePeriodSchema,
  periodKeySchema,
} from '@arabat/contracts';
import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { PeriodsService } from './periods.service.js';

const periodParam = new ZodPipe(periodKeySchema);

/** Month-end close (BR-189): the pack is readable with the financial reports; closing is its own right. */
@Controller('manager/periods')
export class PeriodsController {
  constructor(private readonly periods: PeriodsService) {}

  @RequirePermission('manager', 'reports.financial')
  @Get()
  list(@CurrentMerchantActor() actor: MerchantActor): Promise<PeriodList> {
    return this.periods.list(actor);
  }

  @RequirePermission('manager', 'reports.financial')
  @Get(':period')
  get(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('period', periodParam) period: string,
  ): Promise<PeriodPack> {
    return this.periods.get(actor, period);
  }

  @RequirePermission('manager', 'periods.close')
  @Post(':period/close')
  close(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('period', periodParam) period: string,
    @Body(new ZodPipe(closePeriodSchema)) body: z.output<typeof closePeriodSchema>,
    @Req() req: FastifyRequest,
  ): Promise<PeriodPack> {
    return this.periods.close(actor, period, body, req.ip);
  }
}
