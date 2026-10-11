import { Module } from '@nestjs/common';
import { CatalogController, PosCatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

@Module({
  controllers: [CatalogController, PosCatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
