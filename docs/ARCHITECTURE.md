# Architecture

Status: **Foundational design — not yet implemented.** Sections marked
*(planned)* describe the target design agreed for implementation.

## 1. Overview

A multi-tenant POS and Business Management SaaS delivered as a **modular
monolith**: one backend deployable, one PostgreSQL database, and three separate
frontend applications.

```
                    ┌──────────────────────────── one origin ────────────────────────────┐
 Browser            │  /manager/*        /pos/*            /platform/*        /api/*      │
                    │  manager-web SPA   pos-web SPA       platform-web SPA   backend     │
                    └────────────────────────────────────────────────────────────┬───────┘
                                                                                 │
                                       ┌─────────────────────────────────────────▼──────┐
                                       │  API (modular monolith, Node.js + TypeScript)   │
                                       │  auth · tenancy · iam · branches · catalog ·    │
                                       │  inventory · sales · payments · audit · platform│
                                       └─────────────────────────────────────────┬──────┘
                                                                                 │
                                                                    ┌────────────▼───────┐
                                                                    │ PostgreSQL (+ RLS) │
                                                                    └────────────────────┘
```

## 2. Technology stack

Mandatory: **Node.js, React, PostgreSQL, TypeScript.** Complementary choices are
recorded in `DECISIONS.md` (ADR-0002). Exact versions are pinned in
`package.json` / lockfile at scaffold time, using the current stable,
production-supported release from each project's official documentation.

| Concern              | Choice                                                         |
|----------------------|----------------------------------------------------------------|
| Runtime              | Node.js — current **Active LTS** line                          |
| Language             | TypeScript (strict mode)                                       |
| Monorepo             | pnpm workspaces                                                |
| Backend framework    | NestJS (Fastify adapter) — module system fits a modular monolith |
| Validation / DTOs    | Zod schemas, shared between API and frontends                  |
| ORM / SQL            | Drizzle ORM + drizzle-kit SQL migrations                       |
| Database             | PostgreSQL (current supported major), Row-Level Security       |
| Password hashing     | Argon2id                                                       |
| Frontend             | React + Vite, React Router, TanStack Query                     |
| UI                   | Tailwind CSS + Radix-based component library (shadcn/ui style) |
| Forms                | React Hook Form + Zod                                          |
| Unit/integration tests | Vitest; Supertest/Fastify inject for API                     |
| DB tests             | Real PostgreSQL (local cluster or Testcontainers)              |
| E2E tests            | Playwright                                                     |
| Lint / format        | ESLint + Prettier                                              |

## 3. Repository layout *(planned)*

```
apps/
  api/            NestJS modular monolith (serves /api/*)
  manager-web/    React SPA mounted at /manager
  pos-web/        React SPA mounted at /pos
  platform-web/   React SPA mounted at /platform
packages/
  shared/         Zod schemas, permission keys, shared types, error codes
  money/          Money value object (integer minor units, rounding) — no floats
  ui/             Shared design-system components (no business logic)
  api-client/     Typed API client used by the three SPAs
docs/             Persistent project documentation
```

## 4. The three interfaces (permanent requirement)

The three interfaces are **independent applications** with their own entry
point, layout, navigation, routing and bundle. A user of one interface never
downloads another interface's code.

### 4.1 `/manager` — Business management dashboard
- Audience: tenant owner and users holding `manager.access`.
- Desktop-first, sidebar navigation, data tables, reports, settings.
- Scope: branches, employees, roles & permissions, catalog, inventory, sales
  history, reports, company settings.
- Branch context: a manager sees only branches they are assigned to (owner sees all).

### 4.2 `/pos` — Employee cashier interface
- Audience: users holding `pos.access` **and** assigned to at least one branch.
- Touch-first, full-screen, minimal navigation, large hit targets, keyboard and
  barcode-scanner friendly.
- The session is bound to **one branch** (and later a register/terminal) at a time.
- No management functions. Sensitive actions (void, refund, discount above
  limit, price override) require their own permission or a manager approval.
- Managers can use the POS **only if explicitly granted** `pos.access` for the branch.

### 4.3 `/platform` — SaaS operator administration
- Audience: platform operator staff only (separate identity realm).
- Scope: tenant lifecycle (create, suspend, reactivate), plans, platform-wide
  monitoring, support tooling.
- Platform staff do not appear as tenant users. Any future "support access" to a
  tenant must be explicit, time-limited, and audited.

## 5. Backend modules *(planned)*

Each module owns its tables, services and controllers. Cross-module calls go
through exported services, never by reaching into another module's tables.

| Module      | Responsibility                                                    |
|-------------|-------------------------------------------------------------------|
| `auth`      | Login, logout, sessions, password reset, invitations              |
| `tenancy`   | Tenant context resolution, RLS session variables                  |
| `iam`       | Users, memberships, roles, permissions, branch assignments        |
| `branches`  | Branch management                                                 |
| `catalog`   | Products, variants, categories, prices                            |
| `inventory` | Stock ledger, adjustments, transfers                              |
| `sales`     | Carts, sales, voids, refunds, receipts                            |
| `payments`  | Payment methods & tenders (no live gateway without approval)      |
| `audit`     | Append-only audit log                                             |
| `platform`  | Operator-only tenant administration                               |

API namespaces:
- `/api/v1/auth/*` — shared login/session endpoints.
- `/api/v1/manager/*` — management endpoints (require `manager.access`).
- `/api/v1/pos/*` — cashier endpoints (require `pos.access` + branch).
- `/api/v1/platform/*` — operator endpoints (platform realm only).

## 6. Authentication and authorization

### 6.1 Authentication (centralized)
- One authentication service for all interfaces.
- Server-side sessions stored in PostgreSQL; opaque session id in an
  `HttpOnly`, `Secure`, `SameSite=Lax` cookie. CSRF protection on state-changing
  requests.
- Each session records the **interface** it was opened for (`manager`, `pos`,
  `platform`) and, for POS, the selected **branch**.
- Merchant users and platform operators are stored in separate tables and
  authenticate against separate endpoints.

### 6.2 Authorization (backend-enforced)
Every request passes through, in order:
1. **Authentication guard** — valid, unexpired session.
2. **Realm guard** — merchant vs platform.
3. **Interface guard** — `/manager` endpoints require `manager.access`; `/pos`
   endpoints require `pos.access`.
4. **Tenant guard** — tenant id comes from the session, never from the request
   body/URL; the DB transaction sets `app.tenant_id` for RLS.
5. **Branch guard** — the target branch must be within the user's branch
   assignments (owner: all branches).
6. **Permission guard** — the endpoint's declared permission key must be granted.

Endpoints without an explicit permission declaration fail closed.

### 6.3 Roles and permissions
- Permission keys are defined in code (`packages/shared`), e.g.
  `manager.access`, `pos.access`, `catalog.product.write`, `sales.refund`.
- Roles are **per tenant** and configurable: a role is a named set of permission keys.
- A user's membership in a tenant has one or more roles and a set of branch
  assignments.
- System-provided role templates (e.g. Owner, Manager, Cashier) are seeded per
  tenant; the **Owner** role is immutable and always holds every permission.
- The default Cashier template holds `pos.access` and **not** `manager.access`.

## 7. Multi-tenancy

- Shared database, shared schema; every tenant-owned row carries `tenant_id`.
- Defence in depth:
  1. Application layer scopes every query by the session's tenant.
  2. PostgreSQL **Row-Level Security** policies on every tenant table using
     `current_setting('app.tenant_id')`, set per transaction via `SET LOCAL`.
  3. The application connects as a non-superuser role without `BYPASSRLS`.
- Composite foreign keys include `tenant_id` so cross-tenant references are
  impossible at the database level.
- Automated tests verify that tenant A cannot read or modify tenant B's data.

## 8. Transactions and consistency
- Every multi-step write runs in a single DB transaction.
- Sales, payments and stock movements commit atomically.
- Idempotency keys on POS write endpoints (protects against double-submit and
  retries).
- Optimistic concurrency (`version` column) on editable master data.

## 9. Non-goals (for now)
- Microservices, event buses, or separate databases per tenant.
- Live payment gateways, SMS/e-mail providers with cost, or any deployment —
  not without owner approval.
- Offline POS — pending business decision (see `BUSINESS_RULES.md` open questions).
