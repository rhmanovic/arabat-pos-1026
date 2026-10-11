import {
  type BranchDetail,
  branchStatusSchema,
  createBranchSchema,
  updateBranchSchema,
} from '@arabat/contracts';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { BranchesService } from './branches.service.js';

@Controller('manager/branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @RequirePermission('manager', 'branches.read')
  @Get()
  async list(@CurrentMerchantActor() actor: MerchantActor): Promise<{ branches: BranchDetail[] }> {
    return { branches: await this.branches.list(actor) };
  }

  @RequirePermission('manager', 'branches.manage')
  @Post()
  create(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(createBranchSchema)) body: z.output<typeof createBranchSchema>,
    @Req() req: FastifyRequest,
  ): Promise<BranchDetail> {
    return this.branches.create(actor, body, req.ip);
  }

  @RequirePermission('manager', 'branches.read')
  @Get(':branchId')
  get(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ): Promise<BranchDetail> {
    return this.branches.get(actor, branchId);
  }

  @RequirePermission('manager', 'branches.update')
  @Patch(':branchId')
  update(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body(new ZodPipe(updateBranchSchema)) body: z.output<typeof updateBranchSchema>,
    @Req() req: FastifyRequest,
  ): Promise<BranchDetail> {
    return this.branches.update(actor, branchId, body, req.ip);
  }

  @RequirePermission('manager', 'branches.manage')
  @Post(':branchId/status')
  setStatus(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body(new ZodPipe(branchStatusSchema)) body: z.output<typeof branchStatusSchema>,
    @Req() req: FastifyRequest,
  ): Promise<BranchDetail> {
    return this.branches.setStatus(actor, branchId, body.status, req.ip);
  }
}
