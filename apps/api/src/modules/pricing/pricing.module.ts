import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PlatformPricingController, PublicPricingController } from './pricing.controller.js';
import { PricingService } from './pricing.service.js';

/** Public pricing page and purchase requests (ADR-0114). */
@Module({
  imports: [AuthModule],
  controllers: [PublicPricingController, PlatformPricingController],
  providers: [PricingService],
})
export class PricingModule {}
