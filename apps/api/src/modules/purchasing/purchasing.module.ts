import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PurchasingController } from './purchasing.controller.js';
import { PurchasingService } from './purchasing.service.js';

@Module({
  imports: [InventoryModule],
  controllers: [PurchasingController],
  providers: [PurchasingService],
})
export class PurchasingModule {}
