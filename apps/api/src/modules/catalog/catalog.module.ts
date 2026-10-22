import { Module } from '@nestjs/common';
import { CatalogController, PosCatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { DiscountsController } from './discounts.controller.js';
import { DiscountsService } from './discounts.service.js';

@Module({
  controllers: [CatalogController, PosCatalogController, DiscountsController],
  providers: [CatalogService, DiscountsService],
  exports: [CatalogService, DiscountsService],
})
export class CatalogModule {}
