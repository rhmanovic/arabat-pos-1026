# @arabat/pos-core

The selling rules of the Arabat POS as pure TypeScript (ADR-0112,
`docs/adr/ADR-0112-local-first-pos.md`). The API (`apps/api`) calls these functions for every
sale, shift, cash movement and refund; the local-first device app must call the same functions so
a decision on the device is the decision the server would have taken.

- **No framework, no database, no Node-only API** (compiled with `"types": []`): it runs in Node,
  in a browser and in a web view.
- **Inputs are plain data**: parsed cart lines, the company's settings, a catalog snapshot,
  a "may the person at the till use this right" callback. The caller loads the data (the server
  from PostgreSQL, the device from its local SQLite) and keeps all side effects.
- **Refusals are `PosRuleError`** with the API's `status`, `code` (`ErrorCode` from
  `@arabat/contracts`), `message` and optional `issues` (`{ path, code, message }`). The server
  turns them into the same HTTP problem response as before; the device shows `code` / `message`.
- **Money** is `bigint` in fils (KWD, 3 decimals: `1.250` → `1250n`); **quantities** are
  `bigint` thousandths (`"2"` → `2000n`, see `parseQuantity` in `@arabat/money`). Never floats.
- Dependencies: `@arabat/money` (pricing, fees, quantities) and `@arabat/contracts` (types, the
  list of overridable permissions). Permission checks are passed in as callbacks so the device can
  evaluate them from its downloaded staff permissions (`can()` in `@arabat/permissions`).

Run the tests: `pnpm vitest run --project unit packages/pos-core`.

## Public API

### Errors and amounts (`errors.ts`, `amounts.ts`)

| Export | Purpose |
|---|---|
| `class PosRuleError { status, code, message, issues? }` | Every refusal. `PosRuleError.validation(issues)` = 400 `VALIDATION_FAILED`. |
| `POS_CURRENCY` | `'KWD'`. |
| `parseAmount(value, path): bigint` | `"1.250"` → `1250n`; more than 3 decimals → 400 `INVALID_PRICE` at `path`. |
| `toDiscount(input, path): Discount \| null` | A `DiscountInput` (contracts) → the pricing form (`{ type: 'percent', percent }` or `{ type: 'amount', amountMinor }`). |

### Sale (`sale.ts`)

Call in this order for a sale (the server's order, so refusals match):

1. `createRightCheck(cashierHolds, grant)` → `{ allowed, supplied }`. `cashierHolds(permission)`
   answers from the cashier's own rights at the branch; `grant` is the supervisor override's
   rights (or null). `supplied` collects the rights the grant actually provided (record them with
   the sale).
2. `assertSellingRights(lines, orderDiscount, allowed)`: any discount needs `sales.discount`
   (403 `DISCOUNT_LIMIT_EXCEEDED`), any entered price needs `sales.price_override`
   (403 `PRICE_OVERRIDE_DENIED`).
3. `evaluateSale({ lines, orderDiscount, catalog, policy, allowed, zeroTotalReason, expectedTotalMinor })`
   → `{ priced, aboveLimit }`:
   - a variant missing from `catalog` → 409 `ITEM_UNAVAILABLE` (issues per line);
   - pricing errors (`PricingError` codes from `@arabat/money`) → 400;
   - a changed price needs a reason (400 `REASON_REQUIRED`) and must respect the floor %, the
     ceiling % and, unless allowed, the cost (400 `PRICE_OUT_OF_BOUNDS`);
   - combined discount per line above `policy.maxDiscountPercent` (a zero price always counts)
     needs `sales.discount.override_limit` (403 `DISCOUNT_LIMIT_EXCEEDED`);
   - a zero total needs `sales.zero_total` (403 `ZERO_TOTAL_DENIED`) and a reason (400
     `REASON_REQUIRED`);
   - `expectedTotalMinor` different from the priced total → 409 `TOTAL_CHANGED`
     (pass `null` on the device, which prices the sale itself).
   - `priced` is `PricedCart` from `@arabat/money` (per-line gross, discounts, net; subtotal,
     discounts, total).
4. `checkPayments(...)` (below) with the total minus `exchangeCreditUsed(credit, total)`.

| Export | Purpose |
|---|---|
| `SaleLine { variantId, quantityMilli, priceOverrideMinor, priceOverrideReason, discount, extraMinor }` | A parsed cart line; `extraMinor` = modifier prices added to the unit price. |
| `CatalogPrice { priceMinor, costMinor }` | List price and cost of a variant sellable at the branch. |
| `PricePolicy { maxDiscountPercent, priceOverrideFloorPercent, priceOverrideCeilingPercent, priceOverrideBelowCost }` | From the sales settings (strings are exact decimals, e.g. `"10"`, `null` = no bound). |
| `RightCheck = (permission) => boolean` | |
| `requiredSaleRights(lines, orderDiscount, catalog, maxDiscountPercent)` | The overridable rights the cart needs by the same rules (null if it cannot be priced): use it to ask for a supervisor before paying. |
| `exchangeCreditUsed(creditMinor, totalMinor)` | The part of a refund credit spent on the exchange sale. |

### Payments (`payments.ts`)

`checkPayments(input, methods, dueMinor, requireReference = true): CheckedPayment[]`

- `input`: `{ methodId, amount, tendered, reference }[]` as entered (`amount`, `tendered` are
  decimal strings).
- `methods`: `Map<id, PosPaymentMethod>` with `{ id, kind, status, availableInPos,
  gatewayProvider, financialAccountId, nameEn, nameAr, feeType, feeFixedMinor, feePercent }`.
- Refusals: no payment for a non-zero amount, a negative or zero amount, cash tendered below the
  amount, change on non-cash, sum ≠ due → 400 `PAYMENT_TOTAL_MISMATCH`; method missing / inactive
  / not for the POS → 409 `PAYMENT_METHOD_UNAVAILABLE`; gateway method → 409
  `PAYMENT_NOT_VERIFIED`; non-cash without settlement account → 409
  `SETTLEMENT_ACCOUNT_REQUIRED`; non-cash without reference when required → 400
  `REFERENCE_REQUIRED`; bad decimals → 400 `INVALID_PRICE`.
- Result per payment: `{ method, amountMinor, tenderedMinor, changeMinor, feeMinor, reference }`
  (fee 0 for cash). The caller gives each payment its id (UUIDv7).

### Receipt numbers (`receipt.ts`)

| Export | Example |
|---|---|
| `formatReceiptNumber(branchCode, n)` | `MAIN-000028` (branch-wide series, online store) |
| `formatDeviceReceiptNumber(branchCode, registerCode, n)` | `MAIN-R1-000123` (per-device series, ADR-0112) |
| `formatRefundNumber(receiptNumber, n)` | `MAIN-000028-R2` |

The device keeps its counter gap-free in the same local transaction as the sale.

### Supervisor overrides (`overrides.ts`, BR-177)

| Export | Purpose |
|---|---|
| `assertDifferentSupervisor(supervisorUserId, cashierUserId)` | 403 `OVERRIDE_SELF`. |
| `lendableRights(supervisorHolds, cashierHolds)` | Overridable rights the supervisor holds at the branch and the cashier lacks. |
| `assertSomethingToLend(rights)` | Empty → 403 `OVERRIDE_NOT_ALLOWED`. |
| `assertOverrideUsable(grant, { cashierMembershipId, branchId, now })` | A grant `{ status, expiresAt, cashierMembershipId, branchId }` is usable once, before it expires, by that cashier at that branch; otherwise 409 `OVERRIDE_INVALID`. |

### Shifts and cash (`shifts.ts`)

| Export | Purpose |
|---|---|
| `shiftOutcome(discrepancyMinor, toleranceMinor)` | `'balanced' \| 'over' \| 'short' \| null`. |
| `cashDifferenceNeedsNote(differenceMinor, toleranceMinor, note)` | Beyond the tolerance without a note. |
| `openingNoteRequired({ blind, initial, note, differenceMinor, toleranceMinor })` | Opening count: not for blind cashiers or the drawer's first count. |
| `closingNoteRequired({ closeType, blind, note, discrepancyMinor, toleranceMinor })` | Closing count: a blind normal close never asks; a forced close does. |
| `otherCashOutExceedsLimit({ amountMinor, shiftOtherTotalMinor, perMovementLimitMinor, perShiftLimitMinor })` | "Other" cash-out caps (above them: owner override or manager approval). |
| `checkCashBreakdown(breakdown, countedMinor)` | A denomination count must add up to the counted cash (400 `INVALID_BREAKDOWN`). |

### Refunds (`refunds.ts`)

| Export | Purpose |
|---|---|
| `computeRefund(lines, input, reason?)` → `{ lines, totalMinor }` | Per line: position must exist (400 `VALIDATION_FAILED`), quantity > 0 (400 `INVALID_QUANTITY`) and ≤ what is left (409 `REFUND_EXCEEDS_SALE`); cumulative rounding so partial refunds add up to the line net; damaged / defective are not restocked by default. |
| `suggestPayback(payments, totalMinor)` | Pay-back proportional to what each original payment can still refund. |
| `paybackAllocation(payments, totalMinor, custom)` | The suggestion, or the cashier's split validated (400 `REFUND_ALLOCATION_INVALID`). |
| `refundApprovalReasons({ totalMinor, saleCreatedAt, saleUserId, requesterUserId, now, settings })` | `over_limit`, `outside_window`, `own_sale` (only the owner skips approval). |
| `assertVoidable({ saleShiftId, openShiftId, activeRefunds })` | Cancel only in the own open shift and without refunds (409 `NOT_VOIDABLE`). |

## What is not here (yet)

Stock (consumption of recipes and modifiers, negative-stock policy), the cash ledger, receipt
counters, idempotency, loading and saving: they need data access and stay in `apps/api` (and their
device counterparts in the device app). The browser till (`apps/pos-web/src/sale/cart.tsx`) asks
for a supervisor with `requiredSaleRights`, like the device must.

`pnpm check:pos-core-browser` (part of `pnpm verify` and CI) bundles this package for the browser
and fails on any Node built-in or server-only import.
