import { type AssistantReply, type AssistantStatus, assistantChatSchema } from '@arabat/contracts';
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import type { z } from 'zod';
import { RequirePermission } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { AssistantService } from './assistant.service.js';

/** The chat helper on the cashier screen (ADR-0105): read-only, bound to the session branch. */
@Controller('pos/assistant')
export class PosAssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @RequirePermission('pos', 'pos.access')
  @Get()
  status(): AssistantStatus {
    return this.assistant.status();
  }

  @RequirePermission('pos', 'pos.access')
  @Post('chat')
  @HttpCode(200)
  chat(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(assistantChatSchema)) body: z.output<typeof assistantChatSchema>,
  ): Promise<AssistantReply> {
    return this.assistant.chat(actor, body);
  }
}
