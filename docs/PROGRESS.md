# Progress

Only record what has actually been done and verified. Mocked or partial work
must be labeled as such.

## Current state (2026-10-12, after Prompt 15 — restaurant module)

| Area | Status | Notes |
|---|---|---|
| Documentation & architecture | Done | `CLAUDE.md`, `README.md`, `docs/*` |
| Monorepo & tooling | Done | pnpm 12 workspaces, TS 6 strict, ESLint 10, Prettier, Node 24 |
| Backend foundation | Done | NestJS 12 + Fastify 5, config validation, problem+json errors, pino logs, request ids, Zod validation pipe, health endpoints, helmet/CSP |
| Authentication & sessions | Done | Owner registration, sign-in (manager/POS/platform+TOTP), merchant/branch selection, interface & merchant switching, logout, password recovery, rate limits, CSRF origin check |
| Organization & RBAC | Done (API) | Branch CRUD/activation/settings, invitations, employee profile/status/assignments, roles CRUD, 40-key permission catalog, 5 default roles, anti-escalation, POS branch switch. Management screens done (Prompt 6) |
| Database foundation | Done | PostgreSQL 18 (Compose), Drizzle, migrations, owner/runtime roles, RLS helper, seeds |
| Frontend foundation | Done | 3 separate Vite apps + shared packages; ManagerLayout / POSLayout / PlatformLayout; ar/en + RTL/LTR; auth state & protected routes; API client |
| Manager app | Done for implemented modules | Layout (role-aware sidebar, top bar with merchant/branch context, user menu), dashboard (real counts + onboarding), company profile, branches, employees, invitations, role assignments, roles & permission matrix |
| Product catalog | Done | Categories, products, variants, SKU/barcodes, prices (fils), costs (permission), branch availability, images, archive; manager screens; POS catalog API |
| Inventory | Done | Per-branch balances, append-only ledger, opening/increase/decrease/count documents with reasons, idempotency, row-locked concurrency, no-oversell policy, thresholds, weighted-average valuation, history, manager screens, POS availability API, reusable engine for sales/refunds/transfers |
| Payments, registers, shifts | Done | Per-merchant payment methods with exact fees, internal balances (entries ledger), gateway placeholder (not live), registers with access control, shifts with cash in/out, expected vs counted cash, discrepancy, force close, manager monitoring and report, POS shift screens |
| POS & checkout | Done | Sale screen (search/scan, categories, cart, discounts, price override by permission, split payments, change, receipt + print, hold/resume, recent sales), atomic idempotent checkout, receipt numbers, manager sales history |
| Returns & refunds | Done | Full/partial/quantity returns, exchanges, voids, reasons, eligibility (window, limit), supervisor/manager approval, conditional restock, per-tender pay-back, gateway-safe states, history, unusual-activity report, refund receipts |
| Purchasing & transfers | Done | Suppliers, purchase orders with approval and separation of duties, partial/full idempotent receiving into stock at cost, close/cancel rules, branch transfers (request, approve, dispatch/in transit, receive with discrepancy), manager screens |
| Customers | Done | Profiles (C-numbers, normalised unique phone), search/filter/sort, edit, activate/deactivate, append-only notes, purchase and refund history, exact spending summary scoped by branch, POS search/create/select, walk-in sales, customer on receipts, held sales and exchanges |
| Reporting | Done | Sales (gross, discounts, net, refunds, by day/hour/branch/employee/product/category/method, trend, comparison, gross profit under policy), payments & cash (collections, fees, pay-outs, cash), shifts (reconciliation, discrepancies), inventory (valuation, stock, movements, adjustments, quantities), purchasing (suppliers, receipts, transfers); dashboard with KPIs, charts, filters and CSV export |
| Restaurant | Done (optional module) | Module switch, areas/tables, stations with category routing, modifier groups (required/optional), recipes and modifier ingredients, table/takeaway/pickup orders, modifiers and notes, send to kitchen, kitchen display, cancel/waste, move/combine, split bills via the checkout engine, receipts with modifiers, restaurant sales in lists and reports |
| Cash custody (phases A, B, C) | Done | Register drawers keep their balance between shifts, a treasury per branch, counts at open/close, forced close with or without a count, register ↔ treasury transfers, manager cash page with statements, cutover of the old cash account (ADR-0090). Phase B: expenses by category and supplier payments (POS drawer or treasury, reversals, supplier page), bank deposits with `cash.deposit`, branch-to-branch transfers through in-transit (ADR-0091). Phase C: cash by type in the payments report, expenses report (category, branch, source, supplier), discrepancy sections (close type, between shifts, after an uncounted close), dashboard total cash (ADR-0092) |
| Automated tests | Passing | 155 unit/web, 171 integration, 35 E2E (local, 2026-10-12, cash custody phase C) |
| CI | Written, not yet run | `.github/workflows/ci.yml` |
| Business modules | Not started | Begin in M1 |
| Deployment | Staging on Railway; production live on Google Cloud, Doha (2026-10-15) | `https://www.arabatapp.com` (ADR-0105, OPERATIONS.md §9); started empty; SMTP, alert policies and the backup-bucket lock still open |

## Log

Entries below are a dated log: each "Not done yet" note describes the state on that date
(later entries record what was completed since).

### 2026-10-11 — Session 1: Project foundation
- Created `CLAUDE.md` with permanent requirements and working procedure.
- Created `docs/ARCHITECTURE.md`, `DATABASE.md`, `BUSINESS_RULES.md`,
  `DECISIONS.md`, `ROADMAP.md`, `PROGRESS.md`, `TESTING.md`.
- Recorded ADR-0001 (separate Manager / POS / Platform interfaces) through ADR-0008.
- Recorded open business questions OQ-001..OQ-010.
- No business modules built (by instruction).
- Environment observed: Node.js 22 and pnpm 10 available locally, PostgreSQL 16
  cluster present (stopped). Target Node.js line is confirmed at scaffold time.

### 2026-10-11 — Session 2: System architecture
- Verified stable versions (npm registry, nodejs.org, postgresql.org) and
  recorded the stack in `ARCHITECTURE.md` §2 and ADR-0009/0010.
- Rewrote `ARCHITECTURE.md`: app boundaries, 19 domain modules + dependency
  graph, shared-service pattern, API design, i18n/RTL, KWD precision, local
  environment, deployment design (not deployed), scalability path.
- Added `AUTH.md` (sessions, realms, branch-scoped roles, guard pipeline,
  manager override) and `ROUTES.md` (all three apps + API namespaces).
- `DATABASE.md`: renamed tenant → merchant, ERDs for identity/access,
  catalog/inventory, registers/sales/payments/refunds; later-module entities.
- `ROADMAP.md`: milestones M0–M10 with acceptance criteria.
- `BUSINESS_RULES.md`: BR-016..BR-019 confirmed, BR-024..BR-027 defaults,
  OQ-011..OQ-013 added.
- ADR-0011..ADR-0018 recorded.
- Nothing implemented; no tests exist yet (no code).

### 2026-10-11 — Session 3: Milestone M0 (engineering foundation)
Implemented:
- **Backend** `apps/api`: env validation (fail fast), modular root module, global
  prefix `/api/v1`, RFC 9457 error filter (no internal detail leakage), pino JSON
  logging with redaction and `x-request-id`, `ZodPipe` validation, helmet + CSP,
  cookies plugin, `GET /health/live` + `/health/ready` (503 when DB down),
  `GET /auth/{manager|pos|platform}/me` (401 until M1), default-deny `AccessGuard`
  with decorators `@Public/@Authenticated/@RequirePermission/@RequirePlatformRole`,
  `RouteAccessAuditor`, optional SPA serving (`SERVE_WEB`).
- **Database**: Compose `postgres:18` with init script (roles `app_owner`,
  `app_runtime`; DBs `arabat_dev`, `arabat_test`); `DatabaseService` (pool,
  transactions, `withMerchantTx` for RLS); migrations `0000_bootstrap`,
  `0001_currencies`; idempotent environment-aware seed runner.
- **Shared packages**: `money` (bigint, half-up, allocation), `permissions`
  (catalog + `can()`), `contracts` (Zod), `api-client`, `i18n`, `ui`, `web-core`.
- **Frontend**: `manager-web` (sidebar dashboard shell, responsive drawer),
  `pos-web` (full-screen touch register shell, no navigation), `platform-web`
  (dark operator console). Each has its own sign-in page — **disabled** with an
  explanation until M1 (no fake login). Language switch persists and flips
  `dir`; live API/DB status indicator.
- **Infrastructure**: `.env.example`, `pnpm setup:local`, `pnpm dev`,
  `pnpm verify`, Vitest projects, Playwright, GitHub Actions CI.

Verified (commands actually run in this session):
- Fresh database: `docker compose down -v` → `pnpm setup:local` → migrations and
  seeds applied; re-running is idempotent.
- `pnpm verify` → exit 0 (79 tests). `pnpm test:integration` → 10/10.
  `pnpm test:e2e` → 12/12 in Chromium (desktop + tablet).
- `pnpm dev`: all three Vite servers load in a real browser and reach the API via
  the proxy.
- Runtime role cannot modify reference data and is subject to RLS; merchant A
  cannot read or write merchant B rows in the probe table.

Problems found and fixed during verification:
- `NODE_ENV=development` in `.env` leaked into Vite builds (React dev build
  bundled) → removed from `.env.example`, build guard added.
- Vite inlined small fonts as `data:` URIs, blocked by CSP → font inlining
  disabled (caught by the E2E "no browser errors" test).
- Missing hashed assets returned the HTML shell → now 404.
- `upgrade-insecure-requests` CSP would break http://localhost → production only.

Not done / open:
- CI workflow has not executed on GitHub yet.
- Mailpit deferred to M1. Radix primitives deferred until first dialog/menu (ADR-0023).
- Vendor bundle ≈ 288 kB (gzip ≈ 88 kB) + React ≈ 219 kB (gzip ≈ 68 kB) per app;
  route-level code splitting to be added as features grow.
- Cloud sandbox specifics (not part of the repo): Node 24 installed under
  `~/.local/node24`, Docker daemon started manually.

### 2026-10-11 — Prompt 4: Merchant accounts and authentication
Implemented: identity schema + RLS (migrations 0002/0003), `DbSessionResolver`,
registration, login with merchant/branch selection tickets, platform TOTP, logout,
password recovery (Mailpit), `me`/merchants/switch APIs, company profile and branch
list APIs, audit events, DB rate limits, origin check, dev seeds and operator CLI.
UI: manager sign-in/registration/recovery, POS touch sign-in + branch choice, platform
sign-in + TOTP step, session info, sign-out and manager↔POS switching in layouts.

Verified: `pnpm verify` (82 tests), `pnpm test:integration` (36 tests incl. tenant
isolation, enumeration, lockout, expiry, revocation, TOTP replay, CSRF),
`pnpm test:e2e` (18 tests: registration→dashboard→logout→login, recovery through
Mailpit, cashier routed to POS, owner switch with branch choice, manager denied POS,
operator TOTP).

Found and fixed: Drizzle CLI/test connections without `casing: 'snake_case'`; logout
race where guards briefly saw the old session.

### 2026-10-11 — Prompt 5: Branches, employees and permissions
Implemented: migrations 0004/0005 (invitations, branch settings, employee profile, RLS,
permission-key data migration), granular catalog + templates (company manager, branch
manager, supervisor, cashier), `canGrant`/`canManageMember`/`canAnywhere`, branches,
roles, employees and invitation services/APIs, invitation acceptance pages (manager &
POS), POS branch switching, role-template sync seed.
Verified: unit (anti-escalation rules), 16 new integration tests (invitation flow,
existing-account confirmation, expiry/revocation, branch-manager limits, owner
protection, no self-promotion, role editing limits, version conflicts, deactivation
revoking sessions, branch deactivation, cross-merchant isolation incl. raw RLS), E2E
invited cashier sets password and works only in the POS.
Note: management screens for these APIs are delivered with Prompt 6.

### 2026-10-11 — Prompt 6: Manager dashboard
Implemented: Radix-based primitives (dialogs, menus, tabs, toasts, tables),
direction provider, `useNotify`; ManagerLayout rewrite (role-aware sections, disabled
"not available yet" modules, branch context selector, merchant switcher, user menu
with language/POS switch/sign-out, phone drawer); dashboard with only real figures
(branches, employees, invitations, roles) and onboarding checklist; company settings;
branch list/create/edit/settings/activation; employee list with search/status/branch
filters, invitation tab (resend/revoke), invite dialog with role×branch assignments;
employee detail (profile, roles, status with confirmation, password-reset e-mail);
roles list and permission-matrix editor that locks permissions the editor lacks.
Verified: web tests (role-aware nav, disabled modules, route guard), E2E: owner edits
profile, creates branch, creates custom role, invites cashier via dialog, cashier
accepts and works only in POS at that branch (management API 401), owner adds role
and deactivates; company manager cannot grant POS roles; phone layout without
horizontal overflow. Visual check in Arabic RTL desktop and English tablet.
Found and fixed: screen-reader-only table labels caused horizontal page overflow on
phones (table wrapper now `relative`).

### 2026-10-11 — Prompt 7: Product catalog
Implemented: migrations 0006/0007 (catalog tables, forced RLS, no deletes, trigram
search indexes); `CatalogService` (categories with cycle check, products with variants,
SKU/barcodes, exact money parsing, cost hidden without `catalog.prices.manage`, audited
price changes, branch availability, archive/restore, images via `FileStorage`);
manager screens (product list with search/filters/sort/pagination, product editor,
categories); POS catalog snapshot API with ETag.
Verified: 14 catalog integration tests, catalog E2E, web nav tests.
Found and fixed: Drizzle bound unqualified columns inside correlated subqueries to the
inner table (now explicitly qualified); reusing a removed variant's barcode in the same
save failed (removed variants are archived first).
Not done yet: the POS sale screen uses this catalog from Prompt 10; inventory columns
come with Prompt 8.

### 2026-10-11 — Prompt 8: Inventory engine
Implemented: exact quantity helpers in `@arabat/money`; migrations 0008/0009 (settings,
levels, adjustments, lines, ledger; forced RLS; append-only grants);
`StockLedgerService` (the single balance-changing engine, row locks in fixed order,
all-or-nothing validation, weighted-average cost, negative-stock policy, opening-stock
guard); `InventoryService` (documents with reasons and idempotency keys, levels with
search/filters/sort/aggregation, summary and valuation, per-variant branch breakdown,
thresholds, history with merchant-time-zone date filters, settings, POS availability);
manager screens (stock list, adjustment editor, adjustment list/detail, movement
history, threshold and settings dialogs) in Arabic/English.
Verified: see TESTING.md (unit, 12 integration incl. concurrency, web, E2E); Arabic RTL
desktop screenshots checked; phone width has no horizontal overflow.
Not done yet (by design, later prompts): sales deduct stock in Prompt 10, refunds
restock in 11, transfers and purchase receipts in 12 — all through the same engine.
Open question for the owner: OQ-014 (weighted average vs FIFO).

### 2026-10-12 — Prompt 9: Payments, registers and shifts
Implemented: `processingFee()` in `@arabat/money`; migrations 0010–0012; payments module
(methods, internal balances, defaults for new merchants/branches, seed for existing
ones); registers module (`ShiftsService`: registers, access, open/close, cash movements,
monitoring, discrepancy report, force close); manager screens (payment methods with fee
preview, internal balances, registers, shifts, shift detail, discrepancy report); POS
(shift gate, open shift, shift strip, cash in/out, close with coin count, result).
Verified: see TESTING.md; Arabic RTL tablet screenshots checked.
Found and fixed: `Money.parse('')` threw an unexpected error type that crashed amount
fields (ADR-0050).
Not done yet (by design): cash sales/refunds feed expected cash from Prompts 10/11;
fees are stored per payment in Prompt 10; no gateway is connected (Prompt 16, sandbox).
Open question: OQ-015 (blind closing).

### 2026-10-12 — Prompt 10: Employee POS and checkout engine
Implemented: `priceCart()`; migrations 0013/0014; sales module (`SalesService`: atomic
checkout, idempotency, discounts/limits/overrides, payments with fees and balance
entries, receipt numbering, held orders, receipts, recent and manager history, selling
policy); shift expected cash now includes cash sales; POS sale screen with dialogs and
80 mm print layout; manager sales list/detail/policy.
Verified: see TESTING.md, including the full acceptance scenario; Arabic RTL tablet
screenshots checked (fixed: toasts covered the Pay button → POS toasts at the top;
receipt date order in Arabic; monospace font removed for Arabic).
Not done yet (later prompts): refunds/voids (11), customer on sale (13), offline
selling (OQ-005), tax (OQ-002), receipt legal fields (OQ-009), quick PIN switching
(OQ-006).

### 2026-10-12 — Prompt 11: Returns, refunds and exchanges
Implemented: migrations 0015–0017; refunds module (`RefundsService`: lookup, preview,
refund, void, exchange via the checkout engine, approve/reject/withdraw, receipts,
history, activity); shift expected cash includes cash refunds; sales show refunded and
net amounts; POS returns screen; manager returns page and refund policy settings.
Verified: see TESTING.md.
Not done yet / open: OQ-016 (fee reversal), OQ-017 (no-receipt / cross-branch returns);
gateway refund confirmation arrives with Prompt 16.

### 2026-10-12 — Prompt 12: Suppliers, purchasing and transfers
Implemented: migrations 0018–0019; document numbering; purchasing module (suppliers,
purchase orders, approval, receipts via the stock ledger with order lock and idempotency);
transfers module (request, approve, dispatch out, receive in at dispatch cost, discrepancy
write-off); manager screens for suppliers, purchase orders and transfers.
Verified: see TESTING.md.
Not done yet / open: supplier invoices, payments and balances (accounts payable) and
purchase returns to suppliers are not implemented (OQ-018); landed costs are not
allocated; transfer discrepancies are not reported separately yet (Prompt 14).

### 2026-10-12 — Prompt 13: Customer management
Implemented: migrations 0020–0021; customers module (manager and POS APIs, notes,
history and spending); `customer_id` on orders and sales (checkout, held sales,
exchanges); manager customer list/detail; POS customer picker and receipt line; sales
list/detail show the customer.
Verified: see TESTING.md.
Not done yet / open: loyalty, store credit and promotions (OQ-019, by design not built);
personal-data erasure (OQ-019); attaching a customer to a sale after it was completed is
not possible (sales are immutable).

### 2026-10-12 — Prompt 14: Financial reporting and analytics
Implemented: migration 0022 (report indexes); reports module (5 endpoints, exact
aggregation, local-day periods, comparison, branch/employee filters, permission scope);
`/manager/reports` dashboard with KPI cards, charts, report tables and CSV exports;
metric definitions (BR-120…BR-129, ADR-0068…0071).
Verified: see TESTING.md.
Not done yet / open: no scheduled/e-mailed reports; no XLSX (CSV opens in spreadsheet
apps); profit excludes tax/overheads/landed costs by policy; very large merchants may
later need summary tables (ADR-0068).

### 2026-10-12 — Prompt 15: Restaurant operations
Implemented: migrations 0023–0024; restaurant module (configuration, orders, bills,
kitchen tickets); checkout engine extended with modifiers, recipe/modifier ingredient
consumption and restaurant links; new permissions and the `kitchen` role; manager
restaurant screens; POS floor, order and kitchen screens; service type in sales and
reports.
Verified: see TESTING.md.
Not done yet / open: OQ-020 (service charge/tips, courses, kitchen printers,
reservations); split by equal shares is done as several tenders on one bill (no
fractional item splitting); waiters need an open shift to use the floor screen.

### 2026-10-12 — Prompt 16: Online store and payment gateway abstraction
Implemented: migrations 0025–0026; `ecommerce` module (store settings, listings, public
storefront API, checkout with idempotency and server pricing, stock reservations honoured
by POS sales and transfers, online orders with fulfilment steps, payment attempts and
append-only gateway events, signed webhooks, lazy + background reconciliation); payment
gateway abstraction with Tap/UPayments/Hesabe/Bookeey adapters (not connected) and a
sandbox adapter; paid orders become online-channel sales through the checkout engine;
new public app `apps/store-web` (catalog, product, cart, checkout, sandbox payment page,
tracking; Arabic/English); manager `/manager/online`; sales channel column/filter and
"sales by channel" report; permissions `online.manage` / `online.orders`.
Verified: see TESTING.md.
Not done / open: **no real payment gateway is connected** (needs owner approval,
merchant credentials and provider sandbox tests — OQ-021); the sandbox gateway keeps its
charges in memory (single API instance); no shopper accounts, coupons, delivery zones,
cash on delivery or automatic gateway refunds; paid online orders are refunded through
the existing refund engine (gateway refund stays pending per BR-095).

### 2026-10-12 — Prompt 17: Platform administration and subscriptions
Implemented: migrations 0027–0028; `subscriptions` module (plans, one subscription per
merchant, history, limit and feature checks used by branches, registers, invitations,
employees, products, restaurant and online store; `/manager/subscription`);
`platform-admin` API (overview, merchant list/search/detail with usage and onboarding,
create merchant with owner set-up e-mail, suspend/reactivate/close with session
revocation, plan management, subscription changes with readiness check, platform audit);
database guards for operator-only changes; `MERCHANT_SUSPENDED` sign-in answer; platform
console screens (overview, merchants, merchant detail, plans, audit) and the manager
subscription page; CLI fix for `platform:create-operator -- …`.
Verified: see TESTING.md.
Not done / open: **no billing** (prices informational, no invoices or payment collection
— OQ-022); lapsed subscriptions are not acted on automatically; operator accounts are
managed with the CLI only (no screen); no merchant impersonation; the shared
`restaurant`/`ecommerce` feature list is fixed in code.

### 2026-10-12 — Prompt 18: Final audit and production readiness
Four independent audits (security, financial integrity, transaction reliability,
architecture/frontend), a reconciliation of the dev database, a 20,000-sale load test and a
backup/restore drill. Fixed and covered by tests: client-controlled `X-Forwarded-For`
(high); payments succeeding after cancel/failure were ignored (high); POS screen lock
(server-enforced); deadlocks between POS and online sales and between payment callbacks and
cancel/expiry (lock order + retry); reconcile job stopped on one error; platform summary
functions and operator table hardened; per-operator TOTP limit; production refuses dev
secrets; delivery fee hid gross profit; duplicate exchange line → 500; cross-merchant ids in
restaurant setup; share→update lock upgrade in plan checks; tracking tokens in logs; POS
register without error state; stale docs (ROUTES, ARCHITECTURE). New: `docs/OPERATIONS.md`,
`scripts/ops/db-backup.sh`, `db-restore.sh`, `scripts/perf/load-test.mjs`.
Open (see the final report): e-mail verification at registration (OQ-025), branch-aware
permission hints in the UI, metrics endpoint, module boundary refactor (ADR-0083), owner
decisions OQ-011/021/022/023/024.

### 2026-10-15 — Staging: assistant key rotation and e-mail delivery over HTTP (ADR-0106)
`ANTHROPIC_API_KEY` on the Railway web service rotated to the dedicated workspace key
`arabat-pos-staging` (the owner's personal key is to be revoked); the service was found
following `claude/busy-babbage-yty2bo` again and was reconnected to `claude/tender-wright-t34f5x`
(deploy of 51e9924 green, assistant routes mapped, no key rejection). Forgot-password: the
flow was already complete (UI, routes, API, single-use token, tests), but no e-mail left
staging because Railway blocks outbound SMTP below Pro. New `MAIL_PROVIDER` (`smtp` |
`resend` | `brevo`) with `MAIL_API_KEY`; HTTP mailers unit-tested against a stubbed `fetch`;
production warns at start-up when delivery is unconfigured. Pending the owner: provider
account and key on the web service, then a real reset on staging.
Later the same day: the owner verified `arabatapp.com` at Resend (sending subdomain
`send.arabatapp.com`, DKIM + CNAMEs on Cloudflare) and created the sending-only key
`arabat-pos-staging`; `MAIL_PROVIDER=resend`, `MAIL_API_KEY` and
`MAIL_FROM=Arabat POS <no-reply@arabatapp.com>` set on the Railway web service (deploy
464b140f green, start-up warning gone, password routes mapped). The owner's first try
(00:48 UTC) logged `ResendMailer: provider answered 401 API key is invalid`: the value first
stored in `MAIL_API_KEY` was not the owner's key; corrected and the service redeployed
(4da17c04, 04:06 UTC). Two more causes found and fixed the same night: every
variable-triggered or "Redeploy" deployment was built from the default branch
`claude/busy-babbage-yty2bo` (no mail-provider code → SMTP fallback, `ECONNREFUSED
::1:1025`), so the source was reconnected to `claude/tender-wright-t34f5x`; and Resend
refused the root-domain sender (`403 arabatapp.com domain is not verified`: only
`send.arabatapp.com` is verified), so `MAIL_FROM` became `no-reply@send.arabatapp.com`.
**Verified 04:23 UTC** on deployment 32f0a34b (b84e0ca): the owner's request on
`/manager/forgot-password` logged `E-mail "إعادة تعيين كلمة المرور | Reset your password"
sent` from `ResendMailer`. Resend's per-e-mail limit (5 per hour) answered 429 to one of the
retries, as designed.

### 2026-10-15 — Branded bilingual e-mail template
Owner request after seeing the first plain-text reset e-mail. `apps/api/src/kernel/mail/template.ts`
(`renderEmail`) renders every outgoing message as one layout: "Arabat POS" header in the UI
primary colour, an Arabic RTL block then an English LTR block (heading, greeting, text, a
button with the link repeated under it, an optional confirmation-code box, a small note) and
an automated-message footer; the subject is "ar | en"; all caller text is HTML-escaped; the
plain-text part keeps the previous structure (Arabic, blank line, English; link or code on its
own line). Applied to password reset, platform-created owner set-up, employee invitation,
sign-in lock-out and ownership transfer e-mails. Runs: `pnpm verify` (201 unit/web tests, 5
new in `template.test.ts`), `pnpm test:integration` 227 passed, `pnpm test:e2e` 35 passed.

### 2026-10-12 — Staging on Railway (ADR-0087)
Deployed with the owner's approval: Railway project `arabat-pos` (Postgres + web), URL
`https://web-production-bf628.up.railway.app`. Build, migrations and seeds ran on Railway;
health check ok; `/manager`, `/pos`, `/platform` load against the live API. Fixed: the domain
targeted port 3000 while Railway injects `PORT=8080`. First platform operator created on
staging by the hosted-start bootstrap. Not yet done: SMTP, uploads volume. Payments are sandbox only.

### 2026-10-12 — POS: stock on tiles and quantity stepper
Owner request. Product tiles of tracked items show the branch on-hand quantity from the POS
availability API; tapping a cart line reveals −/+ (one unit per tap; below one unit removes
the line), Edit (full line dialog) and Remove; tapping it again hides them. Display only: the server still enforces the stock policy at checkout. Verified:
`pnpm verify`, `pnpm test:integration`, `pnpm test:e2e`.

### 2026-10-12 — POS on phones (ADR-0088)
Below `md` the sale screen shows products full screen with a bottom «Cart (n) · total» bar; the
cart opens full screen with a back button. Shift strip actions scroll on one row; header session
actions fold into a ☰ menu below `sm`. Desktop/tablet unchanged. Phone e2e project added.

### 2026-10-12 — Phone review fixes
Fixed: the sale grid overflowed phones (implicit `auto` column grew to the category bar's width;
now `minmax(0,1fr)` + `min-w-0`). Touch targets ≥ 44px (☰, menu items, shift actions, cart
stepper/edit/remove); language switch moves into the ☰ menu on phones; shift actions wrap
instead of scrolling; «Clear» needs a second tap within 3 s; tile highlight + short vibration
on add; short search hint and «Discount» label; scrollbars hidden on phones; compact
three-column dashboard cards; show/hide password on sign-in; POS sign-in card at the top on
phones. Kept by owner decision: cart −/+ shown on tap; on-hand quantity on every tracked tile.
Not done: camera barcode scanning, web app manifest (installable app).

### 2026-10-12 — Third UI review
Phones: the shift moves into the header («Register 1 · Opened 06:32 PM»), register actions sit
behind «More» next to the 44px search; tighter spacing. Product list ≈ 68% of a 375×812 screen
(was ≈ 44%). Desktop: F2 search, F4 customer, F8 hold, F12 pay, Esc clears search (hints on
buttons); one user menu (manager, language, sign out) with Lock kept visible; product grid
`auto-fill minmax(160px,1fr)`; empty cart shows «Add products» instead of a faded Pay.
Update banner: the POS compares the served entry script with the loaded one on tab focus and
every 5 min; an empty sale reloads silently. Manager: sidebar items 44px with a ✕ close
button, whole onboarding rows clickable, stat labels wrap. Installable POS (web manifest,
192/512 icons, standalone). Not done: per-category tile colours, empty-cart recent sale on
desktop, products-page filter layout, image placeholders, camera barcode scanning, sound.

### 2026-10-12 — Default payment setup and silent-empty pages (ADR-0089)
Cause of the empty Registers / Payment methods pages on staging: the manager session had ended
(every `/manager/*` call answered 401) but the app kept showing the page with empty tables.
Fixed: a 401 re-reads the session and shows sign-in; all data tables show load errors.
New companies (and, once, existing ones without balances) get cash on hand («الخزينة»), two bank accounts
and Cash / KNET / Visa-Mastercard / payment link / WAMD linked to them (BR-086). Open: real
fee rates and cash-to-bank transfers (OQ-026).

### 2026-10-13 — Remediation session 1 (audit Phase 1 → retail remediation plan)
Owner approved `docs/audit/REMEDIATION_PLAN.md` with decisions D1–D7 (blind counts, per-merchant
approval thresholds, treasurer role, combined discount limit, payables deferred, fees per provider,
online store deferred) and moved the audit-log screen into R1. Implemented (ADR-0093):
- **Blind cash counts (BR-162, FND-401):** `sales_settings.blind_cash_count` (migration 0036,
  default on, switch in the selling policy). POS endpoints withhold drawer figures from users
  without `shifts.view_all`: no expected balance at opening (`expectedCash` optional, no
  opening-note requirement for a blind cashier), no summary during the shift, figures and
  difference after the count; owners and supervisors unaffected.
- **Merchant audit log (BR-163, FND-101):** `GET /manager/audit` (`audit.read`) with local-day
  period, action, record type and actor filters, pagination and distinct actions; screen
  `/manager/audit` with CSV export; nav entry under Organization.
- **Test gateway guard (FND-709):** warning at start when the mock gateway is on in a production
  build; OPERATIONS rule (staging only).
- Tracking: `docs/audit/FINDINGS_STATUS.md` (180 findings: 2 tested, 1 fixed, 128 open, 49 deferred).
Verified: `pnpm verify` green (160 unit/web tests), `pnpm test:integration` 173 passed (incl. new
`audit.int.test.ts` and the blind-count case in `shifts.int.test.ts`), `pnpm test:e2e` 35 passed
(`checkout.spec` and `refunds.spec` now assert the blind notice and verify drawer figures through
the manager API). Not done (next sessions): cash-out limits and corrections (R1.1), custody roles
(R1.6), disbursement approvals with per-merchant thresholds (R1.2), variance follow-up (R1.4),
deposits in transit and bank reconciliation (R1.3).

### 2026-10-13 — Remediation session 2 (R1.1 cash-out controls, R1.6 treasurer and controls checklist)
Implemented (ADR-0094, BR-164, BR-165):
- **Corrections** reverse only a posted "other" movement of the same shift, opposite way, up to
  what is left, with a note; the POS offers the correctable movements.
- **"Other" cash-out limits** per movement and per shift, owner-set in the selling policy
  (defaults 20.000 / 50.000 KWD): above them the request is *pending*, decided by a holder of
  `shifts.view_all` in the shift detail (approve posts the cash then; reject needs a reason),
  withdrawable by the cashier, refused at closing, auto-rejected on a forced close; the owner
  posts directly with an audited override flag.
- **Tolerance cap** per company (default 1.000 KWD) enforced on register save; a visible
  closing difference beyond the tolerance needs a note (blind cashiers excepted).
- **Treasurer** role template (least privilege) and the dashboard **internal-control checklist**
  (`GET /manager/merchant/controls`): treasurer assigned, members without roles, registers above
  the tolerance cap, cash-outs awaiting approval.
Verified: see `TESTING.md` (results after remediation session 2). Not done (next sessions):
disbursement approvals with per-merchant thresholds and owner override (R1.2), variance
follow-up (R1.4), deposits in transit and bank reconciliation (R1.3), custody-right split
(FND-422), cashier acknowledgement of manager cash moves (FND-419).

### 2026-10-13 — Remediation session 3 (R1.2 disbursement approvals, R1.4 variance follow-up)
Implemented (ADR-0095, BR-166, BR-167):
- **Approval limits** for expenses and supplier payments (owner-set, defaults 20.000 / 100.000
  KWD) with a mandatory receipt reference above them. At the till the payment waits as a pending
  movement with its category, supplier and reference; from a treasury it becomes a **payout
  request** decided by another custody holder (approve pays then, reject needs a reason,
  withdraw by the requester); the owner pays directly with an audited override.
- **Overpayment guard** on supplier payments naming a purchase order, owner-confirmable;
  purchase orders show **paid to date** net of reversals.
- **Follow-up of cash differences**: a Shifts tab lists shift-close, between-shift, count and
  branch-transfer differences with the accountable person; explained / settled / written off
  with a note, audited; dashboard checklist counts pending payout requests and open differences.
Verified: see `TESTING.md` (results after remediation session 3). Not done (next sessions):
deposits in transit and bank reconciliation (R1.3), custody-right split (FND-422), approval
of stock adjustments (R2.1).

### 2026-10-13 — Remediation session 4 (R1.3 deposits in transit, bank reconciliation)
Implemented (ADR-0096, BR-168):
- **Deposits in transit**: every bank deposit (POS drawer or manager treasury) needs its slip
  number and lands in the company "deposits in transit" account; a second holder of
  `cash.deposit` confirms it into the bank (bank reference) or returns it to the treasury with a
  reason; the owner settles their own deposits with an audited override. Cash overview card,
  "Deposits in transit" list on the custody page, dashboard checklist count.
- **Manual bank reconciliation** per bank account (`/manager/accounts` → Reconcile): tick the
  entries on the statement, enter the statement balance, see the cleared balance and the
  difference, explain any difference; history kept; unreconciled count and last reconciliation
  on the accounts list; checklist counts bank entries older than a week on no statement.
- **Deactivation guard**: a bank account with a balance, unreconciled entries or a deposit in
  transit cannot be set inactive (`ACCOUNT_IN_USE`).
Verified: see `TESTING.md` (results after remediation session 4). Not done (next sessions):
custody-right split (FND-422), approval of stock adjustments (R2.1), blind counts with sign-off
(R2.2), master-data guards (R2.5); fee settlement per acquirer (FND-413 in full, R3.5).

### 2026-10-13 — Remediation session 5 (R2.1 adjustment approvals, R2.2 blind counts, R2.5 master-data guards)
Implemented (ADR-0097, BR-169 to BR-171):
- **Adjustment approvals**: numbered documents (ADJ-), value at cost on every document; above
  the company limit (default KWD 50, in the selling policy) a non-owner's document waits for a
  second holder of the adjust right (approve posts, reject needs a reason, requester withdraws);
  owner override audited; list filter and detail panel; dashboard checklist count.
- **Blind counts**: count sheets hide the book quantity and the resulting balance (policy,
  default on); stock that moved since the sheet was started is listed and must be acknowledged
  before the count posts.
- **Master-data guards**: tracking off, goods → service, archiving and variant removal refused
  while stock is on hand (branches and quantities named); archived items can still be written
  off or counted; branch deactivation refused while stock, cash, open shifts, open purchase
  orders, open stock transfers or cash in transit remain.
Verified: see `TESTING.md` (results after remediation session 5). Not done (next sessions):
transfer losses posted and approved (R2.3), in-transit stock as a valued location (R2.4),
custody-right split (FND-422).

### 2026-10-13 — Remediation session 6 (R2.3 transfer losses, R2.4 in-transit stock)
Implemented (ADR-0098, BR-172, BR-173):
- **Transfer losses**: a shortage at receipt becomes a numbered loss document (TL-) with the
  receiver's explanation, valued at dispatch cost; within the adjustment limit it posts at once,
  above it the source approver approves or rejects (reason) — never the claimant; the owner
  overrides, flagged. Rejected or unclaimed shortages can be claimed again. Surplus at receipt
  is recorded with a note. Dispatch is refused for items with no cost at all.
- **In-transit stock**: goods on the road listed per transfer with age and value on the
  transfers page and in the inventory report (`In transit` KPI, `transfer_loss` movement line);
  transfer detail shows per-line quantities on the road; a transfer in transit can be
  **recalled** to the source with a reason. Purchasing report: written-off quantity and value,
  pending losses. Dashboard checklist: pending losses, unresolved shortages.
Verified: see `TESTING.md` (results after remediation session 6). Not done (next sessions):
valuation as at a date and stock roll-forward (R2.6), cost edge cases (R2.7), damaged returns
(R2.8), custody-right split (FND-422), stock-side follow-up list for losses.

### 2026-10-13 — Remediation session 7 (R2.6 valuation as at a date, R2.7 cost edge cases, R2.8 returned goods)
Implemented (ADR-0099, BR-174 to BR-176):
- **Closing stock as at a date and roll-forward** in the inventory report: opening and closing
  per branch and in total reconstructed from the ledger, movement values by type, the rounding
  of averages as its own line; reserved quantities per item and in total; items without cost
  listed.
- **Cost precision**: the average is carried at thousandths of a fils (display in fils);
  negative balances keep their cost basis and are valued; a receipt that brings a negative
  balance back absorbs it at that basis; product screen explains catalog cost vs average and
  flags a missing cost.
- **Returned goods**: damaged / defective returns stay out of stock by default; every
  non-restocked return is a held custody record (Inventory → Returned goods) until its disposal
  is recorded with a note; the "customer return (outside POS)" increase reason is gone.
Verified: see `TESTING.md` (results after remediation session 7). Not done (next sessions):
till overrides (R3.1), price bounds (R3.2), zero-total sales (R3.3), custody-right split
(FND-422), gross profit with a costless item (R4.3).

### 2026-10-13 — Remediation session 8 (R3.1 till overrides, R3.2 price bounds, R3.3 zero-total sales)
Implemented (ADR-0100, BR-177 to BR-179):
- **Supervisor override on the cashier's till**: a supervisor (or the owner) enters their own
  e-mail and password in the POS payment dialog; a single-use ten-minute grant lends the
  overridable rights the cashier lacks; the sale stays on the cashier's shift and drawer and
  records who authorised what; grants, uses and refusals are audited; the manager sees the
  override on the sale, can filter "supervisor override" sales and sees counts per employee.
  Discount and price fields are always offered at the till; what exceeds the cashier's rights
  says so and waits for the supervisor.
- **Price-change bounds**: reason required; owner-set floor and ceiling (% of list price,
  defaults 50 / 200, each switchable off) and "not below cost" (default) enforced for everyone;
  the gap under the list price counts as a discount for the limit, a zero price is always above
  it; every POS sale stores the limit in force and the above-limit flag.
- **Zero-total sales**: new right `sales.zero_total` (supervisor template), reason required and
  stored, database check for POS sales; unusual-sales filter (free, above limit, price changed,
  supervised) in the sales history and counts in the sales-by-employee report.
Verified: see `TESTING.md` (results after remediation session 8). Not done (next sessions):
refund segregation (R3.4), tender hygiene (R3.5), held sales (R3.6), combined discount limit
(R3.7, D4), custody-right split (FND-422), gross profit with a costless item (R4.3).

### 2026-10-13 — Remediation session 9 (R3.4 refund segregation, R3.5 tender hygiene, R3.6 held sales and reprints, R3.7 combined limit)
Implemented (ADR-0101, BR-180 to BR-183):
- **Refund segregation**: refunds of one's own sales wait for a second person (owner switch,
  default on); approvers no longer bypass the limit or window for their own refunds; the owner
  completes directly, flagged as an override; optional customer contact on requests that wait;
  exchange credit paid back to the original tenders, not cash; a pending request survives the
  requester's shift close (the approver pays from their own shift); own-sale refunds counted
  per employee.
- **Tender hygiene (D6)**: settlement account mandatory on every non-cash method, no fee on
  cash, terminal / transfer reference mandatory on card and transfer tenders and pay-backs
  (owner switch), unreferenced tenders listed in the payments report, fee given back on refunds
  only under the method's policy (`keep` / `reverse`), shown as fees given back.
- **Held sales and reprints**: held sales expire after an owner-set time, the completing cashier
  is recorded and the held lines kept, receipts can be found by number at the till, every copy
  is numbered, logged and audited, cleared carts and removed lines above a threshold are logged.
- **Combined discount limit (D4)**: item discount + share of the sale discount + price gap per
  line against the limit, on the server and in the POS mirror.
Verified: see `TESTING.md` (results after remediation session 9).

### 2026-10-13 — Remediation session 10 (R4.1 one cut-off rule, R4.3 gross profit, R4.4 report access log and dashboard, R4.5 supplier statement)
Implemented (ADR-0102, BR-184 to BR-188):
- **One cut-off rule**: a single period helper in the merchant's time zone used by every list,
  statement and report (cash variances and disbursements no longer cut on UTC days); refunds
  counted on their completion day in the sales history and the refund register (with totals);
  cash statements take a period with the balance brought forward; the time zone is set at
  registration and any later change is stamped, audited and warned about.
- **Gross profit**: always shown for the costed part with the uncosted share (amount, % of net)
  flagged; the by-employee breakdown carries the online store as its own row.
- **Report access log and dashboard**: every report view and CSV export in the audit log;
  dashboard KPIs (today / yesterday net sales, refunds, net after refunds, open shifts) in the
  merchant's zone; the unusual-activity threshold and window are company policy.
- **Supplier statement**: received at order cost vs. cash paid (and reversals) with the running
  difference, period filter and balance brought forward, on the suppliers page.
Verified: see `TESTING.md` (results after remediation session 10).

### 2026-10-13 — Remediation session 11 (R4.2 period close pack)
Implemented (ADR-0103, BR-189, BR-190):
- **Period close**: months since registration listed with their status; the month-end pack
  (sales, profit, collections by tender, unreferenced tenders, cash by place at month end,
  closing stock, refunds owed, open items, supplier balance, document counts) computed live for
  an open month and stored at close; months close in order, once, after they end, by
  `periods.close` holders with company-wide report rights; audited; never reopened.
- **Lock and document dates**: purchase orders and deliveries carry a business date (today
  unless set, at most 7 days back, audited when backdated); a date inside a closed month is
  refused; posting times stay the ledger basis.
- **Manager**: `/periods` page with the pack and a close dialog; date fields on the purchase
  order form and the receive dialog.
Verified: see `TESTING.md` (results after remediation session 11).

### 2026-10-13 — Remediation session 12 (R5.2 ownership transfer and freeze, R5.3 audit detail and price history, R5.4 account hygiene)
Implemented (ADR-0104, BR-020 revised, BR-191 to BR-193):
- **Ownership**: owner-initiated transfer with password re-entry and an e-mailed confirmation
  code to the named member (72 h, cancellable, one at a time); platform-initiated transfer by
  a super administrator with a recorded reason; emergency freeze / release of the owner by
  support; old owner demoted to a plain member and signed out; both parties notified; all
  audited.
- **Audit detail**: before / after values on company profile, branch, employee profile,
  category, product (attributes and variant prices / costs), supplier and draft-order edits;
  permission set on role deletion; `price_history` with a history tab on the product.
- **Account hygiene**: self-service password change (other sessions end) and device list with
  sign-out; manager "end all sessions" and "clear sign-in lock"; lock-out notice e-mailed to
  the account holder; invitation grants re-checked against the inviter's current authority at
  acceptance and revoked when the inviter is deactivated; dormant grants confirmed (keep /
  clear) on branch reactivation and recorded.
Verified: see `TESTING.md` (results after remediation session 12). The remediation plan's
sessions 1 to 12 are complete; outside it remain the supplier side (R6, decision D5), the
online-store go-live prerequisites (R7, decision D7), server-rendered exports and
acquirer-statement reconciliation.

### 2026-10-15 — Production on Google Cloud, Doha: prepared (ADR-0105)
Owner decisions in conversation: Google Cloud, Doha (`me-central1`), application and database in
one region; the "economic production" plan (Cloud Run 1 vCPU / 1 GiB min 1 max 3, Cloud SQL
`db-custom-1-3840` without HA, load balancer, about USD 140–190 a month) with raised backups;
everything ready before the move starts.
Implemented:
- **Cloud SQL compatibility**: Cloud SQL never grants BYPASSRLS. Migration 0048 removes
  `FORCE ROW LEVEL SECURITY` (the owner is exempt by ownership, `app_runtime` still filtered);
  `hosted-start` / `hosted-setup.ts` create roles without privileged attributes, take `SET`
  membership of `app_owner` as a non-superuser admin, serialise role setup and migrations with
  advisory locks (the rehearsal found two instances colliding on `CREATE ROLE`), drop BYPASSRLS
  from older databases after 0048, and gain `--migrate-only` / `--roles-only`. Docker and CI
  create `app_owner` without BYPASSRLS.
- **Images in Cloud Storage**: `GcsStorage` (`FILE_STORAGE_DRIVER=gcs`, `GCS_BUCKET`) over the
  JSON API with the metadata-server token; create-only writes like the local adapter.
- **Infrastructure scripts** `infra/gcp/`: `provision.sh` (APIs, Artifact Registry, service
  accounts, Cloud SQL with 90 daily backups, PITR 7 days, final backup, deletion protection,
  secrets generated into Secret Manager, buckets, daily/monthly exports via Workflows +
  Scheduler, Backup and DR vault, load balancer + managed certificate + HTTP redirect, uptime
  check, `--lock-backup-bucket`), `deploy.sh` (Cloud Build → migration job → Cloud Run with
  probes), `move-from-railway.sh` (dump / restore / row counts), runbook OPERATIONS.md §9.
- **Rehearsal** `scripts/verify-managed-postgres.sh`, also added to CI.
Verified: see `TESTING.md` (results 2026-10-15).
Not done (needs the owner): no Google Cloud account yet, so nothing was created or billed and
the `gcloud` scripts have not run against Google (flags checked against SDK 570 only); second
backup location; e-mail provider; domain; whether Railway's pilot data (with test payments)
moves; `TRUST_PROXY` hop count and Backup and DR availability in Doha are checked at the first
deploy.

### 2026-10-15 — Production on Google Cloud, Doha: created (ADR-0105)
With the owner's approval in conversation (cost USD 140–190 a month, go-live, DNS) the scripts ran
against project `arabat-511416` as `arabat-admin` (Owner). Resource names: OPERATIONS.md §9.
- `provision.sh`: everything created, including the Backup and DR vault (offered in Doha).
  Bugs found on the first real run and fixed (commit 766fc7e): IAM bindings retried until a new
  service account is visible; Backup and DR every 6 hours (Cloud SQL refuses hourly), wait for
  the plan to be ACTIVE, full instance path in the association; serverless NEG backend service
  without a port name; uptime check lookup that matches on re-run.
- `deploy.sh`: image `766fc7eaa03b` built by Cloud Build, migration job succeeded on the empty
  database, revision `arabat-web-00001-v8f` serving. Production starts **empty**; Railway untouched.
- First platform operator created with `PLATFORM_BOOTSTRAP_EMAIL` (the owner's e-mail) on the
  job, credentials read once from the job log and handed to the owner in chat only; the
  variable was removed from the job afterwards.
- Cloudflare: `A app.arabatpos.com → 34.49.242.209`, not proxied. Certificate `arabat-cert`
  ACTIVE at 11:59 UTC (Google Trust Services).
- §9.4 checks, run from Cloud Build (the engineering sandbox cannot reach the domain):
  `/api/v1/health/ready` → ok with database ok; `/manager/`, `/pos/`, `/platform/`, `/store/` → 200
  with their titles; `http://` → 301 to `https://`; the `run.app` address → 404 (ingress closed);
  Cloud Run env `PAYMENT_MOCK_ENABLED=false`, `FILE_STORAGE_DRIVER=gcs`, `TRUST_PROXY=2`.
Not done / open:
- Client IP (`TRUST_PROXY=2`) not yet confirmed: a failed sign-in for `ip-check@arabatpos.com`
  was sent from 34.18.38.234 (Cloud Build); its `auth.login.failed` audit row must show that
  address (the platform audit log); reading production data from the sandbox was not allowed.
- Image upload surviving a redeploy: not tested (no merchant exists in the empty production).
- `smtp-url` is still the placeholder: no e-mail is sent until the owner's Cloudflare Email
  Service token (possibly the Workers Paid plan) is stored.
- Monitoring notification channel and alert policies (§9.2 step 8): not created.
- `provision.sh --lock-backup-bucket` (irreversible): waits for the owner.
- First restore drill (§9.5).

### 2026-10-15 — Production address: www.arabatapp.com
Owner: `www.arabatapp.com` is the primary address. `provision.sh` now takes `REDIRECT_DOMAINS`
(here `arabatapp.com app.arabatpos.com`, 301 to `https://www.arabatapp.com` through a host rule
of the URL map), one managed certificate per host (`arabat-cert-<host>`), re-creates the uptime
check when the domain changes, and `deploy.sh` sends from `no-reply@MAIL_DOMAIN`
(`arabatapp.com`). Cloudflare `A` records `www.arabatapp.com` and `arabatapp.com` → 34.49.242.209
(not proxied). Released `d47939c9f04f` (revision `arabat-web-00002-4r9`).
Checks from Cloud Build after the three certificates turned ACTIVE (12:39 UTC; the old
`arabat-cert` was then detached and deleted): health ok with database ok, the four apps 200,
`https://arabatapp.com/…` and `https://app.arabatpos.com/…?x=1` → 301 to the same path (and query)
on `https://www.arabatapp.com`, `http://` → 301 to `https://`, `run.app` 404.

### 2026-10-14 — POS assistant (ADR-0107, BR-194)
Implemented:
- **API**: `assistant` module with `GET /pos/assistant` and `POST /pos/assistant/chat`
  (`pos.access`); `AssistantModel` boundary with the Anthropic implementation (official SDK,
  `claude-opus-5-5` by default, low effort, server-side fallback, 60 s timeout) and a scripted
  test double; four read-only lookups as the cashier (`search_products`, `payment_methods`,
  `recent_sales`, `shift_summary`); rights, branch, blind count and RLS respected; the guide
  keeps the assistant on the cashier's own screen (no management screens, settings or
  permission keys in answers); four lookup rounds and 60
  requests per cashier per 10 minutes at most; off (503 `ASSISTANT_DISABLED`) without
  `ANTHROPIC_API_KEY`.
- **POS**: Assistant button in the shift strip and the phone menu, F9, chat dialog with
  suggested questions, the cart sent as display text, thread kept while closed, "New
  conversation", notice when the assistant is not configured; Arabic and English.
Verified: see `TESTING.md` (results after the POS assistant). Not done: the key is not set
anywhere (nothing is billed until the owner provides one); no streaming, no usage metering.

### 2026-10-14 — Management assistant (ADR-0107 amendment)
Implemented after the owner's staging trial:
- **API**: `GET /manager/assistant` and `POST /manager/assistant/chat` (`manager.access`),
  `MANAGER_GUIDE` (the sidebar pages, no permission keys in answers) and four lookups with the
  user's rights and the selected branch: `search_products`, `payment_methods` (the Payment
  methods page), `stock_summary`, `sales_today`; a foreign `branchId` is 404, a POS session is
  refused at the route. Hardening from the live trial: a `max_tokens` stop without a tool call
  gives the fallback reply, `<thinking>` notes are stripped, `max_tokens` 1 024.
- **Web**: the chat body is one shared `AssistantChat` (`web-core`); the POS dialog uses it;
  the manager app has a floating **Assistant** button at the bottom inline-end corner of every
  page (in the layout, so the thread survives navigation), a panel above the content, Escape
  to close, suggested questions; Arabic and English. `ANTHROPIC_API_KEY` is set on staging
  with the owner's approval; staging follows branch `claude/tender-wright-t34f5x`.
Verified: 8 assistant integration cases, 188 unit/web tests, lint and typecheck green.

### 2026-10-14 — Platform record of assistant usage (ADR-0107 amendment, owner decision)
- **DB**: migration 0048 `assistant_requests` (now 0049) (INSERT-only for merchants, no reads; platform
  `SECURITY DEFINER` readers). **API**: every question recorded from `AssistantService` with
  thread, answer, lookups, tokens, estimated cost (`assistant.pricing.ts`) and outcome, also
  on failure; `GET /platform/assistant` (list, totals, by merchant, filters) and
  `GET /platform/assistant/export` (JSONL) for `platform.super_admin` only; `conversationId`
  from the browser. **Web**: platform page "Assistant usage" (cards, filters, by-merchant
  table, questions table, conversation dialog, export link), super-admin-only navigation;
  POS and manager chats send a conversation id and say conversations are kept.
Verified: 9 assistant integration cases, 189 unit/web tests, lint and typecheck green.

### 2026-10-15 — Assistant answers rendered (owner request)
Answers showed raw `**bold**` and list markers. `AssistantMarkup` (`web-core`) renders the
allowed subset (paragraphs, bullets, numbered steps, bold, inline code) as React elements, no
HTML; used by the POS dialog, the manager panel and the platform conversation dialog. Both
guides now state that subset as the only formatting. Verified: 3 markup unit cases, 192 web
tests, 9 assistant integration cases. Phones (owner report): the input is focused
automatically only with a fine pointer, sending drops the keyboard, and the manager panel
fills the screen below `sm`.

### 2026-10-15 — The user's own conversation history (ADR-0107 amendment)
- **DB**: migration 0049 (now 0050; `own_select` policy by merchant and user; index). **API**:
  `AssistantHistoryService` reading under `withContext({ merchantId, userId })`;
  `GET /pos|manager/assistant/conversations[/:id]` (own, same app, questions and answers
  only). **Web**: "My past conversations" in the chat footer (list, reopen, continue with the
  same conversation id) in the POS dialog and the manager panel; `useAssistantThread().load`.
Verified: 10 assistant integration cases, 206 web tests, lint and typecheck green.
Owner's phone the same hour: the register's silent reload on a new deployment (empty cart)
closed the chat and lost the thread. The owner asked for a server-backed, chat-app layout
rather than browser storage: `AssistantChat` now shows the user's conversations down the side
(server list, newest first, "New conversation" on top; a switch on phones), the active one in
the middle and a growing composer; on open with an untouched state it resumes the latest
conversation from the server when its last turn is within 30 minutes. No session storage.
Web test setup clears browser storage after each case. Verified: 208 web tests.
Owner request the same morning: the register's assistant identical to the management one.
`AssistantLauncher` (`web-core`) now holds the floating button, the panel, the hotkey and the
conversation state for both apps; the POS mounts it in its layout with F9 and the sale text
from `AssistantCartProvider` (set by the sale screen), the strip button and the sale-screen
dialog are gone; the manager app is a thin binding. Verified: 208 web tests.

### 2026-10-16 — Assistant brought to the Google Cloud line
The production branch had been cut before the assistant work (Railway staging), so the chat
button never reached `www.arabatapp.com`. Merged the assistant line (POS + manager launcher,
history, platform usage record, e-mail through Resend / Brevo) into the Google Cloud line.
- Migration numbers collided (both had 0048). Google Cloud keeps `0048_rls_owner_without_bypass`;
  the assistant migrations are now `0049_assistant_requests` / `0050_assistant_own_conversations`,
  idempotent (staging already ran them as 0048 / 0049) and without `FORCE ROW LEVEL SECURITY`
  (Cloud SQL would lock the owner out). Both upgrade paths replayed on PostgreSQL 18: production
  (… 0048 Cloud SQL → 0049 → 0050) and staging (… old 0048/0049 → 0048 Cloud SQL → 0049 → 0050);
  both end with RLS enabled, not forced, and the two policies.
- `infra/gcp/deploy.sh` passes `ANTHROPIC_API_KEY` from the secret `anthropic-api-key` when it
  exists (OPERATIONS.md §9.2 step 7a); without it the chat only says the assistant is not enabled.
Verified: `pnpm verify` (217 unit/web), 230 integration, 35 E2E (local).
Released to production 2026-10-16: image `8ae3a5bb7549`, migrations 0049 / 0050 by the job,
revision `arabat-web-00003-7hh` serving 100 %. Not done: the secret `anthropic-api-key` does not
exist yet in Secret Manager, so the assistant was off at first. Same day: secret `anthropic-api-key` created from the
owner's key, released `ca227effa051` (revision `arabat-web-00004-pp4`, `ANTHROPIC_API_KEY` set);
the key answers 200 at Anthropic and lists `claude-opus-5-5`; no error logs on the revision.

### 2026-10-14 — Domain and e-mail set-up (ADR-0108)
Owner decisions: production domain `arabatapp.com`; Google Workspace for people's mail;
Resend (free plan) for system mail on `send.arabatapp.com`; staging paused; production hosting
on Google Cloud preferred but not approved yet (OQ-011). Done in Cloudflare: dangling A records
of `arabatapp.com` / `www` / `app` (to an address the owner does not control) removed; Workspace
MX and SPF and a monitor-only DMARC added. Not done: Workspace and Resend sign-ups (owner),
their verification / DKIM records, production deployment.

### 2026-10-16 — Production e-mail through Resend; invitation names the everyday address
Secret `mail-api-key` (the Resend key `arabat_pos_resend`, sending access) created; released
`566f3e65180a` (revision `arabat-web-00005-2kv`) with `MAIL_PROVIDER=resend`,
`MAIL_FROM=Arabat POS <no-reply@send.arabatapp.com>`. The invitation e-mail keeps its one-time
link to set the password (`/pos/accept-invite` for cashiers) and now also gives the address the
employee opens every day (`https://www.arabatapp.com/pos`). Verified: IAM integration (20).
Not verified end to end: no e-mail has been sent from production yet (the sandbox cannot reach
Resend or the site); the first real invitation is the check (log `Invitation e-mail failed` on error).

## Next step
Production: confirm the client IP, SMTP token, alert policies, owner's decision on the bucket
lock, first restore drill.
Staging: first platform operator, SMTP; owner decisions OQ-021–025.
