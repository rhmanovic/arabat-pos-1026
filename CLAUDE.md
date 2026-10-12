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
packages/money        bigint Money (KWD 3 decimals)          — built to dist (used by API)
packages/permissions  permission catalog + can()             — built to dist (used by API)
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

## 9. Gotchas (learned the hard way)

- **Never put `NODE_ENV` in `.env`**: Vite copies it into `process.env` and would
  bundle React's development build. The web `vite.config.ts` files refuse to build
  with a non-production `NODE_ENV`.
- Built packages (`money`, `permissions`, `contracts`) are consumed by the API from
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
- `app_owner` bypasses RLS: seeds, migrations and test fixtures must filter by
  `merchant_id` themselves.
- Prettier reformats long literals; scripted text edits must assert that the target
  string exists before replacing.
- Uploaded files go through `FileStorage` (`apps/api/src/kernel/storage`); never write
  to disk directly. Local storage lives in `var/` (git-ignored).
- In this cloud sandbox: Node 24 is at `~/.local/node24/bin`, Docker must be started
  with `dockerd &`, and Playwright needs
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`.

## 10. Repository status

Implemented: foundation, authentication, branches/employees/RBAC, manager dashboard,
product catalog, inventory engine, payments/registers/shifts, POS checkout, returns/refunds,
purchasing and branch transfers, customers, reports (see `docs/PROGRESS.md`).
Stock balances change **only** through `StockLedgerService.apply` (inventory module).
See `docs/PROGRESS.md` for the current state and `docs/ROADMAP.md` for next steps.
