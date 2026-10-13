import {
  type ExpensesReport,
  type InventoryReport,
  type PaymentsReport,
  type PurchasingReport,
  type SalesReport,
  type ShiftsReport,
  type TodaySummary,
  reportExportSchema,
  reportQuerySchema,
} from '@arabat/contracts';
import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { Authenticated, RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { ReportsService } from './reports.service.js';

type Q = z.output<typeof reportQuerySchema>;
const pipe = new ZodPipe(reportQuerySchema);

/**
 * Management reports; branch scope is re-checked in the service for every query. Every view
 * and every CSV export is written to the audit log (BR-187).
 */
@Controller('manager/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Dashboard KPIs: today and yesterday in scope (BR-187). */
  @RequirePermission('manager', 'reports.sales')
  @Get('today')
  today(@CurrentMerchantActor() actor: MerchantActor): Promise<TodaySummary> {
    return this.reports.today(actor);
  }

  /** The browser built a CSV from a report it displays; record the export. */
  @Authenticated('manager')
  @Post('exports')
  @HttpCode(204)
  async exported(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(reportExportSchema)) body: z.output<typeof reportExportSchema>,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.reports.logExport(actor, body, req.ip);
  }

  @RequirePermission('manager', 'reports.sales')
  @Get('sales')
  sales(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(pipe) q: Q,
    @Req() req: FastifyRequest,
  ): Promise<SalesReport> {
    return this.reports.sales(actor, q, req.ip);
  }

  @RequirePermission('manager', 'reports.financial')
  @Get('payments')
  payments(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(pipe) q: Q,
    @Req() req: FastifyRequest,
  ): Promise<PaymentsReport> {
    return this.reports.payments(actor, q, req.ip);
  }

  @RequirePermission('manager', 'reports.financial')
  @Get('expenses')
  expenses(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(pipe) q: Q,
    @Req() req: FastifyRequest,
  ): Promise<ExpensesReport> {
    return this.reports.expenses(actor, q, req.ip);
  }

  @RequirePermission('manager', 'reports.financial')
  @Get('shifts')
  shifts(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(pipe) q: Q,
    @Req() req: FastifyRequest,
  ): Promise<ShiftsReport> {
    return this.reports.shifts(actor, q, req.ip);
  }

  @RequirePermission('manager', 'reports.inventory')
  @Get('inventory')
  inventory(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(pipe) q: Q,
    @Req() req: FastifyRequest,
  ): Promise<InventoryReport> {
    return this.reports.inventory(actor, q, req.ip);
  }

  @RequirePermission('manager', 'reports.inventory')
  @Get('purchasing')
  purchasing(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(pipe) q: Q,
    @Req() req: FastifyRequest,
  ): Promise<PurchasingReport> {
    return this.reports.purchasing(actor, q, req.ip);
  }
}
