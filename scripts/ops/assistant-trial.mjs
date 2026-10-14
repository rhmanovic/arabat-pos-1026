// Live trial of the POS assistant (ADR-0105) against a running API on the demo seed data.
// Signs in the demo owner (creates "Pepsi can" with 48 in stock at the main branch and a
// cash method if missing), then the demo cashier (shift on Register 1, one cash sale of two
// cans) and sends three Arabic questions to POST /pos/assistant/chat. Prints every answer
// and `toolsUsed`; token counts per turn are in the API log ("assistant turn: N in / M out").
//
//   pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm build
//   (cd apps/api && ANTHROPIC_API_KEY=… node --env-file-if-exists=../../.env dist/main.js)
//   node scripts/ops/assistant-trial.mjs            # API_URL defaults to localhost:3000
//
// Without the key the API answers 503 ASSISTANT_DISABLED and nothing is billed.
import { randomUUID } from 'node:crypto';

const BASE = process.env['API_URL'] ?? 'http://localhost:3000/api/v1';
const PASSWORD = 'Demo-Pass-2026';
const QUESTIONS = [
  'كيف أعلّق عملية البيع؟',
  'كم سعر بيبسي علبة وكم المتوفر؟',
  'شنو بعت في هالوردية؟',
];

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
for (const content of QUESTIONS) {
  const started = Date.now();
  const r = await cashier('POST', '/pos/assistant/chat', {
    messages: [{ role: 'user', content }],
    language: 'ar',
    cart,
  });
  console.log(`\n=== ${content}\nHTTP ${r.status} in ${Date.now() - started} ms`);
  console.log(JSON.stringify(r.json, null, 2));
}
