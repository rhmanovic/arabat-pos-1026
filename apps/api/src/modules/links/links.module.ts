import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LinkPageManagerController, PublicLinksController } from './links.controller.js';
import { LinksService } from './links.service.js';

/** Link page ("link in bio") of a merchant (ADR-0116). */
@Module({
  imports: [AuthModule],
  controllers: [LinkPageManagerController, PublicLinksController],
  providers: [LinksService],
})
export class LinksModule {}
