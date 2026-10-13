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
| Deployment | Not planned | Requires owner approval |

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

## Next step
First platform operator on staging, SMTP and volume if wanted; owner decisions OQ-011/021–025
before any production launch.
