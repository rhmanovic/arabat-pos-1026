import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
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
import { CatalogTransferController } from './catalog-transfer.controller.js';
import { CatalogTransferService } from './catalog-transfer.service.js';
import { EcommerceService } from './ecommerce.service.js';
import { FulfilmentService } from './fulfilment.service.js';
import { OnlinePaymentsService } from './online-payments.service.js';
import { OrderNotificationsService } from './order-notifications.service.js';
import { PosHandoverService } from './pos-handover.service.js';
import { PromotionsService } from './promotions.service.js';
import { StoreAccountsService } from './store-accounts.service.js';
import { StoreAddressService } from './store-address.service.js';
import { StoreDomainsService } from './store-domains.service.js';
import { StoreShareService } from './store-share.service.js';

import { StoreDesignController, StoreDesignPublicController } from './store-design.controller.js';
import { StoreDesignService } from './store-design.service.js';

@Module({
  imports: [
    SalesModule,
    InventoryModule,
    AuthModule,
    PrintingModule,
    RegistersModule,
    CatalogModule,
  ],
  controllers: [
    OnlineManagerController,
    StorefrontController,
    PaymentsGatewayController,
    PosOnlineOrdersController,
    StoreAccountController,
    StoreDesignController,
    StoreDesignPublicController,
    CatalogTransferController,
  ],
  providers: [
    StoreShareService,
    StoreAddressService,
    StoreDomainsService,
    EcommerceService,
    OnlinePaymentsService,
    FulfilmentService,
    OrderNotificationsService,
    PosHandoverService,
    PromotionsService,
    StoreAccountsService,
    StoreDesignService,
    CatalogTransferService,
  ],
  exports: [
    StoreShareService,
    StoreAddressService,
    OnlinePaymentsService,
    OrderNotificationsService,
  ],
})
export class EcommerceModule {}
