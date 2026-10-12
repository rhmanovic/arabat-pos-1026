import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { SalesModule } from '../sales/sales.module.js';
import {
  OnlineManagerController,
  PaymentsGatewayController,
  StorefrontController,
} from './ecommerce.controller.js';
import { EcommerceService } from './ecommerce.service.js';
import { OnlinePaymentsService } from './online-payments.service.js';

@Module({
  imports: [SalesModule, InventoryModule, AuthModule],
  controllers: [OnlineManagerController, StorefrontController, PaymentsGatewayController],
  providers: [EcommerceService, OnlinePaymentsService],
  exports: [OnlinePaymentsService],
})
export class EcommerceModule {}
