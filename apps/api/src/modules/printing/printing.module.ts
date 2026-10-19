import { Module } from '@nestjs/common';
import { PrintAgentGateway } from './print-agent.gateway.js';
import {
  PosPrintController,
  PrintAgentController,
  PrintingController,
} from './printing.controller.js';
import { PrintJobsService } from './print-jobs.service.js';

/** Server-side receipt printing: print agents, the job queue and the agent push (ADR-0111). */
@Module({
  controllers: [PrintingController, PrintAgentController, PosPrintController],
  providers: [PrintJobsService, PrintAgentGateway],
  exports: [PrintJobsService],
})
export class PrintingModule {}
