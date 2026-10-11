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
- **Date:** 2026-10-11 · **Status:** Accepted
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
- **Date:** 2026-10-11 · **Status:** Accepted
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
