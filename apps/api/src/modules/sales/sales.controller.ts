import {
  type PrintJob,
  type Receipt,
  type Sale,
  type SaleOverrideGrant,
  type SalesSettings,
  cartEventSchema,
  checkoutSchema,
  requestOverrideSchema,
  saleListQuerySchema,
  suspendOrderSchema,
  updateSalesSettingsSchema,
} from '@arabat/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { OverridesService } from './overrides.service.js';
import { SalesService } from './sales.service.js';

const uuid = new ParseUUIDPipe();
const lookupQuery = z.object({ receipt: z.string().trim().min(1).max(40) });

/** POS checkout at the session's branch, on the cashier's open shift. */
@Controller('pos')
export class PosSalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly overrides: OverridesService,
  ) {}

  @RequirePermission('pos', 'sales.create')
  @Get('sales/settings')
  settings(@CurrentMerchantActor() actor: MerchantActor): Promise<SalesSettings> {
    return this.sales.getSettings(actor);
  }

  /** A supervisor authorises an exception on this till with their own credentials (BR-177). */
  @RequirePermission('pos', 'sales.create')
  @Post('overrides')
  requestOverride(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(requestOverrideSchema)) body: z.output<typeof requestOverrideSchema>,
    @Req() req: FastifyRequest,
  ): Promise<SaleOverrideGrant> {
    return this.overrides.request(actor, body, req.ip);
  }

  @RequirePermission('pos', 'sales.create')
  @Post('sales')
  checkout(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(checkoutSchema)) body: z.output<typeof checkoutSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Sale> {
    return this.sales.checkout(actor, body, req.ip);
  }

  @RequirePermission('pos', 'sales.create')
  @Get('sales/recent')
  async recent(@CurrentMerchantActor() actor: MerchantActor) {
    return { sales: await this.sales.recent(actor) };
  }

  /** Receipt lookup by number at the till, read-only, session branch only (BR-182). */
  @RequirePermission('pos', 'sales.create')
  @Get('sales/lookup')
  lookup(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(lookupQuery)) query: z.output<typeof lookupQuery>,
  ): Promise<Sale> {
    return this.sales.lookup(actor, query.receipt);
  }

  @RequirePermission('pos', 'sales.create')
  @Get('sales/:id/receipt')
  receipt(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
  ): Promise<Receipt> {
    return this.sales.receipt(actor, id, 'pos');
  }

  /**
   * A receipt copy: logged, audited, numbered (BR-182) and sent to the branch's print agents
   * (ADR-0111). The till never prints in the browser.
   */
  @RequirePermission('pos', 'sales.create')
  @Post('sales/:id/print')
  print(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<PrintJob> {
    return this.sales.reprint(actor, id, req.ip);
  }

  /** A cart cleared or a line removed after a total was shown (BR-182). */
  @RequirePermission('pos', 'sales.create')
  @Post('cart-events')
  @HttpCode(204)
  async cartEvent(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(cartEventSchema)) body: z.output<typeof cartEventSchema>,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.sales.recordCartEvent(actor, body, req.ip);
  }

  @RequirePermission('pos', 'sales.create')
  @Post('orders')
  suspend(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(suspendOrderSchema)) body: z.output<typeof suspendOrderSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.sales.suspend(actor, body, req.ip);
  }

  @RequirePermission('pos', 'sales.create')
  @Get('orders/suspended')
  async suspended(@CurrentMerchantActor() actor: MerchantActor) {
    return { orders: await this.sales.suspended(actor) };
  }

  @RequirePermission('pos', 'sales.create')
  @Post('orders/:id/cancel')
  @HttpCode(204)
  async cancel(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.sales.cancelSuspended(actor, id, req.ip);
  }
}

/** Manager: transaction history and selling policy. */
@Controller('manager')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @RequirePermission('manager', 'sales.read')
  @Get('sales')
  list(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(saleListQuerySchema)) query: z.output<typeof saleListQuerySchema>,
  ) {
    return this.sales.list(actor, query);
  }

  @RequirePermission('manager', 'sales.read')
  @Get('sales/:id')
  get(@CurrentMerchantActor() actor: MerchantActor, @Param('id', uuid) id: string): Promise<Sale> {
    return this.sales.getSale(actor, id, 'manager');
  }

  @RequirePermission('manager', 'sales.read')
  @Get('sales/:id/receipt')
  receipt(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
  ): Promise<Receipt> {
    return this.sales.receipt(actor, id, 'manager');
  }

  @RequirePermission('manager', 'merchant.settings.read')
  @Get('sales-settings')
  settings(@CurrentMerchantActor() actor: MerchantActor): Promise<SalesSettings> {
    return this.sales.getSettings(actor);
  }

  @RequirePermission('manager', 'merchant.settings.update')
  @Put('sales-settings')
  updateSettings(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(updateSalesSettingsSchema)) body: z.output<typeof updateSalesSettingsSchema>,
    @Req() req: FastifyRequest,
  ): Promise<SalesSettings> {
    return this.sales.updateSettings(actor, body, req.ip);
  }
}
