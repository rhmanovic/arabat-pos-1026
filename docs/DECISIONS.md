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

