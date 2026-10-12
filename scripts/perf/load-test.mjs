#!/usr/bin/env node
/**
 * Reproducible load and latency measurement against a running API (production build).
 * Creates its own merchant (never touches other data), a large catalog with stock, many
 * concurrent POS sales, then measures read endpoints. Development/staging only.
 *
 *   node scripts/perf/load-test.mjs --base http://localhost:3100 --products 5000 --sales 3000 --concurrency 16
 */
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    base: { type: 'string', default: 'http://localhost:3100' },
    products: { type: 'string', default: '2000' },
    sales: { type: 'string', default: '1000' },
    concurrency: { type: 'string', default: '16' },
    reads: { type: 'string', default: '30' },
  },
});
const BASE = `${values.base.replace(/\/$/, '')}/api/v1`;
const N_PRODUCTS = Number(values.products);
const N_SALES = Number(values.sales);
const CONCURRENCY = Number(values.concurrency);
const READS = Number(values.reads);

const jar = {};
async function call(method, path, body, cookieName) {
  const headers = { 'content-type': 'application/json', origin: values.base };
  const cookie = Object.entries(jar)
    .filter(([k]) => !cookieName || k === cookieName)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  if (cookie) headers.cookie = cookie;
  const started = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const ms = performance.now() - started;
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const [k, v] = pair.split('=');
    jar[k] = v;
  }
  const text = await res.text();
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return { json: text ? JSON.parse(text) : null, ms, bytes: text.length };
}

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    n: s.length,
    p50: +q(0.5).toFixed(1),
    p95: +q(0.95).toFixed(1),
    p99: +q(0.99).toFixed(1),
    max: +s[s.length - 1].toFixed(1),
  };
}

async function pool(count, worker) {
  const latencies = [];
  let next = 0;
  let failures = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < count) {
        const i = next++;
        try {
          latencies.push(await worker(i));
        } catch (error) {
          failures += 1;
          if (failures <= 3) console.error(String(error).slice(0, 300));
        }
      }
    }),
  );
  const seconds = (performance.now() - started) / 1000;
  return { ...stats(latencies), failures, perSecond: +(latencies.length / seconds).toFixed(1) };
}

const report = { products: N_PRODUCTS, sales: N_SALES, concurrency: CONCURRENCY };
const email = `perf.${Date.now().toString(36)}@perf.arabat.test`;
await call('POST', '/auth/register', {
  company: { nameEn: `Perf Co ${Date.now()}` },
  owner: { fullName: 'Perf Owner', email, password: 'Perf-Pass-2026' },
});
const branch = (await call('GET', '/manager/branches', undefined, 'mgr_sid')).json.branches[0].id;

// 1. Catalog.
const variants = [];
report.createProduct = await pool(N_PRODUCTS, async (i) => {
  const r = await call(
    'POST',
    '/manager/products',
    {
      nameEn: `Product ${i} ${['tea', 'coffee', 'dates', 'juice', 'cake'][i % 5]}`,
      variants: [
        {
          sku: `P${i}`,
          price: `${1 + (i % 9)}.${String((i * 37) % 1000).padStart(3, '0')}`,
          cost: '0.500',
        },
      ],
    },
    'mgr_sid',
  );
  variants.push(r.json.variants[0].id);
  return r.ms;
});

// 2. Opening stock (batches of 200 lines).
const batches = [];
for (let i = 0; i < variants.length; i += 200) batches.push(variants.slice(i, i + 200));
report.openingStock = await pool(
  batches.length,
  async (i) =>
    (
      await call(
        'POST',
        '/manager/inventory/adjustments',
        {
          branchId: branch,
          kind: 'opening',
          reason: 'opening',
          lines: batches[i].map((variantId) => ({
            variantId,
            quantity: '1000',
            unitCost: '0.500',
          })),
        },
        'mgr_sid',
      )
    ).ms,
);

// 3. Concurrent POS sales on one open shift.
const methods = (await call('GET', '/manager/payment-methods', undefined, 'mgr_sid')).json.methods;
const card = methods.find((m) => m.kind === 'card').id;
const registers = (await call('GET', `/manager/registers?branchId=${branch}`, undefined, 'mgr_sid'))
  .json.registers;
await call(
  'POST',
  '/auth/manager/switch-interface',
  { target: 'pos', branchId: branch },
  'mgr_sid',
);
await call(
  'POST',
  '/pos/shifts',
  { registerId: registers[0].id, openingFloat: '10.000' },
  'pos_sid',
);
const catalog = await call('GET', '/pos/catalog', undefined, 'pos_sid');
const again = await call('GET', '/pos/catalog', undefined, 'pos_sid');
report.posCatalog = {
  firstMs: +catalog.ms.toFixed(1),
  secondMs: +again.ms.toFixed(1),
  kilobytes: Math.round(catalog.bytes / 1024),
  items: catalog.json.items?.length,
};
const price = new Map(catalog.json.items.map((it) => [it.variantId, it.price.amount]));
report.checkout = await pool(N_SALES, async (i) => {
  const picks = [variants[(i * 7) % variants.length], variants[(i * 13 + 1) % variants.length]];
  const totalFils = picks.reduce((sum, v) => sum + Math.round(Number(price.get(v)) * 1000) * 2, 0);
  const amount = (totalFils / 1000).toFixed(3);
  return (
    await call(
      'POST',
      '/pos/sales',
      {
        idempotencyKey: randomUUID(),
        lines: picks.map((variantId) => ({ variantId, quantity: '2' })),
        payments: [{ methodId: card, amount }],
        expectedTotal: amount,
      },
      'pos_sid',
    )
  ).ms;
});

// 4. Reads (sequential, warm).
const today = new Date().toISOString().slice(0, 10);
const reads = {
  productsPage: '/manager/products?page=1&pageSize=25',
  productsSearch: '/manager/products?q=coffee&page=1&pageSize=25',
  inventoryLevels: `/manager/inventory/levels?branchId=${branch}&page=1&pageSize=50`,
  salesPage: '/manager/sales?page=1&pageSize=25',
  salesReportToday: `/manager/reports/sales?from=${today}&to=${today}`,
  inventoryReport: `/manager/reports/inventory?from=${today}&to=${today}`,
  paymentsReport: `/manager/reports/payments?from=${today}&to=${today}`,
};
report.reads = {};
for (const [name, path] of Object.entries(reads)) {
  const samples = [];
  for (let i = 0; i < READS; i += 1)
    samples.push((await call('GET', path, undefined, 'mgr_sid')).ms);
  report.reads[name] = stats(samples);
}
const posSamples = [];
for (let i = 0; i < Math.min(READS, 10); i += 1)
  posSamples.push((await call('GET', '/pos/catalog', undefined, 'pos_sid')).ms);
report.reads.posCatalogFull = stats(posSamples);
console.log(JSON.stringify(report, null, 2));
