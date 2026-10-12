import {
  type BankAccountOption,
  type CashBranchTransfer,
  type CashDisbursement,
  type CashDisbursementList,
  type CashTransfer,
  type SupplierOptions,
  type SupplierPayments,
  cancelCashBranchTransferSchema,
  cashBranchTransferQuerySchema,
  cashDisbursementQuerySchema,
  createBankDepositSchema,
  createCashBranchTransferSchema,
  createCashDisbursementSchema,
  receiveCashBranchTransferSchema,
  reverseCashDisbursementSchema,
} from '@arabat/contracts';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { CashPayoutsService } from './cash-payouts.service.js';

const uuid = new ParseUUIDPipe();

/**
 * Manager: expenses, supplier payments, bank deposits and branch-to-branch cash transfers
 * (ADR-0091). Branch-level checks happen in the service.
 */
@Controller('manager')
export class CashPayoutsController {
  constructor(private readonly payouts: CashPayoutsService) {}

  @RequirePermission('manager', 'cash.custody')
  @Get('cash/disbursements')
  disbursements(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(cashDisbursementQuerySchema))
    query: z.output<typeof cashDisbursementQuerySchema>,
  ): Promise<CashDisbursementList> {
    return this.payouts.listDisbursements(actor, query);
  }

  @RequirePermission('manager', 'cash.custody')
  @Post('cash/disbursements')
  disburse(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(createCashDisbursementSchema))
    body: z.output<typeof createCashDisbursementSchema>,
    @Req() req: FastifyRequest,
  ): Promise<CashDisbursement> {
    return this.payouts.createDisbursement(actor, body, req.ip);
  }

  @RequirePermission('manager', 'cash.custody')
  @Post('cash/disbursements/:id/reverse')
  reverse(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(reverseCashDisbursementSchema))
    body: z.output<typeof reverseCashDisbursementSchema>,
    @Req() req: FastifyRequest,
  ): Promise<CashDisbursement> {
    return this.payouts.reverseDisbursement(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'cash.custody')
  @Get('cash/suppliers')
  suppliers(@CurrentMerchantActor() actor: MerchantActor): Promise<SupplierOptions> {
    return this.payouts.supplierOptions(actor);
  }

  @RequirePermission('manager', 'cash.custody')
  @Get('cash/suppliers/:id/orders')
  orders(@CurrentMerchantActor() actor: MerchantActor, @Param('id', uuid) id: string) {
    return this.payouts.payableOrders(actor, id);
  }

  @RequirePermission('manager', 'cash.deposit')
  @Get('cash/bank-accounts')
  bankAccounts(
    @CurrentMerchantActor() actor: MerchantActor,
  ): Promise<{ accounts: BankAccountOption[] }> {
    return this.payouts.bankAccounts(actor);
  }

  @RequirePermission('manager', 'cash.deposit')
  @Post('cash/deposits')
  deposit(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(createBankDepositSchema)) body: z.output<typeof createBankDepositSchema>,
    @Req() req: FastifyRequest,
  ): Promise<CashTransfer> {
    return this.payouts.deposit(actor, body, req.ip);
  }

  @RequirePermission('manager', 'cash.custody')
  @Get('cash/branch-transfers')
  branchTransfers(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(cashBranchTransferQuerySchema))
    query: z.output<typeof cashBranchTransferQuerySchema>,
  ) {
    return this.payouts.listBranchTransfers(actor, query);
  }

  @RequirePermission('manager', 'cash.custody')
  @Post('cash/branch-transfers')
  send(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(createCashBranchTransferSchema))
    body: z.output<typeof createCashBranchTransferSchema>,
    @Req() req: FastifyRequest,
  ): Promise<CashBranchTransfer> {
    return this.payouts.sendBranchTransfer(actor, body, req.ip);
  }

  @RequirePermission('manager', 'cash.custody')
  @Post('cash/branch-transfers/:id/receive')
  receive(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(receiveCashBranchTransferSchema))
    body: z.output<typeof receiveCashBranchTransferSchema>,
    @Req() req: FastifyRequest,
  ): Promise<CashBranchTransfer> {
    return this.payouts.receiveBranchTransfer(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'cash.custody')
  @Post('cash/branch-transfers/:id/cancel')
  cancel(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(cancelCashBranchTransferSchema))
    body: z.output<typeof cancelCashBranchTransferSchema>,
    @Req() req: FastifyRequest,
  ): Promise<CashBranchTransfer> {
    return this.payouts.cancelBranchTransfer(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'purchasing.read')
  @Get('suppliers/:id/payments')
  supplierPayments(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
  ): Promise<SupplierPayments> {
    return this.payouts.supplierPayments(actor, id);
  }
}

/** POS pickers for cash out: bank accounts (deposits) and suppliers (supplier payments). */
@Controller('pos/cash')
export class PosCashController {
  constructor(private readonly payouts: CashPayoutsService) {}

  @RequirePermission('pos', 'cash.deposit')
  @Get('bank-accounts')
  bankAccounts(
    @CurrentMerchantActor() actor: MerchantActor,
  ): Promise<{ accounts: BankAccountOption[] }> {
    return this.payouts.posBankAccounts(actor);
  }

  @RequirePermission('pos', 'cash.move')
  @Get('suppliers')
  suppliers(@CurrentMerchantActor() actor: MerchantActor): Promise<SupplierOptions> {
    return this.payouts.posSuppliers(actor);
  }
}
