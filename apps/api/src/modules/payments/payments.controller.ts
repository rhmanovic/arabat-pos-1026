import {
  type FinancialAccount,
  type PaymentMethod,
  saveFinancialAccountSchema,
  savePaymentMethodSchema,
} from '@arabat/contracts';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { PaymentsService } from './payments.service.js';

const uuid = new ParseUUIDPipe();

@Controller('manager')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @RequirePermission('manager', 'payments.settings')
  @Get('payment-methods')
  async methods(
    @CurrentMerchantActor() actor: MerchantActor,
  ): Promise<{ methods: PaymentMethod[] }> {
    return { methods: await this.payments.listMethods(actor) };
  }

  @RequirePermission('manager', 'payments.settings')
  @Post('payment-methods')
  create(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(savePaymentMethodSchema)) body: z.output<typeof savePaymentMethodSchema>,
    @Req() req: FastifyRequest,
  ): Promise<PaymentMethod> {
    return this.payments.saveMethod(actor, null, body, req.ip);
  }

  @RequirePermission('manager', 'payments.settings')
  @Patch('payment-methods/:id')
  update(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(savePaymentMethodSchema)) body: z.output<typeof savePaymentMethodSchema>,
    @Req() req: FastifyRequest,
  ): Promise<PaymentMethod> {
    return this.payments.saveMethod(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'payments.settings')
  @Get('financial-accounts')
  async accounts(
    @CurrentMerchantActor() actor: MerchantActor,
  ): Promise<{ accounts: FinancialAccount[] }> {
    return { accounts: await this.payments.listAccounts(actor) };
  }

  @RequirePermission('manager', 'payments.settings')
  @Post('financial-accounts')
  createAccount(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveFinancialAccountSchema))
    body: z.output<typeof saveFinancialAccountSchema>,
    @Req() req: FastifyRequest,
  ): Promise<FinancialAccount> {
    return this.payments.saveAccount(actor, null, body, req.ip);
  }

  @RequirePermission('manager', 'payments.settings')
  @Patch('financial-accounts/:id')
  updateAccount(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(saveFinancialAccountSchema))
    body: z.output<typeof saveFinancialAccountSchema>,
    @Req() req: FastifyRequest,
  ): Promise<FinancialAccount> {
    return this.payments.saveAccount(actor, id, body, req.ip);
  }
}

@Controller('pos/payment-methods')
export class PosPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @RequirePermission('pos', 'sales.create')
  @Get()
  async list(@CurrentMerchantActor() actor: MerchantActor) {
    return { methods: await this.payments.posMethods(actor) };
  }
}
