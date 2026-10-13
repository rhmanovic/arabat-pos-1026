import { Module } from '@nestjs/common';
import { ControlsService } from './controls.service.js';
import { MerchantsController } from './merchants.controller.js';
import { MerchantsService } from './merchants.service.js';
import { OwnershipService } from './ownership.service.js';

@Module({
  controllers: [MerchantsController],
  providers: [MerchantsService, ControlsService, OwnershipService],
  exports: [OwnershipService],
})
export class MerchantsModule {}
