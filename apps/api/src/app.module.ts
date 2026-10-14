import { type DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { AccessModule } from './kernel/access/access.module.js';
import { MailModule } from './kernel/mail/mail.module.js';
import { StorageModule } from './kernel/storage/storage.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { RegistersModule } from './modules/registers/registers.module.js';
import { CashModule } from './modules/cash/cash.module.js';
import { SalesModule } from './modules/sales/sales.module.js';
import { RefundsModule } from './modules/refunds/refunds.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { PeriodsModule } from './modules/periods/periods.module.js';
import { RestaurantModule } from './modules/restaurant/restaurant.module.js';
import { EcommerceModule } from './modules/ecommerce/ecommerce.module.js';
import { PurchasingModule } from './modules/purchasing/purchasing.module.js';
import { TransfersModule } from './modules/transfers/transfers.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BranchesModule } from './modules/branches/branches.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IamModule } from './modules/iam/iam.module.js';
import { MerchantsModule } from './modules/merchants/merchants.module.js';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module.js';
import { PlatformAdminModule } from './modules/platform-admin/platform-admin.module.js';
import { AssistantModule } from './modules/assistant/assistant.module.js';

/** Root module of the modular monolith. Domain modules are registered here per milestone. */
@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        DatabaseModule,
        MailModule,
        StorageModule,
        AuditModule,
        SubscriptionsModule,
        PlatformAdminModule,
        AccessModule,
        AuthModule,
        HealthModule,
        MerchantsModule,
        BranchesModule,
        IamModule,
        CatalogModule,
        InventoryModule,
        PaymentsModule,
        RegistersModule,
        CashModule,
        SalesModule,
        RefundsModule,
        PurchasingModule,
        TransfersModule,
        CustomersModule,
        ReportsModule,
        PeriodsModule,
        RestaurantModule,
        EcommerceModule,
        AssistantModule,
      ],
    };
  }
}
