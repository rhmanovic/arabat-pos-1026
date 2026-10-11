# Progress

Only record what has actually been done and verified. Mocked or partial work
must be labeled as such.

## Current state (2026-10-11, after Prompt 6 — manager dashboard)

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
| Automated tests | Passing | 90 unit/web, 52 integration, 22 E2E (local) |
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

## Next step
Prompt 7 — product catalog.
