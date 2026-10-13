import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module.js';
import { PeriodsController } from './periods.controller.js';
import { PeriodsService } from './periods.service.js';

@Module({
  imports: [ReportsModule],
  controllers: [PeriodsController],
  providers: [PeriodsService],
  exports: [PeriodsService],
})
export class PeriodsModule {}
