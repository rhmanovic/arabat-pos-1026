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
- **Date:** 2026-10-11 · **Status:** Realised for production by ADR-0105 (Google Cloud, Doha)
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
- **Date:** 2026-10-11 · **Status:** Superseded by ADR-0105 (table ownership instead of BYPASSRLS)
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

## ADR-0083 — Read-only cross-module SQL is tolerated, writes are not
- **Date:** 2026-10-12 · **Status:** Accepted (final audit, Prompt 18)
- **Context:** The audit found modules reading other modules' tables with SQL (sales →
  customers/payment methods/shifts, refunds → sales, reports, platform and subscriptions
  counts) and one write: ecommerce creating the delivery-fee catalog item.
- **Decision:** Read-only joins inside the caller's merchant transaction stay for now (RLS
  still applies, they are covered by integration tests). Writes to another module's tables
  are not allowed for new code; the delivery item is the documented exception, created
  under an advisory lock with a zero cost.
- **Consequences:** Before extracting a module (ARCHITECTURE §13) these reads must move
  behind the owning service. Largest services (`sales.service.ts` ~1,500 lines) should be
  split (checkout, held orders, queries, receipt numbers).

## ADR-0084 — One lock order and automatic retry on deadlock
- **Date:** 2026-10-12 · **Status:** Accepted (final audit)
- **Decision:** Lock order everywhere: shift → receipt sequence → stock (POS and online
  sales alike); payment attempt → online order (webhooks, cancellation, expiry);
  subscription row with one lock per transaction (shared for unlimited plans, exclusive for
  limited ones; never upgraded). As a safety net `DatabaseService` re-runs a whole
  transaction up to 3 times on `40P01`/`40001`; work functions keep e-mails and gateway
  calls outside transactions. The reconcile job catches errors per merchant and payment.
- **Consequences:** Measured: concurrent POS sales and online payments for the same item
  finish without errors (integration test); retries are logged for monitoring.

## ADR-0085 — Server-enforced POS screen lock
- **Date:** 2026-10-12 · **Status:** Accepted (BR-160)
- **Decision:** The POS locks after 5 minutes without user input (not without requests:
  screens poll) or when the cashier taps Lock. The server stores `sessions.locked_at` and
  answers `SESSION_LOCKED` to every request of that session until the same user enters the
  password (`POST /auth/pos/unlock`, 5 wrong passwords end the session). Anyone else can
  only end the locked session and sign in themselves. A PIN-based quick unlock waits for
  OQ-006.

## ADR-0086 — Client IP only from configured proxies
- **Date:** 2026-10-12 · **Status:** Accepted (final audit, high finding)
- **Decision:** `trustProxy` is configured by `TRUST_PROXY` (default off; hop count or proxy
  CIDRs; `true` is refused) so clients cannot fake `X-Forwarded-For` to dodge per-IP rate
  limits or forge audit IPs. Wrong TOTP codes are also limited per operator (5 / 15 min),
  independent of IP and ticket. Operators can only be created by the owner role (CLI); the
  runtime role may only update their sign-in progress columns, and the platform summary
  functions refuse to run without an operator context. Production refuses development
  secrets.

## ADR-0087 — Staging environment on Railway
- **Date:** 2026-10-12 · **Status:** Accepted (owner approved hosting and its cost)
- **Decision:** A staging/pilot environment runs on Railway: one container (Dockerfile) serving
  the API and the four apps, and Railway Postgres. The owner creates the account and links
  the GitHub repository; secrets are set as Railway variables (never in the repository).
  The start command keeps the two-role database model (OPERATIONS.md §8).
- **Consequences:** Servers are outside the GCC; the production region decision (OQ-011)
  stays open. Payments use the sandbox gateway only; e-mail needs an SMTP provider.

## ADR-0088 — Standing approval for staging deploys; phone layout for the POS
- **Date:** 2026-10-12 · **Status:** Accepted (owner, in conversation)
- **Decision:** The owner granted standing approval to publish to the Railway **staging**
  environment without asking each time, once `pnpm verify` and the relevant tests pass
  (push to `claude/busy-babbage-yty2bo`; if Railway does not pick the push up, reconnect the
  same branch to trigger the build). Production launch, live payments and new paid costs still
  need explicit approval. The POS must work on phones as well as tablets and desktops: below
  the `md` breakpoint the sale screen shows the catalog full screen with a bottom cart bar that
  opens the cart full screen; header session actions fold into one menu below `sm`.
- **Consequences:** Faster feedback loop on staging. A phone e2e project checks the POS sign-in.

## ADR-0089 — Default payment setup: balances and linked methods
- **Date:** 2026-10-12 · **Status:** Accepted (owner request)
- **Decision:** Every merchant starts with internal balances «Cash on hand» («الخزينة», cash), «Bank account
  1» and «Bank account 2» (bank), and payment methods Cash, Card (KNET), Visa / Mastercard,
  Payment link (custom) and WAMD (bank transfer), each linked to a balance so every payment and
  fee lands in a ledger (BR-086). `ensureDefaultPaymentSetup` runs at merchant creation and in
  seed `004-payment-setup` for existing merchants; it acts only on a merchant without any
  internal balance, so it applies once and never re-adds or relinks what the owner changed.
  For existing merchants it reuses equivalent methods (matched by kind or name) and links every
  method that settled nowhere. Fees default to none (OQ-026).
- **Consequences:** Seeds run on every start; the «no balance yet» guard is what makes the
  setup one-time. Also fixed with this slice: a 401 from any API call now re-reads the session
  and returns to sign-in, and data tables show load errors instead of looking empty.
- **Naming (2026-10-12):** «صندوق» means the register (till) only. The cash account is «الخزينة»
  (Cash on hand) and the balances page is «الحسابات المالية» (Financial accounts), with its own
  menu item `/accounts` instead of a tab hidden inside Payment methods.

## ADR-0090 — Cash custody: registers, branch treasuries and transfers
- **Date:** 2026-10-12 · **Status:** Accepted (owner approved the plan; phase A implemented)
- **Context:** Cash sales posted into one company «الخزينة» account, so its balance was net cash
  sales, not the cash actually held. Registers had no balance between shifts and cash in/out moved
  nothing. The owner rejected a clearing account for KNET/cards.
- **Decision:**
  - Registers and branch treasuries are rows of `financial_accounts` (kinds `register`,
    `treasury`), so one append-only ledger holds every place cash can be and a transfer can never
    count cash twice. A company treasury (`branch_id` null) is reserved by a unique index but not
    created.
  - Cash sales and cash refunds post to the register of the shift (`shift_id` on the entry,
    enforced by a trigger). Non-cash methods are unchanged (straight to the bank minus the fee).
  - Shifts open and close with a count against the register balance (BR-077, BR-078); the
    register's balance is the expected cash. `forced_uncounted` closes book nothing.
  - Register ↔ same-branch treasury transfers are `cash_transfers` headers with exactly two
    balanced entries (deferred constraint trigger). POS drop/top-up need `cash.move` on the open
    shift; managers use the new branch-scoped `cash.custody`.
  - Cutover (`cash_custody_cutover`, migration 0033) archives the old cash account, creates
    treasuries and register accounts at 0 (uncounted), marks open shifts `legacy_open`, and removes
    `cash.move` from cashier-template roles of existing merchants (BR-079).
  - Lock order: shift row, then account rows sorted by id.
- **Phases:** A (this) custody core; B cash disbursements (expenses with categories, supplier
  payments linked to a supplier), `cash.deposit` and bank deposits, branch-to-branch transfers via
  an in-transit account with receipt confirmation; C cash reports and a dashboard total-cash card.
  Until B, the POS reasons petty expense, supplier payment and bank deposit post as plain register
  debits with their reason.
- **Consequences:** This is a cash custody ledger, not a general ledger. Amends ADR-0089: the
  cash method is no longer linked to an account; cash settles in the drawer. After deploy each
  treasury needs an opening count before it can pay out.

## ADR-0091 — Cash custody phase B: expenses, supplier payments, deposits, branch transfers
- **Date:** 2026-10-12 · **Status:** Accepted (owner approved the phased plan)
- **Decision:**
  - `cash_disbursements` (append-only, RLS) records expenses (fixed category list) and supplier
    payments (supplier required, optional purchase order of the same supplier via a composite
    FK). Each posts exactly one ledger entry of type `expense` / `supplier_payment` on its source
    register or treasury (deferred trigger); a reversal is a new record mirroring the original
    (`reverses_id`, one per record, checked by trigger).
  - Bank deposits are `cash_transfers` (register/treasury → bank) with origin `pos_movement` or
    `deposit` and an optional slip reference; new branch-scoped permission `cash.deposit`, also
    required on top of `cash.move` for the POS reason.
  - Branch-to-branch transfers use one company `in_transit` account and a
    `cash_branch_transfers` header (`in_transit → received | cancelled`, forward-only trigger,
    optimistic version). A received amount different from the sent one posts the difference on
    in-transit (`branch_transfer_difference`) so in-transit returns to zero per transfer.
  - The transfer direction trigger now allows register ↔ treasury (same branch), register or
    treasury → bank, and treasury ↔ in-transit (branch transfers only).
- **Consequences:** Company cash = treasuries + drawers + in transit. Supplier payments are listed
  on the supplier (purchasing.read). Reports by category and the dashboard card follow in phase C.

## ADR-0092 — Cash custody phase C: cash reports
- **Date:** 2026-10-12 · **Status:** Accepted (owner approved the phased plan)
- **Decision:** Reports read the cash ledger, never a second copy:
  - the payments report gains `custody` (cash by type) from `financial_account_entries` of
    register and treasury accounts, telling transfers apart by the kinds of their two accounts;
  - a new `GET /manager/reports/expenses` (`reports.financial`) groups `cash_disbursements`
    with reversals netted;
  - the discrepancy report gains close-type totals, between-shifts differences
    (`shifts.opening_discrepancy_minor`) and differences found after an uncounted forced close
    (next opening or a `register_count` entry pointing at the shift);
  - shift reports mark uncounted closes as `uncounted`;
  - the dashboard reuses the cash overview for a total-cash card.
- **Consequences:** Sales, collections and revenue keep reading payments and refunds, so
  transfers and custody moves can never enter them.

## ADR-0093 — Remediation session 1: blind counts, merchant audit log, test-payment guard
- **Date:** 2026-10-13 · **Status:** Accepted (owner decisions D1, D7 and "audit log to R1" on
  the remediation plan derived from `docs/audit/BUSINESS_PROCEDURES_MANUAL.md`)
- **Context:** The Phase 1 audit found that cashiers count against a displayed expected balance
  (FND-401), that the audit trail is written but unreadable by the company (FND-101), and that
  the test gateway creates sales and bank entries without money (FND-709).
- **Decision:**
  - `sales_settings.blind_cash_count` (default true). The POS endpoints withhold drawer
    figures from users who lack `shifts.view_all` at the branch: `GET /pos/registers` returns
    `expectedCash: null, blindCount: true`; `GET /pos/shifts/current`, `POST /pos/shifts` and
    cash movements return a `PosShift` with `summary: null` and only the opening difference;
    `POST /pos/shifts` accepts a missing `expectedCash` only under a blind count and skips the
    opening-note requirement for a blind cashier (the difference is still booked between
    shifts). Closing returns the full shift. The policy is enforced by the API, not the screen.
  - `GET /manager/audit` (`audit.read`, company-wide) over the merchant's own rows under RLS,
    with local-day period, action substring, target type and actor filters, pagination and
    the distinct action keys; a manager screen `/manager/audit` with a CSV export built from
    the displayed rows (ADR-0071). Platform-only events keep their separate reader.
  - The mock gateway stays off by default in production builds (unchanged); when enabled there
    the API logs a warning at start, and OPERATIONS.md states that staging is the only
    non-development environment where it may be on (owner decision D7: no production online
    payments yet).
  - Controls must not make the system impractical for an owner with one cashier: blind
    counting never binds the owner, and no second person is required by this session.
- **Consequences:** Integration tests that read drawer figures through cashier sessions
  switch the policy off in their fixtures (`showExpectedCash`); e2e flows assert the blind
  notice and verify the figures through the manager API. Remaining R1 work (cash-out limits,
  disbursement approvals, deposits in transit, variance follow-up, custody roles) follows in
  later sessions; thresholds will be per-merchant settings with the owner's defaults.

## ADR-0094 — Remediation session 2: cash-out controls, Treasurer role, controls checklist
- **Date:** 2026-10-13 · **Status:** Accepted (owner decisions D2 and D3 on the remediation plan)
- **Context:** Phase 1 found that a cash-out with reason "correction" or "other" removed cash
  from custody with no counterpart, limit or approval (FND-407), that closing shortages needed
  no explanation (FND-402), that register tolerance was unbounded (FND-403), and that custody
  rights were held by nobody but the owner (FND-113, FND-422).
- **Decision:**
  - `cash_movements` gains `status` (`posted` | `pending` | `rejected` | `withdrawn`),
    `corrects_movement_id`, `limit_exceeded`, `owner_override` and the decision columns
    (migration 0037). Only pending rows change, once, into a final state (trigger
    `cash_movements_decision`; the runtime role may update only the decision columns);
    posting on approval requires the shift to be open. Drawer figures, shift totals and the
    cash reports count only `posted` movements.
  - Policy columns on `sales_settings`: `cash_out_other_limit_minor` (20.000 KWD),
    `cash_out_other_shift_limit_minor` (50.000 KWD), `max_register_tolerance_minor`
    (1.000 KWD), owner-editable per company (D2: never hard-coded).
  - Pending requests are decided with `POST /manager/shifts/:id/movements/:movementId/decision`
    (`shifts.view_all`, approver ≠ requester, owner excepted and flagged) and withdrawn with
    `POST /pos/shifts/current/cash-movements/:movementId/withdraw`. The POS warns before the
    cashier confirms an amount that will wait, and shows the request's state.
  - New role template `treasurer`; the template seed adds it to existing companies on the next
    `db:seed`. `GET /manager/merchant/controls` (`merchant.settings.read`) computes the
    checklist from live tables.
  - Practicality for an owner with one cashier: the owner is never blocked (owner override,
    audited); limits are company settings with sensible defaults.
- **Consequences:** The remaining custody split (`cash.custody` into count / move / transfer,
  FND-422) and the cashier acknowledgement of manager cash moves (FND-419) stay open. Variance
  follow-up (R1.4) and disbursement approvals (R1.2) reuse the pending/decision pattern.

## ADR-0095 — Remediation session 3: disbursement approvals, payout requests, variance follow-up
- **Date:** 2026-10-13 · **Status:** Accepted (owner decision D2 on the remediation plan)
- **Context:** Phase 1 found expenses and supplier payments with no limit, approver or link to
  what is owed (FND-408, FND-602, FND-420) and cash differences with no follow-up or settlement
  (FND-404, FND-410, FND-421).
- **Decision:**
  - Approval limits per company on `sales_settings` (`expense_approval_limit_minor`,
    `supplier_payment_approval_limit_minor`), owner-editable with the owner's defaults.
  - At the till the existing pending-movement pattern (ADR-0094) carries expenses and supplier
    payments above the limit; `cash_movements` keeps `expense_category`, `supplier_id` and
    `receipt_reference` so approval posts the real disbursement.
  - From a treasury, `POST /manager/cash/disbursements` answers `APPROVAL_REQUIRED` for a
    non-owner above the limit; `cash_payout_requests` (migration 0038) holds the request until
    another custody holder decides it (`…/payout-requests/:id/decision`, approver ≠ requester,
    owner excepted and flagged); approval calls the ordinary `postDisbursement`. Requests never
    touch the ledger; a trigger lets a pending row change once, into a final state, and an
    approved row must point at its disbursement.
  - Overpayment guard: `ORDER_OVERPAID` when paid-to-date plus the payment exceeds the order's
    value (Σ quantity × unit cost, net of reversals); the owner may pass `confirmOverpayment`
    (audited). Purchase orders expose `paidToDate` (read-only cross-module SQL, ADR-0083).
  - `variance_followups` annotates differences that stay in their source documents; the list
    `GET /manager/cash/variances` is a union over shifts (close and opening), count entries and
    branch transfers, joined to the follow-up; `explained` needs `shifts.view_all`, `settled` /
    `written_off` need `cash.custody`; follow-ups may be revised (audited) but never deleted.
  - The pure limit helpers live in `cash/approval-limits.ts` so the registers and cash modules
    share them without a module cycle.
- **Consequences:** Deposits in transit and bank reconciliation (R1.3) follow; the dashboard
  checklist now counts pending payout requests and open variances.

## ADR-0096 — Remediation session 4: deposits in transit and manual bank reconciliation
- **Date:** 2026-10-13 · **Status:** Accepted (remediation plan R1.3)
- **Context:** Phase 1 found bank balances credited on the depositor's word and never reconciled
  (FND-406), no visibility of what the bank actually settled (FND-413) and bank accounts that could
  be deactivated with a balance (FND-414).
- **Decision:**
  - One company account of kind `deposit_transit` per merchant (migration 0039, created for
    existing merchants and in `merchant-defaults`). Every deposit — POS `bank_deposit` movement or
    `POST /manager/cash/deposits` — posts register/treasury → deposits in transit with
    `cash_transfers.target_account_id` (the intended bank) and a mandatory slip `reference`
    (`assertDepositSlip`, contract refinements).
  - Settlement is a second transfer naming the deposit (`confirms_transfer_id`, unique): origin
    `deposit_confirmation` (transit → that bank, optional bank reference) or `deposit_return`
    (transit → the branch treasury, reason required). The database trigger
    `cash_transfers_direction` enforces the directions, the matching amount and the bank named on
    the deposit. Settler ≠ depositor; the owner may settle their own deposit (`ownerOverride` in
    the audit event). Transfers stay append-only, so no row locks: a race ends in the unique
    settlement index, reported as `DEPOSIT_SETTLED`.
  - Manual reconciliation: `bank_reconciliations` (statement date, statement / book / cleared
    balances, difference, note, who) and `bank_reconciliation_items` (each ledger entry ticked
    once; a trigger keeps items on the reconciled account). `difference ≠ 0` needs a note (also a
    check constraint). Both tables are RLS-protected and never updated or deleted.
  - Rights: everything under `cash.deposit` (the Treasurer template holds it); a deposit's branch
    is the branch of the account it left; reconciliation is a bank-side control open to anyone
    holding the right at some branch.
  - `PATCH /manager/financial-accounts/:id` answers `ACCOUNT_IN_USE` when a bank account with a
    balance, unreconciled entries or a deposit in transit is set inactive.
  - Visibility: cash overview `depositsInTransitTotal` (not part of cash on hand), the custody
    report counts deposits net of returns, the checklist counts deposits in transit and bank
    entries older than a week on no statement, the accounts page shows unreconciled counts and
    the last reconciliation.
- **Consequences:** The bank balance in the system is only what a second person confirmed; the
  owner + one cashier set-up works because the owner is the confirmer with an audited override.
  Fee settlement per acquirer (FND-413 in full) remains for R3.5 / D6.

## ADR-0097 — Remediation session 5: stock adjustment approvals, blind counts, master-data guards
- **Date:** 2026-10-13 · **Status:** Accepted (owner decision D2 on the remediation plan)
- **Context:** Phase 1 found stock adjustments with no approval, limit or segregation (FND-201),
  counts that were not blind and overwrote intervening movements (FND-202), master-data changes
  that hid balances (FND-206, FND-207) and branch deactivation with no pre-conditions (FND-109).
- **Decision:**
  - `stock_adjustments` (migration 0040) gains `number` (ADJ-, gap-free per merchant through
    `document_sequences`, back-filled for existing rows), `status` (posted | pending | rejected
    | withdrawn), `value_minor`, `limit_exceeded`, `owner_override`, decision columns,
    `started_at` and `movements_acknowledged`. The adjustment approval limit
    (`sales_settings.adjustment_approval_limit_minor`, default 50 000 fils) and the blind-count
    policy (`blind_stock_count`) live with the other company thresholds; both are optional on
    the settings PUT (unchanged when omitted) and are exposed read-only through
    `GET /manager/inventory/settings` so counters see the policy without company-settings rights.
  - `InventoryService.createAdjustment` estimates the value at cost from the current balances
    before posting; above the limit (never for opening stock) a non-owner's document is stored
    pending with its lines and the balances seen, and nothing goes through the ledger. Approval
    (`POST …/adjustments/:id/decision`, approver ≠ requester, owner excepted and flagged) runs
    the same `post()` as a direct document, attributing movements to the requester; rejection
    needs a note; the requester may withdraw. Database rules: column-level UPDATE grants only,
    trigger `stock_adjustments_decision` (pending → final once, header otherwise immutable, a
    final document only receives its posted value) and `stock_adjustment_lines_apply` (lines
    take their applied figures only while the header is pending).
  - Counts carry `startedAt`; `assertNoMovementsSince` reports movements of the counted items
    after that moment (net quantity, count and types per line) until `acknowledgeMovements` is
    sent. The editor hides the book quantity and the resulting balance under the blind policy.
  - `assertNoStockOnHand` (catalog) refuses tracking off, goods → service, archiving and
    variant removal while stock is on hand; `assertAdjustable` lets archived items be written
    off or counted. `assertBranchIdle` (branches) lists stock, open shifts, cash, open purchase
    orders, open stock transfers and cash transfers in transit before deactivation.
  - Checklist and dashboard count pending adjustments.
- **Consequences:** FND-201, FND-202, FND-218, FND-220, FND-206, FND-207 and FND-109 close.
  Transfer losses and the in-transit location (R2.3 / R2.4) reuse the same approval limit.

## ADR-0098 — Remediation session 6: transfer losses, surplus, recall, in-transit valuation
- **Date:** 2026-10-13 · **Status:** Accepted (remediation plan R2.3 / R2.4)
- **Context:** Phase 1 found transfer shortages written off silently and self-approved (FND-603,
  FND-211), surplus impossible to record (FND-622), unvalued transfers when the dispatch cost was
  unknown (FND-623), documentation out of step (FND-613) and in-transit stock unvalued, unaged and
  irrecoverable (FND-604).
- **Decision:**
  - The ledger keeps its shape: `transfer_out` of the full dispatched quantity at the source,
    `transfer_in` of what arrived at the destination. No synthetic ledger row is written for a
    loss (it would either double-count the source or create phantom stock at the destination);
    the loss is an explicit, numbered, approved document (`stock_transfer_losses` +
    `stock_transfer_loss_lines`, migration 0041) that closes the in-transit quantity and is
    reported as `transfer_loss` in the inventory report and as written-off quantity and value in
    the purchasing report.
  - `receive` creates the loss for the shortage with the receiver's note; the value at dispatch
    cost decides against the adjustment approval limit (R2.1); the owner posts directly, flagged.
    `POST /manager/transfers/:id/losses` claims the remaining in-transit quantity later (after a
    rejection, or when a loss was never created); one pending loss at a time.
    `POST …/losses/:lossId/decision` needs `inventory.transfer.approve` at the source; claimant
    ≠ decider unless owner. Database: column-level UPDATE grant and trigger (pending → final once).
  - Surplus: the receive cap is lifted; any difference needs a note; the line check no longer
    requires received ≤ dispatched; the signed discrepancy is reported.
  - `assertCostsKnown` refuses dispatch when a line has neither an average nor a catalog cost.
  - In transit = dispatched − received − recalled − posted losses per line, computed from the
    documents (never stored): `GET /manager/transfers/in-transit` (per transfer, age, value,
    unresolved / pending flags), transfer detail totals, inventory report `inTransit`.
  - Recall: `POST /manager/transfers/:id/recall` (source right, reason) posts `transfer_in` at
    the source at dispatch cost, sets `recalled_quantity` (set once) and the final status
    `recalled` (added to `purchasing_final_states`).
  - Checklist counts pending losses and unresolved shortages; the dashboard warns.
- **Consequences:** FND-603, FND-604, FND-211, FND-622, FND-623 and FND-613 close. Transfer
  losses are not yet listed with the cash variances (BR-167); a stock-side follow-up list is a
  candidate for R4.

## ADR-0099 — Remediation session 7: valuation as at a date, cost precision, custody of returned goods
- **Date:** 2026-10-13 · **Status:** Accepted (remediation plan R2.6 / R2.7 / R2.8)
- **Context:** Phase 1 found no closing stock at a past date, no roll-forward and no reserved
  quantities (FND-512, FND-213); averages rounded to the fils (FND-203, FND-205), negative
  balances valued at zero with their cost basis lost (FND-204), unvalued items hidden behind a
  count (FND-216), two cost concepts unexplained (FND-223); restock defaulting to yes (FND-507),
  non-restocked returns with no custody record (FND-508) and an increase reason that let stock
  re-enter outside the refund controls (FND-212).
- **Decision:**
  - `stock_levels.avg_cost_micro` and `stock_movements.avg_cost_micro_after` (migration 0042,
    back-filled × 1000) carry the average at 10⁻⁶ KWD; `avg_cost_minor` stays as the rounded
    display figure and the fallback for rows that predate the column. The engine
    (`StockLedgerService.apply`) computes with `weightedAverageCostMicro`: a typed receipt cost
    is exact fils; outgoing stock and estimates use the micro average; movement values use
    `quantityValueMicro`. `AppliedLine.valueMinor` is the signed movement value and documents
    sum it, so an adjustment's value is the ledger's, not a re-rounding.
  - Negative balances: the average over `onHand + in` when the receipt brings the balance back
    above zero (retroactive absorption, value = Σ movement values); the previous average is kept
    while the balance stays negative; stock going negative with no average adopts its outgoing
    cost. Valuation values every non-zero balance at its average (negatives count negatively).
  - Inventory report: `asAt` (closing per branch and total at the end of `to`, DISTINCT ON the
    last movement before the cut-off in the merchant's zone), `rollForward` (opening at the
    start of `from`, Σ quantity and value per movement type, rounding = closing − opening − Σ
    values, closing) per branch and in total, `reservedQuantity` and a `reserved` column from
    active unexpired `stock_reservations`, and `unvalued` items (on hand, no average).
  - `damaged_returns` (RLS, append-only, held → disposed once through a column-level grant and a
    trigger) is written by `RefundsService.execute` for every non-restocked tracked line;
    `GET /manager/inventory/damaged-returns` and `POST …/:id/dispose` (adjust right at the
    branch, note required). `returnLineInputSchema.restock` is optional and defaults from the
    reason (damaged / defective → false); the POS box follows the reason until touched.
  - `customer_return` removed from the increase reasons (contract); existing documents keep it.
- **Consequences:** FND-512, FND-213, FND-203, FND-204, FND-205, FND-216, FND-223, FND-507,
  FND-508 and FND-212 close. Gross profit with a costless item (FND-513) stays with R4.3. The
  plan's reference to FND-219 under R2.6 matches no finding in the register.

## ADR-0100 — Remediation session 8: supervisor overrides on the till, price-change bounds, zero-total sales
- **Date:** 2026-10-13 · **Status:** Accepted (remediation plan R3.1 / R3.2 / R3.3)
- **Context:** Phase 1 found no override step on another cashier's till (FND-301): every check was
  a permission of the person completing the sale, so exceptions migrated to the supervisor's shift
  and drawer or to permanent cashier rights. Price changes were unbounded, needed no reason and
  bypassed the discount limit (FND-302); above-limit sales were not flagged and the limit in force
  was not kept (FND-303); a 100 % discount produced a free sale with no reason, right or report
  (FND-312).
- **Decision:**
  - `sale_overrides` (migration 0043; RLS, append-only, granted → used once through a column-level
    grant and trigger `sale_overrides_use`): `POST /pos/overrides` takes the supervisor's e-mail
    and password on the cashier's session, verifies them with the sign-in throttles, loads the
    supervisor's access for the merchant and issues a ten-minute, single-use grant listing the
    overridable rights they hold at the branch and the cashier lacks (`OVERRIDE_SELF`,
    `OVERRIDE_NOT_ALLOWED`, refused attempts audited). Checkout takes `overrideId`; rights are
    checked inside the sale transaction against the cashier's access first and the grant second,
    the grant is spent with the `kinds` it supplied, and `sales.override_id` links the sale. The
    sale keeps the cashier's shift, register and attribution; the supervisor never needs a shift.
    Rights are therefore checked at completion (`completeSaleInTx`), no longer when parsing the
    cart, so holding a cart with a discount needs no right.
  - Price changes (`sales_settings.price_override_floor_percent`, `…_ceiling_percent`,
    `…_below_cost`): reason required (`REASON_REQUIRED`), bounds enforced for everyone
    (`PRICE_OUT_OF_BOUNDS`), list-minus-price gap added to the line discount for the limit check
    on the list gross, zero price always above the limit. `sales.above_limit`,
    `sales.discount_limit_percent`, `sale_lines.price_override_reason` and
    `order_lines.price_override_reason` (held carts) are stored.
  - Zero totals: new permission `sales.zero_total` (supervisor template), `ZERO_TOTAL_DENIED`,
    `zeroTotalReason` required and stored (`sales.zero_total_reason`, check constraint for POS
    sales, `NOT VALID` so older rows stay). Flags `zero_total`, `above_limit`,
    `price_override`, `supervised` on sale summaries, `GET /manager/sales?flag=`, and per-employee
    counts in the sales report.
  - POS: discount and price fields are always offered; what exceeds the cashier's rights is
    shown as "needs a supervisor" and the payment dialog carries the supervisor panel (e-mail,
    password, note) and the zero-total reason; the server's refusal codes also open the panel.
- **Consequences:** FND-301, FND-302, FND-303 and FND-312 close. Refund and void approvals keep
  their own flow until R3.4; the override grant is generic enough to carry them later. The owner
  decides the bounds in the selling policy; defaults (50 % / 200 %, not below cost) apply to
  existing companies.

## ADR-0101 — Remediation session 9: refund segregation, tender hygiene, held sales and reprints, combined discount limit
- **Date:** 2026-10-13 · **Status:** Accepted (remediation plan R3.4 / R3.5 / R3.6 / R3.7, decisions D4 and D6)
- **Context:** Phase 1 found cashiers refunding their own sales from their own drawer (FND-503),
  approvers exempt from the limit and window for their own refunds (FND-502), exchange credit
  paid back in cash (FND-504), pending requests dying with the requester's shift (FND-509),
  non-cash methods able to settle nowhere and cash fees posted nowhere (FND-304, FND-412,
  FND-506), self-declared card tenders and pay-backs without a reference (FND-305, FND-505),
  held sales without expiry or attribution (FND-309), uncounted reprints (FND-310), cleared carts
  without a trace (FND-311) and a discount limit applied per discount (FND-313, OQ-024).
- **Decision:**
  - `approvalReasons` no longer exempts holders of `refunds.approve`; it adds `own_sale` when the
    requester rang the sale up and `sales_settings.refund_own_sales_need_approval` is on. The
    owner completes directly with `refunds.owner_override = true` (D3 pattern); exchanges follow
    the same rule. `refunds.customer_contact` is kept with the request. `insertPayments` traces
    exchange credit back through `payments.refund_id` to the tenders of the original sale
    (`creditOrigins`, pro rata, up to three steps, cash as the fallback) and stores the target in
    `refund_payments.financial_account_id`; `execute` refuses a non-cash pay-back with no account
    (`SETTLEMENT_ACCOUNT_REQUIRED`). `approve` re-points a pending cash refund to the approver's
    open shift when the requester's shift is closed (`repointShift`, audited as
    `paidFromShiftId`); a manager without a shift gets `SHIFT_REQUIRED`. The activity report adds
    `ownSaleRefunds`.
  - Payment methods: a non-cash method needs `financial_account_id` (validation) and cash may
    carry no fee (contract); checkout refuses non-cash methods without an account and ignores
    any cash fee; `payment_methods.refund_fee_policy` (`keep` | `reverse`, D6) decides whether
    `execute` posts a pro-rata `fee` entry back and records `refund_payments.fee_reversed_minor`.
    `sales_settings.require_tender_reference` (default on) makes the reference mandatory on
    non-cash tenders (`REFERENCE_REQUIRED`) and on non-cash pay-backs of a refund request (the
    preview marks `referenceRequired`; the POS sends the suggested split with references). The
    payments report gains `feesReversed` (per method and in the totals, `netAfterFees` adds it
    back) and an `unreferenced` list (count, amount, up to 200 items).
  - Held sales: `sales_settings.held_sale_expiry_hours` (default 24); `suspended()` expires stale
    holds (`orders.status = 'expired'`, `expired_at`, audit `order.expired`) before listing and
    returns `expiresAt`; completion keeps the held lines and records `completed_by_user_id`,
    `completed_by_membership_id`, `completed_shift_id`; the sale exposes `heldByName`. Reprints:
    `receipt_reprints` (RLS, insert-only), `POST /pos/sales/:id/reprints` (audit
    `sale.reprinted`), `reprintCount` on the sale and a "COPY n" line on the receipt;
    `GET /pos/sales/lookup?receipt=` finds any receipt of the branch. Cleared carts:
    `pos_cart_events` (RLS, insert-only) through `POST /pos/cart-events`, logged at or above
    `sales_settings.cart_clear_log_threshold_minor` (default 5.000) with audit `cart.cleared` /
    `cart.line_removed`; the POS sends them on clear and on line removal.
  - Combined limit (D4): per line, `lineDiscount + allocated orderDiscount + list-price gap` is
    compared with the list gross; the separate order-level check is gone. The POS mirror
    (`requiredRights`) applies the same rule.
- **Consequences:** FND-502, FND-503, FND-504, FND-509, FND-304, FND-305, FND-505, FND-412,
  FND-506, FND-309, FND-310, FND-311 and FND-313 close; OQ-016 and OQ-024 are resolved. Test
  fixtures that have one person sell and refund switch the two new rules off explicitly
  (`allowOwnSaleRefunds`); the rules themselves are covered by `refunds-controls.int.test.ts`
  and `sales-controls.int.test.ts`. Acquirer-statement reconciliation (matching references to
  settlements) is not built; the unreferenced list is the bridge until a terminal is integrated.

## ADR-0102 — Remediation session 10: one cut-off rule, profit with uncosted share, report access log, dashboard KPIs, supplier statement
- **Status:** Accepted (2026-10-13). Remediation plan R4.1, R4.3, R4.4, R4.5.
- **Context:** The audit found three date bases for refunds, UTC-day filters on cash variances
  and disbursements beside local-day filters elsewhere, statements without a period, a fixed
  time zone nobody could set, gross profit hidden for the whole period by one costless item,
  a by-employee breakdown that left online sales out, no trace of who read or exported which
  report, a dashboard with a stale "no sales yet" banner, a hard-coded unusual-activity
  threshold with an all-time default window, and no view of what a supplier is owed.
- **Decision:**
  - One cut-off rule (BR-184) in `apps/api/src/kernel/time/period.ts`: `merchantTimezone`,
    `withinLocalDays`, `dayStart`/`dayEnd`, `localDay`, `todayIn`, `localDayStart`, `addDays`.
    Sales, refunds, cash variances, disbursements, statements, audit, inventory movements,
    shifts and reports all cut through it. The refund register filters on
    `coalesce(completed_at, created_at)` and returns totals; the sales history's `refunded`
    total is the refunds completed in the period and scope. `GET /manager/cash/accounts/:id/entries`
    takes `from`/`to` and returns `period`, `openingBalance`, `totalIn`, `totalOut`,
    `closingBalance`. The branch time zone column stays but is unused (FND-306: one company,
    one clock). `merchants.timezone` is accepted at registration (`company.timezone`) and on
    `PATCH /manager/merchant` (validated with `Intl`), stamped in `timezone_changed_at` and
    audited as `merchant.timezone_changed`.
  - Gross profit (BR-185): `profit` is always computed with `reports.financial`; it carries
    `uncostedSales`, `uncostedSharePercent`, and `available` now only says whether every sale
    and restocked return had a cost. `byEmployee` gains an `online` row (`membershipId: 'online'`).
  - Report access (BR-187): `ReportsService` writes `report.viewed` inside each report
    transaction; `POST /manager/reports/exports` records `report.exported` for CSVs built in
    the browser (the web's `ReportTable` and the audit page call it). Server-side CSV
    rendering was not built: the export is still the displayed table, the log is the control.
  - Dashboard (BR-187): `GET /manager/reports/today` (`reports.sales`) returns today and
    yesterday in the merchant's zone, open shifts and `hasSales`; the dashboard shows it and
    drops the fixed banner.
  - Activity review (BR-186): `sales_settings.unusual_refund_rate_percent` (10) and
    `unusual_activity_days` (30) replace the constant; `GET /manager/refunds/activity` returns
    `period` and defaults to the last N local days.
  - Supplier statement (BR-188): `GET /manager/suppliers/:id/statement?from&to`
    (`purchasing.read`, branch-scoped) unions purchase receipts valued at order cost with
    supplier payments and reversals, computes the running balance over every line and shows
    the period's lines with the balance brought forward.
- **Consequences:** FND-317, FND-411, FND-511, FND-522, FND-306, FND-523, FND-513, FND-514,
  FND-518, FND-517, FND-520 close; FND-525 moves to a tested bridge (supplier ledger with
  invoices stays R6). Migration 0045 adds three columns only. Existing expectations changed:
  `profit` for a complete period now carries `uncostedSales: 0.000`, the costless-item case
  shows `grossProfit 0.000` with `marginPercent null` instead of nulls everywhere, and the
  refunds list carries `totals`.

## ADR-0103 — Remediation session 11: period close pack and the lock on document dates
- **Status:** Accepted (2026-10-13). Remediation plan R4.2 (BP-525, FND-619).
- **Context:** An external accountant could not close a month from the reports alone and nothing
  stopped a late delivery or order from landing in a month already reported (BP-525, FND-619).
- **Decision:**
  - `period_closes` (migration 0046): one row per merchant and month ('YYYY-MM'), with the local
    day bounds, the time zone, the closer, an optional note and the pack as JSONB; RLS; no
    update or delete for the application role (a close is final, BR-189).
  - `PeriodsService` (`apps/api/src/modules/periods`): `list` (months since registration with
    status closed / closable / open / current), `get` (stored pack or live preview), `close`
    (sequential, ended months only, `PERIOD_NOT_CLOSABLE` otherwise, audited `period.closed`).
    The pack is assembled from `ReportsService.sales / payments / inventory` for the month plus
    direct ledger queries (cash by place as at the cut-off, refunds owed, open items, supplier
    received − paid, document counts). Reading needs `reports.financial`; closing the new
    merchant-scoped permission `periods.close` (owner implicit, Company Manager template) and
    every report right company-wide, so a pack is never partial.
  - `assertPeriodOpen(tx, merchantId, date)` is the lock; `purchase_orders.document_date` and
    `purchase_receipts.received_on` (BR-190, defaulted and bounded in `businessDate`) are the
    dates it checks. Posting times stay the ledger times.
  - Manager: `/periods` page (list, pack, close dialog with a warning and a note); purchase
    order form and receive dialog take the business dates.
- **Consequences:** FND-619 closes; BP-525's gap (no period lock or sign-off) closes for the
  retail scope. Not built: reopening a month (by design), server-rendered pack export (the
  page is the pack), business dates on other document types (they are posted at entry).

## ADR-0104 — Remediation session 12: ownership transfer and freeze, audit detail and price history, account hygiene
- **Status:** Accepted (2026-10-13). Remediation plan R5.2, R5.3, R5.4.
- **Context:** BR-020 promised an audited ownership transfer that did not exist (FND-102); no
  self-service password change or session overview (FND-103); invitation grants authorised at
  invitation time only (FND-108); anyone could lock an account by guessing an e-mail with no
  notice to its holder (FND-110); branch reactivation silently revived grants (FND-116); profile,
  branch, employee, role, catalog, supplier and draft-order edits were audited without values
  (FND-105, FND-208, FND-620); price history lived only in the audit log (FND-222).
- **Decision:**
  - `ownership_transfers` (migration 0047, RLS, status moves once out of `pending`) and
    `OwnershipService` (`start` / `cancel` / `accept` for the owner flow with an e-mailed token;
    `transfer()` shared with the platform). `merchants.owner_frozen_at / _reason` with
    `POST /platform/merchants/:id/owner-freeze|owner-release` (support, super admin) and
    `POST /platform/merchants/:id/ownership-transfer` (super admin). The session resolver and
    the login flow refuse a frozen owner (`OWNER_FROZEN`), reading the merchant row inside the
    merchant context (RLS).
  - `diffFields` (`apps/api/src/kernel/audit-diff.ts`) gives `{ field: { from, to } }` for the
    changed fields; `price_history` (RLS, insert-only) is written from `saveVariants` and read
    through `GET /manager/products/:id/price-history`.
  - `AccountService` (`POST /auth/manager/password`, `GET /auth/manager/sessions`,
    `DELETE /auth/manager/sessions/:id`, `POST /auth/manager/sessions/revoke-others`); the
    password change relies on `users.password_changed_at` to end other sessions and re-issues
    the current one. Manager actions `POST /manager/employees/:id/sessions/revoke` and
    `/unlock`. `InvitationAcceptanceService` re-evaluates each grant with `canGrant` against the
    inviter's current access. `branchStatusSchema.dormantGrants` (`keep` | `clear`) with
    `GRANTS_NEED_CONFIRMATION`. `LoginService` e-mails the account holder when the failure
    counter reaches the limit (`RateLimiterService.hitAndCheck`).
  - Manager: `/account` page (password, devices), ownership section on the company settings
    page, employee actions, dormant-grants dialog on the branches page, price history on the
    product page. Platform: owner freeze / release / transfer dialogs on the merchant page.
- **Consequences:** FND-102, FND-103, FND-105, FND-108, FND-110, FND-116, FND-208, FND-222 and
  FND-620 close. Not built: scheduled or effective-dated prices, progressive delays instead of
  the hard lock (the lock stays at 10 wrong passwords / 15 minutes; the holder is told and a
  manager can clear it), e-mail verification at self-registration (FND-104, owner decision).


## ADR-0105 — Production on Google Cloud (Doha); RLS without BYPASSRLS
- **Date:** 2026-10-15 · **Status:** Accepted for preparation (owner, in conversation). Nothing is
  created or billed until the owner opens the Google Cloud account and approves the go-live
  (CLAUDE.md §3.13). Answers OQ-011 except the location of the second backup copy.
- **Context:** The owner wants real merchants in production at the lowest sound cost, with the
  application and the database in one Gulf region for latency, and a stronger backup than daily
  snapshots. Doha (`me-central1`) offers Cloud Run, Cloud SQL for PostgreSQL 18 (the default
  major version), Cloud Storage, Secret Manager, Artifact Registry, Cloud Build, Cloud Scheduler
  and Workflows; Dammam (`me-central2`) needs invoiced billing (or CNTXT for KSA billing), so it is
  not the main region. Cloud Run domain mapping is not offered in Doha. Cloud SQL never grants
  SUPERUSER or BYPASSRLS, which `app_owner` relied on (ADR-0031).
- **Decision:**
  - **Shape ("economic production"):** one container image on Cloud Run (`min 1`, `max 3`,
    1 vCPU / 1 GiB, CPU always allocated because the API reconciles online payments every minute,
    ingress only through the load balancer); Cloud SQL Enterprise `db-custom-1-3840`, 20 GB SSD
    with auto-increase, **no HA** at first (switched on before larger merchants, one setting);
    an external Application Load Balancer with a Google-managed certificate for the domain;
    product images in a private Cloud Storage bucket (`FILE_STORAGE_DRIVER=gcs`, `GcsStorage`
    over the JSON API with the Cloud Run metadata token, no key file); secrets generated into
    Secret Manager. Estimated USD 140–190 per month including the backups below (owner was shown
    the table; exact Doha prices are read from the account before go-live).
  - **Backups (raised level):** Cloud SQL daily backups kept 90 and PITR 7 days (the Enterprise
    maximum); final backup on deletion kept 365 days; deletion protection; enhanced backups in a
    Backup and DR vault (every 6 hours — the Cloud SQL minimum, found at creation — kept 90 days, monthly kept 1 year, enforced retention, separate
    from the project) where the region offers it; a daily and a monthly SQL export (serverless
    export, Workflows + Cloud Scheduler) into a bucket with a 90-day retention policy that is
    locked once the owner confirms; a monthly restore drill. The bucket's location is the
    owner's open choice (Doha only, Dammam, or an EU region for a second-region copy).
  - **RLS without BYPASSRLS:** `app_owner` owns every table and no table forces RLS (migration
    0048), so the owner is exempt by ownership while `app_runtime`, which owns nothing, is
    filtered by every policy exactly as before. `hosted-start` creates roles with default
    attributes only, takes `SET` membership of `app_owner` when the admin is not a superuser
    (PostgreSQL 16+), serialises role setup and migrations with advisory locks, removes
    BYPASSRLS from older databases after 0048 (superuser admins only) and gains
    `--migrate-only` (Cloud Run job before each release) and `--roles-only` (restore target).
    Local Docker and CI create `app_owner` without BYPASSRLS, so every test runs the Cloud SQL
    model. Supersedes ADR-0031's mechanism (not its rule that owner-role code filters by
    `merchant_id`).
  - **Move:** Railway stays as staging until the move; the database moves once with
    `pg_dump`/`pg_restore` (`infra/gcp/move-from-railway.sh`) into the empty Cloud SQL database,
    then Railway is kept stopped for two weeks. Whether Railway's pilot data (test payments
    included, FND-709) moves at all is the owner's decision.
- **Consequences:** `infra/gcp/` (`provision.sh`, `deploy.sh`, `move-from-railway.sh`,
  `backup-export.workflow.yaml`, `config.example.env`) and `scripts/verify-managed-postgres.sh`
  (rehearsal on a non-superuser admin). These scripts cannot be run here without the account:
  their `gcloud` flags were checked against SDK 570, the database half was rehearsed locally.
  Owner answers (2026-10-15): approval of the plan, the cost and the go-live; project
  `arabat-511416` (service account `arabat-admin`); second backup copy "the most suitable,
  perhaps the UAE" — Google has no UAE region and Dammam needs invoiced billing, so the export
  bucket is in **Frankfurt (`europe-west3`)**; domain **`app.arabatpos.com`** (Cloudflare DNS,
  record not proxied so Google's certificate validates); e-mail through **Cloudflare Email
  Service** SMTP (`smtps://api_token:<token>@smtp.mx.cloudflare.net:465`, Workers Paid plan and
  a token with *Email Sending: Edit*); production starts **empty** (recommended; Railway's pilot
  data holds test payments and stays on Railway).
  Owner, 2026-10-15 (after go-live): the primary address is **`www.arabatapp.com`**;
  `arabatapp.com` and `app.arabatpos.com` answer 301 to it (one managed certificate per host;
  `arabatapp.com` already carries the company's Google Workspace and Resend mail records).
  Open: the `TRUST_PROXY` hop count
  behind the load balancer (checked after the first deploy), whether Backup and DR is offered in
  Doha, and Railway's data.

## ADR-0107 — POS assistant: a read-only chat helper on the cashier screen
- **Status:** Accepted (2026-10-14). Owner request: a chat button on the register so the
  cashier can ask an AI for help.
- **Context:** New cashiers ask the same questions (how to hold a sale, give a discount, process
  a return, what a shortcut does) and look up prices and stock by hand. The owner wants a chat
  helper on the register itself.
- **Decision:**
  - A new `assistant` module (`apps/api/src/modules/assistant`) exposes `GET /pos/assistant`
    (enabled or not) and `POST /pos/assistant/chat` under `pos.access`. The browser keeps the
    conversation (at most 20 turns of 2 000 characters) and sends it whole on every request,
    with the cart as display text; the server stores nothing and logs only token counts.
  - The model provider sits behind the `AssistantModel` boundary (like `Mailer`): the real
    `AnthropicAssistantModel` uses the official `@anthropic-ai/sdk` with `ASSISTANT_MODEL`
    (default `claude-opus-5-5`, low effort for short answers, server-side fallback on a policy
    decline, one retry, 60 s timeout). Without `ANTHROPIC_API_KEY` the assistant is **off**:
    the button shows a notice, no request leaves the server and nothing is billed. Setting the
    key is a paid decision of the owner (CLAUDE.md §3.13).
  - The assistant is **read-only** (BR-194). It answers from a fixed guide of the register
    (`POS_GUIDE`, the cacheable prefix) plus four lookups that run as the cashier, at the
    session branch, inside the merchant's RLS context: `search_products` (name / SKU /
    barcode, price, stock when the cashier may see it), `payment_methods` (the Pay screen's
    buttons, exactly the list the POS fetches; added 2026-10-14 after the owner's trial, where
    "how many payment methods do I have" was answered generically), `recent_sales` (own
    shift) and `shift_summary` (figures withheld under the blind count exactly as on the
    shift page). Rights are checked with `can()` before each lookup; the cashier's rights at
    the branch are part of the prompt so the answer says who must authorise what. The guide
    draws the line at the cashier's own screen: what the cashier can see is answered from the
    lookups; management screens, settings, reports, other branches and permission keys are
    never described (owner decision, 2026-10-14). At most four lookup rounds per answer; 60
    requests per cashier per 10 minutes (`RateLimiterService`).
  - POS: an **Assistant** button in the shift strip (and the phone "More" menu), F9, a dialog
    with suggested questions, the thread kept while the dialog is closed, "New conversation".
- **Consequences:** No tenant data is stored by the provider beyond its own processing (the
  provider's data terms apply; product names, prices, stock figures and the cart text of one
  branch are sent per question). Not built: streaming answers, per-merchant usage metering or
  a plan limit, actions on the sale by the assistant (by design).
- **Amendment (2026-10-14, owner request after the staging trial): the management app.** The
  same module serves `GET/POST /manager/assistant[/chat]` under `manager.access`, with its own
  cacheable guide (`MANAGER_GUIDE`: the sidebar pages and what each does, no permission keys
  in answers) and four read-only lookups that read exactly what the app's own pages show, with
  the user's rights and the branch selected in the top bar (`branchId`, null = all readable
  branches): `search_products` (Products page search, stock from the Inventory page when
  readable), `payment_methods` (the Payment methods page: status, register/online, fee,
  settlement account), `stock_summary` (the Inventory page's cards) and `sales_today` (the
  dashboard's today card). The chat body is one shared component (`AssistantChat` in
  `web-core`); the manager app mounts a floating button at the bottom inline-end corner of the
  layout so it is on every page and the thread survives navigation. Same rate limit per user,
  same `AssistantModel`, same key.
- **Amendment (2026-10-14, owner decision): the platform keeps every question.** "The server
  stores nothing" above is replaced: each question is appended to `assistant_requests`
  (migration 0049; 0048 on staging) with the thread as sent, the answer, the lookups, the token counts, the
  estimated cost at list price (`assistant.pricing.ts`, micro-USD, integer arithmetic) and the
  outcome, also when the provider fails. Purpose stated by the owner: monitoring, abuse
  detection, product development and training of the company's own models. Access: the
  platform's **super admin only**, on `/platform/assistant` (`GET /platform/assistant`, JSONL
  export); nobody in the merchant realm, owner included, sees conversations, tokens or cost
  (INSERT-only RLS policy for the merchant context, `SECURITY DEFINER` platform read functions,
  route gated to `platform.super_admin`). Users are told in the chat footer that conversations
  are kept to improve the service. No retention limit for now (the owner keeps the data); the
  browser sends a `conversationId` so turns of one conversation can be grouped.
- **Amendment (2026-10-15, owner decision): a user sees their own conversations.** Each user
  may list and reopen their own past conversations of the app they are in (migration 0050, 0049 on staging:
  SELECT policy on merchant **and** user of the session; `GET …/assistant/conversations[/:id]`
  under the app's access permission). Nobody sees another user's conversations, and merchant
  users still never see tokens, cost or outcomes: the history returns questions and answers
  only. Reopening restores the thread with its id, so the next question continues it; a
  question recorded before the browser sent an id is listed on its own (under the request
  id) and reopens with the turns it carried.

## ADR-0106 — E-mail through a provider's HTTP API (Railway blocks SMTP)
- **Date:** 2026-10-15 · **Status:** Accepted (owner request: "enable the forgot-password button fully")
- **Context:** The password recovery flow (forgot → e-mailed single-use link → reset, BR-043)
  has been complete in code and tests since the authentication milestone, but staging never
  delivered the e-mail: the web service has no mail configuration, so `SMTP_URL` falls back to
  the local Mailpit default and the background send fails. Railway disables outbound SMTP on
  the Free, Trial and Hobby plans (docs.railway.com/networking/outbound-networking), so an
  SMTP relay would not work there either.
- **Decision:** `Mailer` gets HTTP implementations selected by `MAIL_PROVIDER`: `smtp`
  (default, nodemailer, Mailpit locally), `resend` (api.resend.com) and `brevo`
  (api.brevo.com), each authenticated with `MAIL_API_KEY` (`loadEnv` refuses an HTTP provider
  without a key) and sending from `MAIL_FROM`. The same `MailMessage` boundary stays, so the
  in-memory outbox of the tests and every caller are unchanged. In a production build with the
  local SMTP default the API logs a warning at start-up instead of failing silently per e-mail.
  Which provider staging uses, and its key, are the owner's (external account); the first
  choice offered is Brevo's free tier (300 e-mails/day, verified sender address, no domain
  needed) or Resend (3,000/month, needs a verified domain to send to other people).
- **Consequences:** Password reset, employee invitations and platform-created owner set-up
  links work on staging once `MAIL_PROVIDER`, `MAIL_API_KEY` and `MAIL_FROM` are set on the
  web service. Production needs a sender domain verified at the provider (SPF/DKIM) before
  real merchants receive e-mail. Fallback to a second provider is not implemented.

## ADR-0108 — Domain and e-mail: arabatapp.com, Google Workspace for people, Resend for system mail
- **Status:** Accepted (2026-10-14) by the owner. Hosting of production stays open (OQ-011);
  the owner prefers Google Cloud (Cloud Run + Cloud SQL, Doha or Dammam region), not yet approved
  or created. Staging is paused by the owner for now.
- **Context:** The product needs a public domain and two kinds of e-mail: mailboxes people read
  and answer (`info@…`), and transactional mail the API sends (password reset, invitations,
  owner set-up, ownership transfer codes). The owner holds `arabatapp.com` and `arabatpos.com`
  in Cloudflare. `arabatapp.com`, `www` and `app` had A records to `34.18.110.94`, an address
  the owner does not control (dangling records).
- **Decision:**
  - Production domain: **`arabatapp.com`**; DNS stays in Cloudflare. The dangling A records were
    removed (2026-10-14; a JSON backup was taken before deletion).
  - People's mailboxes: **Google Workspace** on `arabatapp.com` (MX `smtp.google.com`, SPF
    `include:_spf.google.com`, DKIM from the Workspace admin console).
  - System mail: **Resend** (free plan: 3,000 e-mails / month, 100 / day) on the sub-domain
    **`send.arabatapp.com`**, through its SMTP relay (`SMTP_URL`, `MAIL_FROM =
    no-reply@send.arabatapp.com`). No code change: the API already sends over SMTP. A separate
    sub-domain keeps the reputation and SPF of system mail apart from people's mail.
  - DMARC starts as monitor-only (`p=none`) and is tightened to `quarantine` once DKIM of both
    senders is verified.
- **Consequences:** Above 100 system e-mails a day the free plan defers mail to the next day;
  move to Resend Pro (USD 20 / month) when volume approaches it. Workspace sign-up, Resend
  sign-up and the API key are the owner's accounts; the key goes only into the production
  secret store.

## ADR-0109 — Market direction: global, fully online self-service SaaS, regional focus waves
- **Status:** Accepted (2026-10-15). Business decision by the product owner.
- **Context:** The product has reached a feature level the owner considers competitive. Selling
  door to door to local shops does not scale. The owner wants the product positioned globally for
  businesses that want a system that is 100% online, with sign-up and subscription done online,
  marketing to one region at a time ("focus waves").
- **Decision:**
  - Target customer: any business that signs up, configures and pays **without talking to us**.
    No field sales and no on-site installation are assumed by the product.
  - Go-to-market is global, with marketing concentrated on one region per wave. The product must
    therefore be region-neutral in its core, with region specifics (currency, tax, receipt legal
    fields, payment methods, language, data residency) as per-merchant configuration, never code
    forks.
  - Kuwait stays a supported region; KWD stays the default only for merchants in Kuwait (BR-030
    unchanged for them).
  - Permanent requirements in `CLAUDE.md` §3 are unchanged (Arabic and English remain mandatory;
    more languages are additive). No real billing, live payments or paid hosting is activated
    without the owner's explicit approval (CLAUDE.md §3.13).
- **Consequences (engineering, see ROADMAP M12):**
  - Currency per merchant: today `'KWD'` is hard-coded in about ten services; `currencies` reference
    data and `Money` already support any ISO 4217 exponent. Resolves OQ-004 as "one currency per
    merchant" (multi-currency inside one merchant stays out of scope).
  - Tax becomes configurable per merchant (OQ-002 is no longer optional for regions with VAT/GST).
  - Self-service must be complete: verified e-mail at registration (OQ-025), guided onboarding,
    trial, online plan purchase, invoices, dunning and lapse rules (OQ-022).
  - Hosting region and data residency are chosen per wave (OQ-011); the first wave decides the
    first region.
  - Public website (pricing, sign-up, help centre) and the user guide become part of the product.
- **Open (owner):** first focus region (OQ-027), subscription billing provider and price list in
  which currencies (OQ-022), trial length and whether a free plan exists (OQ-028).

## ADR-0110 — One integration branch; duplicate numbers resolved
- **Date:** 2026-10-16 · **Status:** Accepted (owner: "fix it and do not lose branches or keys").
- **Context:** Sessions started from different `claude/*` branches. The Google Cloud production
  line was cut before the assistant work, so the assistant never reached production; the
  migration number 0048 and ADR-0105 were each taken by several branches; BR-194 twice.
- **Decision:** `main` holds everything (Google Cloud, assistant, HTTP e-mail, domain and
  e-mail set-up, market direction) and is the GitHub default branch; rules in CLAUDE.md §8a.
  Numbers: ADR-0105 stays Google Cloud; the assistant becomes **ADR-0107**, domain and e-mail
  **ADR-0108**, market direction **ADR-0109** (their text was written as ADR-0105 before
  2026-10-16); the market-direction rule becomes **BR-195**; the assistant migrations become
  0049 / 0050 (idempotent; staging ran them as 0048 / 0049). No branch was deleted.

## ADR-0111 — Server-side receipt printing through print agents
- **Date:** 2026-10-16 · **Status:** Accepted (owner request: a sale from any device, e.g. an
  Android phone, prints on the MacBook that has the 80 mm printer).
- **Context:** Browser printing (`window.print()`) only prints on the device that made the sale.
  The owner wants receipts from any device to come out of one thermal printer (ImagePlus 810,
  CUPS `Printer_POS_80C`) on a MacBook. The program on the MacBook ("print agent") is built
  separately; the server side follows the agreed contract.
- **Decision:**
  - `print_agents` (company, optional branch, name, SHA-256 of a 256-bit token, last seen) and
    `print_jobs` (company, branch, sale, claiming agent, `auto` / `reprint`, status
    pending → printing → printed | failed, self-contained HTML, attempts, error). Contract names
    are mapped to the repository's conventions: `company_uuid` → `merchant_id`, `branch_uuid` →
    `branch_id`, `order_uuid` → `sale_id` (the agent API still answers `orderUuid`), and the API
    lives under `/api/v1`. Migration 0051.
  - Agents are a separate identity: `@RequirePrintAgent()` checks `Authorization: Bearer <token>`
    through `print_agent_authenticate()` (SECURITY DEFINER, stamps `last_seen_at`). The plain
    token is shown once at creation. Managing agents needs `registers.manage` (company-wide for
    an all-branch agent); the auto-print setting needs `merchant.settings.*`; a reprint needs
    `sales.read` at the sale's branch and is audited.
  - Jobs are written inside the sale's transaction (`completeSaleInTx`, so POS, exchanges and
    restaurant bills; `completeOnlineSaleInTx` for the online store) in a savepoint that never
    fails the sale, only when `sales_settings.auto_print_receipts` (default on) and an agent for
    the branch exists, so no backlog builds up before an agent is set up.
  - Claiming is one conditional `UPDATE`: of two agents only one wins, the other gets 409. A job
    left in `printing` for 2 minutes (agent crashed) can be claimed again.
  - Push: Socket.IO on the API's HTTP server, namespace `/print-agent`, `auth: { token }`, rooms
    `print-agent:<id>`, `print-company:<merchantId>`, `print-branch:<branchId>`, event
    `print:job { id }`. Jobs are announced with PostgreSQL `NOTIFY` after commit and every API
    instance `LISTEN`s, so the push reaches the agent whichever Cloud Run instance holds its
    socket, without Redis. Agents of another branch are not told. Deleting an agent disconnects
    its sockets. Missed pushes are recovered with `GET /print-agent/jobs/pending` on reconnect.
  - Receipt HTML: one document with inline style only, `dir="rtl"`, Arabic labels, 72 mm body,
    black only, dashed sections; reprints are marked «نسخة».
- **Consequences:** a new dependency (`socket.io`). Socket connections count against Cloud Run's
  request timeout (300 s), so agents reconnect regularly; this is covered by the pending call.
  Failed jobs are not retried automatically; a manager reprints.
