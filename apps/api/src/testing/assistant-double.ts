import type Anthropic from '@anthropic-ai/sdk';
import {
  AssistantModel,
  type AssistantRequest,
  assistantDisabled,
} from '../modules/assistant/assistant.model.js';

/** Test double at the model boundary: answers from a script and records every request. */
export class ScriptedAssistantModel extends AssistantModel {
  enabled = true;
  readonly requests: AssistantRequest[] = [];
  private readonly script: Anthropic.Beta.BetaMessage[] = [];

  /** Forgets the queued answers and the recorded requests. */
  reset(): void {
    this.enabled = true;
    this.script.length = 0;
    this.requests.length = 0;
  }

  /** Queues the next answers in order. */
  reply(...messages: Anthropic.Beta.BetaMessage[]): void {
    this.script.push(...messages);
  }

  complete(request: AssistantRequest): Promise<Anthropic.Beta.BetaMessage> {
    if (!this.enabled) return Promise.reject(assistantDisabled());
    this.requests.push(request);
    const next = this.script.shift();
    if (!next) return Promise.reject(new Error('ScriptedAssistantModel: no answer scripted'));
    return Promise.resolve(next);
  }
}

/** A plain text answer. */
export function textTurn(text: string, stop: Anthropic.Beta.BetaStopReason = 'end_turn') {
  return turn([{ type: 'text', text, citations: null }], stop);
}

/** A lookup request from the model. */
export function toolTurn(id: string, name: string, input: Record<string, unknown>) {
  return turn([{ type: 'tool_use', id, name, input }], 'tool_use');
}

export function turn(
  content: Anthropic.Beta.BetaContentBlock[],
  stop: Anthropic.Beta.BetaStopReason,
): Anthropic.Beta.BetaMessage {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    type: 'message',
    role: 'assistant',
    model: 'scripted',
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
    } as Anthropic.Beta.BetaUsage,
  } as Anthropic.Beta.BetaMessage;
}
