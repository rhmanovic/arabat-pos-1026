import { Module } from '@nestjs/common';
import { RegistersModule } from '../registers/registers.module.js';
import { CashControlsController } from './cash-controls.controller.js';
import { CashControlsService } from './cash-controls.service.js';
import { CashPayoutsController, PosCashController } from './cash-payouts.controller.js';
import { CashPayoutsService } from './cash-payouts.service.js';
import { CashController } from './cash.controller.js';
import { CashService } from './cash.service.js';

@Module({
  imports: [RegistersModule],
  controllers: [CashController, CashPayoutsController, PosCashController, CashControlsController],
  providers: [CashService, CashPayoutsService, CashControlsService],
})
export class CashModule {}
