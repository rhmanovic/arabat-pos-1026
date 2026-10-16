import {
  type AssistantConversation,
  type AssistantConversationList,
  type AssistantReply,
  type AssistantStatus,
  type AssistantUsage,
  assistantChatSchema,
  assistantUsageQuerySchema,
} from '@arabat/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { RequirePermission, RequirePlatformRole } from '../../kernel/access/access.decorators.js';
import { CurrentMerchantActor, CurrentPlatformActor } from '../../kernel/access/current-actor.js';
import type { MerchantActor, PlatformActor } from '../../kernel/access/session-resolver.js';
import { ZodPipe } from '../../kernel/validation/zod.pipe.js';
import { AssistantHistoryService } from './assistant-history.service.js';
import { AssistantUsageService } from './assistant-usage.service.js';
import { AssistantService } from './assistant.service.js';

type ChatBody = z.output<typeof assistantChatSchema>;
const uuid = new ParseUUIDPipe();

/** The chat helper on the cashier screen (ADR-0107): read-only, bound to the session branch. */
@Controller('pos/assistant')
export class PosAssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly history: AssistantHistoryService,
  ) {}

  /** The cashier's own past conversations on the register (no tokens, no cost). */
  @RequirePermission('pos', 'pos.access')
  @Get('conversations')
  conversations(@CurrentMerchantActor() actor: MerchantActor): Promise<AssistantConversationList> {
    return this.history.conversations(actor, 'pos');
  }

  @RequirePermission('pos', 'pos.access')
  @Get('conversations/:id')
  conversation(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
  ): Promise<AssistantConversation> {
    return this.history.conversation(actor, 'pos', id);
  }

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
    @Body(new ZodPipe(assistantChatSchema)) body: ChatBody,
  ): Promise<AssistantReply> {
    return this.assistant.chat(actor, body, 'pos');
  }
}

/** The same helper in the management app: read-only, scoped to the selected branch. */
@Controller('manager/assistant')
export class ManagerAssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly history: AssistantHistoryService,
  ) {}

  /** The user's own past conversations in the management app (no tokens, no cost). */
  @RequirePermission('manager', 'manager.access')
  @Get('conversations')
  conversations(@CurrentMerchantActor() actor: MerchantActor): Promise<AssistantConversationList> {
    return this.history.conversations(actor, 'manager');
  }

  @RequirePermission('manager', 'manager.access')
  @Get('conversations/:id')
  conversation(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('id', uuid) id: string,
  ): Promise<AssistantConversation> {
    return this.history.conversation(actor, 'manager', id);
  }

  @RequirePermission('manager', 'manager.access')
  @Get()
  status(): AssistantStatus {
    return this.assistant.status();
  }

  @RequirePermission('manager', 'manager.access')
  @Post('chat')
  @HttpCode(200)
  chat(
    @CurrentMerchantActor() actor: MerchantActor,
    @Body(new ZodPipe(assistantChatSchema)) body: ChatBody,
  ): Promise<AssistantReply> {
    return this.assistant.chat(actor, body, 'manager');
  }
}

/**
 * The platform's record of every question (ADR-0107 amendment): the system owner alone
 * reads conversations, tokens and cost, for monitoring, abuse detection and training.
 */
@Controller('platform/assistant')
export class PlatformAssistantController {
  constructor(private readonly usage: AssistantUsageService) {}

  @RequirePlatformRole('platform.super_admin')
  @Get()
  list(
    @CurrentPlatformActor() actor: PlatformActor,
    @Query(new ZodPipe(assistantUsageQuerySchema)) q: z.output<typeof assistantUsageQuerySchema>,
  ): Promise<AssistantUsage> {
    return this.usage.usage(actor, q);
  }

  @RequirePlatformRole('platform.super_admin')
  @Get('export')
  async export(
    @CurrentPlatformActor() actor: PlatformActor,
    @Query(new ZodPipe(assistantUsageQuerySchema)) q: z.output<typeof assistantUsageQuerySchema>,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const body = await this.usage.exportJsonl(actor, q);
    const stamp = new Date().toISOString().slice(0, 10);
    await reply
      .header('content-type', 'application/x-ndjson; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="assistant-conversations-${stamp}.jsonl"`,
      )
      .header('cache-control', 'private, no-store')
      .send(body);
  }
}
