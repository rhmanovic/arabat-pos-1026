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

### 2026-10-16 — Setup checklist for a new company (owner request)
"Get your company ready" on the dashboard grows from 4 to 11 steps, in working order, each read
from live data: company details, payment methods (an active one), a POS register, categories,
products, opening stock (tracked items not all at zero), invite employees, assign a treasurer
(controls), first sale; "add more branches" and "review roles" are **optional** (a single-branch
shop is no longer stuck at "To do"). Header shows "done of required". Verified: 218 unit/web.

### 2026-10-16 — "—" (none) in a select saves as no reference (owner report)
A new category with parent "—" did nothing on Save: the select sends "", which `z.uuid()`
refused, and the form shows no error on that field. `optionalId()` (contracts) reads "" as null;
used for the category parent, product category, online-store branch, payment settlement account,
platform plan and restaurant references. Verified: 221 unit/web, 230 integration.

### 2026-10-16 — Thermal receipt printing from the browser

- Sale and refund receipts print through one `ReceiptPrint` portal (`#receipt-print` in
  `document.body`, `apps/pos-web/src/sale/ReceiptPrint.tsx`): hidden on screen, the only thing
  printed. Sized for an 80 mm roll with a 72 mm printable width (ImagePlus 810, CUPS queue
  `Printer_POS_80C`): `@page 72mm × 210mm`, no margins, Arial 12 px, black only, dashed
  section rules, wrapping label / value rows, `dir="auto"` on free-text values, a
  "Printed at" stamp taken at print time. Chrome ignores `size: 72mm auto` (falls back to
  Letter), hence the fixed 210 mm driver size. Printer setup: `OPERATIONS.md` §10.
- The receipt prints by itself as soon as a sale (or a restaurant bill) is completed; the
  dialog's button stays for a logged copy. Receipts opened later never print on their own.
- Verified: `e2e/checkout.spec.ts` emulates print media and checks only the receipt is
  visible, 72 mm wide, black, and the PDF page is 72 × 210 mm.

### 2026-10-16 — Server-side receipt printing (ADR-0111)

- Print agents (program on the computer with the receipt printer) and a print-job queue:
  migration 0051, module `apps/api/src/modules/printing`, agent bearer auth
  (`@RequirePrintAgent`), Socket.IO namespace `/print-agent` with `print:job` pushed through
  PostgreSQL LISTEN/NOTIFY, self-contained 72 mm Arabic receipt HTML.
- A completed sale (POS, exchange, restaurant bill, online order) queues its receipt when
  auto-print is on and the branch has an agent; managers reprint from the sale page.
- Manager: `/printers` (add agent → token shown once, online state, remove, auto-print switch)
  and "Print receipt" on `/sales/:saleId`.
- Verified: `printing.int.test.ts` (11: token hashing and online state, auth without / wrong /
  deleted token and a session cookie, company isolation, job on checkout with the HTML checks,
  none without agent or with auto-print off, branch scope, two simultaneous claims → 200 + 409,
  failure with attempts and reprint copy, Socket.IO refusal, push, no push to another company,
  disconnect on delete); web tests for `/printers` and the sale page button.
- Not done here: the agent program itself (built separately).

### 2026-10-17 — The front end never prints (ADR-0111 amendment)

- Removed: automatic `window.print()` after a sale (POS checkout, restaurant bills), the print
  buttons that opened the browser dialog (sale and refund receipts), `ReceiptPrint` and the
  `#receipt-print` print CSS, Tailwind `print:` classes, `scripts/pos-kiosk`. No print library
  was in use.
- "Print receipt" on the till → `POST /pos/sales/:id/print`; on the manager's sale page →
  `POST /manager/sales/:id/print`; toast «أُرسل للطابعة» or «لا توجد طابعة متصلة».
- Refund receipts: on screen only (no server refund print job yet).
- Verified: web tests (sale completes with no `window.print`, button posts the print route,
  both toasts), integration (numbered copies, `agentOnline`), E2E checkout (no print call).

### 2026-10-17 — Local-first plan (ADR-0112, Proposed) and `packages/pos-core`

- ADR-0112 (`docs/adr/ADR-0112-local-first-pos.md`): registered devices as registers, offline
  PIN login, per-device receipt series, server acceptance of device sales, UUIDv7 device ids,
  download / upload sync without replication. Proposed; open questions: offline limit, browser POS.
- `packages/pos-core`: pure selling rules moved out of `apps/api` without behavior change —
  sale rights, pricing bounds, discount limit, zero totals, total check
  (`sales.service.ts completeSaleInTx`), tenders (`preparePayments`), receipt / refund numbers,
  supervisor grant rules (`overrides.service.ts`), shift note rules, "other" cash-out cap and
  denomination check (`shifts.service.ts`), refund amounts, pay-back, approval reasons and void
  rule (`refunds.service.ts`). The API calls them through `rules()`, which maps `PosRuleError` to
  the same `AppError`. Public API: `packages/pos-core/README.md`.
- Verified: pos-core unit tests (25); all existing unit, integration and E2E tests unchanged.

### 2026-10-17 — Server side of the local-first Arabat app (ADR-0112 Accepted)

- Owner decisions 1–5 and gaps A–D recorded in ADR-0112; the browser till asks for a supervisor
  with `requiredSaleRights` (pos-core); `pnpm check:pos-core-browser` in verify and CI.
- Devices: `pos_devices` (0052), registration on the device with a manager's e-mail and password
  (`POST /device/register`), bearer token (SHA-256 stored), its own register with a never-reused
  code (`R1`, `R2`, …), removal (`DEVICE_REVOKED`), Devices page in `/manager`.
- Cashier PINs (0053): argon2id 64 MiB / 3 passes, 6–12 digits, set on the employee page, audited.
- Sync download `GET /device/sync?since=` (0054 `offline_limit_hours`, default 72, set on the
  Devices page): settings, payment methods, staff with PIN hashes and branch permissions,
  categories, products (deltas after the first sync), counters, `catalogVersion`.
- Sync upload `POST /device/sync` (0055 `device_records`, `device_exceptions`): shift open /
  close, sales (device receipt series `{branch}-{register}-NNNNNN`), pay-ins / pay-outs, refunds of
  the device's own sales; exactly once per device id; same stock ledger, cash ledger, refunds engine
  and audit as the browser; negative stock allowed and flagged; device time stored with the
  server's receive time and flagged when ahead or outside the shift; no server print unless
  `requestRemotePrint`.
- Exceptions for managers (Devices page, dashboard checklist count), mark handled with a note.
- Contract for the device developer: `docs/DEVICE_API.md`.
- Not on devices (online only): restaurant, customers, exchanges, voids, custody cash moves,
  gateway payments, product images.

### 2026-10-18 — Public landing page (ADR-0113)
- `apps/landing-web`: one static React page at `/` (ar/en, RTL/LTR, language remembered),
  hero with links to `/manager/` and `/pos/`, six feature cards, footer; text in `src/content.ts`.
- `serveWebApps` serves it at `/` instead of redirecting to `/manager/`.
- Tests: 2 web unit tests (language switch, links); E2E `apps.spec.ts` checks the landing page
  and its link to the manager sign-in. Local run: `pnpm verify` (258 unit/web), 259 integration,
  35 E2E, all passing.
- Same day: redesigned in the original arabatapp.com style (ADR-0113 amendment): logo,
  Alexandria, teal, scroll animations, sticky header with active section and phone drawer, trust
  strip, till and dashboard pictures drawn in code (KWD), 16 feature cards, dark "why" band,
  three steps, call to action, teal footer. Sign-up goes to `/manager/register`; contact e-mail
  `info@arabatapp.com` (owner; no phone or WhatsApp yet, no customer logos yet). Tests: 3 web
  unit tests; `pnpm verify` (259 unit/web), 35 E2E passing.


### 2026-10-18 — Pricing page and purchase requests (ADR-0114)
- `/pricing`: yearly system price card, then system → devices (cards with photo or drawn icon,
  quantity steppers, max per item) → contact form, running cart (sticky panel / phone bottom bar),
  confirmation with the request number, FAQ; Arabic / English.
- API `pricing` module: public offer, photos, requests priced on the server (fils), rate limited,
  e-mailed to `SALES_NOTIFY_EMAIL` and to the customer; platform offer items (add, price, hide,
  order, photo) and requests (status, note). Migration 0056 seeds the system at 99.000 KWD and five
  devices **hidden at 0 KWD until the owner prices them** in `/platform/offer`.
- Platform pages `/platform/offer` and `/platform/requests`.
- Landing on phones: no sideways overflow (slide-ins move vertically below `lg`, `overflow-x: clip`);
  the phone menu is rendered into `<body>` (the blurred header trapped it), slides in, locks scroll,
  closes with Esc / outside tap, and carries sign-up, sign-in and the language switch.
- Tests: 8 integration (offer, roles, photos, server pricing, e-mails, follow-up, refusals, rate
  limit), 3 web (steps and exact totals, skip, load error), 1 E2E (home → pricing → request).
  Local: `pnpm verify` 262, integration 267, E2E 36, all passing.

### 2026-10-18 — Free trials and the sign-up funnel (ADR-0115)
- `/start`: business type → demo till (receipt by e-mail = lead) → set up the shop (own devices
  or devices to try with availability / waiting list) → account → e-mail code → trial started and
  signed in; anonymous funnel steps; phone bottom bar for the demo total.
- Homepage: single call to action "أنشئ حساب وجهّز محلك" (hero, after the steps, pricing card,
  header), price and trial length from the platform, steps right under the hero, merged pricing
  and "start" section, sign-in small in the header.
- Platform `/platform/trials`: leads (stage, business, devices, sales, last seen, trial end),
  device trials (approve / waiting list / delivered → trial from delivery / returned / reject),
  trial stock per device, funnel numbers, settings (days own / with devices, waiting list).
- Tests: 4 integration (receipt lead, code + trial account, device stock / waiting list /
  delivery, access), 6 web (funnel, homepage), 1 E2E (homepage → demo → account → Mailpit code →
  dashboard). Local: `pnpm verify`, integration, E2E all passing.
### 2026-10-18 — Trial funnel simplified (ADR-0115 amendment 1)
- `/start` is now business → devices (choose, or "تخطَّ، عندي أجهزتي") → account → trial started
  and signed in at once. No demo till, no e-mail code. Pricing-page design: stepper, device cards,
  sticky summary with "مجاناً" and the price after the trial.
- Tests: 4 integration, 3 web (/start), 1 E2E (home → business → skip devices → account →
  dashboard). Local: `pnpm verify` 266, integration 273, E2E 37, all passing.
### 2026-10-18 — Homepage system card and section backgrounds
- Homepage: the button under "ابدأ في ثلاث خطوات" is replaced by the pricing page's "نظامك الكامل"
  card (shared `SystemCard`, price and trial days from the platform, call to action to `/start`).
- Backgrounds never repeat between neighbours: header white → hero sand → steps white → trust
  sand → power white → features sand (white cards) → why night → pricing white → footer sand;
  pricing hero is brand-soft under the white header.
- Local: `pnpm verify` 266, integration 273, E2E 37, all passing.
### 2026-10-18 — Honest trial summary on /start
- The `/start` side panel is the pricing page's cart: system and device lines at their real prices,
  system (yearly) and devices (once) subtotals, the trial length, and "first payment after the
  trial" with the yearly renewal. The word "مجاناً" as a headline is gone (owner: we do not sell
  with words). Trial lengths read as words everywhere: whole weeks as weeks ("3 أسابيع"),
  otherwise days with Arabic number agreement (`trialLength` in `content.ts`).
- `GET /public/trial` also returns the system's name (`systemNameAr` / `systemNameEn`).
- Local: `pnpm verify` 267, integration 273, E2E 37, all passing.
### 2026-10-18 — Pricing page opens the trial account (ADR-0115 amendment 3)
- Every "أنشئ حساب وجهّز محلك" button → `/pricing`. Cart: "✓ تجربة مجانية N يوم بدون بطاقة" under
  the first payment. Form: shop name (optional), name, phone, e-mail, password; no notes; submit
  opens the trial (`/public/trial/start`) and shows the "مبروك" card with the dashboard link.
- `leads.phone` (migration 0058), shown in `/platform/trials`; business type optional on start.
- Local: `pnpm verify` 268, integration 274, E2E 37, all passing.
### 2026-10-18 — Leaner pricing page
- Removed the FAQ and the green "نمِّ تجارتك مع عربات" footer band from `/pricing`, and the
  "التالي: جهّز محلك" button from the hero price card; after the account opens only the
  "مبروك" card stays (no hero / steps). Footer bar is white under the sand sections.
- Tests run (owner asked for a quick turn): landing web tests 12, pricing E2E.
### 2026-10-18 — Home button, business type on the pricing form
- Homepage: the system card under the steps is back to a single "أنشئ حساب وجهّز محلك" button.
- Pricing form: business type picked with cards (محل / مطعم / كافيه / أخرى), required, sent to
  `/public/trial/start`. Tests run: landing web 12, pricing E2E.
### 2026-10-18 — Link page ("link in bio", ADR-0116)
- `/manager/online` → "صفحة الروابط": address, draft / published, picture, Arabic / English title
  and description, button colour / shape, background; links (Instagram, TikTok, Snapchat, X,
  Facebook, YouTube, WhatsApp, Telegram, e-mail, phone, location, website, online store, any link)
  added, edited, hidden, reordered and deleted, with open counts. `@name`, phone numbers, e-mails
  and bare domains are completed into full addresses.
- Public page `/store/links/:slug` (Arabic / English, RTL / LTR), counts opens with
  `navigator.sendBeacon`. Migration 0059, BR-198…BR-201.
- Tests: API integration `links.int.test.ts` (7), manager `link-page.test.tsx` (3), storefront (4),
  E2E `links.spec.ts`.
### 2026-10-18 — Link page gets its own interface (ADR-0116 amendment 1)
- New app `apps/links-web` at `/links` (dev `:5177`): own header (business name, back to the
  management app, language, sign out), links and design forms, live phone preview. Signs in with
  the manager account and shares its session; needs `online.manage`.
- `/manager/online` no longer has the link-page tab; the manager menu has "صفحة الروابط ↗".
- Arabic click counts use every plural form (لا نقرات / نقرتان / 5 نقرات / 11 نقرة).
- Tests: links-web 6, store-web / web-core link page view, E2E `links.spec.ts` (2).
### 2026-10-18 — Pricing tests follow the current page; production release
- `pricing.test.tsx` and `e2e/pricing.spec.ts` pick the business type before "التالي: جهّز محلك"
  and expect one trial line (the phone bottom bar is gone). No product change.
- Released `b26e8c6` to production with the owner's explicit approval (`infra/gcp/deploy.sh`,
  deploy account; the account cannot stream Cloud Build logs, so the first run stopped after
  submitting the build and the second run continued once the image existed).
### 2026-10-18 — Link page styling (ADR-0116 amendment 2)
- Editor "Style" section: eight ready-made themes, background (light / dark / button colour / any
  colour / gradient), button colour, button text and page text colours (or automatic), button
  style (filled / outline / soft / shadow) and shape, eight Arabic + English fonts, page motion
  (fade up / pop / slide). The phone preview follows unsaved changes ("Unsaved changes" badge).
- Links: emoji instead of the icon (quick choices or any emoji) and an effect (pulse / shake /
  glow). No motion for visitors with reduced motion. Migration 0060, BR-202.
- Tests: API integration 8 (links), links-web 9, store-web / web-core link view, E2E links 2.
- Local: `pnpm verify`, integration 282, E2E 39, all passing.
### 2026-10-18 — Modern link-page editor, drag and drop, globe button (ADR-0116 amendment 3)
- `/links`: header card with the address, copy / open and a publish switch; tabs Links /
  Appearance / Settings; link cards dragged to reorder (mouse, touch, keyboard) with a show / hide
  switch and icon buttons; phone-frame preview; cards wrap into two rows on phones.
- Public page and editor: one globe button switches Arabic / English.
- Tests: links-web 11, storefront (globe), E2E drags a card with the mouse.
### 2026-10-19 — "Your apps" card on the dashboard; staging follows `main`
- Owner request: the merchant could not tell what the subscription includes. The dashboard now
  opens with a "برامجك" card (`features/dashboard/YourApps.tsx`): the plan name, status and
  trial / end date from `GET /manager/subscription`, then one tile per product with its own icon
  and state — business management, point of sale and the link page (included with every plan),
  online store and restaurant (from the plan's `features`; a missing one links to the
  subscription page), own website (coming soon; the restaurant tile says the digital menu is
  coming). Shown to holders of `merchant.settings.read`; tiles open their app when the user also
  holds its permission.
- Tests: manager-web `dashboard.test.tsx` (states, links, hidden without the permission).
- Railway staging reconnected to `main` (was on the ADR-0107 branch); OPERATIONS §8 updated.
### 2026-10-19 — The device till itself (ADR-0112, device side)

- `packages/device-core`: local SQLite schema and migrations over `window.ArabatApp.db`, snapshot
  store (full / delta in one transaction), outbox in causal order with byte-identical retries,
  sync engine (upload then download, every few minutes and after each record; `DEVICE_REVOKED`
  stops selling and keeps unsent records; `MERCHANT_SUSPENDED` stops selling), offline limit
  (24 h / 48 h / stop), argon2id PIN check with 5-attempt lockouts that double, gap-free device
  receipt counter taken in the sale's own transaction, UUIDv7 ids, selling / cash / refund / shift
  logic on `pos-core`, receipt data for the shared template (moved to `pos-core`), fake bridge on
  sql.js. 13 unit tests, browser-build guard.
- `apps/device-web`: registration, cashier picker + PIN pad (Web Worker), idle lock, shift open,
  selling (search, barcode, discounts, price change, supervisor PIN, split tenders, change), print
  through the bridge, pay-in / pay-out, refunds of own sales with approver PIN, shift close with
  the Z summary, status strip (sync / waiting / not accepted, last sync, offline warnings, printer,
  version), update at a safe moment, "open this in the Arabat app" guard. Arabic + English.
- Publishing: `pnpm build` writes `apps/device-web/dist/manifest.json` (sha256, size, version
  `<UTC stamp>-<content hash>`); the API serves `/device-app/` (manifest `no-cache`, assets
  immutable); CSP allows `wasm-unsafe-eval` for argon2id.
- Tests: jsdom flow (register → PIN → shift → sale → print → upload order) and
  `e2e/device.spec.ts` against the real server (register → full sync → PIN → open shift → sale →
  accepted → retry duplicate → refund → close shift).
- Not on the device (online only, as decided): restaurant, customers, exchanges, voids, custody
  cash moves, gateway payments, product images, held sales across tills.

### 2026-10-19 — Cashier PINs become self-service (ADR-0112, owner decision 6)

- The manager is out of PINs: `PUT /manager/employees/:id/pin` is gone; `DELETE …/pin` only clears.
- From the till's sign-in screen, "Set / reset PIN" (`POST /device/pin-reset`, device token, one
  request per person per 5 minutes) e-mails the cashier a single-use one-hour link; the public page
  `/pos/pin?token=…` (`POST /device/pin-reset/complete`) sets the PIN. Migration 0061
  `pin_reset_tokens`. Audited: `employee.pin_reset_requested`, `employee.pin_set`,
  `employee.pin_cleared` (never the value). Devices receive the hash at their next sync.
- Tests: 3 integration cases (link flow, limits / newest-link-only / expiry / other company,
  manager clear only), web test of the PIN page, device Lock screen button.

### 2026-10-19 — "Our apps" menu on the site, managed from the platform (ADR-0117)

- Migration 0062 `site_apps`; `GET /public/site/apps`; `/platform/site-apps` CRUD (super admin,
  billing; support reads) with version check, audit and a confirmed delete.
- Landing header: "تطبيقاتنا / Our apps" dropdown on desktop and a group in the phone menu, read
  from the API; no menu when the list is empty. Seeded with the four web apps and the hidden
  computer till app.
- Tests: 3 integration cases (public list and order, roles / version / delete / audit, address
  validation), 3 platform-web cases (list + create, delete, read-only), 2 landing cases
  (dropdown + phone menu, empty list).

### 2026-10-19 — Plan A: device roles, the primary as print agent, browser PIN sign-in (ADR-0112 amendment 2)

- Migration 0063: `pos_devices.role` (one live primary per branch), `branch_changed_at`,
  `print_jobs.device_id`, `branches.pin_link_key_hash`; `device_authenticate` returns the role.
- Registration asks for the role after the branch (`select_role`); `409 PRIMARY_EXISTS`. The owner
  changes role or branch on `/manager/devices` (nothing revoked; a move gives a new register and a
  full snapshot). The till's registration screen has the role step and resets its receipt counter
  when its register changes.
- The primary device's token works on `/print-agent` (REST and socket), bound to its branch;
  secondary devices get `403 NOT_PRIMARY_DEVICE`; jobs carry `openDrawer: false`. The browser POS
  shows the receipt's print state (`GET /pos/sales/:id/print-status`).
- Browser POS sign-in with name + PIN behind a branch link (`/pos/pin-sign-in#key`, links on
  `/manager/devices`); 3 wrong PINs lock 5 minutes; the tills also lock after 3 (was 5); the tills
  download every minute (was 3), with "Sync now".
- Not done: a secondary till still accepts cash (it only never opens the drawer); the browser POS's
  lock screen still unlocks with the password; the native app must open the print-agent socket on
  the primary (handover §7).

### 2026-10-19 — Fixes from the first real test of the device app (ADR-0112 amendment 3)

- Migration 0064: `shifts.device_id`, the one-open-per-member rule narrowed to browser shifts,
  `device_records.kind` `sign_in`, exception kinds `shift_left_open` / `late` / `forced_close`.
- Server: a device `shift_open` is never refused for a stale shift elsewhere (the stale one is a
  `shift_left_open` exception; `/manager/devices` closes it); the branch shift is held by the
  primary (`NOT_PRIMARY_DEVICE` for a secondary's `shift_open` / `cash_movement`); secondaries'
  records attach to the primary's shift and their cash to its drawer; records for a closed branch
  shift are accepted and flagged `late` (drawer entry under the shift open now); `shift_close`
  `forced` by a manager with `registers.manage` and a note; `sign_in` records set
  `users.last_login_at` and audit `pos.device_sign_in`; the snapshot carries `branchShift` and
  `primaryDevice`; demoting a primary with an open shift is refused; a retried refusal with the
  same answer keeps the manager's "handled" mark.
- Device engine: local shift `origin` / `closed_by`, the branch shift materialised for secondaries
  and closed from the snapshot, `SHIFT_NOT_ACCEPTED` blocks sales / cash / refunds behind a refused
  shift, refused `shift_open` always retried, `discardRefusedShift`, `recordSignIn`, forced close,
  `Money.parseInput` / `normalizeAmountInput` (Arabic digits, comma, currency word).
- Till: lock keeps the cashier (PIN only, idle too); log out only without an open shift on the
  device; only the opener signs in while the primary's shift is open; "Manager: close the shift"
  with PIN + count + note; "no open shift at the branch" on secondaries (no cash / close
  controls); blocked-shift banner with guidance and "discard"; lenient amount inputs; digits typed
  in a field next to a PIN pad no longer feed the pad.
- Manager: new exception kinds with "close the shift" (force-close uncounted + mark handled).
- Tests: 3 new integration cases (stale shift accepted + closed from the list; secondary sells
  into the branch shift, late upload, demotion refused; sign-ins and forced close), 3 device-core
  cases (cascade + discard, secondary, server-closed shift / sign-in / forced close), 3 till cases
  (cascade banner, secondary, manager escape hatch) + lock / log out / Arabic count in the main
  flow, 1 manager case, money normaliser.
- Released to production 2026-10-19 with the owner's approval: `5723ed971611` (revision
  `arabat-web-00034-gnk`; migration 0064 applied by the job; the first attempt `a61735b` stopped
  at the migration because closed device shifts are immutable, fixed by attributing them with the
  trigger off). Then the owner's test company بقاله سلطان (`01a143fb-…`) was wiped with
  `reset-merchant-data` (OPERATIONS.md §9.2a): 38 sales / 38 orders, 11 shifts, 39 ledger
  entries, 39 stock movements + 1 adjustment, 15 print jobs, 13 reprints, 29 device records,
  7 device exceptions, 1 device and its register, 1 PIN link; products, staff and settings kept.
- Not done: the till records only sign-ins (not locks, sign-outs or failed PINs) in the audit log;
  the browser POS keeps its own shifts and password unlock; the cause of the original
  "Invalid amount" on `0.250` could not be reproduced with ASCII input (the normaliser covers the
  locale forms seen on Mac keyboards).

### 2026-10-19 — Registers are drawers, devices are devices (ADR-0112 amendment 4)

- Migration 0065: `pos_devices.code` (`D1`, `D2`, … per branch, never reused), nullable
  `register_id` (the bound drawer, one device per register), `role` dropped (derived),
  `registers.is_main`; device-created registers without history deleted, the rest kept unbound;
  every device unbound.
- Server: registration creates no register and asks for no role; `PUT /manager/devices/:id
  { registerId | null, branchId }` and `PUT /manager/registers/:id/device { deviceId | null }`
  bind (managers; `REGISTER_BOUND`, `REGISTER_BUSY` while the shift is open; a move needs the
  device unbound and gives a new code); registers list `isMain` and `device`; `saveRegister`
  takes `isMain` (one per branch). Ingest: receipt prefix by device code, own sales through
  `device_records`, `CASH_NOT_ALLOWED` for cash tenders of unbound devices, sales booked on the
  shift's register; the snapshot's `register` is nullable and `branchShift` is the bound
  register's latest shift or, unbound, the branch's open shift (main register first). Print
  agent and auto-print count bound devices.
- Device engine / till: receipt series by device code (counter resets on a code or branch
  change), cash refused when unbound, cash methods hidden, drawer name in the status strip,
  registration without the role step.
- Manager: `/manager/registers` shows the bound device and the main flag, "bind to a device";
  `/manager/devices` shows the bound drawer with bind / change; the role picker is gone.
- `reset-merchant-data --main-register=<name>` also recreates one main, unbound register per
  branch.
- Tests: devices (registration creates no register, binding from both sides with REGISTER_BOUND
  / REGISTER_BUSY, move needs unbinding, codes never reused, bound register out of the browser),
  ingest (unbound card sale accepted into the branch shift, cash refused, nothing to sell into
  → SHIFT_REQUIRED, late upload), printing (bound device only), engine (unbound device), till
  (card-only unbound till), manager (bind dialog), e2e (register → bind → sell `MAIN-D1-…`).
- Verified: `pnpm verify` (325 unit/web), 293 integration, 40 E2E (local).
- Released to production 2026-10-20 with the owner's approval: `50d8325b1d9e` (revision
  `arabat-web-00035-9hp`; migration 0065 applied by the job `arabat-migrate-6rmxw`). The
  deployer key cannot stream Cloud Build logs (no project Viewer), so `deploy.sh` stops once
  after `builds submit`; a second run finds the image and continues. Then the owner's test company
  بقاله سلطان (`01a143fb-…`) was reset with `reset-merchant-data --main-register=الصندوق الرئيسي`
  (OPERATIONS.md §9.2a): 1 sale / 1 order, 6 shifts, 1 ledger entry, 1 stock movement, 16 device
  records, 1 device exception, 2 devices and 2 registers deleted; one main, unbound register
  "الصندوق الرئيسي" created in its branch; products, staff and settings kept.

### 2026-10-20 — Online store Phase 1: pay on receipt, store address (ADR-0118)
The owner approved the ten-phase online-store plan (`docs/ONLINE_STORE_PLAN.md`) and decided that
unpaid orders hold no stock. Phase 1:
- Migration 0066: `online_orders.payment_mode`, nullable method / reservation, `confirmed_at`,
  `payment_reference`, `collected_by_user_id`, statuses `placed` / `confirmed`;
  `online_stores.pay_on_receipt_enabled`; `online_store_slug_history`; `store_merchant` and
  `link_slug_available` know former addresses.
- API: publishing no longer needs a ready gateway (a way to pay: on receipt or a gateway,
  `NO_PAYMENT_OPTION`); checkout with `paymentMethodId: null` places an unpaid order without a
  reservation; actions `confirm` and `mark_paid` (till tender rules via `pos-core`, sale created
  on recording, cash into the branch treasury, non-cash into the settlement account with its
  reference), `completed` refused unpaid (`ORDER_UNPAID`), unpaid orders cancelled in place;
  `GET …/store/slug-availability` with suggestions; rename history, 24-hour limit, link-page
  namespace both ways; `GET /manager/online/tenders`.
- Manager: address section first (live check, suggestions, URL preview, copy), "Allow payment
  on receipt", unpaid badge, "Confirm order", "Record payment" dialog. Storefront: "Pay at
  pickup / on delivery", "Place order", tracking text, redirect from a former address.
- Tests: `ecommerce.int.test.ts` +3 (unpaid order holds no stock, cash → treasury, card needs
  its reference and settles into its account, cancel in place, store switch, availability /
  link-page namespace / rename history / rename limit / expiry), manager online page +2,
  storefront +2, `e2e/store.spec.ts` +1 (pay at pickup end to end).
- Verified (cloud sandbox, 2026-10-20): `pnpm verify` 330 unit/web (56 files), `pnpm test:integration`
  296 (44 files), `pnpm test:e2e` 41 (Mailpit running).
- Not done (later phases): separate online payment methods, `/online` console, storefront
  currency (M12).
- Released to staging (Railway, commit `1466347`, 04:24 UTC) and, with the owner's approval, to
  production 2026-10-20: `1466347fbc19` (revision `arabat-web-00036-tsd`; migration 0066 applied
  by the job `arabat-migrate-42gwl`; Cloud Run moved traffic after the readiness probe). The
  sandbox cannot reach `www.arabatapp.com` directly (egress policy), so the check is Cloud Run's.
  The sandbox was signed out of `arabat-admin` afterwards; no key was deleted.
- Follow-up (owner's screenshot, 2026-10-20): saving the store settings answered only the generic
  "Some fields are invalid" toast. The settings form now shows the server's field problems under
  each field and in a summary above the Save button, with Arabic / English texts per field
  (`online.issue_*`), scrolls to the first refused field, and the main branch is proposed as the
  fulfilment branch (the actual cause: publishing with no branch chosen); manager test +1,
  integration +1. Verified: `pnpm verify` 331, `pnpm test:integration` 297, `pnpm test:e2e` 41.
  Released to production 2026-10-20 07:03 UTC: `909b203a1b97` (revision `arabat-web-00038-bfj`,
  migration job `arabat-migrate-hlr24` completed, nothing new to apply); Cloud Build check
  `ad37f8af`: `/api/v1/health/ready` 200 with version `909b203a1b97`, database ok, `/store/`
  and `/manager/` 200. Signed out afterwards; no key deleted.
- Re-released 2026-10-20 06:30 UTC at the owner's request with the latest `main`:
  `b026ea3610e0` (revision `arabat-web-00037-g5s`; migration job `arabat-migrate-x9x2h`
  completed, nothing new to apply). Verified from inside Google Cloud through a Cloud Build
  step (build `e352d08d`): `/api/v1/health/ready` 200 `{"status":"ok","version":"b026ea3610e0",
  database ok, 3 ms}`, `/health/live`, `/store/` and `/manager/` 200. Signed out afterwards; the
  working admin key lives in the environment variable `GCP_Admin_KEY_01` (`GCP_ADMIN_KEY_B64`
  holds a key that no longer exists in GCP and is refused with `invalid_grant`).

### 2026-10-20 — Online store Phase 2: its own console at `/online` (ADR-0119)
Owner request: two products (POS, online store) sold separately or together, each with its own
management interface, **frontend separation only** (same backend, database, catalog, stock,
customers, accounts, permissions).
- New `apps/online-web` (`/online`, dev `:5178`): manager session like the link editor; sidebar
  (Overview, Orders, Products online, Store settings, Link page ↗; "Shared with the POS": catalog,
  customers, reports, payment methods ↗ by permission); top bar with "Business management" and
  "Open Point of Sale"; overview with store state / address and order counts; the former manager
  tabs moved as pages; access message without `online.*`; plan notice without `ecommerce`.
- Manager: `/manager/online` redirects to the console; menu entry and dashboard tile open it;
  the online page and strings are removed. API: `serve-web.ts` serves `/online/*`. No API,
  database or permission change.
- Tests: `apps/online-web/src/app.test.tsx` (10: sign-in page, navigation + management links +
  overview counts, no-permission message, plan notice, orders step, pay-on-receipt payment,
  address check + refused fields, listings, key parity, actions); manager dashboard test updated;
  `e2e/store.spec.ts` runs through `/online` (and checks the `/manager/online` hand-over).
- Verified (cloud sandbox): `pnpm verify` 334 unit/web (56 files), `pnpm test:integration` 297
  (44 files), `pnpm test:e2e` 41.
- Released: staging (Railway, `2cae4c6`, 07:22 UTC) and, with the owner's approval, production
  2026-10-20 07:26 UTC: `2cae4c6d3de1` (revision `arabat-web-00039-p9w`, migration job
  `arabat-migrate-c87m8` completed, nothing to apply). Cloud Build check `09f1f604`: `ready` 200
  with version `2cae4c6d3de1` and database ok; `live`, `/store/`, `/manager/` and `/online/`
  (title "Arabat Online Store") 200. Signed out afterwards; no key deleted.

### 2026-10-20 — Online store Phase 5: fulfilment (ADR-0123) and standing production approval (ADR-0122)
Owner: "كمل افحص وانشر انا عطيك كل الصلاحيات الي ان تنشر لبيئه الانتاج" → ADR-0122 (standing approval
to release `main` to production after the three test suites pass; procedure unchanged, no key ever
deleted). Phase 5 implemented as one slice:
- Migration 0068: `online_delivery_areas`, `online_store_branches`, store hours / scheduling /
  `notify_email`, order `delivery_area_id` + name snapshot + `scheduled_for` + `pos_idempotency_key`,
  `print_jobs.online_order_id` + kind `online_order`, `sales_channel_valid` allows an online sale
  with a shift; the composite `set null` FKs replaced by single-column ones (a composite `set
  null` nulls `merchant_id`; found by the new delete test).
- API: delivery areas and serving branches CRUD + order (`FulfilmentService`), storefront
  `branches` / `deliveryAreas` / `scheduling` / `timezone`, `?branch=` products, `/slots`,
  checkout with `branchId` / `deliveryAreaId` / `scheduledFor` (`SLOT_FULL`, `OUTSIDE_HOURS`),
  orders carry area, slot and branch; `OrderNotificationsService` (bilingual e-mails after
  commit, shopper + store); packing slip `renderOrderSlipHtml` (pos-core) queued on confirm /
  gateway paid; `PosHandoverService` + `/pos/online-orders` (list, pay with the shift's tenders,
  complete); `completeOnlineSaleInTx` till mode (register, shift, drawer cash, change).
- Console: Delivery areas (Kuwait pick-list) and Branches pages, hours editor + scheduling and
  "e-mail me" in the settings, orders show branch / requested time / area. POS: "Online orders"
  strip action with the payment dialog. Storefront: branch picker, area select (fee, free
  threshold), "When?" with slots, closed-now notice, tracking page with pickup address and time.
- Tests: `ecommerce.int.test.ts` +4 (areas: fee / minimum / free / snapshot after delete;
  branches: per-branch stock, closed hours, slots and capacity; e-mails to shopper and store and
  the printed slip; till hand-over with cash + card, replay, drawer figures, paid order hand-over);
  `apps/online-web` +2 (areas, branches), `apps/store-web` +2 (area + slot, branch picker),
  `apps/pos-web` +1 (hand-over); `e2e/store.spec.ts` +1 (area in the console, shopper picks it,
  pickup order handed over at the till: receipt, online sale in the shift, stock).
- Docs: ADR-0122, ADR-0123, BR-215…220, ROUTES (console, API, storefront, POS), DATABASE (0068),
  ROADMAP, plan (Phase 5 ✅ with the differences), ARCHITECTURE, CLAUDE.md, user guide 24 and 05.
- Verified (cloud sandbox): `pnpm verify` 343 unit/web (56 files), `pnpm test:integration` 303
  (44 files), `pnpm test:e2e` 42.
- Released: staging (Railway, `main`, 2026-10-20 09:48 UTC, migration applied) and, under ADR-0122,
  production 2026-10-20 09:56 UTC: `f58b5618f509` (revision `arabat-web-00041-8sj`, migration job
  `arabat-migrate-8gfcl` completed: migration 0068 and the reference data applied). Cloud Build
  check `47804031`: `/api/v1/health/ready` 200 with version `f58b5618f509` and database ok (3 ms);
  `live`, `/store/`, `/manager/` and `/online/` (title "Arabat Online Store") 200. Signed out
  afterwards; `infra/gcp/config.env` removed; no key deleted. Rollback if ever needed:
  `--to-revisions=arabat-web-00040-xgz=100`.

### 2026-10-21 — Store console on the phone: rows, dialogs and sideways overflow
Owner's report with phone screenshots: in the store console's products, categories and lists
pages the rows overflowed the screen (names squeezed to nothing, buttons and arrows pushed out),
which widened the whole page so dialogs were cut off. Frontend only.
- `SortableRow` takes its buttons in an `actions` slot: on a phone they go to a second line under
  the name, the ▲ / ▼ stay beside the name; on wider screens the row is unchanged. Used by the
  products, categories, special lists, delivery areas and branches pages; names wrap to two
  lines instead of being cut.
- The console clips sideways overflow (`html, body { overflow-x: clip }`): the closed side menu
  waits just off screen and left a 1 px sideways scroll.
- Checked at 390 px on every console page and dialog (dashboard, orders, products, categories,
  lists, delivery areas, branches, promotions, analytics, design, settings; product edit / add,
  category, list and promotion dialogs): no page is wider than the screen.
- e2e: the one-catalog test now also checks, at 390 px, that the products, categories and lists
  pages do not scroll sideways and the product dialog fits the screen.

### 2026-10-21 — Categories and special lists made simple (ADR-0130 amendment 1)
Owner: shoppers do not understand "collections"; simplify and explain. Frontend only (no
migration, no API change).
- Console: collections are called "special lists" («العروض والقوائم الخاصة»); categories and lists
  are one page "Categories & lists" with two tabs (`/online/categories`, `?tab=lists`);
  `/online/collections` redirects there; one navigation entry. The product dialog shows the
  category first, then "Also show it in:" with the lists; pickers say "Special list: …".
- Storefront: on the products page only the categories are buttons; a list appears where the
  merchant places it, and as the chosen button when a link opened it.
- Tests: online-web +1 (two tabs, one navigation entry) and the dialog order checked; store-web
  +1 (lists are not buttons); e2e follows the renamed navigation.
- Verified (cloud sandbox): `pnpm verify` 383 unit/web, `pnpm test:integration` 311 (44 files),
  `pnpm test:e2e` 45.
- Released (ADR-0122): production `c74dc7cc1b12` (revision `arabat-web-00051-np8`, previous
  `arabat-web-00050-vgs`; migration job `arabat-migrate-p24tq`, no new migration). Cloud Build
  check `d1dc7a46`: `/api/v1/health/ready` 200 with that version and database ok (3 ms); `live`,
  `/store/`, `/manager/` and `/online/` 200. Signed out afterwards, `config.env` removed; no key,
  account or secret deleted. Staging: Railway still answered "Deploys have been paused
  temporarily" at the final retry (12:41 UTC); `main` deploys there once Railway resumes.

### 2026-10-21 — One catalog for the point of sale and the store (ADR-0130)
Owner's decision after a merchant's bad experience (a product and category made at the POS were
not in the store's categories; no "add product" in the store console; the catalog form did not
offer the store's categories): one shared category tree, every product in both places with a
website switch (store console only) and a POS switch (Business management only), marketing
collections, quick add from the store console, and protections against silent switches. BR-236.
- Migrations 0071 (`products.pos_visible`, category store settings, `online_listings.visible`,
  `online_collections` + `online_collection_products` with RLS, data copy of store categories
  into collections with the same ids, a hidden listing for every unlisted product, trigger
  `products_online_listing`) and 0072 (drops `online_listings.online_category_id` and
  `online_categories`). Tried on the demo database inside a rolled-back transaction first (33
  store categories → 33 collections, 31 memberships, 169 hidden listings) and then applied.
- API: listings of every product (`visible`, `posVisible`, `category`, `collectionIds`), bulk
  show / hide / set category / add to collection, category change audited as `product.updated`
  (`catalog.manage`); shared categories with store settings (create and rename need
  `catalog.manage`), store order, store picture; collections CRUD, order, picture, members;
  storefront `categories` (shared, shown, store order / name / picture) and `collections`,
  `product.collectionIds`; promotions match collections; POS catalog, device snapshot and
  `loadItems` (channel `pos`) leave out products hidden from the POS; online checkout ignores it.
- Console: shared Categories page (note, store name, "shown in the store", picture, order,
  uncategorized warning, "make categories from collections"), new Collections page, Products page
  (all products, website switch, filters, bulk bar, quick "Add product" with pasted picture,
  category and collections in the edit dialog), promotions and design pickers list collections.
- Business management: "Shown at the point of sale" in the product form, "Hidden at the POS" in
  the product list; categories subtitle says they are shared with the store.
- Storefront: a link, `?category=`, products and categories sections accept a category or a
  collection (former store-category ids keep working); collection chips on the products page;
  menus fall back to collections while no category is shown.
- Tests: integration +3 (both switches, shared categories and rights, collections with pictures
  and promotions) and the merchandising test rewritten; web +6 (online-web 34, store-web 26);
  e2e +1 (product added in the store console reaches the POS, each side's switch) and the store
  e2e follow the new console.
- Verified (cloud sandbox): `pnpm verify` 381 unit/web, `pnpm test:integration` 311 (44 files),
  `pnpm test:e2e` 45.
- Released (ADR-0122): production `7378c9751a32` (revision `arabat-web-00050-vgs`, previous
  `arabat-web-00049-q4d`; migration job `arabat-migrate-gxm2m` completed: migrations 0071 and 0072
  applied). Cloud Build check `77f64b35`: `/api/v1/health/ready` 200 with that version and
  database ok (3 ms); `live`, `/store/`, `/manager/` and `/online/` 200. Signed out afterwards,
  `config.env` removed; no key, account or secret deleted. Rollback of the code if ever needed:
  `--to-revisions=arabat-web-00049-q4d=100` (the old code does not know the new tables; the data
  of the old store categories is kept as collections). **Staging not updated:** Railway still
  answers "Deploys have been paused temporarily".

### 2026-10-21 — Pictures stored as WebP; store category dialog (ADR-0129)
Owner's requests: the "Add category" dialog must close after saving; say that the store's
categories are separate from the POS ones; allow pasting a picture into the category dialog;
convert every uploaded picture to WebP before saving.
- API: `toStorableImage` (`kernel/storage/image.ts`, `sharp`) in all six upload paths (product
  pictures, store logo / banner, online categories, design pictures, link-page avatar, pricing
  items): upright, metadata dropped, at most 2400 px, WebP quality 82, `.webp` keys,
  `image/webp`. Undecodable "pictures" are refused (415). `allowBuilds: sharp: false`.
- API client: every upload is re-encoded as WebP in the browser first (`api-client/src/image.ts`).
- Console: categories page note (separate from the POS categories); the dialog takes a picture
  by paste (Ctrl+V anywhere in it), drop or file before the first save, previews it, and one
  "Save" stores the category, then its picture, then closes.
- Tests: `kernel/storage/image.test.ts` (4); integration fixtures are now real PNGs and expect
  WebP (catalog, ecommerce, links, pricing); online-web category test rewritten (paste, one save,
  closes); e2e +1 (paste in Chromium → `image.webp` sent, `image/webp` stored, dialog closed) and
  the store e2e follows the new save-and-close.
- Verified (cloud sandbox): `pnpm verify` 375 unit/web, `pnpm test:integration` 308 (44 files),
  `pnpm test:e2e` 44.
- Released (ADR-0122): production `fc5d4219743f` (revision `arabat-web-00049-q4d`, previous
  `arabat-web-00048-ks4`; migration job `arabat-migrate-29gdd`, no new migration). The revision
  started with `sharp` loaded; Cloud Build check `f9100650`: `/api/v1/health/ready` 200 with that
  version and database ok (3 ms), `live` 200. Signed out afterwards, `config.env` removed; no key,
  account or secret deleted. **Staging not updated yet:** Railway answered "Deploys have been
  paused temporarily"; a retry is scheduled.

### 2026-10-20 — Page sections v2 for the home page (ADR-0128 amendment 3)
Owner's request: the same depth for the home page as for the header and footer. Frontend +
contract only (no migration).
- Contract: a `look` on every section (background, spacing, width, heading position and line,
  screens, schedule), eight new types (countdown, testimonials, faq, gallery, logos, collage, cta,
  spacer), richer slider / banner / products / categories / text / features, `readySection` (12),
  `homeLayout` (7), new pictures counted as in use. BR-234.
- Storefront: `design/frame.tsx` (section frame with scoped colour tokens for brand and dark
  bands, device and schedule filtering, heading with subtitle), `design/sections-more.tsx` (the
  eight types), slider arrows / heights / shade, banner second button, products sort and one-tap
  add, categories columns and "See all".
- Console: picker gallery (groups, drawings, search, ready-made tab), ready home pages with
  confirmation, home recommendations with fixes, section editor in three panels (content, look,
  visibility), editors for the new types, list flags (needs content, colour, screens, scheduled).
- Tests: contracts +5 (new `store-design.test.ts`), store-web +1 (25), online-web +2 (29). Screens
  checked in Chromium: the seven ready home pages on desktop and phone, the picker (both tabs) and
  a section's panels; fixed there: a missing label and the Arabic wording of the day buttons.
- Verified (cloud sandbox): `pnpm verify` 371 unit/web, `pnpm test:integration` 308 (44 files),
  `pnpm test:e2e` 43.
- Released (ADR-0122, ADR-0088): staging (Railway, deployment `4c1fe69f`, SUCCESS) and production
  `7b2a2792cca5` (revision `arabat-web-00048-ks4`, migration job `arabat-migrate-ngckd`, no new
  migration); Cloud Build check `5f1a459b`: `/api/v1/health/ready` 200 with that version and
  database ok (3 ms); `live`, `/store/`, `/manager/` and `/online/` 200. Signed out afterwards,
  `config.env` removed; no key, account or secret deleted.

### 2026-10-20 — Store footer system v2 (ADR-0128 amendment 2)
Owner's request: work through the footer completely, with every option, setting and
recommendation. Frontend + contract only (no migration).
- Contract: seven footer layouts, colour, top edge (line / wave / curve), width, spacing, columns,
  brand area, call-to-action band, up to 4 badges, nine block types (new: branches, free text;
  links up to 10), social icon style, bottom line (copyright, policy links, payments, language,
  back to top), folding on phones; `footerPreset` (shop, restaurant, brand, minimal),
  `suggestedBadges`; footers in the first format keep their look. BR-233.
- Storefront: `design/Footer.tsx` (layouts, SVG edges, CTA, badges, brand, blocks with icons,
  today's hours in bold, branches with open now, folding buttons, bottom line with back to top);
  social links in three styles.
- Console: Footer tab rebuilt (`features/design/FooterEditor.tsx`): ready footers, recommendations
  with progress and one-tap fixes, layout gallery, look, brand, CTA, badges, sortable blocks with a
  type picker, social, bottom line, phones. The preview scrolls to the footer while the tab is
  open.
- Tests: store-web +2 (24), online-web +2 (27); one storefront and one e2e query scoped to the
  page body (the footer now also says "Open now" / "Fast delivery"). Screens checked in Chromium:
  the seven layouts on desktop and phone, a folded and an opened block on a phone, the editor
  with the preview at the footer.
- Verified (cloud sandbox): `pnpm verify` 363 unit/web (56 files), `pnpm test:integration` 308
  (44 files), `pnpm test:e2e` 43.
- Released (ADR-0122, ADR-0088): staging (Railway, deployment `741c575d`, SUCCESS) and production
  `fa3eed9ced43` (revision `arabat-web-00047-vx6`, migration job `arabat-migrate-lwlgz`, no new
  migration); Cloud Build check `ab1e2aeb`: `/api/v1/health/ready` 200 with that version and
  database ok (3 ms); `live`, `/store/`, `/manager/` and `/online/` 200. Signed out afterwards,
  `config.env` removed; no key, account or secret deleted.

### 2026-10-20 — Design preview at true device width (ADR-0128 amendment 1)
Owner's report: header settings did not show in the preview, and the desktop preview looked like
a phone. Cause: the preview frame was only as wide as its column (≈ 600 px), so the store used its
phone layout and hid every large-screen header setting. The frame now renders the store at 1280 px
(desktop) or 390 px (phone) and scales it to fit. Checked in Chromium: the frame reports 1280 px,
and choosing split, floating and centred layouts and the dark colour changes the preview at once.
Tests: online-web preview test now checks both widths.
Verified (cloud sandbox): `pnpm verify` 359, `pnpm test:integration` 308, `pnpm test:e2e` 43.
Released (ADR-0122, ADR-0088): staging (Railway, deployment `e7696623`, SUCCESS) and production
`b804d852e157` (revision `arabat-web-00046-4l9`, migration job `arabat-migrate-ggbbq`, no new
migration); Cloud Build check `d96aef81`: `/api/v1/health/ready` 200 with that version and
database ok. Signed out afterwards, `config.env` removed; no key, account or secret deleted.

### 2026-10-20 — Store header system v2 (ADR-0128 amendment 1)
Owner's feedback: the header looked primitive and scattered, its settings were few, and there were
no different header designs or arrangements. Frontend + contract only (no migration).
- Contract: seven header layouts, top bar with up to 3 rotating messages and contact / social,
  navigation style boxed + position + categories menu (mega / dropdown), menu items with up to 10
  sub-items or the categories kind, ordered header buttons (cart always shown, each once), cart /
  search / language styles, colour incl. glass, bottom edge, height, width, hide on scroll, logo
  size, name switch, phone logo position and search bar, side menu as panel or full screen. Old
  designs parse unchanged (a hidden search stays hidden). BR-232.
- Storefront: `design/Header.tsx` (top bar, seven layouts, dropdowns and the categories mega menu,
  search bar that opens `/products?q=`, ordered buttons, sticky / hide on scroll, phones, side
  menu with sub-menus and category tiles) and `design/parts.tsx` (icons, social icon links,
  branch and language buttons); the catalog reads `?q=`.
- Console: Header tab rebuilt as panels (`features/design/HeaderEditor.tsx`) with a drawn
  thumbnail per layout, a sub-item editor, sortable header buttons with show switches.
- Tests: store-web +1 (22), online-web +1 (25). Screens checked in Chromium: all seven layouts on
  desktop and phone, the categories mega menu, the phone side menu and the editor; fixed there:
  a centred logo sat low and collided with the search bar, phone buttons hugged the menu button,
  oversized mega-menu tiles.
- Verified (cloud sandbox): `pnpm verify` 359 unit/web (56 files), `pnpm test:integration` 308
  (44 files), `pnpm test:e2e` 43.
- Released (ADR-0122, ADR-0088): staging (Railway, `main`, 2026-10-20 21:45 UTC, deployment
  `fa6a4981`, "Migrations and reference data applied") and production 2026-10-20: `0dd02efaf057`
  (revision `arabat-web-00045-htv`, migration job `arabat-migrate-2zz8k` completed, no new
  migration). Cloud Build check `f1f1f7a4`: `/api/v1/health/ready` 200 with version
  `0dd02efaf057` and database ok (3 ms); `live`, `/store/`, `/manager/` and `/online/` 200. Signed
  out afterwards, `config.env` removed; no key, account or secret deleted. This staging deploy
  also brings staging up to the store design release (ADR-0128) that had waited for Railway.

### 2026-10-20 — Storefront design: header, navigation, footer and page sections (ADR-0128)
Owner's request: the store looked primitive; let the owner design the navigation bar, header,
footer, side menu and the sections of the home, products and categories pages, for shops and
restaurants alike.
- Migration 0070: `online_store_designs` (draft / published), `online_store_assets`.
- Contracts: `storeDesignSchema` (shell + three pages, 11 section types with variants),
  `legacyDesign`, `templateDesign('retail' | 'restaurant')`, `videoEmbed`, safe links.
- API: `StoreDesignService` + `/manager/online/design` (save, publish, discard, picture library),
  `/manager/online/preview/*` (also a draft store), public `/store/:slug/design` and
  `/store/:slug/assets/:id`; CSP `frame-ancestors 'self'` and video `frame-src`; route cache
  headers no longer overwritten by the global `no-store`.
- Storefront: designed shell (announcement, 3 header layouts × 3 colours, 4 nav-bar styles, side
  menu, 4 footer styles with 7 block types, phone bottom bar, store colour / corners / background
  / cards / buttons), routes `/products` and `/categories`, section renderers, live preview mode.
- Console `/online/design`: templates, style, header and navigation, social accounts, footer
  blocks, page sections (add from a picker ordered for the business, drag to order, hide,
  duplicate, delete, per-type editors with picture upload and library), desktop / phone preview
  that follows every edit, save / publish / discard with status.
- Tests: integration +2 (23 in the file), store-web +3 (21), online-web +3 (24), e2e +1 (43).
  Screens checked in Chromium: editor with preview, retail and restaurant stores on desktop and
  phone, side menu.
- Verified (cloud sandbox): `pnpm verify` 357 unit/web (56 files), `pnpm test:integration` 308
  (44 files), `pnpm test:e2e` 43.
- Released (ADR-0122): production 2026-10-20: `59c95a9f752d` (revision `arabat-web-00044-l8k`,
  migration job `arabat-migrate-tq96t` completed: migration 0070 applied). Cloud Build check
  `55e5d427`: `/api/v1/health/ready` 200 with version `59c95a9f752d` and database ok (3 ms);
  `live`, `/store/`, `/manager/` and `/online/` 200. Signed out afterwards, `config.env` removed; no
  key, account or secret deleted. Staging: Railway answered "Deploys have been paused temporarily"
  on three attempts; once it resumed, staging was deployed from `main` at `0dd02efaf057` (see
  the header system v2 entry above).

### 2026-10-20 — Online store console redesign for young merchants (ADR-0127)
Owner's request: make the store console suit Gen Z. Frontend only (`apps/online-web`).
- Own palette (violet / pink, softer radii) and a dark mode (light / dark / device, remembered),
  scoped to the console's stylesheet; contrast checked at 4.5 : 1 or better in both modes.
- Shell: icon sidebar with a gradient active item and a waiting-orders badge, greeting top bar,
  floating bottom tab bar on phones (Home, Orders, Products, Promotions, More).
- Overview: gradient store card with copy link, share sheet and WhatsApp share; launch checklist
  with a progress ring; emoji order tiles; latest five orders; shortcuts. Orders: status chips
  with counts instead of a dropdown.
- Tests: `apps/online-web/src/app.test.tsx` +3 (21): launch steps, share link and the badge in the
  tab bar; theme switch and its memory; status chips. Screens checked in a real browser (desktop
  light / dark, phone, phone menu, Arabic and English).
- Verified (cloud sandbox): `pnpm verify` 351 unit/web (56 files), `pnpm test:integration` 306
  (44 files), `pnpm test:e2e` 42.
- Released (ADR-0122): staging (Railway, `main`, 2026-10-20 15:14 UTC, deployment `5667b169`)
  and production 2026-10-20: `321fc772d334` (revision `arabat-web-00043-nsn`, migration job
  `arabat-migrate-xdcsp` completed, no new migration). Cloud Build check `4f35ee7e`:
  `/api/v1/health/ready` 200 with version `321fc772d334` and database ok (3 ms); `live`,
  `/store/`, `/manager/` and `/online/` 200. Signed out afterwards, `config.env` removed; no key,
  account or secret deleted.

### 2026-10-20 — Online store Phases 6–10: shopper accounts, promotions, frontend-only 8–10 (ADR-0124/0125/0126)
Owner's directive: Phase 6 without SMS / WhatsApp, Phase 7 complete, Phases 8–10 frontend only,
one release at the end.
- Migration 0069: `customer_accounts`, `customer_sessions` (+ `customer_session_lookup`),
  `customer_password_resets`, `customer_addresses`, `online_promotions`, `online_promotion_uses`
  (append-only), `online_orders.promotion_* / discount_minor` with the new totals check,
  `online_stores.accounts_enabled`.
- API: `StoreAccountsService` (`/store/:slug/account/*`: register on the till's customer by
  phone, login / logout with bearer `st_…` tokens, me / update / password, forgot / reset by
  e-mail, orders, addresses; rate-limited; audited), `PromotionsService` (console CRUD, order,
  pause-on-delete, `apply` + `recordUse`), `POST /store/:slug/quote`, checkout with
  `promotionCode` / `saveAddress` / the account's customer, the discount on the order, the sale
  (`orderDiscountMinor`) and the packing slip.
- Console `/online`: Promotions page (list, dialog with scope targets, pause / delete),
  Analytics page (browser-computed, 7 / 30 / 90 days), settings: shopper accounts switch,
  gateway and domain placeholder sections. Storefront: account pages (sign in / register,
  orders, addresses, profile, forgot / reset), checkout prefill + saved addresses + "save this
  address", promotion code with the server's quote and the reason a code fails, discount rows on
  checkout and tracking, SEO meta + Open Graph + JSON-LD Product, PWA manifest + service worker.
- Tests: `ecommerce.int.test.ts` +3 (19), online-web +3 (18), store-web +2 (18); see TESTING.
- Docs: ADR-0124, ADR-0125, ADR-0126, BR-221…226, ROUTES, DATABASE (0069), ROADMAP,
  ARCHITECTURE, plan (Phases 6–10 with the differences), user guide chapter 24, CLAUDE.md.
- Verified (cloud sandbox): `pnpm verify` 348 unit/web (56 files), `pnpm test:integration` 306
  (44 files), `pnpm test:e2e` 42.
- Released (ADR-0122, one release for Phases 6–10): staging (Railway, `main`, 2026-10-20 14:32
  UTC, deployment `c788f249`, "Migrations and reference data applied") and production
  2026-10-20 14:34 UTC: `860a33847c2c` (revision `arabat-web-00042-dbv`, migration job
  `arabat-migrate-lxqz7` completed: migration 0069 and the reference data applied). Cloud Build
  check `4449078a`: `/api/v1/health/ready` 200 with version `860a33847c2c` and database ok
  (3 ms); `live`, `/store/`, `/manager/` and `/online/` (title "Arabat Online Store") 200.
  Signed out afterwards, `config.env` removed; no key, account or secret deleted.

### 2026-10-20 — Online store Phase 4: catalog and merchandising (ADR-0121)
Owner request ("ابدا خطوه 4"). The catalog, prices and stock stay shared with the POS; the store
adds how it presents them.
- Migration 0067: `online_categories` (name ar/en, position, status, picture, version; RLS),
  `online_listings` + store title / description, `featured`, `max_per_order`, store category,
  `updated_at`; `online_stores` + logo, banner, `hide_out_of_stock`. **No online price** (the plan
  had listed one; dropped under the owner's one-catalog principle of ADR-0119).
- API (`/manager/online/*`, `online.manage`): edit one listing, order listings, store categories
  CRUD + order + picture, store logo / banner (multipart ≤ 2 MB, sniffed, `FileStorage`); public
  store: logo / banner / category pictures (cached a day, `?v=`), `categorySource` (POS categories
  until the first store category), store titles win, all catalog pictures, featured, position,
  per-listing cap, sold-out hidden on request. Audit `online.listing_updated`,
  `online.listings_reordered`, `online.category_*`, `online.categories_reordered`.
- Console `/online`: Products online = listed products in store order with drag and drop
  (`@dnd-kit`, keyboard, ▲▼), "Edit" dialog (store title / description, store category,
  featured, max per order, catalog pictures read-only + link), "Remove from store"; not-listed
  table adds into a chosen store category. New page Store categories. Settings → Appearance
  (logo, banner, hide out-of-stock).
- Storefront: banner + logo, document title, featured section, category chips with pictures,
  sorting, gallery with thumbnails, share link, cap per listing.
- Tests: `ecommerce.int.test.ts` +2 (merchandising: listings order / edit / cap, category with
  picture and 415 on a non-image, storefront overrides and `categorySource` switch, delete →
  back to POS categories, logo / banner upload / public serving / removal; hide sold-out);
  `apps/online-web/src/app.test.tsx` +3 (13), `apps/store-web/src/app.test.tsx` +2;
  `e2e/store.spec.ts` pay-at-pickup flow adds a store category, a store title and featured, and
  the shopper sees them.
- Docs: ADR-0121, BR-211…214, ROUTES (console pages, API, storefront), DATABASE (0067),
  ROADMAP, plan (Phase 4 ✅ with the differences), user guide chapter 24.
- Verified (cloud sandbox): `pnpm verify` 338 unit/web (56 files), `pnpm test:integration` 299
  (44 files), `pnpm test:e2e` 41.
- Released: staging (Railway, `main`, 2026-10-20 08:19 UTC, migration applied) and, with the
  owner's approval ("انشر"), production 2026-10-20 08:46 UTC: `1ed5ab897326` (revision
  `arabat-web-00040-xgz`, migration job `arabat-migrate-kprwf` completed: migration 0067 and the
  reference data applied). Cloud Build check `60926dec`: `/api/v1/health/ready` 200 with version
  `1ed5ab897326` and database ok (3 ms); `live`, `/store/`, `/manager/` and `/online/` (title
  "Arabat Online Store") 200. Signed out afterwards; no key deleted.

## Next step
Online store: Phases 1, 2, 4, 5, 6, 7 ✅ and 8–10 frontend only (ADR-0126). Open backend work
needs the owner's decisions: a real payment gateway (provider choice, OQ-021), subdomains /
custom domains, an `online_events` stream for visits and abandoned carts, bot SSR for link
previews, SMS / WhatsApp. Production releases follow ADR-0122.
Production: confirm the client IP, SMTP token, alert policies, owner's decision on the bucket
lock, first restore drill.
Staging: first platform operator, SMTP; owner decisions OQ-021–025.
