import {
  type AgentClaimedJob,
  type AgentPendingJob,
  type CreatedPrintAgent,
  type PrintAgent,
  type PrintJob,
  type PrintSettings,
  type SalePrintStatus,
  agentJobResultSchema,
  createPrintAgentSchema,
  printSettingsSchema,
} from '@arabat/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { RequirePermission, RequirePrintAgent } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor, CurrentPrintAgent } from '../../kernel/access/current-actor.js';
import type { PrintAgent as AgentIdentity } from '../../kernel/access/print-agent-resolver.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { PrintJobsService } from './print-jobs.service.js';

const uuid = new ParseUUIDPipe();

/** Manager: print agents, the auto-print setting and receipt reprints (ADR-0111). */
@Controller('manager')
export class PrintingController {
  constructor(private readonly jobs: PrintJobsService) {}

  @RequirePermission('manager', 'registers.manage')
  @Get('print-agents')
  async list(@CurrentMerchantActor() actor: MerchantActor): Promise<{ agents: PrintAgent[] }> {
    return { agents: await this.jobs.listAgents(actor) };
  }

  @RequirePermission('manager', 'registers.manage')
  @Post('print-agents')
  create(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(createPrintAgentSchema)) body: z.output<typeof createPrintAgentSchema>,
    @Req() req: FastifyRequest,
  ): Promise<CreatedPrintAgent> {
    return this.jobs.createAgent(actor, body, req.ip);
  }

  @RequirePermission('manager', 'registers.manage')
  @Delete('print-agents/:id')
  @HttpCode(204)
  async remove(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.jobs.deleteAgent(actor, id, req.ip);
  }

  @RequirePermission('manager', 'merchant.settings.read')
  @Get('print-settings')
  settings(@CurrentMerchantActor() actor: MerchantActor): Promise<PrintSettings> {
    return this.jobs.settings(actor);
  }

  @RequirePermission('manager', 'merchant.settings.update')
  @Put('print-settings')
  updateSettings(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(printSettingsSchema)) body: PrintSettings,
    @Req() req: FastifyRequest,
  ): Promise<PrintSettings> {
    return this.jobs.updateSettings(actor, body, req.ip);
  }

  @RequirePermission('manager', 'sales.read')
  @Post('sales/:id/print')
  reprint(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
    @Req() req: FastifyRequest,
  ): Promise<PrintJob> {
    return this.jobs.reprint(actor, id, req.ip);
  }
}

/** The browser POS follows its receipt until it is printed (Plan A). */
@Controller('pos')
export class PosPrintController {
  constructor(private readonly jobs: PrintJobsService) {}

  @RequirePermission('pos', 'sales.create')
  @Get('sales/:id/print-status')
  status(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
  ): Promise<SalePrintStatus> {
    return this.jobs.saleStatus(actor, id);
  }
}

/** The print agent's API (bearer token). Every call stamps the agent's last-seen time. */
@Controller('print-agent')
export class PrintAgentController {
  constructor(private readonly jobs: PrintJobsService) {}

  @RequirePrintAgent()
  @Get('jobs/pending')
  pending(@CurrentPrintAgent() agent: AgentIdentity): Promise<AgentPendingJob[]> {
    return this.jobs.pending(agent);
  }

  @RequirePrintAgent()
  @Post('jobs/:id/claim')
  @HttpCode(200)
  claim(
    @CurrentPrintAgent() agent: AgentIdentity,
    @Param('id', uuid) id: string,
  ): Promise<AgentClaimedJob> {
    return this.jobs.claim(agent, id);
  }

  @RequirePrintAgent()
  @Post('jobs/:id/result')
  @HttpCode(200)
  result(
    @CurrentPrintAgent() agent: AgentIdentity,
    @Param('id', uuid) id: string,
    @Body(new ZodPipe(agentJobResultSchema)) body: z.output<typeof agentJobResultSchema>,
  ): Promise<{ id: string; status: 'printed' | 'failed' }> {
    return this.jobs.result(agent, id, body);
  }
}
