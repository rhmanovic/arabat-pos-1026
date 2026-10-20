import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PrintingModule } from '../printing/printing.module.js';
import { RegistersModule } from '../registers/registers.module.js';
import { SalesModule } from '../sales/sales.module.js';
import {
  OnlineManagerController,
  PaymentsGatewayController,
  PosOnlineOrdersController,
  StoreAccountController,
  StorefrontController,
} from './ecommerce.controller.js';
import { EcommerceService } from './ecommerce.service.js';
import { FulfilmentService } from './fulfilment.service.js';
import { OnlinePaymentsService } from './online-payments.service.js';
import { OrderNotificationsService } from './order-notifications.service.js';
import { PosHandoverService } from './pos-handover.service.js';
import { PromotionsService } from './promotions.service.js';
import { StoreAccountsService } from './store-accounts.service.js';

@Module({
  imports: [SalesModule, InventoryModule, AuthModule, PrintingModule, RegistersModule],
  controllers: [
    OnlineManagerController,
    StorefrontController,
    PaymentsGatewayController,
    PosOnlineOrdersController,
    StoreAccountController,
  ],
  providers: [
    EcommerceService,
    OnlinePaymentsService,
    FulfilmentService,
    OrderNotificationsService,
    PosHandoverService,
    PromotionsService,
    StoreAccountsService,
  ],
  exports: [OnlinePaymentsService, OrderNotificationsService],
})
export class EcommerceModule {}
