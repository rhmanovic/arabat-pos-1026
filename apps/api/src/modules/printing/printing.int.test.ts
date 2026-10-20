import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AddressInfo } from 'node:net';
import type pg from 'pg';
import { type Socket, io } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../kernel/ids.js';
import { DbFixtures, PASSWORD, createCompany } from '../../testing/auth-fixtures.js';
import { prepareIntegrationDatabase } from '../../testing/integration-db.js';
import { InMemoryMailer, createTestApp, testEnv } from '../../testing/test-app.js';

let app: NestFastifyApplication;
let owner: pg.Pool;
let db: DbFixtures;
let mailer: InMemoryMailer;
let baseUrl: string;

beforeAll(async () => {
  const prepared = await prepareIntegrationDatabase();
  owner = prepared.owner;
  db = new DbFixtures(owner);
  mailer = new InMemoryMailer();
  app = await createTestApp({
    env: testEnv({ DATABASE_URL: prepared.runtimeUrl, DATABASE_POOL_MAX: '20' }),
    mailer,
  });
  // A real port for the Socket.IO tests.
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await app?.close();
  await owner?.end();
});

type Co = Awaited<ReturnType<typeof createCompany>>;

/** A company with a product in stock at the main branch and a cashier with an open shift. */
async function shop() {
  const c = await createCompany(app, db, mailer);
  const product = (
    await c.client.request('POST', '/manager/products', {
      cookies: c.cookies,
      body: {
        nameEn: 'Karak tea',
        nameAr: 'شاي كرك',
        variants: [{ sku: `T-${newId().slice(-6)}`, price: '0.250', barcodes: [] }],
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
      lines: [{ variantId, quantity: '50' }],
    },
  });
  const methods = (
    await c.client.request('GET', '/manager/payment-methods', { cookies: c.cookies })
  ).json().methods as { id: string; kind: string }[];
  const cash = methods.find((m) => m.kind === 'cash')!.id;
  const register = (
    await c.client.request('GET', `/manager/registers?branchId=${c.main}`, { cookies: c.cookies })
  ).json().registers[0].id as string;
  const cashier = await c.hire([{ roleId: c.roles.cashier, branchId: c.main }], 'pos');
  const opened = await c.client.request('POST', '/pos/shifts', {
    cookies: cashier.cookies,
    body: { registerId: register, countedCash: '0.000', expectedCash: '0.000' },
  });
  if (opened.statusCode !== 201) throw new Error(opened.body);
  const sell = async () => {
    const res = await c.client.request('POST', '/pos/sales', {
      cookies: cashier.cookies,
      body: {
        idempotencyKey: newId(),
        lines: [{ variantId, quantity: '2' }],
        payments: [{ methodId: cash, amount: '0.500', tendered: '1' }],
        expectedTotal: '0.500',
      },
    });
    if (res.statusCode !== 201) throw new Error(res.body);
    return res.json() as { id: string; receiptNumber: string };
  };
  return { c, sell, cashier };
}

async function createAgent(c: Co, body: { name: string; branchId?: string | null }) {
  const res = await c.client.request('POST', '/manager/print-agents', { cookies: c.cookies, body });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; token: string };
}

function agentCall(
  c: Co,
  token: string | null,
  method: 'GET' | 'POST',
  url: string,
  body?: unknown,
) {
  return c.client.request(method, `/print-agent${url}`, {
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    ...(body !== undefined ? { body } : {}),
  });
}

const pending = async (c: Co, token: string) => {
  const res = await agentCall(c, token, 'GET', '/jobs/pending');
  expect(res.statusCode).toBe(200);
  return res.json() as { id: string; html: string; orderUuid: string | null; createdAt: string }[];
};

describe('print agents', () => {
  it('shows the token once, stores only its hash and lists the agent with its online state', async () => {
    const { c } = await shop();
    const agent = await createAgent(c, { name: 'MacBook till' });
    expect(agent.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await owner.query(
      `select encode(token_hash, 'hex') as hash, merchant_id from print_agents where id = $1`,
      [agent.id],
    );
    expect(stored.rows[0].hash).toHaveLength(64);
    expect(stored.rows[0].hash).not.toContain(agent.token);

    let list = (
      await c.client.request('GET', '/manager/print-agents', { cookies: c.cookies })
    ).json();
    expect(list.agents).toEqual([
      expect.objectContaining({
        id: agent.id,
        name: 'MacBook till',
        branchId: null,
        online: false,
        lastSeenAt: null,
      }),
    ]);
    expect(JSON.stringify(list)).not.toContain(agent.token);

    await pending(c, agent.token);
    list = (await c.client.request('GET', '/manager/print-agents', { cookies: c.cookies })).json();
    expect(list.agents[0]).toMatchObject({ online: true });
    expect(list.agents[0].lastSeenAt).not.toBeNull();
  });

  it('rejects requests without a token, with a wrong one and after the agent is deleted', async () => {
    const { c } = await shop();
    const agent = await createAgent(c, { name: 'Till' });
    expect((await agentCall(c, null, 'GET', '/jobs/pending')).statusCode).toBe(401);
    expect((await agentCall(c, 'not-a-token', 'GET', '/jobs/pending')).statusCode).toBe(401);
    expect((await agentCall(c, 'A'.repeat(43), 'GET', '/jobs/pending')).statusCode).toBe(401);
    // A merchant session is not an agent identity.
    expect(
      (await c.client.request('GET', '/print-agent/jobs/pending', { cookies: c.cookies }))
        .statusCode,
    ).toBe(401);
    expect((await agentCall(c, agent.token, 'GET', '/jobs/pending')).statusCode).toBe(200);

    const del = await c.client.request('DELETE', `/manager/print-agents/${agent.id}`, {
      cookies: c.cookies,
    });
    expect(del.statusCode).toBe(204);
    expect((await agentCall(c, agent.token, 'GET', '/jobs/pending')).statusCode).toBe(401);
    const audit = await owner.query(
      `select action from audit_log where target_id = $1 order by occurred_at, id`,
      [agent.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['print_agent.created', 'print_agent.deleted']);
  });

  it("never lets one company's agent see another company's jobs", async () => {
    const a = await shop();
    const b = await shop();
    const agentA = await createAgent(a.c, { name: 'A' });
    await createAgent(b.c, { name: 'B' });
    const saleB = await b.sell();
    expect(await pending(a.c, agentA.token)).toEqual([]);
    const jobB = await owner.query(`select id from print_jobs where sale_id = $1`, [saleB.id]);
    const claim = await agentCall(a.c, agentA.token, 'POST', `/jobs/${jobB.rows[0].id}/claim`);
    expect(claim.statusCode).toBe(404);
  });
});

describe('print jobs', () => {
  it('queues the receipt when a sale completes, as a self-contained 72 mm RTL document', async () => {
    const { c, sell } = await shop();
    const agent = await createAgent(c, { name: 'Till' });
    const sale = await sell();
    const jobs = await pending(c, agent.token);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ orderUuid: sale.id });
    const html = jobs[0]!.html;
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('width: 72mm');
    expect(html).toContain(sale.receiptNumber);
    expect(html).toContain('شاي كرك');
    expect(html).toContain('0.500 د.ك');
    expect(html).toContain('وقت الطباعة');
    // Nothing external: no links, scripts or remote resources.
    expect(html).not.toMatch(/<link|<script|https?:\/\/|src=/i);
    expect(html).not.toMatch(/(?<![-\w])color:(?!\s*#000)/);
    const row = await owner.query(`select kind, status, branch_id from print_jobs where id = $1`, [
      jobs[0]!.id,
    ]);
    expect(row.rows[0]).toMatchObject({ kind: 'auto', status: 'pending', branch_id: c.main });
  });

  it('queues nothing without an agent or with auto-print switched off', async () => {
    const { c, sell } = await shop();
    const none = await sell();
    expect(
      (await owner.query(`select count(*)::int as n from print_jobs where sale_id = $1`, [none.id]))
        .rows[0].n,
    ).toBe(0);

    const agent = await createAgent(c, { name: 'Till' });
    expect(
      (await c.client.request('GET', '/manager/print-settings', { cookies: c.cookies })).json(),
    ).toEqual({ autoPrintReceipts: true });
    const off = await c.client.request('PUT', '/manager/print-settings', {
      cookies: c.cookies,
      body: { autoPrintReceipts: false },
    });
    expect(off.json()).toEqual({ autoPrintReceipts: false });
    await sell();
    expect(await pending(c, agent.token)).toEqual([]);

    await c.client.request('PUT', '/manager/print-settings', {
      cookies: c.cookies,
      body: { autoPrintReceipts: true },
    });
    await sell();
    expect(await pending(c, agent.token)).toHaveLength(1);
  });

  it('gives a branch agent only its branch', async () => {
    const { c, sell } = await shop();
    const other = await createAgent(c, { name: 'Second branch', branchId: c.second });
    const all = await createAgent(c, { name: 'Every branch' });
    await sell();
    expect(await pending(c, other.token)).toEqual([]);
    const [job] = await pending(c, all.token);
    expect((await agentCall(c, other.token, 'POST', `/jobs/${job!.id}/claim`)).statusCode).toBe(
      404,
    );
  });

  it('lets exactly one of two simultaneous claims win; the other gets 409', async () => {
    const { c, sell } = await shop();
    const first = await createAgent(c, { name: 'One' });
    const second = await createAgent(c, { name: 'Two' });
    await sell();
    const [job] = await pending(c, first.token);
    const results = await Promise.all([
      agentCall(c, first.token, 'POST', `/jobs/${job!.id}/claim`),
      agentCall(c, second.token, 'POST', `/jobs/${job!.id}/claim`),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const winner = results.find((r) => r.statusCode === 200)!;
    expect(winner.json()).toEqual({ id: job!.id, html: job!.html, openDrawer: false });
    expect(await pending(c, first.token)).toEqual([]);

    const winnerToken = winner === results[0] ? first.token : second.token;
    const loserToken = winner === results[0] ? second.token : first.token;
    // Only the agent that claimed it reports the result.
    expect(
      (await agentCall(c, loserToken, 'POST', `/jobs/${job!.id}/result`, { ok: true })).statusCode,
    ).toBe(409);
    const done = await agentCall(c, winnerToken, 'POST', `/jobs/${job!.id}/result`, { ok: true });
    expect(done.json()).toEqual({ id: job!.id, status: 'printed' });
    const row = await owner.query(
      `select status, printed_at, attempts from print_jobs where id = $1`,
      [job!.id],
    );
    expect(row.rows[0]).toMatchObject({ status: 'printed', attempts: 0 });
    expect(row.rows[0].printed_at).not.toBeNull();
    expect((await agentCall(c, winnerToken, 'POST', `/jobs/${job!.id}/claim`)).statusCode).toBe(
      409,
    );
  });

  it('records a failure with its error and counts the attempt; a manager reprints a copy', async () => {
    const { c, sell } = await shop();
    const agent = await createAgent(c, { name: 'Till' });
    const sale = await sell();
    const [job] = await pending(c, agent.token);
    await agentCall(c, agent.token, 'POST', `/jobs/${job!.id}/claim`);
    const failed = await agentCall(c, agent.token, 'POST', `/jobs/${job!.id}/result`, {
      ok: false,
      error: 'Printer out of paper',
    });
    expect(failed.json()).toEqual({ id: job!.id, status: 'failed' });
    const row = await owner.query(`select status, attempts, error from print_jobs where id = $1`, [
      job!.id,
    ]);
    expect(row.rows[0]).toEqual({ status: 'failed', attempts: 1, error: 'Printer out of paper' });

    const reprint = await c.client.request('POST', `/manager/sales/${sale.id}/print`, {
      cookies: c.cookies,
    });
    expect(reprint.statusCode).toBe(201);
    // The agent called the API a moment ago: it counts as online.
    expect(reprint.json()).toMatchObject({ status: 'pending', copyNumber: 1, agentOnline: true });
    const [copy] = await pending(c, agent.token);
    expect(copy).toMatchObject({ id: reprint.json().id, orderUuid: sale.id });
    expect(copy!.html).toContain('نسخة رقم 1');
    expect(
      (
        await owner.query(`select kind, created_by_user_id from print_jobs where id = $1`, [
          copy!.id,
        ])
      ).rows[0],
    ).toMatchObject({ kind: 'reprint', created_by_user_id: expect.any(String) });
    expect(
      (await c.client.request('POST', `/manager/sales/${newId()}/print`, { cookies: c.cookies }))
        .statusCode,
    ).toBe(404);
  });

  it('refuses an agent for an unknown branch', async () => {
    const { c } = await shop();
    const bad = await c.client.request('POST', '/manager/print-agents', {
      cookies: c.cookies,
      body: { name: 'x', branchId: newId() },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('print agent socket', () => {
  function connect(token: unknown): Socket {
    return io(`${baseUrl}/print-agent`, {
      path: '/socket.io',
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
  }

  it('refuses an invalid token', async () => {
    const socket = connect('A'.repeat(43));
    const error = await new Promise<Error>((resolve) => socket.on('connect_error', resolve));
    expect(error.message).toBe('unauthorized');
    socket.close();
  });

  it("pushes print:job to the company's agent when a sale completes, and drops it when deleted", async () => {
    const { c, sell } = await shop();
    const agent = await createAgent(c, { name: 'Till' });
    const other = await shop();
    const otherAgent = await createAgent(other.c, { name: 'Other company' });
    const socket = connect(agent.token);
    const foreign = connect(otherAgent.token);
    await Promise.all(
      [socket, foreign].map(
        (s) => new Promise<void>((resolve) => s.on('connect', () => resolve())),
      ),
    );
    const foreignEvents: unknown[] = [];
    foreign.on('print:job', (e: unknown) => foreignEvents.push(e));

    const received = new Promise<{ id: string }>((resolve) => socket.on('print:job', resolve));
    await sell();
    const event = await received;
    const [job] = await pending(c, agent.token);
    expect(event).toEqual({ id: job!.id });
    const claim = await agentCall(c, agent.token, 'POST', `/jobs/${event.id}/claim`);
    expect(claim.statusCode).toBe(200);
    expect(foreignEvents).toEqual([]);

    const dropped = new Promise<string>((resolve) => socket.on('disconnect', resolve));
    await c.client.request('DELETE', `/manager/print-agents/${agent.id}`, { cookies: c.cookies });
    expect(await dropped).toBe('io server disconnect');
    socket.close();
    foreign.close();
  });

  it('lets a device bound to a register print the browser queue with its own token; an unbound device gets 403', async () => {
    const { c, sell, cashier } = await shop();
    const status = async (saleId: string) =>
      (
        await c.client.request('GET', `/pos/sales/${saleId}/print-status`, {
          cookies: cashier.cookies,
        })
      ).json();
    // A device bound to a register (its primary, amendment 4) prints the browser queue.
    const device = async (deviceName: string, bound: boolean) => {
      const res = await c.client.request('POST', '/device/register', {
        body: { email: c.email, password: PASSWORD, deviceName, branchId: c.main },
      });
      expect(res.statusCode).toBe(200);
      const out = res.json() as { token: string; device: { id: string } };
      if (bound) {
        const reg = await c.client.request('POST', '/manager/registers', {
          cookies: c.cookies,
          body: { branchId: c.main, code: `DRW-${deviceName}`, nameEn: `Drawer ${deviceName}` },
        });
        expect(reg.statusCode).toBe(201);
        const b = await c.client.request('PUT', `/manager/devices/${out.device.id}`, {
          cookies: c.cookies,
          body: { registerId: reg.json().id },
        });
        expect(b.statusCode).toBe(200);
      }
      return out;
    };
    const primary = await device('Front', true);
    const extra = await device('Back', false);

    // No standalone agent: the primary device alone makes the browser sale queue its receipt.
    const socket = connect(primary.token);
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
    const received = new Promise<{ id: string }>((resolve) => socket.on('print:job', resolve));
    const sale = await sell();
    const event = await received;
    const [job] = await pending(c, primary.token);
    expect(job).toMatchObject({ id: event.id, orderUuid: sale.id, openDrawer: false });
    expect(await status(sale.id)).toEqual({
      status: 'pending',
      jobId: job!.id,
      error: null,
      printerOnline: true,
    });
    const claim = await agentCall(c, primary.token, 'POST', `/jobs/${job!.id}/claim`);
    expect(claim.json()).toMatchObject({ id: job!.id, openDrawer: false });
    const done = await agentCall(c, primary.token, 'POST', `/jobs/${job!.id}/result`, { ok: true });
    expect(done.json()).toEqual({ id: job!.id, status: 'printed' });
    expect((await status(sale.id)).status).toBe('printed');
    const row = await owner.query(
      `select agent_id, device_id, status from print_jobs where id = $1`,
      [job!.id],
    );
    expect(row.rows[0]).toEqual({
      agent_id: null,
      device_id: primary.device.id,
      status: 'printed',
    });

    // The additional device is refused on REST and on the socket.
    const refused = await agentCall(c, extra.token, 'GET', '/jobs/pending');
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe('NOT_PRIMARY_DEVICE');
    const extraSocket = connect(extra.token);
    const error = await new Promise<Error>((resolve) => extraSocket.on('connect_error', resolve));
    expect(error.message).toMatch(/^forbidden/);
    extraSocket.close();

    // Unbound by a manager, the old primary is disconnected and refused from then on.
    const dropped = new Promise<string>((resolve) => socket.on('disconnect', resolve));
    await c.client.request('PUT', `/manager/devices/${primary.device.id}`, {
      cookies: c.cookies,
      body: { registerId: null },
    });
    expect(await dropped).toBe('io server disconnect');
    expect((await agentCall(c, primary.token, 'GET', '/jobs/pending')).statusCode).toBe(403);
    socket.close();
  });
});
