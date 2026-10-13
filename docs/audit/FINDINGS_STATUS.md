# Findings status — remediation tracking

Tracks every finding of `BUSINESS_PROCEDURES_MANUAL.md` through the work packages of
`REMEDIATION_PLAN.md`. Statuses: **Open** (not started), **In Progress**, **Fixed** (code merged,
not yet re-verified by the audit), **Tested** (fixed and covered by automated tests that ran),
**Deferred** (outside the current retail scope or waiting for an owner decision). Update this file
in the same session as the code.

Last update: 2026-10-13 (remediation session 4). Totals: Deferred 49, Fixed 4, In Progress 3, Open 112, Tested 12.

| Id | Finding | Severity | Ch. | Package | Status | Note |
|---|---|---|---|---|---|---|
| FND-701 | Money collected for "needs attention" cases exists in no ledger | Critical | G | R7.1 | Deferred | Online store: R7 only after a gateway is approved (D7) |
| FND-101 | Merchant audit trail is written but cannot be read by the merchant | High | A | R1.0 | Tested | Session 1: `/manager/audit` + API (`audit.int.test.ts`, `audit.test.tsx`) |
| FND-102 | Ownership transfer and owner succession are not implemented although documented | High | A | R5.2 | Open |  |
| FND-201 | Stock adjustments have no approval, value limit or segregation of duties | High | B | R2.1 | Open |  |
| FND-207 | Switching off stock tracking (or changing goods to service) hides existing balances from valuation without a movement | High | B | R2.5 | Open |  |
| FND-406 | Bank account balances are never reconciled; deposits are credited on the depositor's word | High | D | R1.3 | Tested | Session 4: deposits wait in transit with a mandatory slip number until a second person confirms them; manual bank reconciliation per account (`bank.int.test.ts`, `cash.test.tsx`, `cash-payouts.spec.ts`) |
| FND-407 | Cash out "correction" / "other" removes cash from custody with no destination and no approval | High | D | R1.1 | Tested | Session 2: corrections bound to a movement; "other" cash-outs capped and pending above the limit (`shifts.int.test.ts`, `app.test.tsx`) |
| FND-408 | Disbursements have no limits, no approval and no link to what is owed | High | D | R1.2 | Tested | Session 3: approval limits per company, pending till movements and treasury payout requests with a second custody holder, owner override audited (`cash-payouts.int.test.ts`, `shifts.int.test.ts`) |
| FND-501 | Gateway refunds can never be confirmed; stock is restocked while revenue stays unreduced | High | E | R7.2 | Open |  |
| FND-512 | Inventory valuation is only available "as of now"; no closing stock at period end | High | E | R2.6 | Open |  |
| FND-601 | No supplier invoice and no three-way match; delivery price cannot differ from the order | High | F | R6.1 | Deferred | Supplier invoices and payables deferred (D5) |
| FND-602 | Supplier payments are unbounded and unmatched: overpayment, duplicate and prepayment risk | High | F | R1.2, R6.2 | Tested | Session 3: payment above the order value refused unless the owner confirms; paid to date on the order; payables themselves deferred (D5) |
| FND-603 | Transfer discrepancy write-off is self-approved and never posted | High | F | R2.3 | Open |  |
| FND-604 | Stock in transit is not valued, not aged and cannot be recalled | High | F | R2.4 | Open |  |
| FND-702 | Gateway refunds can never complete inside the system | High | G | R7.2 | Deferred | Online store: R7 only after a gateway is approved (D7) |
| FND-703 | Paid online orders can only be refunded from a POS terminal by a cashier with an open shift; the customer has no receipt number | High | G | R7.3 | Deferred | Online store: R7 only after a gateway is approved (D7) |
| FND-704 | No reconciliation of gateway payouts to online sales; bank balance credited at confirmation with a merchant-entered fee | High | G | R7.4 | Deferred | Online store: R7 only after a gateway is approved (D7) |
| FND-801 | Open orders are unbilled revenue with no management visibility, ageing or cut-off control | High | H | — | Deferred | Restaurant out of the retail scope |
| FND-802 | Dine-in orders on a deactivated table or area disappear from every screen while staying open | High | H | — | Deferred | Restaurant out of the retail scope |
| FND-806 | A bill cannot be paid when ingredient stock is insufficient (negative stock denied) | High | H | — | Deferred | Restaurant out of the retail scope |
| FND-808 | Complimentary or served-then-voided items leave no stock or revenue trace and have no second control | High | H | — | Deferred | Restaurant out of the retail scope |
| FND-901 | No billing, invoicing, receivables or collection process for subscriptions | High | I | — | Deferred | Operator billing / retention: with the pricing decision (OQ-022) |
| FND-904 | Suspension and closing ignore open shifts, cash balances, stock and pending documents | High | I | — | Open |  |
| FND-103 | No self-service password change and no session overview | Medium | A | R5.4 | Open |  |
| FND-104 | Owner e-mail is never verified at self-registration | Medium | A | — | Open |  |
| FND-105 | Audit entries for profile-type edits record the fact but not the values | Medium | A | R5.3 | Open |  |
| FND-108 | Invitation grants are authorised at invitation time, not at acceptance | Medium | A | R5.4 | Open |  |
| FND-109 | Branch deactivation has no operational pre-conditions | Medium | A | R2.5 | Open |  |
| FND-110 | Account lock-out by failed attempts can be triggered by anyone who knows an e-mail | Medium | A | R5.4 | Open |  |
| FND-113 | Default templates concentrate cash custody in the owner and leave segregation choices implicit | Medium | A | R1.6 | Tested | Session 2: Treasurer template + dashboard warning when only the owner holds custody (`controls.int.test.ts`) |
| FND-202 | Stock counts are not blind, overwrite intervening movements and have no variance sign-off | Medium | B | R2.2 | Open |  |
| FND-203 | Average unit cost is limited to whole fils, distorting costs of low-value units | Medium | B | R2.7 | Open |  |
| FND-204 | Negative balances are valued at zero and their cost basis is discarded on replenishment | Medium | B | R2.7 | Open |  |
| FND-206 | Stock held by archived variants/products or at inactive branches is frozen | Medium | B | R2.5 | Open |  |
| FND-210 | Restaurant waste bypasses the adjustment document, reason catalogue and adjustments report | Medium | B | — | Open |  |
| FND-211 | Transfer shortfalls leave the ledger without a write-off movement (shared with the Transfers chapter) | Medium | B | R2.3 | Open |  |
| FND-212 | "Customer return (outside POS)" lets stock re-enter outside the refund controls | Medium | B | R2.8 | Open |  |
| FND-213 | No point-in-time valuation, roll-forward or reserved-quantity visibility | Medium | B | R2.6 | Open |  |
| FND-301 | No supervisory override on another cashier's till | Medium | C | R3.1 | Open |  |
| FND-302 | Price override is not bounded and bypasses the discount limit | Medium | C | R3.2 | Open |  |
| FND-304 | Non-cash payments can settle nowhere; cash fees are stored but never posted | Medium | C | R3.5 | Open |  |
| FND-305 | Card and transfer payments are self-declared ("manual" verification) | Medium | C | R3.5 | Open |  |
| FND-312 | Zero-total sales complete without a payment or a reason | Medium | C | R3.3 | Open |  |
| FND-317 | "Net" in the sales history differs from "net after refunds" in the reports | Medium | C | R4.1 | Open |  |
| FND-401 | Closing is not blind | Medium | D | R1.5 | Tested | Session 1: blind counts by default (`shifts.int.test.ts`, `app.test.tsx`, `checkout.spec.ts`) |
| FND-402 | No explanation required for a closing shortage of any size | Medium | D | R1.1 | Tested | Session 2: note required on a visible closing difference beyond the tolerance |
| FND-403 | Tolerance is unlimited, set by the monitoring manager, and silently reclassifies differences as "balanced" | Medium | D | R1.1 | Tested | Session 2: owner-set maximum tolerance enforced on register save; checklist lists registers above it |
| FND-404 | No follow-up or settlement process for shift and count differences | Medium | D | R1.4 | Tested | Session 3: follow-up of every recorded difference (explained / settled / written off), audited, counted on the dashboard (`cash-variances.int.test.ts`) |
| FND-405 | Opening balances by count are created without source, note or second person | Medium | D | — | Open |  |
| FND-409 | Book balances of a drawer can change under a cashier without their count or a movement on their shift | Medium | D | — | Open |  |
| FND-410 | Differences on branch transfers are absorbed by the company without an accountable party | Medium | D | R1.4 | Fixed | Session 3: branch-transfer differences listed with the receiver as accountable and followed up; not yet charged to a branch automatically |
| FND-411 | Period cut-off is inconsistent across lists and reports, and statements have no period | Medium | D | R4.1 | Open |  |
| FND-413 | Processing fees are configured estimates, not settled amounts, and are not reconciled to the acquirer | Medium | D | R1.3, R3.5 | In Progress | Session 4: bank reconciliation shows which settlement entries the statement confirmed; fee settlement per acquirer waits for R3.5 (D6) |
| FND-416 | Weak segregation of duties around the register | Medium | D | R1.6 | In Progress | Session 2: approvals above the limit need a second person; custody split (FND-422) still open |
| FND-422 | The custody right is too coarse | Medium | D | R1.6 | Open |  |
| FND-502 | Holders of the approve permission bypass the refund limit and window for their own refunds | Medium | E | R3.4 | Open |  |
| FND-503 | Cashiers can refund their own sales within the limit with cash from their own drawer and no customer verification | Medium | E | R3.4 | Open |  |
| FND-504 | Exchange credit is paid back in cash: a card-to-cash conversion path | Medium | E | R3.4 | Open |  |
| FND-505 | Manual card and transfer refunds are recorded as paid immediately, with an optional reference and no acquirer reconciliation | Medium | E | R3.5 | Open |  |
| FND-507 | Restock defaults to "yes" regardless of the return reason | Medium | E | R2.8 | Open |  |
| FND-508 | Returned goods not restocked have no custody record or write-off document | Medium | E | R2.8 | Open |  |
| FND-511 | Three different date bases for refunds and no period-based refund register | Medium | E | R4.1 | Open |  |
| FND-513 | One item without a cost hides gross profit for the whole period | Medium | E | R4.3 | Open |  |
| FND-521 | Refunding an online order requires a POS session with an open shift at the branch | Medium | E | R7.3 | Open |  |
| FND-525 | No supplier balances or payables view; purchases received and supplier payments live in different reports | Medium | E | R4.5, R6.2 | In Progress | Session 3: paid to date per order; supplier statement (R4.5) still open |
| FND-605 | No segregation of duties on transfers | Medium | F | — | Open |  |
| FND-606 | Only approval is segregated on purchase orders; creator or approver may receive | Medium | F | — | Open |  |
| FND-607 | Receiving dialogs prefill the full expected quantity (no blind receiving) | Medium | F | — | Open |  |
| FND-608 | No value-based approval limits or budget on purchase orders | Medium | F | — | Open |  |
| FND-614 | Supplier reference on receipts is free text and not unique | Medium | F | R6.1 | Deferred | Supplier invoices and payables deferred (D5) |
| FND-615 | Returns to supplier are not supported | Medium | F | R6.2 | Deferred | Supplier invoices and payables deferred (D5) |
| FND-616 | Landed costs are not capitalised | Medium | F | R6.2 | Deferred | Supplier invoices and payables deferred (D5) |
| FND-705 | Amount-mismatch charges are recorded as "failed" attempts | Medium | G | R7.1 | Deferred | Online store: R7 only after a gateway is approved (D7) |
| FND-706 | Revenue is recognised at payment confirmation; unfulfilled paid orders have no owner, ageing or hand-over evidence | Medium | G | R7.6 | Deferred | Online store: R7 only after a gateway is approved (D7) |
| FND-707 | Reserved (committed) stock is invisible to management and unprotected under the negative-stock policy | Medium | G | — | Deferred | Online store deferred (D7) |
| FND-708 | Anonymous shoppers can tie up stock through reservations | Medium | G | R7.5 | Deferred | Online store: R7 only after a gateway is approved (D7) |
| FND-709 | Sandbox gateway creates real financial records without money; enabled by default outside production | Medium | G | R7.5 | Fixed | Session 1: production warning + OPERATIONS rule; default already off in production builds |
| FND-710 | A second successful payment on an already-paid order is not surfaced | Medium | G | R7.1 | Deferred | Online store: R7 only after a gateway is approved (D7) |
| FND-713 | Customer profiles are created or linked from unauthenticated phone input | Medium | G | — | Deferred | Online store deferred (D7) |
| FND-717 | Resolution of flagged orders relies on a free-text note | Medium | G | R7.1 | Deferred | Online store: R7 only after a gateway is approved (D7) |
| FND-803 | Item price is charged at payment time, modifier surcharge at ordering time (OQ-023) | Medium | H | — | Deferred | Restaurant out of the retail scope |
| FND-805 | Waste is valued in the ledger but reported nowhere; void reasons are not analysable | Medium | H | — | Deferred | Restaurant out of the retail scope |
| FND-807 | Waste cannot be recorded when ingredient stock is insufficient, inviting "not prepared" declarations | Medium | H | — | Deferred | Restaurant out of the retail scope |
| FND-809 | Restaurant sales are attributed to the cashier who takes payment, not to the waiter | Medium | H | — | Deferred | Restaurant out of the retail scope |
| FND-810 | No ownership of tables: any order-taker at the branch may modify, move, merge or bill any order | Medium | H | — | Deferred | Restaurant out of the retail scope |
| FND-812 | Refunding or voiding a bill does not reopen the order or flag it | Medium | H | — | Deferred | Restaurant out of the retail scope |
| FND-816 | Items made unavailable after ordering cannot be billed | Medium | H | — | Deferred | Restaurant out of the retail scope |
| FND-902 | Default plan is unlimited with a trial that has no consequence when it ends | Medium | I | — | Deferred | Operator billing / retention: with the pricing decision (OQ-022) |
| FND-903 | Plan edits are not checked against merchants already on the plan | Medium | I | — | Open |  |
| FND-906 | No dual control for irreversible or commercially significant operator actions | Medium | I | — | Open |  |
| FND-907 | No operator offboarding or role change procedure | Medium | I | — | Open |  |
| FND-911 | Data retention, export and deletion after closing are undefined | Medium | I | — | Deferred | Operator billing / retention: with the pricing decision (OQ-022) |
| FND-912 | Online payments keep completing sales for merchants that cannot act on them | Medium | I | — | Open |  |
| FND-106 | Audit log immutability relies on database grants only; no tamper-evidence or retention policy | Low | A | — | Open |  |
| FND-107 | Documentation does not match behaviour in several identity details | Low | A | — | Open |  |
| FND-111 | Refused privileged actions are not audited | Low | A | R1.0 | Open |  |
| FND-112 | POS inactivity lock is detected in the browser, not by the server | Low | A | — | Open |  |
| FND-114 | Failed sign-in audit rows store attempted e-mails without a company and are unreviewable | Low | A | R1.0 | Open |  |
| FND-115 | Operator lifecycle beyond creation is manual | Low | A | — | Open |  |
| FND-116 | Reactivating a branch silently restores all dormant grants | Low | A | R5.4 | Open |  |
| FND-117 | Members with no role assignments remain active, invisible to branch managers, and count against plan capacity | Low | A | R1.6 | Fixed | Session 2: members without roles listed in the controls checklist; plan-capacity counting unchanged |
| FND-205 | Valuation can drift from the sum of movement values because the average is rounded | Low | B | R2.7 | Open |  |
| FND-208 | Catalog audit entries do not record most attribute changes | Low | B | R5.3 | Open |  |
| FND-209 | The "sale void" movement type exists in the schema and the screen filter but is never produced | Low | B | — | Open |  |
| FND-214 | Balance-equals-ledger integrity relies on code discipline only | Low | B | — | Open |  |
| FND-216 | Items can be stocked with no cost at all; the gap is reported only as "unvalued" | Low | B | R2.7 | Open |  |
| FND-218 | Increases by users without the price right are valued at a cost that may not be actual | Low | B | R2.1 | Open |  |
| FND-220 | Adjustment documents have no human-readable document number | Low | B | R2.1 | Open |  |
| FND-222 | Price and cost history exists only in the audit log | Low | B | R5.3 | Open |  |
| FND-223 | Two cost concepts (catalog standard cost vs moving average) are not explained to users | Low | B | R2.7 | Open |  |
| FND-303 | Above-limit discounts are not flagged and the limit in force is not kept | Low | C | R3.2 | Open |  |
| FND-306 | Cut-off follows a fixed merchant time zone; branch time zone is unused | Low | C | R4.1 | Open |  |
| FND-307 | Staff can attach their own or a colleague's customer profile | Low | C | — | Open |  |
| FND-308 | Receipt contents are not fixed against a legal or commercial requirement | Low | C | — | Open |  |
| FND-309 | Held sales: attribution drift, overwritten intent, no expiry | Low | C | R3.6 | Open |  |
| FND-310 | Reprint only during the current shift; reprints uncounted | Low | C | R3.6 | Open |  |
| FND-311 | Abandoned carts and cleared lines leave no trace | Low | C | R3.6 | Open |  |
| FND-313 | Discount limit applied per discount, not combined | Low | C | R3.7 | Open |  |
| FND-314 | Online store reuses inactive customers | Low | C | — | Open |  |
| FND-315 | Duplicate customers without a phone | Low | C | — | Open |  |
| FND-316 | Till search exposes phone numbers broadly | Low | C | — | Open |  |
| FND-318 | Average sale uses gross spent and counts exchanges as purchases | Low | C | — | Open |  |
| FND-412 | A fee on the cash method is counted in fee totals but posted nowhere | Low | D | R3.5 | Open |  |
| FND-414 | Accounts can be deactivated with a balance and keep receiving postings | Low | D | R1.3 | Tested | Session 4: `ACCOUNT_IN_USE` on deactivating a bank account with a balance, unreconciled entries or a deposit in transit (`bank.int.test.ts`) |
| FND-415 | Documentation and configuration remnants out of step with behaviour | Low | D | — | Open | Documentation alignment, Theme 9 |
| FND-417 | Treasury of a deactivated branch keeps cash with no restriction | Low | D | — | Open |  |
| FND-418 | Management counts have no denomination breakdown in the screen | Low | D | R1.5 | Open |  |
| FND-419 | Manager cash moves during a shift need no cashier acknowledgement | Low | D | R1.1 | Open |  |
| FND-420 | Expense evidence is a free-text reference; categories are fixed | Low | D | R1.2 | Tested | Session 3: receipt / invoice reference mandatory above the approval limit; categories still fixed |
| FND-421 | Idle-drawer count adjustments carry a generated reference, not a document | Low | D | R1.4 | Fixed | Session 3: idle-drawer and treasury count differences appear in the follow-up list with the counter; still no document number |
| FND-506 | Pay-backs to a tender without a financial account leave no money trace | Low | E | R3.5 | Open |  |
| FND-509 | A pending request is bound to the requester's shift; once that shift closes it can only be rejected | Low | E | R3.4 | Open |  |
| FND-510 | Withdrawal of a pending request is documented but not offered on any screen | Low | E | — | Open |  |
| FND-514 | Sales-by-employee breakdown omits online sales and so does not add up to net sales | Low | E | R4.3 | Open |  |
| FND-515 | Audit event says "refund completed" for gateway refunds that are still processing | Low | E | R7.2 | Open |  |
| FND-516 | Approved refunds are stamped with the approver as the creator of the cash and stock entries | Low | E | — | Open |  |
| FND-517 | The manager dashboard shows no sales KPIs and a stale "no sales yet" banner | Low | E | R4.4 | Open |  |
| FND-518 | Report access and exports are not logged; exports exist only as browser CSV | Low | E | R4.4 | Open |  |
| FND-519 | Voided sales inflate sale count and average sale; exchanges gross up sales and refunds | Low | E | — | Open |  |
| FND-520 | Unusual-activity threshold is hard-coded and the default period is all time | Low | E | R4.4 | Open |  |
| FND-522 | "Refund allocations" uses a different date basis than the rest of the payments report | Low | E | R4.1 | Open |  |
| FND-523 | One merchant-wide time zone; a change would re-cut all historical periods | Low | E | R4.1 | Open |  |
| FND-524 | Processing fees are never reversed on refunds | Low | E | — | Open |  |
| FND-609 | Supplier list shows company-wide purchase totals to branch-scoped users | Low | F | — | Open |  |
| FND-610 | Supplier creation needs a merchant-wide right while the screen and the catalogue suggest branch scope | Low | F | — | Open |  |
| FND-611 | Cancellations need no reason; no "reject to draft"; creator may cancel an approved order | Low | F | — | Open |  |
| FND-612 | Received value rounded differently on the order page and in supplier/report totals | Low | F | R6.1 | Deferred | Supplier invoices and payables deferred (D5) |
| FND-613 | Documentation does not match behaviour on write-off and on schema | Low | F | R2.3 | Open |  |
| FND-617 | Zero unit cost and duplicate item lines accepted on purchase orders | Low | F | R6.1 | Deferred | Supplier invoices and payables deferred (D5) |
| FND-618 | Partial dispatch needs no explanation; notes are dropped | Low | F | — | Open |  |
| FND-619 | No document dates; cut-off depends on timely entry | Low | F | R4.2 | Open |  |
| FND-620 | Thin audit detail for master-data and draft edits | Low | F | R5.3 | Open |  |
| FND-621 | Purchasing report counts closed orders at full ordered value; open value is "as of now" | Low | F | — | Open |  |
| FND-622 | Surplus arriving on a transfer cannot be recorded on it | Low | F | R2.3 | Open |  |
| FND-623 | Unknown dispatch cost leaves transfers and losses unvalued | Low | F | R2.3 | Open |  |
| FND-711 | Delivery fee is booked as product revenue at 100 % margin and is refundable as an item | Low | G | — | Deferred | Online store deferred (D7) |
| FND-712 | Sale date is the confirmation time, not the provider's charge time | Low | G | — | Deferred | Online store deferred (D7) |
| FND-714 | No customer notifications; the tracking link is shown once | Low | G | — | Deferred | Online store deferred (D7) |
| FND-715 | Fulfilment branch status is not enforced after publishing | Low | G | — | Deferred | Online store deferred (D7) |
| FND-716 | Audit trail housekeeping: store settings and listings logged against the wrong target; manual reconciliation unlogged | Low | G | — | Deferred | Online store deferred (D7) |
| FND-718 | Processing fee and its non-reversal are defaults awaiting the owner's contracts | Low | G | — | Deferred | Online store deferred (D7) |
| FND-719 | No real gateway is connected | Low | G | — | Deferred | Online store deferred (D7) |
| FND-720 | Late payments after expiry create sales at stale prices without review | Low | G | — | Deferred | Online store deferred (D7) |
| FND-804 | Bill discounts exist in the API but not on the POS bill screen | Low | H | — | Deferred | Restaurant out of the retail scope |
| FND-811 | Kitchen status changes are not audited and "served" is declared by the kitchen | Low | H | — | Deferred | Restaurant out of the retail scope |
| FND-813 | Disabling the module with open orders traps unbilled revenue | Low | H | — | Deferred | Restaurant out of the retail scope |
| FND-814 | Payment of a takeaway/pickup bill fails when no kitchen station exists and auto-send is on | Low | H | — | Deferred | Restaurant out of the retail scope |
| FND-815 | Manager screens lag the API: no service-type filter/column, no modifiers on the manager sale detail, surcharges not itemised on receipts | Low | H | — | Deferred | Restaurant out of the retail scope |
| FND-817 | Thin order-level audit trail: no item detail on "items added", free-text reasons, no recipe history | Low | H | — | Deferred | Restaurant out of the retail scope |
| FND-819 | Guest counts and kitchen timings are captured but never reported | Low | H | — | Deferred | Restaurant out of the retail scope |
| FND-822 | Merging mixes service types; the bill takes the target's type | Low | H | — | Deferred | Restaurant out of the retail scope |
| FND-824 | "Waiters need an open shift" is enforced by the screen, not by the system | Low | H | — | Deferred | Restaurant out of the retail scope |
| FND-905 | Operator reads of merchant data are not audited | Low | I | — | Open |  |
| FND-908 | An operator can attach any existing user as owner of a new company without consent or notice | Low | I | — | Open |  |
| FND-909 | Subscription dates and statuses are free-form and the period is not modelled | Low | I | — | Deferred | Operator billing / retention: with the pricing decision (OQ-022) |
| FND-910 | Overview staff count differs from the employee definitions used elsewhere | Low | I | — | Open |  |
| FND-913 | Documentation claims versus behaviour: minor discrepancies | Low | I | — | Open |  |
| FND-914 | Billing role cannot see the audit trail of its own actions | Low | I | — | Open |  |
| FND-915 | Single encryption key for all operator second factors | Low | I | — | Open |  |
| FND-916 | Welcome e-mail is sent after commit without retry or visibility | Low | I | — | Open |  |
