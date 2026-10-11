# Progress

Only record what has actually been done and verified. Mocked or partial work
must be labeled as such.

## Current state (2026-10-11, after session 3 — milestone M0)

| Area | Status | Notes |
|---|---|---|
| Documentation & architecture | Done | `CLAUDE.md`, `README.md`, `docs/*` |
| Monorepo & tooling | Done | pnpm 12 workspaces, TS 6 strict, ESLint 10, Prettier, Node 24 |
| Backend foundation | Done | NestJS 12 + Fastify 5, config validation, problem+json errors, pino logs, request ids, Zod validation pipe, health endpoints, helmet/CSP |
| Access control foundation | Done (deny-all) | Default-deny guard, route auditor (boot fails on undeclared routes), permission evaluation. **No login/sessions yet (M1)** |
| Database foundation | Done | PostgreSQL 18 (Compose), Drizzle, migrations, owner/runtime roles, RLS helper, seeds |
| Frontend foundation | Done | 3 separate Vite apps + shared packages; ManagerLayout / POSLayout / PlatformLayout; ar/en + RTL/LTR; auth state & protected routes; API client |
| Automated tests | Passing | 79 unit/web, 10 integration, 12 E2E (local) |
| CI | Written, not yet run | `.github/workflows/ci.yml` |
| Business modules | Not started | Begin in M1 |
| Deployment | Not planned | Requires owner approval |

## Log

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

## Next step
Milestone M1 — identity, merchants, branches, roles & access (see `ROADMAP.md`).
Needs owner decisions OQ-010 (merchant sign-up) and OQ-006 (POS login style).
