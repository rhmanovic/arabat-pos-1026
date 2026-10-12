# Architecture Decision Records

Format: each decision has an id, date, status (`Accepted`, `Proposed`,
`Superseded by ADR-xxxx`), context, decision and consequences. Never delete an
ADR; supersede it.

---

## ADR-0001 — Separate Manager, POS and Platform interfaces
- **Date:** 2026-10-11 · **Status:** Accepted (owner requirement)
- **Context:** The owner requires `/manager`, `/pos` and `/platform` as distinct
  interfaces with their own layouts, navigation and workflows. Employees must not
  gain management access by default; managers use the POS only when authorized.
- **Decision:** Build three independent React SPAs (`manager-web`, `pos-web`,
  `platform-web`) served under their paths on one origin, backed by one API with
  separate namespaces (`/api/v1/manager`, `/api/v1/pos`, `/api/v1/platform`).
  Interface access is governed by explicit permissions (`manager.access`,
  `pos.access`) and, for the platform, a separate identity realm.
- **Consequences:** Separate bundles (employees never download manager code);
  some duplication of shell code, mitigated by shared `packages/ui` and
  `packages/api-client`. Hiding UI is never the security boundary.

## ADR-0002 — Technology stack
- **Date:** 2026-10-11 · **Status:** Superseded by ADR-0009 (versions verified)
- **Decision:** Node.js (Active LTS), TypeScript strict, pnpm workspaces,
  NestJS with Fastify adapter, Drizzle ORM + SQL migrations, PostgreSQL,
  React + Vite, React Router, TanStack Query, Tailwind + Radix-based components,
  Zod, Vitest, Playwright. Exact versions pinned at scaffold time from official
  documentation.
- **Rationale:** NestJS modules/guards map directly onto a modular monolith with
  layered authorization. Drizzle keeps SQL explicit, which matters for RLS,
  transactions and financial queries. Vite + React is the standard modern SPA
  toolchain.

## ADR-0003 — Modular monolith
- **Date:** 2026-10-11 · **Status:** Accepted (owner requirement)
- **Decision:** Single deployable backend, single database, strict module
  boundaries. Revisit only with measured need.

## ADR-0004 — Tenant isolation: shared schema + application scoping + RLS
- **Date:** 2026-10-11 · **Status:** Accepted (column renamed `merchant_id` by ADR-0015)
- **Decision:** All tenant data in shared tables with `tenant_id`. The tenant id
  is taken from the authenticated session only. Every query is scoped in the
  application, and PostgreSQL RLS (forced) is enabled on every tenant table as
  defence in depth. The runtime DB role cannot bypass RLS.
- **Consequences:** Each transaction must `SET LOCAL app.tenant_id`. Isolation
  tests are mandatory for every tenant table.

## ADR-0005 — Money as integer minor units
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** Store money as `bigint` minor units plus ISO currency code; KWD
  exponent 3. In TypeScript, a `Money` value object based on `bigint` with
  explicit rounding. Floats and the PostgreSQL `money` type are forbidden.
- **Consequences:** Serialization over JSON uses strings for amounts (e.g.
  `"1.250"` or minor units as string) to avoid JS number precision issues.

## ADR-0006 — Server-side sessions with interface binding
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** Centralized auth with opaque session cookies backed by a
  `sessions` table (not long-lived JWTs), allowing immediate revocation. Sessions
  record the interface (`manager` / `pos` / `platform`) and POS branch.
  Passwords hashed with Argon2id.

## ADR-0007 — Platform operators as a separate identity realm
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** Platform staff live in `platform_operators`, authenticate via a
  separate endpoint, and their sessions cannot call merchant APIs (and vice versa).

## ADR-0008 — Append-only financial and inventory records
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** Sales, payments, refunds, stock movements and audit entries are
  insert-only; corrections are compensating records.

---

## ADR-0009 — Verified stack versions (supersedes ADR-0002)
- **Date:** 2026-10-11 · **Status:** Accepted
- **Context:** Versions verified against the npm registry, nodejs.org release
  index and postgresql.org on 2026-10-11.
- **Decision:** Node.js 24 LTS; pnpm 12; TypeScript 6.0; NestJS 12 + Fastify 5;
  Zod 4; Drizzle ORM 0.45 + drizzle-kit 0.31 + `pg`; PostgreSQL 18; React 19.3;
  Vite 8; React Router 8 (data mode); TanStack Query 5 / Table 9; Zustand 5;
  React Hook Form 7; Tailwind CSS 4 + shadcn/ui pattern on Radix; i18next 26 +
  react-i18next 17; Vitest 5; Playwright 1.64; Testcontainers 12; ESLint 10 +
  typescript-eslint 8; Prettier 3; Argon2id; pino. Full table in
  `ARCHITECTURE.md` §2.
- **Not chosen now:** Node 26 (not yet LTS), TypeScript 7 (see ADR-0010),
  Drizzle 1.0 (release candidate), PostgreSQL 19 (beta).

## ADR-0010 — Stay on TypeScript 6.0 for now
- **Date:** 2026-10-11 · **Status:** Accepted
- **Context:** TypeScript 7.0 (native compiler) is released, but
  typescript-eslint 8.x declares `typescript <6.1`, and NestJS depends on
  decorator metadata emit.
- **Decision:** Use TypeScript 6.0.x. Re-evaluate when lint tooling and NestJS
  officially support 7.x.

## ADR-0011 — Branch-scoped role assignments
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** Roles are per merchant; a membership receives roles through
  `role_assignments (membership, role, branch_id | NULL)`. NULL = all branches.
  Permissions carry a scope (`merchant` or `branch`); merchant-scoped
  permissions require a merchant-wide assignment. Interface access
  (`manager.access`, `pos.access`) is branch-scoped and independent.
- **Rationale:** Supports "manager at branch A, cashier at branch B" without a
  second model, and keeps branch restriction in one place. Details: `AUTH.md`.

## ADR-0012 — REST API with shared Zod contracts
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** REST/JSON under `/api/v1/{manager|pos|platform|auth}`; Zod
  schemas in `packages/contracts` used by API and frontends; OpenAPI generated;
  RFC 9457 errors; money as decimal strings; idempotency keys on POS writes.
- **Rejected:** GraphQL (complex authorization per field, caching), tRPC
  (couples clients to server internals, unsuitable for future public APIs).

## ADR-0013 — Thin interface controllers over shared domain services
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** Each domain module exposes application services; manager, POS
  and platform controllers are thin adapters. Critical pure logic (money,
  pricing) lives in shared packages so the POS preview and the authoritative
  server calculation use the same code.

## ADR-0014 — Arabic/English with RTL/LTR from the first UI
- **Date:** 2026-10-11 · **Status:** Accepted (owner requirement in Prompt 2)
- **Decision:** i18next in all apps; `dir` on `<html>`; only logical CSS
  properties (lint-enforced); bilingual `name_en`/`name_ar` columns for
  receipt-visible master data; merchant default language + user preference.
  Default language and digit style remain open (OQ-001, OQ-012).

## ADR-0015 — "Merchant" as the tenant term in code and schema
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** The tenant entity is `merchants`; the isolation column is
  `merchant_id`; RLS setting `app.merchant_id`. "Tenant" remains the generic
  architectural term in prose.

## ADR-0016 — Orders and sales are separate concepts
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** Orders are mutable intent/fulfilment documents (held carts,
  tables, online orders) with no financial effect; sales are immutable financial
  documents created atomically with payments and stock movements. Refunds and
  voids are separate compensating documents.

## ADR-0017 — Local environment: Docker Compose; jobs in PostgreSQL
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** Docker Compose with `postgres:18` and Mailpit for local
  development; integration tests via Testcontainers (fallback: local cluster).
  Background jobs, when needed, use pg-boss — no Redis/broker initially.

## ADR-0018 — Deployment shape (design only)
- **Date:** 2026-10-11 · **Status:** Proposed — provider/region need owner approval (OQ-011)
- **Decision:** One container image (API + worker entrypoints), static SPAs on
  CDN/proxy, managed PostgreSQL 18 with PITR, object storage, GitHub Actions CI.
  No deployment until approved.

---

## ADR-0019 — Integration tests use a dedicated database instead of Testcontainers
- **Date:** 2026-10-11 · **Status:** Accepted (amends ADR-0017)
- **Decision:** Integration tests connect to `arabat_test` (created by the same init
  script as `arabat_dev`) through `TEST_DATABASE_URL` / `TEST_DATABASE_OWNER_URL`.
  CI uses a `postgres:18` service container. Missing configuration fails the run;
  tests never skip silently.
- **Rationale:** Same behaviour locally and in CI, no Docker-in-Docker requirement,
  faster runs. Testcontainers can be added later for parallel isolated databases.

## ADR-0020 — Package build strategy and `source` export condition
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** Universal packages used by the API (`money`, `permissions`,
  `contracts`) compile to `dist/` with `tsc`; their `exports` also expose a
  `source` condition pointing to `src/`, used by Vite and Vitest. Browser-only
  packages (`api-client`, `i18n`, `ui`, `web-core`) are source-only and compiled by
  each app's Vite build. The API is compiled with `tsc` (decorator metadata) and run
  with plain Node; tests use SWC for the same reason.

## ADR-0021 — API can serve the built SPAs (single origin)
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** With `SERVE_WEB=true` the API serves `/manager/*`, `/pos/*`,
  `/platform/*` from each app's `dist/` (SPA fallback per app, 404 for missing
  assets, immutable caching for hashed assets). Used for production-like local runs
  and E2E tests. A CDN/reverse proxy may replace it in production (ADR-0018).

## ADR-0022 — M0 session resolver denies everything
- **Date:** 2026-10-11 · **Status:** Superseded by ADR-0024
- **Decision:** The `SessionResolver` abstraction is bound to `NoSessionStoreResolver`
  (always "no session"). Combined with the default-deny `AccessGuard` and the boot
  time route auditor, only `@Public` routes (health) are reachable. The login forms
  are visibly disabled — no fake login exists. M1 replaces the resolver with the
  database-backed session store.

## ADR-0023 — Frontend primitives without Radix for now
- **Date:** 2026-10-11 · **Status:** Superseded by ADR-0035
- **Decision:** M0 primitives (Button, Input, Field, Card, Alert, Badge, Segmented,
  Spinner, EmptyState) are plain accessible components with
  `class-variance-authority` + `tailwind-merge`. Radix primitives are added when the
  first complex widget (dialog, menu, popover) is needed (M1).

---

## ADR-0024 — Database-backed sessions validated on every request
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** `DbSessionResolver` replaces the deny-all resolver. Opaque 256-bit tokens
  (SHA-256 stored), one cookie per interface, server-side revocation, idle + absolute
  expiry, and a full context re-check on each request (user, membership, merchant,
  interface permission, POS branch). Multi-step sign-in uses single-use `auth_tickets`.

## ADR-0025 — Self-service owner registration; enumeration trade-off
- **Date:** 2026-10-11 · **Status:** Accepted (owner requirement, Prompt 4)
- **Decision:** `POST /auth/register` creates the merchant and owner in one
  transaction and signs the owner in. It answers 409 for a registered e-mail (cannot
  be hidden without an e-mail verification flow); rate limited per IP. E-mail
  verification is not required yet (`users.email_verified_at` is reserved).

## ADR-0026 — CSRF: SameSite cookies + origin verification
- **Date:** 2026-10-11 · **Status:** Accepted (refines AUTH.md)
- **Decision:** No CSRF token; state-changing API requests are rejected when
  `Sec-Fetch-Site` is `cross-site` or `Origin` is foreign (`TRUSTED_ORIGINS` for
  extra hosts). Combined with SameSite=Lax/Strict cookies and JSON-only bodies.

## ADR-0027 — Authentication rate limits in PostgreSQL
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** Fixed-window counters in `rate_limit_buckets` (atomic upsert), so limits
  hold across API instances without Redis. Per-account failure counters act as account
  lockout. `AUTH_RATE_LIMIT_SCALE` relaxes limits for E2E runs only.

## ADR-0028 — In-house RFC 6238 TOTP and Argon2id via @node-rs/argon2
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** TOTP is ~60 lines on `node:crypto` (tested), avoiding an extra
  dependency; secrets encrypted with AES-256-GCM. Passwords: Argon2id
  (m=19456 KiB, t=2, p=1) via prebuilt `@node-rs/argon2` (no install scripts).

## ADR-0029 — RLS user context for pre-merchant reads
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** `app.user_id` (`app_current_user_id()`) lets a user read their own
  `memberships` and those `merchants` before a merchant is chosen. All other merchant
  tables remain strictly merchant-scoped. `withContext({merchantId, userId})`.

## ADR-0030 — Mailpit and nodemailer for e-mail
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** `Mailer` abstraction with SMTP (nodemailer); locally and in CI the SMTP
  server is Mailpit (no paid provider). Tests use an in-memory mailer. A production
  e-mail provider needs owner approval (cost).

## ADR-0031 — Migration role bypasses RLS
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** `app_owner` (migrations, seeds, CLI) has `BYPASSRLS` so data migrations
  and template sync can touch every merchant. It is never used by the API; the
  runtime role stays without bypass. Owner-role code filters by `merchant_id`
  explicitly. Existing local databases: `ALTER ROLE app_owner BYPASSRLS` once.

## ADR-0032 — Invitation-only employee onboarding
- **Date:** 2026-10-11 · **Status:** Accepted (Prompt 5)
- **Decision:** Invitations with hashed single-use tokens and stored role grants;
  acceptance creates the membership atomically. RLS lets the token holder read only
  their invitation (`app.invite_hash`). No temporary passwords exist.

## ADR-0033 — Coarse route gate + exact checks in services
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** Guards check a permission at the request's branch or "anywhere"; services
  enforce per-object branch checks and anti-escalation (`assertCan`, `canGrant`,
  `canManageMember`) and filter lists by `permissionBranchScope`.

## ADR-0034 — Granular permission catalog with branch-scoped administration
- **Date:** 2026-10-11 · **Status:** Accepted (supersedes the initial catalog)
- **Decision:** 40 keys grouped by module (AUTH.md §3.4); employee and branch
  administration are branch-scoped so branch managers manage their own staff;
  role definition and branch creation stay merchant-wide.

## ADR-0035 — Radix primitives for complex widgets
- **Date:** 2026-10-11 · **Status:** Accepted (Prompt 6)
- **Decision:** `packages/ui` wraps Radix (`radix-ui`) for Dialog/ConfirmDialog, menus,
  tabs and toasts; native `<select>`/checkbox for speed and touch. A Radix
  `Direction.Provider` follows the active language so menus and tabs mirror in RTL.

## ADR-0036 — Unfinished modules are visible but disabled
- **Date:** 2026-10-11 · **Status:** Accepted (Prompt 6 requirement)
- **Decision:** The navigation lists future modules with a "Not available yet" badge and
  no link, so nobody mistakes a placeholder for a finished feature. A module becomes a
  link (`available: true` in `app/navigation.ts`) only when it works end to end.

## ADR-0037 — Branch context in the manager app
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** The top bar offers the branches the API returns for the user (already
  scope-filtered) plus "All branches" when allowed. The choice filters views on the
  client and is persisted per browser; it never widens access — every query is still
  filtered server-side.

## ADR-0038 — File storage abstraction for uploads
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** Uploads go through an abstract `FileStorage` (put/get/delete by safe key).
  Development and tests use `LocalDiskStorage` (`FILE_STORAGE_DIR`, default `var/uploads`).
  An object-storage adapter (S3-compatible) is added at deployment time — it incurs cost
  and needs owner approval. Images are served by the API with `nosniff` and a strict CSP,
  only to users who can read that merchant's catalog.

## ADR-0039 — SKU and barcode uniqueness
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** SKU is unique per merchant (case-insensitive) including archived variants,
  so historical references stay unambiguous. Barcodes are unique per merchant among live
  variants; archiving a variant frees its barcodes for reuse. Violations return
  `DUPLICATE_SKU` / `DUPLICATE_BARCODE` (409).

## ADR-0040 — Price permission and cost visibility
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** Editing products needs `catalog.manage`; changing prices, costs or adding
  priced variants additionally needs `catalog.prices.manage`. Costs are omitted from API
  responses for users without it and ignored in their writes. Every price change is
  audited with `{from, to}`.

## ADR-0041 — POS catalog snapshot with ETag
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** The POS downloads one snapshot of sellable items for its bound branch
  (`GET /pos/catalog`), versioned by a SHA-256 of its content and served with `ETag`, so
  terminals refresh cheaply (304) and search/barcode lookup is instant on the client.
  Prices are always re-read on the server at checkout; the snapshot is never trusted for
  money.

## ADR-0042 — Inventory ledger with locked balances
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** Stock is an append-only ledger (`stock_movements`) plus a balance row per
  branch and variant (`stock_levels`). One reusable engine (`StockLedgerService.apply`)
  is the only code that changes balances; it runs inside the caller's transaction, locks
  the affected balances with `SELECT … FOR UPDATE` in variant-id order, validates the
  whole document before writing (all-or-nothing) and writes one ledger row per change.
  Sales, refunds, transfers and purchase receipts call it with their own source document.
- **Why:** row locks give exact, serial behaviour per item without serializable
  transactions; the ledger makes every balance explainable and auditable.

## ADR-0043 — Costing: moving weighted average
- **Date:** 2026-10-11 · **Status:** Accepted (engineering default, see OQ-014)
- **Decision:** Each branch balance keeps a moving weighted-average unit cost.
  Incoming stock with a cost: `avg = (on_hand × avg + qty × cost) / (on_hand + qty)`,
  rounded half-up to the fils; if the balance is ≤ 0 or has no cost yet, the incoming
  cost replaces it. Incoming stock without a cost uses the current average, then the
  product cost. Outgoing stock leaves at the current average (recorded on the movement),
  the average is unchanged. Valuation = Σ positive balances × average, rounded half-up
  per balance; balances without a known cost are reported as "unvalued".

## ADR-0044 — Negative stock policy
- **Date:** 2026-10-11 · **Status:** Accepted (BR-062)
- **Decision:** By default no movement may take a balance below zero
  (`INSUFFICIENT_STOCK`, 409, listing each short line). A merchant may explicitly allow
  negative stock (`inventory_settings`); callers can still force `deny` (e.g. transfers).

## ADR-0045 — Exact decimal quantities
- **Date:** 2026-10-11 · **Status:** Accepted
- **Decision:** Quantities have 3 decimals, `numeric(14,3)` in PostgreSQL and bigint
  thousandths in code; inputs with more decimals are rejected, never rounded.

## ADR-0046 — Shift policy: one employee per register
- **Date:** 2026-10-12 · **Status:** Accepted (BR-073)
- **Decision:** At most one open shift per register and one per employee (partial unique
  indexes, so concurrent opens cannot both succeed). Only the shift owner records cash
  movements, sells (Prompt 10) and closes; another cashier cannot use an occupied
  register. A manager with `registers.manage` may force-close an abandoned shift with a
  mandatory note (audited as `shift.force_closed`). Closed shifts are immutable (DB
  trigger).
- **Why:** per-person accountability for drawer cash is the basis of reconciliation.

## ADR-0047 — Expected cash is always derived
- **Date:** 2026-10-12 · **Status:** Accepted
- **Decision:** Expected cash = opening float + cash in − cash out + cash sales − cash
  refunds, computed from records at closing and stored with the counted amount and the
  register tolerance in force (snapshot). Cash out larger than the expected drawer cash is
  refused (`INSUFFICIENT_CASH`) under the shift row lock. Cash sales/refunds read the
  payment records added in Prompts 10/11.

## ADR-0048 — Processing fees per payment
- **Date:** 2026-10-12 · **Status:** Accepted (BR-071)
- **Decision:** A method's fee rule is none, fixed, percentage or fixed + percentage.
  `processingFee()` (`@arabat/money`) computes fixed + round-half-up(amount × percent) in
  fils, never negative, capped at the amount. The fee is calculated and stored on each
  payment at payment time (Prompt 10), so later rule changes never alter history.

## ADR-0049 — Gateways: configuration placeholder only
- **Date:** 2026-10-12 · **Status:** Accepted
- **Decision:** Methods may name a future provider (tap, upayments, hesabe, bookeey) but
  `gatewayLive` is always false and `gateway_config` never stores secrets. Integration
  (Prompt 16) uses a sandbox/mock adapter; live activation needs owner approval.

## ADR-0050 — Money.parse reports all invalid input as MoneyError
- **Date:** 2026-10-12 · **Status:** Accepted
- **Decision:** `Money.parse('')` used to throw the internal `InvalidDecimalError`, which
  callers did not expect (a web test caught a crash on an empty amount field). It now
  throws `MoneyError` for every invalid amount.

## ADR-0051 — Server-side atomic checkout with client cart
- **Date:** 2026-10-12 · **Status:** Accepted
- **Decision:** The POS keeps the cart locally and sends it once at checkout. The server
  re-prices from the catalog, checks permissions, validates payments and writes order,
  sale, lines, payments, stock movements, balance entries and audit in **one**
  transaction under the cashier's shift row lock. The cashier's expected total is sent
  and must match (`TOTAL_CHANGED` otherwise), so a price change between display and
  payment is never silently charged.
- **Why:** one round trip per sale (fast on busy tills), no partially written sales.

## ADR-0052 — Shared pricing function
- **Date:** 2026-10-12 · **Status:** Accepted (BR-080)
- **Decision:** `priceCart()` in `@arabat/money` is used by the POS (display) and the API
  (authoritative): gross = half-up(unit × qty); line discount (percent half-up or amount
  ≤ gross); order discount on the remaining base, allocated by largest remainder; no tax
  (OQ-002), no cash rounding (OQ-003).

## ADR-0053 — Checkout idempotency
- **Date:** 2026-10-12 · **Status:** Accepted
- **Decision:** The POS generates one key per payment attempt; `orders.idempotency_key` is
  unique per merchant. A retry with the same key and body returns the existing sale; the
  same key with a different body is `IDEMPOTENCY_CONFLICT`. Concurrent duplicates race on
  the unique index and the loser returns the winner's sale.

## ADR-0054 — Receipt numbering
- **Date:** 2026-10-12 · **Status:** Accepted
- **Decision:** `{BRANCH CODE}-{6-digit sequence}` per branch, from an atomic
  `insert … on conflict do update … returning` inside the checkout transaction, so numbers
  are unique and gap-free (a failed checkout rolls its number back).

## ADR-0055 — Payment verification states
- **Date:** 2026-10-12 · **Status:** Accepted
- **Decision:** Payments carry `status` (succeeded | pending | failed) and `verification`
  (manual: cashier-confirmed cash/card terminal/transfer; gateway: provider-verified).
  A sale completes only with succeeded payments; methods configured with a gateway are
  refused at the POS (`PAYMENT_NOT_VERIFIED`) until Prompt 16 adds verified integration.

## ADR-0056 — Refunds as linked records with derived balances
- **Date:** 2026-10-12 · **Status:** Accepted
- **Decision:** Sales are never modified. A refund is a new record linked to the sale; what
  can still be refunded (per line and per payment) is always derived from the active
  refunds. Requests for one sale are serialized with `pg_advisory_xact_lock` (sales rows
  cannot be `FOR UPDATE`-locked because the runtime role has no UPDATE on them).
  Pending requests reserve their quantities, so approving later can never overdraw.

## ADR-0057 — Cumulative refund rounding
- **Date:** 2026-10-12 · **Status:** Accepted
- **Decision:** A partial refund of q units of a line refunds
  `round_half_up(net × (refunded + q) / sold) − already refunded`, so the partial refunds
  of every unit sum to the line's net amount exactly (e.g. 3 × 0.333 refunds of a 0.999 line).

## ADR-0058 — Refund pay-back allocation
- **Date:** 2026-10-12 · **Status:** Accepted (BR-091)
- **Decision:** Money goes back to the original tenders, each at most its remaining
  refundable amount. The default split is proportional to those amounts (largest
  remainder); the cashier may choose another split within the limits. Cash leaves the
  requesting cashier's drawer and is refused when the drawer cannot cover it. Exchange
  credit on an original sale is refunded in cash. Processing fees of the original payment
  are not reversed (OQ-016).

## ADR-0059 — Approval rules
- **Date:** 2026-10-12 · **Status:** Accepted (BR-092)
- **Decision:** Users without `refunds.approve` need approval for refunds above the
  merchant limit (default 20.000 KWD) or older than the return window (default 30 days).
  Requests wait as `pending_approval` (reserving their items); a supervisor approves at
  the till or a manager in `/manager`. Nobody approves their own request. Approval executes
  the stored allocation; cash leaves the requester's drawer, which must still be open.

## ADR-0060 — Exchanges in one transaction
- **Date:** 2026-10-12 · **Status:** Accepted
- **Decision:** An exchange creates the refund and the new sale in one transaction, reusing
  the checkout engine. The credit pays the new sale first (an internal `exchange` payment
  linked to the refund); any difference is paid normally or refunded to the original
  tenders. Exchanges that would need approval are refused at the till.

## ADR-0061 — Document numbers per merchant
- **Date:** 2026-10-12 · **Status:** Accepted
- **Decision:** Purchase orders, goods receipts and transfers get gap-free numbers per
  merchant and kind (`PO-000001`, `GR-000001`, `TR-000001`) from `document_sequences`,
  incremented with `INSERT … ON CONFLICT DO UPDATE … RETURNING` inside the document's
  transaction (a rollback releases the number).

## ADR-0062 — Purchase order workflow and separation of duties
- **Date:** 2026-10-12 · **Status:** Accepted (BR-100, BR-101)
- **Decision:** draft → submitted → approved → partially_received → received, plus
  cancelled (before any receipt) and closed (rest no longer expected, reason required).
  Only drafts are editable (DB trigger). The creator cannot approve their own order unless
  they are the owner. Final states are immutable (DB trigger).

## ADR-0063 — Goods receipts post through the stock ledger
- **Date:** 2026-10-12 · **Status:** Accepted (BR-102)
- **Decision:** A receipt is its own append-only document (idempotency key unique per
  merchant). The order row is locked `FOR UPDATE` while remaining quantities are checked,
  so retries and concurrent receipts never exceed the order. Stock is increased with
  `StockLedgerService.apply` (`purchase_receipt`) at the line's unit cost, which updates
  the weighted average cost.

## ADR-0064 — Transfers leave at dispatch, arrive at receipt
- **Date:** 2026-10-12 · **Status:** Accepted (BR-103, BR-104)
- **Decision:** requested → approved → in_transit → received (or cancelled before
  dispatch). Dispatch writes `transfer_out` at the source with negative stock always
  denied (whatever the merchant policy) and records the unit cost; receipt writes
  `transfer_in` at the destination at that same cost. Stock in transit belongs to
  neither branch. A short receipt needs a note; the missing quantity is written off
  (it never returns to the source automatically). Request at either branch, approve at
  the source (`inventory.transfer.approve`), dispatch at the source, receive at the
  destination (`inventory.transfer` at each).

## ADR-0065 — Customers are merchant-wide; history is derived
- **Date:** 2026-10-12 · **Status:** Accepted (BR-110, BR-112)
- **Decision:** A customer belongs to the merchant, not to a branch, so any branch can
  serve them. Sales (and held orders) carry a nullable `customer_id` fixed when the sale is
  completed; refunds reach the customer through their sale. Purchase counts, totals,
  refunds, net spend and averages are always computed from the immutable sales and
  refunds, never stored on the customer. Totals shown to a viewer include only branches
  where they hold `customers.read`; the profile itself is visible with `customers.read`
  at any branch.

## ADR-0066 — Phone normalisation and uniqueness
- **Date:** 2026-10-12 · **Status:** Accepted (BR-111)
- **Decision:** Phones are stored as `+<digits>`: spaces, dashes, dots and brackets are
  removed, `00` becomes `+`, and a local 8-digit number gets `+965`. The canonical
  number is unique per merchant (partial unique index), so the same customer cannot be
  registered twice by typing the number differently. E-mails are lower-cased, not unique
  (families share addresses).

## ADR-0067 — Customer privacy at the till and in the audit log
- **Date:** 2026-10-12 · **Status:** Accepted (BR-113, BR-114)
- **Decision:** The POS API returns only id, code, name, phone and status, and only for
  active customers. E-mail, address, notes and spending stay in `/manager`. Audit entries
  for customers record the id, code and the names of changed fields, never personal
  values. Notes are append-only. Customers are never deleted (sales point at them);
  deactivation stops new sales from using them. Loyalty, store credit and promotions are
  left for later: they will be separate append-only ledgers keyed by `customer_id` once
  their rules are confirmed (OQ-019).

## ADR-0068 — Reports are computed on demand from the source tables
- **Date:** 2026-10-12 · **Status:** Accepted (BR-120…BR-129)
- **Decision:** Reports aggregate the immutable transactional tables (sales, sale lines,
  payments, refunds, refund payments, shifts, cash movements, stock ledger and levels,
  purchase and transfer documents) at request time with integer sums in SQL; there are
  no pre-aggregated summary tables to drift from the source. Time-range indexes
  (migration 0022) keep the queries on index ranges. A period is at most 366 days. If
  volumes later require it, daily summaries can be added as a cache rebuilt from the
  same queries, and the reconciliation tests would then compare both.

## ADR-0069 — Report periods and recognition
- **Date:** 2026-10-12 · **Status:** Accepted
- **Decision:** Periods are whole local days in the merchant's time zone
  (`[from 00:00, to + 1 day 00:00)`). Sales count on their completion time; refunds,
  voids and exchange returns count when completed (not on the original sale's date);
  payments when received; pay-outs when the refund completes; shifts when closed. The
  comparison period has the same number of days immediately before.

## ADR-0070 — Gross profit policy
- **Date:** 2026-10-12 · **Status:** Accepted (BR-127)
- **Decision:** Gross profit = net after refunds − (cost of sales at the weighted-average
  cost recorded on each sale − cost of refunded units returned to stock). It is shown
  only to users with `reports.financial` for every branch in the report, and only when
  every sale and every restocked refund line in the period has a known cost; otherwise
  the report says it is not available and how many documents lack a cost. Processing
  fees are reported separately and not deducted; no tax, overhead or landed costs are
  included (no accounting policy for them yet).

## ADR-0071 — CSV exports are built from the displayed values
- **Date:** 2026-10-12 · **Status:** Accepted
- **Decision:** Each report table defines its columns once (value + display); the CSV
  export serialises the same values in the browser, so exports always match the screen
  and need no extra API. Money columns are exported as plain decimals with "(KWD)" in the
  header; a UTF-8 BOM keeps Arabic readable in spreadsheet apps; cells starting with
  `= + @`, tab/CR or a non-numeric `-` are prefixed with `'` (CSV formula injection).

## ADR-0072 — Restaurant is an optional module on top of the retail POS
- **Date:** 2026-10-12 · **Status:** Accepted (BR-130)
- **Decision:** A merchant switch (`restaurant_settings.enabled`, off by default) turns
  on tables, restaurant orders and the kitchen display; the retail sale screen is
  unchanged. The menu is the product catalog (categories, products, branch
  availability, prices); the module adds modifier groups, recipes, dining areas and
  tables, and kitchen stations routed by category (with one default station per
  branch). Kitchen staff use a dedicated `/pos/kitchen` screen with the `kitchen` role.

## ADR-0073 — Orders are intent; bills are sales
- **Date:** 2026-10-12 · **Status:** Accepted (BR-131…BR-134, BR-137)
- **Decision:** A restaurant order (dine-in at a table, takeaway, pickup) is a mutable
  document of items with their kitchen status. Money is recorded only when a bill is
  paid: the chosen unpaid items become one immutable sale through the existing checkout
  engine (cashier's open shift, exact payments, receipt number, idempotency key, price
  at payment time incl. modifiers, `sales.restaurant_order_id` and `service_type`).
  Splitting a bill = several pays over different items; splitting among payers =
  several tenders on one bill. Moving a table changes only the order's table; combining
  moves unpaid items (orders with paid bills cannot be combined); kitchen updates touch
  tickets and item statuses only. So no path creates revenue twice. The order row is
  locked for every change and the database refuses changes to paid or cancelled items.

## ADR-0074 — Inventory consumption for restaurant items
- **Date:** 2026-10-12 · **Status:** Accepted (BR-135, BR-136)
- **Decision:** Stock is deducted once, when the item is sold (the sale's ledger
  movement), never on kitchen events. An item with a recipe consumes its ingredients
  instead of itself (recipes are only allowed on items that are not stock-tracked, so
  nothing is deducted twice); a modifier may consume one ingredient per unit (e.g. extra
  cheese). The same expansion (`stockConsumption`) is used for waste. Sale cost =
  Σ consumed quantity × weighted-average cost. Cancelling an unsent item has no stock
  effect; cancelling a sent item needs `restaurant.void_item` and is recorded either as
  waste (ingredients deducted now, adjustment `restaurant_waste`) or as not prepared.
  Refunds of recipe items never restock (food is not returned to stock).

## ADR-0075 — Kitchen tickets
- **Date:** 2026-10-12 · **Status:** Accepted (BR-138)
- **Decision:** "Send to kitchen" groups the order's unsent items by station into one
  ticket each; sending again only sends new items. Tickets move forward only
  (new → preparing → ready → completed) with timestamps; a repeated or stale tap that
  would not move it forward is ignored. A ticket whose items are all cancelled is
  cancelled. Takeaway and pickup items can be sent automatically when paid (setting).

## ADR-0076 — The online store is a separate public app over the shared commerce engine
- **Date:** 2026-10-12 · **Status:** Accepted (Prompt 16)
- **Decision:** A fourth SPA, `apps/store-web` (basename `/store`), is the public
  storefront. It has no session and no `AuthProvider`; it calls only the public
  `/api/v1/store/:slug/*` endpoints, which resolve the merchant from the store address
  through a `SECURITY DEFINER` function (`store_merchant(slug)`) and then run inside
  `withMerchantTx` (RLS). The client never sends a merchant id. Configuration and order
  handling live in `/manager/online` (permissions `online.manage`, merchant-wide, and
  `online.orders`, branch-scoped). Products, prices and stock come from the existing
  catalog and the fulfilment branch's inventory; nothing is duplicated.
- **Consequences:** The storefront can later move to its own domain without changing
  the API. Store addresses `pay`, `assets`, `api`, `admin` are reserved.

## ADR-0077 — Online orders are intent; payment creates an online-channel sale
- **Date:** 2026-10-12 · **Status:** Accepted (BR-140…BR-146)
- **Decision:** `online_orders` holds the shopper's intent with a price snapshot,
  status and an append-only status history. When the gateway confirms payment, the
  order becomes an immutable `sales` row with `channel = 'online'` (no register, shift
  or cashier; CHECK `sales_channel_valid`) through `SalesService.completeOnlineSaleInTx`,
  which reuses the checkout engine: stock consumption, costs, processing fees, receipt
  number, financial entries and audit. The delivery fee is a sale line on an archived
  service product (`ONLINE-DELIVERY`) so totals reconcile. Paid orders are corrected by
  refunding the sale (refund engine, Prompt 11); they cannot be cancelled in place.
- **Consequences:** Reports split POS vs. online (`byChannel`); employee reports cover
  POS only. Sales/receipt queries use left joins for register and cashier.

## ADR-0078 — Payment gateway abstraction, sandbox adapter only
- **Date:** 2026-10-12 · **Status:** Accepted (BR-143, BR-147)
- **Decision:** `PaymentGateway` (initiate → redirect URL + provider reference, verify,
  parseWebhook with signature check, `ready`). Adapters registered: Tap, UPayments,
  Hesabe, Bookeey as `UnconfiguredGateway` (refuse with `GATEWAY_NOT_CONFIGURED`, never
  ready) and `MockGateway` (in-memory sandbox, HMAC-SHA256 `x-mock-signature`, constant-
  time compare, hosted test page at `/store/pay/:reference`). Mock payments are on by
  default except in production (`PAYMENT_MOCK_ENABLED`). Payment attempts live in a
  mutable `online_payments` table (unique provider + reference; final states immutable)
  while `payments` stays append-only; every notification is stored once in the
  append-only `payment_events` (unique provider + event id) with its outcome, so
  repeated webhooks are idempotent. Success, failure, cancellation and amount mismatch
  are handled; pending orders are reconciled lazily (tracking page, checkout) and by a
  60-second background job, and a manager can trigger reconciliation.
- **Consequences:** Activating a real provider needs: owner approval, merchant
  credentials as environment secrets, the provider's verification and webhook signature
  implementation, and sandbox tests — then only `ready` changes. No real money moves
  today.

## ADR-0079 — Stock reservations against overselling
- **Date:** 2026-10-12 · **Status:** Accepted (BR-144, BR-145)
- **Decision:** Checkout reserves the ordered quantities at the fulfilment branch in
  `stock_reservations` (locks the stock levels `FOR UPDATE`, refuses with
  `INSUFFICIENT_STOCK`), valid for the store's reservation time (5–1440 min, default
  30). `StockLedgerService.apply` counts other orders' active, unexpired reservations as
  unavailable for `sale` and `transfer_out` movements, so the POS and transfers cannot
  sell reserved stock (unless the merchant allows negative stock). Paying consumes the
  reservation and deducts stock through the ledger; failure, cancellation, expiry and
  amount mismatch release it. A payment that arrives after expiry is accepted only if
  the stock is still available; otherwise the order is `needs_attention` and no sale is
  created.
- **Consequences:** The public catalog shows availability as on-hand minus reservations
  and never the exact stock (offered maximum ≤ 20).

## ADR-0080 — Platform access to merchant data: narrow functions and an operator context
- **Date:** 2026-10-12 · **Status:** Accepted (Prompt 17)
- **Decision:** The API keeps a single runtime role without `BYPASSRLS`. Platform
  operators read across merchants only through `SECURITY DEFINER` functions that return
  summaries (`platform_merchants`, `platform_overview`, `platform_audit`,
  `platform_plan_counts`) — never sales lines, customers or other business documents.
  Anything about one merchant (detail, status, subscription, onboarding) runs in
  `DatabaseService.withPlatformContext(operatorId, merchantId)`: that merchant's RLS
  context plus `app.operator_id`. The database refuses subscription updates, `changed`
  subscription events and merchant status changes without an operator context
  (triggers), so no merchant code path can lift a suspension or change its own plan; a
  closed merchant cannot be reopened. Platform actions are audited with the operator as
  actor and the merchant as event owner, so the merchant's own audit trail shows them.
- **Consequences:** The `platform_*` functions are callable by the runtime role; only
  the platform-admin module uses them (reviewed in code). Impersonation is still not
  provided (AUTH.md §8).

## ADR-0081 — Subscription plans and backend-enforced limits
- **Date:** 2026-10-12 · **Status:** Accepted (BR-150, BR-151, BR-154)
- **Decision:** Global `plans` (optional limits for branches, employees incl. pending
  invitations, active products, registers; features `restaurant`, `ecommerce`; trial
  days; informational price) and one `subscriptions` row per merchant with an
  append-only `subscription_events` history. `SubscriptionsService.assertCapacity` runs
  inside the creating transaction (branch, register, invitation, product, and
  reactivations) and locks the subscription row when the plan is limited, so
  concurrent creations cannot exceed it. Features are checked when the restaurant
  module is enabled and when the online store leaves draft. Plan changes are checked
  against current usage and features in use; a plan that does not fit is refused with
  the reasons (`PLAN_CHANGE_BLOCKED`) instead of disabling data.
- **Consequences:** Starting plans: `standard` (default, unlimited, all features,
  30-day trial), `basic`, `professional`; existing merchants were moved to `standard`.

## ADR-0082 — No automatic billing; lapsed subscriptions do not lock merchants out
- **Date:** 2026-10-12 · **Status:** Accepted until OQ-022 is decided (BR-155)
- **Decision:** Subscription status and dates are recorded by operators. Nothing is
  charged, invoiced or collected automatically, and a past-due, expired or ended trial
  never blocks selling: the merchant and the operators see it, and only an operator's
  explicit suspension stops access. Prices on plans are display values only.
- **Consequences:** Billing (provider, invoices, dunning, automatic suspension) needs the
  owner's pricing and provider decision first.
