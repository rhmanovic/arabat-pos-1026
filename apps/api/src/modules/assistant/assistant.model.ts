import Anthropic from '@anthropic-ai/sdk';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { AppError } from '../../kernel/errors/app-error.js';

/** One model turn: what the service decides; the provider adds model, retries and fallbacks. */
export type AssistantRequest = Omit<
  Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
  'model' | 'betas' | 'fallbacks' | 'stream'
>;

/**
 * Boundary to the language-model provider (ADR-0107). Tests replace it with a scripted
 * double; the real one is off until `ANTHROPIC_API_KEY` is configured (no cost by default).
 */
export abstract class AssistantModel {
  abstract readonly enabled: boolean;
  /** The configured model id (the response names the model that actually served). */
  abstract readonly modelId: string;
  abstract complete(request: AssistantRequest): Promise<Anthropic.Beta.BetaMessage>;
}

@Injectable()
export class AnthropicAssistantModel extends AssistantModel {
  private readonly logger = new Logger(AnthropicAssistantModel.name);
  private readonly client: Anthropic | null;
  readonly enabled: boolean;
  readonly modelId: string;

  constructor(@Inject(ENV) private readonly env: Env) {
    super();
    this.enabled = env.ANTHROPIC_API_KEY !== undefined;
    this.modelId = env.ASSISTANT_MODEL;
    // 60 s covers a few tool rounds on a slow day; one retry on transient failures.
    this.client = this.enabled
      ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 })
      : null;
  }

  async complete(request: AssistantRequest): Promise<Anthropic.Beta.BetaMessage> {
    if (!this.client) throw assistantDisabled();
    try {
      // Server-side fallback: a policy decline on the requested model is retried on the
      // provider's default substitute inside the same call (billed at that model's rate).
      return await this.client.beta.messages.create({
        ...request,
        model: this.env.ASSISTANT_MODEL,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        this.logger.error('The assistant API key was rejected by the provider.');
        throw AppError.unavailable('The assistant is not available right now.');
      }
      if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.APIError) {
        this.logger.warn(`Assistant provider error ${error.status ?? ''}: ${error.message}`);
        throw AppError.unavailable('The assistant is not available right now.');
      }
      if (error instanceof Anthropic.APIConnectionError) {
        this.logger.warn(`Assistant provider unreachable: ${error.message}`);
        throw AppError.unavailable('The assistant is not available right now.');
      }
      throw error;
    }
  }
}

export function assistantDisabled(): AppError {
  return new AppError(
    503,
    'ASSISTANT_DISABLED',
    'The assistant is not enabled for this installation.',
  );
}
