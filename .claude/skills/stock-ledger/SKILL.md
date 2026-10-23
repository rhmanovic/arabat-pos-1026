---
name: stock-ledger
description: Rules for changing stock in apps/api through StockLedgerService (apply / reserve), stock adjustments and their approval, branch transfers, losses and recall, purchase receipts, recipe and modifier consumption, moving average cost and damaged-return custody. Use for any change that touches stock_levels, stock_movements, stock_reservations, stock_adjustments, stock_transfers, damaged_returns, or for any new document that moves stock (sale, refund, waste, receipt, transfer).
---

# Stock ledger (inventory engine)

Engine: `apps/api/src/modules/inventory/stock-ledger.service.ts`. Documents:
`inventory/inventory.service.ts` (adjustments, counts, damaged returns),
`transfers/transfers.service.ts`, `purchasing/purchasing.service.ts`, `inventory/consumption.ts`.
Business rules are BR-169 to BR-176 in `docs/BUSINESS_RULES.md`, decisions are ADR-0079/0097/0098/0099 in `docs/DECISIONS.md`.
For schema changes use the `new-migration` skill. For running tests use `run-tests`. The online
side (reservations at checkout) is covered in `online-store`, and device sales in `device-app`.

## 1. The one way a balance changes

- Change `stock_levels` **only** through `StockLedgerService.apply(tx, ctx, lines)`. Never
  `update stock_levels` yourself and never insert `stock_movements` directly (CLAUDE.md §10,
  class comment in `stock-ledger.service.ts`).
- Call it with the **caller's** `tx` from `database.withMerchantTx(...)`, in the same
  transaction as the source document, its lines and the audit entry (`audit.recordIn(tx, …)`).
  Do not open a second transaction (CLAUDE.md §3.12).
- Call it **once per document** with all lines. It sorts variant ids, locks the rows with
  `SELECT … FOR UPDATE` and rejects the whole document if any line is short
  (`409 INSUFFICIENT_STOCK`, one detail per `lines.N`). Splitting the call per line loses
  that all-or-nothing behaviour and the fixed lock order.
- `ctx` fields: `merchantId`, `branchId`, `movementType`, `sourceType` + `sourceId` (the
  document), `userId`, plus optional `reason`, `note`, `negative`, `requireNoHistory` and
  `reservationOrderId`.
- Line `mode: 'delta'` uses signed milli-units (negative means stock goes out). `mode: 'set'` is for counts only.
  Quantities are `bigint` milli-units (`parseQuantity` / `formatQuantity` from `@arabat/money`).
  Never use `number` (CLAUDE.md §3.11).
- Items that are not tracked (`products.track_inventory = false`) come back `tracked: false` and
  write nothing. Use `AppliedLine.unitCostMinor` / `valueMinor` for cost of goods and do not
  recompute them.
- `negative`: `'policy'` (default) follows `inventory_settings.allow_negative_stock`.
  `'deny'` is used for transfers out (`transfers.service.ts` dispatch). `'allow'` is used only
  for completed device sales, which raise a stock exception instead (ADR-0112 §5,
  `devices/device-ingest.service.ts`).
- `requireNoHistory: true` is for opening stock only. It refuses with `OPENING_STOCK_EXISTS`
  once the item has any movement at the branch.

## 2. Movement types (`MOVEMENT_TYPES`, `packages/contracts/src/inventory.ts`)

| type | written by |
|---|---|
| `opening`, `adjustment`, `count` | `InventoryService.post` (`MOVEMENT_FOR_KIND`). Restaurant waste is `adjustment` with reason `restaurant_waste` |
| `sale` | `sales.service.ts`, `devices/device-ingest.service.ts` |
| `refund` | `refunds.service.ts` (restocked lines only) |
| `transfer_out` / `transfer_in` | `transfers.service.ts` (dispatch / receive / recall) |
| `purchase_receipt` | `purchasing.service.ts` receipt, at the purchase cost |
| `sale_void` | in the contract, no caller today |

`transfer_loss` exists only as a report row (`reports.service.ts`). It is never a ledger
movement (ADR-0098). If you add a type, add it to the contract, the inventory report
roll-forward and `docs/DATABASE.md`.

## 3. What selling consumes

- Pass sold or wasted items through `stockConsumption(tx, inputs)` (`consumption.ts`) before
  calling `apply`. A variant with `recipe_components` consumes its ingredients instead of
  itself, and a chosen modifier with `component_variant_id` adds its ingredient. Then call
  `apply` once with the result, so stock is deducted at one point in time (ADR-0074).
  `consumptionCosts` maps the applied lines back to cost per sale line.

## 4. Reservations (online, ADR-0079)

- `reserve(tx, {merchantId, branchId, onlineOrderId, expiresAt}, lines)` takes the same row
  locks and refuses with `INSUFFICIENT_STOCK`. It writes `stock_reservations` and does not
  change any balance.
- `apply` treats other orders' active, unexpired reservations as unavailable for `sale` and
  `transfer_out` (`RESPECTS_RESERVATIONS`). When a paid order consumes its **own**
  reservation, pass `reservationOrderId` (`sales.service.ts`). Reservations are consumed or
  released in `ecommerce/online-payments.service.ts`.

## 5. Adjustments and counts (ADR-0097, BR-169, BR-170)

- Go through `InventoryService.createAdjustment`. It checks `inventory.adjust` at the branch and
  numbers the document `ADJ-` with `nextDocumentNumber`. It values the document at cost with
  `estimateValue` and compares that value with `stockPolicy(tx).adjustmentLimitMinor`
  (`cash/approval-limits.ts`, default 50 000 fils).
- Above the limit, a non-owner's document is stored as `pending` with its lines, and **nothing
  moves**. `decideAdjustment` needs a **different** holder of `inventory.adjust` at that branch.
  The owner may decide their own, flagged as `ownerOverride`. Approval runs the same `post()`,
  attributed to the requester. A rejection needs a note, and the requester may withdraw. Opening
  stock is exempt. A typed unit cost needs `catalog.prices.manage`.
- Counts: under the blind policy the sheet hides the book quantity. Movements since
  `startedAt` raise `STOCK_MOVED_SINCE_COUNT` until the counter sends `acknowledgeMovements`.

## 6. Transfers (ADR-0098, BR-172, BR-173)

- Dispatch posts `transfer_out` of the full quantity at the source (`negative: 'deny'`), after
  `assertCostsKnown` (`COST_UNKNOWN`). Receive posts `transfer_in` of what actually arrived at the
  destination, at the line's `unit_cost_minor` (dispatch cost). Any difference needs a note, and surplus is allowed.
- A shortage becomes a `stock_transfer_losses` document (`TL-`, `createLoss`). It is posted at
  once within the limit. Above the limit it waits for `inventory.transfer.approve` **at the source**,
  and the claimant may not decide it (owner excepted). Never write a ledger row for a loss.
- In transit = dispatched − received − recalled − posted losses, **computed** from the
  lines (`inTransitOf`, `inTransit()`). Never add a stored in-transit column.
- Recall (`recall`, source right, reason): `transfer_in` at the source at dispatch cost,
  `recalled_quantity` is set once, and the status becomes `recalled`.

## 7. Cost (ADR-0099, BR-174)

- The average is `stock_levels.avg_cost_micro` (fils × 1000), computed with
  `weightedAverageCostMicro`. `avg_cost_minor` is for display and a fallback only, so never
  calculate with it. Incoming stock uses the typed cost, then the average, then the catalog
  cost. Outgoing stock leaves at the average and does not change it. Negative balances keep
  their basis.
- Sum `AppliedLine.valueMinor` for document values. Do not round again.

## 8. Custody, master data, append-only

- A refund line that is not restocked writes a `damaged_returns` row (`held`) in
  `RefundsService.execute`, with no ledger movement. `disposeDamagedReturn` (`inventory.adjust`,
  note) moves it `held → disposed` once (BR-175, migration `0042`).
- Do not untrack, turn into a service, archive or remove a variant that still holds stock:
  `assertNoStockOnHand` raises `STOCK_ON_HAND` (`catalog/catalog.service.ts`). Branches are not
  deactivated while they hold stock: `assertBranchIdle` raises `BRANCH_IN_USE`
  (`branches/branches.service.ts`). Archived items may only be decreased or counted
  (`assertAdjustable`) (BR-171).
- `stock_movements`, `stock_adjustments` and `stock_adjustment_lines` have no UPDATE or DELETE
  for `app_runtime` (`drizzle/0009_inventory_rls.sql`). Decision columns change only through
  column grants and triggers. Fix a mistake with a new document (adjustment, refund,
  recall or loss), never by editing rows (CLAUDE.md §4).

## 9. Tests to write (integration, real PostgreSQL)

Follow the existing suites: `inventory/inventory.int.test.ts` (ledger engine, concurrency,
append-only, isolation), `inventory/inventory-controls.int.test.ts` (BR-169/170/171),
`inventory/inventory-valuation.int.test.ts` (BR-174/175/176),
`transfers/transfers-controls.int.test.ts` (BR-172/173) and `purchasing/purchasing.int.test.ts`.
Money math has unit tests in `packages/money/src/quantity.test.ts`. For every new stock path, assert:
1. The balance **and** the matching `stock_movements` row (type, `source_type`/`source_id`,
   `balance_after`, value). A forced failure later in the same transaction rolls both back.
2. A shortage rejects the whole document with `INSUFFICIENT_STOCK` and nothing moves. Run
   concurrent decreases with `Promise.all` and check the balance never goes below zero and no
   update is lost.
3. Reserved stock is not sold or transferred by others, while the reserving order can use it.
4. Approval: above the limit the document is pending and the balance is unchanged; the
   requester cannot approve it; a second person posts it; the owner's override is flagged.
5. Cost: the micro average after mixed receipts, and Σ movement values equals the balance value.
6. Another merchant's stock is invisible, and the branch scope is respected.
Run them with `pnpm test:integration`, then `pnpm verify` (see `run-tests`).
