---
name: pos-selling-rules
description: Server-side rules for POS checkout, held carts, supervisor overrides, voids, refunds and exchanges (SalesService.completeSaleInTx, OverridesService, RefundsService). Use when changing or debugging POST /pos/sales, /pos/overrides, /pos/orders, /pos/refunds, /pos/exchanges, /pos/sales/:id/void, refund approval, discount/price-change limits, zero-total sales, reprints or cart-clear logging.
---

# POS selling rules on the server (sales, overrides, refunds)

Read first: ADR-0100 and ADR-0101 in `docs/DECISIONS.md`, BR-177…BR-184 in `docs/BUSINESS_RULES.md`.
The selling decisions themselves live in `packages/pos-core` and are shared with the till: see the
`device-app` skill for pos-core internals and the "change rules in pos-core, not only in a service" rule.
Schema changes: `new-migration` skill. Running tests: `run-tests` skill.

## Where the code is

- `apps/api/src/modules/sales/sales.service.ts` — `checkout`, `completeSaleInTx` (POS),
  `completeOnlineSaleInTx` (online, no shift; see `online-store` skill), `suspend` / `suspended` /
  `expireHeld` / `cancelSuspended`, `recordCartEvent`, `reprint`, `replay`.
- `apps/api/src/modules/sales/overrides.service.ts` — `request` (`POST /pos/overrides`), `authority`, `spend`.
- `apps/api/src/modules/refunds/refunds.service.ts` — `create`, `preview`, `voidSale`, `exchange`,
  `approve` / `reject` / `cancel`, `execute`, `creditOrigins`, `recordDeviceRefundInTx` (device sync).
- Controllers: `sales/sales.controller.ts` (`/pos/*`, `/manager/sales*`), `refunds/refunds.controller.ts`.
- Contracts: `packages/contracts/src/sales.ts`, `packages/contracts/src/refunds.ts`.
- Rules: `packages/pos-core/src/sale.ts` (`createRightCheck`, `assertSellingRights`, `evaluateSale`,
  `requiredSaleRights`, `exchangeCreditUsed`), `overrides.ts`, `payments.ts` (`checkPayments`),
  `refunds.ts` (`computeRefund`, `paybackAllocation`, `refundApprovalReasons`, `assertVoidable`).
- Always call a pos-core rule through `rules(() => …)` (`apps/api/src/kernel/errors/pos-rule.ts`): it maps
  `PosRuleError` to `AppError` with the same status/code/message/issues. Never re-implement a rule in the service.

## Order vs Sale (CLAUDE.md §7, DATABASE.md §5)

- `orders` is the mutable intent (status `suspended | completed | cancelled | expired`, `sales.schema.ts`).
- `sales`, `sale_lines`, `payments` are immutable: `REVOKE UPDATE, DELETE … FROM app_runtime`
  (`apps/api/drizzle/0014_sales_rls.sql`). Corrections are new `refunds` rows (kind `refund | void | exchange`),
  never edits. Final refund states are immutable by trigger (`0016_refunds_rls.sql`).
- Lines snapshot names, SKU, list / regular / unit price, `product_discount_id`, cost and reason at sale time.

## One transaction per sale (`checkout` → `completeSaleInTx`)

Everything below runs in one `withMerchantTx`; any throw rolls all of it back (CLAUDE.md §3.12):
1. `shifts.lockOwnShift` — the cashier's own open shift, locked (one checkout at a time per shift).
2. Customer (`resolveSaleCustomer`), override authority, rights (`assertSellingRights`).
3. `loadItems` re-prices from the catalog (price in force incl. product discounts, ADR-0133; `pos_visible`,
   ADR-0130). Client prices are never trusted; `expectedTotal` mismatch → `409 TOTAL_CHANGED`.
4. `evaluateSale` (bounds, limit, zero total) → `preparePayments` (`checkPayments`: exact cover, references, BR-181).
5. `completeOrder` (complete a held order or create a completed one) → `nextReceiptNumber` (gap-free per branch).
6. Stock only via `stockConsumption` + `StockLedgerService.apply` (movement `sale`, ADR-0074).
7. Insert sale, lines, modifiers, payments; cash into the register drawer, others into the method's account,
   only via `postEntries` from `payments/cash-ledger.ts` (ADR-0090). Card fees are `fee` entries; cash never has a fee.
8. `overrides.spend`, `audit.recordIn('sale.completed' | 'sale.completed_exchange')`,
   `printJobs.queueAutoInTx` (ADR-0111; must never fail the sale).
- Callers of `completeSaleInTx`: `checkout`, `refunds.service.ts` `exchange`, `restaurant/restaurant-orders.service.ts`.
  A new caller must lock the shift first and pass the same args shape.

## Idempotency

- Checkout, refund, void and exchange take a client `idempotencyKey` (uuid). The request hash is
  sha256 of the input without the key. `replay` returns the first result; same key + different hash →
  `409 IDEMPOTENCY_CONFLICT`. A concurrent duplicate hits the unique index (`orders_idempotency_key`,
  `refunds_idempotency_key`) and is answered by a second `replay` (`isUniqueViolation`). Keep this pattern.

## Rights and supervisor overrides (ADR-0100, BR-177)

- Rights are checked at completion inside `completeSaleInTx`, not when parsing or holding a cart
  (holding a discounted cart needs no right).
- `createRightCheck`: cashier's own right first, else the grant; `supplied` records what the grant lent.
- Overridable: `sales.discount`, `sales.discount.override_limit`, `sales.price_override`, `sales.zero_total`.
- `POST /pos/overrides`: supervisor's e-mail + password on the cashier's session, sign-in throttles,
  refusals audited (`sale.override_refused`); never for oneself (`OVERRIDE_SELF`); grant lists only rights the
  supervisor holds at the branch and the cashier lacks (`OVERRIDE_NOT_ALLOWED` if none); valid 10 minutes
  (`GRANT_MINUTES`), bound to cashier membership, shift and branch.
- The sale passes `overrideId`; `spend` marks it `used` once with `kinds` (trigger `sale_overrides_use`); the sale
  stays on the cashier's shift and drawer and stores `override_id`.

## Price changes, discount limit, free sales (`evaluateSale`)

- Discount needs `sales.discount`; any entered price needs `sales.price_override` (`assertSellingRights`).
- Changed price: reason required (`REASON_REQUIRED`) and within `price_override_floor_percent` /
  `ceiling_percent` / not below cost unless `price_override_below_cost` (`PRICE_OUT_OF_BOUNDS`) — hard
  limits for everyone, not overridable (BR-178).
- Combined limit per line (D4, BR-183): line discount + allocated sale discount + list-price gap vs list gross;
  zero price is always above the limit. Above → needs `sales.discount.override_limit`; stored as `sales.above_limit`
  and `discount_limit_percent`.
- Total 0 → `sales.zero_total` (`ZERO_TOTAL_DENIED`) and `zeroTotalReason` (stored; DB check, BR-179).
- Keep `requiredSaleRights` (POS mirror) in step with `evaluateSale` when changing any of this.

## Held sales, reprints, cleared carts (ADR-0101, BR-182)

- `sales_settings.held_sale_expiry_hours` (default 24, 0 = never): `suspended()` calls `expireHeld` first
  (`status = 'expired'`, audit `order.expired`). Completing a held order keeps the held lines and records who completed it.
- Reprint: `POST /pos/sales/:id/print` → `reprint` → `printJobs.queueCopyInTx` (numbered copy) + audit `sale.reprinted`.
- `POST /pos/cart-events` → `pos_cart_events` + audit `cart.cleared` / `cart.line_removed`, only at or above
  `cart_clear_log_threshold`.

## Refunds, voids, exchanges (`refunds.service.ts`)

- Per sale, serialize with `lockSale` (`pg_advisory_xact_lock`); refundable amounts count `pending_approval`,
  `processing`, `completed` refunds (`ACTIVE`). Line amounts are cumulative so partials sum to the net exactly.
- `refundApprovalReasons` (BR-180): `over_limit`, `outside_window`, `own_sale` (requester rang the sale up and
  `refund_own_sales_need_approval` is on). Holding `refunds.approve` exempts nobody; only the owner completes
  directly (`owner_override = true`). Otherwise status `pending_approval`; `approve` refuses the requester
  (`SELF_APPROVAL`) and re-points pending cash to the approver's open shift (`repointShift`, else `SHIFT_REQUIRED`).
- Exchanges with approval reasons are refused at once (no waiting) unless the owner does them.
- Exchange credit paid back goes to the original sale's tenders pro rata (`creditOrigins`, up to 3 hops, cash fallback).
- Non-cash pay-back needs a settlement account (`SETTLEMENT_ACCOUNT_REQUIRED`) and, with
  `require_tender_reference`, a reference (`REFERENCE_REQUIRED`); fee comes back only under `refund_fee_policy = reverse` (D6).
- `execute`: restocked lines through `StockLedgerService.apply`; non-restocked tracked lines become `damaged_returns`;
  gateway pay-backs stay `pending` and the refund `processing` until confirmed — never assume "completed".
- Void (`POST /pos/sales/:id/void`, `sales.void`): only a sale of the cashier's own open shift with no active refunds
  (`assertVoidable` → `NOT_VOIDABLE`); full refund, restock all, audit `sale.voided`.
- Reporting: a refund belongs to its completion day (`coalesce(completed_at, created_at)`), cut through
  `apps/api/src/kernel/time/period.ts` (ADR-0102, BR-184). Never filter refunds on `created_at` alone.

## Tests

- Integration: `apps/api/src/modules/sales/sales.int.test.ts`, `sales-controls.int.test.ts` (D4, held, reprints,
  cart events), `sales-overrides.int.test.ts` (BR-177/178/179), `refunds/refunds.int.test.ts`,
  `refunds/refunds-controls.int.test.ts` (BR-180/181).
- Fixtures where one person sells and refunds must call `allowOwnSaleRefunds()` (`apps/api/src/testing/auth-fixtures.ts`);
  do not switch it on in tests of the rules themselves.
- Rules: `packages/pos-core/src/pos-core.test.ts`. E2E: `e2e/checkout.spec.ts`, `e2e/refunds.spec.ts`, `e2e/pos.spec.ts`.
- Example: `pnpm exec vitest run --project integration apps/api/src/modules/refunds -t "segregation"`.
  Rebuild packages (`pnpm build:packages`) after editing pos-core/contracts before integration tests.
