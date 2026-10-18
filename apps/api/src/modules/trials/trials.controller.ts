import {
  type DeviceTrialRequest,
  type FunnelStats,
  type PublicTrialOffer,
  type TrialDeviceStock,
  type TrialSettings,
  type TrialStarted,
  deviceTrialQuerySchema,
  funnelEventSchema,
  funnelStatsQuerySchema,
  leadQuerySchema,
  saveTrialSettingsSchema,
  saveTrialStockSchema,
  startTrialSchema,
  updateDeviceTrialSchema,
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
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { Public, RequirePlatformRole } from '../../kernel/access/access.decorators.js';
import { CurrentPlatformActor } from '../../kernel/access/current-actor.js';
import type { PlatformActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { SessionService, clientInfo } from '../auth/session.service.js';
import { TrialsService } from './trials.service.js';

const uuid = new ParseUUIDPipe();
type O<T extends z.ZodType> = z.output<T>;

/** The public sign-up funnel (`/start` on the landing site, ADR-0115). */
@Controller('public/trial')
export class PublicTrialController {
  constructor(
    private readonly trials: TrialsService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Get()
  offer(): Promise<PublicTrialOffer> {
    return this.trials.offer();
  }

  @Public()
  @Post('events')
  @HttpCode(204)
  async event(
    @Body(new ZodPipe(funnelEventSchema)) body: O<typeof funnelEventSchema>,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.trials.track(body.sessionId, body.step, req.ip);
  }

  /** Opens the trial account and signs the owner in to the management app. */
  @Public()
  @Post('start')
  async start(
    @Body(new ZodPipe(startTrialSchema)) body: O<typeof startTrialSchema>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TrialStarted> {
    const { outcome, result } = await this.trials.start(body, clientInfo(req));
    if (outcome.session)
      this.sessions.setCookie(reply, outcome.session.interface, outcome.session.token);
    return result;
  }
}

const ANY: PlatformRole[] = ['platform.super_admin', 'platform.support', 'platform.billing'];
const BILLING: PlatformRole[] = ['platform.super_admin', 'platform.billing'];

/** Trials, leads and the funnel in the platform console (ADR-0115). */
@Controller('platform/trials')
export class PlatformTrialsController {
  constructor(private readonly trials: TrialsService) {}

  @RequirePlatformRole(...ANY)
  @Get('settings')
  settings(): Promise<TrialSettings> {
    return this.trials.settings();
  }

  @RequirePlatformRole(...BILLING)
  @Put('settings')
  saveSettings(
    @CurrentPlatformActor() actor: PlatformActor,
    @Body(new ZodPipe(saveTrialSettingsSchema)) body: O<typeof saveTrialSettingsSchema>,
    @Req() req: FastifyRequest,
  ): Promise<TrialSettings> {
    return this.trials.saveSettings(actor, body, req.ip);
  }

  @RequirePlatformRole(...ANY)
  @Get('stock')
  async stock(): Promise<{ devices: TrialDeviceStock[] }> {
    return { devices: await this.trials.stock() };
  }

  @RequirePlatformRole(...BILLING)
  @Put('stock/:itemId')
  async saveStock(
    @CurrentPlatformActor() actor: PlatformActor,
    @Param('itemId', uuid) itemId: string,
    @Body(new ZodPipe(saveTrialStockSchema)) body: O<typeof saveTrialStockSchema>,
    @Req() req: FastifyRequest,
  ): Promise<{ devices: TrialDeviceStock[] }> {
    return { devices: await this.trials.saveStock(actor, itemId, body, req.ip) };
  }

  @RequirePlatformRole(...ANY)
  @Get('leads')
  leads(
    @CurrentPlatformActor() actor: PlatformActor,
    @Query(new ZodPipe(leadQuerySchema)) q: O<typeof leadQuerySchema>,
  ) {
    return this.trials.leads(actor, q.stage);
  }

  @RequirePlatformRole(...ANY)
  @Get('devices')
  devices(
    @CurrentPlatformActor() actor: PlatformActor,
    @Query(new ZodPipe(deviceTrialQuerySchema)) q: O<typeof deviceTrialQuerySchema>,
  ) {
    return this.trials.deviceRequests(actor, q.status);
  }

  @RequirePlatformRole(...ANY)
  @Put('devices/:id')
  updateDevices(
    @CurrentPlatformActor() actor: PlatformActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(updateDeviceTrialSchema)) body: O<typeof updateDeviceTrialSchema>,
    @Req() req: FastifyRequest,
  ): Promise<DeviceTrialRequest> {
    return this.trials.updateDeviceRequest(actor, id, body, req.ip);
  }

  @RequirePlatformRole(...ANY)
  @Get('funnel')
  funnel(
    @Query(new ZodPipe(funnelStatsQuerySchema)) q: O<typeof funnelStatsQuerySchema>,
  ): Promise<FunnelStats> {
    return this.trials.funnel(q.days);
  }
}
