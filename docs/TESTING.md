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

### Results after remediation session 11 (2026-10-13, local run)

`pnpm verify` green (180 unit/web tests, including the new `periods.test.tsx` (months listed
with their status and the closer's note, the first non-current month's pack shown by default
with net after refunds, margin, closing stock, the unreferenced-tender line, the collections
table, open items and the supplier balance; the close dialog warns, takes a note and posts it,
the list then shows the month closed and no further close button; no close button without
`periods.close`)); `pnpm test:integration` 210 passed, including the three new cases in
`periods.int.test.ts` (a company three months old with one sale rung up in the middle of last
month: the list shows current / open / closable in order, the live pack of last month carries
that sale, its cash collection and its gross profit while cash and stock as at month end are
zero; closing last month before the one before it is refused, the current month is refused, the
registration month closes with a note, then last month closes with the owner named and the
stored pack is returned unchanged afterwards, a second close is refused, `period.closed` is
audited twice, and the application role can neither delete nor update the row; a branch
manager without financial reports gets no list, no pack and no close while a company manager
closes; purchase orders default to today's business date, keep a date three days back and
audit it, refuse a future date and ten days back, deliveries carry a delivery date and refuse a
future one, and with the current month closed directly in the database both an order and a
delivery are refused with `PERIOD_CLOSED` while a sale still posts); `pnpm test:e2e` 35 passed
after migration 0046's backfill was made to pass over final orders (the `purchase_orders_final`
trigger is disabled for that one statement; the first dev-database migration had failed on it).

### Results after remediation session 10 (2026-10-13, local run)

`pnpm verify` green (178 unit/web tests, including the new manager cases in `reports.test.tsx`
(gross profit shown on the costed part with the uncosted share flagged, the "Online store" row
in sales by employee kept out of the employee filter, a CSV export reported to
`POST /manager/reports/exports` with report, section, period and row count; the dashboard's
today / yesterday figures and the "no sales yet" notice for a company that never sold) and in
`purchasing.test.tsx` (supplier statement dialog: received vs. paid, reversal line, running
difference, period sent as local days)); `pnpm test:integration` 207 passed, including the four
new cases in `period-controls.int.test.ts` (a sale rung up at 23:30 local the day before and
refunded today: the sales history counts the refund today and its net equals the report, the
refund register cuts on the completion day with totals, disbursements of 01:30 local land on the
local day not the UTC day, a treasury statement with a period brings the balance forward and
closes exactly, no period gives the current balance; time zone at registration, an unknown zone
refused, an unchanged profile save leaves it alone, a change is stamped and audited from → to and
re-cuts the reports; gross profit with one costless service sale (uncosted 2.000, 66.7 % of net,
margin 60.0 % on the costed part), today's KPIs and the refusal of a POS session, a fresh company
with `hasSales false`, `report.viewed` with period and `report.exported` with rows, the activity
review's default 30-day window and 10 % threshold, both changed by policy and audited, explicit
dates winning over the window; the supplier statement with receipt, payment, reversal and second
payment in running order, totals, a future period bringing 3.000 forward, branch scope leaving a
second-branch manager with no lines, 404 for an unknown supplier) and the e-commerce suite's new
assertion that the online row makes sales by employee add up; `pnpm test:e2e` 35 passed after
`cash-payouts.spec` was pointed at the supplier statement (the "Payments" dialog it clicked is
now the statement). Existing expectations adapted: the complete-period profit carries
`uncostedSales 0.000` / `0.0 %`, and the costless-item case shows `grossProfit 0.000` with
`marginPercent null` instead of hiding the block.

### Results after remediation session 9 (2026-10-13, local run)

`pnpm verify` green (175 unit/web tests; the manager `cash.test.tsx` method case now picks a
settlement account and a refund-fee policy and checks both in the request body, the POS settings
fixture carries the four new policy fields); `pnpm test:integration` 203 passed, including the
three new cases in `refunds-controls.int.test.ts` (a cashier's refund of their own sale held
`pending_approval` with `own_sale`, the approver cannot be the requester, the owner override
recorded on the refund and in the audit, the `ownSaleRefunds` activity count, the policy switch
that lets a one-person shop refund its own sales; exchange credit traced pro rata to the original
tenders and an approval on a closed requester shift re-pointed to the approver's own shift;
`REFERENCE_REQUIRED` and `SETTLEMENT_ACCOUNT_REQUIRED`, fee reversal per method policy posted as
a positive fee entry and reported as `feesReversed`, the unreferenced-tender list of the payments
report) and the three new cases in `sales-controls.int.test.ts` (combined line + order discount
measured against the limit, a held sale completed by a second cashier keeps its lines and records
the completer and shift, expiry after the configured hours, receipt lookup at the till, numbered
reprints audited and counted on the sale, cart-clear events above the threshold); `pnpm test:e2e`
35 passed after one fix: the payment-method dialog hid the fee preview until an account was
chosen, so the preview now depends on the fee inputs only and `shifts.spec` picks "Bank account 1"
before saving. Existing tests adapted to the new rules: non-cash tenders carry a reference and the
methods an account; owner fixtures disable the own-sale approval and the reference policy with
`allowOwnSaleRefunds()` where the scenario is not about them; the supervisor's own refund case in
`refunds.int.test.ts` now goes through approval.

### Results after remediation session 8 (2026-10-13, local run)

`pnpm verify` green (175 unit/web tests, including the new POS case in `app.test.tsx` (a cashier
without any discount right enters a 15 % sale discount, pays, is blocked until a supervisor
authorises it in the payment dialog with their own credentials, the checkout then carries the
grant) and the new manager `sales.test.tsx` (unusual-sales filter, flags on the row, the
exceptions block of a sale: above-limit note, free-sale reason, supervisor override with the
rights supplied, price-change reason)); `pnpm test:integration` 197 passed, including the four
new cases in `sales-overrides.int.test.ts` (override refused for a wrong password, for the
cashier themself and for a colleague with nothing more to lend; grant issued by a supervisor
without a shift, unusable by another cashier, spent by one sale that stays on the cashier's
shift and drawer with `aboveLimit`, the limit in force and the approver recorded, single use,
audit of grant / sale / refusals, `flag=supervised` filter and per-employee counts; grant expiry
and the owner as approver; price change without a reason refused, floor / ceiling / cost bounds,
a 5 % change not flagged and a 40 % change flagged, a price-only role unable to hide a discount
in a price, relaxed bounds, floor above ceiling refused, bounds visible to the POS,
`flag=price_override` and `flag=above_limit`; a free sale refused without `sales.zero_total`,
a zero price refused by the floor, reason required, free sale by a supervisor and by a cashier
through an override naming both rights, `flag=zero_total`, report counts, and the database
check refusing a free POS sale without a reason); `pnpm test:e2e` 35 passed on the first full run. Existing
checkout tests adapted: the 100 % discount case now gives a reason and checks the flags, the
price-override case gives a reason and expects the above-limit flag and the reason in the audit
entry.

### Results after remediation session 7 (2026-10-13, local run)

`pnpm verify` green (173 unit/web tests, including the micro-precision average cases in
`quantity.test.ts` (fractions of a fils kept, negative basis absorbed, previous average kept
while still negative) and the new `returns.test.tsx` (held returned goods listed, disposal
recorded with a mandatory note)); `pnpm test:integration` 193 passed, including the three new
cases in `inventory-valuation.int.test.ts` (saffron by the gram averaged at 2.5 fils exactly and
issued at that cost; negative rice valued at its basis then absorbed by a receipt so the
roll-forward closes with zero rounding; items without cost listed; closing stock as at yesterday
and today reconstructed from the ledger with matching roll-forward; an online reservation shown
per item and in total; damaged return kept out of stock by default with a held custody record,
"changed mind" restocked, disposal by a cashier refused, note required, recorded once, audited;
the removed "customer return" reason refused); `pnpm test:e2e` 35 passed on the first full run.
Existing valuation and report expectations unchanged (positive balances value identically).

### Results after remediation session 6 (2026-10-13, local run)

`pnpm verify` green (171 unit/web tests, including the new `transfers.test.tsx`: in-transit
summary with age, value and the pending-loss badge, the loss list on the transfer with the
approve / reject dialog, and the recall dialog that needs a reason; the controls fixture carries
`pendingTransferLosses` and `unresolvedTransferShortages`); `pnpm test:integration` 190 passed,
including the three new cases in `transfers-controls.int.test.ts` (small shortage written off at
once as TL-000001 with the receiver's note and its value; large shortage held pending with the
quantity still in transit, valued and aged, checklist counts, destination manager and claimant
refused, rejection needs a reason and reopens the shortage, `LOSS_DECIDED`, re-claim, one pending
loss at a time, approval by the source manager closes the shortage, purchasing report written-off
quantity and value, inventory report `transfer_loss` line and in-transit block, audit actions,
surplus refused without a note and recorded with one as a negative discrepancy; dispatch of an
item with no cost refused with `COST_UNKNOWN`; in-transit value and report KPI, recall refused
without a reason or from the destination, recall returns the goods to the source at dispatch
cost and makes the transfer final); `pnpm test:e2e` 35 passed on a clean run. Existing tests
adapted: over-receipt is a surplus needing a note (was refused), the received transfer carries
its posted loss; `purchasing.spec` checks the transfer loss on the page and uses the new
difference label; `refunds.spec` now waits for the sale to reload after a refund before typing
the exchange quantity (a race that produced timeouts under the parallel full run in sessions 5
and 6).

### Results after remediation session 5 (2026-10-13, local run)

`pnpm verify` green (169 unit/web tests, including the blind count sheet that hides the book
quantity, lists the stock that moved since the sheet was opened and posts only once the counter
acknowledges it, and the pending-adjustment detail page with its approve / reject dialog; the
POS settings fixture carries the two new policy fields, the controls fixture
`pendingAdjustments`); `pnpm test:integration` 187 passed, including the three new cases in
`inventory-controls.int.test.ts` (ADJ numbering, documents within the limit posted at once,
above it held pending with nothing moved, list filter and checklist count, self-approval and
cashier refused, owner approval posting the movements attributed to the requester,
`ADJUSTMENT_DECIDED` on a second decision, withdraw by the requester only, rejection needs a
note, owner override flagged in the audit log, company limit change through the selling policy
and exposed through inventory settings, increase without the price right valued at the average
and a typed cost refused; count sheet reporting `STOCK_MOVED_SINCE_COUNT` with the net quantity
and posting against the current balance once acknowledged; `STOCK_ON_HAND` on tracking off,
goods → service, variant removal and archiving while stock remains, archiving after a write-off,
archived item counted but not increased, `BRANCH_IN_USE` naming stock, then cash, then cash in
transit, and deactivation once settled); `pnpm test:e2e` 35 passed on a clean run (a first run
had one 30-second timeout in `refunds.spec` at the POS search box, unrelated to this session,
which passed alone and on the repeated full run).

### Results after remediation session 4 (2026-10-13, local run)

`pnpm verify` green (167 unit/web tests, including the deposit dialog with its mandatory slip
number, the deposits-in-transit list with the confirm / return dialog, and the bank
reconciliation dialog that ticks statement entries, shows the cleared balance and the
difference and demands an explanation before saving; overview and checklist fixtures carry
`depositsInTransitTotal`, `depositsInTransit` and `unreconciledBankEntries`);
`pnpm test:integration` 184 passed, including the three new cases in `bank.int.test.ts`
(manager deposit refused without a slip number, lands in transit, treasury down and bank
unchanged, overview and checklist counts; confirmation by another treasurer with a bank
reference, `DEPOSIT_SETTLED` on a second attempt, self-confirmation refused, return to the
treasury needs a reason, owner override flagged in the audit log, custody without the deposit
right refused; POS deposit needs the slip, waits in transit and reaches the bank on the owner's
confirmation; reconciliation state, balanced reconciliation of two entries, double tick
refused, unexplained difference refused and explained one recorded with history and audit,
`ACCOUNT_IN_USE` on deactivating a bank with a balance, an idle bank deactivated, a bank with
a deposit in transit refused, cashier refused); `pnpm test:e2e` 35 passed (`cash-payouts.spec`
now waits for the slip number, confirms the deposit in the bank from the custody page and
reconciles the bank account to a balanced statement). Existing tests adapted: deposits carry
a slip reference and expect the transit account instead of the bank.

### Results after remediation session 3 (2026-10-13, local run)

`pnpm verify` green (165 unit/web tests, including the treasury payout-request approval dialog
and the follow-up-of-differences tab with its resolve dialog; POS and purchasing fixtures carry
the new policy fields and `paidToDate`); `pnpm test:integration` 181 passed, including the two
new cases in `cash-payouts.int.test.ts` (treasurer payments within and above the limit, receipt
required, `APPROVAL_REQUIRED`, request → list → self-approval refused → rejection needs a reason →
approval by another treasurer pays from the treasury, withdraw by the requester only, owner
override flagged in the audit log, checklist count; overpayment of a purchase order refused,
owner-confirmed and audited, paid to date net of a reversal), the POS case in
`shifts.int.test.ts` (expense above the limit held with its category and reference, posted as
a disbursement on approval) and `cash-variances.int.test.ts` (shift-close and treasury-count
differences listed from their sources with the accountable person, explained by a branch
manager, settled only with custody, resolved filter, checklist count, audit, cashiers refused);
`pnpm test:e2e` 35 passed. Existing tests adapted: every settings helper sends the two
approval limits; the treasury "more than it holds" case carries a receipt reference.

### Results after remediation session 2 (2026-10-13, local run)

`pnpm verify` green (163 unit/web tests, including the POS pending cash-out flow with withdraw
and the limit warning, the manager decision dialog and the dashboard controls checklist);
`pnpm test:integration` 177 passed, including the three cash-out control cases in
`shifts.int.test.ts` (corrections bound to a posted "other" movement up to what is left;
pending above the per-movement and per-shift limits, withdraw, close refused, approval by a
manager only — never the requester —, rejection needs a reason, owner override flagged on the
movement and in the audit log, forced close rejects pending requests; tolerance cap on register
save and the note on a visible closing difference) and `controls.int.test.ts` (Treasurer template
with least privilege, checklist: treasurer, members without roles, registers above the tolerance
cap, permission); `pnpm test:e2e` 35 passed (`shifts.spec` now explains the closing shortage).
Existing tests adapted: `cash-reports` uses an "other" cash-out instead of a free correction;
`reports` and `shifts.spec` add a closing note; `auth` expects the Treasurer template.

### Results after remediation session 1 (2026-10-13, local run)

`pnpm verify` green (160 unit/web tests, including `audit.test.tsx` — merchant audit log page,
details summary, nav visibility — and the two blind-count cases in the POS `app.test.tsx`);
`pnpm test:integration` 173 passed, including `audit.int.test.ts` (own-company events with
who/what/when and before/after values, isolation from another company, local-day period, record
type and pagination filters, `audit.read` for company managers only) and the blind-count case in
`shifts.int.test.ts` (no expected balance for cashiers, open without `expectedCash`, summary
withheld, supervisor sees the figures, closing reveals them, between-shift difference booked
without a note, policy switched off restores the stale-balance and note rules); `pnpm test:e2e`
35 passed (`checkout.spec` and `refunds.spec` assert the blind notice and read the drawer
figures through the manager API). Fixtures that read drawer figures through cashier sessions
call `showExpectedCash()`.

### Results after cash custody phase C (2026-10-12, local run)

`pnpm verify` green (155 unit/web tests, including the dashboard cash card);
`pnpm test:integration` 171 passed, including `cash-reports.int.test.ts` (cash by type, expenses
report with reversals, discrepancy sections by close type, between shifts and after an uncounted
close, uncounted shifts in the shift report); `pnpm test:e2e` 35 passed (`cash-payouts.spec` now
also checks the expenses report, cash by type and the dashboard total).

### Results after cash custody phase B (2026-10-12, local run)

`pnpm verify` green (154 unit/web tests, including the manager expense dialog);
`pnpm test:integration` 170 passed, including `cash-payouts.int.test.ts` (POS expenses and
supplier payments as outflows, reversal, treasury payments with purchase orders, `cash.deposit`
required for deposits, branch transfers with a receiving difference, cancel, branch scoping,
append-only and posting rules); `pnpm test:e2e` 35 passed (`cash-payouts.spec` covers an expense,
a deposit, a branch transfer and a supplier paid from the drawer).

### Results after cash custody phase A (2026-10-12, local run)

`pnpm verify` green (153 unit/web tests); `pnpm test:integration` 163 passed, including
`cash.int.test.ts` (drawer across shifts, drops/top-ups, manager transfers and permissions,
parallel transfers never overdraw, refund from another register, forced close with and without
a count, cutover, database rules); `pnpm test:e2e` 34 passed (`shifts.spec` counts the
treasury, runs a shift with a drop and a top-up and checks both balances).

### Results after Prompt 18 — final audit (2026-10-12, local run)
- `pnpm verify` ✓ (150 unit/web), `pnpm test:integration` ✓ (153), `pnpm test:e2e` ✓ (33).
- New regression tests, each verified to **fail** with the defect put back:
  - `hardening.int.test.ts` (5): a client `X-Forwarded-For` does not change the recorded
    IP; 5 wrong TOTP codes from fresh IPs/tickets block the operator (even the right code
    → 429); POS lock → every request `SESSION_LOCKED`, wrong password refused, right one
    unlocks, both audited, 5 wrong passwords end the session, "someone else" ends it;
    runtime role cannot call platform summaries without an operator context nor insert or
    update operators.
  - `ecommerce.int.test.ts` (+2): payment succeeding after cancel and after a reported
    failure → recorded, order needs attention, no sale; 3 online payments + 2 POS sales of
    the same item at once → all succeed, stock exactly 0, 5 sales (stable over 3 runs).
    Profit stays available with a delivery fee (cost 2.000, profit 4.750).
  - `refunds.int.test.ts`: an exchange naming the same line twice → 400 (was 500).
  - `restaurant.int.test.ts`: another merchant's variant in a modifier → 400.
  - Unit: production refuses development secrets; `TRUST_PROXY` parsing; URL redaction.
  - Web: POS lock screen (wrong/right password, sign in as someone else).
- Independent audits (security, financial integrity, transaction reliability,
  architecture): live reconciliation of the dev database (3,082 sales, 29 refunds, 12
  shifts, 11,278 movements) found 0 mismatches except the delivery-fee profit defect
  (fixed). Lint and typecheck clean; i18n key parity in every app.

#### Measured performance (production build, 1 API process, PostgreSQL 18 in Docker, 4 vCPU)
`node scripts/perf/load-test.mjs --products 5000 --sales 20000 --concurrency 16`
(own merchant, 0 failures):

| Operation | Result |
|---|---|
| Create product (16 parallel) | p50 157 ms, p95 242 ms, 98/s |
| Opening stock, 200 lines per document | p50 4.9 s per document (~40 lines/s) |
| POS checkout, 2 lines, one shift, 16 parallel | p50 443 ms, p95 602 ms, p99 689 ms, **35 sales/s** (serialised per shift by design) |
| POS catalog, 5,000 items (1.5 MB) | 206–257 ms (an earlier run right after bulk insert took 6.1 s once: stale planner statistics) |
| Manager products page / search | p50 23 ms / 132 ms |
| Inventory levels page | p50 87 ms |
| Sales list page (23,000 sales) | p50 64 ms |
| Sales report, one day with 20,000 sales | p50 890 ms, p95 1.06 s |
| Inventory report | p50 484 ms |
| Payments report | p50 122 ms |

Backup/restore drill: see OPERATIONS.md §4.

### Results after Prompt 17 (2026-10-12, local run)
- `pnpm verify` ✓ (145 unit/web), `pnpm test:integration` ✓ (146), `pnpm test:e2e` ✓ (33).
- `platform.int.test.ts` (7), security and authorization:
  - Anonymous, owner manager, POS and a manager cookie presented as `plat_sid` all get
    401 on `/platform/*`; an operator cookie gets 401 on manager APIs.
  - Billing cannot suspend; support cannot change subscriptions, close or create plans;
    billing cannot read the audit log or onboard merchants; unknown merchant → 404.
  - Search by name/owner e-mail; wildcard characters are plain text; usage counts
    (branches, employees, registers) and onboarding facts.
  - A merchant sees only its own subscription; RLS hides other merchants' subscriptions;
    the runtime role cannot update subscriptions or merchant status without an operator
    context, nor delete subscriptions.
  - Suspension (stale version refused): manager and POS sessions end (2 ended), sign-in
    → `MERCHANT_SUSPENDED`, public store 404; audited with operator, reason and session
    count and visible in the merchant's own audit trail; reactivation restores sign-in
    and the store; closing by a super admin is final.
  - Limits: branch, register, 4th invitation, restaurant enable, non-draft store refused
    on the Basic plan; 6 concurrent product creations on a 3-product plan → exactly 3
    created — verified to fail (6 created) without the subscription row lock; archiving
    frees a slot and restoring needs one.
  - Downgrade with 2 branches/registers → `PLAN_CHANGE_BLOCKED` with reasons; upgrade
    fits; past-due status does not block work; history records operator and reason;
    stale version refused.
  - Onboarding: new owner gets a set-password e-mail, cannot sign in before, signs in
    after, sees the chosen plan; an existing account becomes owner keeping its password
    (audited `existingOwnerAccount`).
  - Plans: unique code (case-insensitive), price requires a period, exact price
    `12.500`, one default at a time, the default cannot be unset, overview counts.
- Updated: `auth.int.test.ts` suspension fixture now needs an operator context and
  expects `MERCHANT_SUSPENDED`.
- Web: platform merchants list, suspend dialog (reason required, version sent), support
  vs billing actions, blocked downgrade explained and not savable, plan editor (empty
  limit = unlimited), role-based navigation; manager subscription page (status, usage,
  missing features, plan prices) and permission guard.
- `e2e/platform.spec.ts`: operator created with the CLI signs in with TOTP, finds the
  merchant, moves it to Basic (readiness shown), merchant's second branch refused and its
  subscription page shows 1 / 1; suspension signs the owner out and sign-in shows
  "company suspended"; audit log shows the reason; reactivation restores sign-in.

### Results after Prompt 16 (2026-10-12, local run)
- `pnpm verify` ✓ (138 unit/web), `pnpm test:integration` ✓ (139), `pnpm test:e2e` ✓ (32).
- `ecommerce.int.test.ts` (4): storefront shows only listed products of a published store,
  draft stores are not public, other merchants' products are not reachable; checkout
  re-prices exactly (2 × 1.250 + 0.500 delivery = 3.000), same key → same order, reserved
  stock blocks the POS (5 on hand, 2 reserved: POS sells 3, not 4) — verified to fail when
  the reservation check is removed; signed sandbox webhook → one online sale with the
  delivery line, fee, receipt number and stock deducted once; duplicate and replayed
  notifications change nothing — verified to fail without event de-duplication; invalid
  signature refused; fulfilment steps per pickup/delivery, paid orders cannot be
  cancelled, history in the tracking view; declined/cancelled/wrong-amount payments release
  stock (wrong amount → needs attention, no sale); expiry releases stock and a late
  payment becomes a sale only if stock remains, else needs attention; Tap/UPayments/
  Hesabe/Bookeey refuse with `GATEWAY_NOT_CONFIGURED`; paused store refuses orders;
  branch-scoped and unauthorised managers refused; POS/online split in sales and reports.
- Web: storefront (catalog and sold-out, cart capped at the offered maximum with exact
  totals, minimum order, checkout body and redirect to the gateway, new idempotency key
  after a refused checkout, tracking, sandbox page refuses foreign return URLs); manager
  online page (actions per fulfilment, version sent, settings save, listings).
- `e2e/store.spec.ts`: owner lists a product and publishes the store in the manager; an
  anonymous shopper buys 2 with delivery (3.000), pays on the sandbox page and sees
  "Paid"; stock 5 → 3; manager sees the order and starts preparing; the sales list shows
  it as an online sale and the report's channel table shows the online total.

### Results after Prompt 15 (2026-10-12, local run)
- `pnpm verify` ✓ (126 unit/web), `pnpm test:integration` ✓ (135), `pnpm test:e2e` ✓ (31).
- `restaurant.int.test.ts` (4): table order with required/foreign modifier validation,
  stale version refused, exact due (2 × 2.250 + 0.500); send routes burgers to the
  kitchen and cola to the bar, re-send creates no tickets, no stock moves before
  payment; kitchen display with notes/modifiers, forward-only statuses with timestamps,
  duplicate tap ignored, kitchen creates no sales/payments, cashier cannot change
  tickets; more items later → new ticket; split bill (burgers cash with change, colas
  card + cash), idempotent replay returns the same bill, re-paying refused, order
  closes, revenue = 5.500 exactly once, payments = 5.500; stock bun/patty −2, cheese −4
  (modifier ingredient), cola −2; cost 0.700 per burger; floor free again; sales list
  and report by service type. Move (occupied target refused), combine (unpaid items
  moved, source merged, table freed), cancel unsent (no stock), cashier cannot void sent
  item, supervisor waste deducts ingredients once (adjustment `restaurant_waste`), ticket
  cancelled, cancelled item final, empty order cancelled, order with a paid bill cannot
  be combined, takeaway auto-send on payment. Concurrency: three simultaneous pays of the
  same item → one sale, stock −3 once — verified to fail without the order lock (the DB
  trigger still blocks the double bill, with an error). Access: module off → refused;
  kitchen role cannot take orders; branch manager configures own branch only, not
  merchant-wide items or the switch; recipe on a tracked item refused; duplicate table
  code; another merchant gets 404 on orders, tables and menu.
- Web: POS modifier dialog (required group blocks Add, quantity, request body), bill total
  from the quote; kitchen-only staff land on the kitchen display, ticket shows note,
  modifiers and timer and moves to Preparing; manager module switch and page guard.
- `e2e/restaurant.spec.ts`: manager enables the module and adds area/table in the UI;
  invited cashier opens T1, orders 2 medium burgers with a note and a cola, sends to the
  kitchen; invited kitchen staff (second browser) starts and readies the ticket; cashier
  sees "Ready", pays the burgers in cash (receipt shows the modifier) and the cola by
  card; table free; stock 18/18/19; two dine-in sales totalling 4.500.

### Results after Prompt 14 (2026-10-12, local run)
- `pnpm verify` ✓ (122 unit/web), `pnpm test:integration` ✓ (131), `pnpm test:e2e` ✓ (30).
- `reports.int.test.ts` (8), on a scenario with 3 sales on two branches (cash, card with
  1.5 % fee, sale discount), a restocked refund, cash in/out and a short shift close:
  every sales figure exact (gross 6.666, discounts 0.166, net 6.500, refunds 1.000,
  average 2.167, items 8) and equal to the sales history; all breakdowns (branch,
  employee, method, product, category, day, hour) sum to the total; gross profit 3.300 /
  60.0 %; employee filter; local day boundaries (a sale at 00:30 Kuwait time on the 11th
  is the 11th, not the 10th) and previous-period comparison — verified to fail when the
  time zone is ignored; profit hidden when a cost is missing; payments: collections,
  fees equal to the stored sale fees (0.023 + 0.030), pay-outs, net cash 5.000 and the
  shift report equal to the shift's own record (expected 15.000, counted 14.750,
  −0.250 short); inventory valuation 23.600 / 7.200 equal to stock levels, movements,
  adjustments, product quantities; purchasing summary, suppliers, receipts, transfers
  with missing quantity and value; access: branch manager limited to their branch, no
  profit, no financial reports, explicit other-branch filter refused — verified to fail
  without the branch filter; company manager consolidated; no report permission → 403;
  POS session → 401; other merchant's branch → 404, employee → 404; invalid periods →
  400.
- Web: permitted tabs only, KPI change (+30.0 %), "no previous data", CSV export equal to
  the table (BOM, headers, plain decimals); page denied without report permissions;
  CSV cell escaping and injection guard; period change and date presets.
- `e2e/reports.spec.ts`: two real POS sales → net sales 3.750, gross profit 2.250, chart,
  downloaded CSV row equals the table, yesterday empty, collections 3.750 and cash 2.500,
  stock value 3.500.

### Results after Prompt 13 (2026-10-12, local run)
- `pnpm verify` ✓ (118 unit/web), `pnpm test:integration` ✓ (123), `pnpm test:e2e` ✓ (29).
- `customers.int.test.ts` (5): profile create/normalise/duplicate phone in another
  format/search by name, phone digits, code/wildcards escaped/edit with version/stale
  version/deactivate/notes newest first; audit log without personal data; notes and
  customers cannot be updated/deleted by the runtime role; POS: create basic profile,
  basic fields only, search, sale with customer (sale + receipt), walk-in, held cart
  keeps the customer, inactive customer refused with nothing sold; till permissions
  (no search/create/attach without the permission; walk-in still works) — verified to
  fail when the till permission check is removed; history: 3 sales across two branches,
  one refund → exact totals, net 1.750, average 0.667 (half-up), exchange stays with the
  customer, second-branch manager sees only that branch; tenant isolation (API and RLS).
- Web: manager customer detail (stats, history, add note; read-only hides edits); POS
  create-at-till → checkout carries `customerId` → receipt shows the customer.
- `e2e/customers.spec.ts`: manager creates a profile with a note; invited cashier sells to
  her by phone search, sells to a walk-in, registers a new customer at the till; manager
  list, search, detail totals and sales list reflect it exactly.

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
