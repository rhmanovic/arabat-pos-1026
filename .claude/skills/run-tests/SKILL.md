---
name: run-tests
description: How to run, narrow and debug this repo's tests (pnpm verify, Vitest unit/web/integration, Playwright e2e). Use before running any test command, when a test fails, when writing integration fixtures, or before reporting work as done.
---

# Running tests in arabat-pos

Environment prep (Node 24 on PATH, Docker, Postgres, Playwright browser) is in the
`sandbox-setup` skill. Do that first in a fresh cloud sandbox.

## Hard rules
- Never skip, disable, `.only`, weaken or delete a test to get green. Fix the code or the test's real cause.
- Before reporting work as done, run all three, in order, and report actual counts:
  `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e`.
- During development run the narrowest subset (below); the full runs are for the end.
- Run the three suites **one after another, never two at once** (not even one in the background):
  `pnpm verify` (builds + Vitest workers) next to `pnpm test:integration` exhausts the sandbox's
  memory and one of them dies with `SIGKILL` / an "unexpected exit" with no test failure named.

## The three suites
| Command | What it runs | Needs |
|---|---|---|
| `pnpm verify` | `lint` → `format:check` → `typecheck` (runs `build:packages` first) → `build` (all apps) → `check:pos-core-browser` → `pnpm test` (Vitest projects `unit` + `web`) | nothing (no DB) |
| `pnpm test:integration` | Vitest project `integration`: `apps/api/src/**/*.int.test.ts`, serial (`fileParallelism: false`), 20 s test / 30 s hook timeout | Postgres up, `.env` with `TEST_DATABASE_URL` (app_runtime) + `TEST_DATABASE_OWNER_URL` (app_owner) on `arabat_test` |
| `pnpm test:e2e` | Playwright, specs in `e2e/`, projects `desktop`, `tablet-touch`, `phone` (the last two only `pos.spec.ts`) | Postgres + Mailpit (`pnpm db:up`), `pnpm build`, `pnpm db:migrate`, `pnpm db:seed` on the dev DB (`DATABASE_URL`), `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium` in the sandbox |

Config: `vitest.config.ts` (projects `unit`, `web`, `integration`), `vitest.web-setup.ts`,
`playwright.config.ts`. Integration tests throw (never skip) when the TEST_ env is missing.

E2E details: Playwright starts `node apps/api/dist/main.js` with `SERVE_WEB=true` on port 3100
(`E2E_PORT`), `STORE_DOMAIN=localhost`, `CUSTOM_HOSTNAMES_DRIVER=fake`. Chromium resolves
`*.localhost` and (via `--host-resolver-rules`) `*.arabat-e2e.test` to this server; Node
(`page.request`) does not: call `http://localhost:PORT` with a `host` header instead. `reuseExistingServer` is on locally: a stale API already
listening on 3100 is reused, so after code changes rebuild and stop it first
(`kill $(pgrep -f "^node --env-file")`). E2E serves the **built** bundles: always `pnpm build`
after changing API or web code, and `pnpm db:migrate` after a new migration (migrate/seed run from
`apps/api/dist`).

## Running one file / one test
Unit (packages + API, no DB):
```
pnpm exec vitest run --project unit packages/money/src/money.test.ts
pnpm exec vitest run --project unit apps/api/src/kernel -t "store host"
```
Web (jsdom, React apps and web packages):
```
pnpm exec vitest run --project web apps/pos-web/src/app.test.tsx -t "refund"
```
Integration (DB):
```
pnpm exec vitest run --project integration apps/api/src/modules/cash/cash.int.test.ts
pnpm exec vitest run --project integration apps/api/src/modules/cash -t "deposit"
```
E2E:
```
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium pnpm exec playwright test e2e/pos.spec.ts --project desktop -g "checkout"
```
`-t` (Vitest) / `-g` (Playwright) take a regexp over the full name (describe + it). Add
`--reporter verbose` for per-test output, `--bail 1` to stop at the first failure.
After changing `packages/{money,permissions,contracts,pos-core}` run `pnpm build:packages`
before API integration tests or e2e: the API consumes their `dist/` (Vitest itself reads `src/`).

## Pick the subset for the change
| Changed | Run while working |
|---|---|
| `packages/money`, `permissions`, `pos-core`, `device-core`, `contracts` | `--project unit packages/<pkg>`; pos-core/device-core also `pnpm check:pos-core-browser` |
| API pure logic / kernel | `--project unit apps/api/src/<path>` |
| API module touching DB, RLS, transactions, endpoints | that module's `*.int.test.ts` (`--project integration apps/api/src/modules/<m>`) |
| Migration (`apps/api/drizzle`) | `pnpm --filter @arabat/api build && pnpm db:migrate`, then the affected module's int tests |
| A web app (`apps/*-web`) or `packages/{ui,web-core,i18n,api-client}` | `--project web apps/<app>`; then `pnpm build` + the matching `e2e/<area>.spec.ts` |
| Styles / translations only | `pnpm lint` (physical left/right classes are rejected) + `--project web` for the app |
| Formatting doubt | `pnpm exec prettier --check <files>` (or `pnpm format` to fix) |
| Types | `pnpm typecheck` (also builds packages) |

## Fixtures and their gotchas (integration)
- Helpers live in `apps/api/src/testing/`:
  - `integration-db.ts` → `prepareIntegrationDatabase()`: migrates, seeds, truncates identity tables;
    returns an `owner` pool (app_owner) and `runtimeUrl` (app_runtime, RLS applies).
  - `test-app.ts` → `createTestApp({ env: testEnv({ DATABASE_URL: runtimeUrl }), mailer })`,
    `InMemoryMailer`, `HeaderSessionResolver` (test-only actor header).
  - `auth-fixtures.ts` → `createCompany(app, db, mailer)`, `registerOwner`, `ApiClient`,
    `DbFixtures` (`inMerchant`, `mainBranch`, `addBranch`, ...), `uniqueEmail`, `freshIp`.
  - Copy the `beforeAll`/`afterAll` shape of an existing file, e.g. `modules/cash/cash.int.test.ts`.
- `app_owner` is **not** filtered by RLS: every fixture query through the owner pool must filter by
  `merchant_id` itself (other tests' merchants share the DB). Set `app.merchant_id` via
  `db.inMerchant(...)` for triggers that read it.
- Merchant status / subscription updates fire a trigger needing `app.operator_id`, also in owner fixtures:
  `select set_config('app.operator_id', gen_random_uuid()::text, true)` inside the transaction.
- Use unique emails/codes per test (`uniqueEmail`, `newId()`); tests in one file share the database.
- E2E helpers: `e2e/helpers.ts` (`signIn`, `useEnglish`, `DEV` seed accounts, `totp`, `latestMailText`
  from Mailpit, `uniqueEmail`).

## Reading failures
- A lint or format failure stops `verify` before `build`: an e2e run after it uses the old
  `dist`. Rerun e2e once `verify` passes.
- Never assert on a whole response body with `toContain` / `not.toContain`: random ids can hold
  the word (a uuid with `fee` failed a test). Check fields or keys.
- `verify` stops at the first failing step; the step name tells what to rerun alone
  (`pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`, `pnpm test`).
- API refuses to boot in tests: a route lacks `@Public` / `@Authenticated` / `@RequirePermission` /
  `@RequirePlatformRole`, or an injected class was imported as `import type` (decorator metadata).
- `TEST_DATABASE_URL ... must be set`: `.env` missing or DB not up (see `sandbox-setup`).
- Integration row "not found" / 0 rows via runtime role: RLS context missing; via owner pool: rows from
  another merchant leaked because `merchant_id` was not filtered.
- Integration timeouts: usually a leaked pool client or unawaited promise; check `afterAll` closes `app` and `owner`.
- E2E failures: read the `list` output, then the trace in `test-results/<test>/trace.zip`
  (`pnpm exec playwright show-trace <zip>`). "Old" behaviour means a stale build or reused server.
- Web test "missing translation" or physical class errors come from i18n / lint checks: fix both `ar` and `en`.

## Reporting
Record results in `docs/TESTING.md` (a dated "Results" entry) and `docs/PROGRESS.md`, with the real
numbers from each command and anything not run and why.
