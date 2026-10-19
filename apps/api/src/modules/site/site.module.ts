import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PlatformSiteController, PublicSiteController } from './site.controller.js';
import { SiteService } from './site.service.js';

/** The public site's "Our apps" menu, managed by platform operators (ADR-0117). */
@Module({
  imports: [AuthModule],
  controllers: [PublicSiteController, PlatformSiteController],
  providers: [SiteService],
})
export class SiteModule {}
