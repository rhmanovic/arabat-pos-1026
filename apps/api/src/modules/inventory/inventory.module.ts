import { Module } from '@nestjs/common';
import { InventoryController, PosInventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';
import { StockLedgerService } from './stock-ledger.service.js';

@Module({
  controllers: [InventoryController, PosInventoryController],
  providers: [InventoryService, StockLedgerService],
  exports: [StockLedgerService, InventoryService],
})
export class InventoryModule {}
