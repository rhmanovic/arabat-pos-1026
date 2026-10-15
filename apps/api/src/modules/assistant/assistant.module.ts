import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { RegistersModule } from '../registers/registers.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { AssistantHistoryService } from './assistant-history.service.js';
import { AssistantUsageService } from './assistant-usage.service.js';
import {
  ManagerAssistantController,
  PlatformAssistantController,
  PosAssistantController,
} from './assistant.controller.js';
import { AnthropicAssistantModel, AssistantModel } from './assistant.model.js';
import { AssistantService } from './assistant.service.js';

/** Assistant (ADR-0105): a read-only chat helper over the user's own lookups, POS and manager. */
@Module({
  imports: [
    AuthModule,
    CatalogModule,
    InventoryModule,
    PaymentsModule,
    ReportsModule,
    SalesModule,
    RegistersModule,
  ],
  controllers: [PosAssistantController, ManagerAssistantController, PlatformAssistantController],
  providers: [
    AssistantService,
    AssistantUsageService,
    AssistantHistoryService,
    { provide: AssistantModel, useClass: AnthropicAssistantModel },
  ],
})
export class AssistantModule {}
