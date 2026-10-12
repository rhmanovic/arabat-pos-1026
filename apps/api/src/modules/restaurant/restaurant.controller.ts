import {
  addOrderItemsSchema,
  cancelOrderItemSchema,
  createRestaurantOrderSchema,
  mergeOrderSchema,
  moveOrderSchema,
  orderVersionSchema,
  payOrderSchema,
  quoteOrderSchema,
  saveDiningAreaSchema,
  saveDiningTableSchema,
  saveKitchenStationSchema,
  saveMenuItemSchema,
  saveModifierGroupSchema,
  ticketStatusSchema,
  updateRestaurantSettingsSchema,
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
import { Authenticated, RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { RestaurantConfigService } from './restaurant-config.service.js';
import { RestaurantOrdersService } from './restaurant-orders.service.js';

const uuid = new ParseUUIDPipe();
type O<T extends z.ZodType> = z.output<T>;
const branchQuery = z.object({ branchId: z.uuid() });
const stationQuery = z.object({ stationId: z.uuid().optional() });

@Controller('manager/restaurant')
export class RestaurantManagerController {
  constructor(private readonly config: RestaurantConfigService) {}

  @Authenticated('manager')
  @Get('settings')
  settings(@CurrentMerchantActor() actor: MerchantActor) {
    return this.config.settings(actor);
  }

  @RequirePermission('manager', 'restaurant.manage')
  @Put('settings')
  updateSettings(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(updateRestaurantSettingsSchema))
    body: O<typeof updateRestaurantSettingsSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.config.updateSettings(actor, body, req.ip);
  }

  @RequirePermission('manager', 'restaurant.manage')
  @Get('layout')
  layout(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(branchQuery)) q: O<typeof branchQuery>,
  ) {
    return this.config.layout(actor, q.branchId);
  }

  @RequirePermission('manager', 'restaurant.manage')
  @Post('areas')
  createArea(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveDiningAreaSchema)) body: O<typeof saveDiningAreaSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.config.saveArea(actor, null, body, req.ip);
  }

  @RequirePermission('manager', 'restaurant.manage')
  @Put('areas/:id')
  updateArea(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(saveDiningAreaSchema)) body: O<typeof saveDiningAreaSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.config.saveArea(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'restaurant.manage')
  @Post('tables')
  createTable(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveDiningTableSchema)) body: O<typeof saveDiningTableSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.config.saveTable(actor, null, body, req.ip);
  }

  @RequirePermission('manager', 'restaurant.manage')
  @Put('tables/:id')
  updateTable(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(saveDiningTableSchema)) body: O<typeof saveDiningTableSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.config.saveTable(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'restaurant.manage')
  @Post('stations')
  createStation(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveKitchenStationSchema)) body: O<typeof saveKitchenStationSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.config.saveStation(actor, null, body, req.ip);
  }

  @RequirePermission('manager', 'restaurant.manage')
  @Put('stations/:id')
  updateStation(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(saveKitchenStationSchema)) body: O<typeof saveKitchenStationSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.config.saveStation(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'restaurant.manage')
  @Get('menu')
  menu(@CurrentMerchantActor() actor: MerchantActor) {
    return this.config.menu(actor);
  }

  @RequirePermission('manager', 'restaurant.manage')
  @Put('menu/:productId')
  saveMenuItem(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('productId', uuid) productId: string,
    @Body(new ZodPipe(saveMenuItemSchema)) body: O<typeof saveMenuItemSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.config.saveMenuItem(actor, productId, body, req.ip);
  }

  @RequirePermission('manager', 'restaurant.manage')
  @Post('modifier-groups')
  createGroup(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveModifierGroupSchema)) body: O<typeof saveModifierGroupSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.config.saveModifierGroup(actor, null, body, req.ip);
  }

  @RequirePermission('manager', 'restaurant.manage')
  @Put('modifier-groups/:id')
  updateGroup(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(saveModifierGroupSchema)) body: O<typeof saveModifierGroupSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.config.saveModifierGroup(actor, id, body, req.ip);
  }
}

@Controller('pos')
export class RestaurantPosController {
  constructor(
    private readonly config: RestaurantConfigService,
    private readonly orders: RestaurantOrdersService,
  ) {}

  @Authenticated('pos')
  @Get('restaurant/settings')
  settings(@CurrentMerchantActor() actor: MerchantActor) {
    return this.config.settings(actor);
  }

  @RequirePermission('pos', 'restaurant.orders')
  @Get('restaurant/menu')
  menu(@CurrentMerchantActor() actor: MerchantActor) {
    return this.config.posMenu(actor);
  }

  @RequirePermission('pos', 'restaurant.orders')
  @Get('restaurant/floor')
  floor(@CurrentMerchantActor() actor: MerchantActor) {
    return this.orders.floor(actor);
  }

  @RequirePermission('pos', 'restaurant.orders')
  @Post('restaurant/orders')
  create(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(createRestaurantOrderSchema)) body: O<typeof createRestaurantOrderSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.orders.create(actor, body, req.ip);
  }

  @RequirePermission('pos', 'restaurant.orders')
  @Get('restaurant/orders/:id')
  get(@CurrentMerchantActor() actor: MerchantActor, @Param('id', uuid) id: string) {
    return this.orders.get(actor, id);
  }

  @RequirePermission('pos', 'restaurant.orders')
  @Post('restaurant/orders/:id/items')
  addItems(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(addOrderItemsSchema)) body: O<typeof addOrderItemsSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.orders.addItems(actor, id, body, req.ip);
  }

  @RequirePermission('pos', 'restaurant.orders')
  @Post('restaurant/orders/:id/send')
  send(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ) {
    return this.orders.send(actor, id, req.ip);
  }

  @RequirePermission('pos', 'restaurant.orders')
  @Post('restaurant/orders/:id/items/:itemId/cancel')
  cancelItem(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Param('itemId', uuid) itemId: string,
    @Body(new ZodPipe(cancelOrderItemSchema)) body: O<typeof cancelOrderItemSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.orders.cancelItem(actor, id, itemId, body, req.ip);
  }

  @RequirePermission('pos', 'restaurant.orders')
  @Post('restaurant/orders/:id/move')
  move(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(moveOrderSchema)) body: O<typeof moveOrderSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.orders.move(actor, id, body.tableId, body.version, req.ip);
  }

  @RequirePermission('pos', 'restaurant.orders')
  @Post('restaurant/orders/:id/merge')
  merge(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(mergeOrderSchema)) body: O<typeof mergeOrderSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.orders.merge(actor, id, body.sourceOrderId, body.version, req.ip);
  }

  @RequirePermission('pos', 'restaurant.orders')
  @Post('restaurant/orders/:id/cancel')
  @HttpCode(204)
  async cancel(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(orderVersionSchema)) body: O<typeof orderVersionSchema>,
    @Req() req: FastifyRequest,
  ) {
    await this.orders.cancel(actor, id, body.version, req.ip);
  }

  @RequirePermission('pos', 'restaurant.orders')
  @Post('restaurant/orders/:id/quote')
  @HttpCode(200)
  quote(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(quoteOrderSchema)) body: O<typeof quoteOrderSchema>,
  ) {
    return this.orders.quote(actor, id, body);
  }

  @RequirePermission('pos', 'sales.create')
  @Post('restaurant/orders/:id/pay')
  pay(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(payOrderSchema)) body: O<typeof payOrderSchema>,
    @Req() req: FastifyRequest,
  ) {
    return this.orders.pay(actor, id, body, req.ip);
  }

  @RequirePermission('pos', 'kitchen.access')
  @Get('kitchen/tickets')
  board(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(stationQuery)) q: O<typeof stationQuery>,
  ) {
    return this.orders.board(actor, q.stationId ?? null);
  }

  @RequirePermission('pos', 'kitchen.access')
  @Post('kitchen/tickets/:id/status')
  @HttpCode(200)
  ticketStatus(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(ticketStatusSchema)) body: O<typeof ticketStatusSchema>,
  ) {
    return this.orders.setTicketStatus(actor, id, body);
  }
}
