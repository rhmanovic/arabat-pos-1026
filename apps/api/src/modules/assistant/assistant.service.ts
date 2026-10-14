import type Anthropic from '@anthropic-ai/sdk';
import type { AssistantReply, AssistantStatus, assistantChatSchema } from '@arabat/contracts';
import { Money } from '@arabat/money';
import { PERMISSIONS, type PermissionKey, can } from '@arabat/permissions';
import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { DatabaseService } from '../../database/database.service.js';
import type { MerchantActor } from '../../kernel/access/session-resolver.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { merchantTimezone } from '../../kernel/time/period.js';
import { type RateLimit, RateLimiterService } from '../auth/rate-limiter.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { ShiftsService } from '../registers/shifts.service.js';
import { SalesService } from '../sales/sales.service.js';
import { AssistantModel, assistantDisabled } from './assistant.model.js';
import {
  ASSISTANT_TOOLS,
  POS_GUIDE,
  type PromptContext,
  contextBlock,
  fallbackReply,
  textOf,
  toMessageParams,
} from './assistant.prompt.js';

type ChatInput = z.output<typeof assistantChatSchema>;

/** Lookups per cashier: enough for a busy shift, a brake on runaway cost. */
export const ASSISTANT_LIMIT: RateLimit = { limit: 60, windowSeconds: 600 };
/** Tool rounds per answer: a question needs one or two lookups, never a crawl. */
const MAX_TOOL_ROUNDS = 4;
const MAX_OUTPUT_TOKENS = 1024;
const MAX_MATCHES = 10;
const searchInput = z.object({ query: z.string().trim().min(1).max(100) });

interface ToolOutcome {
  content: string;
  isError: boolean;
}

/**
 * Chat helper on the cashier screen (ADR-0105). Stateless: the browser sends the whole
 * conversation; every lookup runs as the cashier (same rights, same branch, same RLS).
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly model: AssistantModel,
    private readonly database: DatabaseService,
    private readonly limiter: RateLimiterService,
    private readonly catalog: CatalogService,
    private readonly inventory: InventoryService,
    private readonly sales: SalesService,
    private readonly shifts: ShiftsService,
  ) {}

  status(): AssistantStatus {
    return { enabled: this.model.enabled };
  }

  async chat(actor: MerchantActor, input: ChatInput): Promise<AssistantReply> {
    if (!this.model.enabled) throw assistantDisabled();
    const branchId = actor.boundBranchId;
    if (!branchId) throw AppError.forbidden();
    await this.limiter.consume(`assistant:user:${actor.userId}`, ASSISTANT_LIMIT);

    const context = await this.context(actor, branchId, input);
    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: 'text', text: POS_GUIDE, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: contextBlock(context) },
    ];
    const messages = toMessageParams(input.messages);
    const toolsUsed: string[] = [];
    let reply = '';

    for (let round = 0; ; round += 1) {
      const response = await this.model.complete({
        // An answer is a few hundred tokens; the cap bounds a runaway turn (live trial: one
        // turn repeated a tool-call tag until the limit).
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        // A copy per turn: the provider (and the test double) keep what they were sent.
        messages: [...messages],
        tools: ASSISTANT_TOOLS,
        // Chat answers are short; low effort keeps the till responsive.
        output_config: { effort: 'low' },
      });
      // One line per model turn: the cost record (scripts/ops/assistant-trial.mjs sums it).
      const usage = response.usage;
      this.logger.log(
        `assistant turn: ${usage.input_tokens} in / ${usage.output_tokens} out, cache write ${usage.cache_creation_input_tokens ?? 0} / read ${usage.cache_read_input_tokens ?? 0}, stop ${response.stop_reason}`,
      );
      if (response.stop_reason === 'refusal') {
        reply = fallbackReply(input.language);
        break;
      }
      const calls = response.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
      );
      if (response.stop_reason === 'max_tokens' && calls.length === 0) {
        // The turn ran out before an answer: its text is a fragment, never shown.
        this.logger.warn('assistant turn hit the output limit without an answer');
        reply = fallbackReply(input.language);
        break;
      }
      reply = textOf(response) || reply;
      if (response.stop_reason !== 'tool_use' || calls.length === 0 || round >= MAX_TOOL_ROUNDS)
        break;
      messages.push({ role: 'assistant', content: response.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const call of calls) {
        const outcome = await this.runTool(actor, branchId, call);
        if (!toolsUsed.includes(call.name)) toolsUsed.push(call.name);
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: outcome.content,
          is_error: outcome.isError,
        });
      }
      messages.push({ role: 'user', content: results });
    }
    return { reply: reply || fallbackReply(input.language), toolsUsed };
  }

  // ------------------------------------------------------------ context
  private async context(
    actor: MerchantActor,
    branchId: string,
    input: ChatInput,
  ): Promise<PromptContext> {
    const names = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [m] = (
        await tx.execute(
          sql`select display_name_en, display_name_ar from merchants where id = ${actor.merchantId}`,
        )
      ).rows as { display_name_en: string | null; display_name_ar: string | null }[];
      const [b] = (
        await tx.execute(sql`select name_en, name_ar from branches where id = ${branchId}`)
      ).rows as { name_en: string | null; name_ar: string | null }[];
      const [u] = (await tx.execute(sql`select full_name from users where id = ${actor.userId}`))
        .rows as { full_name: string }[];
      const tz = await merchantTimezone(tx, actor.merchantId);
      return {
        merchant: pick(input.language, m?.display_name_ar, m?.display_name_en),
        branch: pick(input.language, b?.name_ar, b?.name_en),
        cashier: u?.full_name ?? '',
        tz,
      };
    });
    const permissions = (Object.keys(PERMISSIONS) as PermissionKey[]).filter((p) =>
      can(actor.access, p, branchId),
    );
    const shift = can(actor.access, 'shifts.operate', branchId)
      ? await this.shifts.currentShift(actor)
      : null;
    const clock = new Intl.DateTimeFormat('en-GB', {
      timeZone: names.tz,
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    return {
      language: input.language,
      merchantName: names.merchant,
      branchName: names.branch,
      cashierName: names.cashier,
      permissions,
      shift: shift
        ? {
            register: pick(input.language, shift.registerName.nameAr, shift.registerName.nameEn),
            openedAt: clock.format(new Date(shift.openedAt)),
          }
        : null,
      cart: input.cart,
      now: clock.format(new Date()),
    };
  }

  // ------------------------------------------------------------ tools
  private async runTool(
    actor: MerchantActor,
    branchId: string,
    call: Anthropic.Beta.BetaToolUseBlock,
  ): Promise<ToolOutcome> {
    try {
      switch (call.name) {
        case 'search_products':
          return await this.searchProducts(actor, branchId, call.input);
        case 'recent_sales':
          return await this.recentSales(actor, branchId);
        case 'shift_summary':
          return await this.shiftSummary(actor, branchId);
        default:
          return { content: `Unknown lookup "${call.name}".`, isError: true };
      }
    } catch (error) {
      if (error instanceof AppError) return { content: error.message, isError: true };
      this.logger.error(`assistant lookup ${call.name} failed`, error);
      return { content: 'The lookup failed.', isError: true };
    }
  }

  private async searchProducts(
    actor: MerchantActor,
    branchId: string,
    raw: unknown,
  ): Promise<ToolOutcome> {
    const parsed = searchInput.safeParse(raw);
    if (!parsed.success) return { content: 'A search term is required.', isError: true };
    const term = parsed.data.query.toLowerCase();
    const catalog = await this.catalog.posCatalog(actor);
    const categories = new Map(catalog.categories.map((c) => [c.id, c]));
    const matches = catalog.items
      .filter(
        (i) =>
          (i.nameEn ?? '').toLowerCase().includes(term) ||
          (i.nameAr ?? '').includes(parsed.data.query) ||
          (i.variantNameEn ?? '').toLowerCase().includes(term) ||
          (i.variantNameAr ?? '').includes(parsed.data.query) ||
          (i.sku ?? '').toLowerCase() === term ||
          i.barcodes.some((b) => b.toLowerCase() === term),
      )
      .slice(0, MAX_MATCHES);
    if (matches.length === 0)
      return { content: 'No product at this branch matches the search.', isError: false };
    // Stock needs the same right as the availability endpoint; without it, prices only.
    const tracked = matches.filter((m) => m.trackInventory).map((m) => m.variantId);
    const stock = new Map<string, { onHand: string; status: string }>();
    if (tracked.length > 0 && can(actor.access, 'catalog.read', branchId)) {
      const availability = await this.inventory.posAvailability(actor, tracked);
      for (const a of availability.items) stock.set(a.variantId, a);
    }
    const rows = matches.map((m) => {
      const category = m.categoryId ? categories.get(m.categoryId) : undefined;
      const s = stock.get(m.variantId);
      return {
        name: { en: m.nameEn, ar: m.nameAr },
        variant:
          m.variantNameEn || m.variantNameAr ? { en: m.variantNameEn, ar: m.variantNameAr } : null,
        sku: m.sku,
        barcodes: m.barcodes,
        price: `${m.price.amount} ${m.price.currency}`,
        category: category ? { en: category.nameEn, ar: category.nameAr } : null,
        stock: !m.trackInventory
          ? 'not tracked'
          : s
            ? { onHand: s.onHand, status: s.status }
            : 'not visible to this cashier',
      };
    });
    return { content: JSON.stringify({ matches: rows }), isError: false };
  }

  private async recentSales(actor: MerchantActor, branchId: string): Promise<ToolOutcome> {
    if (!can(actor.access, 'sales.create', branchId))
      return { content: 'The cashier has no right to see sales.', isError: true };
    const sales = await this.sales.recent(actor);
    if (sales.length === 0)
      return { content: 'No sales on the current shift yet.', isError: false };
    const rows = sales.slice(0, MAX_MATCHES).map((s) => ({
      receipt: s.receiptNumber,
      at: s.createdAt,
      total: `${s.total.amount} ${s.total.currency}`,
      items: s.itemCount,
      tenders: s.paymentKinds,
      refunded:
        s.refunded.amount === '0.000' ? null : `${s.refunded.amount} ${s.refunded.currency}`,
      customer: s.customerName,
      flags: s.flags,
    }));
    return { content: JSON.stringify({ sales: rows }), isError: false };
  }

  private async shiftSummary(actor: MerchantActor, branchId: string): Promise<ToolOutcome> {
    if (!can(actor.access, 'shifts.operate', branchId))
      return { content: 'The cashier has no right to operate shifts.', isError: true };
    const shift = await this.shifts.currentShift(actor);
    if (!shift) return { content: 'No shift is open.', isError: false };
    const amount = (m: { amount: string; currency: string }) =>
      `${Money.fromJSON(m as { amount: string; currency: 'KWD' }).toDecimalString()} ${m.currency}`;
    return {
      content: JSON.stringify({
        register: shift.registerName,
        openedAt: shift.openedAt,
        employee: shift.employeeName,
        figures: shift.summary
          ? {
              openingFloat: amount(shift.summary.openingFloat),
              cashSales: amount(shift.summary.cashSales),
              cashRefunds: amount(shift.summary.cashRefunds),
              cashIn: amount(shift.summary.cashIn),
              cashOut: amount(shift.summary.cashOut),
              expectedCash: amount(shift.summary.expectedCash),
            }
          : 'withheld under the blind-count policy: the cashier counts without a target',
        movements: shift.movements.length,
      }),
      isError: false,
    };
  }
}

function pick(language: 'ar' | 'en', ar: string | null | undefined, en: string | null | undefined) {
  return (language === 'ar' ? ar || en : en || ar) ?? '';
}
