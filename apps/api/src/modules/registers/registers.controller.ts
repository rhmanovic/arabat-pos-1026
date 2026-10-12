import {
  type DiscrepancyReport,
  type Register,
  type Shift,
  closeShiftSchema,
  discrepancyReportQuerySchema,
  forceCloseShiftSchema,
  openShiftSchema,
  recordCashMovementSchema,
  registerStatusSchema,
  saveRegisterSchema,
  shiftListQuerySchema,
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
import { z } from 'zod';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { ShiftsService } from './shifts.service.js';

const uuid = new ParseUUIDPipe();
const branchQuery = z.object({ branchId: z.uuid().optional() });

/** Manager: register configuration, shift monitoring and discrepancy reporting. */
@Controller('manager')
export class RegistersController {
  constructor(private readonly shifts: ShiftsService) {}

  @RequirePermission('manager', 'registers.manage')
  @Get('registers')
  async list(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(branchQuery)) query: z.output<typeof branchQuery>,
  ): Promise<{ registers: Register[] }> {
    return { registers: await this.shifts.listRegisters(actor, query.branchId) };
  }

  @RequirePermission('manager', 'registers.manage')
  @Post('registers')
  create(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(saveRegisterSchema)) body: z.output<typeof saveRegisterSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Register> {
    return this.shifts.saveRegister(actor, null, body, req.ip);
  }

  @RequirePermission('manager', 'registers.manage')
  @Patch('registers/:id')
  update(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(saveRegisterSchema)) body: z.output<typeof saveRegisterSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Register> {
    return this.shifts.saveRegister(actor, id, body, req.ip);
  }

  @RequirePermission('manager', 'registers.manage')
  @Post('registers/:id/status')
  status(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(registerStatusSchema)) body: z.output<typeof registerStatusSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Register> {
    return this.shifts.setRegisterStatus(actor, id, body.status, req.ip);
  }

  @RequirePermission('manager', 'shifts.view_all')
  @Get('shifts')
  shiftsList(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(shiftListQuerySchema)) query: z.output<typeof shiftListQuerySchema>,
  ) {
    return this.shifts.listShifts(actor, query);
  }

  @RequirePermission('manager', 'shifts.view_all')
  @Get('shifts/discrepancies')
  report(
    @CurrentMerchantActor() actor: MerchantActor,
    @Query(new ZodPipe(discrepancyReportQuerySchema))
    query: z.output<typeof discrepancyReportQuerySchema>,
  ): Promise<DiscrepancyReport> {
    return this.shifts.discrepancyReport(actor, query);
  }

  @RequirePermission('manager', 'shifts.view_all')
  @Get('shifts/:id')
  shift(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
  ): Promise<Shift> {
    return this.shifts.getShift(actor, id);
  }

  @RequirePermission('manager', 'registers.manage')
  @Post('shifts/:id/force-close')
  forceClose(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(forceCloseShiftSchema)) body: z.output<typeof forceCloseShiftSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Shift> {
    return this.shifts.forceClose(actor, id, body, req.ip);
  }
}

/** POS: the cashier's own shift at the session's branch. */
@Controller('pos')
export class PosShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @RequirePermission('pos', 'shifts.operate')
  @Get('registers')
  async registers(@CurrentMerchantActor() actor: MerchantActor) {
    return { registers: await this.shifts.posRegisters(actor) };
  }

  @RequirePermission('pos', 'shifts.operate')
  @Get('shifts/current')
  async current(@CurrentMerchantActor() actor: MerchantActor): Promise<{ shift: Shift | null }> {
    return { shift: await this.shifts.currentShift(actor) };
  }

  @RequirePermission('pos', 'shifts.operate')
  @Post('shifts')
  open(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(openShiftSchema)) body: z.output<typeof openShiftSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Shift> {
    return this.shifts.openShift(actor, body, req.ip);
  }

  @RequirePermission('pos', 'cash.move')
  @Post('shifts/current/cash-movements')
  cash(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(recordCashMovementSchema)) body: z.output<typeof recordCashMovementSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Shift> {
    return this.shifts.recordCashMovement(actor, body, req.ip);
  }

  @RequirePermission('pos', 'shifts.operate')
  @Post('shifts/current/close')
  close(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(closeShiftSchema)) body: z.output<typeof closeShiftSchema>,
    @Req() req: FastifyRequest,
  ): Promise<Shift> {
    return this.shifts.closeOwnShift(actor, body, req.ip);
  }
}
