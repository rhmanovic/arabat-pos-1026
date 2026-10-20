# Roadmap & Milestone Acceptance Criteria

Delivery is organized as **functional vertical slices** (DB → API → UI → tests →
docs). A milestone is done only when **all** its acceptance criteria are met
and verified by automated tests that were actually run. Order may change with
owner priorities. Open questions that block a milestone are listed with it.

Global "Definition of Done" for every slice:
- Migrations with RLS policies for every new merchant table.
- Every endpoint declares a permission (or `@Public`) — boot check passes.
- Unit + integration tests green; isolation and authorization tests for new
  endpoints; E2E for the main happy path.
- UI works in Arabic (RTL) and English (LTR).
- Lint, typecheck, build green. Docs updated (`PROGRESS.md`, `DATABASE.md`, …).

---

## Phase 1 — Documentation foundation ✅
- [x] Project instructions and documentation structure (Prompt 1)
- [x] System architecture design (Prompt 2)

## M0 — Engineering foundation ✅ (2026-10-11)
Scope: monorepo, API skeleton, DB tooling, three SPA shells, money package, CI.

Acceptance criteria:
1. `pnpm install && pnpm build` succeeds from a clean clone on Node 24.
2. `docker compose up` starts PostgreSQL 18 (Mailpit moved to M1); `pnpm db:migrate`
   applies migrations using `app_owner`; API connects as `app_runtime`.
3. `GET /api/v1/health/ready` returns 200 with DB status (503 when the DB is down);
   `GET /api/v1/health/live` for liveness.
4. `/manager`, `/pos`, `/platform` load as **three separate bundles**, each with
   its own layout; switching AR/EN flips `dir` correctly.
5. `packages/money` passes tests for KWD 3-decimal add/subtract/multiply,
   half-up rounding, allocation without lost fils, string (de)serialization,
   amounts > 2^53 minor units.
6. A route without a permission declaration makes the API boot fail (test).
7. `withMerchantTx` sets `app.merchant_id`; an RLS test proves rows of
   another merchant are invisible with a raw query.
8. CI workflow runs lint, typecheck, unit, integration (PostgreSQL), build.

Status: criteria 1–7 verified locally by automated tests; criterion 8 — workflow
written, first GitHub run pending. Details in `PROGRESS.md`.

## M1 — Identity, merchants, branches, roles & access
Blocked by: OQ-010 (merchant sign-up path), OQ-006 (POS login style; e-mail +
password used until decided).

Acceptance criteria:
1. Platform operator (MFA) can create a merchant with its owner; owner receives
   an invitation (Mailpit locally).
2. Owner logs into `/manager`, creates branches, roles (from templates) and
   invites employees with branch-scoped role assignments.
3. A Cashier-only employee: can log into `/pos` at assigned branch; **is refused
   at `/manager`** (UI and every `/api/v1/manager/*` endpoint → 403).
4. A Manager without `pos.access` is refused at `/pos`; after the owner grants
   `pos.access` at branch A, they can use POS at A only.
5. A user with assignments at branch A cannot read or act on branch B data.
6. Merchant sessions get 401/403 on all `/api/v1/platform/*`; operator sessions
   get 401/403 on merchant endpoints.
7. Deactivating an employee revokes their sessions immediately.
8. Owner cannot be removed/demoted; a user cannot grant permissions they lack.
9. Suspending a merchant blocks all its users.
10. Audit log records logins, failed logins, role & assignment changes,
    invitations, deactivations.
11. Tenant isolation suite covers every M1 table and endpoint.

## M2 — Catalog
Acceptance criteria:
1. Manager CRUD for categories, products (with ≥1 variant), barcodes, branch
   prices, tax rates; bilingual names.
2. SKU and barcode unique per merchant; conflicts return clear errors.
3. POS endpoint returns the branch catalog snapshot; barcode lookup in the POS
   UI resolves locally in < 50 ms for 10k items (measured in test).
4. Optimistic locking prevents lost updates (409 test).
5. Prices are entered/displayed with exactly 3 decimals for KWD.

## M3 — Inventory
Acceptance criteria:
1. Opening stock, adjustments (with reason), and branch transfers create
   append-only `stock_movements`; `stock_levels` always equals the ledger sum
   (property test).
2. Concurrent adjustments on the same item do not lose updates.
3. Permissions `inventory.adjust` / `inventory.transfer` enforced per branch.
4. Low-stock view per branch.

## M4 — POS selling: registers, shifts, sales, payments
Blocked by: OQ-002 (tax), OQ-003 (cash rounding), OQ-007 (rounding rule),
OQ-009 (receipt content).

Acceptance criteria:
1. Manager creates registers per branch; cashier opens a shift with an opening
   float; one open shift per register.
2. Cashier scans/selects items, applies permitted discounts, takes cash (with
   change) and manual card tenders, split payments.
3. Completing a sale writes sale, lines (snapshots), payments, stock movements
   and cash movement in **one transaction**; any failure rolls back everything
   (test with injected failure).
4. Retried submission with the same `Idempotency-Key` returns the same sale,
   never a duplicate.
5. Server totals equal POS preview totals for a randomized test corpus;
   server value is authoritative.
6. Gap-free receipt numbers per branch under concurrency.
7. Discount above limit / price override requires permission or manager
   override token; audited.
8. Shift close: counted cash vs expected, variance recorded; X/Z summary.
9. Bilingual printable receipt (browser print); no live payment gateway.
10. Hold/recall cart via orders module.

## M5 — Refunds, voids, customers
Acceptance criteria:
1. Refund against a sale's lines; refundable quantity/amount never exceeded
   (BR-035), including concurrent refunds.
2. Optional restock creates stock movements; refund tenders recorded in the
   current shift.
3. Void allowed only within the open shift and with `sales.void` or override.
4. Customers CRUD; attach customer to sale; customer purchase history.

## M6 — Purchasing
Acceptance criteria:
1. Suppliers, purchase orders, partial goods receipts that increase stock and
   record unit cost.
2. Receiving permissions enforced per branch; audit trail.

## M7 — Reporting
Acceptance criteria:
1. Sales by day / branch / cashier / product / payment method; shift reports;
   inventory on hand and valuation.
2. Report totals reconcile exactly (to the fils) with underlying sales and
   refunds (reconciliation tests).
3. Results limited to accessible branches.
4. CSV export.

## M8 — Platform administration & subscriptions
Status: implemented without billing (Prompt 17). Billing blocked by OQ-022.

Acceptance criteria:
1. Plans with features/limits; assign plan to merchant; feature gates enforced
   by the backend (`PLAN_FEATURE_UNAVAILABLE`, `PLAN_LIMIT_REACHED`).
2. Merchant list, detail, suspend/reactivate; platform audit log.
3. Platform metrics (merchants, active branches, sales volume) without exposing
   merchant line-level data.
4. No live billing/payment collection without approval.

## M9 — Restaurant operations (feature-gated)
Acceptance criteria:
1. Dining areas/tables, open tabs as orders, modifiers, split bill.
2. Kitchen tickets per order (screen view; printer later).
3. Closing a table produces a normal sale via `SalesService` (no duplicated
   sale logic).

## M10 — E-commerce (feature-gated)
Status: implemented with the sandbox gateway (Prompt 16). Live payments blocked by
provider approval and credentials (OQ-021). The owner approved a ten-phase plan on 2026-10-20
(`docs/ONLINE_STORE_PLAN.md`): **Phase 1 ✅ (ADR-0118)** — orders paid on receipt without any
gateway, store address first-class; **Phase 2 ✅ (ADR-0119)** — the online store console at
`/online`, separate from the POS management app, over the same backend; Phase 3 (separate online
payment methods) cancelled by the owner on 2026-10-20; **Phase 4 ✅ (ADR-0121)** — store
titles, order, featured, store categories with pictures, logo / banner, gallery, sorting (no online
price: one catalog price); next: Phase 5 (delivery areas, pickup branches, notifications, printing).

Acceptance criteria:
1. Channel listings from catalog; online orders enter the orders module.
2. Stock reservation/decrement consistent with POS stock.
3. Fulfilment status visible in manager; conversion to sale on payment.

## M11 — Cash custody (ADR-0090)
- **Phase A ✅ (2026-10-12):** register and branch treasury balances, cutover, shift open/close
  counts, forced close with or without a count, manager counts, register ↔ treasury transfers,
  `cash.custody`, manager cash page.
- **Phase B ✅ (2026-10-12):** cash disbursements (expenses by category, supplier payments linked to a supplier,
  reversals), `cash.deposit` and bank deposits, branch-to-branch transfers via in-transit with
  receipt confirmation, supplier payments on the supplier page.
- **Phase C ✅ (2026-10-12):** cash report categories, expenses and supplier payments reports, discrepancy report
  sections (close type, after an uncounted forced close, between shifts), dashboard total-cash card.

## M12 — Global self-service readiness (ADR-0109)
Status: planned. Region-specific work starts once the first focus region is chosen (OQ-027).

Acceptance criteria:
1. **Currency per merchant:** chosen at registration from `currencies` (with its exponent); no
   hard-coded `'KWD'` left in services, reports, receipts or the storefront; tests with exponent
   0, 2 and 3 currencies.
2. **Region profile at registration:** country, currency, time zone, default language, number
   format — defaulted from the country, changeable under the existing rules (BR-184).
3. **Tax:** configurable tax rates per merchant (inclusive / exclusive pricing), per-line half-up
   rounding (BR-033), tax shown on receipts and reports; zero tax remains the Kuwait default.
4. **Trustworthy self sign-up:** e-mail verification (OQ-025), abuse protection (rate limits,
   captcha-ready hook), guided onboarding checklist (first branch, products, register, first sale).
5. **Online subscription:** trial, plan selection and payment through a billing provider, invoices,
   failed-payment retries, grace period and lapse behaviour (OQ-022) — sandbox first, live only with
   the owner's approval.
6. **Public site:** landing, pricing per region, sign-up, help centre built from the user guide;
   Arabic and English, other languages additive.
7. **Operations:** hosting region per wave, data residency notes, status page, backups (OQ-011).

## Later / to be decided
Offline POS (OQ-005), loyalty, PIN quick switch (OQ-006), card terminal / KNET
integration (OQ-013), country e-invoicing / fiscal receipts per focus region (decided per wave).
