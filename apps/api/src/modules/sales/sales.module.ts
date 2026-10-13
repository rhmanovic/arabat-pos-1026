import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { RegistersModule } from '../registers/registers.module.js';
import { OverridesService } from './overrides.service.js';
import { PosSalesController, SalesController } from './sales.controller.js';
import { SalesService } from './sales.service.js';

@Module({
  imports: [InventoryModule, RegistersModule],
  controllers: [PosSalesController, SalesController],
  providers: [SalesService, OverridesService],
  exports: [SalesService],
})
export class SalesModule {}
