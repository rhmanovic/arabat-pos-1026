import { Module } from '@nestjs/common';
import { RegistersModule } from '../registers/registers.module.js';
import { CashPayoutsController, PosCashController } from './cash-payouts.controller.js';
import { CashPayoutsService } from './cash-payouts.service.js';
import { CashController } from './cash.controller.js';
import { CashService } from './cash.service.js';

@Module({
  imports: [RegistersModule],
  controllers: [CashController, CashPayoutsController, PosCashController],
  providers: [CashService, CashPayoutsService],
})
export class CashModule {}
