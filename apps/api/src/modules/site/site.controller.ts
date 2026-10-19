import { type PublicSiteApps, type SiteApp, saveSiteAppSchema } from '@arabat/contracts';
import type { PlatformRole } from '@arabat/permissions';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { Public, RequirePlatformRole } from '../../kernel/access/access.decorators.js';
import { CurrentPlatformActor } from '../../kernel/access/current-actor.js';
import type { PlatformActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { SiteService } from './site.service.js';

const uuid = new ParseUUIDPipe();
type O<T extends z.ZodType> = z.output<T>;

/** The landing site reads the menu without a session. */
@Controller('public/site')
export class PublicSiteController {
  constructor(private readonly site: SiteService) {}

  @Public()
  @Get('apps')
  apps(): Promise<PublicSiteApps> {
    return this.site.publicApps();
  }
}

const ANY: PlatformRole[] = ['platform.super_admin', 'platform.support', 'platform.billing'];
const EDITORS: PlatformRole[] = ['platform.super_admin', 'platform.billing'];

/** Operators add, edit, hide, reorder and delete the entries (AUTH.md §8). */
@Controller('platform')
export class PlatformSiteController {
  constructor(private readonly site: SiteService) {}

  @RequirePlatformRole(...ANY)
  @Get('site-apps')
  async apps(): Promise<{ apps: SiteApp[] }> {
    return { apps: await this.site.apps() };
  }

  @RequirePlatformRole(...EDITORS)
  @Post('site-apps')
  create(
    @CurrentPlatformActor() actor: PlatformActor,
    @Body(new ZodPipe(saveSiteAppSchema)) body: O<typeof saveSiteAppSchema>,
    @Req() req: FastifyRequest,
  ): Promise<SiteApp> {
    return this.site.save(actor, null, body, req.ip);
  }

  @RequirePlatformRole(...EDITORS)
  @Put('site-apps/:id')
  update(
    @CurrentPlatformActor() actor: PlatformActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(saveSiteAppSchema)) body: O<typeof saveSiteAppSchema>,
    @Req() req: FastifyRequest,
  ): Promise<SiteApp> {
    return this.site.save(actor, id, body, req.ip);
  }

  @RequirePlatformRole(...EDITORS)
  @Delete('site-apps/:id')
  @HttpCode(204)
  async remove(
    @CurrentPlatformActor() actor: PlatformActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.site.remove(actor, id, req.ip);
  }
}
