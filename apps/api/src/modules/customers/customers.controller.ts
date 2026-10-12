import {
  type Customer,
  type CustomerNote,
  type PosCustomer,
  addCustomerNoteSchema,
  createCustomerSchema,
  customerListQuerySchema,
  posCustomerSearchSchema,
  saleListQuerySchema,
  saveCustomerSchema,
} from '@arabat/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { CustomersService } from './customers.service.js';

const uuid = new ParseUUIDPipe();
const historyQuerySchema = saleListQuerySchema.pick({ page: true, pageSize: true });

@Controller('manager/customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @RequirePermission('manager', 'customers.read')
  @Get()
  list(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(customerListQuerySchema)) query: z.output<typeof customerListQuerySchema>,
  ) {
    return this.customers.list(actor, query);
  }

  @RequirePermission('manager', 'customers.read')
  @Get(':id')
  get(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
  ): Promise<Customer> {
    return this.customers.get(actor, id);
  }

  @RequirePermission('manager', 'customers.create')
  @Post()
  async create(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveCustomerSchema)) body: z.output<typeof saveCustomerSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Customer> {
    const id = await this.customers.create(actor, body, req.ip, null);
    return this.customers.get(actor, id);
  }

  @RequirePermission('manager', 'customers.manage')
  @Patch(':id')
  async update(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(saveCustomerSchema)) body: z.output<typeof saveCustomerSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Customer> {
    await this.customers.update(actor, id, body, req.ip);
    return this.customers.get(actor, id);
  }

  @RequirePermission('manager', 'customers.read')
  @Get(':id/sales')
  sales(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Query(new ZodPipe(historyQuerySchema)) query: z.output<typeof historyQuerySchema>,
  ) {
    return this.customers.salesHistory(actor, id, query.page, query.pageSize);
  }

  @RequirePermission('manager', 'customers.read')
  @Get(':id/refunds')
  refunds(@CurrentMerchantActor() actor: MerchantActor, @Param('id', uuid) id: string) {
    return this.customers.refunds(actor, id);
  }

  @RequirePermission('manager', 'customers.read')
  @Get(':id/notes')
  async notes(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
  ): Promise<{ notes: CustomerNote[] }> {
    return { notes: await this.customers.notes(actor, id) };
  }

  @RequirePermission('manager', 'customers.manage')
  @Post(':id/notes')
  @HttpCode(201)
  async addNote(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(addCustomerNoteSchema)) body: z.output<typeof addCustomerNoteSchema>,
    @Req() req: FastifyRequest,
  ): Promise<{ notes: CustomerNote[] }> {
    await this.customers.addNote(actor, id, body.body, req.ip);
    return { notes: await this.customers.notes(actor, id) };
  }
}

@Controller('pos/customers')
export class PosCustomersController {
  constructor(private readonly customers: CustomersService) {}

  @RequirePermission('pos', 'customers.read')
  @Get()
  async search(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(posCustomerSearchSchema)) query: z.output<typeof posCustomerSearchSchema>,
  ): Promise<{ customers: PosCustomer[] }> {
    return { customers: await this.customers.posSearch(actor, query.q) };
  }

  @RequirePermission('pos', 'customers.create')
  @Post()
  create(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(createCustomerSchema)) body: z.output<typeof createCustomerSchema>,
    @Req() req: FastifyRequest,
  ): Promise<PosCustomer> {
    return this.customers.posCreate(actor, body, req.ip);
  }
}
