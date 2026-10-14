import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { RegistersModule } from '../registers/registers.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { PosAssistantController } from './assistant.controller.js';
import { AnthropicAssistantModel, AssistantModel } from './assistant.model.js';
import { AssistantService } from './assistant.service.js';

/** POS assistant (ADR-0105): a read-only chat helper over the cashier's own lookups. */
@Module({
  imports: [AuthModule, CatalogModule, InventoryModule, SalesModule, RegistersModule],
  controllers: [PosAssistantController],
  providers: [AssistantService, { provide: AssistantModel, useClass: AnthropicAssistantModel }],
})
export class AssistantModule {}
