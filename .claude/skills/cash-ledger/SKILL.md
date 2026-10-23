---
name: cash-ledger
description: Rules and code map for cash custody — register drawers, shifts (open/close counts), branch treasuries, cash movements, expenses and supplier payments, branch cash transfers, bank deposits in transit, bank reconciliation and payment-method settlement accounts / tender references. Use for any change touching financial_accounts, financial_account_entries, cash_transfers, cash_disbursements, shifts, apps/api/src/modules/{payments,cash,registers}, or a cash/bank screen in /manager or /pos.
---

# Cash ledger (custody, shifts, treasuries, bank)

Background: ADR-0090 (custody core), 0091 (disbursements, deposits, branch transfers), 0092 (reports),
0093–0095 (blind counts, cash-out limits, approvals), 0096 (deposits in transit, reconciliation),
0101 (tender hygiene) in `docs/DECISIONS.md`; BR-076–079 and BR-162–168 in `docs/BUSINESS_RULES.md`.
Schema changes: use the `new-migration` skill. Device (local-first) shifts and drawer uploads:
`device-app` skill (`modules/devices/device-ingest.service.ts`, ADR-0112 amendment 3).

## Code map
- `apps/api/src/modules/payments/cash-ledger.ts` — the ledger: `postEntries`, `postTransfer`,
  `postDisbursement`, `lockAccounts`, `accountBalance`, `assertCovers`, `assertTreasuryCounted`,
  `registerAccount`, `branchTreasury`, `drawerEntryShift`, `depositTransitAccount`, `inTransitAccount`,
  `activeBankAccount`. Tables in `payments/payments.schema.ts`.
- `apps/api/src/modules/registers/shifts.service.ts` — open / close / force-close, POS cash movements,
  pending cash-out decisions; controller `registers.controller.ts` (`/manager/shifts…`, `/pos/shifts…`).
- `apps/api/src/modules/cash/` — `cash.service.ts` (overview, counts, register↔treasury transfers),
  `cash-payouts.service.ts` (disbursements, deposits, branch transfers, supplier statement),
  `cash-controls.service.ts` (payout requests, variance follow-ups), `bank.service.ts` (deposit
  settlement, reconciliation), `approval-limits.ts` (limits, `assertDepositSlip`, overpayment guard).
- Pure rules: `packages/pos-core/src/shifts.ts` (`cashDifferenceNeedsNote`, `checkCashBreakdown`),
  `packages/pos-core/src/payments.ts` (tender checks). Called through `rules()` (ADR-0112).
- UI: `apps/manager-web/src/features/cash/` (CashCustodyPage, CashPayouts, BankReconciliation,
  ShiftsPage, Variances, PaymentsPage, RegistersPage).
- DB rules: `apps/api/drizzle/0011_*`, `0032`–`0039`, `0064_branch_shifts.sql`.

## Hard rules
1. **Balances change only through `cash-ledger.ts`.** `postEntries` is the only insert into
   `financial_account_entries` in the API (CLAUDE.md §10, ADR-0090). Never insert entries, never
   compute or store a balance column: a balance is `accountBalance()` = sum of entries.
2. **Append-only.** `app_runtime` has no UPDATE/DELETE on `financial_account_entries`,
   `cash_movements` (0011), `cash_transfers` (0033), `cash_disbursements` (0035), reconciliation
   tables (0039). Corrections are new records: a disbursement reversal is a new row with
   `reverses_id` (one per record, ADR-0091); a till correction reverses a posted "other" movement
   (BR-164); a deposit is undone by a `deposit_return`, never deleted.
3. **Lock order:** shift row `FOR UPDATE` first, then `lockAccounts(ids)` (sorted), then read
   `accountBalance` and `assertCovers` before any outflow (ADR-0090, header of `cash-ledger.ts`).
   Do it all in one `withMerchantTx` transaction (CLAUDE.md §3.12).
4. **Register entries carry the open shift.** Trigger `financial_account_entries_guard` (0033)
   rejects a register entry whose `shift_id` is not the register's open shift and any shift on a
   non-register entry; get it with `drawerEntryShift(tx, registerId)`. Archived accounts take no entries.
5. **Moving cash = `postTransfer`** (one `cash_transfers` header + two balanced entries, deferred
   trigger `cash_transfers_balanced`). Allowed directions are enforced by `cash_transfers_direction()`
   (last replaced in 0039): register ↔ same-branch treasury; register/treasury → `deposit_transit`
   naming an active bank; transit → that bank or a treasury only via a matching settlement;
   treasury ↔ `in_transit` for branch transfers. A transfer is never a sale, revenue or expense (BR-076).
6. **Treasuries pay nothing before their first count** (`assertTreasuryCounted`, BR-076/079).
7. **Amounts are `bigint` minor units** (fils, KWD 3 decimals); use `packages/money`, never floats.

## Shifts (BR-077, BR-078, BR-162, BR-164)
- Open: lock drawer, expected = `accountBalance(drawer)`; counted − expected is a "between shifts"
  difference posted as an `adjustment` entry, note needed beyond tolerance (`cashDifferenceNeedsNote`);
  first count of a register is its opening balance. A previous `forced_uncounted` close gets the difference.
- Close: count vs drawer balance; difference booked on the shift as `adjustment`; cash stays in the
  drawer. Cashier cannot close with a pending cash-out. Forced close without a count =
  `forced_uncounted`, books nothing.
- Blind count (`sales_settings.blind_cash_count`, default on): withhold expected figures from users
  without `shifts.view_all` in the API, not only the UI (ADR-0093). Owner is never bound.
- "Other" cash-outs above the per-movement / per-shift limit are `pending` until a different
  `shifts.view_all` holder decides (ADR-0094); only `posted` movements count anywhere.
- Register tolerance ≤ `max_register_tolerance_minor` (ADR-0094).

## Expenses and supplier payments (ADR-0091, ADR-0095, BR-166)
- Always `postDisbursement` → `cash_disbursements` row + one entry typed `expense` /
  `supplier_payment`. **Never model them as a transfer** (CLAUDE.md §10). Supplier payment needs
  `supplier_id`; optional PO of the same supplier; `ORDER_OVERPAID` unless owner `confirmOverpayment`.
- Above `expense_approval_limit_minor` / `supplier_payment_approval_limit_minor`: needs a receipt
  reference and a second person — at the till a pending `cash_movements` row, from a treasury a
  `cash_payout_requests` row (`APPROVAL_REQUIRED`); approval calls the ordinary `postDisbursement`.

## Bank deposits and reconciliation (ADR-0096, BR-168)
- Every deposit (POS `bank_deposit` movement or `POST /manager/cash/deposits`) = `postTransfer`
  register/treasury → `depositTransitAccount()` with `targetAccountId` (intended bank) and a
  mandatory slip `reference` (`assertDepositSlip`). Needs `cash.deposit` (plus `cash.move` at the POS).
- Settlement = second transfer with `confirmsTransferId` (unique): `deposit_confirmation`
  (transit → that bank, same amount) or `deposit_return` (transit → branch treasury, reason).
  Settler ≠ depositor; owner may self-settle with `ownerOverride` in the audit. Race →
  unique index → `DEPOSIT_SETTLED`. No row locks needed (`bank.service.ts`).
- Reconciliation is manual: `bank_reconciliations` + `bank_reconciliation_items` (each entry ticked
  once); non-zero difference needs a note. Deposits in transit are not cash on hand.
- `PATCH /manager/financial-accounts/:id` → `ACCOUNT_IN_USE` for a bank with balance,
  unreconciled entries or a deposit in transit (`payments.service.ts`).

## Tenders and settlement accounts (ADR-0090, ADR-0101)
- Cash settles in the drawer (no account, no fee). Non-cash methods post straight to their bank
  minus the fee, so they **need `financial_account_id`** (`SETTLEMENT_ACCOUNT_REQUIRED`, in
  `pos-core/payments.ts` at checkout and `refunds.service.ts` on pay-back).
- `sales_settings.require_tender_reference` (default on): non-cash tenders and non-cash refund
  pay-backs need a reference (`REFERENCE_REQUIRED`). Fee reversal on refund follows
  `payment_methods.refund_fee_policy`.

## Permissions and audit
- Declare every route (`packages/permissions/src/catalog.ts`): `shifts.operate`, `shifts.view_all`,
  `cash.move`, `cash.custody`, `cash.deposit`, `registers.manage` — all branch-scoped; enforce the
  branch of the account the cash leaves. Approver ≠ requester everywhere; owner exceptions are flagged.
- Audit inside the same tx via `AuditService.recordIn` (existing keys: `shift.opened`, `shift.closed`,
  `shift.force_closed`, `shift.cash_out_*`, `cash.counted`, `cash.transfer.created`,
  `cash.deposit.created`, `cash.disbursement.created|reversed`, `cash.payout_request.*`,
  `cash.branch_transfer.*`, `bank.reconciled`, `cash.variance.followup`).
- New differences must appear in the variance list (`cash-controls.service.ts`, BR-167) and
  reports must read the ledger, never a copy (ADR-0092).

## Tests (see `run-tests` skill)
- Integration: `apps/api/src/modules/registers/shifts.int.test.ts`, `modules/cash/cash.int.test.ts`,
  `cash-payouts.int.test.ts`, `bank.int.test.ts`, `cash-variances.int.test.ts`,
  `cash-reports.int.test.ts`; tenders/refunds: `sales/sales-controls.int.test.ts`,
  `refunds/refunds-controls.int.test.ts`. Pure rules: `packages/pos-core/src/pos-core.test.ts`.
- e2e: `e2e/shifts.spec.ts`, `e2e/cash-payouts.spec.ts`; UI: `apps/manager-web/src/features/cash/cash.test.tsx`.
- Fixtures that read drawer figures as a cashier switch blind count off (`showExpectedCash`);
  one-person sell+refund fixtures use `allowOwnSaleRefunds` (ADR-0093, ADR-0101). Turn a control
  off explicitly in the fixture — never weaken the rule.
- For every new path assert: balance after = sum of entries, a second person / owner-override
  case, a refusal (insufficient cash, wrong direction, missing reference), and the audit row.
