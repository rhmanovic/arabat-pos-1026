import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PlatformTrialsController, PublicTrialController } from './trials.controller.js';
import { TrialsService } from './trials.service.js';

/** Free trials, leads and the public sign-up funnel (ADR-0115). */
@Module({
  imports: [AuthModule],
  controllers: [PublicTrialController, PlatformTrialsController],
  providers: [TrialsService],
})
export class TrialsModule {}
