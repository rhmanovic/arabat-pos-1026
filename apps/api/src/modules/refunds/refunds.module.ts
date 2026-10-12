import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { RegistersModule } from '../registers/registers.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { PosRefundsController, RefundsController } from './refunds.controller.js';
import { RefundsService } from './refunds.service.js';

@Module({
  imports: [InventoryModule, RegistersModule, SalesModule],
  controllers: [PosRefundsController, RefundsController],
  providers: [RefundsService],
})
export class RefundsModule {}
