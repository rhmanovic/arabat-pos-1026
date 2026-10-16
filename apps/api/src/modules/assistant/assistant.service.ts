import type Anthropic from '@anthropic-ai/sdk';
import type { AssistantReply, AssistantStatus, assistantChatSchema } from '@arabat/contracts';
import { Money } from '@arabat/money';
import {
  PERMISSIONS,
  type PermissionKey,
  can,
  canAnywhere,
  permissionBranchScope,
} from '@arabat/permissions';
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
import { PaymentsService } from '../payments/payments.service.js';
import { ShiftsService } from '../registers/shifts.service.js';
import { ReportsService } from '../reports/reports.service.js';
import { SalesService } from '../sales/sales.service.js';
import { newId } from '../../kernel/ids.js';
import { AssistantModel, assistantDisabled } from './assistant.model.js';
import { type TokenUsage, estimateCostMicroUsd } from './assistant.pricing.js';
import { assistantRequests } from './assistant.schema.js';
import {
  ASSISTANT_TOOLS,
  type AssistantSurface,
  MANAGER_GUIDE,
  MANAGER_TOOLS,
  POS_GUIDE,
  type PromptContext,
  contextBlock,
  fallbackReply,
  textOf,
  toMessageParams,
} from './assistant.prompt.js';

type ChatInput = z.output<typeof assistantChatSchema>;

/** Lookups per user: enough for a busy shift, a brake on runaway cost. */
export const ASSISTANT_LIMIT: RateLimit = { limit: 60, windowSeconds: 600 };
/** Tool rounds per answer: a question needs one or two lookups, never a crawl. */
const MAX_TOOL_ROUNDS = 4;
const MAX_OUTPUT_TOKENS = 1024;
const MAX_MATCHES = 10;
const searchInput = z.object({ query: z.string().trim().min(1).max(100) });
const KIND = {
  cash: 'cash',
  card: 'card',
  bank_transfer: 'bank transfer',
  custom: 'other',
} as const;

interface ToolOutcome {
  content: string;
  isError: boolean;
}

/** What one question costs and how it went, accumulated across the model turns. */
interface RequestRecord {
  startedAt: number;
  model: string;
  usage: TokenUsage;
  toolsUsed: string[];
  rounds: number;
  stopReason: string | null;
  outcome: 'answered' | 'fallback' | 'refused' | 'failed';
  reply: string | null;
  error: string | null;
}

/**
 * Chat helper on the cashier screen and in the management app (ADR-0107). Stateless: the
 * browser sends the whole conversation; every lookup runs as the user (same rights, same
 * branch scope, same RLS) and reads exactly what the app's own screens show.
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
    private readonly payments: PaymentsService,
    private readonly reports: ReportsService,
    private readonly sales: SalesService,
    private readonly shifts: ShiftsService,
  ) {}

  status(): AssistantStatus {
    return { enabled: this.model.enabled };
  }

  async chat(
    actor: MerchantActor,
    input: ChatInput,
    surface: AssistantSurface = 'pos',
  ): Promise<AssistantReply> {
    if (!this.model.enabled) throw assistantDisabled();
    // POS: the bound branch. Manager: the branch selected in the top bar, or all branches.
    const branchId = surface === 'pos' ? actor.boundBranchId : input.branchId;
    if (surface === 'pos' && !branchId) throw AppError.forbidden();
    await this.limiter.consume(`assistant:user:${actor.userId}`, ASSISTANT_LIMIT);

    // The platform's record of this question (ADR-0107 amendment): written whatever happens.
    const record: RequestRecord = {
      startedAt: Date.now(),
      model: this.model.modelId,
      usage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 },
      toolsUsed: [],
      rounds: 0,
      stopReason: null,
      outcome: 'failed',
      reply: null,
      error: null,
    };
    try {
      return await this.converse(actor, surface, branchId, input, record);
    } catch (error) {
      record.error = error instanceof AppError ? error.code : 'ERROR';
      throw error;
    } finally {
      await this.store(actor, surface, branchId, input, record);
    }
  }

  private async converse(
    actor: MerchantActor,
    surface: AssistantSurface,
    branchId: string | null,
    input: ChatInput,
    record: RequestRecord,
  ): Promise<AssistantReply> {
    const context = await this.context(actor, surface, branchId, input);
    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      {
        type: 'text',
        text: surface === 'pos' ? POS_GUIDE : MANAGER_GUIDE,
        cache_control: { type: 'ephemeral' },
      },
      { type: 'text', text: contextBlock(context) },
    ];
    const tools = surface === 'pos' ? ASSISTANT_TOOLS : MANAGER_TOOLS;
    const messages = toMessageParams(input.messages);
    const { toolsUsed } = record;
    let reply = '';

    for (let round = 0; ; round += 1) {
      const response = await this.model.complete({
        // An answer is a few hundred tokens; the cap bounds a runaway turn (live trial: one
        // turn repeated a tool-call tag until the limit).
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        // A copy per turn: the provider (and the test double) keep what they were sent.
        messages: [...messages],
        tools,
        // Chat answers are short; low effort keeps the till responsive.
        output_config: { effort: 'low' },
      });
      // One line per model turn: the cost record (scripts/ops/assistant-trial.mjs sums it).
      const usage = response.usage;
      this.logger.log(
        `assistant turn: ${usage.input_tokens} in / ${usage.output_tokens} out, cache write ${usage.cache_creation_input_tokens ?? 0} / read ${usage.cache_read_input_tokens ?? 0}, stop ${response.stop_reason}`,
      );
      record.rounds += 1;
      record.model = response.model || record.model;
      record.stopReason = response.stop_reason;
      record.usage.inputTokens += usage.input_tokens;
      record.usage.outputTokens += usage.output_tokens;
      record.usage.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0;
      record.usage.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
      if (response.stop_reason === 'refusal') {
        reply = fallbackReply(input.language, surface);
        record.outcome = 'refused';
        break;
      }
      const calls = response.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
      );
      if (response.stop_reason === 'max_tokens' && calls.length === 0) {
        // The turn ran out before an answer: its text is a fragment, never shown.
        this.logger.warn('assistant turn hit the output limit without an answer');
        reply = fallbackReply(input.language, surface);
        record.outcome = 'fallback';
        break;
      }
      reply = textOf(response) || reply;
      record.outcome = 'answered';
      if (response.stop_reason !== 'tool_use' || calls.length === 0 || round >= MAX_TOOL_ROUNDS)
        break;
      messages.push({ role: 'assistant', content: response.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const call of calls) {
        const outcome =
          surface === 'pos'
            ? await this.runPosTool(actor, branchId!, call)
            : await this.runManagerTool(actor, branchId, call);
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
    if (!reply) record.outcome = 'fallback';
    record.reply = reply || fallbackReply(input.language, surface);
    return { reply: record.reply, toolsUsed };
  }

  /** The platform's usage record; a failure here is logged and never reaches the user. */
  private async store(
    actor: MerchantActor,
    surface: AssistantSurface,
    branchId: string | null,
    input: ChatInput,
    record: RequestRecord,
  ): Promise<void> {
    const question = input.messages[input.messages.length - 1]?.content ?? '';
    try {
      await this.database.withMerchantTx(actor.merchantId, (tx) =>
        tx.insert(assistantRequests).values({
          id: newId(),
          merchantId: actor.merchantId,
          userId: actor.userId,
          membershipId: actor.membershipId,
          branchId,
          surface,
          conversationId: input.conversationId,
          language: input.language,
          model: record.model,
          question,
          thread: JSON.stringify(input.messages.slice(0, -1)),
          reply: record.reply,
          toolsUsed: record.toolsUsed,
          rounds: record.rounds,
          ...record.usage,
          costMicroUsd: estimateCostMicroUsd(record.model, record.usage),
          durationMs: Date.now() - record.startedAt,
          outcome: record.outcome,
          stopReason: record.stopReason,
          error: record.error,
        }),
      );
    } catch (error) {
      this.logger.error('assistant request could not be recorded', error);
    }
  }

  // ------------------------------------------------------------ context
  private async context(
    actor: MerchantActor,
    surface: AssistantSurface,
    branchId: string | null,
    input: ChatInput,
  ): Promise<PromptContext> {
    const names = await this.database.withMerchantTx(actor.merchantId, async (tx) => {
      const [m] = (
        await tx.execute(
          sql`select display_name_en, display_name_ar from merchants where id = ${actor.merchantId}`,
        )
      ).rows as { display_name_en: string | null; display_name_ar: string | null }[];
      // RLS keeps this to the merchant: another company's branch is simply not found.
      const [b] = branchId
        ? ((await tx.execute(sql`select name_en, name_ar from branches where id = ${branchId}`))
            .rows as { name_en: string | null; name_ar: string | null }[])
        : [undefined];
      if (branchId && !b) throw AppError.notFound('Branch not found.');
      const [u] = (await tx.execute(sql`select full_name from users where id = ${actor.userId}`))
        .rows as { full_name: string }[];
      const tz = await merchantTimezone(tx, actor.merchantId);
      return {
        merchant: pick(input.language, m?.display_name_ar, m?.display_name_en),
        branch: b ? pick(input.language, b.name_ar, b.name_en) : null,
        user: u?.full_name ?? '',
        tz,
      };
    });
    const keys = Object.keys(PERMISSIONS) as PermissionKey[];
    const permissions = branchId
      ? keys.filter((p) => can(actor.access, p, branchId))
      : keys.filter((p) => canAnywhere(actor.access, p));
    const shift =
      surface === 'pos' && can(actor.access, 'shifts.operate', branchId)
        ? await this.shifts.currentShift(actor)
        : null;
    const clock = new Intl.DateTimeFormat('en-GB', {
      timeZone: names.tz,
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    return {
      surface,
      language: input.language,
      merchantName: names.merchant,
      branchName: names.branch,
      userName: names.user,
      permissions,
      isOwner: actor.access.isOwner,
      shift: shift
        ? {
            register: pick(input.language, shift.registerName.nameAr, shift.registerName.nameEn),
            openedAt: clock.format(new Date(shift.openedAt)),
          }
        : null,
      cart: surface === 'pos' ? input.cart : null,
      now: clock.format(new Date()),
    };
  }

  // ------------------------------------------------------------ POS tools
  private async runPosTool(
    actor: MerchantActor,
    branchId: string,
    call: Anthropic.Beta.BetaToolUseBlock,
  ): Promise<ToolOutcome> {
    return this.guarded(call, async () => {
      switch (call.name) {
        case 'search_products':
          return this.searchPosProducts(actor, branchId, call.input);
        case 'payment_methods':
          return this.posPaymentMethods(actor, branchId);
        case 'recent_sales':
          return this.recentSales(actor, branchId);
        case 'shift_summary':
          return this.shiftSummary(actor, branchId);
        default:
          return { content: `Unknown lookup "${call.name}".`, isError: true };
      }
    });
  }

  private async searchPosProducts(
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

  /** The Pay screen's buttons: the same list the POS fetches, nothing from the settings. */
  private async posPaymentMethods(actor: MerchantActor, branchId: string): Promise<ToolOutcome> {
    if (!can(actor.access, 'sales.create', branchId))
      return { content: 'The cashier has no right to take payments.', isError: true };
    const methods = await this.payments.posMethods(actor);
    if (methods.length === 0)
      return { content: 'No payment method is enabled on the Pay screen.', isError: false };
    const rows = methods.map((m) => ({
      name: { en: m.nameEn, ar: m.nameAr },
      kind: KIND[m.kind],
      // Every non-cash tender carries its terminal / transfer reference (BR-181).
      reference: m.kind === 'cash' ? 'none' : 'required',
    }));
    return { content: JSON.stringify({ methods: rows }), isError: false };
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

  // ------------------------------------------------------------ manager tools
  private async runManagerTool(
    actor: MerchantActor,
    branchId: string | null,
    call: Anthropic.Beta.BetaToolUseBlock,
  ): Promise<ToolOutcome> {
    return this.guarded(call, async () => {
      switch (call.name) {
        case 'search_products':
          return this.searchManagerProducts(actor, branchId, call.input);
        case 'payment_methods':
          return this.managerPaymentMethods(actor);
        case 'stock_summary':
          return this.stockSummary(actor, branchId);
        case 'sales_today':
          return this.salesToday(actor);
        default:
          return { content: `Unknown lookup "${call.name}".`, isError: true };
      }
    });
  }

  /** The Products page's search, with stock from the Inventory page when the user may see it. */
  private async searchManagerProducts(
    actor: MerchantActor,
    branchId: string | null,
    raw: unknown,
  ): Promise<ToolOutcome> {
    const parsed = searchInput.safeParse(raw);
    if (!parsed.success) return { content: 'A search term is required.', isError: true };
    if (
      !(branchId
        ? can(actor.access, 'catalog.read', branchId)
        : canAnywhere(actor.access, 'catalog.read'))
    )
      return { content: 'The user has no right to view products.', isError: true };
    const { products } = await this.catalog.listProducts(actor, {
      q: parsed.data.query,
      status: 'all',
      sort: 'name',
      direction: 'asc',
      page: 1,
      pageSize: MAX_MATCHES,
    });
    if (products.length === 0) return { content: 'No product matches the search.', isError: false };
    // Stock as the Inventory page shows it: the selected branch, or the readable ones summed.
    const inventoryScope = permissionBranchScope(actor.access, 'inventory.read');
    const stockVisible = branchId
      ? can(actor.access, 'inventory.read', branchId)
      : inventoryScope.all || inventoryScope.branchIds.length > 0;
    const levels = new Map<
      string,
      { variant: unknown; sku: string | null; onHand: string; status: string }[]
    >();
    if (stockVisible && products.some((p) => p.trackInventory)) {
      const { levels: rows } = await this.inventory.listLevels(actor, {
        ...(branchId ? { branchId } : {}),
        q: parsed.data.query,
        stock: 'all',
        sort: 'name',
        direction: 'asc',
        page: 1,
        pageSize: 100,
      });
      for (const l of rows) {
        const list = levels.get(l.productId) ?? [];
        list.push({
          variant:
            l.variantNameEn || l.variantNameAr
              ? { en: l.variantNameEn, ar: l.variantNameAr }
              : null,
          sku: l.sku,
          onHand: l.onHand,
          status: l.status,
        });
        levels.set(l.productId, list);
      }
    }
    const rows = products.map((p) => ({
      name: { en: p.nameEn, ar: p.nameAr },
      status: p.status,
      type: p.type,
      variants: p.variantCount,
      skus: p.skus,
      price:
        p.minPrice && p.maxPrice
          ? p.minPrice.amount === p.maxPrice.amount
            ? `${p.minPrice.amount} ${p.minPrice.currency}`
            : `${p.minPrice.amount} – ${p.maxPrice.amount} ${p.minPrice.currency}`
          : null,
      stock: !p.trackInventory
        ? 'not tracked'
        : stockVisible
          ? (levels.get(p.id) ?? [])
          : 'not visible to this user',
    }));
    return { content: JSON.stringify({ matches: rows }), isError: false };
  }

  /** The Payment methods page, as listed there. */
  private async managerPaymentMethods(actor: MerchantActor): Promise<ToolOutcome> {
    if (!canAnywhere(actor.access, 'payments.settings'))
      return { content: 'The user has no right to the Payment methods page.', isError: true };
    const [methods, accounts] = await Promise.all([
      this.payments.listMethods(actor),
      this.payments.listAccounts(actor),
    ]);
    const accountName = new Map(accounts.map((a) => [a.id, { en: a.nameEn, ar: a.nameAr }]));
    const rows = methods.map((m) => ({
      name: { en: m.nameEn, ar: m.nameAr },
      kind: KIND[m.kind],
      status: m.status,
      onRegister: m.availableInPos,
      online: m.availableOnline,
      fee:
        m.feeType === 'none'
          ? 'none'
          : {
              type: m.feeType,
              fixed: `${m.feeFixed.amount} ${m.feeFixed.currency}`,
              percent: m.feePercent,
            },
      settlesInto: m.financialAccountId ? (accountName.get(m.financialAccountId) ?? null) : null,
    }));
    return { content: JSON.stringify({ methods: rows }), isError: false };
  }

  /** The Inventory page's summary cards. */
  private async stockSummary(actor: MerchantActor, branchId: string | null): Promise<ToolOutcome> {
    const summary = await this.inventory.summary(actor, branchId ?? undefined);
    return {
      content: JSON.stringify({
        scope: branchId ? 'selected branch' : 'all branches the user may see',
        trackedItems: summary.trackedVariants,
        lowStock: summary.lowStock,
        outOfStock: summary.outOfStock,
        stockValueAtCost: summary.totalValue
          ? `${summary.totalValue.amount} ${summary.totalValue.currency}`
          : 'not visible to this user',
        itemsWithoutCost: summary.unvaluedVariants,
      }),
      isError: false,
    };
  }

  /** The dashboard's today card. */
  private async salesToday(actor: MerchantActor): Promise<ToolOutcome> {
    const t = await this.reports.today(actor);
    const day = (d: typeof t.today) => ({
      sales: d.saleCount,
      netSales: amount(d.netSales),
      refunds: d.refundCount,
      refunded: amount(d.refunds),
      netAfterRefunds: amount(d.netAfterRefunds),
    });
    return {
      content: JSON.stringify({
        date: t.date,
        scope: 'the branches the user may report on',
        today: day(t.today),
        yesterday: day(t.yesterday),
        openShifts: t.openShifts,
        hasSalesEver: t.hasSales,
      }),
      isError: false,
    };
  }

  // ------------------------------------------------------------ helpers
  private async guarded(
    call: Anthropic.Beta.BetaToolUseBlock,
    run: () => Promise<ToolOutcome>,
  ): Promise<ToolOutcome> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof AppError) return { content: error.message, isError: true };
      this.logger.error(`assistant lookup ${call.name} failed`, error);
      return { content: 'The lookup failed.', isError: true };
    }
  }
}

function amount(m: { amount: string; currency: string }): string {
  return `${Money.fromJSON(m as { amount: string; currency: 'KWD' }).toDecimalString()} ${m.currency}`;
}

function pick(language: 'ar' | 'en', ar: string | null | undefined, en: string | null | undefined) {
  return (language === 'ar' ? ar || en : en || ar) ?? '';
}
