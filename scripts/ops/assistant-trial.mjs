// Live trial of the POS assistant (ADR-0105) against a running API on the demo seed data.
// Signs in the demo owner (creates "Pepsi can" with 48 in stock at the main branch and a
// cash method if missing), then the demo cashier (shift on Register 1, one cash sale of two
// cans) and sends three Arabic questions to POST /pos/assistant/chat. Prints every answer
// and `toolsUsed`. With `--log <api log file>` it also reads the API's per-turn usage lines
// ("assistant turn: N in / M out, cache write W / read R") written during each question and
// prints the token counts and the estimated cost at the list price of `ASSISTANT_MODEL`.
//
//   pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm build
//   (cd apps/api && env -u ANTHROPIC_BASE_URL ANTHROPIC_API_KEY="$ARABAT_ANTHROPIC_API_KEY" \
//     node --env-file-if-exists=../../.env dist/main.js > ../../var/api.log 2>&1 &)   # cloud sandbox
//   node scripts/ops/assistant-trial.mjs --log var/api.log     # API_URL defaults to localhost:3000
//
// Without the key the API answers 503 ASSISTANT_DISABLED and nothing is billed.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000/api/v1';
const PASSWORD = 'Demo-Pass-2026';
const QUESTIONS = [
  'كيف أعلّق عملية البيع؟',
  'كم سعر بيبسي علبة وكم المتوفر؟',
  'شنو بعت في هالوردية؟',
];
const LOG = process.argv.includes('--log') ? process.argv[process.argv.indexOf('--log') + 1] : null;
const MODEL = process.env['ASSISTANT_MODEL'] ?? 'claude-opus-5-5';
/** USD per million tokens (list prices, 2026-10): input, output, cache write (1.25×), cache read. */
const PRICES = {
  'claude-opus-5-5': { in: 4, out: 20, write: 5, read: 0.2 },
  'claude-sonnet-5-5': { in: 2, out: 10, write: 2.5, read: 0.2 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, write: 0.125, read: 0.01 },
};
const TURN = /assistant turn: (\d+) in \/ (\d+) out, cache write (\d+) \/ read (\d+), stop (\w+)/g;

function readLog() {
  return LOG ? readFileSync(LOG, 'utf8') : '';
}

/** Token totals and cost of the turns logged since `before`. */
function usageSince(before) {
  const fresh = readLog().slice(before.length);
  const turns = [...fresh.matchAll(TURN)].map(([, i, o, w, r, stop]) => ({
    in: Number(i),
    out: Number(o),
    write: Number(w),
    read: Number(r),
    stop,
  }));
  const sum = (k) => turns.reduce((t, u) => t + u[k], 0);
  const p = PRICES[MODEL];
  const cost = p
    ? (sum('in') * p.in + sum('out') * p.out + sum('write') * p.write + sum('read') * p.read) / 1e6
    : null;
  return { turns, in: sum('in'), out: sum('out'), write: sum('write'), read: sum('read'), cost };
}

function session() {
  const cookies = new Map();
  return async function call(method, path, body) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        'content-type': 'application/json',
        cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const [k, v] = pair.split('=');
      if (!v || /Max-Age=0/i.test(raw)) cookies.delete(k);
      else cookies.set(k, v);
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json };
  };
}

function must(r, what) {
  if (r.status >= 400) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
}

// ------------------------------------------------------------ owner: product, stock, cash
const owner = session();
must(
  await owner('POST', '/auth/login', {
    interface: 'manager',
    email: 'owner@demo.arabat.test',
    password: PASSWORD,
  }),
  'owner login',
);
const main = must(await owner('GET', '/manager/branches'), 'branches').branches.find(
  (b) => b.code === 'MAIN',
);
let pepsi = must(await owner('GET', '/manager/products'), 'products').products.find(
  (p) => p.nameAr === 'بيبسي علبة',
);
if (pepsi) {
  pepsi = must(await owner('GET', `/manager/products/${pepsi.id}`), 'product');
} else {
  pepsi = must(
    await owner('POST', '/manager/products', {
      nameEn: 'Pepsi can',
      nameAr: 'بيبسي علبة',
      variants: [{ sku: 'PEPSI-330', price: '0.150', cost: '0.090', barcodes: ['6281006110014'] }],
    }),
    'create product',
  );
  must(
    await owner('POST', '/manager/inventory/adjustments', {
      branchId: main.id,
      kind: 'opening',
      reason: 'opening',
      lines: [{ variantId: pepsi.variants[0].id, quantity: '48' }],
    }),
    'opening stock',
  );
  console.log('Created "Pepsi can" with 48 in stock at the main branch.');
}
const variantId = pepsi.variants[0].id;
if (
  !must(await owner('GET', '/manager/payment-methods'), 'methods').methods.some(
    (m) => m.kind === 'cash',
  )
) {
  must(
    await owner('POST', '/manager/payment-methods', {
      kind: 'cash',
      nameEn: 'Cash',
      nameAr: 'نقد',
    }),
    'create cash method',
  );
}

// ------------------------------------------------------------ cashier: shift and a sale
const cashier = session();
const login = must(
  await cashier('POST', '/auth/login', {
    interface: 'pos',
    email: 'cashier@demo.arabat.test',
    password: PASSWORD,
  }),
  'cashier login',
);
if (login.status === 'select_merchant') {
  const demo = login.merchants.find((m) => m.nameEn === 'Demo Store');
  must(
    await cashier('POST', '/auth/login/select', {
      ticket: login.ticket,
      merchantId: demo.id,
      branchId: demo.branches[0].id,
    }),
    'select merchant',
  );
}
if (!must(await cashier('GET', '/pos/shifts/current'), 'current shift').shift) {
  const register = must(await cashier('GET', '/pos/registers'), 'registers').registers[0];
  must(
    await cashier('POST', '/pos/shifts', {
      registerId: register.id,
      countedCash: '10.000',
      ...(register.expectedCash ? { expectedCash: register.expectedCash.amount } : {}),
    }),
    'open shift',
  );
  console.log(`Shift opened on ${register.nameEn}.`);
}
const cash = must(await cashier('GET', '/pos/payment-methods'), 'pos methods').methods.find(
  (m) => m.kind === 'cash',
);
const sale = must(
  await cashier('POST', '/pos/sales', {
    idempotencyKey: randomUUID(),
    lines: [{ variantId, quantity: '2' }],
    payments: [{ methodId: cash.id, amount: '0.300', tendered: '1.000' }],
    expectedTotal: '0.300',
  }),
  'sale',
);
console.log(`Sale ${sale.receiptNumber}: 2 × Pepsi can, cash.`);

// ------------------------------------------------------------ the assistant
const status = await cashier('GET', '/pos/assistant');
console.log(`\nGET /pos/assistant -> ${status.status} ${JSON.stringify(status.json)}`);
const cart = {
  lines: [{ name: 'بيبسي علبة', quantity: '1', unitPrice: '0.150', lineTotal: '0.150' }],
  total: '0.150',
  customer: null,
};
const total = { in: 0, out: 0, write: 0, read: 0, cost: 0 };
for (const content of QUESTIONS) {
  const before = readLog();
  const started = Date.now();
  const r = await cashier('POST', '/pos/assistant/chat', {
    messages: [{ role: 'user', content }],
    language: 'ar',
    cart,
  });
  console.log(`\n=== ${content}\nHTTP ${r.status} in ${Date.now() - started} ms`);
  console.log(JSON.stringify(r.json, null, 2));
  if (LOG) {
    const u = usageSince(before);
    for (const t of u.turns)
      console.log(
        `  turn: ${t.in} in / ${t.out} out, cache write ${t.write} / read ${t.read}, stop ${t.stop}`,
      );
    console.log(
      `  tokens: ${u.in} in, ${u.out} out, ${u.write} cache write, ${u.read} cache read` +
        (u.cost === null ? '' : ` → about $${u.cost.toFixed(4)} (${MODEL} list price)`),
    );
    for (const k of Object.keys(total)) total[k] += u[k] ?? 0;
  }
}
if (LOG && PRICES[MODEL])
  console.log(
    `\nTotal: ${total.in} in, ${total.out} out, ${total.write} cache write, ${total.read} cache read → about $${total.cost.toFixed(4)}`,
  );
