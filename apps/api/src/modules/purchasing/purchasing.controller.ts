import {
  type PurchaseOrder,
  type Supplier,
  purchaseOrderActionSchema,
  purchaseOrderListQuerySchema,
  receivePurchaseSchema,
  savePurchaseOrderSchema,
  saveSupplierSchema,
} from '@arabat/contracts';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { PurchasingService } from './purchasing.service.js';

const uuid = new ParseUUIDPipe();
type Action = z.output<typeof purchaseOrderActionSchema>;

@Controller('manager')
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  @RequirePermission('manager', 'purchasing.read')
  @Get('suppliers')
  async suppliers(
    @CurrentMerchantActor() actor: MerchantActor,
  ): Promise<{ suppliers: Supplier[] }> {
    return { suppliers: await this.purchasing.listSuppliers(actor) };
  }

  @RequirePermission('manager', 'purchasing.manage')
  @Post('suppliers')
  createSupplier(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveSupplierSchema)) body: z.output<typeof saveSupplierSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Supplier> {
    return this.purchasing.saveSupplier(actor, null, body, req.ip);
  }

  @RequirePermission('manager', 'purchasing.manage')
  @Patch('suppliers/:id')
  updateSupplier(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(saveSupplierSchema)) body: z.output<typeof saveSupplierSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Supplier> {
    return this.purchasing.saveSupplier(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'purchasing.read')
  @Get('purchase-orders')
  list(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(purchaseOrderListQuerySchema))
    query: z.output<typeof purchaseOrderListQuerySchema>,
  ) {
    return this.purchasing.listOrders(actor, query);
  }

  @RequirePermission('manager', 'purchasing.read')
  @Get('purchase-orders/:id')
  get(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
  ): Promise<PurchaseOrder> {
    return this.purchasing.getOrder(actor, id);
  }

  @RequirePermission('manager', 'purchasing.manage')
  @Post('purchase-orders')
  create(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(savePurchaseOrderSchema)) body: z.output<typeof savePurchaseOrderSchema>,
    @Req() req: FastifyRequest,
  ): Promise<PurchaseOrder> {
    return this.purchasing.createOrder(actor, body, req.ip);
  }

  @RequirePermission('manager', 'purchasing.manage')
  @Patch('purchase-orders/:id')
  update(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(savePurchaseOrderSchema)) body: z.output<typeof savePurchaseOrderSchema>,
    @Req() req: FastifyRequest,
  ): Promise<PurchaseOrder> {
    return this.purchasing.updateOrder(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'purchasing.manage')
  @Post('purchase-orders/:id/submit')
  submit(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(purchaseOrderActionSchema)) body: Action,
    @Req() req: FastifyRequest,
  ) {
    return this.purchasing.transition(actor, id, 'submit', body.version, body.reason, req.ip);
  }

  @RequirePermission('manager', 'purchasing.approve')
  @Post('purchase-orders/:id/approve')
  approve(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(purchaseOrderActionSchema)) body: Action,
    @Req() req: FastifyRequest,
  ) {
    return this.purchasing.transition(actor, id, 'approve', body.version, body.reason, req.ip);
  }

  /** Service checks: `purchasing.manage` or `purchasing.approve` at the order's branch. */
  @RequirePermission('manager', 'purchasing.read')
  @Post('purchase-orders/:id/cancel')
  cancel(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(purchaseOrderActionSchema)) body: Action,
    @Req() req: FastifyRequest,
  ) {
    return this.purchasing.transition(actor, id, 'cancel', body.version, body.reason, req.ip);
  }

  @RequirePermission('manager', 'purchasing.approve')
  @Post('purchase-orders/:id/close')
  close(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(purchaseOrderActionSchema)) body: Action,
    @Req() req: FastifyRequest,
  ) {
    return this.purchasing.transition(actor, id, 'close', body.version, body.reason, req.ip);
  }

  @RequirePermission('manager', 'purchasing.receive')
  @Post('purchase-orders/:id/receipts')
  receive(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(receivePurchaseSchema)) body: z.output<typeof receivePurchaseSchema>,
    @Req() req: FastifyRequest,
  ): Promise<PurchaseOrder> {
    return this.purchasing.receive(actor, id, body, req.ip);
  }
}
