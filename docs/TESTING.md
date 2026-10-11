# Testing

Status: **Strategy defined. No test suites exist yet** (no application code).
Milestone-level acceptance criteria are in `ROADMAP.md`.

## 1. Principles
- Every slice ships with automated tests that were **actually run**; results are
  reported honestly in `PROGRESS.md`.
- Never skip, disable or weaken a test to make a build pass.
- Database behaviour is tested against **real PostgreSQL**, not mocks.
- Mocks are allowed only at true external boundaries (payment gateways, e-mail),
  and such features are never reported as complete while mocked.

## 2. Test layers

| Layer        | Tool                        | Scope                                                  |
|--------------|-----------------------------|--------------------------------------------------------|
| Unit         | Vitest 5                    | Pure logic: money, rounding, permission evaluation     |
| Integration  | Vitest + Testcontainers `postgres:18` (fallback: local PG 16+) | Repositories, transactions, RLS, migrations            |
| API          | Vitest + Fastify inject     | Endpoints incl. authn/authz/tenant/branch guards       |
| Component    | Vitest + Testing Library + MSW | Critical UI components                                 |
| End-to-end   | Playwright 1.64 (Chromium; touch emulation for POS) | Key flows per interface: manager, POS, platform; AR (RTL) + EN |

## 3. Mandatory test categories
1. **Money:** KWD 3-decimal arithmetic, rounding (BR-033), allocation of
   discounts, no precision loss on serialization, very large amounts.
2. **Tenant isolation:** for every tenant table/endpoint, tenant A cannot read,
   list, update or reference tenant B's data — including with RLS alone.
3. **Authorization matrix:**
   - Employee without `manager.access` gets 403 on every `/api/v1/manager/*` route.
   - Manager without `pos.access` gets 403 on `/api/v1/pos/*`.
   - User cannot act on an unassigned branch.
   - Merchant sessions get 401/403 on `/api/v1/platform/*`, and vice versa.
   - Routes without a declared permission fail closed.
4. **Transactions:** partial failures roll back completely (sale + payment +
   stock movement).
5. **Idempotency:** repeated POS submissions do not duplicate sales.
6. **Pricing parity:** POS preview (`packages/pricing`) equals server totals
   over a randomized corpus.
7. **Ledger consistency:** `stock_levels` equals the sum of `stock_movements`.
8. **Fail-closed boot:** the API refuses to start if a route lacks a
   permission/public declaration.
9. **i18n:** no missing translation keys in `ar` or `en`; no physical
   left/right CSS classes (lint).

## 4. Commands and infrastructure (implemented in M0)

| Command | Vitest project / tool | What runs | Needs |
|---|---|---|---|
| `pnpm test` | `unit` + `web` | money, permissions, API kernel (Nest app via Fastify `inject`), env config; React apps and shared web packages in jsdom | nothing |
| `pnpm test:integration` | `integration` | `apps/api/**/*.int.test.ts` against real PostgreSQL: migrations, seeds, runtime role privileges, RLS isolation, rollback, readiness | `pnpm db:up`, `.env` with `TEST_DATABASE_URL` and `TEST_DATABASE_OWNER_URL` |
| `pnpm test:e2e` | Playwright | Built apps served by the API (`SERVE_WEB=true`, port 3100): separate bundles, redirects to login, API status, RTL/LTR switch, default-deny API, touch target size, no browser errors | `pnpm db:up && pnpm db:migrate && pnpm build` |
| `pnpm verify` | all static checks | lint, format check, typecheck, build, `pnpm test` | nothing |

- Config: `vitest.config.ts` (projects `unit`, `integration`, `web`),
  `vitest.web-setup.ts`, `playwright.config.ts`, specs in `e2e/`.
- API tests build the real application with `createTestApp()`
  (`apps/api/src/testing/test-app.ts`); a test-only `HeaderSessionResolver`
  injects actors to exercise the guard matrix. It is never registered in the real
  application.
- Web tests render each app's real route tree with `renderApp()` from
  `@arabat/web-core/testing` and a fake `fetch` that answers like the API.
- Playwright uses the browsers installed by `playwright install`, or
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if set (cloud sandbox: `/opt/pw-browsers/chromium`).
- CI (`.github/workflows/ci.yml`): job `verify`, then job `integration` with a
  `postgres:18` service (roles created by `docker/postgres/init`), migrations,
  seeds, integration tests and E2E.

### Results at the end of M0 (2026-10-11, local run)
- `pnpm verify`: lint ✓, format ✓, typecheck ✓ (11 projects), build ✓, 79 tests ✓.
- `pnpm test:integration`: 10 tests ✓ (PostgreSQL 18.6 via Docker Compose).
- `pnpm test:e2e`: 12 tests ✓ (Chromium desktop + tablet touch profile).
- The GitHub Actions workflow has not run yet (not pushed to a branch with CI
  triggers when written); first run must be checked.

## 5. Coverage expectations
- `packages/money` and authorization logic: ~100% branch coverage.
- Business modules: all business rules (BR-xxx) referenced by at least one test.
