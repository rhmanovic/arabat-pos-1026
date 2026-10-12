import {
  type Adjustment,
  type InventorySettings,
  type InventorySummary,
  type PosAvailability,
  type VariantStock,
  adjustmentListQuerySchema,
  createAdjustmentSchema,
  movementQuerySchema,
  posAvailabilityQuerySchema,
  setThresholdSchema,
  stockLevelQuerySchema,
  updateInventorySettingsSchema,
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
import { InventoryService } from './inventory.service.js';

const uuid = new ParseUUIDPipe();
const summaryQuery = z.object({ branchId: z.uuid().optional() });

/**
 * Manager inventory API. The guard checks the permission at `?branchId` when given (or
 * anywhere); the service checks the exact branch of every write and filters reads to the
 * branches where the actor holds `inventory.read`.
 */
@Controller('manager/inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @RequirePermission('manager', 'inventory.read')
  @Get('levels')
  levels(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(stockLevelQuerySchema)) query: z.output<typeof stockLevelQuerySchema>,
  ) {
    return this.inventory.listLevels(actor, query);
  }

  @RequirePermission('manager', 'inventory.read')
  @Get('summary')
  summary(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(summaryQuery)) query: z.output<typeof summaryQuery>,
  ): Promise<InventorySummary> {
    return this.inventory.summary(actor, query.branchId);
  }

  @RequirePermission('manager', 'inventory.read')
  @Get('variants/:variantId')
  variant(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('variantId', uuid) variantId: string,
  ): Promise<VariantStock> {
    return this.inventory.variantStock(actor, variantId);
  }

  @RequirePermission('manager', 'inventory.adjust')
  @Put('thresholds')
  @HttpCode(204)
  async threshold(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(setThresholdSchema)) body: z.output<typeof setThresholdSchema>,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.inventory.setThreshold(actor, body, req.ip);
  }

  @RequirePermission('manager', 'inventory.read')
  @Get('movements')
  movements(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(movementQuerySchema)) query: z.output<typeof movementQuerySchema>,
  ) {
    return this.inventory.listMovements(actor, query);
  }

  @RequirePermission('manager', 'inventory.read')
  @Get('adjustments')
  adjustments(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(adjustmentListQuerySchema))
    query: z.output<typeof adjustmentListQuerySchema>,
  ) {
    return this.inventory.listAdjustments(actor, query);
  }

  @RequirePermission('manager', 'inventory.read')
  @Get('adjustments/:id')
  adjustment(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
  ): Promise<Adjustment> {
    return this.inventory.getAdjustment(actor, id);
  }

  @RequirePermission('manager', 'inventory.adjust')
  @Post('adjustments')
  create(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(createAdjustmentSchema)) body: z.output<typeof createAdjustmentSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Adjustment> {
    return this.inventory.createAdjustment(actor, body, req.ip);
  }

  @RequirePermission('manager', 'inventory.read')
  @Get('settings')
  settings(@CurrentMerchantActor() actor: MerchantActor): Promise<InventorySettings> {
    return this.inventory.getSettings(actor);
  }

  @RequirePermission('manager', 'merchant.settings.update')
  @Put('settings')
  updateSettings(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(updateInventorySettingsSchema))
    body: z.output<typeof updateInventorySettingsSchema>,
    @Req() req: FastifyRequest,
  ): Promise<InventorySettings> {
    return this.inventory.updateSettings(actor, body, req.ip);
  }
}

/** POS stock availability at the session's bound branch. */
@Controller('pos/inventory')
export class PosInventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @RequirePermission('pos', 'catalog.read')
  @Get('availability')
  availability(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(posAvailabilityQuerySchema))
    query: z.output<typeof posAvailabilityQuerySchema>,
  ): Promise<PosAvailability> {
    return this.inventory.posAvailability(actor, query.variantIds);
  }
}
