import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { RegistersModule } from '../registers/registers.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { RestaurantConfigService } from './restaurant-config.service.js';
import { RestaurantManagerController, RestaurantPosController } from './restaurant.controller.js';
import { RestaurantOrdersService } from './restaurant-orders.service.js';

@Module({
  imports: [SalesModule, RegistersModule, InventoryModule],
  controllers: [RestaurantManagerController, RestaurantPosController],
  providers: [RestaurantConfigService, RestaurantOrdersService],
})
export class RestaurantModule {}
