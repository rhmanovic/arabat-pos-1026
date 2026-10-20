# CLAUDE.md — Project Master Instructions

This file is the entry point for every engineering session on this repository.
Read it fully before doing anything, then read the documents in `docs/` that are
relevant to the task.

## 1. What we are building

A new, production-grade, **multi-tenant Point of Sale (POS) and Business
Management SaaS platform**, built from scratch. There is no legacy code and no
historical data to preserve.

- The **product owner** gives business requirements.
- **Claude** acts as Principal Architect, Lead Full-Stack Engineer, Database
  Engineer, UI/UX Engineer, and QA Engineer, and owns engineering decisions and
  implementation.

## 2. Communication rules

- Communicate with the product owner in **Arabic**.
- Source code, identifiers, commit messages, API names, database names and
  these engineering documents are written in **English**.
- Do not ask the owner to choose ordinary libraries or implementation details.
  Ask **only** for: significant business decisions, external access/credentials,
  financial risk, or destructive operations.
- Report actual results honestly. Never present mocked, stubbed or partial
  functionality as complete.

## 3. Permanent architectural requirements (non-negotiable)

These are confirmed requirements. Changing any of them requires explicit
approval from the product owner and a new entry in `docs/DECISIONS.md`.

1. **Mandatory stack:** Node.js, React, PostgreSQL, TypeScript.
2. **Modular monolith** first. No premature microservices.
3. **Multi-tenant.** Each company (merchant / tenant) has:
   - one primary **owner** account (cannot be locked out or demoted by others),
   - multiple **employee** accounts created or invited by authorized management,
   - one or more **branches**,
   - its own products, inventory, sales and business data,
   - configurable **roles and permissions**.
4. **Three distinct interfaces**, each with its own layout, navigation and
   workflows:
   | Path        | Interface                        | Audience                          |
   |-------------|----------------------------------|-----------------------------------|
   | `/manager`  | Business management dashboard    | Owner / authorized managers       |
   | `/pos`      | Dedicated cashier interface      | Employees (cashiers), authorized managers |
   | `/platform` | SaaS operator administration     | Platform operator staff only      |
   `/manager` and `/pos` are the primary merchant-facing applications.
   They are **separate applications**, not one app with hidden menu items.
5. **Centralized authentication** with **backend-enforced** permissions and
   branch restrictions. The frontend may hide UI, but the backend is the only
   authority.
6. **Employee accounts never automatically access management functions.**
   Access to `/manager` requires an explicit permission.
7. **Managers may access the POS only if explicitly authorized** (explicit
   permission + branch assignment), not implicitly by being a manager.
8. **Platform operators are a separate identity realm** from merchant users.
   A merchant account can never reach `/platform` APIs.
9. **Arabic (RTL) and English (LTR)** in all interfaces.
10. **Tenant isolation is enforced on the backend** (application layer + database
   Row-Level Security). Never trust a tenant id sent by the client.
11. **Money:** default currency **KWD with 3 decimal places**. **Never** use
    floating-point arithmetic for monetary values. See `docs/BUSINESS_RULES.md`.
12. **Safe database transactions** for every multi-step write (sales, payments,
    stock movements, refunds).
13. **Never deploy, activate live payments, or incur paid costs** without the
    owner's explicit approval.
    Exceptions: ADR-0088 — standing approval to publish to **staging** once tests pass;
    ADR-0122 (2026-10-20) — standing approval to release `main` to **production** after
    `pnpm verify`, `pnpm test:integration` and `pnpm test:e2e` pass (owner's procedure, no key
    ever deleted; live payments and new paid costs still need explicit approval).

## 4. Engineering standards

- Financial accuracy is critical: integer minor units, explicit rounding,
  tested edge cases.
- Implement **functional vertical slices** (DB → API → UI → tests) rather than
  disconnected layers.
- Every feature ships with automated tests that were actually run. See
  `docs/TESTING.md`.
- Every endpoint declares its required permission; default is **deny**.
- Prefer maintainable, explicit code over clever abstractions.
- Financial and inventory records are **append-only**: corrections are new
  records (void, refund, adjustment), never silent updates or deletes.
- Security-relevant and financial actions are written to an audit log.
- No secrets in the repository. Use environment variables.

## 5. Working procedure for every task

1. Read `CLAUDE.md` and the relevant `docs/*` files.
2. Analyze the requirement; identify affected modules, data and permissions.
3. Inspect the current code before changing it.
4. Make routine technical decisions; record significant ones in
   `docs/DECISIONS.md`.
5. Implement database migration, backend, and frontend for the slice.
6. Write tests; run them; fix failures. Never skip or disable a test to pass.
7. Update documentation (`DATABASE.md`, `BUSINESS_RULES.md`, `PROGRESS.md`,
   `ROADMAP.md`, `TESTING.md` as applicable).
8. Report actual results to the owner in Arabic, including anything not done.

## 6. Documentation map

| File                     | Purpose                                                     |
|--------------------------|-------------------------------------------------------------|
| `docs/ARCHITECTURE.md`   | Stack, app boundaries, modules & dependencies, routing, API, i18n, deployment |
| `docs/AUTH.md`           | Authentication, sessions, permissions, branch scoping, overrides |
| `docs/ROUTES.md`         | Frontend routes per app and API namespaces                  |
| `README.md`              | Startup procedure and everyday commands                     |
| `docs/DATABASE.md`       | Database conventions, schema catalogue, migrations          |
| `docs/BUSINESS_RULES.md` | Confirmed business rules and open business questions        |
| `docs/DECISIONS.md`      | Architecture Decision Records (ADR log)                     |
| `docs/ROADMAP.md`        | Milestones and their acceptance criteria                    |
| `docs/PROGRESS.md`       | What is actually done, verified, and pending                |
| `docs/TESTING.md`        | Testing strategy, commands, and coverage expectations       |
| `docs/OPERATIONS.md`     | Configuration, release, migrations rollback, backups, monitoring, incidents |
| `docs/COMPETITOR_GAPS.md` | Features competitors have that Arabat does not (idea backlog) |

Rule: if a requirement or decision is confirmed in conversation, it must be
written into the appropriate document in the same session.

## 7. Key terms

- **Merchant** = tenant (company). Schema column `merchant_id`.
- **Membership** = a user's link to a merchant; **role assignment** = role at a
  branch (or all branches). See `docs/AUTH.md`.
- **Order** = mutable intent document; **Sale** = immutable financial document.

## 8. Repository map and commands

```
apps/api            NestJS + Fastify modular monolith (/api/v1), Drizzle, migrations in apps/api/drizzle
apps/manager-web    React SPA, basename /manager (ManagerLayout)
apps/pos-web        React SPA, basename /pos (POSLayout)
apps/platform-web   React SPA, basename /platform (PlatformLayout)
apps/store-web      Public storefront SPA, basename /store (no session; public store API)
apps/links-web      Link-page editor SPA, basename /links (manager session + online.manage, ADR-0116)
apps/online-web     Online store console SPA, basename /online (manager session + online.manage / online.orders, ADR-0119)
apps/landing-web    Public landing page at / (static React, no API; copy in src/content.ts, ADR-0113)
apps/device-web     Local-first till inside the native Arabat app (ADR-0112): built with base './',
                    published at /device-app/ with manifest.json; talks to the server only through window.ArabatApp
packages/money        bigint Money (KWD 3 decimals)          — built to dist (used by API)
packages/permissions  permission catalog + can()             — built to dist (used by API)
packages/pos-core     shared selling rules + receipt template (ADR-0112) — built to dist (used by API and the device app)
packages/device-core  device engine: local SQLite schema, sync, PIN, outbox, selling — built to dist (device app; `/testing` = fake bridge)
packages/contracts    Zod API contracts                      — built to dist (used by API)
packages/api-client   typed fetch client, ApiError           — source-only (web)
packages/i18n         i18next setup, ar/en common strings    — source-only (web)
packages/ui           design tokens + primitives             — source-only (web)
packages/web-core     providers, auth state, guards          — source-only (web)
```

Commands (see README.md): `pnpm setup:local`, `pnpm dev`, `pnpm verify`,
`pnpm test:integration`, `pnpm test:e2e`, `pnpm db:generate|db:migrate|db:seed`.
Before reporting work as done, run `pnpm verify`, `pnpm test:integration` and
`pnpm test:e2e`.

## 8a. Branches (one line of work, nothing lost)

- **`main` is the only integration branch** and the GitHub default. Every session starts from
  the latest `origin/main` (`git fetch origin main`), never from an older `claude/*` branch.
- Before taking a new **migration number, ADR number or BR number**, fetch `main` and use the
  next free number there. Parallel branches once all took migration 0048 and ADR-0105 and the
  production branch shipped without the assistant (2026-10-16, ADR-0110).
- Work done on a `claude/*` branch is merged into `main` in the same session, after the tests
  pass. Staging (Railway) and production (`infra/gcp/deploy.sh`) are released from `main`.
- Never delete a remote branch or a secret (Railway variables, Secret Manager) without the
  owner's explicit approval; keys are moved, never retyped into the repository.

## 9. Gotchas (learned the hard way)

- **Never put `NODE_ENV` in `.env`**: Vite copies it into `process.env` and would
  bundle React's development build. The web `vite.config.ts` files refuse to build
  with a non-production `NODE_ENV`.
- Built packages (`money`, `permissions`, `contracts`, `pos-core`) are consumed by the API from
  `dist/`: run `pnpm build:packages` after changing them (`pnpm typecheck` does it).
  Vite and Vitest read their `src/` through the `source` export condition.
- NestJS needs decorator metadata: API code must keep value imports for injected
  classes (the type-import lint rule is disabled under `apps/api`), and Vitest uses
  SWC for API tests.
- Every API route needs `@Public`, `@Authenticated`, `@RequirePermission` or
  `@RequirePlatformRole`; otherwise the API refuses to boot.
- Use logical Tailwind utilities (`ms-/me-/ps-/pe-/start-/end-`); ESLint rejects
  physical left/right classes.
- Fonts must not be inlined as `data:` URIs (CSP `font-src 'self'`).
- Drizzle renders bare column names inside correlated `sql` subqueries; qualify outer
  columns explicitly (`sql.raw('"products"."id"')`) or the subquery binds to itself.
- `app_owner` is not filtered by RLS (it owns the tables; no BYPASSRLS, ADR-0105): seeds,
  migrations and test fixtures must filter by `merchant_id` themselves. Never write
  `force row level security` in a migration (Cloud SQL would then lock the owner out).
- Prettier reformats long literals; scripted text edits must assert that the target
  string exists before replacing.
- Merchant status and subscription updates need `app.operator_id` (database trigger), also in
  owner-role fixtures: `select set_config('app.operator_id', gen_random_uuid()::text, true)`.
- Uploaded files go through `FileStorage` (`apps/api/src/kernel/storage`); never write
  to disk directly. Local storage lives in `var/` (git-ignored).
- In this cloud sandbox: Node 24 is at `~/.local/node24/bin` (if missing, unpack the official
  linux-x64 tarball there), Docker must be started with `dockerd &`, Docker Hub may answer 429
  (pull `mirror.gcr.io/library/postgres:18` and tag it `postgres:18`), and Playwright needs
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`.
- The sandbox exports `ANTHROPIC_BASE_URL` for Claude Code's own tunnel; the Anthropic SDK
  reads it too, so start the API with `env -u ANTHROPIC_BASE_URL …` when testing the POS
  assistant with a real key, or its requests never reach `api.anthropic.com`.
- `pnpm db:migrate` and `pnpm db:seed` run from `apps/api/dist`: build the API first.
- `pkill -f dist/main.js` kills the calling shell too (the pattern matches its own command
  line); stop the API with `kill $(pgrep -f "^node --env-file")`.

## 10. Repository status

Implemented: foundation, authentication, branches/employees/RBAC, manager dashboard,
product catalog, inventory engine, payments/registers/shifts, POS checkout, returns/refunds,
purchasing and branch transfers, customers, reports, restaurant module, online store with a
sandbox payment gateway, platform administration with subscription plans and limits (see
`docs/PROGRESS.md`). No real payment gateway is connected and nothing is billed.
Plan limits are checked with `SubscriptionsService.assertCapacity` in the creating transaction;
platform code uses `withPlatformContext` (merchant status/subscription changes need it).
Online reservations (`stock_reservations`) are honoured by `StockLedgerService.apply`.
Stock consumption of sold items is expanded by `stockConsumption` (recipes, modifier ingredients).
Stock balances change **only** through `StockLedgerService.apply` (inventory module).
Cash balances (registers, treasuries) change **only** through `apps/api/src/modules/payments/cash-ledger.ts`
(`postEntries` / `postTransfer` / `postDisbursement`); a shift opens and closes with a count against the
drawer balance (ADR-0090). Expenses and supplier payments are `cash_disbursements`, never transfers (ADR-0091).
Bank deposits go register/treasury → `deposit_transit` with a mandatory slip reference and reach the bank only
through a second person's confirmation transfer (`confirms_transfer_id`, ADR-0096); bank accounts are reconciled by hand.
Stock adjustments above the company limit at cost are `pending` until a second holder of `inventory.adjust`
approves (ADR-0097); master data that still holds stock cannot be untracked, archived or deactivated (BR-171).
Transfer shortages are explicit `stock_transfer_losses` documents (approved at the source above the limit); in-transit
stock is computed from transfer lines, never stored, and a transfer in transit can be recalled (ADR-0098).
The moving average is carried in `avg_cost_micro` (fils × 1000); `avg_cost_minor` is display only (ADR-0099).
Non-restocked refund lines become `damaged_returns` custody records (held → disposed once).
Selling rights are checked in `completeSaleInTx`, where a single-use `sale_overrides` grant from a supervisor
(`POST /pos/overrides`) may supply what the cashier lacks; price changes need a reason and stay within the
company bounds; free sales need `sales.zero_total` and a reason (ADR-0100).
Refunds of one's own sales wait for a second person and exchange credit goes back to the original tenders;
non-cash methods need a settlement account and card / transfer tenders a reference; held sales expire;
reprints and cleared carts are logged (ADR-0101). The discount limit is combined per line (D4).
Periods are cut only through `apps/api/src/kernel/time/period.ts` in the merchant's single time zone (BR-184);
refunds count on their completion day; report views and exports are audited; the supplier statement is
received at order cost vs. cash paid (ADR-0102). Months close in order through `PeriodsService` with a stored
pack; `assertPeriodOpen` refuses purchasing documents dated in a closed month (ADR-0103, BR-189/190).
Ownership moves only through `OwnershipService` (owner flow with e-mailed code, or platform with a reason); a
frozen owner is refused at login and on every request; audit entries carry `changes` from `diffFields`;
variant price / cost changes are appended to `price_history` (ADR-0104, BR-020/191/192/193).
Production is prepared for Google Cloud in Doha (Cloud Run + Cloud SQL, `infra/gcp/`, OPERATIONS.md §9,
ADR-0105) and live since 2026-10-15 at `https://www.arabatapp.com` (started empty); `hosted-start` works without SUPERUSER/BYPASSRLS
(`scripts/verify-managed-postgres.sh`); `FILE_STORAGE_DRIVER=gcs` stores images in Cloud Storage.
Receipts also print server-side through print agents (ADR-0111): jobs are queued in the sale's transaction
(`PrintJobsService.queueAutoInTx`), announced over PostgreSQL NOTIFY to the Socket.IO namespace `/print-agent`.
Selling decisions (prices, limits, rights, tenders, shift notes, refunds) live in `packages/pos-core` (pure, no DB);
the services load data and call it through `rules()` (`kernel/errors/pos-rule.ts`). Local-first devices: ADR-0112 (Accepted), contract `docs/DEVICE_API.md`, handover `docs/DEVICE_APP_HANDOVER.md`.
Plan A (ADR-0112 amendment 2): one `primary` device per branch (`pos_devices.role`), which is also the branch's print
agent with its device token; the browser POS signs in with name + PIN through a branch link (`PinSignInService`).
Public site: landing `/` and pricing `/pricing` (`apps/landing-web`, ADR-0113/0114); pricing-page items live in the `pricing`
module (`/platform/offer`); the pricing page's form opens a trial account through `/public/trial/start` (ADR-0115 amendment 3).
Free-trial funnel `/start` and `/platform/trials` (`trials` module, ADR-0115): the account opens at once (no e-mail
code in this phase, amendment 1), through `RegistrationService.createAccount`; every trial number is an operator setting.
The landing navbar's "Our apps" dropdown reads `site_apps` (`site` module, `/platform/site-apps`, ADR-0117).
Online store (`docs/ONLINE_STORE_PLAN.md`): pay on receipt and store address (ADR-0118), the `/online` console
(ADR-0119), merchandising (ADR-0121), fulfilment (ADR-0123: delivery areas, serving branches, hours / slots, order
e-mails after commit, packing slips, till hand-over through `/pos/online-orders`), shopper accounts (ADR-0124: e-mail +
password realm `customer_accounts`, bearer `st_…` tokens, reset by e-mail, no SMS), promotions (ADR-0125: one per order,
`POST /store/:slug/quote`, discount recorded on the sale), Phases 8–10 frontend only (ADR-0126); the console has its own palette and dark mode (ADR-0127); store design with draft / publish and live preview (ADR-0128; header system v2 with seven layouts, top bar, sub-menus / categories menu and ordered header buttons: amendment 1; footer system v2 with seven layouts, presets, recommendations, CTA, badges and folding blocks: amendment 2). Composite FKs must never carry
`on delete set null` (it nulls `merchant_id`); reference the parent `id` alone.
See `docs/PROGRESS.md` for the current state and `docs/ROADMAP.md` for next steps.
