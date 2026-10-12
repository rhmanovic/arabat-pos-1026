import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { TransfersController } from './transfers.controller.js';
import { TransfersService } from './transfers.service.js';

@Module({
  imports: [InventoryModule],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}
