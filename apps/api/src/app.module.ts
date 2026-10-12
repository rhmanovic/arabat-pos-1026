import { type DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { AccessModule } from './kernel/access/access.module.js';
import { MailModule } from './kernel/mail/mail.module.js';
import { StorageModule } from './kernel/storage/storage.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BranchesModule } from './modules/branches/branches.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IamModule } from './modules/iam/iam.module.js';
import { MerchantsModule } from './modules/merchants/merchants.module.js';

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
        AccessModule,
        AuthModule,
        HealthModule,
        MerchantsModule,
        BranchesModule,
        IamModule,
        CatalogModule,
        InventoryModule,
      ],
    };
  }
}
