# Remediation Plan — Retail scope (derived from the Business Procedures Manual, Phase 1)

**Owner direction (2026-10-12):** the current target market is **retail stores, not restaurants**.
This plan therefore sequences the fixes for the retail core (access, catalog and stock, selling,
refunds, cash custody, purchasing, reports) and explicitly defers the restaurant chapter. The online
store is treated as "retail, but no live gateway yet": only its go-live prerequisites are kept in
scope now.

Each work package is sized to be one engineering session / one pull request, delivered as a
vertical slice (migration → API → UI → tests → docs) per `CLAUDE.md`. Finding ids (FND-xxx) and
procedure ids (BP-xxx) refer to `docs/audit/BUSINESS_PROCEDURES_MANUAL.md`.

Size legend: **S** = up to a day, **M** = 2–3 days, **L** = a week or more (engineering estimate,
not a commitment).

---

## Owner decisions (approved 2026-10-13)

| # | Decision | Owner's answer |
|---|---|---|
| D1 | Blind closing | **Approved.** Blind counting on by default; the cashier never sees the expected balance before submitting a count. Owners configure the policy; cashiers cannot. |
| D2 | Approval thresholds | **Configurable per merchant, never hard-coded.** Defaults: expenses KWD 20, supplier payments KWD 100, inventory adjustments KWD 50 at cost. Above the threshold a separate approver is required; nobody approves their own transaction except through an explicit, documented and audited **owner override**. |
| D3 | Cash custody roles | **Approved.** Default "Treasurer" role with custody and deposit rights, least privilege. |
| D4 | Discount limit | **Combined** effective discount (item + sale), not per discount. |
| D5 | Supplier payables | **Deferred** (invoices, three-way match, accounts payable) to a later phase. |
| D6 | Card fees and their reversal | **Per payment provider's terms**: configurable per method, never assumed refundable or non-refundable. |
| D7 | Online store | **Production activation deferred.** Test gateways disabled outside development (staging excepted, documented). |

### Required changes to this plan (owner, 2026-10-13)

1. The merchant audit-log screen and API move from R5 to **R1** (package **R1.0**): financial
   actions, approvals, overrides, stock adjustments and cash movements must be reviewable before
   production.
2. The system must stay practical for a shop with **one owner and one cashier**: controls add
   approvals and limits, but the owner can always complete an action alone, with the exception
   recorded in the audit log (owner override).
3. Strong internal control without unnecessary operational complexity; no general ledger in
   these phases; restaurant stays out of scope.
4. Every session is a full vertical slice (migration where needed, API, UI, automated tests that
   ran, documentation), preserves existing behaviour, tenant isolation, permissions and the
   append-only financial records, names the procedures and findings it touches, and updates
   `FINDINGS_STATUS.md`.
5. One session at a time; after each: what was implemented, findings resolved, tests and results,
   outstanding risks, next recommended session.

---

## Phase R1 — Cash integrity (do first; prerequisite for any real money)

### R1.0 Merchant audit log screen (moved from R5.1) — **M** — *done in session 1*
- Closes: FND-101 (FND-114 and FND-111 remain for R5.3/R5.4)
- Built: `GET /manager/audit` for holders of the audit right over the company's own events
  (local-day period, action, record type and actor filters, pagination, distinct actions) and
  the management screen `/manager/audit` with CSV export; platform-only events stay separate.

### R1.1 Cash-out corrections and limits — **M** — *done in session 2 (FND-419 remains)*
- Closes: FND-407, FND-402, FND-403 (cap), FND-419
- Build: "correction" cash-out allowed only as a reversal of a named earlier movement of the same
  shift; "other" cash-out requires a note and is capped per movement and per shift by an
  owner-configured limit; above the cap the movement is recorded as *pending* until a manager
  confirms it; any closing shortage above the register tolerance requires a note; the tolerance can
  be set only by holders of the payments-settings right, with an owner-set maximum; corrections
  shown as their own line in the shift detail, the shift report and the discrepancy report.
- Depends on: nothing. Decision: D2 (cap value).

### R1.2 Approval of expenses and supplier payments — **M** — *done in session 3*
- Closes: FND-408, FND-602 (payment side), FND-420
- Build: per-merchant thresholds (defaults D2: expenses KWD 20, supplier payments KWD 100) editable by the owner; above the threshold a disbursement is created as *pending*
  (no cash leaves) and must be approved by a different person with the approve right before it
  posts; receipt reference mandatory above the threshold; optional receipt image through the
  existing file storage; on a purchase order show *ordered value / received value / paid to date*
  and warn (block above 100 % unless the approver overrides with a reason).
- Depends on: R1.1 (shared pending-movement concept). Decision: D2.

### R1.3 Bank deposits in transit and manual bank reconciliation — **M** — *done in session 4*
- Closes: FND-406, FND-413 (visibility), FND-414
- Build: a deposit leaves the drawer/treasury into "deposits in transit"; a second user with the
  deposit right confirms it into the bank account with slip reference and date (or the depositor
  confirms after an owner-set delay with a mandatory reference); a bank reconciliation screen per
  bank account: enter statement balance and date, tick confirmed deposits and settlement entries,
  see unreconciled items and the difference; accounts with a balance or unreconciled items cannot
  be deactivated.
- Depends on: nothing. Decision: none.

### R1.4 Variance follow-up — **S/M** — *done in session 3*
- Closes: FND-404, FND-410, FND-421
- Build: every count difference (shift close, between shifts, treasury, idle register, branch cash
  transfer) gets a status *open → explained → settled / written off*, an owner-visible note, the
  person who resolved it and the date; an "open variances" list and a column in the discrepancy
  report; branch cash transfer differences assigned to the sending or receiving branch explicitly.
- Depends on: nothing.

### R1.5 Blind counts — **S** — *done in session 1 (policy); FND-418 open*
- Closes: FND-401 (D1 approved); FND-418 stays for R1.4
- Built: company policy `blindCashCount` (default on, in the selling policy): users without
  `shifts.view_all` see no expected balance at opening or closing and no drawer figures during
  the shift; the API withholds the figures, the screens only follow; the difference is revealed
  after the count. Owners and supervisors keep the figures. Test gateway warning (R7.5) added.

### R1.6 Custody roles and set-up checklist — **S** — *done in session 2 (custody-right split FND-422 deferred to R5)*
- Closes: FND-113, FND-422, FND-416, FND-117
- Build: split the custody right into *count*, *move register↔treasury*, *branch transfer*; new
  default template "Treasurer"; an onboarding checklist in the management dashboard that warns
  when one person holds both create and approve rights for refunds, purchases or disbursements;
  members with no role assignment listed and excluded from plan capacity.
- Decision: D3.

---

## Phase R2 — Stock integrity

### R2.1 Approval of stock adjustments — **M** — *done in session 5*
- Closes: FND-201, FND-218, FND-220
- Build: adjustments above the per-merchant value threshold (default D2: KWD 50 at cost) are *pending* until approved by
  a different person with the adjust right (owner override recorded and audited); human-readable adjustment numbers
  (ADJ-); increases by users without the price right must use the current average cost (no
  self-entered cost) or go to pending.
- Decision: D2.

### R2.2 Blind counts with variance sign-off — **M** — *done in session 5*
- Closes: FND-202
- Build: count sheet hides the expected quantity; the resulting difference is posted as a count
  document whose variances above the threshold need approval (R2.1); movements posted between
  sheet creation and posting are shown and must be acknowledged, not silently overwritten.
- Depends on: R2.1.

### R2.3 Transfer losses posted and approved — **M** — *done in session 6*
- Closes: FND-603, FND-211, FND-622, FND-623, FND-613
- Build: a shortage at receipt posts an explicit *transfer loss* movement at dispatch cost against
  the sending branch (or an "in-transit loss" location), with the receiver's explanation; losses
  above the threshold need approval by the source approver; surplus can be recorded; transfers
  with unknown dispatch cost are refused or valued at catalog cost with a flag; losses appear in the
  movement report and the purchasing/transfer report.
- Depends on: R2.1 thresholds.

### R2.4 In-transit stock as a valued location — **M** — *done in session 6*
- Closes: FND-604
- Build: stock in transit shown per transfer and in total, valued at dispatch cost, with age; a
  dispatched transfer can be recalled (stock returns to source) before receipt; inventory valuation
  includes in-transit as its own line.
- Depends on: R2.3.

### R2.5 Guards on master data that hide balances — **S** — *done in session 5*
- Closes: FND-207, FND-206, FND-109
- Build: refuse switching tracking off, converting goods to a service, archiving a variant, or
  deactivating a branch while any balance ≠ 0 or any open order/transfer/shift exists; the screen
  explains what must be written off or transferred first.

### R2.6 Valuation as at a date and stock roll-forward — **M** — *done in session 7 (FND-219 is not in the register)*
- Closes: FND-512, FND-213, FND-219
- Build: inventory valuation for any past date computed from the ledger; a roll-forward per item
  and branch (opening + receipts + transfers in + returns + increases − sales − transfers out −
  write-offs = closing) that must agree with the valuation; reserved quantities visible.
- Depends on: R2.4 (in-transit line).

### R2.7 Cost edge cases — **S** — *done in session 7*
- Closes: FND-204, FND-216, FND-203, FND-205, FND-223
- Build: keep the cost basis when a balance crosses zero under the negative-stock policy; "items
  without cost" alert on the inventory page; store average cost with higher internal precision
  (display in fils); explain catalog standard cost vs moving average on the product screen.

### R2.8 Custody of returned goods not restocked — **S/M** — *done in session 7*
- Closes: FND-508, FND-507, FND-212
- Build: restock default derived from the return reason (damaged → no); goods not restocked post
  to a "damaged returns" location or create a write-off document; "customer return (outside POS)"
  increase reason removed or routed through the refund screen.

---

## Phase R3 — Selling and refund controls

### R3.1 Supervisory override on the cashier's till — **M**
- Closes: FND-301, aligns BR-026
- Build: when a cashier lacks a right (discount above limit, price override, void), a supervisor
  enters their own password on the cashier's screen; the sale stays on the cashier's shift; the
  override (who, what, how much) is stored on the sale and in the audit log and listed in a report.

### R3.2 Price override bounds and discount flags — **S**
- Closes: FND-302, FND-303
- Build: owner-set floor (not below cost, or minimum percentage of list price) and ceiling for
  price overrides; above-limit discounts flagged on the sale; the limit in force stored on the sale.

### R3.3 Zero-total sales — **S**
- Closes: FND-312
- Build: a sale with total zero requires a reason and a dedicated right; listed in the unusual
  activity report.

### R3.4 Refund segregation — **S/M**
- Closes: FND-503, FND-502, FND-504 (decision), FND-509
- Build: a cashier cannot refund a sale they rang up without approval (owner switch); approvers
  cannot bypass limit and window for their own refunds; optional customer identity field on refunds
  above the limit; exchange credit pay-back in cash requires the approve right; a pending request
  survives the requester's shift close (payable from any open shift at the branch by the approver).

### R3.5 Non-cash tender hygiene — **S**
- Closes: FND-304, FND-305, FND-505, FND-412, FND-506
- Build: every non-cash method must have a settlement account; fee rule not allowed on the cash
  method; reference mandatory for card/transfer tenders and refunds (owner switch); unreferenced
  tenders listed in the payments report.
- Decision: D6.

### R3.6 Held sales and reprints — **S**
- Closes: FND-309, FND-310, FND-311
- Build: held sales expire after an owner-set time; the resuming cashier is recorded; reprints
  logged and counted on the shift; cleared carts above a threshold logged.

### R3.7 Combined discount limit — **S**
- Closes: FND-313. Decision: D4.

---

## Phase R4 — Period, cut-off and reporting

### R4.1 One cut-off rule everywhere — **M**
- Closes: FND-317, FND-411, FND-511, FND-522, FND-306, FND-523
- Build: completion time in the merchant time zone is the single basis for every list, statement
  and report; refunds counted on their own completion date in both the sales history and the
  reports; a period-based refund register; statements take a period; the time zone is set once at
  registration and changes are audited with a warning.

### R4.2 Period close pack — **M**
- Closes: BP-525 gaps, FND-619
- Build: "close period" action for a month: produces and stores a pack (net sales, refunds,
  collections by method, fees, cash by place, closing stock valuation, open variances, open
  transfers, pending documents), locks the period against new backdated documents where dates
  exist (purchase orders and receipts get a business date), and records who closed it.
- Depends on: R2.6, R4.1.

### R4.3 Gross profit with missing costs — **S**
- Closes: FND-513, FND-514
- Build: show gross profit with the uncosted share flagged instead of hiding it; sales-by-employee
  includes online sales as "online".

### R4.4 Report access log and dashboard KPIs — **S**
- Closes: FND-518, FND-517, FND-520
- Build: report views and CSV exports audited; dashboard shows today's net sales, refunds and cash
  on hand; unusual-activity threshold configurable.

### R4.5 Supplier statement — **S**
- Closes: FND-525 (bridge until R6)
- Build: per supplier: received value by order, payments and reversals, and the running difference
  ("paid vs received"), with a period filter.

---

## Phase R5 — Access, audit trail and continuity

### R5.1 Merchant audit log screen — moved to R1.0 (done)
- Closes: FND-101, FND-114, FND-111
- Build: management screen and API for holders of the audit right: filter by date, actor, action,
  target, branch; export; refused privileged actions logged; owner sees failed sign-ins for member
  e-mails.

### R5.2 Ownership transfer and emergency freeze — **M**
- Closes: FND-102, aligns BR-020
- Build: owner-initiated transfer with password re-entry and e-mail confirmation by the new owner;
  operator-initiated transfer with reason and notification; operator action "freeze owner sessions".

### R5.3 Audit detail and price history — **S**
- Closes: FND-105, FND-208, FND-222, FND-620
- Build: before/after values for profile, catalog attribute, price, cost and settings changes;
  price and cost history tab on the product.

### R5.4 Account hygiene — **S**
- Closes: FND-103, FND-108, FND-116, FND-110
- Build: self-service password change and session list; invitation grants re-checked at
  acceptance against the inviter's current authority; branch reactivation lists restored grants for
  confirmation; lock-out notifies the account owner.

---

## Phase R6 — Supplier side (after decision D5)

### R6.1 Supplier invoices and three-way match — **L**
- Closes: FND-601, FND-614, FND-612, FND-617
- Build: supplier invoice document matched to receipts; price variance between order, receipt and
  invoice recorded and approved; stock revalued or variance written off per policy; unique supplier
  reference per supplier.

### R6.2 Payables, returns to supplier, landed costs — **L**
- Closes: FND-602 (balance side), FND-615, FND-616, FND-525
- Build: payable balance per supplier from invoices minus payments; return-to-supplier document
  that reduces stock and the payable; landed-cost allocation to receipts.

---

## Phase R7 — Online store go-live prerequisites (only if D7 = yes and a gateway is approved)

| Package | Closes | Size |
|---|---|---|
| R7.1 Unapplied online receipts ledger and resolution record | FND-701, FND-717, FND-705, FND-710 | M |
| R7.2 Gateway refund confirmation (manual "refunded at provider" with reference, then automatic when a provider supports it) | FND-501, FND-702, FND-515 | M |
| R7.3 Refund of online sales from management without a POS shift | FND-703, FND-521 | M |
| R7.4 Payout reconciliation export by provider reference | FND-704 | S |
| R7.5 Sandbox gateway disabled outside development; reservations by anonymous shoppers capped | FND-709, FND-708 | S |
| R7.6 Fulfilment ownership and ageing of paid orders | FND-706 | S |

R7.5 is cheap and should be done with R1 regardless of D7, because the sandbox creates financial
records without money.

---

## Deferred (outside the current retail target)

- **Restaurant (Chapter H, FND-801…FND-824):** all 20 findings deferred until the restaurant market
  is targeted. Before that day, the module should stay disabled by plan for retail merchants.
- **Platform billing (FND-901, FND-902, FND-909):** operator's own accounting; schedule with the
  pricing decision (OQ-022).
- **Platform merchant closing checklist (FND-904), dual control for irreversible operator actions
  (FND-906), operator offboarding (FND-907):** small; schedule after R5.
- **Tax (OQ-002), loyalty and store credit (OQ-019), offline POS (OQ-005):** not in scope.

---

## Delivery order (one session at a time; each session ends with a report to the owner)

| Session | Packages | Status |
|---|---|---|
| 1 | R1.0 audit log, R1.5 blind counts, R7.5 test-gateway guard | **Done 2026-10-13** |
| 2 | R1.1 cash-out corrections and limits, R1.6 custody roles and set-up checklist | **Done 2026-10-13** |
| 3 | R1.2 disbursement approvals (per-merchant thresholds, owner override), R1.4 variance follow-up | **Done 2026-10-13** |
| 4 | R1.3 deposits in transit and bank reconciliation | **Done 2026-10-13** |
| 5 | R2.1 adjustment approvals, R2.2 blind counts with sign-off, R2.5 master-data guards | **Done 2026-10-13** |
| 6 | R2.3 transfer losses, R2.4 in-transit location | **Done 2026-10-13** |
| 7 | R2.6 valuation as at date, R2.7 cost edge cases, R2.8 damaged returns | **Done 2026-10-13** |
| 8 | R3.1 till overrides, R3.2 price bounds, R3.3 zero-total sales | **Done 2026-10-13** |
| 9 | R3.4 refund segregation, R3.5 tender hygiene (fee reversal per method, D6), R3.6 held sales, R3.7 combined limit (D4) | **Done 2026-10-13** |
| 10 | R4.1 one cut-off rule, R4.3 profit with uncosted share, R4.4 report access log and dashboard, R4.5 supplier statement | **Done 2026-10-13** |
| 11 | R4.2 period close pack (sequential monthly close, stored pack, lock on document dates) | **Done 2026-10-13** |
| 12 | R5.2 ownership transfer and freeze, R5.3 audit detail and price history, R5.4 account hygiene | **Done 2026-10-13** |
| 13+ | R6 supplier side (after D5), R7 online go-live (after D7), platform items | |

After each session: update `docs/BUSINESS_RULES.md`, `docs/DECISIONS.md` and the finding status in
a new `docs/audit/FINDINGS_STATUS.md` (finding id → package → status → verification test), so that
Phase 2 of the audit can re-test closed findings.
