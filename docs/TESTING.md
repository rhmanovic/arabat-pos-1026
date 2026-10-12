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

### Results after Prompt 12 (2026-10-12, local run)
- `pnpm verify` ✓ (115 unit/web), `pnpm test:integration` ✓ (118), `pnpm test:e2e` ✓ (28).
- `purchasing.int.test.ts` (8): suppliers (unique code, inactive refused on new orders,
  history); full PO lifecycle with exact stock and weighted average cost across two
  deliveries; **retried and concurrent deliveries** (same key → one receipt; two
  different deliveries racing for the remainder → never over the order) — verified to
  fail without the order row lock; cancel/close rules; branch permissions and
  self-approval; transfer lifecycle with in-transit stock, dispatch cost carried to the
  destination and a written-off shortage; dispatch never exceeds the source even with a
  permissive negative-stock policy; branch-level transfer permissions.
- Web: receiving part of an approved order (typed quantity, reference, idempotency key);
  receive disabled when nothing is entered.
- `e2e/purchasing.spec.ts`: supplier → order → submit → approve → deliveries of 4 and 6
  → stock 10; transfer of 4 → in transit (6 / 0) → 3.5 received with a required note →
  6 / 3.5 with 0.5 missing.

### Results after Prompt 11 (2026-10-12, local run)
- `pnpm verify` ✓ (113 unit/web), `pnpm test:integration` ✓ (110), `pnpm test:e2e` ✓ (27).
- `refunds.int.test.ts` (11): partial then full refunds summing exactly (3 × 0.333);
  no excess; shift drawer and sales totals (refunded, net); split-payment allocation
  (proportional default, custom within each tender, invalid allocations refused);
  conditional restock at original cost; approval above the limit (reservation while
  pending, cashier/other-branch manager cannot approve, supervisor approves at the till,
  cash from the requester's drawer, no double decision); reject, withdraw, self-approval
  blocked; **duplicate and concurrent requests** (same key ×4 → one refund; two cashiers
  on two shifts racing for the last unit → exactly one) — verified to fail without the
  per-sale lock; drawer must cover cash refunds and a shift is required; gateway refunds
  stay processing; voids (permission, own shift, once); exchanges up and down with exact
  credit/difference and stock, atomic failure; immutability; activity report; isolation.
- Web: manager approval of a pending refund.
- `e2e/refunds.spec.ts`: invited cashier refunds one item with receipt, exchanges with a
  difference paid in cash, requests a large refund that waits; the manager approves in
  `/manager/refunds`; stock and drawer reconcile exactly.
- Found and fixed: identical button names for "refund" mode and submit (renamed to
  "Confirm refund"); the exchange flow hid the new sale's receipt.

### Results after Prompt 10 (2026-10-12, local run)
- `pnpm verify` ✓ (112 unit/web), `pnpm test:integration` ✓ (99), `pnpm test:e2e` ✓ (26).
- `pricing.test.ts`: exact fractional quantities, line/order discounts with exact
  allocation, invalid discounts, exact limit comparison.
- `sales.int.test.ts` (11): normal cash sale (totals, change, receipt numbers, one stock
  movement, shift expected cash, manager list/detail, audit); split payment with
  per-payment fees and balance entries; **duplicate requests** (5 concurrent identical →
  one sale, one payment, one movement; same key different cart → conflict);
  **concurrent checkout** of the last unit on two registers (one sale, the other
  INSUFFICIENT_STOCK, nothing left behind); insufficient stock with no side effects
  (no receipt number consumed); invalid discounts and the limit (cashier vs supervisor,
  100 % zero-total sale); unauthorized and authorized price override with audit;
  incorrect payment totals, changed prices, unverified gateway payments; financial
  precision (0.333 × 1.5, 10 % order discount); shift requirement, branch availability,
  branch/merchant read restrictions; hold → complete once; DB immutability.
- Web: barcode scan + cart totals + cash change + exact checkout payload (POS).
- `e2e/checkout.spec.ts`: the Prompt 10 acceptance scenario end to end (branch via UI,
  products and stock, invited cashier, POS sign-in at the branch, shift, scan, split
  payment, receipt, stock deducted exactly once, drawer expected cash, manager view).
- Found by tests and fixed: a percent-trimming bug turned the default discount limit
  "10" into "1".

### Results after Prompt 9 (2026-10-12, local run)
- `pnpm verify` ✓ (106 unit/web), `pnpm test:integration` ✓ (88), `pnpm test:e2e` ✓ (25).
- `fees.test.ts`: none/fixed/percentage/combined fees, half-up rounding at the fils, cap.
- `shifts.int.test.ts` (10): per-merchant default methods and isolation; exact fee storage
  and validation; one cash method; linked balances only within the merchant (balance =
  sum of entries); permissions (branch manager lacks `payments.settings`, cashier sees
  POS methods without fees); full shift with exact reconciliation (−0.155 short),
  denomination check, audit trail, DB-level immutability of closed shifts and cash
  movements; manager list and discrepancy report; **concurrent opens** of one register
  (one wins, REGISTER_BUSY) and one shift per employee; **concurrent cash-outs** (8 × 3.000
  on 10.000 → exactly 3 succeed), idempotent retries; restricted registers and branch
  binding; force close (note required, branch-scoped, no double close); tolerance snapshot.
- The cash-out concurrency test was verified to fail without the shift row lock.
- Web: POS shift gate + open shift, coin-count closing; manager fee preview.
- `e2e/shifts.spec.ts`: fee setup with preview, owner opens a POS shift, cash in/out,
  refused over-withdrawal, close short by 0.250, manager list/detail/report.

### Results after Prompt 8 (2026-10-11, local run)
- `pnpm verify` ✓ (97 unit/web tests), `pnpm test:integration` ✓ (78), `pnpm test:e2e` ✓ (24).
- `quantity.test.ts`: exact parsing/formatting, value rounding, weighted average edge cases.
- `inventory.int.test.ts` (12): opening/increase/decrease/count with exact fractional
  quantities and weighted average; validation (4 decimals, zero, negative, wrong reason,
  duplicates, services); no-oversell all-or-nothing and the explicit negative-stock
  setting; idempotent retries (3 concurrent identical requests → one document);
  **concurrency** (16 concurrent decreases on 10 units → exactly 10 succeed, balance 0;
  concurrent multi-line increases in opposite order → no deadlock, no lost update);
  per-branch balances and aggregation; thresholds/summary/valuation rounding; branch
  scoping, cost hiding, cashier availability; cross-merchant isolation; ledger engine
  (skips services, rolls back with the caller's transaction, `deny` override);
  append-only enforcement by the database. The ledger invariant
  `on_hand = Σ movements` is asserted after each scenario.
- The concurrency test was verified to fail when the row lock is removed (16 of 16
  decreases succeeded → oversell), so it really guards the lock.
- `inventory.test.tsx` (web): stock list without costs for read-only users, value for
  cost-entitled users, adjustment validation and exact payload with idempotency key.
- `e2e/inventory.spec.ts`: opening stock with cost, decrease, refused oversell, value
  3.750, low-stock alert, count posting −0.5, movement history.

### Results after Prompt 7 (2026-10-11, local run)
- `pnpm verify` ✓ (90 unit/web tests), `pnpm test:integration` ✓ (66), `pnpm test:e2e` ✓ (23).
- `catalog.int.test.ts` (14): exact KWD prices (no rounding), variants lifecycle,
  SKU/barcode uniqueness per merchant, optimistic locking and archive-not-delete,
  search/filter/sort/pagination, category cycles, POS catalog branch filtering,
  cross-merchant branch rejection, cashier/branch-manager limits, price permission and
  cost hiding, image upload/type sniffing/merchant isolation, tenant isolation.
- `e2e/catalog.spec.ts`: manager creates categories and products with variants, prices,
  branch availability and images through the UI.

### Results after Prompt 4 (2026-10-11, local run)
- `pnpm verify` ✓ (82 tests), `pnpm test:integration` ✓ (36), `pnpm test:e2e` ✓ (18).
- Integration fixtures: `apps/api/src/testing/auth-fixtures.ts` (`ApiClient` with a
  fresh IP per client, `registerOwner`, `DbFixtures.addEmployee/grantRole`);
  `prepareIntegrationDatabase()` migrates and truncates identity tables.
- E2E needs Mailpit (`pnpm db:up` starts it) and the development seed.

### Results at the end of M0 (2026-10-11, local run)
- `pnpm verify`: lint ✓, format ✓, typecheck ✓ (11 projects), build ✓, 79 tests ✓.
- `pnpm test:integration`: 10 tests ✓ (PostgreSQL 18.6 via Docker Compose).
- `pnpm test:e2e`: 12 tests ✓ (Chromium desktop + tablet touch profile).
- The GitHub Actions workflow has not run yet (not pushed to a branch with CI
  triggers when written); first run must be checked.

## 5. Coverage expectations
- `packages/money` and authorization logic: ~100% branch coverage.
- Business modules: all business rules (BR-xxx) referenced by at least one test.
