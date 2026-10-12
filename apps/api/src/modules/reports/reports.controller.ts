import {
  type InventoryReport,
  type PaymentsReport,
  type PurchasingReport,
  type SalesReport,
  type ShiftsReport,
  reportQuerySchema,
} from '@arabat/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import type { z } from 'zod';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { ReportsService } from './reports.service.js';

type Q = z.output<typeof reportQuerySchema>;
const pipe = new ZodPipe(reportQuerySchema);

/** Management reports; branch scope is re-checked in the service for every query. */
@Controller('manager/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @RequirePermission('manager', 'reports.sales')
  @Get('sales')
  sales(@CurrentMerchantActor() actor: MerchantActor, @Query(pipe) q: Q): Promise<SalesReport> {
    return this.reports.sales(actor, q);
  }

  @RequirePermission('manager', 'reports.financial')
  @Get('payments')
  payments(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(pipe) q: Q,
  ): Promise<PaymentsReport> {
    return this.reports.payments(actor, q);
  }

  @RequirePermission('manager', 'reports.financial')
  @Get('shifts')
  shifts(@CurrentMerchantActor() actor: MerchantActor, @Query(pipe) q: Q): Promise<ShiftsReport> {
    return this.reports.shifts(actor, q);
  }

  @RequirePermission('manager', 'reports.inventory')
  @Get('inventory')
  inventory(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(pipe) q: Q,
  ): Promise<InventoryReport> {
    return this.reports.inventory(actor, q);
  }

  @RequirePermission('manager', 'reports.inventory')
  @Get('purchasing')
  purchasing(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(pipe) q: Q,
  ): Promise<PurchasingReport> {
    return this.reports.purchasing(actor, q);
  }
}
