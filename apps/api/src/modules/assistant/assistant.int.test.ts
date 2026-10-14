import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateTotpSecret, totpCode, totpStep } from '../../kernel/crypto/totp.js';
import { newId } from '../../kernel/ids.js';
import {
  ScriptedAssistantModel,
  textTurn,
  toolTurn,
  turn,
} from '../../testing/assistant-double.js';
import {
  ApiClient,
  DbFixtures,
  PASSWORD,
  createCompany,
  sessionCookie,
} from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, TEST_MFA_KEY, createTestApp, testEnv } from '../../testing/test-app.js';
import { upsertOperator } from '../platform-admin/operators.js';
import { MANAGER_GUIDE, POS_GUIDE } from './assistant.prompt.js';

/**
 * POS assistant (ADR-0105): a read-only helper that looks things up as the cashier, at the
 * cashier's branch, and never runs without the provider being configured.
 */
let app: NestFastifyApplication;
let owner: pg.Pool;
let runtime: pg.Pool;
let db: DbFixtures;
let mailer: InMemoryMailer;
let model: ScriptedAssistantModel;

beforeAll(async () => {
  const prepared = await prepareIntegrationDatabase();
  owner = prepared.owner;
  runtime = new pg.Pool({ connectionString: prepared.runtimeUrl, max: 2 });
  db = new DbFixtures(owner);
  mailer = new InMemoryMailer();
  model = new ScriptedAssistantModel();
  app = await createTestApp({
    env: testEnv({ DATABASE_URL: prepared.runtimeUrl, DATABASE_POOL_MAX: '20' }),
    mailer,
    assistantModel: model,
  });
});
afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await owner?.end();
});
beforeEach(() => model.reset());

type Co = Awaited<ReturnType<typeof createCompany>>;

/** A company with one tracked product (12 in stock) and a cashier with an open shift. */
async function store(nameEn: string, nameAr: string) {
  const c = await createCompany(app, db, mailer);
  await c.showExpectedCash();
  const product = (
    await c.client.request('POST', '/manager/products', {
      cookies: c.cookies,
      body: {
        nameEn,
        nameAr,
        variants: [
          { sku: `SKU-${newId().slice(-6)}`, price: '2.750', cost: '1.000', barcodes: [] },
        ],
      },
    })
  ).json();
  const variantId = product.variants[0].id as string;
  await c.client.request('POST', '/manager/inventory/adjustments', {
    cookies: c.cookies,
    body: {
      branchId: c.main,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId, quantity: '12' }],
    },
  });
  return { c, variantId };
}

async function cashierWithShift(c: Co) {
  const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
  const registers = (
    await c.client.request('GET', `/manager/registers?branchId=${c.main}`, { cookies: c.cookies })
  ).json().registers as { id: string }[];
  const opened = await c.client.request('POST', '/pos/shifts', {
    cookies: cashier.cookies,
    body: { registerId: registers[0]!.id, countedCash: '10.000', expectedCash: '0.000' },
  });
  if (opened.statusCode !== 201) throw new Error(opened.body);
  return cashier;
}

const chat = (c: Co, cookies: Record<string, string>, body: Record<string, unknown>) =>
  c.client.request('POST', '/pos/assistant/chat', { cookies, body });

const question = (content: string, extra: Record<string, unknown> = {}) => ({
  messages: [{ role: 'user', content }],
  language: 'ar',
  cart: null,
  ...extra,
});

describe('POS assistant', () => {
  it('is off, and says so, until the provider is configured', async () => {
    const { c } = await store('Oud oil', 'دهن عود');
    const cashier = await cashierWithShift(c);
    model.enabled = false;
    const status = await c.client.request('GET', '/pos/assistant', { cookies: cashier.cookies });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ enabled: false });
    const res = await chat(c, cashier.cookies, question('هلا'));
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('ASSISTANT_DISABLED');
    expect(model.requests).toHaveLength(0);
  });

  it('answers with the product lookup, scoped to the cashier’s own company and branch', async () => {
    const mine = await store('Oud oil', 'دهن عود');
    const other = await store('Oud oil', 'دهن عود');
    expect(other.variantId).not.toBe(mine.variantId);
    const cashier = await cashierWithShift(mine.c);
    model.reply(
      toolTurn('toolu_1', 'search_products', { query: 'Oud' }),
      textTurn('دهن عود سعره 2.750 د.ك والمتوفر 12.'),
    );
    const res = await chat(
      mine.c,
      cashier.cookies,
      question('كم سعر دهن العود؟', {
        cart: {
          lines: [{ name: 'دهن عود', quantity: '2', unitPrice: '2.750', lineTotal: '5.500' }],
          total: '5.500',
          customer: null,
        },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      reply: 'دهن عود سعره 2.750 د.ك والمتوفر 12.',
      toolsUsed: ['search_products'],
    });

    expect(model.requests).toHaveLength(2);
    const [first, second] = model.requests;
    // The guide is the cacheable prefix; the facts of this request follow it.
    const system = first!.system as { text: string; cache_control?: unknown }[];
    expect(system[0]!.text).toBe(POS_GUIDE);
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(system[1]!.text).toContain('Answer in Arabic');
    expect(system[1]!.text).toContain('الفرع الرئيسي');
    expect(system[1]!.text).toContain('Open shift on register');
    expect(system[1]!.text).toContain('sales.create');
    expect(system[1]!.text).toContain('- دهن عود × 2 @ 2.750 = 5.500 KWD');
    expect(first!.tools?.map((t) => (t as { name: string }).name)).toEqual([
      'search_products',
      'payment_methods',
      'recent_sales',
      'shift_summary',
    ]);
    expect(first!.messages).toEqual([{ role: 'user', content: 'كم سعر دهن العود؟' }]);

    // The lookup result goes back as a tool result of the same call, one company only.
    const messages = second!.messages;
    expect(messages).toHaveLength(3);
    expect(messages[1]!.role).toBe('assistant');
    const results = messages[2]!.content as {
      type: string;
      tool_use_id: string;
      content: string;
      is_error: boolean;
    }[];
    expect(results[0]!.type).toBe('tool_result');
    expect(results[0]!.tool_use_id).toBe('toolu_1');
    expect(results[0]!.is_error).toBe(false);
    const found = JSON.parse(results[0]!.content) as { matches: Record<string, unknown>[] };
    expect(found.matches).toHaveLength(1);
    expect(found.matches[0]).toMatchObject({
      name: { en: 'Oud oil', ar: 'دهن عود' },
      price: '2.750 KWD',
      stock: { onHand: '12.000', status: 'in_stock' },
    });
  });

  it('reports the shift and the recent sales as the cashier sees them, and stops at the round limit', async () => {
    const { c, variantId } = await store('Tea', 'شاي');
    const cashier = await cashierWithShift(c);
    const methods = (
      await c.client.request('GET', '/pos/payment-methods', { cookies: cashier.cookies })
    ).json().methods as { id: string; kind: string }[];
    const sale = await c.client.request('POST', '/pos/sales', {
      cookies: cashier.cookies,
      body: {
        idempotencyKey: newId(),
        lines: [{ variantId, quantity: '3' }],
        payments: [{ methodId: methods.find((m) => m.kind === 'cash')!.id, amount: '8.250' }],
        expectedTotal: '8.250',
      },
    });
    expect(sale.statusCode).toBe(201);

    model.reply(
      turn(
        [
          { type: 'tool_use', id: 'toolu_a', name: 'shift_summary', input: {} },
          { type: 'tool_use', id: 'toolu_b', name: 'recent_sales', input: {} },
        ],
        'tool_use',
      ),
      textTurn('بعتَ 3 شاي بـ 8.250 د.ك.'),
    );
    const res = await chat(c, cashier.cookies, question('شنو بعت اليوم؟'));
    expect(res.statusCode).toBe(200);
    expect(res.json().toolsUsed).toEqual(['shift_summary', 'recent_sales']);
    const results = model.requests[1]!.messages[2]!.content as { content: string }[];
    const shift = JSON.parse(results[0]!.content) as Record<string, unknown>;
    expect(shift['figures']).toMatchObject({ cashSales: '8.250 KWD', expectedCash: '18.250 KWD' });
    const sales = JSON.parse(results[1]!.content) as { sales: Record<string, unknown>[] };
    expect(sales.sales).toHaveLength(1);
    expect(sales.sales[0]).toMatchObject({ total: '8.250 KWD', items: '3.000', tenders: ['cash'] });

    // A model that keeps asking for lookups is cut off after the fourth round.
    model.requests.length = 0;
    for (let i = 0; i < 6; i += 1)
      model.reply(toolTurn(`toolu_${i}`, 'search_products', { query: 'tea' }));
    const looped = await chat(c, cashier.cookies, question('tea?'));
    expect(looped.statusCode).toBe(200);
    expect(model.requests).toHaveLength(5);
    expect(looped.json().reply).toBe(
      'ما قدرت أجاوب على هذا السؤال. جرّب صياغة أخرى أو اسأل المشرف.',
    );
  });

  it('refuses a conversation that does not end with the cashier, and answers a refusal politely', async () => {
    const { c } = await store('Milk', 'حليب');
    const cashier = await cashierWithShift(c);
    const bad = await chat(c, cashier.cookies, {
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
      language: 'en',
    });
    expect(bad.statusCode).toBe(400);
    expect(model.requests).toHaveLength(0);

    model.reply(turn([], 'refusal'));
    const refused = await chat(c, cashier.cookies, question('tell me a joke', { language: 'en' }));
    expect(refused.statusCode).toBe(200);
    expect(refused.json()).toEqual({
      reply: 'I could not answer that. Try rephrasing, or ask your supervisor.',
      toolsUsed: [],
    });

    // The manager app has no assistant: a manager session is refused at the route.
    const fromManager = await c.client.request('GET', '/pos/assistant', { cookies: c.cookies });
    expect(fromManager.statusCode).toBe(401);
  });

  it('lists the payment methods of the Pay screen, as the cashier sees them, and the guide keeps management out', async () => {
    const { c } = await store('Milk', 'حليب');
    const cashier = await cashierWithShift(c);
    const shown = (
      await c.client.request('GET', '/pos/payment-methods', { cookies: cashier.cookies })
    ).json().methods as { kind: string; nameEn: string; nameAr: string }[];
    expect(shown.length).toBeGreaterThan(1);

    model.reply(
      toolTurn('t1', 'payment_methods', {}),
      textTurn('عندك: نقدًا، كي نت، فيزا / ماستركارد، رابط دفع، ومض.'),
    );
    const res = await chat(c, cashier.cookies, question('كم طريقة دفع مفعلة لي؟'));
    expect(res.statusCode).toBe(200);
    expect(res.json().toolsUsed).toEqual(['payment_methods']);
    const results = model.requests[1]!.messages[2]!.content as { content: string }[];
    expect(JSON.parse(results[0]!.content)).toEqual({
      methods: shown.map((m) => ({
        name: { en: m.nameEn, ar: m.nameAr },
        kind: { cash: 'cash', card: 'card', bank_transfer: 'bank transfer', custom: 'other' }[
          m.kind
        ],
        reference: m.kind === 'cash' ? 'none' : 'required',
      })),
    });
    expect(POS_GUIDE).toContain('never quote permission keys');
    expect(POS_GUIDE).toContain('payment_methods lookup');
  });

  it('hides a turn cut off at the output limit and the model’s own notes (live trial findings)', async () => {
    const { c } = await store('Milk', 'حليب');
    const cashier = await cashierWithShift(c);

    // A runaway turn after a lookup: the fragment is never shown, the lookup is still reported.
    model.reply(
      toolTurn('t1', 'search_products', { query: 'milk' }),
      textTurn('<invoke name="search_products">\n</invoke>\n'.repeat(40), 'max_tokens'),
    );
    const cut = await chat(c, cashier.cookies, question('milk price?', { language: 'en' }));
    expect(cut.statusCode).toBe(200);
    expect(cut.json()).toEqual({
      reply: 'I could not answer that. Try rephrasing, or ask your supervisor.',
      toolsUsed: ['search_products'],
    });
    expect(model.requests).toHaveLength(2);
    expect(model.requests[0]?.max_tokens).toBe(1024);

    // Working notes written into the text are stripped from the answer.
    model.reset();
    model.reply(
      textTurn('<thinking>onHand excludes the cart line.</thinking>Milk is 2.750 KWD, 12 on hand.'),
    );
    const noted = await chat(c, cashier.cookies, question('milk?', { language: 'en' }));
    expect(noted.json()).toEqual({ reply: 'Milk is 2.750 KWD, 12 on hand.', toolsUsed: [] });
  });
});

describe('manager assistant', () => {
  const managerChat = (c: Co, cookies: Record<string, string>, body: Record<string, unknown>) =>
    c.client.request('POST', '/manager/assistant/chat', { cookies, body });

  it('answers the owner from the management app’s own screens, scoped to the selected branch', async () => {
    const { c, variantId } = await store('Milk', 'حليب');
    const other = await store('Milk', 'حليب');
    expect(other.variantId).not.toBe(variantId);

    // Products with stock at the selected branch, then the Payment methods page.
    model.reply(
      toolTurn('m1', 'search_products', { query: 'Milk' }),
      textTurn('Milk: 2.750 KWD, 12 on hand.'),
    );
    const res = await managerChat(c, c.cookies, {
      messages: [{ role: 'user', content: 'How much milk do we have?' }],
      language: 'en',
      branchId: c.main,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      reply: 'Milk: 2.750 KWD, 12 on hand.',
      toolsUsed: ['search_products'],
    });
    const [first, second] = model.requests;
    const system = first!.system as { text: string; cache_control?: unknown }[];
    expect(system[0]!.text).toBe(MANAGER_GUIDE);
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(system[1]!.text).toContain('Owner:');
    expect(system[1]!.text).toContain('Branch selected in the top bar');
    expect(system[1]!.text).toContain('holds every right');
    expect(first!.tools?.map((t) => (t as { name: string }).name)).toEqual([
      'search_products',
      'payment_methods',
      'stock_summary',
      'sales_today',
    ]);
    const result = JSON.parse(
      (second!.messages[2]!.content as { content: string }[])[0]!.content,
    ) as { matches: { name: { en: string }; price: string; stock: { onHand: string }[] }[] };
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      name: { en: 'Milk' },
      status: 'active',
      price: '2.750 KWD',
      stock: [{ onHand: '12.000', status: 'in_stock' }],
    });

    model.reset();
    model.reply(
      toolTurn('m2', 'payment_methods', {}),
      toolTurn('m3', 'sales_today', {}),
      toolTurn('m4', 'stock_summary', {}),
      textTurn('Five methods; no sales yet; 1 tracked item.'),
    );
    const more = await managerChat(c, c.cookies, {
      messages: [{ role: 'user', content: 'Payment methods, sales and stock?' }],
      language: 'en',
    });
    expect(more.statusCode).toBe(200);
    expect(more.json().toolsUsed).toEqual(['payment_methods', 'sales_today', 'stock_summary']);
    expect((model.requests[0]!.system as { text: string }[])[1]!.text).toContain(
      'all branches the user may see',
    );
    const shown = (
      await c.client.request('GET', '/manager/payment-methods', { cookies: c.cookies })
    ).json().methods as { nameEn: string; status: string; availableInPos: boolean }[];
    const methods = JSON.parse(
      (model.requests[1]!.messages[2]!.content as { content: string }[])[0]!.content,
    ) as { methods: { name: { en: string }; status: string; onRegister: boolean }[] };
    expect(methods.methods.map((m) => m.name.en)).toEqual(shown.map((m) => m.nameEn));
    expect(methods.methods[0]).toMatchObject({ status: 'active', onRegister: true });
    const today = JSON.parse(
      (model.requests[2]!.messages[4]!.content as { content: string }[])[0]!.content,
    ) as { today: { sales: number }; openShifts: number };
    expect(today.today.sales).toBe(0);
    expect(today.openShifts).toBe(0);
    const stock = JSON.parse(
      (model.requests[3]!.messages[6]!.content as { content: string }[])[0]!.content,
    ) as { trackedItems: number; stockValueAtCost: string };
    expect(stock.trackedItems).toBe(1);
    expect(stock.stockValueAtCost).toBe('12.000 KWD');
  });

  it('keeps a manager without the right out of a lookup, and a cashier session out of the route', async () => {
    const { c } = await store('Milk', 'حليب');
    const cashier = await cashierWithShift(c);
    const fromPos = await c.client.request('GET', '/manager/assistant', {
      cookies: cashier.cookies,
    });
    expect(fromPos.statusCode).toBe(401);

    // A manager with access but without the Payment methods page: the lookup says so.
    const manager = await c.hire([{ roleId: c.roles.branch_manager, branchId: c.main }], 'manager');
    model.reply(
      toolTurn('m1', 'payment_methods', {}),
      textTurn('You cannot see the payment methods.'),
    );
    const res = await managerChat(c, manager.cookies, {
      messages: [{ role: 'user', content: 'Which payment methods do we have?' }],
      language: 'en',
      branchId: c.main,
    });
    expect(res.statusCode).toBe(200);
    const result = (
      model.requests[1]!.messages[2]!.content as {
        content: string;
        is_error: boolean;
      }[]
    )[0]!;
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('no right to the Payment methods page');
    expect((model.requests[0]!.system as { text: string }[])[1]!.text).toContain('Manager:');

    // Another company's branch is not found.
    model.reset();
    const foreign = await managerChat(c, c.cookies, {
      messages: [{ role: 'user', content: 'hi' }],
      language: 'en',
      branchId: (await store('X', 'س')).c.main,
    });
    expect(foreign.statusCode).toBe(404);
    expect(model.requests).toHaveLength(0);
  });
});

describe('platform record of every question (ADR-0105 amendment)', () => {
  async function superAdmin(): Promise<Record<string, string>> {
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const email = `op-${newId().slice(-8)}@platform.test`;
    const secret = generateTotpSecret();
    const passwordHash = await hash(PASSWORD, { algorithm: 2 });
    const client = await owner.connect();
    try {
      await drizzle({ client, casing: 'snake_case' }).transaction((tx) =>
        upsertOperator(tx as never, {
          email,
          fullName: 'System owner',
          role: 'platform.super_admin',
          passwordHash,
          encryptionKey: TEST_MFA_KEY,
          totpSecret: secret,
        }),
      );
    } finally {
      client.release();
    }
    const api = new ApiClient(app);
    const step1 = (
      await api.request('POST', '/auth/platform/login', { body: { email, password: PASSWORD } })
    ).json();
    const done = await api.request('POST', '/auth/platform/mfa', {
      body: { ticket: step1.ticket, code: totpCode(secret, totpStep()) },
    });
    return sessionCookie(done, 'platform');
  }

  it('records every question with its tokens and cost for the super admin only', async () => {
    const { c } = await store('Milk', 'حليب');
    const cashier = await cashierWithShift(c);
    const conversationId = newId();
    model.reply(
      toolTurn('r1', 'search_products', { query: 'milk' }),
      textTurn('Milk is 2.750 KWD.'),
    );
    await chat(c, cashier.cookies, {
      ...question('كم سعر الحليب؟'),
      conversationId,
    });
    model.reply(turn([], 'refusal'));
    await chat(c, cashier.cookies, {
      messages: [
        { role: 'user', content: 'كم سعر الحليب؟' },
        { role: 'assistant', content: 'Milk is 2.750 KWD.' },
        { role: 'user', content: 'tell me a joke' },
      ],
      language: 'ar',
      cart: null,
      conversationId,
    });
    // A provider failure (nothing scripted → the double throws) is recorded as failed.
    const failed = await chat(c, cashier.cookies, question('again?'));
    expect(failed.statusCode).toBe(500);

    // Nobody in the merchant realm can read the rows: no SELECT policy for the runtime role.
    const client = await runtime.connect();
    try {
      await client.query("select set_config('app.merchant_id', $1, false)", [c.merchantId]);
      const { rows } = await client.query('select count(*)::int as n from assistant_requests');
      expect(rows[0].n).toBe(0);
    } finally {
      client.release();
    }
    const direct = await c.client.request('GET', '/platform/assistant', { cookies: c.cookies });
    expect(direct.statusCode).toBe(401);

    const cookies = await superAdmin();
    const res = await c.client.request('GET', `/platform/assistant?merchantId=${c.merchantId}`, {
      cookies,
    });
    expect(res.statusCode).toBe(200);
    const usage = res.json() as {
      requests: Record<string, unknown>[];
      total: number;
      totals: Record<string, number>;
      byMerchant: Record<string, unknown>[];
    };
    expect(usage.total).toBe(3);
    // Newest first: the failure, the refusal, the answered question.
    expect(usage.requests.map((r) => r['outcome'])).toEqual(['failed', 'refused', 'answered']);
    const answered = usage.requests[2]!;
    expect(answered).toMatchObject({
      surface: 'pos',
      conversationId,
      language: 'ar',
      model: 'claude-opus-5-5',
      question: 'كم سعر الحليب؟',
      reply: 'Milk is 2.750 KWD.',
      toolsUsed: ['search_products'],
      rounds: 2,
      inputTokens: 20,
      outputTokens: 10,
      // 20 × $4 + 10 × $20 per million = 280 micro-USD.
      costMicroUsd: 280,
      stopReason: 'end_turn',
      merchantId: c.merchantId,
      branchNameEn: 'Main branch',
    });
    expect(usage.requests[1]).toMatchObject({ outcome: 'refused', question: 'tell me a joke' });
    expect(usage.requests[0]).toMatchObject({ outcome: 'failed', error: 'ERROR', rounds: 0 });
    expect(usage.totals).toMatchObject({
      requests: 3,
      inputTokens: 30,
      outputTokens: 15,
      costMicroUsd: 420,
    });
    expect(usage.byMerchant).toHaveLength(1);
    expect(usage.byMerchant[0]).toMatchObject({ merchantId: c.merchantId, requests: 3, users: 1 });

    // Filters: surface, text, day; the export carries the thread with the answer.
    const none = (
      await c.client.request(
        'GET',
        `/platform/assistant?merchantId=${c.merchantId}&surface=manager`,
        { cookies },
      )
    ).json() as { total: number };
    expect(none.total).toBe(0);
    const joke = (
      await c.client.request('GET', `/platform/assistant?merchantId=${c.merchantId}&q=joke`, {
        cookies,
      })
    ).json() as { total: number };
    expect(joke.total).toBe(1);
    const exported = await c.client.request(
      'GET',
      `/platform/assistant/export?merchantId=${c.merchantId}&q=joke`,
      { cookies },
    );
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toContain('application/x-ndjson');
    const lines = exported.body
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      conversationId,
      outcome: 'refused',
      messages: [
        { role: 'user', content: 'كم سعر الحليب؟' },
        { role: 'assistant', content: 'Milk is 2.750 KWD.' },
        { role: 'user', content: 'tell me a joke' },
        {
          role: 'assistant',
          content: 'ما قدرت أجاوب على هذا السؤال. جرّب صياغة أخرى أو اسأل المشرف.',
        },
      ],
    });
  });
});
