# Business Procedures Manual — Phase 1: Complete Business Procedure Audit

**System under review:** Arabat POS — multi-tenant Point of Sale and Business Management platform
(management dashboard, cashier point of sale, public online store, platform operator console).

**Perspective:** business, management, accounting and internal control. This manual deliberately
reads the software as a set of business procedures, not as code.

**Status of the system at the time of review:** built, tested with automated tests, deployed to a
staging environment only. No real payment gateway is connected, no customer is billed, no live
money moves through the system. The subject of the review is therefore the *designed and
implemented* procedure, not an operating history.

**Date of review:** 2026-10-12.

---

## Part 0 — Reading guide, limits and independence

### 0.1 Purpose of this manual

This document is the baseline for every later audit phase. It:

1. inventories every business procedure the system actually implements, end to end,
2. records, for each procedure, who may perform it, what the system checks, what it records,
   and what financial, cash and stock effects it has,
3. analyses how the procedures depend on each other,
4. evaluates each procedure against professional accounting and internal-control criteria,
5. lists findings (gaps, inconsistencies, risks, missing processes) with a stable reference
   number, so that later phases can test, remediate and close them one by one.

Nothing in the system or its data was changed during this review. No fixes were made.

### 0.2 How to read a procedure

Every procedure has a permanent reference number of the form **BP-xyz** where **x** is the domain
chapter and **yz** a sequence number inside it. Controls are numbered **CTL-xyz** and findings
**FND-xyz** in the same ranges. Numbers are never reused.

| Range | Domain chapter |
|-------|----------------|
| 1xx | A — Company, identity, access and organisation |
| 2xx | B — Product catalog and inventory |
| 3xx | C — Selling at the point of sale, and customers |
| 4xx | D — Payment methods, registers, shifts and cash custody |
| 5xx | E — Returns, refunds, exchanges, voids; management reporting |
| 6xx | F — Suppliers, purchasing and branch stock transfers |
| 7xx | G — Online store and online payments |
| 8xx | H — Restaurant operations |
| 9xx | I — Platform operation and subscriptions (the operator's side) |

Each procedure is documented with the same template: business purpose, actors and required
authority, trigger and inputs, normal flow, exceptional cases, existing controls, financial /
stock / cash effect, upstream dependencies, downstream effects, observations.

### 0.3 Four kinds of statement

Every statement in this manual is one of four kinds, marked in brackets:

- **[Verified]** — behaviour confirmed by reading the business logic, the database rules or the
  automated tests that exercise it.
- **[Inferred]** — a conclusion the review team believes but did not confirm line by line.
- **[Owner decision]** — an explicit, documented decision of the product owner (cited as
  BR-xxx, ADR-xxxx or OQ-xxx). Presented as a decision together with its residual risk, never
  as a defect.
- **[Recommendation]** — the review team's professional advice.

A procedure is never assumed correct merely because it exists in the system.

### 0.4 Evaluation lens

Each procedure was assessed against the same fixed criteria. These are assessment criteria,
not a predefined list of expected functions:

| Criterion | Question asked |
|-----------|----------------|
| Completeness | Is every transaction of this kind captured, with nothing able to bypass the procedure? |
| Occurrence / existence | Can a recorded transaction fail to correspond to a real event? |
| Accuracy, measurement, rounding | Are amounts, quantities and costs computed exactly, with explicit rounding? |
| Cut-off | Does each transaction fall into the correct day / shift / period, in the merchant's time zone? |
| Authorisation and approval | Who may initiate, who must approve, and are limits enforced by the system rather than by habit? |
| Segregation of duties | Can one person initiate, approve and record the same transaction? |
| Reconciliations | Can book figures be agreed to physical counts (cash, stock) and to third parties (banks, gateways)? |
| Audit trail and traceability | Is who-did-what-when kept, and can a figure be traced back to its source documents? |
| Immutability | Are financial and stock records append-only, with corrections as new records? |
| Adequacy of reports | Could management steer the business, and an external accountant close a period, from the reports provided? |

### 0.5 Scope: the accounting entity

The **primary accounting entity** of this manual is the **merchant** (the company that subscribes
to the platform), with its branches, employees, cash places, stock, sales and purchases.

The **platform operator** (the SaaS business that runs the software for many merchants) is a
**secondary entity**, covered in Chapter I only to the extent that it records facts about
merchants and can affect a merchant's books.

By explicit instruction of the owner, a **general ledger** (chart of accounts, journal entries,
trial balance) is **out of scope** for this phase: the system is being built now and does not
post journal entries. This manual therefore describes financial effects in the system's own
terms (cash places, stock quantities and values, sales and refund figures, fees, report
metrics) and does not propose journal entries. Where the absence of a ledger creates a control
consequence, it is noted once in the cross-cutting analysis (Part 2) and not repeated in every
procedure.

### 0.6 Sources and method

1. **Source of truth: the implemented behaviour.** The business services, the authorisation
   declared on every operation, the database rules (what is stored, what can never be updated or
   deleted, which triggers guard what), and the automated tests (which document the exceptional
   cases the builders cared about).
2. **Project documents as claims.** The business-rules register, the decision log, the progress
   log and the authentication design were used to orient the review and then verified against
   behaviour. Each discrepancy found is a finding.
3. **Screens.** The management dashboard, the cashier screens, the operator console and the
   public storefront were read to understand how staff actually experience each procedure.
4. **Roles.** Each procedure was examined from the point of view of every default role (Owner,
   Company Manager, Branch Manager, Supervisor, Cashier, Kitchen, and the platform roles
   Support, Billing, Super Admin) and of the underlying permission catalog.
5. **Static review.** The system was not run and no data was created or modified. Behaviour that
   depends on live data (for example the balance shown on a specific screen) is described from
   its rules, not observed.

### 0.7 Limits of this review and statement of independence

- **Independence is limited.** The system was built by the same engineering function that
  produced this review. To mitigate this, each procedure's behaviour was described from the
  implemented logic first and the documented rationale read afterwards; documented decisions are
  cited, not defended. The owner should treat this manual as a structured self-assessment and
  commission an external review of the highest-severity findings before go-live.
- **No operating history.** There are no real transactions, so the review could not test the
  procedures against actual data, error rates or staff behaviour.
- **No external parties were consulted.** Bank, acquirer and gateway contract terms (fees,
  settlement timing, chargebacks) were not available; findings about them are stated as risks.
- **Out of scope by instruction:** general ledger design, tax (Kuwait has no VAT today; see
  OQ-002), payroll, fixed assets, and the operator's own billing (noted as a missing process,
  not designed).
- **Coverage.** Part 1 contains the coverage matrix showing every module of the system and
  whether it was reviewed. No module was excluded.

### Table of contents

- Part 0 — Reading guide, limits and independence
- Part 1 — System map and coverage
- Part 2 — Cross-domain analysis, consolidated findings and recommendations
- Part 3 — Domain chapters
  - Chapter Domain A: Company, identity, access and organisation
  - Chapter Domain B: Product catalog and inventory
  - Chapter Domain C: Selling at the point of sale, and customers
  - Chapter Domain D: Payment methods, registers, shifts and cash custody
  - Chapter Domain E: Returns, refunds, exchanges, voids; and management reporting
  - Chapter Domain F: Suppliers, purchasing and branch stock transfers
  - Chapter Domain G: Online store and online payments
  - Chapter Domain H: Restaurant operations
  - Chapter Domain I: Platform operation and subscriptions (the SaaS operator's side)
- Appendix 1 — Consolidated findings register (by severity)
- Appendix 2 — Index of procedures

---

## Part 1 — System map and coverage

### 1.1 The business the system supports

The platform is sold to **merchants** (retailers, restaurants, small chains) who run one or more
**branches**. Each merchant has exactly one **owner** account, invites **employees**, and composes
**roles** from a fixed catalogue of 46 rights. Three applications serve three audiences:

| Application | Who uses it | What happens there |
|---|---|---|
| Management dashboard (`/manager`) | Owner, company and branch managers, back-office staff with explicit rights | Master data, employees and roles, inventory, purchasing, transfers, cash custody, refunds oversight, online store, reports, subscription |
| Point of sale (`/pos`) | Cashiers, supervisors, waiters, kitchen staff, and managers only when explicitly granted | Shifts, selling, returns, cash in/out, drawer disbursements, restaurant floor and kitchen |
| Public storefront (`/store`) | Anonymous shoppers | Browse, order, pay through a gateway, track |
| Operator console (`/platform`) | Platform operator staff only (separate identity realm) | Merchant onboarding, status, plans and subscriptions, platform audit |

### 1.2 The financial model in one page

The system has **no general ledger**. Its financial reality is kept in five record families, each
append-only, each changed through exactly one posting engine:

| Record family | What it represents | Only writer | Immutable after |
|---|---|---|---|
| **Sales** (with lines and payments) | Revenue earned, tender by tender, with product and price snapshots and cost at time of sale | The checkout engine (used by the retail till, exchanges, restaurant bills and paid online orders) | Completion |
| **Refunds** (returns, voids, exchanges) | Reductions of revenue and pay-backs per original tender | The refund engine | Completion (pending requests may be approved, rejected or withdrawn) |
| **Stock ledger** | Every quantity movement per branch and variant, with the unit cost carried and the resulting moving weighted-average cost | The inventory posting engine | Posting |
| **Cash ledger** (register drawers, branch treasuries, in-transit, bank accounts) | Where company money sits and every movement between places or out of the company (sales, refunds, drops, top-ups, deposits, transfers, expenses, supplier payments, count differences) | The cash ledger (three posting operations) | Posting; corrections are reversing records |
| **Audit log** | Who did what, when, from where | Every service | Insertion (no update or delete right exists) |

Around these sit **intent documents** that carry no money until they are converted: held sales,
restaurant orders, online orders, purchase orders, transfer requests, refund requests.

**Money** is always an integer number of fils (KWD, three decimals); rounding is half-up and
explicit. **Costs** are moving weighted averages per branch. **Periods** are merchant-local days in one
fixed time zone.

What does **not** exist, and matters for an accountant (each is a numbered finding in Part 2):
supplier invoices and payables, bank reconciliation, period closing and locked periods, point-in-time
stock valuation, a merchant-readable audit trail, gateway settlement reconciliation, and any form of
billing between the operator and its merchants.

### 1.3 Core business cycles and where they are documented

| Cycle | Procedures (in order) |
|---|---|
| **Set-up and access** | BP-101 register company → BP-110 branches → BP-118 roles → BP-113/114 invite and accept → BP-403 default cash places and payment methods → BP-201…206 catalog → BP-209 opening stock |
| **Daily cashier cycle (order-to-cash, retail)** | BP-104 POS sign-in → BP-405 open shift by count → BP-302…307 sell → BP-406/407 cash in/out, drops → BP-412/413 drawer disbursements → BP-501…506 returns → BP-408 close shift by count → BP-410 treasury count → BP-411 bank deposit |
| **Restaurant cycle** | BP-806 open order → BP-807/808 items to kitchen → BP-809 kitchen → BP-810/811 cancellations and waste → BP-813/814 move/merge → BP-815 bills through the checkout → BP-816 reports |
| **Online cycle** | BP-701…703 configure → BP-705 shopper checkout → BP-706 reservation → BP-707/708 payment → sale → BP-712 fulfilment → BP-714 refund via POS |
| **Procure-to-stock** | BP-601 suppliers → BP-603…605 order and approve → BP-606 receive into stock at cost → BP-609 pay supplier in cash → BP-615 reports |
| **Inter-branch stock** | BP-610 request → BP-611 approve → BP-612 dispatch (in transit) → BP-613 receive with shortage write-off |
| **Inter-branch cash** | BP-415 send → in transit → receive with difference |
| **Stock control** | BP-210…212 increases, write-offs, counts → BP-214/215 levels and history → BP-519 valuation report → BP-219 reconciliation (what is possible today) |
| **Management review** | BP-514…524 reports and dashboard → BP-525 period close as an external accountant would attempt it |
| **Operator cycle** | BP-906 onboard → BP-912 subscription → BP-913/914 limits and features → BP-907…909 suspend / reactivate / close → BP-916 platform audit |

### 1.4 Coverage matrix

Every module of the system was assigned to a chapter and reviewed. Counts are of procedures (BP),
distinct controls (CTL) and findings (FND) documented in that chapter.

| System module | Chapter | Reviewed | BP | FND | Notes on coverage |
|---|---|---|---|---|---|
| Merchants, registration, company profile | A | Yes | | | |
| Authentication, sessions, POS lock, password recovery | A | Yes | | | |
| Employees, invitations, roles, permission catalogue | A | Yes | | | Full permission catalogue in A.1.2 |
| Branches | A | Yes | | | |
| Audit log | A | Yes | 21 | 17 | Reader side also in chapter I |
| Catalog (products, variants, prices, costs) | B | Yes | | | |
| Inventory (ledger, adjustments, counts, valuation, reservations, consumption) | B | Yes | 19 | 19 | |
| Sales / checkout engine, held sales, selling policy | C | Yes | | | |
| Customers | C | Yes | 14 | 18 | |
| Payment methods, bank accounts, cash ledger | D | Yes | | | |
| Registers and shifts | D | Yes | | | |
| Cash custody (treasuries, deposits, cash transfers, expenses, supplier payments, cutover) | D | Yes | 18 | 22 | |
| Refunds, voids, exchanges, approvals | E | Yes | | | |
| Reports and dashboard | E | Yes | 25 | 25 | Cash reports read with chapter D |
| Suppliers and purchasing | F | Yes | | | |
| Branch stock transfers | F | Yes | 16 | 23 | |
| Online store, storefront, gateways, online payments | G | Yes | 16 | 20 | Only the sandbox gateway exists |
| Restaurant | H | Yes | 17 | 20 | |
| Platform administration, operators | I | Yes | | | |
| Subscriptions and plan limits | I | Yes | 18 | 16 | |
| Health endpoints, file storage, e-mail transport | — | Not applicable | — | — | Technical infrastructure with no business procedure |
| **Total** | | | **164** | **180** | 427 distinct controls identified |

Reviewed but not executed: no chapter ran the application, its tests or its database. End-to-end
browser tests were read for the user journey only. See each chapter's coverage statement for the
specific items its author did not read line by line.

### 1.5 Roles at a glance

The full catalogue of rights and the default role templates are in **A.1.2**. For orientation:

| Default role | Typical holder | What they can do financially | What they cannot do |
|---|---|---|---|
| **Owner** | The proprietor | Everything, at every branch, in both merchant applications; the only holder of cash custody, bank deposit and audit rights out of the box | Cannot be demoted or deactivated; cannot be removed; no ownership transfer exists (FND-102) |
| **Company Manager** | General manager, accountant | All management functions company-wide: catalog, prices and costs, purchasing approval, transfer approval, financial reports, payment settings, roles, online store; may refund-approve | No POS access unless granted; no cash custody or deposit unless granted |
| **Branch Manager** | Branch head | Branch-scoped management: employees, inventory adjustments, purchase orders and receiving, transfers, sales and inventory reports, online orders, refund approval | No purchasing approval, no transfer approval, no financial reports, no price changes |
| **Supervisor** | Shift leader | Sell, discount above the limit, override prices, void, refund and approve refunds, cash in/out and drawer disbursements, see all shifts, void restaurant items | No management application access; no counts of treasuries |
| **Cashier** | Till operator | Sell, discount within the limit, refund within the limit, open and close own shift, take restaurant orders | No cash in/out (removed by owner decision), no voids, no price overrides, no reports |
| **Kitchen** | Cook | Kitchen display only | Nothing financial |
| **Platform Support / Billing / Super Admin** | Operator staff | Merchant status, plans, subscriptions; super admin alone may close a merchant | Never see a merchant's sales lines, customers or cash |

### 1.6 Document numbering

Documents visible to staff carry per-merchant sequential numbers, which is a basic completeness
control: receipt numbers per branch (gap-free), refund receipts, customer numbers (C-), purchase
orders, transfers, expenses (EX-), supplier payments (SP-). Stock adjustments, cash counts and online
orders carry system identifiers or tracking tokens rather than human document numbers (see
FND-220, FND-421).

---

## Part 2 — Cross-domain analysis, consolidated findings and recommendations

This part reads the nine chapters together. It does not repeat the chapters; it names the patterns
that recur across them, ranks the findings, separates what the owner already decided from what the
system is missing, and proposes an order of remediation. Every statement cites the chapter findings
it rests on.

### 2.1 What the system does well (verified strengths to preserve)

1. **Single posting engines.** Revenue, refunds, stock and cash each change through exactly one
   engine, all-or-nothing, with row-level locking and a fixed lock order (BP-216, BP-307, BP-416,
   BP-503). This is the single most valuable control in the system and should not be weakened by any
   later feature.
2. **Append-only financial records enforced by the database**, not only by application code: sales,
   payments, refunds, stock movements, cash entries and the audit log cannot be updated or deleted by
   the application's own database role (A.6, B.6, C.6, D.6, E.6). Corrections are reversing records.
3. **Exact money.** Integer fils, half-up rounding per line, discount allocation without lost fils,
   fees frozen per payment (BP-302, BP-303, BP-307, BP-401).
4. **Authority is backend-enforced and fail-closed.** Every operation declares a right; an undeclared
   route stops the system from starting; rights are re-read from the database on every request;
   branch scoping is real; nobody can grant beyond their own authority (BP-120, BP-117, BP-118).
5. **Custody model for cash.** Drawers, treasuries, in-transit and bank places; shifts opened and
   closed with a count; differences attributed to a shift or to "between shifts"; forced closes
   distinguished from counted closes (BP-405…BP-410).
6. **Separation of intent and money.** Held sales, restaurant orders, online orders and purchase
   orders never carry money until converted by an engine (ADR-0016, ADR-0073, ADR-0077).
7. **Honest documentation of what is not built.** The open-questions register (OQ-xxx) is accurate
   about tax, payables, billing, gateways and offline selling.

### 2.2 Recurring patterns of weakness

The 180 findings cluster into nine themes. Each theme is a root cause; fixing the root cause closes
several findings at once.

**Theme 1 — Recorded but not reviewable (audit trail).** The system writes a detailed audit log that
no merchant user can read (FND-101). Consequently every "audited" control in this manual, from
price overrides (BP-305) to forced shift closes (BP-409) to refund approvals (BP-506), is a
*recording* control, not a *detective* control, until a merchant-side audit screen exists. Related:
audit entries without before/after values (FND-105, FND-208, FND-620, FND-817), refused privileged
actions not logged (FND-111), report access not logged (FND-518), kitchen status not logged
(FND-811).

**Theme 2 — Single-person financial actions without limits or approval.** Stock adjustments and
counts (FND-201, FND-202), cash-out "correction/other" (FND-407), expenses and supplier payments
(FND-408, FND-602), transfer shortage write-offs (FND-603), price overrides (FND-302), zero-total
sales (FND-312), opening balances by count (FND-405), supplier payments against any order
(FND-602), restaurant item voids after service (FND-808). The system has excellent *authorisation*
(who may act) but almost no *approval* (a second person for material amounts) and no *limits*
(amount or quantity thresholds). The only approval workflows that exist are purchase orders,
transfers at the source, and refunds above a limit or outside a window.

**Theme 3 — No reconciliation to the outside world.** Bank book balances are never agreed to bank
statements (FND-406); deposits are credited on the depositor's word; acquirer fees are configured
estimates (FND-413, FND-718); gateway payouts cannot be matched to online sales (FND-704); money
collected for flagged online orders is in no ledger at all (FND-701, the one Critical finding);
gateway refunds can never be confirmed (FND-501, FND-702). Inside the company, differences found at
counts have no follow-up or settlement process (FND-404, FND-410).

**Theme 4 — Period and cut-off are not first-class.** There is one merchant time zone (FND-306,
FND-523); lists and reports cut periods differently (FND-317, FND-411, FND-511, FND-522);
documents have no business date separate from entry time (FND-619, FND-712); stock valuation exists
only "as of now" (FND-512, FND-213); purchasing reports mix "as of now" with period figures
(FND-621); there is no period close and no lock on past periods (BP-525). An external accountant
cannot close a month from the reports without extracting raw data (BP-525).

**Theme 5 — Stock value can move without a movement.** Switching tracking off hides a balance
(FND-207), transfer shortages vanish without a write-off posting (FND-603, FND-211), in-transit stock
is in no branch and is unvalued (FND-604), negative balances are valued at zero and the cost basis is
discarded on replenishment (FND-204), restaurant waste bypasses the adjustment document (FND-210),
returned-not-restocked goods have no custody record (FND-508), items can be stocked without a cost
(FND-216). The ledger itself is sound; the leaks are at its edges.

**Theme 6 — Supplier side is cash-only.** No supplier invoice, no three-way match, no payable
balance, no return to supplier, no landed cost, no payment matched to a delivery (FND-601, FND-602,
FND-614, FND-615, FND-616, FND-525). Stock is valued at the agreed order cost, not the invoiced cost.
The owner left this open deliberately (OQ-018); it is the largest missing process on the merchant
side.

**Theme 7 — Unbilled revenue has no owner.** Restaurant orders can stay open across shifts and days
with no management list, ageing or cut-off (FND-801, FND-802, FND-813); paid online orders awaiting
fulfilment have no accountable person or ageing (FND-706); held sales never expire (FND-309);
pending refund requests die with the requester's shift (FND-509).

**Theme 8 — Segregation of duties is possible but not configured.** The role model allows good
segregation, but default templates put every custody right in the owner alone (FND-113, FND-422),
let supervisors both create and approve refunds (FND-502), let the same person order and receive
(FND-606), request and dispatch and receive transfers (FND-605), and let any order-taker bill any
table (FND-810). Refunds within the limit can be made by the cashier who sold, from their own drawer,
with no customer verification (FND-503). There is no supervisory override on another person's till
(FND-301): the supervisor must take over the sale on their own shift, which moves the cash and the
attribution.

**Theme 9 — Documentation drift.** Twenty-two findings are of the kind "the rule says X, the system
does Y" (for example BR-026 manager override, BR-020 ownership transfer, BR-104 write-off, blind
closing wording, restaurant bill discounts on screen). None is dangerous alone; together they mean
the business-rules register cannot yet serve as the authoritative control description for an
auditor. Each is listed in the chapters under "Inconsistency (doc vs behaviour)".

### 2.3 The highest-severity findings

One Critical and twenty-two High findings. These are the items the owner should decide on before
any merchant handles real money through the system.

| Id | Finding | Why it matters in one line | Theme |
|---|---|---|---|
| **FND-701** (Critical) | Money collected for "needs attention" online orders exists in no ledger | Gateway payouts will exceed recorded collections with no trace; the bank balance in the system and the real bank diverge | 3 |
| FND-406 | Bank balances never reconciled; deposits credited on the depositor's word | Cash recorded as deposited may never reach the bank, undetectably | 3 |
| FND-407 | Cash-out "correction/other" removes cash with no destination or approval | A drawer can be emptied and still close "balanced" | 2 |
| FND-408 | Disbursements have no limits, approval or link to what is owed | Fictitious or duplicate expenses and supplier payments | 2, 6 |
| FND-602 | Supplier payments unbounded and unmatched | Same order paid twice; prepayment without goods | 6 |
| FND-601 | No supplier invoice, no three-way match | Stock and cost of sales valued at agreed, not invoiced, cost | 6 |
| FND-603 | Transfer shortage write-off is self-approved and never posted | Inter-branch shrinkage laundered as "discrepancy" | 2, 5 |
| FND-604 | Stock in transit is unvalued, unaged and cannot be recalled | Month-end stock understated by goods on the road | 5 |
| FND-201 | Stock adjustments have no approval, limit or segregation | Theft or unrecorded sales concealed by one branch manager | 2 |
| FND-207 | Switching tracking off hides a stock balance without a movement | Stock value removed from the books silently | 5 |
| FND-512 | Inventory valuation only "as of now" | No closing stock for any past period | 4 |
| FND-501 / FND-702 | Gateway refunds can never be confirmed; stock restocked while revenue stays | Overstated revenue on every online return once a gateway is live | 3 |
| FND-703 | Paid online orders refundable only from a POS by a cashier with an open shift | Online returns depend on a till; customer has no receipt number | 7 |
| FND-704 | No reconciliation of gateway payouts to online sales | Bank balance is an accrued receivable, never confirmed | 3 |
| FND-801 | Open restaurant orders: no visibility, ageing or cut-off | Food served and never billed; walk-outs invisible | 7 |
| FND-802 | Orders on a deactivated table disappear while staying open | Unbilled revenue hidden by a configuration change | 7 |
| FND-806 | A bill cannot be paid when ingredient stock is insufficient | Money for served food cannot be collected at the till | 5 |
| FND-808 | Served-then-voided items leave no stock or revenue trace | Classic hospitality fraud path with no second control | 2 |
| FND-101 | Audit trail cannot be read by the merchant | Every detective control is blind | 1 |
| FND-102 | No ownership transfer or succession | Loss of the owner = loss of control; credential sharing | 8 |
| FND-904 | Closing or suspending a merchant ignores open shifts, cash and stock | Irreversible closure with unaccounted balances | — |
| FND-901 | No billing, invoicing or receivables for subscriptions (operator entity) | The operator has no system record of its own revenue | — |

### 2.4 Owner decisions that the review recommends revisiting

These are documented decisions, not defects. Each is presented with the residual risk the review
sees; the owner may confirm them as they stand.

| Decision | Where recorded | Residual risk observed | Findings |
|---|---|---|---|
| Expected cash is shown to the cashier at closing (no blind count) | OQ-015 | Counts converge to the expected figure; shortages hidden by "corrections" | FND-401, FND-407 |
| Cashiers lost cash in/out; supervisors keep it, including "correction" without approval | ADR-0090 / BR-079 | Concentrates an unlimited cash-out right in the supervisor | FND-407, FND-416 |
| Default templates give cash custody and deposits to nobody but the owner | ADR-0090 | Owner performs all custody work or shares credentials | FND-113, FND-422 |
| No payable balances; supplier payments are cash disbursements | BR-087 / OQ-018 | Overpayment, duplicate payment, no three-way match | FND-601, FND-602, FND-525 |
| Processing fees are configured estimates, never reversed on refunds | OQ-016 / OQ-026 | Fee totals are not acquirer figures; margins misstated | FND-413, FND-524, FND-718 |
| Discount limit applied per discount, not combined (≈19 % effective) | OQ-024 | Limit is weaker than it reads | FND-313 |
| Item price at payment time, modifier surcharge at ordering time | OQ-023 | Amount due of open orders changes with price edits | FND-803 |
| Refund approvers bypass limit and window for their own refunds | ADR-0059 | Supervisor holds both create and approve | FND-502 |
| Exchange credit may be paid back in cash | ADR-0058 | Card-to-cash conversion path | FND-504 |
| Returns need the receipt, same branch only | OQ-017 | Operationally strict; low control risk | — |
| Weighted average, not FIFO | ADR-0043 / OQ-014 | Acceptable; confirm with the external accountant | FND-203, FND-204 |
| Revenue of online orders recognised at payment confirmation | ADR-0077 | Paid-unfulfilled orders carry no owner | FND-706 |
| No automatic billing; lapsed subscriptions never block | ADR-0082 / BR-155 | Operator revenue unrecorded; trial has no consequence | FND-901, FND-902 |
| Suspension revokes sessions but online payments keep completing | BR-153 | Sales created for merchants who cannot act | FND-912 |
| No e-mail verification at registration | OQ-025 | Address squatting | FND-104 |
| No tax configuration | OQ-002 | Not a risk today in Kuwait; a redesign risk later | — |

### 2.5 Missing processes (not designed, not decided)

Processes that a business of this kind normally runs and that the system neither supports nor
documents as deliberately excluded:

1. Bank reconciliation and deposit confirmation (FND-406).
2. Period close: locked periods, closing stock as at a date, a refund register by period, one cut-off
   rule for every list and report (FND-512, FND-511, FND-411, BP-525).
3. Supplier invoices, payables and returns to supplier (FND-601, FND-615).
4. Variance follow-up and settlement for cash and stock differences (FND-404, FND-202).
5. Gateway settlement reconciliation and a resolution record for unapplied online receipts
   (FND-701, FND-704, FND-717).
6. Merchant-side audit log review (FND-101) and a price/cost history (FND-222).
7. Ownership transfer and emergency freeze (FND-102); operator offboarding (FND-907).
8. Management of unbilled revenue: open restaurant orders, paid-unfulfilled online orders, held
   sales (FND-801, FND-706, FND-309).
9. Custody of returned goods not restocked and of waste (FND-508, FND-805).
10. Operator billing, invoicing, collection and data retention after closing (FND-901, FND-911).

### 2.6 Recommended order of remediation

The review does not implement anything. It proposes this order so that the next phases can be
scoped. Each step names the findings it closes.

**Step 1 — Before any real money (prerequisites for go-live).**
FND-701 (unapplied online receipts), FND-406 (deposit confirmation and a minimal bank
reconciliation), FND-407 (restrict and cap cash-out corrections), FND-408/FND-602 (approval
thresholds and paid-to-date on orders), FND-603 (post transfer losses), FND-207 (refuse hiding
balances), FND-101 (merchant audit screen), FND-102 (ownership transfer), FND-904 (closing checklist
for a merchant), FND-501/FND-702 (gateway refund confirmation) if a gateway goes live.

**Step 2 — Before the first month-end.**
FND-512 (valuation as at a date), one cut-off rule everywhere (FND-317, FND-411, FND-511, FND-522),
business dates on documents (FND-619), period lock, FND-604 (in-transit as a location), FND-201/202
(adjustment approval and blind counts), FND-404 (variance follow-up).

**Step 3 — Restaurant and online operations.**
FND-801/802/806/808 (open-order management, served-item voids, stock exceptions at billing),
FND-703/704/706 (online refunds from management, payout reconciliation, fulfilment ownership).

**Step 4 — Segregation and configuration guidance.**
Revised default templates and an owner-facing segregation checklist (FND-113, FND-422, FND-502,
FND-503, FND-605, FND-606, FND-810), a supervisory override on another person's till (FND-301),
price override bounds (FND-302).

**Step 5 — Supplier side (OQ-018 decision first).**
Supplier invoice and matching, payable balances, returns to supplier, landed costs (FND-601, FND-614,
FND-615, FND-616, FND-525).

**Step 6 — Documentation alignment.** Correct every "doc vs behaviour" finding in the business-rules
register so that it can serve as the control description for auditors (Theme 9).

### 2.7 What the next audit phase should test

Phase 1 was a static review. Phase 2 should execute, on a seeded test company, the following
walk-throughs and compare the results with the procedures in Part 3:

1. A full cashier day: open by count, sales with every tender, discounts at and above the limit, a
   price override, a void, a refund within and above the limit, cash out "correction", a drop, an
   expense, a close with shortage; then reconcile the drawer statement, the shift report, the payments
   report and the discrepancy report to each other (BP-405…BP-417, BP-516, BP-518).
2. A procure-to-stock cycle with partial deliveries, a close with open quantities and two supplier
   payments against the same order; then reconcile inventory valuation to the movement report
   (BP-603…BP-609, BP-219, BP-519, BP-520).
3. A branch transfer with a shortage; then look for the missing value anywhere in the reports
   (BP-610…BP-613, FND-603, FND-604).
4. An online order paid after cancellation, and a refund of a paid online order; then compare bank
   balance, payments report and the order list (BP-707…BP-714, FND-701, FND-702).
5. A restaurant evening with an order left open across a shift close, an item voided after service,
   and a bill with insufficient ingredient stock (BP-806…BP-817).
6. A month-end attempt by an external accountant using only the reports and CSV exports (BP-525).
7. Role walk-throughs: each default role attempts every operation in the authority matrices of
   sections A.1 to I.1; record every success that the matrix says should fail and vice versa.

---

## Part 3 — Domain chapters

Each chapter follows the same structure: scope and sources, roles and authority matrix, procedures, interdependencies, findings, documented owner decisions, technical mapping appendix.

---

## Chapter A: Company, identity, access and organisation

### A.0 Scope and sources reviewed

**Business purpose.** This domain is the foundation on which every financial and stock procedure of the system rests: it decides *which company* a record belongs to, *which person* performed an action, and *whether that person was allowed to*. It covers how a merchant company comes into existence (self-registration or platform onboarding), how the company profile and its branches are maintained, how owners, managers and cashiers sign in to the management application and to the point of sale, how the till is locked when unattended, how passwords are recovered, how employees are brought in (by invitation only), how their roles and branch assignments are granted and withdrawn, how roles themselves are composed from a fixed catalogue of rights, and what the system writes to its audit trail about all of this. From an audit standpoint, the controls here determine the reliability of every "who / when / where" attribute on sales, refunds, cash counts and stock movements in the other chapters.

**Files and screens reviewed (technical names allowed here).**
- API, merchants: `merchants.controller.ts`, `merchants.service.ts`, `provision.ts`, `merchants.schema.ts`.
- API, authentication: `auth.controller.ts`, `registration.service.ts`, `login.service.ts`, `session.service.ts`, `session-policy.ts`, `session-context.service.ts`, `db-session.resolver.ts`, `ticket.service.ts`, `password.service.ts`, `password-reset.service.ts`, `pos-lock.service.ts`, `rate-limiter.service.ts`, `platform-auth.service.ts`, `auth.schema.ts`; tests `auth.int.test.ts`, `hardening.int.test.ts`.
- API, identity and access: `iam.schema.ts`, `access.repository.ts`, `employees.service.ts`, `roles.service.ts`, `invitation-acceptance.service.ts`, `iam.controller.ts`, `invitations.controller.ts`; test `iam.int.test.ts`; `packages/permissions/src/{catalog,templates,evaluate}.ts` and `evaluate.test.ts`.
- API, branches: `branches.controller.ts`, `branches.service.ts`, `branches.schema.ts`.
- API, audit: `audit.schema.ts`, `audit.service.ts`; the platform-side reader in `platform.controller.ts` / `platform.service.ts` and the SQL function `platform_audit`.
- Kernel: `access.guard.ts`, `assert.ts`, `route-access.auditor.ts`.
- Migrations: `0002_identity.sql`, `0003_identity_rls.sql`, `0004_employees.sql`, `0005_employees_rls.sql`, `0028_platform_rls.sql` (merchant status trigger, audit function), `0030_audit_hardening.sql`, `0031_session_lock.sql`, `0033_cash_custody_rules.sql` (system audit rows); seed `002-role-templates.ts`; CLI `create-operator.ts`.
- Contracts: `auth.ts`, `merchants.ts`, `organization.ts`.
- Web: manager `CompanySettingsPage`, `BranchesPage`, `EmployeesPage`, `EmployeeDetailPage`, `AssignmentsEditor`, `RolesPage`, `DashboardPage`, `LoginPage`, `RegisterForm`, `app/navigation.ts`; POS `LoginPage`, `POSLayout` (idle lock); E2E test names in `e2e/auth.spec.ts`, `e2e/employees.spec.ts`.
- Documentation used for orientation only: `docs/AUTH.md`, `docs/BUSINESS_RULES.md` §1–3, `docs/DECISIONS.md` (ADR-0001, 0004, 0006, 0007, 0008, 0011, 0024–0034, 0037, 0067, 0080, 0085, 0086), `docs/DATABASE.md` §5, `docs/PROGRESS.md`, `docs/ROUTES.md`.

**Coverage statement.** Not reviewed in depth: the shared web-core sign-in forms (`MerchantLoginForm`, `AcceptInvitationForm`, `ForgotPasswordForm`) beyond their use in the pages above; the platform console screens (they belong to the platform chapter, only operator *authentication* is covered here); the database service internals that set the row-level-security context; the e-mail transport. Platform-side merchant creation (`createMerchant`) is described only as an upstream path into this domain. The customer-privacy rules of the audit log (ADR-0067) belong to the Customers chapter.

---

### A.1 Roles and authority matrix

#### A.1.1 How authority is decided (summary of the model, [Verified] in code and unit tests)

- A **permission** is a fixed right defined by the software (46 keys, see A.1.2). Merchants cannot invent rights; they can only group them into **roles**.
- Each permission has a **scope**: *company-wide* rights (e.g. managing roles, changing company settings) only work when the role is granted "at all branches"; *branch* rights work at the branch where the role was granted, or everywhere if granted "at all branches".
- A **role assignment** is: this employee holds this role at this branch (or at all branches). An employee may hold different roles at different branches (BR-024).
- The **owner** is not a role: the owner membership implicitly holds every right at every branch and in both merchant applications. Exactly one owner exists per company (enforced by a database uniqueness rule) and the owner membership cannot be in any status other than active (database check).
- Every right is evaluated on **every request** from the database, never from anything the browser sends. A right granted at a deactivated branch confers nothing. An inactive membership or a suspended/closed company confers nothing, even to the owner.
- The route-level gate checks the right "at the branch named in the request" or, when no branch is named, "held somewhere"; services then re-check per object and filter lists by the branches where the right is held. Any route without an explicit access declaration prevents the system from starting at all (fail-closed).

#### A.1.2 Permission catalogue in plain business words

Legend for default role templates: **CM** = Company Manager (typically granted at all branches), **BM** = Branch Manager (per branch), **SV** = Supervisor (per branch), **CA** = Cashier (per branch), **KT** = Kitchen staff (per branch). The **Owner** holds everything implicitly and is omitted. Scope: *Co.* = company-wide, *Br.* = per branch. Other chapters refer to the keys in this table.

| Permission key | Scope | What it allows, in business terms | CM | BM | SV | CA | KT |
|---|---|---|---|---|---|---|---|
| `manager.access` | Br. | Sign in to the management application and see that branch's data there | ● | ● | | | |
| `pos.access` | Br. | Sign in to the point of sale at that branch (never implied by management rights, BR-014) | | | ● | ● | ● |
| `sales.create` | Br. | Ring up sales at the till | | | ● | ● | |
| `sales.read` | Br. | View sales history and receipts | ● | ● | ● | | |
| `sales.discount` | Br. | Give discounts up to the company's discount limit (default 10 %) | | | ● | ● | |
| `sales.discount.override_limit` | Br. | Give discounts above the limit (or approve a cashier's request) | | | ● | | |
| `sales.price_override` | Br. | Change the selling price of a line at the till | | | ● | | |
| `sales.void` | Br. | Cancel a sale of the current shift that has no returns | | | ● | | |
| `refunds.create` | Br. | Process returns and refunds against a receipt | | | ● | ● | |
| `refunds.approve` | Br. | Approve refunds above the refund limit or outside the return window | ● | ● | ● | | |
| `registers.manage` | Br. | Configure tills (registers), their tolerance and who may use them | ● | ● | | | |
| `shifts.operate` | Br. | Open and close one's own shift on a register | | | ● | ● | |
| `shifts.view_all` | Br. | See every shift at the branch (monitoring, force-close per cash rules) | ● | ● | ● | | |
| `cash.move` | Br. | Record cash in / cash out, drops and top-ups, pay expenses from the drawer | | | ● | | |
| `cash.custody` | Br. | Count treasuries and registers, move cash register ↔ treasury, branch-to-branch transfers, see total cash on the dashboard | | | | | |
| `cash.deposit` | Br. | Deposit cash from a drawer or treasury into a bank account (in addition to the usual right) | | | | | |
| `catalog.read` | Br. | View products and categories | ● | ● | ● | ● | ● |
| `catalog.manage` | Co. | Create and edit products and categories | ● | | | | |
| `catalog.prices.manage` | Co. | Change prices and costs; see costs | ● | | | | |
| `inventory.read` | Br. | View stock quantities | ● | ● | ● | | |
| `inventory.adjust` | Br. | Record stock adjustments and counts | ● | ● | | | |
| `inventory.transfer` | Br. | Request, dispatch and receive branch transfers | ● | ● | | | |
| `inventory.transfer.approve` | Br. | Approve branch transfers at the source | ● | | | | |
| `purchasing.read` | Br. | View suppliers and purchase orders | ● | ● | | | |
| `purchasing.manage` | Br. | Create suppliers and purchase orders | ● | ● | | | |
| `purchasing.approve` | Br. | Approve purchase orders (never one's own, except the owner) | ● | | | | |
| `purchasing.receive` | Br. | Receive goods against an approved order | ● | ● | | | |
| `customers.read` | Br. | Search and pick customers (cashiers see name, number, phone only) | ● | ● | ● | ● | |
| `customers.create` | Br. | Create a basic customer profile | ● | ● | ● | ● | |
| `customers.manage` | Br. | Edit customers, notes and status; see spending | ● | ● | ● | | |
| `restaurant.manage` | Br. | Configure tables, areas, stations; company-wide: module switch, modifiers, recipes | ● | ● | | | |
| `restaurant.orders` | Br. | Take dine-in, takeaway and pickup orders | | | ● | ● | |
| `restaurant.void_item` | Br. | Cancel items already sent to the kitchen (with reason) | ● | ● | ● | | |
| `kitchen.access` | Br. | Use the kitchen display | | | ● | | ● |
| `online.manage` | Co. | Configure the online store, listings, online payment methods, reconciliation | ● | | | | |
| `online.orders` | Br. | View and fulfil online orders of the fulfilment branch | ● | ● | | | |
| `reports.sales` | Br. | Sales reports | ● | ● | | | |
| `reports.financial` | Br. | Payments, cash, shift and expense reports; gross profit | ● | | | | |
| `reports.inventory` | Br. | Inventory and purchasing reports, valuation | ● | ● | | | |
| `payments.settings` | Co. | Configure payment methods, fees and bank accounts | ● | | | | |
| `employees.read` | Br. | View employees and invitations (of the branches where held) | ● | ● | | | |
| `employees.manage` | Br. | Invite, edit, (de)activate employees and assign roles at that branch | ● | ● | | | |
| `roles.manage` | Co. | Create, edit and delete roles | ● | | | | |
| `branches.read` | Br. | View branch information | ● | ● | | | |
| `branches.update` | Br. | Edit branch details and receipt texts | ● | ● | | | |
| `branches.manage` | Co. | Create, activate and deactivate branches | ● | | | | |
| `merchant.settings.read` | Co. | View company settings and the subscription | ● | | | | |
| `merchant.settings.update` | Co. | Change company settings | ● | | | | |
| `audit.read` | Co. | View the audit log (**no screen or API exists for merchants — see FND-101**) | ● | | | | |

Observations on the templates [Verified]:
- No default management template holds `pos.access`, so managers must be explicitly given a till role to sell (BR-014 honoured).
- `cash.custody` and `cash.deposit` are held by **no** template: out of the box only the owner can count a treasury, move cash between register and treasury, deposit to the bank or see total cash on hand. This is referenced for the Cash chapter (FND-113).
- `cash.move` was removed from the cashier template by owner decision (ADR-0090 / BR-079); supervisors keep it.
- The supervisor template holds both `refunds.create` and `refunds.approve`; the "nobody approves their own refund" rule (BR-092) is enforced in the Refunds domain, not by the role model.
- The branch manager template deliberately lacks `purchasing.approve`, `inventory.transfer.approve` and `reports.financial` (segregation between ordering/receiving and approving; and between branch operations and financial reporting).

#### A.1.3 Operation × authority matrix for this domain

"Branch scoping" states whether the right must be held at the specific branch concerned.

| Operation | Required authority (plain words) | Owner | CM | BM | SV | CA | KT | Platform operators | Branch scoping |
|---|---|---|---|---|---|---|---|---|---|
| Register a new company (self-service) | Nobody: public form | n/a | | | | | | n/a | n/a |
| Create a company on behalf of an owner | Platform "support" or "super admin" role | | | | | | | support, super admin | n/a |
| View company profile / subscription | View company settings | ● | ● | | | | | — | company-wide |
| Edit company profile | Change company settings | ● | ● | | | | | — | company-wide |
| Change company status (suspend/close) | Platform operator with reason (database refuses otherwise) | | | | | | | support/super admin (close: super admin only) | n/a |
| Sign in to management app | Management access at ≥ 1 active branch | ● | ● | ● | | | | — | any branch |
| Sign in to POS | POS access at the chosen branch | ● | | | ● | ● | ● | — | that branch |
| Switch POS branch | POS access at the target branch | ● | | | ● | ● | ● | — | target branch |
| Switch management ↔ POS | The target interface's right | ● | (POS only if granted) | (POS only if granted) | (mgmt only if granted) | (mgmt only if granted) | | — | as above |
| Switch company | An eligible membership in the other company | any member | | | | | | — | n/a |
| Lock / unlock POS | Own live POS session + own password | ● | | | ● | ● | ● | — | n/a |
| Sign out, recover own password | Account holder | any user | | | | | | — | n/a |
| List branches | View branch information | ● | ● | ● (only assigned) | | | | — | assigned branches |
| Create branch | Create/deactivate branches | ● | ● | | | | | — | company-wide |
| Edit branch details | Edit branch information | ● | ● | ● | | | | — | that branch |
| Deactivate / reactivate branch | Create/deactivate branches | ● | ● | | | | | — | company-wide |
| List employees / invitations | View employees | ● | ● | ● (own branches) | | | | — | branches where held |
| Invite employee | Manage employees at every branch of every granted role **and** hold every right of those roles there | ● | ● (not till roles) | ● (own branch, only roles within own rights) | | | | — | per assignment |
| Resend / revoke invitation | Same as inviting with the invitation's grants | ● | ● | ● | | | | — | per assignment |
| Accept invitation | Holder of the e-mailed single-use link | invitee | | | | | | — | n/a |
| Edit employee profile fields | Manage employees, and the target must be within the actor's authority (never the owner, never oneself) | ● | ● | ● (own branch staff) | | | | — | target's branches |
| Deactivate / reactivate employee | Same as above | ● | ● | ● | | | | — | target's branches |
| Change employee role assignments | Same as above, plus every new grant must be within the actor's authority | ● | ● | ● | | | | — | per assignment |
| Send employee a password-reset e-mail | Same as "edit employee" | ● | ● | ● | | | | — | target's branches |
| View roles and the permission catalogue | View employees | ● | ● | ● | | | | — | any |
| Create / edit role | Manage roles, held company-wide; only rights the editor holds company-wide | ● | ● | | | | | — | company-wide |
| Delete role | Manage roles; role not in use; role within editor's rights | ● | ● | | | | | — | company-wide |
| Read merchant audit trail | View the audit log — **not exposed** | (no) | (no) | | | | | operators see only platform/operator events | — |
| Sign in to platform console | Operator password + authenticator code | | | | | | | all operator roles | n/a |
| Create / re-key operator | Command-line tool run by the platform's database owner | | | | | | | engineering, not the console | n/a |

---

### A.2 Procedures

#### BP-101 Merchant self-registration (company creation by the owner)
- **Business purpose:** Let a business start using the system without any manual onboarding: one form creates the company, its primary branch, the owner identity and all defaults.
- **Actors and required authority:** Anyone on the public registration page (no sign-in). Platform operators have a parallel path (BP-109 note) that reuses the same provisioning.
- **Trigger / inputs:** Company name (Arabic or English, at least one), optional legal name, default language, owner full name, owner e-mail, owner password (10–128 characters). The registration form only collects **one** company name (in the current UI language) and no legal name or commercial registration number; these are completed later (BP-102). [Verified]
- **Normal flow:**
  1. The system checks the per-address attempt limit (10 registrations per hour per network address) and refuses with "already registered" if the e-mail exists anywhere in the system (e-mails are a single global identity across all companies; matching is case-insensitive). [Verified]
  2. In **one all-or-nothing transaction** the system creates: the user (password stored only as an Argon2id hash), the company (status *active*, currency KWD, country KW, time zone Asia/Kuwait), the primary branch (code MAIN, flagged as main), the owner membership (status active, owner flag), the default payment set-up (payment methods, bank accounts, internal balances — Payments domain), the default register of the main branch, the five role templates (company manager, branch manager, supervisor, cashier, kitchen) with their permissions, the initial subscription on the platform's default plan (with trial period if the plan defines one), the owner's first management session, and an audit entry "merchant registered". [Verified]
  3. The owner lands directly in the management dashboard, which shows an onboarding checklist (complete profile, add branches, invite employees, create roles). [Verified]
- **Exceptional cases and their handling:**
  - Duplicate e-mail: refused (409) before any write; a *concurrent* registration with the same e-mail is caught by the database uniqueness rule and reported the same way. [Verified]
  - Weak password or missing company name: validation error, nothing created. [Verified]
  - Rate limit exceeded: refused with a retry delay. [Verified]
  - No e-mail verification step exists; the address is taken on trust (ADR-0025, OQ-025). [Verified]
  - No approval, cooling-off period or KYC step; the company is immediately active and can sell. [Verified]
- **Existing controls:**
  - CTL-101 Single transaction: the company never exists without owner, main branch, templates and subscription.
  - CTL-102 Global e-mail uniqueness enforced by a database unique index, case-insensitive (addresses stored lower-cased).
  - CTL-103 Password policy (min 10) and Argon2id hashing; passwords never stored or echoed.
  - CTL-104 Per-address registration rate limit shared across all API instances (counters in the database).
  - CTL-105 Audit entry "merchant registered" with actor, network address and main branch id.
  - CTL-106 Database guarantees: exactly one owner per company, exactly one main branch per company, owner membership always active, company name present.
- **Financial / stock / cash effect:** No money or stock. Creates the empty cash places (register drawer, bank accounts) and the subscription record; the subscription has informational price only — nothing is billed (ADR-0082). Company and owner records are never deleted (company deletion is revoked at database level; closure is a status).
- **Upstream dependencies:** A default subscription plan must exist (platform); currency table seeded.
- **Downstream effects:** Every other domain (branches, registers, payment methods, catalogue, subscription limits). The owner identity becomes the fallback approver for everything (owner bypasses all rights).
- **Observations:** FND-104, FND-107.

#### BP-102 Company profile maintenance
- **Business purpose:** Keep the legal and contact identity of the company current (names, legal name, commercial registration number, contact e-mail/phone, default language) — information that appears on receipts and documents and that auditors use to identify the entity.
- **Actors and required authority:** View: "view company settings" (owner, company manager). Edit: "change company settings" (owner, company manager). Both are company-wide rights; a branch manager has neither.
- **Trigger / inputs:** The Company settings screen. Editable: Arabic name, English name (at least one), legal name, commercial registration number, contact e-mail, contact phone, default language. Read-only on screen: currency (KWD), time zone, status. Not editable anywhere by the merchant: currency, country, time zone, status. [Verified]
- **Normal flow:**
  1. The user edits the form; the screen is read-only for holders of the view right only.
  2. On save the system updates the profile **only if the record version matches** the version the user loaded; the version is incremented. [Verified]
  3. An audit entry "company profile updated" is written in the same transaction with actor and network address — **without** the old and new values. [Verified]
- **Exceptional cases and their handling:**
  - Concurrent edit by someone else: refused as a version conflict; the user must reload. [Verified]
  - Status cannot be changed by any merchant user: a database trigger refuses any status change that is not made in a platform-operator context, and a closed company can never be reopened. [Verified]
  - Blank names in both languages: validation error. [Verified]
- **Existing controls:**
  - CTL-107 Optimistic locking (version) on the company record.
  - CTL-108 Status changes restricted to platform operators by a database trigger (defence in depth, ADR-0080).
  - CTL-109 Audit entry on every profile change (actor, time, address).
  - CTL-110 Company-wide scope: only merchant-wide role assignments or the owner can hold these rights.
- **Financial / stock / cash effect:** None directly. Names/legal data feed receipts and reports (presentation only). Currency is fixed at KWD with 3 decimals (BR-030).
- **Upstream dependencies:** BP-101.
- **Downstream effects:** Receipts and exports (Sales), platform merchant summaries, invitation e-mails (company name).
- **Observations:** FND-105, FND-107.

#### BP-103 Sign-in to the management application
- **Business purpose:** Authenticate a person and bind the session to exactly one company so that every later action carries a trustworthy actor and tenant.
- **Actors and required authority:** Any user holding "management access" at ≥ 1 active branch of ≥ 1 active company (owner implicitly). Cashiers and supervisors are refused.
- **Trigger / inputs:** E-mail and password on the management sign-in page.
- **Normal flow:**
  1. Limits are checked: 30 sign-in attempts per network address per 10 minutes; and the account's failure counter (10 failures per 15 minutes) must not be exhausted. [Verified]
  2. The password is verified against the stored hash. For unknown e-mails a dummy hash is verified so timing does not reveal whether the account exists; wrong password and unknown e-mail return byte-identical answers. [Verified, tested]
  3. On success the failure counter is cleared. Only now does the system reveal specific conditions: disabled account; company suspended (when *all* the user's companies are suspended/closed); "not permitted in this application" with the list of applications the user may use; or "no active membership". [Verified]
  4. If the user is eligible in exactly one company, a management session is created at once. If eligible in several companies, a single-use **selection ticket** (5 minutes, 5 attempts) is issued and the user chooses the company; the ticket cannot be reused and cannot be redirected to a company the user does not belong to. [Verified, tested]
  5. The session is a random 256-bit token stored only as a hash, delivered in an HttpOnly cookie specific to the management application; the user's "last login" time is updated; an audit entry "login succeeded" records the session, interface and address. [Verified]
- **Exceptional cases and their handling:**
  - 10 wrong passwords in 15 minutes lock the account for the rest of the window **even for the correct password**; the lock clears on a successful sign-in within the limit or on password reset. [Verified, tested] (see FND-110)
  - Failed attempts are audited as anonymous events carrying the attempted e-mail and the address; these rows have no company and are invisible to merchants. [Verified]
  - Client address: the forwarded-for header is ignored unless a trusted proxy is configured (ADR-0086), so per-address limits and audited addresses cannot be spoofed; behind a load balancer without that setting every user shares one address. [Verified]
  - Cross-site requests are refused (origin check + SameSite cookies). [Verified, tested]
- **Existing controls:**
  - CTL-111 Rate limits per address and per account, stored in the database (shared by all API instances).
  - CTL-112 Anti-enumeration: identical responses and timing for unknown e-mail vs wrong password; specific messages only after the password is proven.
  - CTL-113 Interface binding: the right to open the management app is itself a permission; the cookie of one application is never accepted by another application's APIs. [tested]
  - CTL-114 Single-use, time-boxed, attempt-limited selection tickets.
  - CTL-115 Audit of successful and failed sign-ins.
- **Financial / stock / cash effect:** None. Establishes the actor recorded on all later financial documents.
- **Upstream dependencies:** BP-101/BP-114 (an account and an active membership with management access).
- **Downstream effects:** Every management procedure in every domain.
- **Observations:** FND-110, FND-114.

#### BP-104 Sign-in to the point of sale (merchant and branch binding)
- **Business purpose:** Put a cashier behind one till in one branch of one company, so that every sale, refund and cash movement carries the branch and employee (BR-022, BR-084).
- **Actors and required authority:** Users with "POS access" at the chosen branch (cashier, supervisor, kitchen staff; owner implicitly; managers only if explicitly granted a till role — BR-014).
- **Trigger / inputs:** E-mail and password on the POS touch sign-in; then, when needed, a company and a branch.
- **Normal flow:**
  1. Steps 1–3 as BP-103 (same limits, same anti-enumeration).
  2. If the user has POS access in exactly one company **and** exactly one branch, the session is created at once bound to that branch. Otherwise a selection ticket is issued listing the eligible companies and, per company, the branches where POS access is held; the user picks; without a valid branch the request is refused. [Verified, tested]
  3. The POS session always carries a branch (database check: a POS session row without a branch is impossible). [Verified]
  4. Audit "login succeeded" with interface POS and branch. [Verified]
- **Exceptional cases and their handling:**
  - A manager without a till role is refused with the hint that the management application is available. [Verified, tested]
  - A cashier attempting the management application is refused symmetrically. [Verified, tested]
  - The branch chosen must be active and the right must hold there; a branch deactivated later ends the session on its next request (BP-112). [Verified]
  - Quick PIN switching between cashiers on a shared terminal is not implemented (OQ-006); each cashier signs in with e-mail and password. [Verified]
- **Existing controls:**
  - CTL-116 Mandatory branch binding of POS sessions (database check constraint).
  - CTL-117 Branch eligibility recomputed from the database at sign-in and on every later request.
  - CTL-111–CTL-115 apply.
- **Financial / stock / cash effect:** None directly; the bound branch and employee are stamped on sales, shifts and cash entries (Sales, Cash chapters).
- **Upstream dependencies:** Branch active (BP-110/112), role assignment with POS access (BP-113/117).
- **Downstream effects:** Shifts, checkout, refunds, cash movements.
- **Observations:** FND-110, FND-114.

#### BP-105 Switching company, interface or branch during a session
- **Business purpose:** Allow one person who works in several companies or branches, or who is both a manager and an authorised cashier, to change context without re-entering credentials — while keeping each session bound to a single context.
- **Actors and required authority:** Any signed-in merchant user; the target context's right is re-checked server-side.
- **Trigger / inputs:** Menu actions in the management app (switch company; open POS) and in the POS (switch branch; switch company; open management).
- **Normal flow:**
  1. *Switch company:* the system reloads the user's memberships, checks eligibility in the target company for the current interface, creates a new session and **revokes the old one**; audited as "merchant switched". [Verified, tested]
  2. *Switch branch (POS):* checks POS access at the target branch, creates a new POS session bound to it and revokes the old one; audited "branch switched". [Verified, tested]
  3. *Switch interface:* checks the right for the other application (management access anywhere, or POS access at a branch — asking for the branch if several); creates a session for the other application in its own cookie; the originating session **remains alive** (both applications can be open side by side); audited "interface switched". [Verified, tested]
- **Exceptional cases and their handling:**
  - Target company where the user has no membership: refused. [tested]
  - Target branch without POS access: refused. [tested]
  - Manager without a till role trying to open the POS: refused with the available applications. [tested]
- **Existing controls:**
  - CTL-118 Old session revoked on company/branch switch (one context per session).
  - CTL-119 Every switch audited with the new session id.
  - CTL-113 applies.
- **Financial / stock / cash effect:** None. Ensures documents created after the switch carry the new branch.
- **Upstream dependencies:** BP-103/104.
- **Downstream effects:** Shift and sale attribution.
- **Observations:** None beyond FND-105 (audit detail).

#### BP-106 Session validity, timeouts, sign-out and forced revocation
- **Business purpose:** Guarantee that a session only works while the person, their membership, their company and their rights are still valid, and that access ends promptly when any of these change (BR-023, BR-153).
- **Actors and required authority:** System behaviour on every request; sign-out by the session holder; revocation triggered by employee deactivation (BP-116), password reset (BP-108), company suspension (platform), branch deactivation (BP-112), role changes (BP-117).
- **Trigger / inputs:** Every API request; the sign-out action.
- **Normal flow:**
  1. On each request the system looks up the session by the hash of the cookie of **that application only**, requires it to be unrevoked and within both its idle and absolute expiry, then re-reads: user active; password not changed after the session was created; membership active; company active; the interface right still held (management: anywhere; POS: at the bound branch, which must still be active). Any failure revokes the session on sight and answers "not authenticated". [Verified, tested]
  2. Sliding idle expiry is refreshed at most once a minute, capped by the absolute expiry. [Verified]
  3. Lifetimes [Verified]: management 60 min idle / 12 h absolute; POS 8 h idle / 16 h absolute (plus the 5-minute screen lock, BP-107); platform console 15 min idle / 8 h absolute.
  4. Sign-out revokes the session server-side (reason "logout") and clears the cookie. [Verified, tested]
- **Exceptional cases and their handling:**
  - Employee deactivated: all sessions of that membership are revoked in the same transaction (reason "membership deactivated"). [Verified, tested]
  - Password reset: all sessions of the user, in all companies, are revoked. [Verified, tested]
  - Company suspended by the platform: next request of any member fails and the session is revoked; sign-in answers "company suspended". [Verified, tested]
  - Role downgrade removing management access: the management session dies on the next request; a role change that merely adds or removes operational rights applies on the next request without ending the session. [Verified, tested]
  - A cookie presented to the wrong application, a forged token, an expired idle or absolute time: refused. [tested]
  - There is **no** "see my active sessions / sign out everywhere" feature for users or managers; revocation of other devices happens only indirectly through password reset or deactivation. [Verified] (FND-103)
- **Existing controls:**
  - CTL-120 Per-request full re-validation of user, membership, company, right and branch.
  - CTL-121 Immediate revocation on deactivation, reset and suspension; revocation reason stored on the session row.
  - CTL-122 Tokens stored hashed; HttpOnly, SameSite cookies, one per application; secure flag in production.
  - CTL-123 Idle and absolute expiry per application.
- **Financial / stock / cash effect:** None. Note that revoking a cashier's session does **not** close their open shift; the drawer stays in their custody until closed or force-closed (Cash chapter).
- **Upstream dependencies:** BP-103/104.
- **Downstream effects:** All domains; Cash (open shifts after revocation).
- **Observations:** FND-103, FND-107.

#### BP-107 POS screen lock and unlock
- **Business purpose:** Prevent an unattended till from being used by someone other than the cashier whose shift and drawer it is (BR-160), preserving the integrity of employee attribution on sales and cash.
- **Actors and required authority:** The cashier of the live POS session (lock on demand; automatic after inactivity); unlock only with the **same** user's password; anyone can end a locked session and sign in as themselves.
- **Trigger / inputs:** "Lock now" button or menu item; or 5 minutes without touch, mouse or keyboard input detected by the POS screen; unlock dialog with password.
- **Normal flow:**
  1. The POS calls "lock"; the server stamps the session as locked and audits "POS locked". From then on every request of that session is refused with "session locked" (tested on the registers API). [Verified, tested]
  2. The cashier enters their password; the server verifies it against the session's own user (the unlock does not accept another user's credentials), clears the lock, audits "POS unlocked". [Verified, tested]
  3. From the lock screen "sign in as someone else" ends the locked session (reason "logout") so the other person must sign in fully. [Verified, tested]
- **Exceptional cases and their handling:**
  - Five wrong passwords on a locked session (within 15 minutes) revoke the session (reason "unlock failed"); the correct password is then refused and a full sign-in is needed. [Verified, tested] These failed attempts are **not** written to the audit log (only the lock/unlock events are). [Verified]
  - Per-address limit on unlock attempts (30 / 10 min). [Verified]
  - The 5-minute inactivity detection runs in the browser; the server does not lock an idle session by itself and the server idle timeout is 8 hours. ADR-0085 describes the mechanism accurately ("the server enforces the lock state"), but BR-160's wording ("the POS locks after 5 minutes without input") is only true for an untampered POS screen. [Verified] (FND-112)
- **Existing controls:**
  - CTL-124 Server-held lock flag refusing all requests of the session.
  - CTL-125 Unlock bound to the session's own user and password; attempt limit ends the session.
  - CTL-126 Lock and unlock audited with session, actor and address.
- **Financial / stock / cash effect:** None; the open shift continues during the lock.
- **Upstream dependencies:** BP-104.
- **Downstream effects:** Attribution of POS sales and cash entries.
- **Observations:** FND-112, FND-111.

#### BP-108 Password recovery and manager-triggered reset
- **Business purpose:** Let a person regain access without anyone else ever learning or setting their password (BR-043, BR-044), and let managers help without handling credentials.
- **Actors and required authority:** Self-service: anyone with the account e-mail. Manager-triggered: holder of "manage employees" for an employee within their authority (never for the owner, never for oneself).
- **Trigger / inputs:** "Forgot password" form (e-mail + which application) or the "Send password reset" button on the employee detail screen.
- **Normal flow:**
  1. The request is accepted with the same answer whether or not the e-mail exists; limits: 20 requests per address per hour, 5 per e-mail per hour. [Verified, tested]
  2. In the background, if the account exists and is active, any earlier unused link is invalidated, a new single-use token (hash stored) valid 30 minutes is created, audited as "reset requested" (no company), and an e-mail with the link (management or POS address as requested) is sent. [Verified]
  3. The person opens the link, chooses a new password (policy enforced). The token is claimed atomically (single use, unexpired), the password hash is replaced, "password changed at" is stamped, **all** sessions of the user are revoked, the account's failure lock is cleared, and "reset completed" is audited. [Verified, tested]
  4. Manager-triggered: the manager's action is audited in the company's trail as "password reset sent" (actor manager, target membership) and then the self-service path runs for the employee's e-mail, choosing the management link if any of the employee's roles includes management access, else the POS link. [Verified, tested]
- **Exceptional cases and their handling:**
  - Expired, reused or unknown token: refused as invalid. [tested]
  - Disabled account: no e-mail; reset refused. [Verified]
  - Manager-triggered resets consume the employee's "5 per hour per e-mail" allowance; more than five in an hour are refused for everyone. [Verified]
  - Platform-created owners receive the same mechanism as a 72-hour "account set-up" link. [Verified]
  - A signed-in user has **no** "change my password" function; the only way to rotate a password is the e-mail link. [Verified] (FND-103)
- **Existing controls:**
  - CTL-127 Single-use, 30-minute, hashed reset tokens; newest link invalidates older ones.
  - CTL-128 Reset revokes every session of the user and clears the failure lock.
  - CTL-129 Anti-enumeration (identical response; work after the response).
  - CTL-130 Managers never see tokens or passwords; the manager's trigger is audited in the company trail.
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** Working e-mail delivery (locally a test mailbox; a production provider needs owner approval, ADR-0030).
- **Downstream effects:** BP-106 (sessions end).
- **Observations:** FND-103, FND-106.

#### BP-109 Platform operator sign-in and operator provisioning
- **Business purpose:** Give SaaS staff a strictly separate identity (BR-015, ADR-0007) with stronger authentication, since operators can suspend companies and change subscriptions.
- **Actors and required authority:** Platform operators (roles: super admin, support, billing). Operators are created or re-keyed only by the platform's engineering staff with a command-line tool running as the database owner; the API role cannot insert or modify operators except their own sign-in progress columns. [Verified, tested]
- **Trigger / inputs:** Operator e-mail and password, then a 6-digit authenticator (TOTP) code.
- **Normal flow:**
  1. Password step: limits 10 attempts per address / 15 min and 5 failures per e-mail / 15 min; disabled operators receive the same answer as a wrong password; failures audited "platform login failed". On success a single-use ticket (5 min, 5 attempts) is issued. [Verified, tested]
  2. Code step: limit 20 per address / 15 min and **5 wrong codes per operator** regardless of address or ticket; the time step is claimed atomically so a code can never be used twice; failures audited "platform MFA failed"; success creates a platform session (strict cookie, 15 min idle / 8 h absolute) and audits "platform login succeeded". [Verified, tested]
  3. Platform sessions are refused by merchant APIs and merchant sessions by platform APIs. [Verified, tested]
- **Exceptional cases and their handling:**
  - Secret handling: the authenticator secret is stored encrypted (AES-256-GCM) with a key that production refuses to run with development values. [Verified]
  - Operator password recovery does not exist in the product: the CLI re-keys the operator (new one-time password and new authenticator secret). [Verified]
  - Disabling an operator: no CLI command or screen exists; it requires a direct database change by engineering. [Inferred from the CLI, which only creates/re-keys] (FND-115)
  - Platform-created merchant: an operator with support or super-admin role runs the same provisioning as BP-101 for a named owner; a new owner gets a 72-hour set-up link; an existing user becomes owner of the new company without password change; audited "platform merchant created" in the merchant's own trail with the operator as actor. [Verified]
- **Existing controls:**
  - CTL-131 Mandatory two-factor sign-in with replay protection and per-operator failure limit.
  - CTL-132 Separate tables, endpoints, cookies and guards for the platform realm.
  - CTL-133 Operator creation only by the schema owner (database grants), never through the API.
  - CTL-134 All operator sign-in events audited.
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** Encryption key configured.
- **Downstream effects:** Platform chapter (merchant status, subscriptions, plans).
- **Observations:** FND-115.

#### BP-110 Branch creation
- **Business purpose:** Open a new place of business with its own stock, registers, treasury and staff scope (BR-004, BR-017).
- **Actors and required authority:** "Create/deactivate branches" (company-wide): owner, company manager. A branch manager cannot create branches (tested).
- **Trigger / inputs:** Branches screen → Add: code (letters, digits, "-" or "_", max 20, stored upper-case, unique per company), Arabic/English name (at least one), phone, address, receipt header and footer texts.
- **Normal flow:**
  1. The system checks plan capacity for **one more active branch and one more register** (BR-151); creation is refused with "plan limit reached" if either is exhausted. [Verified]
  2. The branch is inserted (status active, time zone Asia/Kuwait, not main) together with its default register; audited "branch created" with the code. [Verified]
  3. Treasury and other cash places for the new branch are created by the Payments/Cash set-up (outside this chapter). [Inferred]
- **Exceptional cases and their handling:**
  - Duplicate code (case-insensitive after upper-casing): refused "duplicate code", including under concurrency (database uniqueness). [Verified, tested]
  - Invalid code characters or empty names: validation error. [tested]
  - Plan limit: refused; no partial creation. [Verified]
- **Existing controls:**
  - CTL-135 Company-wide right required; branch managers excluded.
  - CTL-136 Unique branch code per company; exactly one main branch per company (database).
  - CTL-137 Plan capacity checked inside the creating transaction (subscription row locked for limited plans, ADR-0081).
  - CTL-138 Audit entry with actor and code.
- **Financial / stock / cash effect:** Creates an empty register (drawer at zero, "not yet counted") — Cash chapter. No stock.
- **Upstream dependencies:** BP-101; subscription with capacity.
- **Downstream effects:** Role assignments at the branch (BP-113/117), registers and treasury (Cash), stock levels (Inventory), reports by branch.
- **Observations:** FND-105 (audit lacks field values on later edits), FND-116.

#### BP-111 Branch update (details and receipt texts)
- **Business purpose:** Maintain branch identification, contact data and the texts printed on receipts.
- **Actors and required authority:** "Edit branch information" **at that branch**: owner, company manager, branch manager of that branch. A branch manager cannot even read another branch (tested: 403 on the detail, filtered out of the list).
- **Trigger / inputs:** Branches screen → Edit: all fields of BP-110 including the **code**; the time zone column exists but is not editable from the UI or API. [Verified]
- **Normal flow:**
  1. The service checks the right at the branch, applies the change only if the version matches, increments the version, audits "branch updated" (no field values). [Verified, tested]
- **Exceptional cases and their handling:**
  - Version conflict: refused; reload required. [tested]
  - Duplicate code on rename: refused. [Verified]
  - A branch's code may be changed after documents were issued at that branch; documents keep their own numbering (ADR-0061) but any external reference to the old code is lost. [Verified that renaming is allowed; impact Inferred]
- **Existing controls:**
  - CTL-139 Branch-scoped right; list and detail filtered server-side to accessible branches.
  - CTL-140 Optimistic locking (version).
  - CTL-141 Audit entry on each update.
- **Financial / stock / cash effect:** None; receipt texts affect presentation only.
- **Upstream dependencies:** BP-110.
- **Downstream effects:** Receipts (Sales), branch labels in reports.
- **Observations:** FND-105.

#### BP-112 Branch deactivation and reactivation
- **Business purpose:** Close a place of business for operations while keeping its history (BR-047); reopen it later if needed.
- **Actors and required authority:** "Create/deactivate branches" (company-wide): owner, company manager.
- **Trigger / inputs:** Branches screen → Deactivate (confirmation dialog) / Activate.
- **Normal flow:**
  1. Deactivation: the main branch is refused; otherwise status becomes inactive (version incremented), audited "branch deactivated". [Verified, tested]
  2. Effect on access: every role assignment at that branch confers nothing while the branch is inactive; a POS session bound to the branch dies on its next request; sign-in no longer offers the branch; invitations whose grants point at the branch are applied **without** those grants if accepted later. [Verified, tested]
  3. Reactivation: plan capacity for branches is re-checked; status becomes active; audited "branch activated". **All dormant role assignments at the branch silently become effective again.** [Verified]
- **Exceptional cases and their handling:**
  - Main branch: cannot be deactivated (409). [tested]
  - No operational pre-conditions are checked: a branch can be deactivated while it has open shifts, cash in its drawers or treasury, stock on hand, open purchase orders or transfers in transit. Access of branch staff ends immediately, so a cashier cannot close their own shift there; only a user with rights at that branch through a merchant-wide assignment (or the owner) can still act. [Verified that no checks exist in the branch service; operational consequences Inferred] (FND-109)
  - Role assignments at an inactive branch are kept (not deleted) and are not shown as revoked anywhere. [Verified]
- **Existing controls:**
  - CTL-142 Main branch protected.
  - CTL-143 Immediate loss of all access granted at the branch (evaluated per request).
  - CTL-144 Plan capacity re-checked on reactivation.
  - CTL-145 Audit entries for both directions.
- **Financial / stock / cash effect:** None recorded; balances of the branch's cash places and stock remain as they are, now without local custody (Cash and Inventory chapters).
- **Upstream dependencies:** BP-110.
- **Downstream effects:** Shifts/registers, treasury, stock, transfers, online store fulfilment branch (if it is the fulfilment branch — not checked here).
- **Observations:** FND-109, FND-108.

#### BP-113 Employee invitation (create, resend, revoke)
- **Business purpose:** Bring a new employee into the company with pre-defined roles and branches, without anyone ever creating or seeing their password (BR-003, BR-044, ADR-0032).
- **Actors and required authority:** "Manage employees" at every branch named in the invitation **and** every right of every invited role at that branch (owner may grant anything). Company managers therefore cannot invite cashiers (they lack POS rights — tested); branch managers can invite only at their own branch and only roles whose rights they themselves hold there (tested); nobody can invite a company manager unless they hold all of that role's rights company-wide.
- **Trigger / inputs:** Employees screen → Invite: full name, e-mail, optional job title / phone / employee code, "first application" (POS or management, only decides which link the e-mail opens), and one or more (role, branch | all branches) rows. The screen defaults to the cashier role at the currently selected branch.
- **Normal flow:**
  1. The service checks that every role exists in this company, every named branch is active in this company, and that the inviter may grant each role at each branch (anti-escalation). [Verified, tested incl. foreign role/branch → not found]
  2. Plan capacity for employees is checked (active non-owner members + unexpired pending invitations). [Verified]
  3. If the e-mail already belongs to a member of this company: refused "already a member". A pending invitation for the same e-mail is revoked and replaced (one pending invitation per e-mail per company — database rule). [Verified, tested]
  4. The invitation is stored with a hashed single-use token valid **7 days**, the inviter, and the grants; audited "employee invited" with e-mail and grants. The e-mail with the link is sent after the transaction; if sending fails the invitation still exists and can be resent. [Verified]
  5. Resend: only for pending invitations within the actor's authority; issues a **new** token and a new 7-day expiry; audited. Revoke: marks revoked; audited; the link stops working. [Verified, tested]
- **Exceptional cases and their handling:**
  - Any grant beyond the inviter's authority: whole invitation refused as "privilege escalation", nothing partially stored. [tested]
  - Inviting oneself or the owner's e-mail: "already a member". [tested]
  - Expired invitations stay listed as "expired" and no longer count against the plan; they are never purged. [Verified]
  - A pending invitation can be seen and acted upon only by managers whose employee-view scope covers one of its branches (merchant-wide viewers see all). [Verified]
  - The response to the manager never contains the token. [tested]
- **Existing controls:**
  - CTL-146 Anti-escalation on every grant (right held at that branch by the inviter, plus "manage employees" there); owner exempt.
  - CTL-147 Role and branch must belong to the company (composite foreign keys; RLS) and the branch must be active.
  - CTL-148 Single pending invitation per e-mail per company; hashed, single-use, time-boxed token; resend rotates the token.
  - CTL-149 Plan capacity check in the transaction.
  - CTL-150 Audit entries for invite / resend / revoke including the granted roles and branches.
- **Financial / stock / cash effect:** None. Pending invitations consume subscription capacity.
- **Upstream dependencies:** Roles (templates or BP-118), active branches (BP-110).
- **Downstream effects:** BP-114; employee counts on dashboard and platform summaries.
- **Observations:** FND-108, FND-113.

#### BP-114 Invitation acceptance (joining the company)
- **Business purpose:** Complete onboarding by the employee themselves: set a password (new account) or prove identity (existing account), and activate the pre-approved grants atomically.
- **Actors and required authority:** The holder of the invitation link (the token is the credential); limited to 20 preview/accept calls per address per hour.
- **Trigger / inputs:** The "accept invitation" page of the management or POS application; password; optional language.
- **Normal flow:**
  1. Preview: the page shows the invited e-mail, name, company name, expiry, and whether an account with that e-mail already exists. [Verified, tested]
  2. Accept: for a new e-mail the chosen password must meet policy and a new user is created with the e-mail marked verified; for an existing e-mail the current password of that account must be entered. [Verified, tested]
  3. In one transaction the invitation is **claimed atomically** (pending, unexpired → accepted), the company must be active, the membership is created (status active, profile fields copied from the invitation), and role assignments are created **only for roles that still exist and branches that are still active**; audited "invitation accepted" (actor: the new member). [Verified, tested]
  4. The response tells which application(s) the person may now open; they then sign in normally. [Verified]
- **Exceptional cases and their handling:**
  - Expired, revoked, already used or unknown token: "invitation invalid". A second concurrent acceptance loses the atomic claim. [tested]
  - Company suspended/closed: refused "company suspended" (the claim is rolled back). [Verified]
  - Existing account with wrong password: "invalid credentials"; disabled account: refused. [tested]
  - Already a member (race with another path): refused. [Verified]
  - The grants are those approved **at invitation time**; the inviter's authority is **not** re-checked at acceptance (up to 7 days later), and if a role's permission set was widened meanwhile the invitee receives the wider set. [Verified] (FND-108)
  - The membership status "invited" exists in the database rule but is never used; acceptance goes straight to active. [Verified]
- **Existing controls:**
  - CTL-151 Atomic single-use claim of the invitation.
  - CTL-152 Password policy for new accounts; current-password proof for existing accounts.
  - CTL-153 Grants filtered to existing roles and active branches.
  - CTL-154 Row-level security lets the token holder read only their own invitation.
  - CTL-155 Audit entry with invitation id and whether a new account was created.
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-113.
- **Downstream effects:** BP-103/104 (the person can sign in), employee counts.
- **Observations:** FND-108, FND-104.

#### BP-115 Employee profile maintenance
- **Business purpose:** Keep the company-specific HR attributes of a member (job title, phone, employee code) current. The global identity (name, e-mail, password) belongs to the person and is not editable by managers.
- **Actors and required authority:** "Manage employees" with the target within the actor's authority: never the owner, never oneself, and every existing grant of the target must be grantable by the actor. The target must also be visible to the actor (assigned at one of the actor's branches, or the actor has merchant-wide visibility).
- **Trigger / inputs:** Employee detail screen → profile form.
- **Normal flow:** The service verifies visibility and manageability, updates the three fields, audits "employee updated" (no values), and returns the employee. [Verified, tested]
- **Exceptional cases and their handling:**
  - Target more privileged than the actor, the owner, or the actor themselves: "privilege escalation" (the screen already shows these as not manageable). [tested]
  - Target outside the actor's branch scope: "not found". [Verified]
  - Employee code is free text; uniqueness is **not** enforced. [Verified]
- **Existing controls:**
  - CTL-156 Manageability rule (owner/self/more-privileged protection) enforced server-side on every call and reflected as a flag in the UI.
  - CTL-157 Visibility scope by branch for employee viewers.
  - CTL-158 Audit entry.
- **Financial / stock / cash effect:** None. Employee code may appear on reports (presentation).
- **Upstream dependencies:** BP-114.
- **Downstream effects:** Reports by employee (name only).
- **Observations:** FND-105.

#### BP-116 Employee deactivation and reactivation
- **Business purpose:** End or restore a person's access to the company immediately (BR-023) while keeping their history on every document.
- **Actors and required authority:** As BP-115.
- **Trigger / inputs:** Employee detail → Deactivate (confirmation) / Activate.
- **Normal flow:**
  1. Deactivate: membership status becomes inactive; **all sessions of that membership are revoked in the same transaction**; audited "employee deactivated". Sign-in then answers "not active in any company" (or offers the user's other companies). [Verified, tested]
  2. Reactivate: plan capacity for employees is checked; status active; audited "employee activated"; previous role assignments are untouched and effective again. [Verified, tested]
- **Exceptional cases and their handling:**
  - The owner can never be deactivated (manageability rule in code **and** a database check that an owner membership must be active). [Verified, tested]
  - Self-deactivation refused. [Verified]
  - Deactivation does not close the person's open shift nor reassign their drawer; the cash stays booked to their shift until a manager force-closes it (Cash chapter). [Inferred]
  - The person's global account is not disabled; they keep access to other companies. There is no function to disable a global account; the "disabled" user status can only be set directly in the database. [Verified]
- **Existing controls:**
  - CTL-159 Session revocation in the same transaction as the status change.
  - CTL-160 Owner protection (code + database constraint).
  - CTL-161 Plan capacity on reactivation.
  - CTL-162 Audit entries for both directions.
- **Financial / stock / cash effect:** None; historical documents keep the employee.
- **Upstream dependencies:** BP-114.
- **Downstream effects:** Shifts (open shift of a deactivated cashier), platform employee counts.
- **Observations:** FND-102, FND-106.

#### BP-117 Changing an employee's role assignments
- **Business purpose:** Grant or withdraw authority at branches as responsibilities change (BR-024, BR-045).
- **Actors and required authority:** As BP-115, plus every **new** grant must be within the actor's authority (right held at that branch + manage employees there).
- **Trigger / inputs:** Employee detail → assignments editor: rows of (role, branch | all branches) → Save roles. The whole set is replaced.
- **Normal flow:**
  1. Manageability of the target is checked (all *existing* grants within the actor's authority), then every *new* grant (role exists, branch active, grantable). [Verified, tested]
  2. All existing assignments are deleted and the new, de-duplicated set inserted; audited "employee roles changed" with **before and after** lists. [Verified]
  3. Takes effect on the target's next request; if management access is lost the management session ends; if POS access at the bound branch is lost the POS session ends. [Verified, tested]
- **Exceptional cases and their handling:**
  - Self-promotion refused (never oneself). [tested]
  - A branch manager cannot give rights at another branch, nor a role containing rights they lack (e.g. supervisor), nor a company-wide role. [tested]
  - Removing all assignments is allowed: the member stays active with no rights, becomes invisible to branch-scoped managers (visible only to merchant-wide viewers), and still counts against the employee plan limit. [Verified]
  - A company-wide right placed in a role that is granted at a single branch grants nothing (silent). [Verified by evaluator; unit-tested]
- **Existing controls:**
  - CTL-163 Anti-escalation on both the old grants (manageability) and the new grants (grantability); violations never partially applied.
  - CTL-164 Before/after audit of assignments.
  - CTL-165 Immediate effect through per-request evaluation.
- **Financial / stock / cash effect:** None directly; changes who may approve refunds, move cash, adjust stock, etc.
- **Upstream dependencies:** Roles (BP-118), active branches.
- **Downstream effects:** All authorisation in all domains.
- **Observations:** FND-113, FND-117.

#### BP-118 Role creation and editing (custom roles)
- **Business purpose:** Let each company tailor its segregation of duties by composing roles from the fixed catalogue (BR-006, BR-048).
- **Actors and required authority:** "Manage roles" held company-wide (owner, company manager). The editor may only put into a role rights that the editor holds **company-wide**, and may not edit a role that contains any right the editor lacks (such roles are shown read-only).
- **Trigger / inputs:** Roles screen → Add / Edit: Arabic/English name (at least one), permission matrix grouped by module (rights the editor lacks are locked), version on edit.
- **Normal flow:**
  1. Create: unknown keys are rejected; keys beyond the editor's company-wide rights are refused as "privilege escalation"; the role and its permissions are inserted; audited "role created" with the permission list. [Verified, tested]
  2. Edit: the role must be editable by this editor; the version must match; names updated, permission set replaced; audited "role updated" with **added** and **removed** keys. [Verified, tested]
  3. Changes to a role apply to **every** holder on their next request (no re-approval of existing assignments). [Verified]
- **Exceptional cases and their handling:**
  - Version conflict: refused. [tested]
  - Template roles are ordinary roles: they can be renamed and their permissions changed (e.g. the cashier template can be given refund approval by the owner); the template key is kept, so the sync seed will not recreate them. [Verified]
  - Role names are **not** unique: two roles may carry the same name. [Verified] (FND-107)
  - A company manager can create a role equal to their own authority and assign it (peer creation) but never more. [Verified, tested]
- **Existing controls:**
  - CTL-166 Rights in a role limited to the editor's company-wide rights; unknown keys rejected.
  - CTL-167 Roles beyond the editor's authority are read-only.
  - CTL-168 Optimistic locking; audit of added/removed rights.
  - CTL-169 Catalogue fixed in software; merchants cannot invent rights.
- **Financial / stock / cash effect:** None directly; determines approval and custody authority everywhere.
- **Upstream dependencies:** BP-101 (templates seeded).
- **Downstream effects:** BP-113/117; all domains.
- **Observations:** FND-107, FND-113.

#### BP-119 Role deletion
- **Business purpose:** Remove roles that are no longer needed, without ever orphaning a grant.
- **Actors and required authority:** As BP-118.
- **Trigger / inputs:** Roles screen → Delete (only offered for editable roles with zero holders).
- **Normal flow:** The service re-checks editability, then refuses if any employee holds the role **or any pending invitation** references it; otherwise the role (and its permission rows, by cascade) is deleted and "role deleted" audited with the name. [Verified, tested]
- **Exceptional cases and their handling:**
  - Role in use: "role in use" (409). [tested]
  - Template roles can be deleted when unused (the supervisor template was deleted in the test); the sync seed would recreate a missing template on its next run. [Verified]
  - Deleting a role is a true delete; the only history is the audit entry (name only, not the permission list). [Verified]
- **Existing controls:**
  - CTL-170 In-use check covering both assignments and pending invitations.
  - CTL-171 Cascade deletes only the role's own permission rows; assignments cannot dangle (foreign keys).
  - CTL-172 Audit entry.
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-118.
- **Downstream effects:** None once unused.
- **Observations:** FND-105 (deleted role's permission set not preserved in the audit detail).

#### BP-120 Authorisation of every request (permission evaluation, branch scoping, tenant isolation)
- **Business purpose:** The invisible procedure behind every other one: decide, on every call, whether this actor may do this action at this branch of this company, and make it impossible to touch another company's data (BR-005, BR-012, BR-021).
- **Actors and required authority:** System behaviour.
- **Trigger / inputs:** Every API request.
- **Normal flow:**
  1. Route gate: the request must carry the correct application's cookie; the session must be live (BP-106); the route's declared right must be held at the branch in the request (POS binding, branch in the path or query) or, if no branch is named, somewhere. [Verified]
  2. Service checks: exact per-object checks (e.g. edit branch X requires the right at X) and list filtering by the branches where the right is held; company-wide rights require a merchant-wide assignment. [Verified, tested]
  3. Database: every statement runs with the company id taken from the **session** set as the row-level-security context; all tenant tables have forced RLS; the runtime database role cannot bypass it; composite foreign keys (company id, record id) prevent cross-company references. [Verified, tested: cross-company reads return nothing and inserts are refused by RLS]
  4. Start-up check: if any route lacks an access declaration the application refuses to start. [Verified]
- **Exceptional cases and their handling:**
  - Any denial answers 401/403/404 without detail; denials are **not** written to the audit log (only sign-in failures are). [Verified] (FND-111)
  - Pre-sign-in reads (choosing a company) use a user-level context that exposes only the user's own memberships and those companies. [Verified]
  - Platform operators read merchant data only through summary functions that refuse to run without an operator context. [Verified, tested]
- **Existing controls:**
  - CTL-173 Default-deny guard, fail-closed boot check.
  - CTL-174 Two-level checks (route gate + service), lists filtered in SQL.
  - CTL-175 Forced row-level security with the tenant id from the session; composite foreign keys; isolation tests.
  - CTL-176 Permission evaluator unit-tested for BR-013/014/024, unknown keys, inactive memberships, suspended companies.
- **Financial / stock / cash effect:** None directly; underpins all.
- **Upstream dependencies:** BP-103/104.
- **Downstream effects:** All domains.
- **Observations:** FND-111.

#### BP-121 Audit trail: what is recorded, who can read it, and whether it can be altered
- **Business purpose:** Provide an evidential record of security-relevant and financial actions for management review and external audit (CLAUDE.md §4; ADR-0008).
- **Actors and required authority:** Writers: every service in the same transaction as the business change (or in its own transaction for events without other writes, e.g. failed sign-in). Readers: platform operators (support, super admin) through the platform console, **restricted to operator actions and platform events**. Merchants: the right "view the audit log" exists in the catalogue and is granted to company managers, **but no merchant API or screen reads the log** — the only merchant-visible references are the permission label in the role editor and the "audit" word in the navigation? (No: navigation has no audit entry.) [Verified]
- **Trigger / inputs:** Business events.
- **Normal flow (what is recorded):** Each entry holds: company (null for events without a company), actor type (user / operator / anonymous / system), actor id, action name, target type and id, network address, free-form details, and the database time of occurrence. Events of this domain [Verified]:
  - Company: registered; profile updated; (platform) created, status and subscription changes with the operator as actor and the merchant as owner of the event.
  - Sign-in: login failed (anonymous, with attempted e-mail, no company); login succeeded; interface / branch / merchant switched; POS locked / unlocked; password reset requested / completed (no company).
  - Platform: login failed, MFA failed, login succeeded (no company).
  - Employees: invited (e-mail + grants), invitation resent / revoked / accepted, updated, activated, deactivated, roles changed (before/after), password reset sent.
  - Roles: created (permission list), updated (added/removed), deleted (name).
  - Branches: created (code), updated, activated, deactivated.
  - System: cash custody cutover and the removal of cash-in/out from cashier roles (migration-time rows).
  - **Not recorded:** sign-outs and session expiries (kept only as a reason on the session row), failed unlock attempts, refused actions (403 "privilege escalation", plan-limit refusals, version conflicts), invitation previews, old/new values of profile, branch and employee edits.
- **Exceptional cases and their handling:**
  - If the audit write for a stand-alone event fails, the business answer is still given and the failure is logged to the application log (the sign-in refusal is not turned into an error). In-transaction writes roll the business change back if they fail. [Verified]
  - Immutability: UPDATE and DELETE on the audit table are revoked from the runtime database role; row-level security limits reads to the company's own rows and inserts to own-company or no-company rows. The migration/owner role and database administrators are not restricted; there is no tamper-evidence (no hash chain, no external export) and no retention or archiving rule. [Verified; absence of tamper-evidence Verified]
  - Company-less rows (failed sign-ins, password resets, platform sign-ins) are readable only through the operator function, and that function shows only operator / "platform.*" events — so failed merchant sign-ins and password-reset events are readable by **nobody** through the product. [Verified]
  - Time: the occurrence time is the database clock (UTC); reports elsewhere use merchant-local days; the audit log has no branch column. [Verified]
- **Existing controls:**
  - CTL-177 In-transaction recording: the event commits or rolls back with the business change.
  - CTL-178 Append-only at database level for the runtime role; RLS on reads.
  - CTL-179 Actor, target, address and time on every row; before/after on role-assignment and role-permission changes.
  - CTL-180 Platform audit reader requires an operator context at database level.
- **Financial / stock / cash effect:** None; evidential only.
- **Upstream dependencies:** All procedures.
- **Downstream effects:** Management review, external audit, incident investigation — all currently limited by FND-101.
- **Observations:** FND-101, FND-105, FND-106, FND-111.

---

### A.3 Interdependencies with other domains

This domain produces no money or stock movement, but it produces the three attributes every financial record relies on — company, branch and employee — and the authority under which each record was created. Any weakness here propagates: a mis-granted refund-approval right becomes an unauthorised refund in the Refunds chapter; an unreviewed reactivation of a branch silently restores custody rights in the Cash chapter; an unreadable audit log removes the evidence that the other chapters' controls were exercised. Conversely, this domain depends on the Platform domain for the company's status and plan capacity (which gate branch, employee and register creation) and on the Payments domain for the cash places created with every company and branch.

| From this domain → | To domain | What flows |
|---|---|---|
| BP-101/110 company and branch creation | Payments / Cash custody | Default payment methods, bank accounts, register drawer per branch, treasury per branch (created at provisioning) |
| BP-101 | Platform / Subscriptions | Initial subscription on the default plan; employee, branch and register counts used for plan limits |
| BP-103/104/105 sessions | Sales, Refunds, Cash, Inventory, Restaurant | Actor (employee), company and POS branch stamped on sales, refunds, shifts, cash entries, stock movements, kitchen tickets |
| BP-107 POS lock | Sales / Cash | Protects attribution of till actions to the signed-in cashier during their shift |
| BP-113/117/118 roles and grants | All domains | Who may approve refunds, override discounts/prices, void sales, move or hold cash, deposit to bank, approve purchase orders and transfers, adjust stock, see costs and financial reports |
| BP-112 branch deactivation | Cash, Inventory, Purchasing, Online store | Removes local custody/access while balances, stock, open orders and the fulfilment-branch link remain |
| BP-116 employee deactivation | Cash (shifts) | Sessions end; an open shift and drawer remain booked to the deactivated cashier until force-closed |
| BP-121 audit trail | All domains, external audit | Evidence of security and financial actions; currently readable by merchants in no screen |
| Platform (status, plan) → this domain | — | Suspension ends all sessions and blocks sign-in/invitations; plan limits refuse new branches, employees, registers |
| Payments → this domain | — | Default register created with each branch (shared helper) |

---

### A.4 Findings

#### FND-101 Merchant audit trail is written but cannot be read by the merchant
- **Classification:** Missing process / Control gap
- **Severity:** High
- **Evidence:** [Verified] A rich audit trail is written for sign-ins, role changes, employee changes, branch changes, company changes and (in other chapters) financial actions, and the permission "view the audit log" exists and is granted to the company-manager template. However, no management API endpoint and no management screen reads the company's audit log; the only reader is the platform console, whose database function returns exclusively operator actions and "platform.*" events. The company-less rows (failed merchant sign-ins, password-reset events) are readable by nobody through the product.
- **Potential financial impact:** Management cannot review who approved refunds, changed prices, granted cash-custody rights, deactivated a branch or reset a colleague's password; investigations of cash shortages or stock losses lack the evidential trail the system actually holds. External auditors cannot be given the log without database access.
- **Affected procedures:** BP-121 and, by dependency, every procedure in this and other chapters that relies on the audit entry as a compensating control (BP-102, BP-108, BP-111–BP-119).
- **Recommendation:** Deliver the audit-log screen and API for holders of the right (filter by date, actor, action, target; export). Decide who sees company-less events (recommend: the owner sees failed sign-ins and reset events for their members' e-mails). Until then, treat all "audited" controls in this manual as *recorded but not reviewable*.

#### FND-102 Ownership transfer and owner succession are not implemented although documented
- **Classification:** Inconsistency (doc vs behaviour) / Missing process
- **Severity:** High
- **Evidence:** [Verified] BR-020 states "Ownership transfer is an explicit, audited action". No API, screen or CLI exists to transfer ownership, to demote the owner, or to appoint a new owner. The owner membership cannot be deactivated (database check) and no user account can be disabled through the product. The owner is the only identity that implicitly holds every right, including treasury custody and bank deposits by default (no template holds `cash.custody`).
- **Potential financial impact:** If the owner leaves, dies, loses access or is compromised, the company has no sanctioned way to re-establish control: the only lever is the self-service password reset to the owner's e-mail. A compromised owner account cannot be suspended by the company; only the platform can suspend the whole company. Day-to-day, the lack of a transfer path pushes companies to share the owner's credentials, destroying attribution.
- **Affected procedures:** BP-101, BP-116, BP-120.
- **Recommendation:** Implement an explicit, audited ownership transfer (initiated by the owner with password re-entry, or by platform operators with recorded reason and owner notification) and an emergency "freeze owner sessions" action for operators. Correct BR-020 until then.

#### FND-103 No self-service password change and no session overview
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** [Verified] A signed-in user cannot change their own password; the only rotation path is the e-mailed reset link (which also ends all sessions). Users and managers cannot see active sessions or sign out other devices; revocation of a stolen cookie happens only via reset, deactivation or suspension.
- **Potential financial impact:** Slower response to credential compromise at tills (shared terminals); a cashier who suspects their password is known must rely on e-mail access at the terminal.
- **Affected procedures:** BP-106, BP-108.
- **Recommendation:** Add "change password" (current password required, revokes other sessions) and a "sign out everywhere" action; give managers a "end all sessions of this employee" button that does not require deactivation.

#### FND-104 Owner e-mail is never verified at self-registration
- **Classification:** Owner decision to revisit
- **Severity:** Medium
- **Evidence:** [Verified] Registration creates an active company and signs the owner in without verifying the e-mail (ADR-0025, OQ-025 open); invited employees, by contrast, are marked verified because they used the link. The e-mail is the only recovery channel (BP-108) and the only identity key across companies.
- **Potential financial impact:** A mistyped or squatted address locks the real owner out of recovery; someone may register another person's address, blocking that person from later registering their own company (they are told the address is taken) and receiving the real person's reset links if the address is ever obtained. Also enables disposable registrations consuming the trial plan.
- **Affected procedures:** BP-101, BP-108, BP-114.
- **Recommendation:** Verify the address before the first financial action or within a grace period; show "unverified" on the company profile and the platform console.

#### FND-105 Audit entries for profile-type edits record the fact but not the values
- **Classification:** Control gap (audit trail)
- **Severity:** Medium
- **Evidence:** [Verified] "Company profile updated", "branch updated", "employee updated" and "role deleted" carry no old/new values (role deletion keeps only the name, not the permission set). Only role-assignment changes and role-permission edits record before/after. Branch codes and company legal data can therefore change without a reconstructible history.
- **Potential financial impact:** Receipt and document identification data (legal name, CR number, branch code/receipt texts) can be altered without evidence of what they were at the time of past sales; disputes over receipts cannot be settled from the log.
- **Affected procedures:** BP-102, BP-111, BP-115, BP-119.
- **Recommendation:** Record changed fields with old and new values (excluding personal data per ADR-0067 where applicable) for company, branch, employee-profile and role deletions.

#### FND-106 Audit log immutability relies on database grants only; no tamper-evidence or retention policy
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** [Verified] UPDATE/DELETE are revoked from the runtime role and RLS restricts reads; but the migration role and administrators are unrestricted, migrations themselves insert "system" rows, there is no hash chaining, no periodic export to write-once storage, and no retention/archiving rule. Stand-alone audit writes (failed sign-ins) are best-effort: a failed write is only logged.
- **Potential financial impact:** Low in daily operation; relevant for external audit assurance and for investigating privileged misuse.
- **Affected procedures:** BP-121.
- **Recommendation:** Define retention; export daily to write-once storage; consider a running hash per company; document that migration-time rows are system actions.

#### FND-107 Documentation does not match behaviour in several identity details
- **Classification:** Inconsistency (doc vs behaviour)
- **Severity:** Low
- **Evidence:** [Verified] (a) AUTH.md §4 describes seven guards including a "merchant context guard" answering 423 for a suspended company; the code has one access guard and a suspended company yields 401 after the session is revoked on sight. (b) AUTH.md §3.4 lists 40 keys (ADR-0034); the catalogue has 46 (restaurant and online keys are only mentioned in prose). (c) BR-048 lists five default roles; six templates exist (kitchen staff). (d) DATABASE.md claims a uniqueness rule on role name per company; none exists — duplicate role names are allowed. (e) DATABASE.md describes the audit index as including a branch column; the table has no branch column. (f) The membership status "invited" is defined but never used. (g) The management home dashboard permanently shows "Sales, inventory and revenue figures will appear here once those modules are in use" although those modules are live (the figures live on the Reports pages). (h) The "last login" shown per employee is the person's last login in *any* company, not in this one.
- **Potential financial impact:** None directly; misleads reviewers and operators relying on the documents and the home screen.
- **Affected procedures:** BP-106, BP-118, BP-121, BP-101 (dashboard).
- **Recommendation:** Correct the documents; enforce unique role names per company (or at least warn); remove the stale dashboard notice; label "last login" as account-wide.

#### FND-108 Invitation grants are authorised at invitation time, not at acceptance
- **Classification:** Control gap (authorisation)
- **Severity:** Medium
- **Evidence:** [Verified] Acceptance (up to 7 days later; resend extends by 7 more) re-checks only that the roles still exist and the branches are active. It does not re-check that the inviter still holds the authority (the inviter may have been demoted or deactivated meanwhile), and a role whose permission set was widened after the invitation is applied in its widened form. The invitation's grants are also not re-validated on resend beyond the current actor's authority.
- **Potential financial impact:** Narrow window for rights (e.g. refund approval, cash movement) to be granted on the authority of someone who no longer has it.
- **Affected procedures:** BP-113, BP-114.
- **Recommendation:** At acceptance, re-evaluate each grant against the inviter's *current* authority (or against the current authority of the last manager who resent it) and drop grants that fail, recording the dropped grants in the audit entry; expire invitations when the inviter is deactivated.

#### FND-109 Branch deactivation has no operational pre-conditions
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** [Verified] The deactivation checks only that the branch is not the main branch. [Inferred] A branch with open shifts, cash in drawers or treasury, stock on hand, transfers in transit or online fulfilment can be deactivated; staff assigned there lose access instantly (including the cashier mid-shift), while the balances remain and only merchant-wide users can still act on them. Reactivation re-enables every dormant assignment without review (see FND-116).
- **Potential financial impact:** Cash left in a drawer/treasury of a branch nobody local can count or close; stock valued at a branch with no custodian; shift discrepancies attributed later without the responsible cashier being able to act.
- **Affected procedures:** BP-112; Cash and Inventory chapters.
- **Recommendation:** Refuse deactivation while shifts are open, registers hold cash or need a count, treasury balance is non-zero, transfers are in transit, or the branch is the online fulfilment branch; or require an explicit "closing checklist" acknowledgement recorded in the audit entry.

#### FND-110 Account lock-out by failed attempts can be triggered by anyone who knows an e-mail
- **Classification:** Control gap (availability) / Owner decision to revisit
- **Severity:** Medium
- **Evidence:** [Verified] Ten wrong passwords in 15 minutes lock the account even for the correct password, and attempts are counted whether or not the account exists (anti-enumeration). Employee e-mails are visible to colleagues and printed in e-mails. Behind a load balancer without the trusted-proxy setting, all clients share one address so the per-address limit (30 / 10 min) could block an entire company.
- **Potential financial impact:** A cashier or supervisor locked out at peak time cannot open or close a shift or approve a refund for up to 15 minutes; a malicious insider can repeatedly lock a colleague out. No money is lost, but sales and cash procedures stall.
- **Affected procedures:** BP-103, BP-104.
- **Recommendation:** Keep the limit but add a manager "clear lock" action (audited) and prefer progressive delays over hard locks for the correct password; ensure the trusted-proxy setting is part of the deployment checklist (Operations).

#### FND-111 Refused privileged actions are not audited
- **Classification:** Control gap (audit trail)
- **Severity:** Low
- **Evidence:** [Verified] "Privilege escalation" refusals (attempts to grant rights beyond one's authority, to manage the owner or oneself), failed POS unlock attempts, and permission denials in general produce no audit row; only sign-in failures do.
- **Potential financial impact:** Attempts to obtain refund, cash or stock authority leave no trace until they succeed.
- **Affected procedures:** BP-107, BP-113, BP-117, BP-118, BP-120.
- **Recommendation:** Audit anti-escalation refusals and unlock failures with actor and attempted grant.

#### FND-112 POS inactivity lock is detected in the browser, not by the server
- **Classification:** Inconsistency (rule wording vs behaviour)
- **Severity:** Low
- **Evidence:** [Verified] The lock *state* is server-enforced (every request refused once locked), but the 5-minute inactivity trigger is a browser timer; the server idle expiry is 8 hours. A tampered or alternative client can keep an unattended session unlocked. BR-160 states the POS "locks after 5 minutes without input"; ADR-0085 describes the actual mechanism correctly.
- **Potential financial impact:** Low: requires a deliberately modified client at an unattended till.
- **Affected procedures:** BP-107.
- **Recommendation:** Optionally lock server-side when no request carries a "user activity" marker for 5 minutes; otherwise clarify BR-160.

#### FND-113 Default templates concentrate cash custody in the owner and leave segregation choices implicit
- **Classification:** Owner decision to revisit
- **Severity:** Medium
- **Evidence:** [Verified] No template holds treasury custody or bank-deposit rights, so a multi-branch company must build custom roles before anyone but the owner can count a treasury, deposit cash or see total cash. Conversely the company-manager template holds both the right to define roles and the right to grant them, plus payment settings and financial reports, so one person can create and assign to a peer any authority they hold. There is no second-person approval for granting sensitive rights (refund approval, cash custody, price/cost management) and no periodic access review feature.
- **Potential financial impact:** Either operational bottleneck (owner must do all treasury work) or, once custom roles exist, broad grants made by a single manager without oversight.
- **Affected procedures:** BP-113, BP-117, BP-118.
- **Recommendation:** Add a "Treasurer / Cash custodian" template; consider separating role definition from role assignment for sensitive rights, or require the owner's approval for grants of a defined "sensitive" subset; provide an access-review report (who holds which sensitive right where) — which is also the easiest substitute for the missing audit screen.

#### FND-114 Failed sign-in audit rows store attempted e-mails without a company and are unreviewable
- **Classification:** Control gap (audit trail / privacy)
- **Severity:** Low
- **Evidence:** [Verified] Each failed merchant sign-in writes the attempted e-mail and address with no company; such rows are excluded from the platform audit function (not operator / platform events) and merchants have no reader, so they are stored indefinitely and read by nobody through the product.
- **Potential financial impact:** None directly; missed detection of credential-stuffing against cashier accounts; personal data retained without a defined purpose or retention.
- **Affected procedures:** BP-103, BP-104, BP-121.
- **Recommendation:** Attribute failed sign-ins of known users to their companies (visible to the owner), aggregate anonymous failures, define retention.

#### FND-115 Operator lifecycle beyond creation is manual
- **Classification:** Missing process
- **Severity:** Low
- **Evidence:** [Verified] The CLI creates or re-keys an operator; [Inferred] disabling an operator or rotating only the password requires a direct database change, and there is no record of who ran the CLI (no audit row is written by the CLI).
- **Potential financial impact:** Low; operators cannot move money, but can suspend companies and change plans.
- **Affected procedures:** BP-109.
- **Recommendation:** Add disable/enable and list commands that write audit rows naming the engineer; require a reason.

#### FND-116 Reactivating a branch silently restores all dormant grants
- **Classification:** Control gap (authorisation)
- **Severity:** Low
- **Evidence:** [Verified] Role assignments at an inactive branch are kept and become effective again on reactivation without review or audit detail of which grants revived.
- **Potential financial impact:** Former staff of a closed branch regain refund, cash or stock rights there if the branch reopens months later.
- **Affected procedures:** BP-112, BP-117.
- **Recommendation:** On reactivation, list the dormant grants for confirmation or clear them; include the revived grants in the "branch activated" audit entry.

#### FND-117 Members with no role assignments remain active, invisible to branch managers, and count against plan capacity
- **Classification:** Control gap (housekeeping)
- **Severity:** Low
- **Evidence:** [Verified] Removing all assignments keeps the membership active; the person can no longer sign in, is listed only for merchant-wide viewers, and counts as an employee for plan limits.
- **Potential financial impact:** None; may exhaust a limited plan and clutter employee lists.
- **Affected procedures:** BP-117, BP-116.
- **Recommendation:** Prompt to deactivate when the last assignment is removed; show "no roles" members to all employee viewers with a warning.

---

### A.5 Documented owner decisions touching this domain

| Id | Decision (one line) | Residual risk (one line) |
|---|---|---|
| BR-002 / CTL-106 | Exactly one owner per company, implicitly all-powerful, cannot be demoted | Single point of failure; no succession path (FND-102) |
| BR-013 / BR-014 / ADR-0001 | Employees never get management access by default; managers reach the POS only when explicitly granted | None material; relies on grantors not giving managers till roles casually |
| BR-040 / ADR-0025 / OQ-025 | Self-service registration without e-mail verification; "e-mail taken" is disclosed | Address squatting and unrecoverable owners (FND-104) |
| BR-041 / ADR-0006 / ADR-0024 | One identity across companies; each session bound to one company and (POS) one branch | A person's last-login and password reset affect all companies at once |
| BR-042 | Sign-in and recovery never reveal whether an e-mail exists | Lock-out counters run for unknown e-mails too (FND-110) |
| BR-043 | Reset links single-use, 30 min, end all sessions | None material |
| BR-044 / ADR-0032 | Invitation-only onboarding; managers never see passwords | Grants authorised at invite time (FND-108) |
| BR-045 / BR-025 / ADR-0033 / ADR-0034 | Nobody grants beyond their authority, manages the owner, themselves, or a more privileged member; branch-scoped administration | Peer creation by company managers; no four-eyes on sensitive grants (FND-113) |
| BR-046 / ADR-0037 | Branch managers see only their branches; client branch filter never widens access | Members with no grants invisible to them (FND-117) |
| BR-047 | Main branch cannot be deactivated; deactivation removes access at once | No operational pre-conditions (FND-109); dormant grants revive (FND-116) |
| BR-048 / ADR-0090 (BR-079) | Editable default roles; cash in/out removed from cashiers, supervisors keep it | Templates are mutable: a company can give cashiers refund approval; no custody template (FND-113) |
| BR-020 / BR-023 | Owner cannot be deactivated; deactivation revokes sessions immediately | Ownership transfer documented but absent (FND-102) |
| BR-015 / ADR-0007 / BR-158 | Separate operator realm, MFA mandatory, CLI-only creation, all platform actions audited | Operator disabling manual (FND-115) |
| BR-160 / ADR-0085 | POS locks after 5 min idle or on demand; same user's password unlocks; 5 failures end the session | Idle detection client-side (FND-112) |
| ADR-0026 / ADR-0027 / ADR-0086 | CSRF by origin check; rate limits in the database; client address only from configured proxies | Lock-out as denial of service; proxy setting must be deployed correctly (FND-110) |
| ADR-0008 / ADR-0004 / ADR-0031 | Audit entries append-only; forced RLS; migration role bypasses RLS | Append-only only against the runtime role; no tamper-evidence (FND-106) |
| ADR-0080 | Platform reads merchant data only through summary functions; platform actions appear in the merchant's own trail | The merchant's trail has no reader (FND-101) |
| OQ-006 | PIN-based quick switching at shared tills not decided; e-mail + password implemented | Slower cashier changes; temptation to share sessions |

---

### A.6 Technical mapping (appendix)

| BP id | Permission keys / access rule | Main tables | Screens / routes | Document number prefix |
|---|---|---|---|---|
| BP-101 | public | `users`, `merchants`, `branches`, `memberships`, `roles`, `role_permissions`, `subscriptions`, `sessions`, `audit_log` (+ payment defaults, `registers`) | `/manager/register` (`RegisterForm`), `POST /auth/register` | — |
| BP-102 | `merchant.settings.read`, `merchant.settings.update` | `merchants`, `audit_log` | `/manager/settings` (`CompanySettingsPage`), `GET/PATCH /manager/merchant` | — |
| BP-103 | public → `manager.access` at ≥1 branch | `users`, `memberships`, `role_assignments`, `role_permissions`, `branches`, `auth_tickets`, `sessions`, `rate_limit_buckets`, `audit_log` | `/manager/login` (`LoginPage`), `POST /auth/login`, `POST /auth/login/select`, `GET /auth/manager/me` | — |
| BP-104 | public → `pos.access` at the chosen branch | as BP-103 | `/pos/login` (POS `LoginPage`), `POST /auth/login`, `POST /auth/login/select`, `GET /auth/pos/me` | — |
| BP-105 | `@Authenticated` + target interface/branch right | `sessions`, `audit_log` | `POST /auth/{manager\|pos}/switch-merchant`, `/switch-interface`, `POST /auth/pos/switch-branch`, `GET /auth/{iface}/merchants` | — |
| BP-106 | all guarded routes (`DbSessionResolver`, `AccessGuard`) | `sessions`, `users`, `memberships`, `merchants`, `branches` | `POST /auth/{iface}/logout`; `session-policy.ts` lifetimes | — |
| BP-107 | `@Authenticated('pos')` for lock; public (cookie + password) for unlock / sign-out | `sessions.locked_at`, `rate_limit_buckets`, `audit_log` | `POSLayout` idle timer (`POS_IDLE_LOCK_SECONDS`), `POST /auth/pos/lock`, `/auth/pos/unlock`, `/auth/pos/lock/sign-out` | — |
| BP-108 | public; manager trigger `employees.manage` | `password_reset_tokens`, `users`, `sessions`, `rate_limit_buckets`, `audit_log` | `/manager/forgot-password`, `/manager/reset-password`, `/pos/...` equivalents; `POST /auth/password/forgot`, `/auth/password/reset`, `POST /manager/employees/:id/password-reset` | — |
| BP-109 | public → `@RequirePlatformRole`; CLI `platform:create-operator` | `platform_operators`, `auth_tickets`, `sessions`, `rate_limit_buckets`, `audit_log` | `/platform/login`, `POST /auth/platform/login`, `/auth/platform/mfa`, `GET /auth/platform/me`; `POST /platform/merchants` (support/super admin) | — |
| BP-110 | `branches.manage` | `branches`, `registers`, `subscriptions`, `audit_log` | `/manager/branches` (`BranchesPage` dialog), `POST /manager/branches` | branch code (e.g. `MAIN`) |
| BP-111 | `branches.read`, `branches.update` (at branch) | `branches`, `audit_log` | `GET /manager/branches`, `GET/PATCH /manager/branches/:branchId` | — |
| BP-112 | `branches.manage` | `branches`, `role_assignments` (dormant), `sessions`, `audit_log` | `POST /manager/branches/:branchId/status` | — |
| BP-113 | `employees.manage` + every role right at the branch (`canGrant`) | `invitations`, `invitation_assignments`, `subscriptions`, `audit_log` | `/manager/employees` (`EmployeesPage`, `InviteDialog`, `AssignmentsEditor`); `POST /manager/employees/invitations`, `/:id/resend`, `/:id/revoke` | — |
| BP-114 | public (token) | `invitations`, `users`, `memberships`, `role_assignments`, `audit_log` | `/manager/accept-invite`, `/pos/accept-invite`; `POST /auth/invitations/preview`, `/auth/invitations/accept` | — |
| BP-115 | `employees.read` (view), `employees.manage` + `canManageMember` | `memberships`, `audit_log` | `/manager/employees/:membershipId` (`EmployeeDetailPage`); `GET /manager/employees`, `GET/PATCH /manager/employees/:id` | — |
| BP-116 | `employees.manage` + `canManageMember` | `memberships`, `sessions`, `subscriptions`, `audit_log` | `POST /manager/employees/:id/status` | — |
| BP-117 | `employees.manage` + `canManageMember` + `canGrant` | `role_assignments`, `audit_log` | `PUT /manager/employees/:id/assignments` | — |
| BP-118 | `roles.manage` (merchant-wide); view `employees.read` | `roles`, `role_permissions`, `audit_log` | `/manager/roles` (`RolesPage`, `RoleDialog`); `GET /manager/permissions`, `GET/POST /manager/roles`, `PATCH /manager/roles/:roleId` | — |
| BP-119 | `roles.manage` | `roles`, `role_permissions`, `role_assignments`, `invitation_assignments`, `audit_log` | `DELETE /manager/roles/:roleId` | — |
| BP-120 | `@Public` / `@Authenticated` / `@RequirePermission` / `@RequirePlatformRole`; `can`, `canAnywhere`, `assertCan`, `permissionBranchScope` | all tenant tables (forced RLS; `app.merchant_id`, `app.user_id`, `app.invite_hash`, `app.operator_id`) | `AccessGuard`, `RouteAccessAuditor`, `packages/permissions` | — |
| BP-121 | writers: all services; reader: `@RequirePlatformRole(support, super_admin)`; merchant `audit.read` unused | `audit_log` (RLS; UPDATE/DELETE revoked from `app_runtime`); SQL `platform_audit` | `/platform/audit`, `GET /platform/audit`; **no `/manager` route** | — |

---

## Chapter B: Product catalog and inventory

### B.0 Scope and sources reviewed

- **Business purpose.** This domain holds the merchant's master data for what is sold (categories,
  products, variants, SKUs, barcodes, selling prices, standard costs, images, branch availability)
  and the quantity-and-value record of goods held at each branch (opening stock, increases,
  decreases, counts, low-stock alerts, movement history, valuation at moving weighted-average cost).
  Every other operational domain that touches goods — POS sales, returns, purchasing receipts,
  branch transfers, restaurant waste, online-store reservations — changes stock only by calling the
  single inventory posting engine described here, so the controls in this chapter determine
  whether the company's stock quantities and stock value can be relied upon by management and by
  an external auditor. The domain deliberately contains no general ledger: its financial output is
  the stock value, the unit cost recorded on each movement (which feeds cost of sales and gross
  profit in Reports), and the audit trail of who changed what.
- **Files/screens reviewed.** API: `apps/api/src/modules/catalog/{catalog.service,catalog.controller,
  catalog.schema,catalog.int.test}.ts`; `apps/api/src/modules/inventory/{inventory.service,
  stock-ledger.service,consumption,inventory.controller,inventory.schema,inventory.int.test}.ts`;
  callers of the ledger in `sales.service.ts`, `refunds.service.ts`, `purchasing.service.ts`,
  `transfers.service.ts`, `restaurant-orders.service.ts`, `restaurant-config.service.ts`,
  `ecommerce.service.ts`, `online-payments.service.ts`; inventory section of
  `reports.service.ts`; `branches.service.ts` (deactivation). Migrations `0006_catalog`,
  `0007_catalog_rls`, `0008_inventory`, `0009_inventory_rls`, `0025_ecommerce` (reservations),
  `0029_delivery_fee_cost`. Shared packages: `packages/money/src/quantity.ts`,
  `packages/contracts/src/{catalog,inventory}.ts`, `packages/permissions/src/{catalog,templates,
  evaluate}.ts`. Screens: `apps/manager-web/src/features/catalog/{ProductsPage,ProductEditorPage,
  CategoriesPage}.tsx`, `apps/manager-web/src/features/inventory/{InventoryPage,
  AdjustmentEditorPage,AdjustmentsPage,MovementsPage,shared}.tsx`, `apps/pos-web/src/sale/SalePage.tsx`
  (stock on tiles), English UI strings in `apps/manager-web/src/i18n/en.ts`. Documentation:
  `docs/BUSINESS_RULES.md` (BR-049…052, BR-060…066, BR-100…104, BR-128, BR-135/136, BR-144/145,
  OQ-014), `docs/DECISIONS.md` (ADR-0038…0045, 0063, 0064, 0070, 0074, 0079, 0084), `docs/ROUTES.md`,
  `docs/PROGRESS.md`.
- **Coverage statement.** The end-to-end browser tests (`e2e/catalog.spec.ts`, `e2e/inventory.spec.ts`)
  were located but not read; conclusions on screen behaviour come from the React sources and the
  component tests. The purchasing, transfer, refund and online-store workflows were read only as far
  as they post to the stock ledger; their own authorisations and documents belong to other chapters.
  The platform-operator interface was not reviewed because it exposes no catalog or inventory
  function. Nothing was executed; no database was inspected.

### B.1 Roles and authority matrix

Permission keys are translated into plain words here; the exact keys are in B.6. "Branch-scoped"
means the user must hold the permission for the branch concerned (a merchant-wide assignment counts
for every branch). "Merchant-wide only" means the permission is effective only when the role is
assigned without a branch; a branch-limited assignment of such a right does nothing [Verified in
the permission evaluator]. The Owner holds every right implicitly and cannot be restricted.
Platform operators belong to a separate identity realm and have **no** route into catalog or
inventory data [Verified: no platform controller in either module].

| Operation | Right required (plain words) | Scope | Owner | Company Manager | Branch Manager | Supervisor | Cashier | Kitchen | Platform ops |
|---|---|---|---|---|---|---|---|---|---|
| View categories, products, product detail, product images (manager app) | View products and categories | branch-scoped gate, but the list is merchant-wide once passed | Yes | Yes | Yes | No manager access | No manager access | No | No |
| Create / edit / archive / restore categories | Create and edit products and categories | merchant-wide only | Yes | Yes | No | No | No | No | No |
| Create a product, edit names/description/category/type/stock-tracking/availability, upload or remove images, archive/restore | Create and edit products and categories | merchant-wide only | Yes | Yes | No | No | No | No | No |
| Set or change a selling price, set or change a standard cost, add a priced variant, see the cost field | Change prices and costs (in addition to the above) | merchant-wide only | Yes | Yes | No | No | No | No | No |
| Download the POS catalog snapshot and POS images | View products and categories, in a POS session | bound POS branch | Yes (if POS-authorised) | Only if explicitly granted POS access | Only if explicitly granted POS access | Yes | Yes | Yes | No |
| See stock quantities / status per item at the POS | View products and categories (POS) | bound POS branch | as above | as above | as above | Yes | Yes | Yes | No |
| View stock levels, per-branch breakdown, summary counts, movement history, adjustment list/detail | View stock | branch-scoped; reads are filtered to the branches where held | Yes | Yes (all) | Yes (own branches) | Yes (own branches, but no manager-app access by default, so only via a custom role) | No | No | No |
| See average cost, stock value, unit cost and value on movements/adjustments | Change prices and costs **or** Inventory reports and valuation for every branch in view | merchant-wide or branch-scoped respectively | Yes | Yes | Yes (branch manager holds inventory reports) | No | No | No | No |
| Post opening stock, increase, decrease, count; set low-stock alert | Adjust stock | branch-scoped, checked at the exact branch of the document | Yes | Yes | Yes (own branches) | No | No | No | No |
| Enter a unit cost on an opening/increase line | Adjust stock **and** Change prices and costs | merchant-wide for the cost right | Yes | Yes | No (increase is valued at the current average or catalog cost instead) | No | No | No | No |
| View the negative-stock setting | View stock | — | Yes | Yes | Yes | custom only | No | No | No |
| Change the negative-stock setting | Change company settings | merchant-wide only | Yes | Yes | No | No | No | No | No |
| Inventory report (valuation, movements by type, adjustments by reason) | Inventory reports and valuation | branch-scoped | Yes | Yes | Yes (own branches) | No | No | No | No |
| Approve a stock adjustment / second signature | — (no such step exists) | — | — | — | — | — | — | — | — |

Observations on the matrix: (a) there is no approval right for adjustments — whoever may adjust may
post any quantity, any reason, without limit (FND-201); (b) a Branch Manager sees average cost and
stock value but not the catalog standard cost, because the two visibilities are governed by
different rights [Verified]; (c) the manager-app "view products" gate is branch-scoped but, once
passed, the product list and the availability lists of all branches are visible [Verified] — this
is master data and is acceptable, but it is worth knowing when designing roles.

### B.2 Procedures

#### BP-201 Maintain product categories
- **Business purpose:** Group products for navigation in the manager app, the POS and the online
  store; categories also route restaurant kitchen tickets (Restaurant domain) and feed sales
  reports by category.
- **Actors and required authority:** View: any manager-app user with "view products and
  categories". Create/edit/archive/restore: "create and edit products and categories"
  (merchant-wide). Default holders: Owner, Company Manager.
- **Trigger / inputs:** Name in Arabic and/or English (at least one, max 80 characters), optional
  parent category, sort order 0–10,000; on edit, the current version number.
- **Normal flow:**
  1. The user opens Categories, adds or edits a category. [Verified] The system requires at least
     one name and checks that the chosen parent exists, is not the category itself and is not one of
     its descendants (walks up to 10 levels; deeper or circular chains are refused).
  2. On save the system increments the category's version and writes an audit entry
     ("category created/updated") with the actor, IP and target. [Verified]
  3. Archive/restore flips the status and writes an audit entry. [Verified] Archived categories
     keep their products: in the POS the products stay sellable but appear without a category;
     in the product editor an archived category remains selectable only for the product that
     already uses it. [Verified]
  4. The category list shows the count of active products per category. [Verified]
- **Exceptional cases and their handling:**
  - Editing with a stale version is refused (version conflict); the user must reload. [Verified]
  - Placing a category inside itself or a descendant is refused. [Verified]
  - A category of another merchant is invisible and cannot be referenced (not found). [Verified]
  - There is no delete; archiving a parent does not cascade to children [Verified: status update
    touches one row]. Children of an archived parent stay active [Inferred from code; not tested].
- **Existing controls:**
  - CTL-201 Backend permission check per operation; default deny.
  - CTL-203 Optimistic locking with a version number on every edit.
  - CTL-206 Audit entry for create, update, archive, restore.
  - CTL-208 Row-level tenant isolation on every catalog table.
- **Financial / stock / cash effect:** None directly. Category is a reporting attribute of sales
  (snapshotted at sale time in the Sales domain).
- **Upstream dependencies:** Merchant and an active manager session.
- **Downstream effects:** Product editor, POS catalog, online-store catalog, kitchen routing,
  sales-by-category report.
- **Observations:** FND-208 (partial audit detail).

#### BP-202 Create a product (simple or with variants)
- **Business purpose:** Define a sellable item: its names, type (goods or service), whether its
  stock is tracked, one or more variants each with SKU, barcodes, selling price and standard cost,
  and where it may be sold.
- **Actors and required authority:** "Create and edit products and categories" (merchant-wide).
  Because creating a product always creates at least one priced variant, "change prices and
  costs" is also required; without it the creation is refused outright. [Verified by test: a
  "catalog editor" role without the price right receives a refusal]. Default holders: Owner,
  Company Manager.
- **Trigger / inputs:** Names (Arabic/English, at least one, max 160), descriptions (max 2,000),
  category, type (goods/service), "track stock", availability (all branches or a list of 1–500
  branches), 1–100 variants each with optional names (required when the product "has variants"),
  optional SKU (1–64 characters from a restricted set), up to 10 barcodes (3–64 characters),
  selling price (0 to 1,000,000,000 KWD, max 3 decimals), optional cost (same range).
- **Normal flow:**
  1. The user fills the editor. The screen validates locally with the same rules as the server
     and shows field errors. [Verified]
  2. On save the server checks the subscription plan's product capacity, the category and the
     branches (must belong to the merchant), rejects duplicate SKUs or barcodes inside the request,
     parses every price and cost exactly in fils (no rounding; more than 3 decimals, negative,
     scientific notation, or out-of-range values are refused). [Verified by tests]
  3. The product row is inserted; a service is forced to "not tracked" (also enforced by a database
     check). [Verified]
  4. Availability rows are written when the product is restricted to selected branches. [Verified]
  5. Variants are inserted in the given order; the first is the default (database guarantees one
     default per product); barcodes are written per variant. [Verified]
  6. One audit entry "product created" lists each variant created with its price. [Verified]
  7. The response includes cost only for users with the price right. [Verified]
- **Exceptional cases and their handling:**
  - A simple product with two variants, or a "has variants" product with an unnamed variant, is
    refused. [Verified]
  - SKU already used by this merchant (case-insensitive, **including archived variants**) → refused
    as duplicate SKU; barcode already used by a live variant → duplicate barcode. The same codes may
    be used by a different merchant. [Verified]
  - Plan product limit reached → refused by the capacity check in the same transaction. [Verified
    in code; limit behaviour belongs to the Platform domain]
  - Availability naming another merchant's branch → not found. [Verified]
  - No cost entered → the variant has no standard cost; its stock will be "unvalued" until a
    costed movement arrives (see BP-216). [Verified]
- **Existing controls:**
  - CTL-201, CTL-202 (price/cost right gate), CTL-204 (SKU/barcode uniqueness per merchant, enforced
    by database unique indexes as well as pre-checks), CTL-205 (exact money parsing, range check
    duplicated as database constraints), CTL-206, CTL-208, CTL-209 (plan capacity).
- **Financial / stock / cash effect:** None at creation; no stock balance exists until a movement.
  The standard cost entered here is only a fallback for valuation (BP-216).
- **Upstream dependencies:** Categories (optional), branches (for restricted availability),
  subscription plan with free capacity.
- **Downstream effects:** POS catalog (BP-207), inventory lists (BP-214; only tracked goods appear),
  purchasing (orders name variants), online listings, restaurant recipes/modifiers.
- **Observations:** FND-216, FND-223.

#### BP-203 Edit a product, its variants, prices and costs
- **Business purpose:** Maintain product data over time: rename, re-categorise, change type or
  stock tracking, re-price, update standard cost, add/rename/remove variants and barcodes.
- **Actors and required authority:** "Create and edit products and categories" for any edit;
  "change prices and costs" additionally to change a price, set or change a cost, or add a new
  variant. [Verified] A user without the price right may still save the product: prices of
  existing variants must be sent unchanged, the cost field is hidden and ignored (the stored cost
  is preserved, not wiped). [Verified by test]
- **Trigger / inputs:** Same as BP-202 plus the current version and, for existing variants,
  their ids. Variants omitted from the request are archived.
- **Normal flow:**
  1. The editor loads the product and shows only active variants. [Verified]
  2. On save, the server validates references and codes as in BP-202, updates the product row only
     if the version matches (increments it), rewrites the availability list, then processes
     variants: variants not in the request are archived (never deleted), lose their barcodes (so
     the codes can be reused), and lose the default flag; present variants are updated (price,
     names, SKU, position, and cost if the actor may); new variants are inserted (price right
     required). [Verified]
  3. Every price change and every cost change is written to the audit entry as old → new per
     variant, together with the product's previous status and name. [Verified by test]
- **Exceptional cases and their handling:**
  - Stale version → version conflict. [Verified]
  - A variant id that does not belong to this product/merchant → not found (prevents hijacking a
     foreign variant). [Verified]
  - Price change by a user without the price right → refused. [Verified]
  - Removing a variant that still has stock is **not** blocked; its balance stays in the inventory
     list and valuation but can no longer be adjusted (see FND-206).
  - Turning "track stock" off (or changing type to service) on a product that has stock is **not**
     blocked and is not detailed in the audit entry; its balances disappear from stock lists,
     summary and the inventory report while the balance rows persist (FND-207).
  - Changing the standard cost never changes the average cost of existing balances (BP-216).
- **Existing controls:** CTL-201, CTL-202, CTL-203, CTL-204, CTL-205, CTL-206 (price/cost
  old → new), CTL-207 (database grant forbids deleting products and variants; archive only),
  CTL-208.
- **Financial / stock / cash effect:** Price changes affect future sales only (sales snapshot the
  price; Sales domain). Cost changes affect only future movements where no average exists. No
  stock quantity changes.
- **Upstream dependencies:** BP-202.
- **Downstream effects:** POS catalog version changes (BP-207), online catalog, inventory lists.
- **Observations:** FND-206, FND-207, FND-208, FND-222, FND-223.

#### BP-204 Restrict a product to selected branches
- **Business purpose:** Sell some items only at certain branches (BR-051).
- **Actors and required authority:** As BP-203 (no price right needed for availability alone).
- **Trigger / inputs:** "All branches" or a list of branch ids (at least one).
- **Normal flow:** The server replaces the availability list on each save. The POS catalog and the
  manager product list filtered by branch include a product if it is available everywhere or
  explicitly listed for that branch. [Verified by tests]
- **Exceptional cases and their handling:** Empty list with "selected branches" → refused;
  foreign branch → not found. [Verified] Availability does not block stock: stock may be held and
  adjusted at a branch where the product is not sellable [Verified: the adjustment path never
  checks availability]. Availability does not affect inventory counts or valuation.
- **Existing controls:** CTL-201, CTL-203, CTL-208.
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** Branches.
- **Downstream effects:** POS catalog (BP-207), online store catalog, product list filters.
- **Observations:** none beyond FND-208.

#### BP-205 Archive or restore a product
- **Business purpose:** Withdraw an item from sale without losing history (BR-049).
- **Actors and required authority:** "Create and edit products and categories".
- **Trigger / inputs:** Product id, target status; confirmation dialog on archive. [Verified]
- **Normal flow:**
  1. Archive sets the status, increments the version and writes an audit entry. The product
     vanishes from the POS catalog and from the default product list (filter "archived"/"all"
     shows it). [Verified]
  2. Restore checks the plan's product capacity, then reactivates. [Verified]
- **Exceptional cases and their handling:**
  - Archiving a product that holds stock is allowed; the balance remains listed in inventory
    (archived items stay listed while on hand ≠ 0) and in the valuation, but any adjustment on it
    is refused as "archived" until the product is restored (FND-206).
  - Deleting is impossible for the application database role. [Verified by test]
  - Another merchant's product → not found. [Verified]
- **Existing controls:** CTL-201, CTL-206, CTL-207, CTL-208, CTL-209 (capacity on restore).
- **Financial / stock / cash effect:** None; stock value of the archived item remains in the
  valuation.
- **Upstream dependencies:** BP-202.
- **Downstream effects:** POS catalog, online listings, inventory lists.
- **Observations:** FND-206.

#### BP-206 Manage product images
- **Business purpose:** Pictures for POS tiles and the online store.
- **Actors and required authority:** Upload/remove: "create and edit products and categories";
  view: "view products and categories" (manager) or POS catalog right at the bound branch.
- **Trigger / inputs:** One image file per upload (JPEG, PNG or WebP, ≤ 2 MB), max 8 per product.
- **Normal flow:** The server detects the real file type from the bytes (a script renamed as .png
  is refused), stores the file through the storage abstraction inside the database transaction
  (a storage failure rolls back the record), records size, type and position, touches the product's
  updated time and writes an audit entry. Images are served only to users who may read that
  merchant's catalog, with strict content headers. [Verified by tests]
- **Exceptional cases and their handling:** Over-size (413), wrong type (415), 9th image (409),
  foreign merchant (404). Removal physically deletes the record and the file [Verified] — images are
  not financial records, so this is acceptable.
- **Existing controls:** CTL-201, CTL-206, CTL-208, CTL-210 (type sniffing, size and count limits,
  storage write inside the transaction).
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-202 (the product must exist first; the editor says so).
- **Downstream effects:** POS tiles, online store.
- **Observations:** none.

#### BP-207 Distribute the catalog and stock availability to the POS
- **Business purpose:** Give each till an exact list of what it may sell at its branch, at what
  price, with barcodes for scanning, and a view of stock on hand so cashiers do not promise goods
  that are not there.
- **Actors and required authority:** POS session bound to a branch with "view products and
  categories" (Cashier, Supervisor, Kitchen by default; managers only if explicitly granted POS
  access per BR-014).
- **Trigger / inputs:** Opening the sale screen; later revalidation with the catalog version tag.
- **Normal flow:**
  1. The POS downloads a snapshot of active products × active variants available at the bound
     branch (archived categories are shown as "no category"), with prices and barcodes but **never
     costs**. [Verified by test: the response body contains no cost field]
  2. The snapshot carries a content hash served as a cache tag; an unchanged catalog answers
     "not modified". [Verified]
  3. The POS separately requests stock availability for tracked items at the bound branch: on-hand
     quantity, status (in stock / low / out / negative) and whether negative stock is allowed. No
     costs. [Verified] Tiles show "in stock n", "low" or "out of stock" badges. [Verified in
     SalePage]
  4. Prices are re-read on the server at checkout; the snapshot is never trusted for money
     (ADR-0041) [Owner decision / engineering default; checkout belongs to the Sales domain].
- **Exceptional cases and their handling:**
  - A POS session without a bound branch is refused. [Verified]
  - A cashier's POS cookie cannot be used against manager endpoints (401). [Verified]
  - Availability shown on the tile is informational; the server enforces the stock policy at
    checkout (BP-216). [Verified]
- **Existing controls:** CTL-201, CTL-208, CTL-211 (no costs to the POS; prices re-read at checkout).
- **Financial / stock / cash effect:** None (read-only).
- **Upstream dependencies:** BP-202…BP-205, BP-208, stock balances.
- **Downstream effects:** Sales domain checkout; Returns; Restaurant ordering.
- **Observations:** none.

#### BP-208 Configure the negative-stock policy
- **Business purpose:** Decide whether the company tolerates selling or writing off more than the
  book quantity (e.g. goods sold before the receipt is posted) — BR-062, ADR-0044.
- **Actors and required authority:** View: "view stock". Change: "change company settings"
  (merchant-wide; Owner and Company Manager by default). A Branch Manager is refused. [Verified]
- **Trigger / inputs:** A single switch "Allow selling and decreasing below zero" plus the current
  version of the setting.
- **Normal flow:** The dialog shows the switch and the costing method ("moving weighted average",
  not changeable). Saving locks the setting row, checks the version, writes the new value and an
  audit entry with old → new. The setting applies to all branches of the merchant immediately.
  [Verified]
- **Exceptional cases and their handling:** Stale version → conflict. [Verified] Transfers out of
  a branch always deny negative stock regardless of the setting (ADR-0064). [Verified] Online
  reservations also honour the setting (when negative stock is allowed, reservations are not
  enforced as a ceiling). [Verified in the ledger]
- **Existing controls:** CTL-212 (merchant-wide right, version check, audit old → new).
- **Financial / stock / cash effect:** When enabled, balances may go below zero: negative balances
  are valued at zero and, when replenished, the incoming cost replaces the average (see FND-204).
- **Upstream dependencies:** none.
- **Downstream effects:** Every decrease (sales, write-offs, counts downward, waste); POS
  availability message.
- **Observations:** FND-204.

#### BP-209 Record opening stock
- **Business purpose:** Establish the first book quantity (and, optionally, unit cost) of an item at
  a branch when the system goes live or a new item/branch starts.
- **Actors and required authority:** "Adjust stock" at the branch (Owner, Company Manager, Branch
  Manager at own branches). Entering a unit cost additionally requires "change prices and costs";
  otherwise the cost field is not shown and the line is valued at the catalog standard cost (or
  stays unvalued). [Verified]
- **Trigger / inputs:** Branch, kind "Opening stock", reason (only "Opening balance"), optional
  note (max 500), 1–200 lines each with an item and a positive quantity (max 3 decimals), optional
  unit cost; a client-generated idempotency key.
- **Normal flow:**
  1. The user chooses a branch (quantities are per branch; changing the branch clears the lines),
     searches items by name, SKU or barcode among stock-tracked items at that branch, enters
     quantities (and unit costs when allowed). The screen shows "Current" and "After" per line.
     [Verified]
  2. A confirmation dialog states that adjustments cannot be edited or deleted. [Verified]
  3. The server checks the right at the exact branch, that the branch is active, that every item
     is an active, stock-tracked variant of this merchant, parses quantities exactly, and refuses
     the whole document if **any** line of the item already has a movement at that branch
     ("opening stock can only be set before any other movement; use an adjustment or a count").
     [Verified by test]
  4. In one transaction it creates the adjustment document (kind, reason, note, author, request
     hash), posts one ledger movement per line of type "opening" at the given cost (or the average,
     then the catalog cost), writes the document lines (entered quantity, previous on-hand, delta,
     unit cost) and an audit entry listing each item's delta and resulting balance. [Verified]
  5. The user is taken to the posted document, which shows before / delta / after and (to cost
     viewers) the unit cost. [Verified]
- **Exceptional cases and their handling:**
  - Item already has history at this branch → whole document refused. [Verified]
  - Quantity 0, negative, more than 3 decimals, scientific notation; reason not valid for the
    kind; same item twice; service or untracked item; archived item → refused with field-level
    issues, nothing posted. [Verified by tests]
  - Unit cost given by a user without the price right → refused. [Verified]
  - Retried submission with the same key and identical content returns the same document once
    (also under three simultaneous submissions); same key with different content → conflict.
    [Verified by test]
  - Inactive branch → refused. [Verified in code]
  - Another merchant's item or branch → refused / not found. [Verified by test]
- **Existing controls:** CTL-213 (exact-branch right), CTL-214 (active tracked items only),
  CTL-215 (active branch), CTL-216 (reason catalogue, note on "other", quantity validation, no
  duplicate lines, ≤ 200 lines), CTL-217 (opening only without history), CTL-218 (idempotency key +
  request hash), CTL-219 (row locks in a fixed order, all-or-nothing, automatic retry on
  deadlock), CTL-221 (append-only document and ledger), CTL-222 (full movement record),
  CTL-223 (audit entry), CTL-224 (cost entry gated), CTL-225 (immutability warning).
- **Financial / stock / cash effect:** Balance rises from 0 to the quantity; average cost becomes
  the entered cost (or the catalog cost; or remains unknown). Stock value increases by quantity ×
  unit cost rounded half-up to the fils. The document and its ledger rows are immutable afterwards.
- **Upstream dependencies:** BP-202 (tracked goods), active branch, BP-208 irrelevant (increase).
- **Downstream effects:** BP-214/215, Reports (valuation, movements), POS availability, gross
  profit (cost of later sales).
- **Observations:** FND-201, FND-216, FND-220.

#### BP-210 Record a stock increase
- **Business purpose:** Add quantity outside the purchasing flow: goods found, a customer return
  handled outside the POS, goods received without a purchase order, or a correction.
- **Actors and required authority:** As BP-209.
- **Trigger / inputs:** Kind "Increase", reason among Found / Customer return (outside POS) /
  Received (other) / Correction / Other (note mandatory), lines with positive quantities and
  optional unit cost (price right).
- **Normal flow:** As BP-209 steps 1–5, with movement type "adjustment"; no history restriction.
  Each line's unit cost is: the entered cost, else the branch's current average, else the catalog
  cost, else unknown. The average is recomputed as a weighted average (half-up to the fils) unless
  the balance was zero/negative or had no cost, in which case the incoming cost replaces it.
  [Verified by test: 10 @ 1.000 then 10 @ 2.000 → average 1.500]
- **Exceptional cases and their handling:** As BP-209 except the opening restriction. "Other"
  without a note → refused. [Verified]
- **Existing controls:** CTL-213…CTL-216, CTL-218, CTL-219, CTL-221…CTL-225.
- **Financial / stock / cash effect:** Balance and stock value rise; average cost may change.
  No cash effect — a "received (other)" increase creates no supplier liability or payment record.
- **Upstream dependencies:** BP-202, active branch.
- **Downstream effects:** Valuation, movement history, POS availability, adjustments report by
  reason.
- **Observations:** FND-201, FND-212, FND-218.

#### BP-211 Record a stock decrease (write-off)
- **Business purpose:** Remove damaged, expired, lost, stolen or internally used goods, or correct
  an overstatement.
- **Actors and required authority:** As BP-209; a unit cost can never be entered on a decrease.
  [Verified]
- **Trigger / inputs:** Kind "Decrease", reason among Damaged / Expired / Lost / Theft / Internal
  use / Correction / Other (note mandatory), positive quantities.
- **Normal flow:** As BP-209 steps 1–5 with movement type "adjustment" and a negative delta. The
  line leaves stock at the current average cost (or catalog cost if no average); the average is
  unchanged. [Verified by test: decrease 2.5 at average 1.500]
- **Exceptional cases and their handling:**
  - If negative stock is not allowed and any line would take the balance below zero, the **whole
    document** is refused with, per short line, the available and requested quantities. [Verified]
    When allowed, the balance goes negative and is shown with status "negative". [Verified]
  - Sixteen simultaneous decreases of 1 against a balance of 10 → exactly 10 succeed, 6 are refused,
    balance ends at 0 (no lost update). [Verified by test]
  - Online reservations are **not** deducted from availability for manual decreases (only sales and
    transfers respect reservations) [Verified in the ledger: reservation check applies to sale and
    transfer-out types only]; a write-off can therefore consume stock promised to an unpaid online
    order, which then fails at payment and becomes "needs attention" (Online store domain).
- **Existing controls:** CTL-213…CTL-216, CTL-218, CTL-219, CTL-220 (negative-stock policy with
  per-line shortage report), CTL-221…CTL-225.
- **Financial / stock / cash effect:** Balance falls; stock value falls by quantity × average
  (half-up); the movement records the cost leaving. There is no shrinkage/expense posting beyond
  the movement value and the reason.
- **Upstream dependencies:** Existing balance (unless negative allowed).
- **Downstream effects:** Valuation, adjustments-by-reason report (quantities only), POS
  availability, online reservations.
- **Observations:** FND-201, FND-213.

#### BP-212 Record a stock count
- **Business purpose:** Align the book quantity with a physical count; the system derives and
  posts the difference.
- **Actors and required authority:** As BP-209; no unit cost may be entered.
- **Trigger / inputs:** Kind "Stock count", reason "Stock count" (only option), lines with the
  counted quantity (zero allowed), optional note.
- **Normal flow:**
  1. The user adds the counted items; the screen shows the current book quantity and the resulting
     "After" (= counted quantity). [Verified] The count is **not blind**: the current quantity is
     visible before entry.
  2. On posting, the server locks each item's balance and computes delta = counted − book quantity
     **at posting time**, posts a movement of type "count" only when the delta is non-zero, and
     writes a document line in all cases (a matching count records a line with delta 0 and no
     movement). [Verified by test]
  3. A positive delta enters at the current average (or catalog cost); a negative delta leaves at
     the current average; the average itself is unchanged. [Verified]
- **Exceptional cases and their handling:**
  - A downward count that would breach the negative policy cannot occur (it sets to a non-negative
    quantity), but a count to a quantity below outstanding online reservations is permitted
    [Inferred: counts are not in the reservation-respecting list].
  - Items not listed on the count are untouched; there is no "full count" mode that sets unlisted
    items to zero, no count session, no freeze of sales during counting, and no variance report per
    count (FND-202).
  - Sales between the physical count and the posting are overwritten by the "set to counted"
    semantics (FND-202).
- **Existing controls:** CTL-213…CTL-216, CTL-218, CTL-219, CTL-221…CTL-225; the count document
  preserves previous on-hand, counted quantity and delta per line (CTL-222).
- **Financial / stock / cash effect:** Balance set to the counted quantity; value changes by
  delta × average. The adjustments report shows count quantities net per reason.
- **Upstream dependencies:** Existing items; a physical count performed outside the system.
- **Downstream effects:** Valuation, movement history, POS availability, Reports.
- **Observations:** FND-201, FND-202, FND-220.

#### BP-213 Set a low-stock alert threshold
- **Business purpose:** Flag items to reorder (BR-065).
- **Actors and required authority:** "Adjust stock" at the branch. The screen offers the action
  only when a single branch is selected. [Verified]
- **Trigger / inputs:** Item, branch, threshold quantity (≥ 0, 3 decimals) or empty to disable.
- **Normal flow:** The server verifies the branch and that the item is an active tracked item,
  creates the balance row if absent, stores the threshold and writes an audit entry. Status rules:
  below zero = negative, zero = out, at or below threshold = low, else in stock. In the all-branch
  aggregate an item is "low" if any branch is low. [Verified by tests]
- **Exceptional cases and their handling:** Archived or untracked item → refused; foreign branch
  → not found. [Verified] An inactive branch is not refused here [Verified: only existence is
  checked].
- **Existing controls:** CTL-213, CTL-214, CTL-228 (validation and audit).
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-202.
- **Downstream effects:** Stock list filters, summary counts, POS "low" badge, inventory report
  ordering.
- **Observations:** none.

#### BP-214 View stock levels, per-branch breakdown, summary and valuation
- **Business purpose:** Management's day-to-day view of what is on hand, what is low or out, and
  what the stock is worth.
- **Actors and required authority:** "View stock" for the branches shown; costs/values only with
  "change prices and costs" or "inventory reports" covering every branch in view. [Verified: a
  "stock clerk" role with view-stock only receives no cost fields and no total value]
- **Trigger / inputs:** Optional branch (otherwise the aggregate of all branches the user may
  read), search text, category, stock filter (all / low / out / in stock), sort, pagination (≤ 100).
- **Normal flow:**
  1. The list shows tracked items (active, or archived while they still hold stock) with on-hand,
     threshold (single branch), status, and — for cost viewers — average cost (single branch) and
     value. [Verified]
  2. Value per item = on-hand × average cost, rounded half-up per balance, counting only positive
     balances with a known cost; items in stock without a cost are counted as "unvalued" and shown
     in the summary hint. [Verified by test: 1.5 × 0.333 → 0.500]
  3. Summary cards: tracked items, low, out, total value (cost viewers), costing method, negative
     policy. [Verified]
  4. Clicking an item shows its stock by branch (active branches, or inactive ones that still hold
     stock) and the total across branches. [Verified]
- **Exceptional cases and their handling:**
  - Asking for a branch the user may not read → refused. [Verified]
  - Items of a product whose tracking was switched off disappear from the list even if they hold
    stock (FND-207).
- **Existing controls:** CTL-226 (cost visibility rule), CTL-227 (read scope), CTL-208.
- **Financial / stock / cash effect:** Read-only; this is the stock value management relies on.
- **Upstream dependencies:** All posting procedures.
- **Downstream effects:** Decisions to reorder, count, write off; Reports domain repeats the same
  valuation formula.
- **Observations:** FND-205, FND-207, FND-213.

#### BP-215 View movement history and adjustment documents
- **Business purpose:** Explain every balance: who changed it, when, why, by how much, at what cost,
  from which source document.
- **Actors and required authority:** "View stock" for the branch; costs/values per CTL-226.
- **Trigger / inputs:** Movements: optional branch, item, movement type, inclusive calendar dates
  in the merchant's time zone, pagination (≤ 100). Adjustments: optional branch and kind.
- **Normal flow:**
  1. The ledger list shows, newest first, each movement's date/time, item, type and reason, signed
     quantity, balance after, value (cost viewers), branch, author (blank for system/online sales),
     and a link to the adjustment document when the source is an adjustment. [Verified]
  2. The adjustment list and detail show kind, reason, note, branch, author, and per line the
     before / delta / after and unit cost (cost viewers). [Verified]
  3. The ledger always explains the balance exactly: the sum of movements equals the balance (the
     test suite asserts this after every scenario). [Verified by test]
- **Exceptional cases and their handling:**
  - Movements from sales, refunds, purchase receipts, transfers and restaurant waste appear with
    their source type and id but without a navigable link on this screen (only adjustments link).
    [Verified]
  - The type filter offers "sale void", a type no process ever produces (FND-209).
  - The reason "restaurant_waste" has no translation; it is displayed as the raw key. [Verified:
    no label exists in the English or Arabic string files]
- **Existing controls:** CTL-221, CTL-222, CTL-226, CTL-227, CTL-233 (dates in merchant time zone).
- **Financial / stock / cash effect:** Read-only.
- **Upstream dependencies:** All posting procedures.
- **Downstream effects:** Internal investigation, external audit sampling, Reports.
- **Observations:** FND-209, FND-210, FND-220.

#### BP-216 Post a stock movement through the inventory engine (cross-cutting)
- **Business purpose:** The single posting procedure used by every process that changes stock:
  manual documents (BP-209…212), POS and online sales, returns to stock, purchase receipts, transfer
  dispatch and receipt, restaurant waste. It guarantees that a balance never changes without a
  ledger row, that documents are all-or-nothing, that concurrent users cannot lose an update, and
  it applies the costing rules.
- **Actors and required authority:** None of its own; each calling process enforces its own right
  and provides the source document identity and the acting user.
- **Trigger / inputs:** Branch, movement type, optional reason/note, source type and id, acting
  user, lines (item, mode "change by" or "set to", quantity, optional unit cost), posting options
  (negative policy "follow setting" or "always deny"; "require no history"; the online order whose
  own reservation may be consumed).
- **Normal flow:**
  1. Items are looked up; any unknown item aborts. Items whose product is not stock-tracked are
     skipped (no balance, no movement) but reported back as "not tracked" so the caller can fall
     back to the catalog cost for costing. [Verified by test with a service item in a sale]
  2. Balance rows are created if missing and locked in a fixed order (by item id) so that two
     documents touching the same items in opposite order never deadlock. [Verified by test]
  3. For every line the engine computes previous balance, delta (for "set" mode the delta is
     computed under the lock), new balance and unit cost:
     - **Incoming (delta > 0):** unit cost = cost given by the caller → else the current average →
       else the catalog standard cost → else unknown. New average = weighted average of (previous
       balance × previous average) and (delta × unit cost), rounded half-up to the fils; **if the
       previous balance is zero or negative, or had no average, the incoming cost replaces the
       average outright.** [Verified in the money package and the engine]
     - **Outgoing (delta < 0):** unit cost = current average → else catalog cost → else unknown;
       the average is unchanged. [Verified]
     - Per calling process this means [Verified in each caller]: purchase receipt → at the purchase
       order line's unit cost (BR-102); transfer out → at the source's average, recorded on the
       transfer line; transfer in → at that recorded dispatch cost (BR-128); return to stock → at
       the unit cost recorded on the sale line at the time of sale (the average then), so the
       average is re-blended; POS/online sale and restaurant waste → at the current average;
       adjustment increase/opening → as above with the optional manual cost; count → at the current
       average both ways; adjustment decrease → at the current average.
  4. If the type is a sale or a transfer-out and negative stock is not allowed, quantities held by
     other orders' active, unexpired online reservations are treated as unavailable. [Verified]
  5. Any line that would leave the balance below the available quantity (when the policy forbids it)
     is collected; if there is at least one, the entire document is refused listing each short line
     with available and requested quantities. [Verified]
  6. One ledger row per line with a non-zero delta: signed quantity, balance after, unit cost,
     signed value (quantity × unit cost, half-up), average after, source, note, user, timestamp.
     The balance row is updated with the final balance, average and last-movement time. [Verified]
  7. Because everything happens in the caller's transaction, a later failure (e.g. payment failure
     in checkout) rolls the stock change back. [Verified by test]
  8. Deadlocks or serialization failures are retried up to three times transparently (ADR-0084).
     [Verified in the database service]
- **Exceptional cases and their handling:**
  - "Always deny" overrides a permissive merchant setting (used by transfers). [Verified by test]
  - "Require no history" (opening stock) refuses when any movement exists. [Verified]
  - A zero delta (matching count) produces no ledger row (the database forbids zero-quantity rows).
    [Verified]
  - When the average is unknown, outgoing movements carry no cost and no value; the item's stock
    stays "unvalued"; sales of it make the period's gross profit "unavailable" (ADR-0070).
  - When the balance is negative and a receipt arrives, the negative units' cost history is
    discarded (FND-204).
- **Existing controls:** CTL-219, CTL-220, CTL-221, CTL-222, CTL-229 (reservations), CTL-231
  (transfers deny negative), CTL-232 (ledger-equals-balance invariant asserted by tests), CTL-234
  (untracked items never get balances).
- **Financial / stock / cash effect:** The only place stock quantities and stock value change.
  Each movement's recorded unit cost is what Reports use as cost of sales (sales) and as restocked
  cost (refunds).
- **Upstream dependencies:** Item master data (tracking flag, standard cost), negative policy,
  reservations.
- **Downstream effects:** BP-214/215, Reports (valuation, gross profit, movements), POS
  availability, online availability.
- **Observations:** FND-203, FND-204, FND-205, FND-211, FND-214.

#### BP-217 Honour online-store stock reservations
- **Business purpose:** Prevent the POS or a transfer from selling stock that an unpaid online order
  has reserved for a limited time (BR-144/145, ADR-0079).
- **Actors and required authority:** System (online checkout, payment confirmation, expiry job);
  no merchant user acts directly.
- **Trigger / inputs:** Online checkout reserves the consumed items (recipe items reserve their
  ingredients) for the store's reservation window (5–1,440 minutes, default 30).
- **Normal flow:** Reservation takes the same balance locks as any movement, checks on-hand minus
  other active reservations (unless negative stock is allowed), and records a reservation row.
  Sales and transfer-out movements subtract other orders' active, unexpired reservations from
  availability; the paying order consumes its own reservation. Payment marks the reservation
  consumed; failure, cancellation, expiry release it. A payment arriving after expiry proceeds only
  if stock is still available; otherwise the order is flagged "needs attention" and no sale is
  created. [Verified in the engine and the online-payments service]
- **Exceptional cases and their handling:** Manual decreases, counts and refunds ignore
  reservations (BP-211/212). Reservation rows are never deleted (database grant) but are updated
  (status), so they are not append-only in the strict sense [Verified in the ecommerce grants].
  Public availability shows on-hand minus reservations, capped (never the exact stock). [Verified]
- **Existing controls:** CTL-219, CTL-229.
- **Financial / stock / cash effect:** None until payment; reservations do not change balances or
  valuation and are not shown in the manager inventory screens [Verified: no reserved column].
- **Upstream dependencies:** Online store configuration (Online domain).
- **Downstream effects:** POS checkout refusals; transfer dispatch refusals.
- **Observations:** FND-213 (reserved quantities invisible to inventory management).

#### BP-218 Expand sold items into stock consumption (recipes and modifiers)
- **Business purpose:** For restaurant items, deduct ingredients instead of the dish, and deduct the
  ingredient of a chosen modifier (e.g. extra cheese), once, at the moment of sale (BR-135,
  ADR-0074).
- **Actors and required authority:** System, inside checkout, waste cancellation and online
  checkout. Recipe maintenance needs the restaurant configuration right (Restaurant domain).
- **Trigger / inputs:** Sale lines (item, quantity, chosen modifiers).
- **Normal flow:** An item with a recipe is replaced by its components, each quantity = sold
  quantity × component quantity, multiplied exactly in thousandths with half-up rounding; an item
  without a recipe consumes itself; each chosen modifier with an ingredient adds that ingredient ×
  sold quantity. The resulting lines are posted in one call to BP-216, so stock is deducted at a
  single point and never twice. The cost of each sale line is the sum of its consumed quantities ×
  the unit cost recorded by the engine (unknown if any component has no cost); for an untracked
  item without a recipe the catalog cost is used. [Verified]
- **Exceptional cases and their handling:** A recipe may be given only to an item whose own stock is
  not tracked (otherwise it would be deducted twice); every component must be stock-tracked; an item
  cannot be its own ingredient. [Verified] Refunds of recipe items never restock (the sale line is
  flagged "not tracked"). [Verified: restock requires the sale line's tracked flag] Waste of a sent
  item consumes the ingredients now as an "adjustment" movement with reason "restaurant_waste" and
  the order item as source, outside the adjustment document (FND-210).
- **Existing controls:** CTL-230 (recipe constraints), CTL-219.
- **Financial / stock / cash effect:** Ingredient balances fall; the sale's recorded cost is the
  ingredient cost at average.
- **Upstream dependencies:** Recipes and modifiers (Restaurant domain), ingredient items (BP-202).
- **Downstream effects:** Gross profit (Reports), ingredient valuation, waste visibility.
- **Observations:** FND-203, FND-210.

#### BP-219 Reconcile stock quantities and value to movements over a period
- **Business purpose:** Allow management and the auditor to prove that closing stock = opening
  stock + receipts − issues, and to see what was written off and why.
- **Actors and required authority:** "Inventory reports and valuation" for the branches in the
  report (Owner, Company Manager, Branch Manager for own branches).
- **Trigger / inputs:** Period (merchant time zone), branch filter.
- **Normal flow (what exists today):** The inventory report provides, per branch, the **current**
  valuation (items, total quantity, value at average, unvalued count); the current stock list
  (status, average, value; up to 2,000 rows); for the period, movements grouped by type with count,
  quantity in, quantity out and the sum of recorded movement values; adjustments grouped by kind and
  reason with document count and net quantity (adjustment documents only); and quantities sold /
  returned to stock / returned not restocked per product. [Verified in the reports service]
- **Exceptional cases and their handling:**
  - There is no "value as at date", no opening/closing roll-forward, and movements whose cost was
    unknown contribute zero to the period value, so opening value + period movement values does not
    reconcile to closing value by construction (FND-213).
  - Average-cost rounding means Σ movement values ≠ Σ balances × average even when all costs are
    known (FND-205).
  - Transfer shortfalls (dispatched but not received) have no movement of their own; the difference
    between transfer-out and transfer-in values is the only trace (FND-211).
  - Restaurant waste appears under movement type "adjustment" but not in the adjustments-by-reason
    table (FND-210).
  - Reserved online quantities are not reported (BP-217).
- **Existing controls:** CTL-221, CTL-222, CTL-226, CTL-232 (the quantity ledger is provably
  complete).
- **Financial / stock / cash effect:** Read-only.
- **Upstream dependencies:** All posting procedures.
- **Downstream effects:** Period-end stock figure for management accounts; gross profit (Reports
  domain); insurance / loss claims.
- **Observations:** FND-205, FND-210, FND-211, FND-213, FND-214.

### B.3 Interdependencies with other domains

The catalog is the master data every selling channel reads; the inventory engine is the service
every goods-moving process writes through. Authority flows one way: each calling domain enforces its
own permission, then hands the engine a source document; the engine enforces only physical rules
(policy, locks, costing). Costs recorded here become the cost of sales in Reports; prices defined
here are snapshotted by Sales. The stock figure management sees is therefore only as good as the
discipline of the calling domains (e.g. transfers writing off shortfalls silently) and of the
master-data changes that can hide balances (tracking switched off).

| This domain → other domain | What flows |
|---|---|
| Catalog → Sales (POS and online) | Sellable items per branch, prices, barcodes, tracking flag; prices are re-read at checkout and snapshotted on the sale line; catalog cost is the fallback cost for untracked items. |
| Inventory engine ← Sales | Sale posts "sale" movements (consumption-expanded); the engine refuses when stock (minus reservations) is insufficient under the default policy; the recorded unit cost becomes the sale line's cost. |
| Inventory engine ← Returns & refunds | Restock lines post "refund" movements at the sale line's recorded cost (reason = refund / void / exchange); non-tracked lines never restock. |
| Inventory engine ← Purchasing | Goods receipts post "purchase receipt" movements at the order unit cost; this is the main source of average cost. No supplier liability is created here. |
| Inventory engine ← Transfers | Dispatch posts "transfer out" at source average (negative always denied); receipt posts "transfer in" at the dispatch cost; shortfall is not posted. In-transit stock belongs to no branch and is invisible to inventory screens. |
| Inventory engine ← Restaurant | Recipes/modifiers define consumption; waste posts an "adjustment" movement with its own reason and source, bypassing the adjustment document. |
| Inventory engine ↔ Online store | Checkout reserves stock; the engine honours reservations for sales and transfers; payment consumes, failure/expiry releases. |
| Inventory → Reports | Current valuation formula, movement values by type, adjustments by reason, product quantities; sale-line costs → gross profit (shown only when every sale and restock in the period has a cost). |
| Inventory → Cash custody | None: write-offs, waste, "received (other)" increases create no cash or liability entries. |
| Catalog/Inventory ← Organization & RBAC | Permission keys, default role templates, branch assignments, merchant-wide-only rights (catalog manage, prices, settings). |
| Catalog ← Platform | Plan product capacity checked on create and restore. |
| Catalog ← Branches | Branch deactivation does not check stock; balances at inactive branches remain in valuation and cannot be adjusted. |
| Everything ← Audit log | Append-only audit entries for all catalog changes, every adjustment, threshold and setting change. |

### B.4 Findings

#### FND-201 Stock adjustments have no approval, value limit or segregation of duties
- **Classification:** Control gap
- **Severity:** High
- **Evidence:** [Verified] Any holder of "adjust stock" at a branch — the default Branch Manager
  role included — can post opening stock, increases, decreases (reasons such as theft, lost,
  internal use) and counts of any quantity and value in one step; the only friction is a
  confirmation dialog. There is no second approver, no threshold above which approval is required,
  no separation between the person who counts and the person who posts, and no periodic sign-off.
  By contrast purchasing has approval and creator ≠ approver (BR-101), and refunds have approval
  rules (ADR-0059). Compensating controls: documents and ledger rows are immutable, every posting
  is audited with balances, and the inventory report lists adjustments by reason (quantities only).
- **Potential financial impact:** Concealment of theft or of unrecorded sales by a single branch
  manager through "found"/"lost"/"count" postings; misstatement of stock value without a value
  figure on the report that would make it visible.
- **Affected procedures:** BP-209, BP-210, BP-211, BP-212
- **Recommendation:** Introduce a pending state for adjustments above a configurable quantity/value
  or for sensitive reasons (theft, lost, correction, other), approved by a different user holding a
  new "approve adjustments" right (Owner/Company Manager by default); show the value (quantity ×
  average) of each adjustment on the list and report; add a monthly adjustment summary by user.

#### FND-202 Stock counts are not blind, overwrite intervening movements and have no variance sign-off
- **Classification:** Missing process
- **Severity:** Medium
- **Evidence:** [Verified] The count editor shows the current book quantity and the resulting
  balance before posting; the delta is computed at posting time against the balance then (sales
  made between the physical count and the posting are silently absorbed into the count delta);
  only listed items are affected (no full-count mode); there is no count session, no freeze, no
  "counted at" timestamp distinct from the posting time and no variance report per count. The
  test suite confirms "set to counted" semantics under the row lock.
- **Potential financial impact:** Count differences are easy to make disappear; a count posted
  late overstates stock by the quantity sold in between; shrinkage cannot be measured per count.
- **Affected procedures:** BP-212
- **Recommendation:** Add a count-sheet workflow: freeze a list of items at a "counted at" time,
  blind entry (book quantity hidden until submission, optional second count on variances), compute
  the delta against the balance at the counted-at time plus movements since, require review above
  a tolerance, and produce a variance report (quantity and value) per count.

#### FND-203 Average unit cost is limited to whole fils, distorting costs of low-value units
- **Classification:** Financial risk
- **Severity:** Medium
- **Evidence:** [Verified] The moving average is stored and rounded per unit to the fils
  (0.001 KWD). Quantities carry 3 decimals, so ingredients kept in grams, millilitres or pieces
  costing fractions of a fils (e.g. 2.500 KWD per kg = 0.0025 KWD per g) are averaged at 2 or 3 fils
  — a 20 % error — and this error is carried into every recipe cost, cost of sales and valuation.
  The movement value is computed exactly (quantity × unit cost / 1000, half-up) but from the
  already-rounded unit cost.
- **Potential financial impact:** Systematic misstatement of ingredient valuation and gross profit
  for restaurant merchants and for any goods sold by weight.
- **Affected procedures:** BP-216, BP-218, BP-214, BP-219
- **Recommendation:** Store the average cost with more precision (e.g. per 1,000 units, or six
  decimals) and round only when presenting a unit cost or computing a movement value; or let
  merchants define the stock unit so that unit costs stay above the fils.

#### FND-204 Negative balances are valued at zero and their cost basis is discarded on replenishment
- **Classification:** Financial risk (consequence of an owner-permitted policy)
- **Severity:** Medium
- **Evidence:** [Verified] When negative stock is allowed (BP-208), a negative balance contributes
  zero to valuation, and the next incoming movement replaces the average with the incoming cost
  instead of absorbing the negative quantity at its previous cost. Example: balance −5 at average
  1.000 (sales recorded cost of sales 5.000 at that cost), receipt of 10 at 2.000 → balance 5 at
  2.000 = value 10.000; cash paid 20.000 less cost of sales 5.000 = 15.000 expected. 5.000 KWD of
  cost disappears with no variance record.
- **Potential financial impact:** Understatement of stock value and overstatement/understatement of
  gross profit whenever negative stock is used, proportional to the negative quantities.
- **Affected procedures:** BP-208, BP-211, BP-216
- **Recommendation:** Either apply the incoming cost retroactively to the negative units and record
  a cost-variance movement, or keep the previous average when the balance is negative and only
  replace it at zero; at minimum, show a warning and a report of items that went negative in the
  period and the value gap created.

#### FND-205 Valuation can drift from the sum of movement values because the average is rounded
- **Classification:** Financial risk
- **Severity:** Low
- **Evidence:** [Verified] Each receipt rounds the new average to the fils; the balance value
  (quantity × rounded average) therefore differs from the cumulative signed movement values by up
  to half a fils per unit per receipt; no variance is recorded and no process re-aligns the two.
  The quantity ledger, in contrast, is proven exact by tests.
- **Potential financial impact:** Small per item, but cumulative over large volumes and
  unexplained to an auditor reconciling the valuation to the movement ledger.
- **Affected procedures:** BP-216, BP-214, BP-219
- **Recommendation:** Resolve together with FND-203 by carrying the average at higher precision;
  publish the period's rounding difference as a separate line of the inventory report.

#### FND-206 Stock held by archived variants/products or at inactive branches is frozen
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** [Verified] A product can be archived, a variant removed (archived), and a branch
  deactivated while stock remains. Archived items stay in the stock list and valuation while on
  hand ≠ 0 but every adjustment is refused ("archived"); an inactive branch refuses adjustments
  ("branch inactive") and the per-branch view keeps showing its stock. The product editor shows
  only active variants, so an archived variant cannot be revived from the screen (the API accepts
  its id). No warning is given at archive or deactivation time.
- **Potential financial impact:** Stock value that cannot be written off or moved stays in the
  valuation indefinitely; practical workaround requires reactivation, which may breach plan limits
  or re-expose the item for sale.
- **Affected procedures:** BP-203, BP-205, BP-209…BP-212
- **Recommendation:** Block or warn on archive/removal/deactivation when any balance ≠ 0 (offer a
  write-off or transfer first); allow decreases/counts on archived items (write-off only) and at
  inactive branches for clearance; list archived variants in the editor with a restore action.

#### FND-207 Switching off stock tracking (or changing goods to service) hides existing balances from valuation without a movement
- **Classification:** Financial risk
- **Severity:** High
- **Evidence:** [Verified] Stock lists, summary, the per-item view and the inventory report all
  filter on the product's current tracking flag; the balance rows and ledger remain. Editing a
  stocked product to "not tracked" (or to type service, which forces not tracked) is allowed to any
  catalog editor without the price right, with no stock check and no detail in the audit entry
  (only the previous name and status are recorded). Switching it back makes the value reappear.
- **Potential financial impact:** Stock value can be removed from and returned to the books
  silently; sales of the item meanwhile use the catalog cost instead of the average.
- **Affected procedures:** BP-203, BP-214, BP-219
- **Recommendation:** Refuse turning tracking off while any balance ≠ 0 (require a write-off
  first), or keep showing non-zero balances regardless of the flag; record the before/after of the
  tracking flag, type, category and availability in the audit entry.

#### FND-208 Catalog audit entries do not record most attribute changes
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** [Verified] Product update audit details contain the previous status and name and
  the per-variant price/cost changes; changes to category, type, tracking flag, availability,
  descriptions, SKUs and barcodes are not detailed. Category updates record no before/after.
- **Potential financial impact:** Limited; traceability of who moved an item between branches'
  availability or changed its SKU/barcode is lost.
- **Affected procedures:** BP-201, BP-203, BP-204
- **Recommendation:** Record a field-level diff for product and category updates.

#### FND-209 The "sale void" movement type exists in the schema and the screen filter but is never produced
- **Classification:** Inconsistency (doc vs behaviour)
- **Severity:** Low
- **Evidence:** [Verified] The ledger's allowed types and the movement filter include "sale void";
  the schema comment documents it. Voids are posted as "refund" movements with reason "void".
- **Potential financial impact:** None; risk of confusion when reconciling movement types to
  refund kinds.
- **Affected procedures:** BP-215, BP-219
- **Recommendation:** Either post voids as "sale void" or remove the type from the filter and
  documentation.

#### FND-210 Restaurant waste bypasses the adjustment document, reason catalogue and adjustments report
- **Classification:** Inconsistency (behaviour vs behaviour)
- **Severity:** Medium
- **Evidence:** [Verified] Waste write-offs post an "adjustment" movement with reason
  "restaurant_waste" and the order item as source. BR-063 lists the permitted reasons; this one is
  not among them, has no UI label (shown as a raw key), creates no adjustment document, is not
  linkable from the movement screen and is excluded from the adjustments-by-reason report (which
  reads adjustment documents only). The authorisation is the restaurant "void item" right, not
  "adjust stock".
- **Potential financial impact:** Waste — a classic leakage channel in food businesses — is not
  visible where management looks for write-offs; the "adjust stock" authority is circumvented by
  design.
- **Affected procedures:** BP-215, BP-218, BP-219
- **Recommendation:** Create a system adjustment document (kind decrease, reason "waste") for each
  waste event, add the reason to the catalogue with a label, and include it in the report; add a
  waste-by-item/by-user report.

#### FND-211 Transfer shortfalls leave the ledger without a write-off movement (shared with the Transfers chapter)
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** [Verified] Dispatch removes the dispatched quantity from the source; receipt adds
  only the received quantity to the destination; the missing quantity is "written off" only in the
  sense that it is nowhere — no movement, no reason, no value row. The discrepancy note lives on the
  transfer document.
- **Potential financial impact:** Σ transfer out ≠ Σ transfer in on the inventory report with no
  explaining line; losses in transit are not part of the write-off analysis.
- **Affected procedures:** BP-216, BP-219
- **Recommendation:** On short receipt, post an explicit loss movement (type adjustment, reason
  "transit loss", source = transfer) at the dispatch cost at the destination (or source), so
  quantity and value reconcile and losses are reportable.

#### FND-212 "Customer return (outside POS)" lets stock re-enter outside the refund controls
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** [Verified] An increase with this reason needs only "adjust stock"; it is not linked
  to any sale or refund, needs no receipt, no approval, and is valued at the current average or the
  entered cost. The Returns domain, by contrast, requires the original receipt, same branch,
  windows, limits and approval.
- **Potential financial impact:** Stock can be inflated to cover shortages, or returned goods can
  be accepted without any refund record (customer paid back in cash outside the system).
- **Affected procedures:** BP-210
- **Recommendation:** Require a note and a reference (receipt number or customer) for this reason,
  route it through approval (FND-201), and report it separately.

#### FND-213 No point-in-time valuation, roll-forward or reserved-quantity visibility
- **Classification:** Missing process
- **Severity:** Medium
- **Evidence:** [Verified] Valuation is "now" only; the inventory report's movement values sum
  only movements with a known cost; there is no opening/closing reconciliation by item or branch;
  reserved online quantities are not shown anywhere in the manager inventory screens or report.
- **Potential financial impact:** Month-end stock cannot be produced retrospectively; auditors
  cannot roll forward; management cannot see committed stock.
- **Affected procedures:** BP-214, BP-217, BP-219
- **Recommendation:** Add an "as at" valuation (reconstructed from balance-after and average-after
  on the ledger) and a roll-forward report (opening value, +receipts, +returns, +transfers in,
  −sales, −write-offs, −transfers out, ± count differences, ± rounding, = closing value), plus a
  "reserved" column and total in stock views.

#### FND-214 Balance-equals-ledger integrity relies on code discipline only
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** [Verified] The balance row may be updated by the application role (it must be);
  no database trigger or constraint ties it to the ledger, and no scheduled job re-derives and
  compares balances in production. The invariant is asserted only in the automated tests, and the
  only code path that updates balances is the engine (ADR-0042) [Verified by search: no other
  writer].
- **Potential financial impact:** A future defect or manual database intervention could leave a
  balance unsupported by movements and go unnoticed.
- **Affected procedures:** BP-216, BP-219
- **Recommendation:** Add a nightly integrity check (per merchant: balance vs sum of movements, and
  average vs recomputed average) with alerts, or a database trigger that recomputes the balance
  from the inserted movement.

#### FND-216 Items can be stocked with no cost at all; the gap is reported only as "unvalued"
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** [Verified] A tracked product may be created without a standard cost; opening stock
  may be posted without a cost by users lacking the price right; the item then carries no average,
  its outgoing movements have no value, and gross profit for any period containing its sales is
  "not available" (ADR-0070). The summary shows an "unvalued" count.
- **Potential financial impact:** Periods without gross profit; valuation understated.
- **Affected procedures:** BP-202, BP-209, BP-216
- **Recommendation:** Warn at product creation and at opening stock when no cost is known; list
  unvalued items on the inventory report with an action to set a cost (posting a cost-only
  revaluation movement rather than editing the catalog cost).

#### FND-218 Increases by users without the price right are valued at a cost that may not be actual
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** [Verified] A Branch Manager cannot enter a unit cost; a "received (other)" increase
  is valued at the current average or catalog cost even if the goods were bought at a different
  price. The design is documented (ADR-0040) but its costing side-effect is not.
- **Potential financial impact:** Average cost drifts from actual for goods received outside
  purchase orders.
- **Affected procedures:** BP-210
- **Recommendation:** Discourage "received (other)" (prefer a purchase order) or allow cost entry
  with the approval of FND-201; flag in the report increases posted without an explicit cost.

#### FND-220 Adjustment documents have no human-readable document number
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** [Verified] Goods receipts and transfers carry sequential numbers; adjustments are
  identified only by an internal id; the adjustment list has no number column and the detail page
  no printable reference.
- **Potential financial impact:** None directly; weak traceability for count sheets, insurance
  claims and external audit sampling.
- **Affected procedures:** BP-209…BP-212, BP-215
- **Recommendation:** Issue a per-merchant sequential number (e.g. ADJ-000123) to every adjustment
  and show it on list, detail and movement rows.

#### FND-222 Price and cost history exists only in the audit log
- **Classification:** Missing process
- **Severity:** Low
- **Evidence:** [Verified] Price/cost changes are audited old → new, but there is no price-history
  view on the product, no effective-dating or scheduled price changes, and reading the audit log
  needs the merchant-wide "view audit log" right.
- **Potential financial impact:** Investigating margin changes or disputed prices requires audit
  log access and manual search.
- **Affected procedures:** BP-203
- **Recommendation:** Expose a per-variant price/cost history tab derived from the audit entries;
  consider effective-dated price lists.

#### FND-223 Two cost concepts (catalog standard cost vs moving average) are not explained to users
- **Classification:** Inconsistency (doc vs behaviour)
- **Severity:** Low
- **Evidence:** [Verified] The product editor's "Cost" is a static fallback used only when an item
  has no average (and for untracked items' cost of sales); it is never updated by receipts. The
  inventory screen's "Average cost" is the moving average. A Branch Manager sees the latter but not
  the former. Neither screen explains the relationship; the adjustment editor's hint ("defaults to
  the current average or product cost") is the only mention.
- **Potential financial impact:** Users may "correct" the catalog cost expecting valuation to
  change, or report margins from the wrong figure.
- **Affected procedures:** BP-202, BP-203, BP-214
- **Recommendation:** Label the catalog field "Standard cost (fallback)", show the current average
  per branch beside it, and document the rule in the business rules.

### B.5 Documented owner decisions touching this domain

| Id | Decision (one line) | Residual risk (one line) |
|---|---|---|
| BR-049 / ADR-0008 | Products are archived, never deleted; prices have at most 3 decimals. | Archived items with stock are frozen (FND-206). |
| BR-050 / ADR-0041 | Sales snapshot name, SKU and price; the POS snapshot is never trusted for money. | None in this domain. |
| BR-051 | Products sell everywhere unless restricted to branches. | Availability does not govern where stock may be held. |
| BR-052 | Services never track inventory (also a database rule). | Converting stocked goods to a service hides their balances (FND-207). |
| BR-060 / ADR-0042 | Stock per branch and variant; one append-only ledger plus a locked balance row; one posting engine. | Balance-ledger equality is not independently checked in production (FND-214). |
| BR-061 / ADR-0043 / OQ-014 | Moving weighted-average costing (engineering default; FIFO still an open question for accounting). | Fils-level average precision (FND-203); negative-balance cost loss (FND-204); rounding drift (FND-205). |
| BR-062 / ADR-0044 | No overselling by default; the owner may allow negative stock; transfers always deny. | When allowed, valuation and cost basis are distorted (FND-204). |
| BR-063 | Every adjustment has a kind and a reason from a fixed list; "other" needs a note; opening only without history. | Waste uses an undocumented reason outside the document (FND-210). |
| BR-064 | Stock history is permanent; corrections are new adjustments. | No approval step accompanies the irreversibility (FND-201). |
| BR-065 | Low-stock threshold per item and branch; status rules. | None. |
| BR-066 / ADR-0040 | Costs and values visible only with price-management or inventory-report rights; cashiers see quantities only. | Branch managers see average cost but not standard cost (FND-223). |
| ADR-0039 | SKU unique per merchant including archived variants; barcodes freed on archive. | None. |
| ADR-0045 | Quantities are exact decimals with 3 places; inputs with more are rejected. | None. |
| BR-102 / ADR-0063 | Receipts add stock at the order unit cost and update the average. | None here (purchasing chapter). |
| BR-103 / BR-104 / ADR-0064 | Transfers leave at dispatch at the source average and arrive at the same cost; shortfalls are written off with a note. | Shortfall has no ledger movement (FND-211). |
| BR-128 / ADR-0070 | Inventory value = quantity × average per item and branch; unvalued items counted not valued; gross profit only when every cost is known. | Items without cost silence gross profit (FND-216). |
| BR-135 / BR-136 / ADR-0074 | Ingredients deducted at sale; recipes only on untracked items; waste deducts ingredients. | Waste bypasses the adjustment controls (FND-210). |
| BR-144 / BR-145 / ADR-0079 | Online orders reserve stock; the engine honours reservations for sales and transfers. | Manual decreases and counts ignore reservations; reservations invisible to managers (FND-213). |
| ADR-0084 | Fixed lock order and automatic retry on deadlock. | None. |

### B.6 Technical mapping (appendix)

| BP id | Permission keys | Main tables | Screens / routes | Document number prefix |
|---|---|---|---|---|
| BP-201 | `catalog.read`; `catalog.manage` | `categories`, `audit_log` | `/manager/categories`; `GET/POST /manager/categories`, `PATCH /manager/categories/:id`, `POST …/:id/status` | — |
| BP-202 | `catalog.manage` + `catalog.prices.manage` | `products`, `product_variants`, `product_barcodes`, `product_branch_availability`, `subscriptions` (capacity), `audit_log` | `/manager/products/new`; `POST /manager/products` | — |
| BP-203 | `catalog.manage` (+ `catalog.prices.manage` for price/cost/new variant) | `products`, `product_variants`, `product_barcodes`, `audit_log` | `/manager/products/:productId`; `PATCH /manager/products/:id` | — |
| BP-204 | `catalog.manage` | `product_branch_availability` | product editor "Branch availability"; same endpoints | — |
| BP-205 | `catalog.manage` | `products`, `audit_log` | editor Archive/Restore; `POST /manager/products/:id/status` | — |
| BP-206 | `catalog.manage` (write), `catalog.read` (read) | `product_images`, file storage (`FileStorage`) | editor Images; `POST/DELETE /manager/products/:id/images[/:imageId]`, `GET …/images/:imageId` | — |
| BP-207 | `catalog.read` (POS interface, bound branch) | `products`, `product_variants`, `product_barcodes`, `categories`, `stock_levels` | `/pos` sale screen; `GET /pos/catalog` (ETag), `GET /pos/catalog/images/:productId/:imageId`, `GET /pos/inventory/availability` | — |
| BP-208 | `inventory.read` (view), `merchant.settings.update` (change) | `inventory_settings`, `audit_log` | `/manager/inventory` settings dialog; `GET/PUT /manager/inventory/settings` | — |
| BP-209 | `inventory.adjust` (+ `catalog.prices.manage` for unit cost) | `stock_adjustments` (kind `opening`), `stock_adjustment_lines`, `stock_movements` (type `opening`), `stock_levels`, `audit_log` (`inventory.adjusted`) | `/manager/inventory/adjustments/new`, `/manager/inventory/adjustments/:id`; `POST /manager/inventory/adjustments` | none (UUID only) |
| BP-210 | `inventory.adjust` (+ `catalog.prices.manage`) | as BP-209, kind `increase`, movement type `adjustment` | same | none |
| BP-211 | `inventory.adjust` | as BP-209, kind `decrease`, movement type `adjustment` | same | none |
| BP-212 | `inventory.adjust` | as BP-209, kind `count`, movement type `count` | same | none |
| BP-213 | `inventory.adjust` | `stock_levels.low_stock_threshold`, `audit_log` (`inventory.threshold_set`) | `/manager/inventory` "Set alert" dialog; `PUT /manager/inventory/thresholds` | — |
| BP-214 | `inventory.read`; costs with `catalog.prices.manage` or `reports.inventory` | `stock_levels`, `product_variants`, `products`, `branches` | `/manager/inventory`; `GET /manager/inventory/levels`, `GET …/summary`, `GET …/variants/:variantId` | — |
| BP-215 | `inventory.read` (+ cost rule) | `stock_movements`, `stock_adjustments`, `stock_adjustment_lines`, `users` | `/manager/inventory/movements`, `/manager/inventory/adjustments[/:id]`; `GET /manager/inventory/movements`, `GET …/adjustments[/:id]` | — |
| BP-216 | caller's own permission | `stock_levels`, `stock_movements`, `inventory_settings`, `stock_reservations` (read), `product_variants`/`products` (read) | `StockLedgerService.apply` (used by `InventoryService`, `SalesService`, `RefundsService`, `PurchasingService`, `TransfersService`, `RestaurantOrdersService`) | source documents: GR (receipts), transfer numbers, receipt numbers, refund numbers |
| BP-217 | public store checkout; system jobs | `stock_reservations`, `stock_levels`, `online_orders` | `StockLedgerService.reserve`, `OnlinePaymentsService` (consume/release) | online order numbers |
| BP-218 | `restaurant.manage` (recipes), checkout rights | `recipe_components`, `modifiers`, `stock_movements` (reason `restaurant_waste`, source `restaurant_item`) | `stockConsumption` / `consumptionCosts` in `inventory/consumption.ts` | — |
| BP-219 | `reports.inventory` | `stock_levels`, `stock_movements`, `stock_adjustments`, `sale_lines`, `refund_lines` | `/manager/reports` inventory tab; `GET /manager/reports/inventory` | — |

Database immutability rules relevant to this domain [Verified in migrations]: the application role
may not delete `products` or `product_variants`; may not update or delete `stock_movements`,
`stock_adjustments`, `stock_adjustment_lines`; may not delete `stock_levels` or `stock_reservations`;
may not update or delete `audit_log`. All catalog and inventory tables have forced row-level security
on `merchant_id`. Movement types permitted by the database: opening, adjustment, count, sale,
sale_void (unused), refund, transfer_out, transfer_in, purchase_receipt.

---

## Chapter C: Selling at the point of sale, and customers

### C.0 Scope and sources reviewed

- **Business purpose.** This domain covers the moment money is earned: a cashier assembles a cart at a
  till, applies the discounts and price changes they are entitled to, optionally names a registered
  customer, takes one or several payments and the system turns the cart into an immutable sale with a
  receipt number, deducts the goods from the branch stock, settles the cash into the register drawer and
  non-cash money into the linked bank balance, and writes an audit entry. It also covers the merchant's
  selling policy (maximum discount without supervision, and the refund window and refund approval limit
  that the returns domain consumes), held ("suspended") sales, the cashier's view of recent sales and
  receipts, the manager's sales history and sale detail, and the customer file (profiles, customer
  numbers, phone uniqueness, notes, purchase and refund history, spending summary, activation, and the
  till-side customer picker with walk-in sales as the default).
- **Files and screens reviewed (technical names allowed here).** API: `apps/api/src/modules/sales/`
  (`sales.service.ts`, `sales.controller.ts`, `sales.schema.ts`, `sales.int.test.ts`),
  `apps/api/src/modules/customers/` (service, controller, schema, `customers.int.test.ts`), the shared
  pricing and fee helpers in `packages/money/src/{pricing,fees,money}.ts`, the contracts in
  `packages/contracts/src/{sales,customers}.ts`, the permission catalog and default role templates in
  `packages/permissions/src/{catalog,templates}.ts`, migrations `0013_sales.sql`, `0014_sales_rls.sql`,
  `0015_refunds.sql` (payment verification states), `0020_customers.sql`, `0021_customers_rls.sql`,
  `0023_restaurant.sql`, `0025_ecommerce.sql`, the shift lock in `registers/shifts.service.ts`, the
  stock policy in `inventory/stock-ledger.service.ts`, the callers of the checkout engine in
  `refunds/refunds.service.ts` (exchange, void) and `restaurant/restaurant-orders.service.ts` (bill
  payment), and `ecommerce.service.ts` (customer by phone). Screens: `apps/pos-web/src/sale/`
  (`SalePage.tsx`, `cart.tsx`, `dialogs.tsx`, `customer.tsx`), `apps/manager-web/src/features/sales/
  SalesPage.tsx` (list, detail, selling-policy dialog), `apps/manager-web/src/features/customers/
  CustomersPage.tsx`. Documents: `docs/BUSINESS_RULES.md` (BR-026, BR-050, BR-080…086, BR-110…114,
  OQ-002/003/007/009/013/019/024), `docs/DECISIONS.md` (ADR-0008, 0016, 0046, 0048, 0051…0055, 0065…0067,
  0069, 0083, 0084), `docs/AUTH.md`, `docs/DATABASE.md`, `docs/PROGRESS.md`, `docs/TESTING.md`; e2e
  specs `e2e/checkout.spec.ts`, `e2e/customers.spec.ts` (skimmed for the user journey only).
- **Coverage statement.** Returns, refunds, voids and exchanges are reviewed only where they re-enter
  this domain (the exchange sale and the void window); their own rules belong to the returns domain.
  Restaurant bills and online-store sales are described only as callers of the checkout engine. The
  shift opening/closing and the cash ledger postings are described from the sale's side; drawer
  reconciliation belongs to the cash custody domain. I did not execute the application or the tests; all
  "[Verified]" statements rest on reading the code, the schema and the integration tests. The e2e
  specs were skimmed, not analysed line by line.

### C.1 Roles and authority matrix

Default roles: **Owner** (implicitly everything, all branches), **Company Manager (CM)**, **Branch
Manager (BM)**, **Supervisor (SV)**, **Cashier (CA)**, **Kitchen (KI)**. Platform operators hold no
merchant permission and see no sales lines or customers (BR-157) [Verified]. Every permission in this
domain is **branch-scoped**: the user must hold it at the branch concerned, i.e. at the POS session's
branch for till operations, and at the sale's branch for management reads. A merchant-wide role
assignment grants a branch permission at every branch [Verified].

| Operation | Permission (plain words) | Owner | CM | BM | SV | CA | KI | Branch scoping |
|---|---|---|---|---|---|---|---|---|
| Sign in to the POS at a branch | use the POS at the branch | yes | no* | no* | yes | yes | yes | at the chosen branch |
| Build a cart, hold/resume/discard a held sale, complete a sale, see recent sales and receipts of own shift, read selling policy at the till | create sales at the POS (plus an open shift of one's own) | yes | no* | no* | yes | yes | no | POS branch |
| Apply an item or sale discount within the merchant limit | apply discounts within the limit | yes | no* | no* | yes | yes | no | POS branch |
| Apply a discount above the limit (incl. 100 %) | apply discounts above the limit | yes | no* | no* | yes | no | no | POS branch |
| Change the unit price of a line at the till | change the selling price of an item | yes | no* | no* | yes | no | no | POS branch |
| Cancel (void) a completed sale of one's own open shift | cancel an open or same-shift sale | yes | no* | no* | yes | no | no | POS branch (returns domain) |
| Attach a registered customer to a cart / held sale / bill; search customers at the till | search and view customers | yes | yes | yes | yes | yes | no | POS branch |
| Create a basic customer profile at the till (name, phone, e-mail) | create basic customer profiles | yes | yes | yes | yes | yes | no | POS branch |
| View the sales history list, a sale's detail and its receipt in management | view sales history | yes | yes | yes | yes** | no | no | list filtered to permitted branches; detail needs the permission at the sale's branch |
| See the cost of goods on a sale's detail | view sales history **and** (change prices and costs **or** financial reports) | yes | yes | no | no | no | no | financial reports at the sale's branch; price permission is merchant-wide |
| Read the selling policy in management | view company settings | yes | yes | no | no | no | no | merchant-wide |
| Change the selling policy (max discount, refund window, refund approval limit) | change company settings | yes | yes | no | no | no | no | merchant-wide |
| List and view customer profiles, purchase history, refunds, notes in management | search and view customers | yes | yes | yes | yes** | no | no | profile visible with the permission at any branch; history and totals limited to permitted branches |
| Create a full customer profile in management | create basic customer profiles | yes | yes | yes | yes** | no | no | permission at any branch |
| Edit a customer, activate/deactivate, add a note | edit customers, notes and status | yes | yes | yes | yes** | no | no | permission at any branch |

\* Company and Branch Managers do not hold "use the POS" by default (BR-014); the owner must grant it
and "create sales" explicitly, and they must then open their own shift on a register [Verified].
\** The Supervisor template holds "view sales history", "edit customers" and the customer permissions,
but not "use the management app"; those permissions are therefore unusable by a default supervisor
until a management-app grant is added (the POS exposes no screen for them) [Verified].

Observations on the matrix: there is no permission and no mechanism for a supervisor to **authorise a
step on another cashier's till** (see FND-301). The default Cashier role may both sell and create
customers; the default Supervisor may discount without limit, override prices and void — i.e. the
person who authorises exceptions is the same person who rings them up (see FND-301, FND-312).

### C.2 Procedures

#### BP-301 Configure the selling policy
- **Business purpose:** Set the merchant-wide limits that govern cashiers: the largest discount (per
  item and per sale, in %) allowed without the "above the limit" permission; the refund window in days
  and the refund approval limit in KWD consumed by the returns domain.
- **Actors and required authority:** Owner or Company Manager with "change company settings"
  (merchant-wide); reading needs "view company settings" or, at the till, "create sales" [Verified].
- **Trigger / inputs:** The "Selling policy" button on the management Sales page. Inputs: maximum
  discount percent (0–100, up to two decimals), refund window days (0–3650), refund approval limit
  (amount with up to three decimals), and the version of the policy the screen loaded [Verified].
- **Normal flow:**
  1. The manager opens the policy dialog; the current values are shown (defaults when never saved:
     10 %, 30 days, 20.000 KWD) [Verified].
  2. The manager edits and saves. The system locks the policy row, checks that nobody saved a newer
     version in the meantime, writes the new values and increments the version [Verified].
  3. An audit entry "sales settings updated" records the old and new value of each of the three
     fields, the actor and the IP [Verified].
- **Exceptional cases and their handling:**
  - Stale screen (someone saved first): refused with a version conflict; the manager must reload
    [Verified].
  - Values outside the ranges are refused by validation [Verified].
  - The policy applies from the next checkout; sales already completed are not re-evaluated and do not
    record the limit that was in force when they were made [Verified] (FND-303).
- **Existing controls:**
  - CTL-301 Merchant-wide permission "change company settings"; default deny on the route [Verified].
  - CTL-302 Optimistic version check prevents lost updates [Verified].
  - CTL-303 Full before/after audit trail of policy changes [Verified].
- **Financial / stock / cash effect:** None directly; it changes who may give what discount and which
  refunds need approval.
- **Upstream dependencies:** Merchant exists; roles granted.
- **Downstream effects:** BP-303/BP-304 (discount limit), returns domain (window and approval limit).
- **Observations:** FND-303, FND-313.

#### BP-302 Build the cart at the till
- **Business purpose:** Assemble what the customer is buying before payment, with live pricing that is
  identical to the server's authoritative pricing.
- **Actors and required authority:** Any POS user with "create sales" at the session branch and an
  **open shift of their own** on a register of that branch. The cart screen itself is reachable
  without a shift, but holding or paying requires it [Verified].
- **Trigger / inputs:** Tapping product tiles, typing or scanning a barcode/SKU into the search box
  (scanners end with Enter), choosing a category filter; per-line quantity (−/+ or free entry up to 3
  decimals), per-line discount, per-line price override (dialog shows the fields only to holders of the
  respective permission), a sale-level discount, a customer (BP-306) [Verified].
- **Normal flow:**
  1. On opening the register screen, the POS downloads the sellable catalog of its branch (active
     products and variants, available at that branch) and the branch stock availability; tiles show
     price, on-hand quantity for tracked items and "low"/"out" badges. These are display aids only
     [Verified].
  2. Adding the same item again merges into the existing line unless that line carries a discount or a
     price override, in which case a new line is created [Verified].
  3. The cart totals (subtotal, discounts, total) are computed in the browser with the same pricing
     function the server uses (line gross = unit price × quantity rounded half-up to the fils; item
     discount; sale discount allocated across lines by largest remainder) [Verified].
  4. "Clear" needs a second tap within three seconds; the cart lives only in the browser's memory: it
     survives navigation to the shift screen but not a page reload or sign-out [Verified].
- **Exceptional cases and their handling:**
  - A line with an invalid quantity, price or discount shows "invalid" and disables Pay/Hold until
    corrected [Verified].
  - A scanned code with no match shows "not found"; a search that matches exactly one tile adds it on
    Enter [Verified].
  - Items shown as "out of stock" can still be added; the stock policy is enforced only at completion
    (BP-307) [Verified].
  - Catalog changes (price, archive) after the snapshot was downloaded are not reflected until the
    snapshot refreshes (every 60 s at most); the server re-prices at checkout and refuses the sale if
    the total differs (BP-307) [Verified].
  - Lines removed or carts cleared before payment leave **no record** anywhere [Verified] (FND-311).
- **Existing controls:**
  - CTL-304 Shared pricing function on client and server (display equals authoritative calculation)
    [Verified].
  - CTL-305 Discount and price-override fields are hidden without the permission (UI only; the server
    checks again) [Verified].
  - CTL-306 Two-step "Clear" against accidental loss of a sale [Verified].
- **Financial / stock / cash effect:** None. Nothing is written until hold (BP-309) or payment
  (BP-307).
- **Upstream dependencies:** Catalog with prices and branch availability; open shift (for hold/pay).
- **Downstream effects:** BP-303…BP-309.
- **Observations:** FND-311.

#### BP-303 Apply an item or sale discount within the limit
- **Business purpose:** Reduce the price of one line (percentage or fixed amount) or of the whole sale,
  within the merchant's limit, with exact fils arithmetic.
- **Actors and required authority:** "Apply discounts within the limit" at the POS branch [Verified].
- **Trigger / inputs:** Line dialog (discount type and value) or the sale-discount dialog. Percent:
  0–100 with up to two decimals; amount: up to three decimals, never more than the amount it applies to
  [Verified].
- **Normal flow:**
  1. The cashier enters the discount; the cart shows the reduced line net and the total.
  2. At checkout the server recomputes: line discount = percent of the line gross rounded half-up, or
     the fixed amount; the sale discount is computed on the sum of line amounts after line discounts and
     allocated to lines by the largest-remainder method so that the sum of line nets equals the total
     exactly (no fils lost or created) [Verified by test: 1.5 × 0.333 and 2 × 0.333 with 10 % sale
     discount → subtotal 1.166, discount 0.117, total 1.049, line nets sum 1.049].
  3. The server compares each line discount against the limit percent of that line's gross, and the
     sale discount against the limit percent of the post-line-discount base, using exact integer
     comparison (no rounding) [Verified].
  4. The sale stores, per line, the discount as entered (type and value), the computed line discount,
     the allocated sale discount and the net; the sale header stores total line discounts and the sale
     discount [Verified]. The audit entry of the sale records the total discount amount [Verified].
- **Exceptional cases and their handling:**
  - Any discount without the permission: refused (the server message says discounts are not allowed),
    even if the UI was manipulated [Verified].
  - Percent above 100, more than two decimals, negative amounts, amounts with more than three decimals,
    or an amount larger than the line/base: refused as invalid input [Verified by test].
  - Item discount and sale discount are each checked **separately** against the limit: 10 % on every
    line plus 10 % on the sale (≈ 19 % combined) passes for a cashier [Verified] — see OQ-024.
  - The limit applies identically to retail carts, restaurant bills and exchange sales because all go
    through the same engine [Verified].
- **Existing controls:**
  - CTL-307 Server-side permission check for any discount, and exact limit check per line and per sale
    [Verified].
  - CTL-308 Discounts are stored both as entered and as computed, line by line, on the immutable sale
    [Verified].
- **Financial / stock / cash effect:** Reduces the sale total and therefore cash/bank collected; gross
  sales, discounts and net sales in reports derive from these stored amounts.
- **Upstream dependencies:** BP-301 (limit), BP-302.
- **Downstream effects:** BP-307; Reports (gross, discounts, net); Returns (refund of net amounts).
- **Observations:** FND-303, FND-313.

#### BP-304 Apply a discount above the limit (supervisory discount, up to 100 %)
- **Business purpose:** Allow authorised staff to exceed the merchant limit for commercial reasons,
  including giving goods free of charge.
- **Actors and required authority:** "Apply discounts above the limit" at the POS branch (Supervisor by
  default), **on the holder's own open shift** — there is no way for a supervisor to approve a discount
  on a cashier's cart [Verified: a cashier's over-limit cart is refused; the test has the supervisor
  open a separate register and ring the sale themselves].
- **Trigger / inputs:** As BP-303, with a value above the limit.
- **Normal flow:**
  1. The holder enters the discount on their own till and completes the sale as in BP-307.
  2. The sale is recorded in the holder's name, on the holder's shift and register; the audit entry is
     the ordinary "sale completed" entry with the total discount amount [Verified].
  3. With a 100 % discount the total is zero; the sale is completed **without any payment line**, the
     stock is still deducted and a receipt number is still issued [Verified by test].
- **Exceptional cases and their handling:**
  - A cashier without the permission is refused with "discounts above N % need a manager" [Verified].
    In practice the cashier must either hold the cart and have the supervisor resume it on the
    supervisor's own shift (BP-309), or the supervisor re-rings the sale: the cash then enters the
    supervisor's drawer, not the cashier's [Verified from the design; see FND-301].
  - No reason or justification is captured for an above-limit discount; nothing marks the sale as
    "above limit" [Verified] (FND-303).
- **Existing controls:**
  - CTL-309 Separate permission for above-limit discounts; the default Cashier does not hold it
    [Verified].
  - CTL-310 The sale is attributed to the person who held the authority (shift, register, user) and
    audited with the discount total [Verified].
- **Financial / stock / cash effect:** As BP-303; at 100 % the goods leave stock at their average cost
  with zero revenue and no payment.
- **Upstream dependencies:** BP-301, BP-302.
- **Downstream effects:** Reports (discount totals, gross profit); Returns.
- **Observations:** FND-301, FND-303, FND-312.

#### BP-305 Override a selling price at the till
- **Business purpose:** Sell a line at a unit price other than the catalog price (negotiated price,
  damaged item, price-match).
- **Actors and required authority:** "Change the selling price of an item" at the POS branch
  (Supervisor by default) [Verified].
- **Trigger / inputs:** Line dialog, "price override" field (amount with up to three decimals; the hint
  shows the list price) [Verified].
- **Normal flow:**
  1. The holder enters the new unit price; pricing uses it in place of the catalog price (restaurant
     modifier prices are still added on top) [Verified].
  2. At completion the line stores both the list unit price and the applied unit price, with an
     "overridden" flag set when they differ; the audit entry lists each override as "from → to" per
     variant [Verified by test].
  3. The manager's sale detail shows the overridden badge and the struck-through list price
     [Verified].
- **Exceptional cases and their handling:**
  - Without the permission the whole checkout is refused ("not allowed to change prices") [Verified].
  - There is **no floor and no ceiling**: the price may be set to 0.000 or far above list; a price
    override is not measured against the discount limit, so a role holding "change the selling price"
    but not "discounts above the limit" can achieve any effective discount [Verified from the code
    paths; the limit check only looks at the discount fields] (FND-302).
  - An override equal to the list price is stored as not overridden [Verified].
  - No reason is captured [Verified].
- **Existing controls:**
  - CTL-311 Dedicated permission; both prices kept on the line; per-variant from/to in the audit
    [Verified].
- **Financial / stock / cash effect:** Changes the gross of the line and therefore revenue and
  collections; reports treat the applied price as the gross (an override is not a "discount" in the
  reports) [Verified from the stored fields; Inferred for the report semantics].
- **Upstream dependencies:** BP-302.
- **Downstream effects:** BP-307; Reports; Returns (refund at the applied net price).
- **Observations:** FND-302.

#### BP-306 Attach a customer to the sale (or sell walk-in)
- **Business purpose:** Link the sale to a registered customer so that purchase history, refunds and
  spending can be followed; the default is an anonymous walk-in sale.
- **Actors and required authority:** Choosing a customer needs "search and view customers" at the POS
  branch; creating a basic profile at the till needs "create basic customer profiles" at the POS
  branch. Without the view permission the customer bar is not shown and a customer id sent anyway is
  refused [Verified by test].
- **Trigger / inputs:** Customer bar above the cart ("Choose", F4). Search by name, customer number or
  at least three digits of the phone; results limited to 20 **active** customers showing name and phone
  or number. "New" opens a two-field form (name required, phone optional; the search text is pre-filled
  as phone if it contains digits, else as name) [Verified].
- **Normal flow:**
  1. The cashier picks a customer; the cart carries it; the receipt will print the customer's name
     [Verified].
  2. At completion the server re-checks the permission, that the customer exists in this merchant and
     is active, and fixes the customer on the order and the sale [Verified].
  3. A profile created at the till receives the next customer number (C-000001…), the phone is
     normalised (spaces/dashes removed, "00" → "+", a bare 8-digit number is treated as Kuwaiti +965),
     the creating branch and user are recorded, and an audit entry "customer created" with the code
     only (no personal data) is written [Verified].
- **Exceptional cases and their handling:**
  - Inactive customer: the till search hides them and a checkout naming them is refused ("customer
    record is inactive") [Verified by test].
  - Customer of another merchant: not found [Verified by test].
  - Duplicate phone (same number written differently): refused with "another customer already has this
    phone number" [Verified by test].
  - Exchanges keep the original sale's customer **without** re-checking the permission or the active
    status (owner rule BR-110) [Verified].
  - Once the sale is completed the customer can never be added, removed or changed (sales are
    immutable); the only correction is a void within the same shift and a new sale [Verified; stated
    in PROGRESS].
  - Nothing prevents a cashier from selecting a profile that is their own or a colleague's; staff and
    customers are unrelated records [Verified] (FND-307).
  - The online store finds or creates the customer by phone **without** checking the active status
    (an inactive customer is reused and linked to the online sale) [Verified] (FND-314).
- **Existing controls:**
  - CTL-312 Server-side permission and active-status checks at completion, not only in the picker
    [Verified].
  - CTL-313 Till API returns only id, number, name, phone and status (no e-mail, address, notes or
    spending) [Verified by test].
  - CTL-314 Phone uniqueness per merchant on the normalised number [Verified].
- **Financial / stock / cash effect:** None; it only attributes the sale.
- **Upstream dependencies:** BP-314 (profiles) or till creation.
- **Downstream effects:** BP-315 (history and spending); Returns (exchange keeps the customer);
  receipts.
- **Observations:** FND-307, FND-314, FND-316.

#### BP-307 Take payment and complete the sale (the checkout)
- **Business purpose:** Convert the cart into a final financial document, collect the money and update
  stock and cash places in one indivisible step.
- **Actors and required authority:** "Create sales" at the POS branch and the actor's own open shift at
  that branch [Verified].
- **Trigger / inputs:** "Pay" (F12). The payment dialog lists the active methods available at the POS;
  for each planned payment: method, amount applied (pre-filled with the remaining balance, must be
  > 0 and ≤ remaining), for cash an optional tendered amount (≥ amount; quick buttons 5/10/20), for
  non-cash an optional reference of up to 80 characters. Up to 10 payments; "Complete" is enabled only
  when the remaining balance is exactly zero. The request carries a client-generated idempotency key
  (one per payment attempt), the full cart, the customer, the held-order id if resumed, and the total
  the cashier saw [Verified].
- **Normal flow (what the system does, in order, inside one database transaction):**
  1. Locks the cashier's own open shift at the session branch (one checkout at a time per shift; a
     closed or absent shift stops here) [Verified].
  2. Resolves the customer (BP-306).
  3. Re-reads authoritative prices, names, SKUs and costs of every variant from the catalog, restricted
     to active items sold at this branch; any item not sellable here refuses the whole sale
     [Verified].
  4. Re-prices the cart (BP-303) and checks discount permissions and the limit (BP-303/304) and the
     price-override permission (BP-305).
  5. Compares the server total with the total the cashier saw; a difference refuses the sale ("prices
     changed, review the cart") — a price change between display and payment is never silently
     charged [Verified by test].
  6. Validates payments: each method must exist, be active and be available at the POS; methods bound
     to a payment gateway are refused (no gateway is integrated); each amount must be positive; only
     cash may carry a tendered amount (change = tendered − amount, never negative); the sum of amounts
     must equal the total **exactly**; an empty payment list is accepted only for a zero total
     [Verified by test]. The processing fee of each payment is computed from the method's rule (fixed
     and/or percentage, half-up to the fils, never more than the payment) [Verified: 1.75 % of 22.667 =
     0.397].
  7. Writes the order (a new one in "completed" state, or the resumed held order moved to "completed",
     see BP-309) with the idempotency key and a hash of the request [Verified].
  8. Draws the next receipt number for the branch: branch code + six digits, gap-free, from a counter
     incremented under a row lock inside the same transaction (a failed sale rolls its number back)
     [Verified by tests: MAIN-000001, MAIN-000002; no counter row after a refused sale].
  9. Deducts stock through the inventory ledger: one movement per consumed item (the item itself, or
     recipe ingredients and modifier ingredients for restaurant items), all-or-nothing, at the current
     weighted-average cost, honouring active online reservations; the no-overselling policy refuses the
     sale when any line would go below zero unless the merchant allows negative stock [Verified by
     tests, including two registers racing for the last unit: exactly one wins].
  10. Writes the immutable sale header (merchant, branch, register, shift, employee, receipt number,
      customer, subtotal, line discounts, sale discount, total, paid = total, change, fees, cost of
      goods or null when any cost was unknown), the sale lines (snapshot of names, SKU, list and applied
      unit price, override flag, quantity, gross, discounts, net, tracked flag, unit cost), any modifier
      snapshots, and one payment row per tender (method snapshot, amount, tendered, change, fee, status
      "succeeded", verification "manual", reference, settlement account) [Verified].
  11. Posts the money: a cash payment is posted (amount applied, i.e. net of change) to the drawer
      balance of the shift's register, tagged with the shift; a non-cash payment is posted to the bank
      balance linked to its method, with a separate negative "fee" posting when a fee exists; the
      posting description is the receipt number [Verified by test: card 22.667 at 1.75 % → bank balance
      22.270; drawer 10.000 opening + 7.333 cash].
  12. Writes the audit entry "sale completed" (receipt number, total, customer, shift, register, price
      overrides from→to, total discounts, actor, IP) [Verified].
  13. Returns the sale; the POS clears the cart, refreshes stock availability, the shift summary and
      recent sales, and opens the receipt dialog (BP-310) [Verified].
- **Exceptional cases and their handling:**
  - No open shift, or the shift was closed (by the cashier or force-closed by a manager) between
    building the cart and paying: refused with "open a shift first"; nothing is written; the cart stays
    on screen only as long as the page is not reloaded [Verified from the lock; FND-311]. Because the
    shift row is locked for the whole checkout, a force-close and a checkout on the same shift are
    serialised: whichever commits first wins, the other sees the new state [Verified from the design;
    Inferred for the manager-side ordering].
  - Network retry or double tap with the same key and identical cart: the first sale is returned; five
    concurrent identical submissions produce one sale, one payment, one stock movement [Verified by
    test]. Same key with a different cart: refused as an idempotency conflict [Verified].
  - Insufficient stock: refused listing the short lines; no sale, no order, no payment, no receipt
    number consumed [Verified by test].
  - Payment problems (short total, over-payment by a non-cash method, tendered below the amount,
    tendered on a non-cash method, unknown or inactive method, gateway method): each refused with a
    specific message; nothing is written [Verified by test].
  - Item not sellable at this branch (archived, inactive, or restricted to other branches): refused
    [Verified by test].
  - Customer inactive or not found: refused (BP-306).
  - Zero-total sale: allowed with an empty payment list (BP-304).
  - A method without a linked settlement account: the payment is recorded but **no balance posting is
    made** (the money is in no cash place) [Verified from the posting rule] (FND-304). A fee configured
    on the cash method is stored on the payment and the sale but never posted anywhere [Verified]
    (FND-304).
  - Non-cash references are optional and unverified; "verification = manual" means the cashier's
    word [Verified] (FND-305).
  - Deadlock between concurrent sales/online payments: the whole transaction is retried up to three
    times automatically (ADR-0084) [Verified in the ADR; not re-read in code].
- **Existing controls:**
  - CTL-315 One transaction, all-or-nothing, under the cashier's shift lock [Verified].
  - CTL-316 Server re-pricing from the catalog; client prices are never trusted; "total changed"
    guard [Verified].
  - CTL-317 Payments must equal the total exactly; change only on cash; database check constraints
    enforce total = subtotal − discounts, paid = total, change ≥ 0, positive payment amounts, fee ≤
    amount, tendered = amount + change [Verified].
  - CTL-318 Idempotency key unique per merchant with request hash; concurrent duplicates resolved by
    the unique index [Verified].
  - CTL-319 Gap-free receipt numbers per branch under a row lock; unique per merchant [Verified].
  - CTL-320 Stock deducted only through the inventory ledger with row locks in a fixed order, no
    overselling by default, reservations honoured [Verified].
  - CTL-321 Sales, sale lines and payments cannot be updated or deleted by the application's database
    role; completed orders and their lines are frozen by triggers; tested by attempting direct updates
    [Verified by test].
  - CTL-322 Cash lands only in the register drawer of the shift; non-cash only in a bank-type account
    (cash method cannot be linked to an account; non-cash cannot be linked to a drawer or treasury)
    [Verified].
  - CTL-323 Audit entry with receipt number, totals, overrides, discounts, actor and IP; the audit log
    itself is append-only [Verified].
  - CTL-324 Snapshot of product data on the sale lines (BR-050) so later catalog changes never alter
    history [Verified].
  - CTL-325 The POS never receives fees or costs in any sale response [Verified by test].
- **Financial / stock / cash effect:** Net sales increase by the total; collections increase per
  tender; the register drawer increases by the cash amount applied (change is never in the drawer);
  the linked bank balance increases by the non-cash amount and decreases by its fee; stock of each
  tracked item decreases at its weighted-average cost, which is written on the line and summed on the
  sale as cost of goods; receipt counter advances by one. After commit the sale, lines and payments are
  immutable; the only later changes are compensating refunds/voids (returns domain).
- **Upstream dependencies:** Open shift on a register (cash custody); payment methods and their
  settlement accounts (payments setup); catalog and stock (inventory); selling policy (BP-301).
- **Downstream effects:** Shift expected cash (= opening count + cash in − cash out + cash sales − cash
  refunds); cash custody ledger; Reports (sales, payments, fees, gross profit, by channel/employee/
  product); Returns (refundable balances per line and per tender); Customers (BP-315); Platform
  (last-sale date only).
- **Observations:** FND-301, FND-304, FND-305, FND-306, FND-311, FND-312.

#### BP-308 Sales created by other engines (exchange, restaurant bill, online order)
- **Business purpose:** Keep one set of rules for every sale regardless of where it originates.
- **Actors and required authority:** Exchange: "process returns" **and** "create sales" at the POS
  branch, own open shift [Verified]. Restaurant bill: "create sales", own shift, module enabled
  [Verified]. Online sale: no user; created by the system when the gateway confirms payment
  [Verified].
- **Trigger / inputs:** See the respective domains.
- **Normal flow:**
  1. Exchange: the refund and the new sale are created in one transaction; the refund credit pays the
     new sale first as an internal "exchange credit" payment line (no cash place changes for the credit
     part), the remainder is paid normally; the new sale inherits the original customer; discount and
     price-override rules apply unchanged [Verified].
  2. Restaurant bill: the chosen unpaid items of a table/takeaway/pickup order become one sale at the
     price in force at payment time plus modifier prices; the sale carries the order reference and the
     service type; the bill may name a customer; the same discount limits apply (no line discounts, a
     sale discount is possible) [Verified].
  3. Online: the paid order becomes a sale of channel "online" with no order, register, shift or
     cashier; prices are those the shopper saw; the payment is "gateway-verified" with the provider
     reference; the fee is posted against the bank account; the audit actor is the system; the receipt
     number comes from the same branch counter; stock is deducted consuming the order's own
     reservation [Verified].
- **Exceptional cases and their handling:**
  - Online: a payment whose amount differs from the order total does not become a sale (order needs
    attention) [Verified].
  - Exchange sales that would need refund approval are refused at the till (returns domain)
    [Verified].
- **Existing controls:** CTL-315…CTL-325 apply to all three paths [Verified]; CTL-326 database check:
  a POS-channel sale must have order, register, shift, membership and user; an online sale must have
  an online order and no shift [Verified].
- **Financial / stock / cash effect:** As BP-307; the exchange credit is an internal tender that is
  excluded from "payments collected" in reports (BR-123).
- **Upstream dependencies / Downstream effects:** Returns, Restaurant, Online store, Reports.
- **Observations:** FND-314 (online customer status).

#### BP-309 Hold (suspend) a sale, resume it, discard it
- **Business purpose:** Park a cart (e.g. a customer fetching their wallet, a table) and complete it
  later, by any cashier of the branch.
- **Actors and required authority:** "Create sales" at the POS branch, own open shift (for holding and
  discarding; resuming is a read) [Verified].
- **Trigger / inputs:** "Hold" (F8) with an optional label of up to 60 characters; "Held sales" list
  with Resume / Discard [Verified].
- **Normal flow:**
  1. Hold: the server validates the lines and permissions as for a checkout (discount and override
     permissions are checked; the limit is **not** checked at this stage), verifies the items are
     sellable here and the customer is active, and stores an order in "suspended" state with its lines,
     discounts, overrides, customer, label, the holder's shift, register and user; audit "order
     suspended" (no details) [Verified].
  2. The held list of the branch shows label, customer, cashier name and time; any cashier at the
     branch sees all of them [Verified].
  3. Resume loads the lines into the cart; the cart remembers the held order id; completing it (BP-307)
     replaces the held lines with the cart as finally paid and marks the order "completed"; a second
     attempt on the same order is refused ("already completed or cancelled") [Verified by test].
  4. Discard marks the order "cancelled" with an audit entry [Verified]. Holding a resumed cart again
     creates a new held order and discards the old one [Verified].
- **Exceptional cases and their handling:**
  - Holding reserves **no stock** and does not fix prices; prices and availability are those at
    completion [Verified by test].
  - There is no expiry and no maximum number of held sales; stale held sales accumulate until someone
    discards them [Verified].
  - When another cashier completes a held sale, the resulting sale is attributed to the completing
    cashier, shift and register (cash enters the completer's drawer), while the order record keeps the
    original holder's shift, register and user [Verified from the update, which does not touch those
    columns] (FND-309).
  - The lines as originally held are overwritten at completion; the intent as held is not preserved
    [Verified] (FND-309).
  - Completed and cancelled orders are frozen by database triggers; orders can never be deleted
    [Verified by test].
- **Existing controls:**
  - CTL-327 Held order can be completed exactly once (row lock + status check + trigger) [Verified].
  - CTL-328 Held orders are confined to their branch [Verified].
- **Financial / stock / cash effect:** None until completion.
- **Upstream dependencies:** BP-302, BP-306.
- **Downstream effects:** BP-307.
- **Observations:** FND-309.

#### BP-310 Receipt, reprint and recent sales at the till
- **Business purpose:** Give the customer a receipt and let the cashier re-open a receipt of the current
  shift.
- **Actors and required authority:** "Create sales" at the POS branch; receipts are readable only for
  sales of the session branch; "recent sales" lists only the sales of the cashier's **current open
  shift** (newest first, at most 50) [Verified].
- **Trigger / inputs:** Automatic after completion; "Recent" → tap a sale → receipt dialog → "Print"
  (browser print, 80 mm layout) [Verified].
- **Normal flow / receipt contents [Verified from the receipt view]:** merchant name, branch name,
  branch address and phone, branch receipt header; receipt number, cashier name, customer name (if
  any), register name/code, date and time (device locale); per line: product and variant name,
  modifiers, quantity × applied unit price, line gross, line discount; subtotal, total discounts (line +
  sale), total; one line per tender showing the amount tendered (cash) or applied; change; branch
  receipt footer (default "thank you"). Not shown: fees, costs, SKU, the sale discount allocation per
  line, the list price when overridden, taxes (none exist), merchant legal identifiers, QR code, refund
  policy, the words "duplicate"/"copy" on a reprint [Verified].
- **Exceptional cases and their handling:**
  - After the shift is closed the cashier can no longer find the sale at the till; a reprint then needs
    a manager with "view sales history" [Verified] (FND-310).
  - A cashier of another branch gets "not found"; a POS session cannot call management endpoints
    [Verified by test].
  - Reprints are not counted or audited [Verified] (FND-310).
  - For online sales the register prints as "ONLINE" and the cashier name is empty [Verified].
- **Existing controls:** CTL-329 Branch confinement of receipts at the till; CTL-325 (no fees/costs to
  the POS) [Verified].
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-307.
- **Downstream effects:** Returns (returns are made against the receipt, same branch).
- **Observations:** FND-308, FND-310.

#### BP-311 Review sales history and a sale's detail in management
- **Business purpose:** Let management see every completed sale, its composition, payments, fees, cost
  and refund status, and filter by period, branch, channel and receipt number.
- **Actors and required authority:** "View sales history" at the branch of the sale; the list is
  filtered to the branches where the viewer holds it (a branch manager of another branch sees nothing
  and gets "forbidden" on a direct link) [Verified by test]. Cost of goods is shown only to holders of
  "change prices and costs" (merchant-wide) or "financial reports" at the sale's branch [Verified].
- **Trigger / inputs:** Management Sales page: receipt-number search (contains), from/to dates,
  branch context, channel (POS/online); detail page by row click; receipt view [Verified]. The API also
  accepts shift, customer and service-type filters used by other screens [Verified].
- **Normal flow:**
  1. The list shows receipt, channel, date/time, branch, cashier, customer or "walk-in", item count,
     payment kinds, total; a summary line gives count, amount, refunded and net for the current filter
     [Verified].
  2. Date filters are whole **local days in the merchant's time zone** (from 00:00 of "from" to 00:00
     of the day after "to") applied to the sale's completion timestamp [Verified].
  3. The detail shows customer (link if permitted), total, line and sale discounts, refunded amount
     with a link to refunds, fees, cost (if permitted), lines with override badge and struck list price,
     payments with amount, tendered, fee, reference and verification kind, and change [Verified].
- **Exceptional cases and their handling:**
  - "Refunded" and "net" in the list summary count completed refunds against the listed sales
    **whatever the refund date**, whereas the reports count refunds in the period they were completed
    (ADR-0069): the two "net" figures differ whenever a refund crosses a period boundary [Verified from
    the query] (FND-317).
  - The sale's date is the database time of the completing transaction; a shift that spans midnight has
    its sales split across two calendar days while the shift report counts the shift on its closing day
    [Verified for the timestamp; ADR-0069 for the shift rule].
  - The merchant time zone defaults to Asia/Kuwait and has no editing screen; a branch time-zone field
    exists but is not used for sales cut-off [Verified] (FND-306).
  - The cashier name is the user's current name, not a snapshot [Verified].
  - Search covers the receipt number only (no cashier, register, amount or customer search here;
    customer history is on the customer page) [Verified].
- **Existing controls:** CTL-330 Branch-scoped read in SQL, not after the fact; CTL-331 cost
  visibility gated by a second permission; CTL-332 tenant isolation (another merchant's sale is "not
  found") [Verified by test].
- **Financial / stock / cash effect:** Read-only.
- **Upstream dependencies:** BP-307/308.
- **Downstream effects:** Returns (manager-side approvals), Reports.
- **Observations:** FND-306, FND-317.

#### BP-312 Void a completed sale (window and authority, summary)
- **Business purpose:** Cancel a sale rung up by mistake, as a full refund with restock.
- **Actors and required authority:** "Cancel an open or same-shift sale" at the POS branch (Supervisor
  by default), own open shift [Verified].
- **Normal flow / rules:** Allowed only while the sale belongs to the actor's **own open shift** and has
  no refund; it is recorded as a refund of kind "void" (full quantity, restock all) paid back to the
  original tenders, with audit "sale voided" [Verified]. Details, limits and the refund document belong
  to the returns domain.
- **Exceptional cases:** A cashier cannot void their own sale (no permission); a supervisor cannot
  void a cashier's sale (not their shift) — a supervisor can only void sales they rang up themselves;
  anything else is a refund with the returns rules [Verified].
- **Existing controls:** CTL-333 Same-shift, no-refund, permission; sale row untouched (compensating
  document) [Verified].
- **Financial / stock / cash effect:** See returns domain.
- **Observations:** FND-301.

#### BP-313 Create and maintain customer profiles (management)
- **Business purpose:** Keep one merchant-wide customer file shared by all branches.
- **Actors and required authority:** Create: "create basic customer profiles" at any branch; edit,
  activate/deactivate, add notes: "edit customers, notes and status" at any branch; view: "search and
  view customers" at any branch [Verified].
- **Trigger / inputs:** Customers page → "New"; detail page → "Edit"; note box. Fields: full name
  (required, ≤120), phone (normalised, unique per merchant), e-mail (lower-cased, not unique), address
  (≤300), preferred language, status; version for edits; note text ≤2000 [Verified].
- **Normal flow:**
  1. Create assigns the next number C-000001… from a gap-free per-merchant counter inside the
     transaction; records creator; audit "customer created" with the code only [Verified].
  2. Edit locks the row, checks the version, writes only when something changed, and audits either
     "customer updated" with the **names** of changed fields, or "customer deactivated"/"activated"
     when the status changed (personal values never enter the audit log) [Verified by test].
  3. Notes are appended with author and time; they can never be edited or deleted (database grant)
     [Verified by test].
  4. Customers can never be deleted (database grant); deactivation hides them from the till and blocks
     new sales; reactivation is the same edit [Verified].
- **Exceptional cases and their handling:**
  - Duplicate phone on create or edit: refused [Verified]. Customers without a phone can be duplicated
    freely by name; e-mail duplicates are allowed by design (families) [Verified] (FND-315).
  - An implausible phone (letters, fewer than 8 or more than 15 digits) is refused as invalid input;
    the same phone number may legitimately exist at another merchant (uniqueness is per merchant)
    [Verified by test].
  - Stale version on edit: refused [Verified].
  - Another merchant's customer: not found for view, edit and notes [Verified by test].
  - Phone searches need at least three digits; name/number/e-mail search is a "contains" match; the
    wildcard characters are escaped [Verified by test].
- **Existing controls:** CTL-334 Append-only notes and no-delete on customers (database); CTL-335
  normalised unique phone; CTL-336 audit without personal data; CTL-337 optimistic version [Verified].
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** None.
- **Downstream effects:** BP-306, BP-315, Online store (phone match).
- **Observations:** FND-314, FND-315, FND-316.

#### BP-314 Customer purchase history, refunds and spending summary
- **Business purpose:** Show, per customer, purchases, refunds, total spent, net spend, average sale,
  first and last purchase.
- **Actors and required authority:** "Search and view customers" at any branch; the figures include only
  sales and refunds of the branches where the viewer holds that permission (a branch manager sees the
  profile but only their branch's history) [Verified by test].
- **Trigger / inputs:** Customer detail page (stats cards, purchase history paged by 10, refund history
  up to 200 rows, notes) [Verified].
- **Normal flow:**
  1. All figures are derived on demand from the immutable sales and completed refunds (nothing is
     stored on the customer): purchases = number of sales, spent = Σ sale totals, refunded = Σ completed
     refund totals (of any kind, including voids and exchange returns), net = spent − refunded, average
     = spent ÷ purchases rounded half-up to the fils [Verified by test: 2.000 / 3 → 0.667].
  2. The purchase history reuses the sales list filtered by customer, with the viewer's customer
     permission as the branch scope; row click opens the sale only if the viewer also has "view sales
     history" [Verified].
  3. The list page can sort by last activity, name or net spend [Verified].
- **Exceptional cases and their handling:**
  - Average sale uses the gross spent, not the net after refunds [Verified] (presentation choice; see
    FND-318).
  - An exchange adds a new sale to the count and a refund to the refunds, so one exchange appears as
    one extra purchase and one refund [Verified by test: 4 sales after one exchange].
  - Online sales are included (they carry the customer found by phone) [Verified].
- **Existing controls:** CTL-338 Derived, never stored figures; CTL-339 branch scoping applied inside
  the SQL to both sales and refunds [Verified].
- **Financial / stock / cash effect:** Read-only.
- **Upstream dependencies:** BP-306, BP-307, Returns.
- **Downstream effects:** None (no loyalty or credit exists; OQ-019).
- **Observations:** FND-318.

### C.3 Interdependencies with other domains

The checkout engine is the hub of the system: it is the only writer of sales and sale payments, and it
is invoked by the retail POS, the exchange flow, the restaurant bill and the online-order confirmation.
It depends on an open shift (cash custody), on the catalog for prices and on the inventory ledger for
quantities and costs, and it feeds every report and every refund. Customers are a reference file with
no financial balance of their own; their history is a view over sales and refunds.

| This domain → other domain | What flows | Direction and nature |
|---|---|---|
| Sales → Cash custody (registers, shifts) | Cash amount applied per sale posted to the register drawer with the shift id; shift expected cash; the shift lock serialises checkouts per cashier | Money (cash place balance), authority (own open shift required) |
| Sales → Payments setup (methods, bank accounts) | Method snapshot, fee rule evaluated at payment time, settlement account id | Data in; money (bank balance + fee posting) out |
| Sales → Inventory | One ledger movement per consumed item at completion, at weighted-average cost; cost of goods on the sale; reservations honoured; no-oversell policy | Stock quantity and value out; cost in |
| Sales → Catalog | Authoritative price, names, SKU, branch availability, status at completion; snapshot kept on the line | Data in |
| Selling policy → Returns | Refund window days, refund approval limit | Policy out |
| Sales → Returns | Immutable sale with lines and tenders = the base of refundable balances; void window = same shift; exchange reuses the engine and inherits the customer | Data out; document references back (refunds point to sales) |
| Sales → Restaurant | Bills become sales with order reference and service type; modifier prices inside the unit price; items marked paid | Engine shared; data out |
| Sales → Online store | Paid orders become online-channel sales (no shift/cashier); gateway-verified payment; fee to bank | Engine shared; data out |
| Sales → Reports | Gross, discounts, net, payments collected, fees, cost of goods, by day/hour/branch/employee/product/channel; merchant-time-zone days | Data out |
| Sales → Audit / Security | "sale completed", "order suspended/cancelled", "sales settings updated" with actor and IP | Trail out |
| Customers → Sales | Customer id fixed on order and sale; active status and permission checked at completion | Reference out |
| Customers → Online store | Find-or-create by phone at checkout (no staff permission involved) | Reference out |
| Customers → Returns | Exchange keeps the customer; refunds reach the customer through the sale | Reference out |
| Customers → Reports | None directly (no customer report exists) | — |
| Platform → Sales | Operators see only merchant summaries (last sale date, counts) | Aggregate out |

### C.4 Findings

#### FND-301 No supervisory override on another cashier's till
- **Classification:** Inconsistency (doc vs behaviour) and Control gap
- **Severity:** Medium
- **Evidence:** BR-026 states that actions beyond a cashier's permissions (discount above limit, price
  override, void) "require a manager override, which is audited" [Owner decision as documented]. The
  system has no override step: every check is a permission of the person who completes the sale, and
  that person must have their own open shift on a register of the branch (one shift per register, one
  per person). The integration tests open a separate register for the supervisor to ring the
  over-limit discount or the override [Verified]. A supervisor therefore cannot approve an exception
  on a cashier's cart; the practical alternatives are (a) the cashier holds the cart, the supervisor
  resumes and pays it on their own shift, so the cash enters the supervisor's drawer and the sale is
  attributed to the supervisor, or (b) the cashier is given the supervisory permissions permanently.
- **Potential financial impact:** Drift towards granting override permissions to cashiers (weakening
  authorisation), or sales and cash migrating to the supervisor's drawer and name, which distorts
  per-cashier reconciliation and sales attribution; no record identifies who authorised what.
- **Affected procedures:** BP-304, BP-305, BP-309, BP-312
- **Recommendation:** Implement an authorised override step on the cashier's sale (supervisor
  credentials or PIN captured on the cashier's terminal; sale stays on the cashier's shift; the
  authoriser, the kind of exception, the amount and an optional reason are stored on the sale and in
  the audit log). Until then, document the hold-and-resume practice, keep supervisory permissions off
  the cashier role, and have management review "sales by employee" for supervisors' own sales. Align
  BR-026 with the actual behaviour.

#### FND-302 Price override is not bounded and bypasses the discount limit
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** A price override accepts any amount with three decimals, including 0.000, and is not
  compared with the discount limit; the limit check looks only at the discount fields [Verified]. A
  role holding "change the selling price" but not "discounts above the limit" can thus sell at any
  effective discount. Default roles give both to the supervisor and neither to the cashier, so the
  exposure arises with custom roles [Verified]. No reason is captured and no cap above list price
  exists.
- **Potential financial impact:** Revenue leakage disguised as price changes; it is not visible in the
  "discounts" figure of the reports.
- **Affected procedures:** BP-305, BP-307
- **Recommendation:** Treat the gap between list price and overridden price as a discount for the
  limit check (or require the above-limit permission when the override is below list minus the limit),
  refuse zero prices unless the above-limit permission is held, require a reason, and add an "overrides"
  column to the sales-by-employee report.

#### FND-303 Above-limit discounts are not flagged and the limit in force is not kept
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** The audit entry of a sale carries the total discount but no indication that the limit
  was exceeded or by whom it was allowed; the sale does not store the limit percent in force; the policy
  can be changed later (audited), after which the history cannot be classified by reading the data
  alone [Verified].
- **Potential financial impact:** Weak review of exceptions; discount abuse detectable only by manual
  recomputation against the policy audit trail.
- **Affected procedures:** BP-301, BP-303, BP-304
- **Recommendation:** Store on the sale (or audit entry) a boolean "above limit" and the limit applied,
  and offer a management report of above-limit discounts and overrides by employee.

#### FND-304 Non-cash payments can settle nowhere; cash fees are stored but never posted
- **Classification:** Financial risk and Inconsistency (doc vs behaviour)
- **Severity:** Medium
- **Evidence:** BR-086 says every non-cash payment settles into a bank account. The payment method's
  settlement account is optional; when a non-cash method has none, the payment and its fee are recorded
  on the sale but no balance posting is made, so the money appears in collections but in no cash place
  [Verified from the posting rule and the method validation]. Separately, a fee configured on the cash
  method is computed, stored on the payment and in the sale's fee total, but deliberately not posted
  (fees are deemed a card-network charge) [Verified].
- **Potential financial impact:** Bank reconciliation gaps (collections ≠ Σ cash places movements);
  fee totals in reports that no account reflects.
- **Affected procedures:** BP-307
- **Recommendation:** Make the settlement account mandatory for every non-cash method (and refuse
  sales with a method that lost its account); refuse fee rules on the cash method or post the fee as a
  drawer deduction with an explicit reason. Add a reconciliation report "collections by method vs
  postings by account" for the period.

#### FND-305 Card and transfer payments are self-declared ("manual" verification)
- **Classification:** Owner decision to revisit / Missing process
- **Severity:** Medium
- **Evidence:** No terminal or gateway is integrated for the POS (OQ-013 open; gateway methods are
  refused at the till). A card or transfer payment is accepted on the cashier's confirmation, the
  reference field is optional, and nothing later matches payments against acquirer or bank statements
  [Verified]. Processing fees are therefore estimates from the method's rule, not actual charges.
- **Potential financial impact:** Declined or fictitious card payments completing sales; stock leaving
  without money; fee misstatement.
- **Affected procedures:** BP-307
- **Recommendation:** Until terminals are integrated: make the reference mandatory for card and
  transfer methods, add a daily acquirer/bank statement reconciliation (by method, by day, by
  reference) with a sign-off, and include unmatched card payments in the discrepancy report.

#### FND-306 Cut-off follows a fixed merchant time zone; branch time zone is unused
- **Classification:** Inconsistency (behaviour vs behaviour)
- **Severity:** Low
- **Evidence:** Sales-list date filters and reports use the merchant's time zone, which defaults to
  Asia/Kuwait and has no editing screen; branches carry their own time-zone field that no sales query
  uses [Verified]. The sale's timestamp is the database time of the completing transaction [Verified].
- **Potential financial impact:** None while all branches are in Kuwait; day boundaries would be wrong
  for a branch in another zone.
- **Affected procedures:** BP-311
- **Recommendation:** Either remove the branch time-zone field or use it consistently for branch-level
  cut-off; expose the merchant time zone in company settings; state the cut-off rule on the reports.

#### FND-307 Staff can attach their own or a colleague's customer profile
- **Classification:** Missing process
- **Severity:** Low (becomes Medium once loyalty or store credit exists, OQ-019)
- **Evidence:** Customer profiles have no relation to employee accounts; the till allows any active
  profile; no flag or report highlights employee-linked customers [Verified].
- **Potential financial impact:** Today none (no benefits accrue to customers); later, self-awarded
  loyalty points or credit, and staff-discount abuse.
- **Affected procedures:** BP-306, BP-314
- **Recommendation:** Before any loyalty/credit feature: mark staff customer profiles, block
  self-attachment, and report sales where cashier and customer coincide or where one customer appears
  disproportionately on one cashier's sales.

#### FND-308 Receipt contents are not fixed against a legal or commercial requirement
- **Classification:** Owner decision to revisit
- **Severity:** Low
- **Evidence:** OQ-009 (receipt requirements) is open. The receipt prints names, receipt number,
  cashier, register, date, lines, discounts, totals, tenders and change plus a free header/footer; it
  has no merchant legal identifiers, no tax lines (no tax exists, OQ-002), no QR or e-receipt, and a
  reprint is not marked as a copy [Verified].
- **Potential financial impact:** Non-compliance if regulations require specific fields; disputes
  over duplicate receipts.
- **Affected procedures:** BP-310
- **Recommendation:** Decide the mandatory receipt fields (commercial-registration number, return
  policy text, copy marking, optional e-receipt) and make them part of branch/company settings.

#### FND-309 Held sales: attribution drift, overwritten intent, no expiry
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** A held order keeps the holder's shift, register and user even when a different cashier
  completes it; the sale is attributed to the completer; the lines as held are replaced by the final
  cart; held sales never expire and the hold audit entry has no details [Verified].
- **Potential financial impact:** Weak traceability of who built versus who paid a cart; stale held
  sales clutter; a held cart edited at completion leaves no trace of the change.
- **Affected procedures:** BP-309
- **Recommendation:** Record the completing shift/user on the order, keep the held lines (append the
  final lines rather than replacing), add an age indicator and an automatic discard after the shift
  closes or after N hours, and include the label and line count in the audit entry.

#### FND-310 Reprint only during the current shift; reprints uncounted
- **Classification:** Missing process
- **Severity:** Low
- **Evidence:** The till's "recent sales" is limited to the cashier's open shift; receipts are not
  reachable at the till afterwards; reprints are not audited or marked [Verified].
- **Potential financial impact:** Duplicate receipts used for fraudulent returns are undetectable;
  customer service friction after shift change.
- **Affected procedures:** BP-310
- **Recommendation:** Allow receipt lookup by number at the till for the branch (read-only), mark
  reprints as "copy" with a counter, and audit reprints.

#### FND-311 Abandoned carts and cleared lines leave no trace
- **Classification:** Missing process
- **Severity:** Low
- **Evidence:** The cart exists only in the browser; removing lines, clearing the cart, a failed
  checkout after a shift was closed, or a page reload leave no record [Verified].
- **Potential financial impact:** Classic till-fraud patterns (ringing up, collecting cash, clearing the
  sale) cannot be detected from the data; completeness of sales rests on physical supervision.
- **Affected procedures:** BP-302, BP-307
- **Recommendation:** Log "cleared cart" and "line removed after total shown" events with amounts per
  cashier (a lightweight append-only event), and report them in the unusual-activity report; consider
  persisting the cart locally so a shift closed mid-sale does not lose the cart.

#### FND-312 Zero-total sales complete without a payment or a reason
- **Classification:** Financial risk
- **Severity:** Medium
- **Evidence:** A 100 % discount (holder of the above-limit permission) produces a sale with total
  0.000, an empty payment list, stock deducted at cost and a receipt number; the only record is the
  ordinary sale audit entry [Verified by test].
- **Potential financial impact:** Goods leaving stock free of charge under a legitimate-looking receipt;
  no reason code, no separate approval, not isolated in reports.
- **Affected procedures:** BP-304, BP-307
- **Recommendation:** Require a reason for any sale whose total is zero or whose discount exceeds the
  limit, show such sales in the unusual-activity report, and consider a dedicated "complimentary"
  reason catalogue distinct from commercial discounts.

#### FND-313 Discount limit applied per discount, not combined
- **Classification:** Owner decision to revisit
- **Severity:** Low
- **Evidence:** OQ-024 is open; item and sale discounts are each compared with the limit separately, so
  a cashier can give about 19 % with a 10 % limit [Verified].
- **Potential financial impact:** Effective discount authority of cashiers is roughly double the
  nominal limit.
- **Affected procedures:** BP-301, BP-303
- **Recommendation:** Decide (owner) and, if combined, compare the total discount per line (line +
  allocated sale discount) with the limit.

#### FND-314 Online store reuses inactive customers
- **Classification:** Inconsistency (doc vs behaviour)
- **Severity:** Low
- **Evidence:** BR-114: "inactive customers cannot be used for new sales." The storefront's
  find-or-create by phone matches any customer, active or not, and links the online sale to them
  [Verified].
- **Potential financial impact:** None financially; a blocked customer keeps buying online under their
  profile.
- **Affected procedures:** BP-306, BP-313
- **Recommendation:** Decide whether deactivation should block online purchases (then refuse or create a
  fresh profile) and align the rule text.

#### FND-315 Duplicate customers without a phone
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** Uniqueness exists only on the normalised phone; profiles with no phone (allowed) can be
  created repeatedly with the same name; e-mail is not unique by design [Verified].
- **Potential financial impact:** Fragmented purchase history; unreliable spending figures per
  customer.
- **Affected procedures:** BP-313, BP-314
- **Recommendation:** Warn on probable duplicates (same name, same e-mail) at creation and provide a
  merge procedure (keeping sales immutable: re-point the sale's customer reference only through an
  audited administrative action, or keep an alias table).

#### FND-316 Till search exposes phone numbers broadly
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** A three-digit fragment returns up to 20 active customers with their phone numbers to
  any holder of "search and view customers" at the branch (the default cashier) [Verified]; searches
  are not audited.
- **Potential financial impact:** Personal-data leakage by staff; reputational and regulatory exposure.
- **Affected procedures:** BP-306
- **Recommendation:** Mask the phone (show last four digits) in till results, require a longer phone
  fragment, and rate-limit or log bulk searching.

#### FND-317 "Net" in the sales history differs from "net after refunds" in the reports
- **Classification:** Inconsistency (behaviour vs behaviour)
- **Severity:** Medium
- **Evidence:** The sales list summary subtracts all completed refunds of the listed sales regardless of
  when the refund happened; the reports (ADR-0069, BR-121) count refunds in the period they were
  completed [Verified]. For any period with refunds of earlier sales (or later refunds of period
  sales) the two "net" figures disagree.
- **Potential financial impact:** Management and auditors reconciling the history page against the
  sales report will find unexplained differences; risk of wrong period revenue being quoted.
- **Affected procedures:** BP-311
- **Recommendation:** Label the history figure "refunded against these sales (any date)" or compute
  it on the refund date like the reports, and state the convention on both screens.

#### FND-318 Average sale uses gross spent and counts exchanges as purchases
- **Classification:** Inconsistency (clarity)
- **Severity:** Low
- **Evidence:** Average sale = spent ÷ purchases before refunds; an exchange adds a purchase and a
  refund [Verified]. BR-112 lists the metrics without defining the treatment.
- **Potential financial impact:** Misreading of customer value; none on the books.
- **Affected procedures:** BP-314
- **Recommendation:** Define the metrics in the rule (gross or net average; whether exchange sales
  count) and show the definition on the page.

### C.5 Documented owner decisions touching this domain

| Id | Decision (one line) | Residual risk (one line) |
|---|---|---|
| BR-026 | Exceptions beyond a cashier's rights need an audited manager override | Implemented as permissions on the performer's own shift, not as an override (FND-301) |
| BR-050 / ADR-0051, 0052 | Sales snapshot product data; server re-prices and refuses a changed total | None material; snapshot does not include the list price's category or tax (none) |
| BR-080 / BR-033 / OQ-007 | Half-up rounding per line; sale discount allocated by largest remainder | Rounding rule awaits formal owner confirmation (OQ-007) |
| BR-081 / OQ-024 | Default 10 % limit, item and sale discounts checked separately | Combined discount ≈ double the nominal limit (FND-313) |
| BR-082 | Price override needs its own permission; both prices kept and audited | No bounds, no reason, bypasses the discount limit (FND-302) |
| BR-083 | Payments must equal the total exactly; only cash over-tendered; split allowed | Non-cash verification is manual (FND-305) |
| BR-084 / ADR-0046 | Selling needs the cashier's own open shift; stock deducted at completion, all-or-nothing | Shift closed mid-sale loses the cart (FND-311) |
| BR-085 | Held sales reserve no stock; any cashier of the branch may resume; completed once | Attribution drift and no expiry (FND-309) |
| BR-086 / ADR-0089, 0090 | Cash to the register drawer; non-cash to the linked bank minus fee | Settlement account optional in practice (FND-304) |
| ADR-0048 / BR-071 / OQ-016 | Fee computed and frozen per payment at payment time; not reversed on refunds | Fees are rule-based estimates until acquirer data exists (FND-305) |
| ADR-0053 | Idempotency key per checkout; conflict on different body | None noted |
| ADR-0054 | Receipt numbers per branch, gap-free, branch code prefix | A branch-code change would break the visible series continuity [Inferred] |
| ADR-0055 | Gateway methods refused at the POS until verified integration | None |
| ADR-0008 / BR-034 | Sales, lines, payments append-only; corrections by refund/void | Correct customer attribution only via void + re-sale |
| ADR-0069 | Report periods are merchant-local days; refunds on their own date | History page uses a different convention (FND-317); branch time zone unused (FND-306) |
| BR-110 / ADR-0065 | Walk-in by default; registered customer needs the view permission; exchange keeps the customer | Self-attachment possible (FND-307) |
| BR-111 / ADR-0066 | C-numbers; normalised unique phone; 8 digits = Kuwait | Duplicates without phone (FND-315) |
| BR-112 | Spending derived from sales and refunds, scoped to permitted branches | Metric definitions loose (FND-318) |
| BR-113 / ADR-0067 | Cashiers see name, number, phone only; no personal data in audit | Broad phone exposure at the till (FND-316) |
| BR-114 | Deactivate, never delete; notes append-only | Online store ignores deactivation (FND-314) |
| OQ-002 / OQ-003 | No tax, no cash rounding yet | Receipt and pricing will change when decided |
| OQ-009 | Receipt requirements undecided | FND-308 |
| OQ-013 | Card payments by manual entry; terminal integration later | FND-305 |
| OQ-019 | Loyalty, credit, promotions, erasure not implemented | FND-307 becomes material when implemented |
| BR-157 / ADR-0080 | Platform operators never see sales lines or customers | None |

### C.6 Technical mapping (appendix)

| BP id | Permission keys | Main tables | Screens / routes | Document number prefix |
|---|---|---|---|---|
| BP-301 Selling policy | `merchant.settings.read`, `merchant.settings.update` (manager); `sales.create` (POS read) | `sales_settings`, `audit_log` (`sales.settings_updated`) | `/manager/sales` → Policy dialog (`SalesPage.tsx` `PolicyDialog`); `GET/PUT /manager/sales-settings`; `GET /pos/sales/settings` | — |
| BP-302 Cart | `pos.access`, `sales.create`, `catalog.read` | none (browser state); reads `product_variants`, `products`, `product_branch_availability`, `stock_levels` | `/pos` `SalePage.tsx`, `cart.tsx`, `LineDialog`; `GET /pos/catalog`, `GET /pos/inventory/availability` | — |
| BP-303 Discount within limit | `sales.discount` | `sale_lines` (`discount_type`, `discount_value`, `line_discount_minor`, `order_discount_minor`), `sales` (`line_discounts_minor`, `order_discount_minor`) | `LineDialog`, `OrderDiscountDialog`; `POST /pos/sales` | — |
| BP-304 Discount above limit | `sales.discount`, `sales.discount.override_limit` | as BP-303; `audit_log` (`sale.completed`.details.discounts) | as BP-303 | — |
| BP-305 Price override | `sales.price_override` | `sale_lines` (`list_unit_price_minor`, `unit_price_minor`, `price_overridden`), `audit_log` (`sale.completed`.details.priceOverrides) | `LineDialog` | — |
| BP-306 Customer at the till | `customers.read`, `customers.create` | `customers`, `orders.customer_id`, `sales.customer_id`, `document_sequences` (kind `customer`) | `customer.tsx` (`CustomerBar`, `CustomerDialog`); `GET /pos/customers?q=`, `POST /pos/customers` | `C-000001` |
| BP-307 Checkout | `sales.create` (+ `sales.discount`, `sales.discount.override_limit`, `sales.price_override`, `customers.read` as used) | `orders`, `order_lines`, `sales`, `sale_lines`, `sale_line_modifiers`, `payments`, `receipt_sequences`, `stock_movements`, `stock_levels`, `financial_account_entries`, `shifts` (lock), `payment_methods`, `audit_log` (`sale.completed`) | `PaymentDialog`; `POST /pos/sales`; errors `SHIFT_REQUIRED`, `ITEM_UNAVAILABLE`, `DISCOUNT_LIMIT_EXCEEDED`, `PRICE_OVERRIDE_DENIED`, `TOTAL_CHANGED`, `PAYMENT_TOTAL_MISMATCH`, `PAYMENT_METHOD_UNAVAILABLE`, `PAYMENT_NOT_VERIFIED`, `INSUFFICIENT_STOCK`, `IDEMPOTENCY_CONFLICT`, `CUSTOMER_INACTIVE` | `{BRANCH_CODE}-000001` (receipt) |
| BP-308 Other engines | exchange: `refunds.create` + `sales.create`; restaurant: `sales.create` (+ `restaurant.orders`); online: none | `sales.channel`, `sales.online_order_id`, `sales.restaurant_order_id`, `sales.service_type`, `payments.method_kind='exchange'`, `payments.refund_id`, `payments.verification` | `POST /pos/exchanges`, `POST /pos/restaurant/orders/:id/pay`, gateway webhook (`completeOnlineSaleInTx`); audit `sale.completed_exchange`, `sale.completed_online` | receipt as above |
| BP-309 Held sales | `sales.create` | `orders` (`status` suspended/completed/cancelled, `label`), `order_lines`; triggers `orders_final_states`, `order_lines_only_while_suspended`; audit `order.suspended`, `order.cancelled` | `SuspendDialog`, `HeldSalesDialog`; `POST /pos/orders`, `GET /pos/orders/suspended`, `POST /pos/orders/:id/cancel`; error `ORDER_NOT_SUSPENDED` | — |
| BP-310 Receipt / recent | `sales.create` | `sales`, `sale_lines`, `payments`, `branches` (`receipt_header`, `receipt_footer`, `phone`, `address`), `registers`, `merchants` | `ReceiptDialog`, `ReceiptView`, `RecentSalesDialog`; `GET /pos/sales/recent`, `GET /pos/sales/:id/receipt` | — |
| BP-311 Sales history | `sales.read`; cost: `catalog.prices.manage` or `reports.financial` | `sales`, `sale_lines`, `payments`, `refunds` (refunded sum), `merchants.timezone` | `/manager/sales`, `/manager/sales/:saleId` (`SalesPage`, `SaleDetailPage`); `GET /manager/sales`, `GET /manager/sales/:id`, `GET /manager/sales/:id/receipt` | — |
| BP-312 Void | `sales.void` | `refunds` (kind `void`), `refund_lines`, `refund_payments`; audit `sale.voided` | `POST /pos/sales/:id/void`; error `NOT_VOIDABLE` | `{receipt}-R{n}` (returns domain) |
| BP-313 Customer profiles | `customers.read`, `customers.create`, `customers.manage` | `customers`, `customer_notes`, `document_sequences`; unique index `customers_phone_key`; audit `customer.created/updated/activated/deactivated/note_added` | `/manager/customers`, `/manager/customers/:customerId` (`CustomersPage`, `CustomerDetailPage`); `GET/POST /manager/customers`, `PATCH /manager/customers/:id`, `GET/POST /manager/customers/:id/notes`; error `DUPLICATE_PHONE` | `C-000001` |
| BP-314 Customer history | `customers.read` (+ `sales.read` for drill-down) | `sales`, `refunds` (derived), `customers` | `CustomerDetailPage`; `GET /manager/customers/:id/sales`, `GET /manager/customers/:id/refunds` | — |

---

## Chapter D: Payment methods, registers, shifts and cash custody

### D.0 Scope and sources reviewed

- **Business purpose.** This domain defines where a company's money physically sits and who answers for it at every moment. It covers (a) the catalogue of payment methods a company accepts and the processing-fee rule attached to each, (b) the "cash places" of the company — the drawer of every register, the treasury of every branch, the company's "cash in transit" pocket and its bank accounts — all held in one append-only cash ledger, (c) the cashier shift as a period of personal responsibility for one drawer, opened and closed with a physical count, (d) every way cash moves between places (drop, top-up, bank deposit, branch-to-branch transfer) and every way cash leaves the company (expense, supplier payment), with reversals, and (e) the counts, statements and reports that let management and an auditor see the cash position and the differences found. A general ledger is explicitly out of scope; this is a custody ledger.
- **Files/screens reviewed.** API: `apps/api/src/modules/payments` (schema, service, controller, `cash-ledger.ts`, `merchant-defaults.ts`), `apps/api/src/modules/registers` (schema, controller, `shifts.service.ts`, `shifts.int.test.ts`), `apps/api/src/modules/cash` (`cash.service.ts`, `cash-payouts.service.ts`, both controllers, `cash.int.test.ts`, `cash-payouts.int.test.ts`, `cash-reports.int.test.ts`); the ledger-posting parts of `sales.service.ts` and `refunds.service.ts`; the custody and expenses sections of `reports.service.ts`; `packages/money/src/fees.ts`; `packages/permissions/src/catalog.ts` and `templates.ts`; `packages/contracts/src/payments.ts` and `cash.ts`; migrations `0010`–`0012` and `0032`–`0035`; `merchants/provision.ts`, `branches/branches.service.ts`, `sequences.schema.ts`, the treasury-count test fixture. Screens: `apps/pos-web/src/pages/ShiftPages.tsx`; `apps/manager-web/src/features/cash/{CashCustodyPage,CashPayouts,PaymentsPage,RegistersPage,ShiftsPage}.tsx`; the total-cash card of `DashboardPage.tsx`. Documents: BR-070…079, BR-086…089, BR-125/126/126a, OQ-003/013/015/016/018/026, ADR-0089…0092.
- **Coverage statement.** I did not review the online-store gateway refund path beyond confirming that gateway refunds stay pending and post nothing to a cash place, nor the end-to-end browser tests. The platform-operator realm was not reviewed for this domain; I state as [Inferred] only that operators have no route into merchant cash operations. The exact wording of translated UI strings (hints shown to cashiers) was not read; where a hint matters I say so.

### D.1 Roles and authority matrix

All rights below are **branch-scoped** unless stated: the user must hold the right at the branch of the register, treasury or disbursement concerned [Verified in every service method]. The **Owner** holds every right implicitly everywhere [Verified: ownership bypasses the member check for restricted registers and all permission checks]. The default role templates are editable; a company may grant any right to any role. Platform operator roles hold none of these rights [Inferred: no platform decorator on any route of this domain].

| Operation | Right required (plain words) | Owner | Company Mgr | Branch Mgr | Supervisor | Cashier | Kitchen |
|---|---|---|---|---|---|---|---|
| Configure payment methods, fees, bank/other accounts (company-wide right) | Payment settings | yes | yes | no | no | no | no |
| See payment methods at the till (names only, no fees) | Create sales | yes | no | no | yes | yes | no |
| Create/edit registers, set tolerance, restrict members, deactivate | Configure registers | yes | yes | yes (own branches) | no | no | no |
| Open and close own shift, see own shift | Operate own shift | yes (POS session) | no | no | yes | yes | no |
| Record cash in/out on own shift, drop, top-up, change swap, expense, supplier payment from drawer | Record cash in/out (plus "Operate own shift") | yes | no | no | yes | **no** (removed, BR-079) | no |
| Deposit drawer cash into a bank at the till | Record cash in/out **and** Bank deposit | yes | no | no | only if granted | no | no |
| List shifts, read any shift, discrepancy report | Monitor all shifts | yes | yes | yes (own branches) | yes | no | no |
| Force-close a shift (with or without count) | Configure registers | yes | yes | yes (own branches) | no | no | no |
| Cash overview, statements, register↔treasury transfer, count a treasury or an idle drawer, pay expense/supplier from treasury, reverse any disbursement, send/receive/cancel branch transfers | Cash custody | yes | **no (not in template)** | no | no | no | no |
| Deposit treasury cash into a bank (management) | Bank deposit (on the branch of the treasury) | yes | no | no | no | no | no |
| Cash-by-type and expenses reports, shifts report | Financial reports | yes | yes | no | no | no | no |
| See cash paid to a supplier on the supplier page | Purchasing read | yes | yes | yes | no | no | no |
| Total-cash card on the dashboard | Cash custody | yes | no | no | no | no | no |

Notes on scoping [Verified]:
- The POS session is bound to one branch; a cashier can only see and open registers of that branch, and an open shift at another branch is invisible from this session.
- A restricted register is usable only by its listed employees (the owner always may).
- Branch managers of branch B get "forbidden" when listing shifts of branch A, and see zero shifts when listing without a branch filter if they hold the right nowhere relevant.
- "Cash custody" is a single right that bundles recording, counting, paying, reversing and inter-branch moves (see FND-422).
- "Cash custody" and "Bank deposit" are in **no default role**, so until the owner grants them, only the owner can count a treasury, pay from a treasury, deposit or move cash between branches.

### D.2 Procedures

#### BP-401 Configure payment methods and processing fees
- **Business purpose:** Define which tenders the company accepts (cash, card, bank transfer, custom), where each non-cash tender settles (a bank or other non-cash account), the processing-fee rule, availability at the till and online, and ordering.
- **Actors and required authority:** Payment settings (company-wide). Default: Owner, Company Manager.
- **Trigger / inputs:** Management → Payment methods. Kind, names (Arabic/English, one required), status, availability (POS / online), fee type (none, fixed, percentage, fixed + percentage), fixed fee (KWD, 3 decimals), percentage (0–100, up to 3 decimals), settlement account, optional gateway provider (never live), sort order, and the version last seen (optimistic lock).
- **Normal flow:**
  1. The manager creates or edits a method. The system stores only the fee parts the chosen type uses; unused parts are stored as zero so no hidden fee survives a type change [Verified].
  2. For a non-cash method a settlement account may be chosen; only an active bank/card-clearing/wallet/other account of the same company is accepted. A cash method can never be linked to an account (cash settles in the drawer that takes it) and can never use a gateway [Verified].
  3. An audit entry records the creation/update with the fee rule before and after [Verified].
  4. At the till, cashiers see only active, POS-available methods, by name; fees and accounts are not sent to the POS [Verified by test].
- **Exceptional cases and their handling:**
  - Exactly one cash method per company; a second is refused (conflict). The cash method cannot change its kind [Verified].
  - Fee percentage above 100 or with more than 3 decimals, fixed fee with more than 3 decimals or negative: refused [Verified by test].
  - Editing with a stale version is refused (conflict) [Verified].
  - A method or account of another company is invisible: editing or linking it answers "not found", and one company's renaming never affects another [Verified by test].
  - Linking to a drawer, treasury, in-transit, legacy cash or archived account is refused [Verified].
  - Methods are deactivated, never deleted (database denies deletes) [Verified].
  - A fee rule **can** be set on the cash method; see FND-412.
- **Existing controls:**
  - CTL-401 Company-wide right required; fee changes are audited with before/after values.
  - CTL-402 Database rules: valid kind/status/fee type, fee ranges, single cash method, no delete.
  - CTL-403 Settlement account must be an active non-cash account of the same company (cross-company id yields "not found").
  - CTL-404 Optimistic version lock on edits.
- **Financial / stock / cash effect:** None at configuration time. The fee rule in force at the moment of each payment is frozen on that payment (see BP-416); later rule changes never rewrite history [Verified].
- **Upstream dependencies:** Company provisioned (BP-403); bank accounts (BP-402) for settlement.
- **Downstream effects:** BP-416 (settlement and fees), Sales domain (tender choice), Reports (collections by method, fees).
- **Observations:** FND-412, FND-413, FND-414, FND-415.

#### BP-402 Configure bank accounts and other non-cash places
- **Business purpose:** Maintain the company's bank accounts (and optional card-clearing, wallet or "other" balances) that receive non-cash sales and cash deposits.
- **Actors and required authority:** Payment settings (company-wide).
- **Trigger / inputs:** Management → Financial accounts. Names, kind (bank, card clearing, wallet, other), status (active/inactive), version.
- **Normal flow:**
  1. Create or rename an account; the balance shown is always the sum of its ledger entries and is never typed [Verified].
  2. Drawers, treasuries and the in-transit pocket are not listed here (they live on the Cash custody page) and cannot be edited here; the archived pre-cutover cash account is listed read-only [Verified].
- **Exceptional cases and their handling:**
  - System-managed accounts (drawers, treasuries, in-transit) and archived accounts cannot be edited (conflict) [Verified].
  - Accounts cannot be deleted (database) [Verified]. There is **no check that an account is empty before it is set inactive**, and a method already linked to an account that later becomes inactive keeps posting payments to it (only *archived* accounts refuse entries at database level) [Verified] — FND-414.
  - Kind "cash" cannot be created any more; it survives only on the archived legacy account [Verified].
- **Existing controls:**
  - CTL-405 Balance derived from append-only entries only; no update/delete of entries for the application role.
  - CTL-406 Database trigger: an archived account accepts no new entry.
  - CTL-407 Audit entry on create/update.
- **Financial / stock / cash effect:** None at configuration time. Bank balances in the system are "book" balances (payments − fees + deposits − non-cash refunds); nothing reconciles them to the real bank [Verified absence] — FND-406.
- **Upstream dependencies:** BP-403.
- **Downstream effects:** BP-401 (settlement target), BP-411 (deposit target), BP-416.
- **Observations:** FND-406, FND-414.

#### BP-403 Default setup of a new company, a new branch and a new register
- **Business purpose:** Every company starts with a usable payment configuration and one cash place per branch and per register, so no payment can settle "nowhere".
- **Actors and required authority:** System, at company registration, branch creation and register creation; also repair seeds run at deploy.
- **Trigger / inputs:** Owner self-registration; "create branch" (Branches manage); "create register" (Configure registers).
- **Normal flow:**
  1. On company creation, if the company has no non-cash account yet: two bank accounts ("Bank account 1/2") are created and five methods are created or recognised — Cash (no account), Card (KNET) → bank 1, Visa/Mastercard → bank 2, Payment link → bank 1, WAMD → bank 1 — all with no fee [Verified by test]. Existing equivalent methods are matched by name and linked rather than duplicated; any other non-cash method with no account is linked to bank 1 [Verified].
  2. The main branch gets register "R1", its drawer account, its treasury, and the company gets its single in-transit account [Verified].
  3. Every new branch gets one register, a drawer and a treasury (plan capacity is checked) [Verified]. Every new register gets a drawer account [Verified].
  4. New drawers and treasuries start at zero and "not yet counted"; the first count sets their balance (BP-405, BP-410).
- **Exceptional cases and their handling:**
  - The one-time guard is "company already has a non-cash account"; a company whose owner renamed a method is never re-seeded [Verified by test].
  - Plan limits can refuse a new branch or register [Verified].
- **Existing controls:**
  - CTL-408 Uniqueness rules: one drawer per register, one treasury per branch, one in-transit account per company (database).
  - CTL-409 Setup is idempotent and never relinks what the owner changed.
- **Financial / stock / cash effect:** Creates empty places; no balances.
- **Upstream dependencies:** Company and branch records.
- **Downstream effects:** Every other procedure in this domain.
- **Observations:** FND-415 (documentation says a "Cash on hand" account is also created; it is not since ADR-0090).

#### BP-404 Configure registers (access, tolerance, status)
- **Business purpose:** Define the tills of a branch, who may work on each, the tolerance within which a closing difference counts as "balanced", and retire tills.
- **Actors and required authority:** Configure registers at the register's branch. Default: Owner, Company Manager, Branch Manager.
- **Trigger / inputs:** Management → Registers. Branch, code (unique per branch, case-insensitive), names, access mode (whole branch / listed employees), member list, "default opening float", discrepancy tolerance (≥ 0, no upper limit), version.
- **Normal flow:**
  1. Create: plan capacity checked; register and its drawer created; members stored; audit entry [Verified].
  2. Edit: same branch only (a register never moves branch); members replaced; audit entry [Verified].
  3. Deactivate: refused while a shift is open, and refused while the drawer holds any balance ("move the cash to the treasury first"); reactivation re-checks plan capacity [Verified].
- **Exceptional cases and their handling:**
  - Duplicate code at the branch: conflict [Verified].
  - Member id not found: refused [Verified].
  - Tolerance may be set to any amount; it applies to closings made **after** the change because each closed shift freezes the tolerance in force at closing time [Verified] — see FND-403.
  - The "default opening float" is stored and shown but has **no effect** since opening became a count [Verified: the POS opening screen does not use it] — FND-415.
- **Existing controls:**
  - CTL-410 A register with cash or an open shift cannot be deactivated.
  - CTL-411 Tolerance frozen on each closed shift so history is never rewritten.
  - CTL-412 Restricted registers enforce membership at the till; branch binding of the POS session.
- **Financial / stock / cash effect:** None directly; tolerance changes how differences are classified (not how they are booked).
- **Upstream dependencies:** Branch exists; BP-403.
- **Downstream effects:** BP-405, BP-408, BP-409, BP-417.
- **Observations:** FND-403, FND-415, FND-416.

#### BP-405 Open a shift by counting the drawer
- **Business purpose:** Start a cashier's period of responsibility for one drawer by confirming what is physically in it against what the system says was left there.
- **Actors and required authority:** Operate own shift at the POS branch; register access (BP-404); register and branch active.
- **Trigger / inputs:** POS start screen. Register, counted cash (typed total or notes-and-coins breakdown), the expected balance the screen displayed, optional note.
- **Normal flow:**
  1. The cashier sees each usable register with its carried balance and whether it still "needs a count" (new, or after an uncounted forced close) [Verified].
  2. The cashier counts and confirms. The system locks the drawer, verifies the displayed expected balance still equals the book balance, and books the difference (counted − expected) on the drawer as an adjustment so the book balance equals the count [Verified].
  3. Attribution of the difference [Verified]:
     - drawer's first verified count → "opening balance by count", no difference recorded, no note required;
     - last shift on this register was force-closed **without** a count → the difference is recorded as belonging to **that earlier shift** and its cashier;
     - otherwise → a "between shifts" difference on the register, charged to nobody; a note is required when it exceeds the register tolerance.
  4. The shift opens; audit entry with expected, counted, difference and attribution.
- **Exceptional cases and their handling:**
  - Expected balance changed meanwhile (someone moved cash): refused, screen reloads the new balance [Verified by test].
  - Register busy (another open shift), cashier already has an open shift anywhere, register of another branch (not found), inactive register/branch, restricted register without membership: refused; concurrent openings serialize under the drawer lock and the unique indexes [Verified by test].
  - Denomination breakdown not adding up to the counted total: refused [Verified].
  - Breakdown may contain at most 30 denominations; counts up to 100,000 per denomination [Verified].
- **Existing controls:**
  - CTL-413 Count against a displayed expected amount, with stale-value refusal.
  - CTL-414 One open shift per register and per employee (database unique indexes plus lock).
  - CTL-415 Note required beyond tolerance for a between-shifts difference; attribution rules recorded on the shift.
  - CTL-416 Audit entry; every drawer entry carries the shift (database trigger).
- **Financial / stock / cash effect:** Drawer balance = counted amount. Company cash changes by the difference (an opening count creates cash out of nothing for the first count — see FND-405). Nothing else.
- **Upstream dependencies:** BP-403/404; previous shift closed (BP-408/409).
- **Downstream effects:** Sales and refunds post to this drawer; BP-406…408; BP-417 (between-shifts and after-uncounted sections).
- **Observations:** FND-401 (not blind), FND-405.

#### BP-406 Cash in / cash out during a shift (corrections, "other", change swap)
- **Business purpose:** Record cash put in or taken out of the drawer for reasons other than sales, so the drawer's expected balance stays true.
- **Actors and required authority:** Record cash in/out at the branch, on the user's **own open shift** only. Default: Supervisor (cashiers lost this right at cutover — owner decision BR-079).
- **Trigger / inputs:** POS → shift → Record in / Record out. Amount (> 0), reason, note, idempotency key. Cash-in reasons: top-up from treasury, change received (swap), correction, other. Cash-out reasons: drop to treasury, bank deposit, petty expense, supplier payment, correction, other.
- **Normal flow (corrections, other, change swap; the other reasons are BP-407, BP-411, BP-412, BP-413):**
  1. The system locks the shift, then the drawer; for cash out it checks the drawer holds the amount [Verified].
  2. A movement record is written on the shift and a single ledger entry on the drawer: + for cash in, − for cash out, typed "adjustment" for correction/other [Verified]. **No counter-account exists** for a correction or "other": the cash simply enters or leaves company cash (FND-407).
  3. "Change received" (notes-for-coins swap) writes a movement record but **no ledger entry**: the drawer total is unchanged [Verified].
  4. Audit entry per movement.
- **Exceptional cases and their handling:**
  - No open shift → "open a shift first". Reason not valid for the direction (e.g. drop as cash in) → refused. "Other" without note → refused. Zero or negative amount → refused [Verified by test].
  - Drawer insufficient → refused; eight parallel withdrawals of 3 from a 10 drawer succeed exactly three times [Verified by test].
  - Duplicate submission with the same idempotency key records once [Verified by test].
  - Movements on a closed shift are impossible (database trigger) and movement records can never be updated or deleted [Verified].
- **Existing controls:**
  - CTL-417 Own-shift lock and drawer lock, balance check before any cash out.
  - CTL-418 Reason list fixed per direction; note mandatory for "other".
  - CTL-419 Idempotency key; append-only movements; audit entry.
- **Financial / stock / cash effect:** Drawer and company cash change by the amount (corrections/other); nothing for a change swap. Reports show corrections as their own line (BP-417).
- **Upstream dependencies:** BP-405.
- **Downstream effects:** BP-408 expected cash; BP-417.
- **Observations:** FND-407, FND-409.

#### BP-407 Drop to treasury and top-up from treasury
- **Business purpose:** Move cash between a drawer and the treasury of the same branch (skimming excess cash out of the till, or providing change float) without it ever being counted twice.
- **Actors and required authority:** At the till: Record cash in/out on own shift (reasons drop / top-up). In management: Cash custody at the branch, with or without an open shift on the register.
- **Trigger / inputs:** Amount, note, idempotency key; in management, the two accounts (must be a register and the treasury of its own branch).
- **Normal flow:**
  1. The system locks the open shift (if any) first, then both accounts in a fixed order [Verified].
  2. Drop: drawer must hold the amount. Top-up: the treasury must have had its opening count and must hold the amount [Verified by test].
  3. One transfer record and exactly two ledger entries (− source, + destination) are written; a deferred database check at commit refuses a transfer whose two entries do not exist and balance [Verified by test].
  4. When the manager moves cash on a register that has an open shift, a movement (drop/top-up) is also written on that shift, so the cashier's shift keeps reconciling with the drawer; the movement shows the manager's name [Verified by test].
  5. Audit entry.
- **Exceptional cases and their handling:**
  - Drawer→drawer, drawer→another branch's treasury, treasury→treasury: refused by the service and by the database direction trigger [Verified by test].
  - Transfers between inactive accounts: refused (database) [Verified].
  - Treasury not yet counted: no top-up; treasury short: refused; parallel top-ups never overdraw the treasury [Verified by test].
  - Idempotent replay returns the same transfer [Verified by test].
  - Transfer records can never be updated or deleted [Verified].
- **Existing controls:**
  - CTL-420 Same-branch register↔treasury only (service + database trigger).
  - CTL-421 Two balanced entries per transfer (deferred constraint trigger).
  - CTL-422 Source balance check under lock; treasury pays nothing before its opening count.
  - CTL-423 Manager moves during a shift are mirrored onto the shift and attributed to the manager.
- **Financial / stock / cash effect:** Balances move between two cash places; company cash unchanged; never revenue or expense.
- **Upstream dependencies:** BP-405 (POS path); BP-410 (treasury counted) for top-ups.
- **Downstream effects:** BP-408; BP-417 (drops/top-ups lines).
- **Observations:** FND-419.

#### BP-408 Close own shift with a count
- **Business purpose:** End the cashier's responsibility by counting the drawer; the difference is booked on the shift and shown by cashier name; the cash stays in the drawer for the next shift.
- **Actors and required authority:** Operate own shift (own open shift only).
- **Trigger / inputs:** POS → shift → Close. Counted cash (total or breakdown), optional note, version of the shift.
- **Normal flow:**
  1. The shift page shows the expected cash and its make-up (opening count, cash in, cash out, cash sales, cash refunds) **before** the cashier opens the close dialog; the dialog itself asks only for the count [Verified: screen] — FND-401.
  2. The system locks the shift and the drawer; expected = drawer book balance (for a shift open at cutover: the old record-based figure); difference = counted − expected [Verified].
  3. An adjustment entry sets the drawer balance to the counted amount, posted while the shift is still open so the entry carries the shift [Verified].
  4. The shift is closed with expected, counted, difference, denomination breakdown, note, the register tolerance **frozen at this moment**, close type "normal"; outcome = balanced if |difference| ≤ tolerance, otherwise over/short [Verified by test].
  5. Audit entry; the cashier sees the result screen (expected, counted, difference, outcome).
- **Exceptional cases and their handling:**
  - Stale version: refused (conflict). Breakdown not matching the total: refused [Verified].
  - **No note is required for a closing difference of any size** [Verified: no such check in the closing logic] — FND-402.
  - A closed shift is immutable: any later update is refused by a database trigger, even for the application's own database role [Verified by test].
  - Legacy shift (open at cutover): its count becomes the drawer's first verified balance [Verified by test].
- **Existing controls:**
  - CTL-424 Expected cash derived only from the ledger; count booked as an adjustment on the shift.
  - CTL-425 Tolerance frozen on the shift; outcome classification is reproducible later.
  - CTL-426 Closed-shift immutability trigger; version lock; audit entry.
- **Financial / stock / cash effect:** Drawer = counted; company cash changes by the difference; the difference is attributed to the shift (cashier) in reports but **never deducted or settled** (owner decision BR-077).
- **Upstream dependencies:** BP-405.
- **Downstream effects:** Next opening (BP-405) sees the counted balance; BP-417; Reports domain (shifts report).
- **Observations:** FND-401, FND-402, FND-403, FND-404.

#### BP-409 Manager force close (with count / without count) and attribution of a later difference
- **Business purpose:** Close an abandoned shift. With the manager's own count it is a verified close; without one, nothing is booked and the drawer must be counted before it is used again, with the difference found then charged to the abandoned shift.
- **Actors and required authority:** Configure registers at the shift's branch. Default: Owner, Company Manager, Branch Manager.
- **Trigger / inputs:** Management → Shifts → shift → Force close. Mandatory note; optional counted cash (+ breakdown); version.
- **Normal flow:**
  1. With a count: identical to BP-408 but close type "forced", closed-by = manager [Verified by test].
  2. Without a count: shift closed as "forced, not counted" with expected cash recorded, counted and difference left empty; the register is flagged "needs count"; no ledger entry [Verified by test].
  3. The next count of that drawer — by the next cashier's opening (BP-405) or by a custodian's count (BP-410) — books its difference as belonging to the forced shift and its cashier; the discrepancy report lists it under "found after an uncounted close" [Verified by test].
- **Exceptional cases and their handling:**
  - Missing note: refused. Already closed: refused. Stale version: refused [Verified by test].
  - A manager of another branch cannot see or close the shift [Verified by test].
  - Between the uncounted close and the next count, a custodian **may** still transfer cash in or out of the drawer (no open shift blocks it); the eventual difference is still charged to the forced shift [Verified by reading; not tested] — see FND-409 (same root: book balance moves without the responsible cashier).
- **Existing controls:**
  - CTL-427 Note mandatory; branch scoping; version lock; audit entry with "counted: false" or figures.
  - CTL-428 "Needs count" flag blocks silent carry-over; attribution recorded on the next opening or count.
  - CTL-429 Database check: an uncounted close has no counted/difference figures; a counted close has consistent figures.
- **Financial / stock / cash effect:** Counted: as BP-408. Uncounted: no change until the next count.
- **Upstream dependencies:** An open shift.
- **Downstream effects:** BP-405/410 attribution; BP-417.
- **Observations:** FND-416 (same manager sets tolerance, force-closes and counts).

#### BP-410 Count a treasury, or a register without an open shift
- **Business purpose:** Verify the physical cash in a treasury (including its first "opening balance by count") or in an idle drawer; book the difference.
- **Actors and required authority:** Cash custody at the branch. Default: Owner only.
- **Trigger / inputs:** Management → Cash custody → Count. Counted cash, the expected balance displayed, optional breakdown (API only; the management dialog has no denomination grid [Verified]), note.
- **Normal flow:**
  1. For a register: refused if a shift is open ("its cashier counts it when closing"). The register row is locked, then the account [Verified].
  2. The displayed expected balance must still equal the book balance.
  3. First count (treasury never counted; register flagged "needs count" and not following an uncounted forced close): difference booked as an opening count, **no note required**, the treasury is stamped as counted [Verified by test].
  4. Later count: a non-zero difference **requires a note**; booked as a count adjustment. For a register following an uncounted forced close, the entry references that shift [Verified by test].
  5. Audit entry with expected, counted, difference and whether it was an opening count.
- **Exceptional cases and their handling:**
  - Stale expected: refused. Breakdown mismatch: refused [Verified by test].
  - A register count that is neither a first count nor after an uncounted close carries a generated reference rather than a document number (FND-421).
- **Existing controls:**
  - CTL-430 Register with open shift cannot be counted by a manager (cashier's count only).
  - CTL-431 Note required for any non-zero later difference; expected shown and verified.
  - CTL-432 Treasury pays nothing out until its first count (enforced in every outflow).
- **Financial / stock / cash effect:** Place balance = counted; company cash changes by the difference; an opening count creates the opening balance with no source (FND-405).
- **Upstream dependencies:** BP-403.
- **Downstream effects:** All treasury outflows (BP-407, BP-411…415); BP-417 ("count differences", "opening counts").
- **Observations:** FND-405, FND-418, FND-421.

#### BP-411 Bank deposit (from a drawer at the till; from a treasury in management)
- **Business purpose:** Record cash taken to the bank: it leaves the cash place and is credited to the bank account's book balance.
- **Actors and required authority:** Till: Record cash in/out **plus** Bank deposit, on own shift. Management: Bank deposit at the treasury's branch (Cash custody alone is not enough) [Verified by test].
- **Trigger / inputs:** Amount, destination bank account (active, kind bank), optional slip reference (management only), note, idempotency key.
- **Normal flow:**
  1. Source balance checked under lock (treasury must be counted) [Verified].
  2. A transfer record (origin "deposit" or "till movement") and two entries (− source, + bank) are written; at the till a movement record is also written on the shift [Verified by test].
  3. Audit entry. Company cash falls by the amount; the bank's book balance rises immediately [Verified by test].
- **Exceptional cases and their handling:**
  - Destination not an active bank account (e.g. a drawer id): refused [Verified by test].
  - Insufficient source: refused. Treasury not counted: refused. Idempotent replay [Verified].
  - There is **no "deposit in transit" state and no confirmation** that the bank actually received the amount; the slip reference is optional free text [Verified] — FND-406.
- **Existing controls:**
  - CTL-433 Separate "Bank deposit" right on top of the usual right.
  - CTL-434 Database direction trigger allows register/treasury → bank only with deposit origins.
  - CTL-435 Balanced two-entry transfer; audit entry with bank and reference.
- **Financial / stock / cash effect:** Cash place −, bank book balance +; company cash −; never revenue or expense.
- **Upstream dependencies:** BP-402 (bank), BP-405 or BP-410.
- **Downstream effects:** BP-417 ("deposits" line); bank balance on Financial accounts page.
- **Observations:** FND-406.

#### BP-412 Expense paid in cash
- **Business purpose:** Record a real cash outflow for an operating expense, by fixed category, from a drawer (till) or a treasury (management).
- **Actors and required authority:** Till: Record cash in/out on own shift. Management: Cash custody at the branch.
- **Trigger / inputs:** Amount, category (supplies, maintenance, transport, hospitality, utilities, cleaning, other), description (mandatory for "other"), optional receipt reference (free text, no attachment), idempotency key (management mandatory).
- **Normal flow:**
  1. Source locked and balance checked (treasury must be counted) [Verified by test].
  2. A disbursement document is numbered **EX-000001…** per company and written with one ledger entry (− amount, type "expense") on the source; a deferred database check at commit refuses a disbursement without exactly that entry [Verified by test]. At the till a movement record is also written on the shift.
  3. Audit entry. The expense appears in the disbursement list and the expenses report.
- **Exceptional cases and their handling:**
  - Missing category, "other" without description: refused. Drawer/treasury insufficient: refused [Verified by test].
  - Records can never be updated or deleted (database) [Verified by test]; corrections are reversals (BP-414).
  - **No amount limit, no approval step, no second signature, no attachment** at any level [Verified absence] — FND-408.
- **Existing controls:**
  - CTL-436 Fixed category list; description mandatory for "other"; database shape checks.
  - CTL-437 One posted ledger entry per disbursement (deferred trigger); numbered document; append-only.
  - CTL-438 Source must be a register or treasury of the same branch (database trigger).
- **Financial / stock / cash effect:** Cash place − and company cash −; counted as an operating expense in the expenses report; no stock effect.
- **Upstream dependencies:** BP-405 or BP-410.
- **Downstream effects:** BP-414; BP-417; Reports domain (expenses report, cash by type).
- **Observations:** FND-408, FND-420.

#### BP-413 Supplier payment in cash
- **Business purpose:** Record cash paid to a supplier, optionally against one of its purchase orders, from a drawer (till) or a treasury (management).
- **Actors and required authority:** As BP-412. The supplier page listing uses Purchasing read.
- **Trigger / inputs:** Amount, active supplier, optional purchase order (management only; must belong to the supplier and be submitted or later), description, receipt reference, idempotency key.
- **Normal flow:**
  1. Supplier must be active; the order, if named, must be the supplier's and not draft/cancelled [Verified by test].
  2. Document numbered **SP-000001…**; one ledger entry (type "supplier payment") on the source; movement on the shift at the till [Verified by test].
  3. Shown on the supplier page with a running "total paid" (net of reversals) [Verified by test].
- **Exceptional cases and their handling:**
  - Inactive supplier, order of another supplier, draft order: refused [Verified by test].
  - **The amount is not compared with the order value or with what was already paid**; the same order can be paid any number of times; no payable balance exists (OQ-018) [Verified absence] — FND-408.
  - Supplier payments are excluded from "expenses" totals and shown separately [Verified by test].
- **Existing controls:**
  - CTL-439 Active supplier and order-ownership checks; composite database reference order↔supplier.
  - CTL-440 Same posting/numbering/append-only controls as CTL-437/438.
- **Financial / stock / cash effect:** Cash place − and company cash −; not an operating expense; no stock or payable effect.
- **Upstream dependencies:** Supplier exists (Purchasing domain); BP-405/410.
- **Downstream effects:** BP-414; Purchasing domain (supplier page); BP-417.
- **Observations:** FND-408.

#### BP-414 Reverse an expense or supplier payment
- **Business purpose:** Cancel a disbursement made in error by a mirror record that returns the cash to the place it was paid from.
- **Actors and required authority:** Cash custody at the branch of the original (also for disbursements made at the till by a cashier/supervisor). Default: Owner only.
- **Trigger / inputs:** Original record, mandatory reason, idempotency key.
- **Normal flow:**
  1. The original is loaded; if its source is a register, that register's open shift (if any) is locked, then the account [Verified].
  2. A new disbursement record of the same kind, amount, source, branch, category/supplier/order is written with "reverses" pointing at the original and a numbered document (same EX-/SP- sequence), posting + amount on the source; the shift it is linked to is **whichever shift is open on that register now** [Verified].
  3. Audit entry; lists and reports net the pair; the original shows "reversed by".
- **Exceptional cases and their handling:**
  - Reversing a reversal: refused. Reversing twice: refused (service check and a unique database rule) [Verified by test].
  - Database trigger refuses a reversal that does not mirror its original exactly [Verified].
  - No balance check is needed (cash comes back) [Verified].
  - **No time window**: a disbursement from a shift closed weeks ago can be reversed into the drawer during a different cashier's shift, raising that cashier's expected cash without a movement record on their shift (the shift's cash-in/out breakdown no longer explains its expected cash) [Verified by reading] — FND-409.
- **Existing controls:**
  - CTL-441 One reversal per record; reversals cannot be reversed; mirror check in the database.
  - CTL-442 Reason mandatory; audit entry; idempotency key.
- **Financial / stock / cash effect:** Cash place + and company cash + by the original amount; expense/supplier totals net to zero on the reversal's own date.
- **Upstream dependencies:** BP-412/413.
- **Downstream effects:** BP-408 (expected cash of the current shift); BP-417.
- **Observations:** FND-409, FND-422.

#### BP-415 Branch-to-branch cash transfer (send, receive, cancel)
- **Business purpose:** Move cash from one branch treasury to another through a company "in transit" pocket, with the receiving branch confirming what actually arrived.
- **Actors and required authority:** Send and cancel: Cash custody at the **sending** branch. Receive: Cash custody at the **receiving** branch [Verified by test].
- **Trigger / inputs:** Send: from/to branches (different), amount, note, idempotency key. Receive: amount counted (≥ 0), note (mandatory if it differs), version. Cancel: mandatory note, version.
- **Normal flow:**
  1. Send: receiving branch must be active; sending treasury must be counted and hold the amount. Document **CT-000001…**; transfer sending treasury → in transit; status "in transit" [Verified by test].
  2. Receive: the difference (received − sent) is booked as an adjustment **on the in-transit account**, then the received amount moves in transit → receiving treasury, so in transit returns to zero for this transfer; status "received" with who/when/note [Verified by test].
  3. Cancel (before receipt): in transit → sending treasury; status "cancelled" [Verified by test].
  4. The cash overview counts in-transit amounts of the custodian's branches in company cash; the dashboard card shows it [Verified].
- **Exceptional cases and their handling:**
  - Receive/cancel on a transfer no longer in transit: refused; stale version: refused; status can only move forward and the sent amount/parties can never change (database trigger) [Verified by test].
  - A custodian of the sending branch only cannot receive [Verified by test].
  - Insufficient treasury: refused; idempotent replay of send [Verified by test].
  - In-transit legs are allowed only when tied to a branch transfer (database) [Verified by test].
  - **A shortage in transit is absorbed by the company**: it is recorded on the transfer with a note but attributed to no custodian or courier, and nothing requires follow-up [Verified] — FND-410. Receiving "0.000" is allowed with a note.
- **Existing controls:**
  - CTL-443 Two-sided authority (sender sends/cancels, receiver confirms by count).
  - CTL-444 Forward-only immutable header; version lock; numbered document; audit entries for each step.
  - CTL-445 In-transit balance returns to zero per transfer; difference visible on the transfer and in cash-by-type.
- **Financial / stock / cash effect:** Sending treasury −, in transit +, then receiving treasury + and in transit −; company cash changes only by the receipt difference.
- **Upstream dependencies:** Both treasuries exist; sending treasury counted (BP-410).
- **Downstream effects:** BP-417 ("branch transfers" line per branch, net zero company-wide).
- **Observations:** FND-410.

#### BP-416 Settlement of sale payments and refunds into cash places (cross-domain summary)
- **Business purpose:** Explain how the Sales and Refunds domains feed this ledger, since the drawer's expected cash and the bank book balances depend on it.
- **Actors and required authority:** Cashier at the till (Create sales / Refunds); system for online orders.
- **Normal flow [Verified]:**
  1. At checkout the system refuses inactive or non-POS methods and any gateway-flagged method (no gateway is live). For each tender it computes the processing fee from the method's rule **as it stands at that moment** — fixed part plus the percentage rounded half-up to the fils, never more than the tender — and freezes it on the payment record.
  2. Cash tenders post + applied amount (tendered − change) to the drawer of the cashier's shift; non-cash tenders post + amount and − fee to the method's settlement account (bank). A fee configured on the cash method is stored on the payment but **not** posted anywhere (FND-412).
  3. Online orders post + amount and − fee to the method's account with no shift.
  4. Cash refunds post − amount to the drawer of the **refunding** cashier's shift (which must be open and hold the cash), whichever register sold; non-cash refunds post − amount to the original payment's account; **fees are not reversed** (OQ-016). Gateway refunds post nothing until confirmed.
- **Exceptional cases:** A cash refund larger than the refunding drawer is refused [Verified]. A method whose settlement account was set inactive keeps receiving postings (FND-414).
- **Existing controls:**
  - CTL-446 Fee rule frozen per payment; database check fee ≤ amount.
  - CTL-447 Drawer entries carry the open shift (database trigger); refund needs an open shift with enough cash.
- **Financial / stock / cash effect:** Drawer and bank book balances as above; fees reduce bank book balances only.
- **Upstream dependencies:** BP-401, BP-405.
- **Downstream effects:** BP-408 expected cash; bank balances; Reports (collections, fees, net after fees).
- **Observations:** FND-412, FND-413, FND-414.

#### BP-417 Cash overview, statements, shift monitoring, discrepancy report and cash reports
- **Business purpose:** Give management and auditors the cash position by place, the history of each place, every shift with its outcome, and the differences by type and by person.
- **Actors and required authority:** Overview/statements/transfer lists/disbursement lists: Cash custody (branch-scoped). Shifts list, shift detail, discrepancy report: Monitor all shifts (branch-scoped). Cash-by-type, expenses and shifts reports: Financial reports (branch-scoped).
- **What is available [Verified]:**
  1. **Cash overview**: per branch the treasury (balance, counted-at), each register's drawer (balance, needs-count flag, open shift and cashier), branch total; totals for treasuries, drawers, in transit and company cash on hand. Bank balances are **not** cash on hand.
  2. **Statement** of a drawer or treasury: newest first, paged, with running balance, type, source, description and who; **no date filter and no period opening/closing balance** (FND-411).
  3. **Transfers list**, **disbursements list** (filters kind/category/supplier/branch/date; net total with reversals subtracted; dates filtered on **UTC calendar days**, unlike the reports, FND-411), **branch transfers list**.
  4. **Shifts list** (branch, register, status, outcome over/short/balanced/any difference, dates by opening time in company time zone) and **shift detail** (summary, movements with authors, breakdown, notes, who closed).
  5. **Discrepancy report** (by closing date): totals (balanced/over/short/uncounted, total over, total short, net), by close type, by employee, by register, "between shifts" by register (by opening date; first counts excluded; **not tolerance-filtered**), and "found after an uncounted close" (by the date found) with the cashier of the forced shift.
  6. **Cash by type** inside the payments report: cash sales, cash refunds, drops, top-ups, deposits, expenses, supplier payments, corrections, count differences, opening counts, branch transfers — read straight from the ledger of drawers and treasuries, so transfers can never leak into sales or revenue.
  7. **Expenses report**: expenses by category/branch/source/day and supplier payments by supplier, reversals subtracted on their own date, previous-period comparison; merchant time zone.
  8. **Dashboard** total-cash card for custody holders.
- **Exceptional cases:** Period boundaries differ by report (closing time vs opening time vs found-at time vs UTC day); see FND-411. "Balanced" in totals depends on each register's tolerance at closing (FND-403).
- **Existing controls:**
  - CTL-448 Every figure is derived from append-only records; no typed totals.
  - CTL-449 Branch scoping on every list and report; cashiers have no report access.
- **Financial / stock / cash effect:** None (read-only).
- **Upstream dependencies:** All procedures above.
- **Downstream effects:** Reports domain; management review; external audit.
- **Observations:** FND-403, FND-404, FND-411.

#### BP-418 Cutover from the old company cash account (one-time, 2026-10-12)
- **Business purpose:** Move every existing company from "one cash account holding net cash sales" to drawers and treasuries without resetting or moving history.
- **Actors and required authority:** System migration; audited as a system action.
- **Normal flow [Verified by test]:**
  1. The old cash account is renamed "Old cash account", archived (keeps all entries, takes no new ones, counts in no total) and unlinked from the cash method.
  2. A treasury per branch and a drawer per register are created at zero, "not yet counted"; registers flagged "needs count".
  3. Shifts open at that moment are marked legacy: they close with the old record-based expected cash and their count becomes the drawer's first balance.
  4. Cash in/out right removed from cashier-template roles of existing companies, with an audit entry per role (owner decision).
  5. Running the cutover twice does nothing.
- **Exceptional cases:** The old account's balance (net cash sales since inception) is **not reconciled to anything**: the opening counts that follow create the new balances independently; the gap between the archived balance and the sum of opening counts is unexplained in the system (FND-405).
- **Existing controls:** CTL-450 Archived account refuses entries (database); system audit entry; idempotent guard.
- **Financial / stock / cash effect:** No balance moves; new places start at zero; sales history untouched.
- **Upstream dependencies:** Pre-cutover data.
- **Downstream effects:** BP-405, BP-410 (opening counts).
- **Observations:** FND-405.

### D.3 Interdependencies with other domains

This domain is the sink for cash tenders from Sales and the source of cash for Refunds; it is the only place where cash leaves the company (expenses, supplier payments, deposits) and the only place that knows the cash position. It does not know what a supplier is owed (Purchasing keeps no payable), does not know the bank's real balance (no bank reconciliation), and feeds Reports with ledger-derived figures.

| From → To | What flows | Direction / nature |
|---|---|---|
| Sales → Cash custody | Cash tender (+ drawer of the selling shift); non-cash tender and its fee (± bank book balance); frozen fee per payment | Money and figures; sales never post to a treasury |
| Refunds → Cash custody | Cash refund (− drawer of the refunding shift, must be open and sufficient); non-cash refund (− original account, fee not reversed) | Money |
| Cash custody → Sales/Refunds | "Shift required": no sale or cash refund without the cashier's own open shift; drawer balance caps cash refunds | Authority / limit |
| Purchasing → Cash custody | Active supplier and non-draft purchase order as references for a supplier payment | Data |
| Cash custody → Purchasing | Cash paid per supplier (net of reversals) shown on the supplier page; no payable balance | Figures |
| Branches/Employees → Cash custody | Branch and register existence and status; role grants (custody, deposit, cash move); POS session bound to one branch | Authority |
| Cash custody → Reports | Cash by type, expenses report, shifts report, discrepancy report, dashboard total cash | Figures |
| Platform → Cash custody | Plan capacity for branches and registers | Limit |
| Online store → Cash custody | Online payments and fees into bank accounts (no shift); gateway refunds pending | Money (bank book balance only) |
| Audit → all | Every create/close/transfer/count/disbursement/reversal writes an audit entry | Trace |

### D.4 Findings

#### FND-401 Closing is not blind
- **Classification:** Owner decision to revisit
- **Severity:** Medium
- **Evidence:** The POS shift page displays the expected cash and its components at all times, and the cashier opens the close dialog from that page; opening also displays the expected balance [Verified: screens]. OQ-015 records this as an open question with "implemented: expected is shown" [Owner decision, open].
- **Potential financial impact:** A cashier who knows the target can make the count match (pocketing an overage or hiding a shortage until the next count), so shift differences understate real variances and the "balanced" statistic loses evidential value.
- **Affected procedures:** BP-405, BP-408.
- **Recommendation:** Decide OQ-015. If blind closing is adopted: hide expected cash from the till once a shift is open (keep it for management), require the count first and reveal the difference only after submission; keep the current behaviour as a per-company setting if some companies prefer transparency.

#### FND-402 No explanation required for a closing shortage of any size
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** At opening, a between-shifts difference beyond tolerance requires a note; at closing, the note is optional whatever the difference [Verified: closing logic; test closes 0.155 short with a note only by choice]. A manager's counted force-close requires a note for the act, not for the difference.
- **Potential financial impact:** Shortages are recorded without any contemporaneous explanation, weakening later recovery or disciplinary action and making the discrepancy report harder to review.
- **Affected procedures:** BP-408, BP-409.
- **Recommendation:** Require a note when |difference| exceeds the register tolerance at closing (mirroring opening), and show the note in the shift list and discrepancy report.

#### FND-403 Tolerance is unlimited, set by the monitoring manager, and silently reclassifies differences as "balanced"
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** Tolerance per register accepts any non-negative amount [Verified: schema and database check ≥ 0 only]. It is set by the "Configure registers" right, held by default by the same Branch Manager who force-closes and monitors shifts [Verified: templates]. Shift list "balanced" filter and discrepancy totals count any difference within tolerance as balanced; the net difference is still summed, but the per-shift outcome hides it [Verified].
- **Potential financial impact:** A high tolerance makes repeated small shortages invisible in outcome statistics; the differences still reduce company cash.
- **Affected procedures:** BP-404, BP-408, BP-417.
- **Recommendation:** Cap the tolerance company-wide (owner setting), audit tolerance changes with before/after values, and add to the discrepancy report the sum of differences "within tolerance" so the money effect of tolerance is visible.

#### FND-404 No follow-up or settlement process for shift and count differences
- **Classification:** Missing process
- **Severity:** Medium
- **Evidence:** A difference is booked as a ledger adjustment and shown by cashier name; nothing lets a manager acknowledge, dispute, recover, deduct or write off it, and no status distinguishes reviewed from unreviewed differences [Verified absence]. BR-077 states the difference is "never deducted automatically" [Owner decision].
- **Potential financial impact:** Cumulative shortages per cashier are visible only in reports; without a resolution step there is no evidence of management review for the auditor and no link to any recovery.
- **Affected procedures:** BP-408, BP-409, BP-410, BP-415, BP-417.
- **Recommendation:** Add a "difference review" record (reviewed by, decision: accepted / recovered from employee / written off, note) referencing the shift, count or transfer; report unresolved differences by age.

#### FND-405 Opening balances by count are created without source, note or second person
- **Classification:** Owner decision to revisit
- **Severity:** Medium
- **Evidence:** The first count of a treasury or drawer sets its balance, needs no note, is done by one custodian, and is not compared with anything (for existing companies, not with the archived old cash account's balance) [Verified by test and cutover test]. BR-077/BR-079 document this [Owner decision].
- **Potential financial impact:** An understated opening count hides cash that can later be removed without any difference ever appearing; the gap between the archived account (net cash sales to date) and the opening counts is not explained anywhere.
- **Affected procedures:** BP-405, BP-410, BP-418.
- **Recommendation:** Require a note and (where staff allow) a second-person confirmation on opening counts; show, once per company, a cutover reconciliation page listing the archived balance against the sum of opening counts with an explanation field; keep the owner's decision that it is not a "difference".

#### FND-406 Bank account balances are never reconciled; deposits are credited on the depositor's word
- **Classification:** Missing process
- **Severity:** High
- **Evidence:** Bank book balances = payments − fees + deposits − non-cash refunds [Verified]. There is no bank statement import, no reconciliation screen, no "deposit in transit" status and no confirmation step; the slip reference is optional free text; a cashier with the deposit right moves drawer cash to the bank in one step [Verified by test].
- **Potential financial impact:** Cash recorded as deposited may never reach the bank; card settlements and real acquirer fees may differ from book figures; neither is detectable inside the system. This is the largest unreconciled position in the domain.
- **Affected procedures:** BP-402, BP-411, BP-416.
- **Recommendation:** Introduce a "deposit in transit" state confirmed by a second user (or by a statement line) with mandatory slip reference; add a periodic bank reconciliation (statement balance vs book, with reconciling items) at least as a manual tick-off of deposits and settlement batches.

#### FND-407 Cash out "correction" / "other" removes cash from custody with no destination and no approval
- **Classification:** Financial risk
- **Severity:** High
- **Evidence:** A holder of the cash in/out right can record a cash-out with reason "correction" (note optional) or "other" (note required); the drawer's expected cash falls by that amount and no counter-place receives it [Verified: posting logic and reports' "corrections" line]. The drawer will then count as balanced. There is no amount limit and no approval; detection relies on someone reviewing the corrections line or the audit log.
- **Potential financial impact:** Cash can be taken from a drawer and the shift still closes "balanced"; the only trace is a movement labelled correction. Supervisors hold this right by default.
- **Affected procedures:** BP-406, BP-417.
- **Recommendation:** Restrict "correction" to cash-in (or to within-shift reversal of a specific earlier movement), require a note for every correction, impose a per-movement and per-shift limit configurable by the owner, and surface corrections prominently in the shift detail and discrepancy report; consider requiring a manager's confirmation for any cash-out that is not a drop, deposit, expense or supplier payment.

#### FND-408 Disbursements have no limits, no approval and no link to what is owed
- **Classification:** Control gap
- **Severity:** High
- **Evidence:** Expenses and supplier payments from a drawer need only the cash in/out right; from a treasury only the custody right. No amount threshold, no approver, no attachment; a supplier payment may name an order but is not compared with the order value or earlier payments, so an order can be paid repeatedly [Verified: service logic; OQ-018 open]. The reversal right is the same custody right.
- **Potential financial impact:** Fictitious or duplicated payments are limited only by the cash in the place; supplier balances cannot be verified.
- **Affected procedures:** BP-412, BP-413, BP-414.
- **Recommendation:** Owner-set approval thresholds per role for expenses and supplier payments (two-step: recorded → approved before cash leaves, or at least post-facto approval queue); show "paid to date vs order value" and warn or block overpayment; require a receipt reference above a threshold and allow a receipt image; resolve OQ-018 (payables).

#### FND-409 Book balances of a drawer can change under a cashier without their count or a movement on their shift
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** (a) Reversing a disbursement returns cash to the original drawer and links the entry to whatever shift is open now, with no movement record on that shift; the shift summary's cash-in/out lines no longer add up to its expected cash [Verified: reversal logic]. (b) After an uncounted forced close and before the next count, a custodian may transfer cash in/out of the drawer; the later difference is still charged to the forced shift [Verified by reading]. (c) Manager drops/top-ups during a shift are mirrored as movements (good) but require no cashier acknowledgement.
- **Potential financial impact:** A cashier can be shown short or over for cash they never handled; disputes cannot be settled from the records.
- **Affected procedures:** BP-407, BP-409, BP-414.
- **Recommendation:** Block reversals into a drawer while a shift other than the original is open (reverse into the treasury instead, or require the current cashier to confirm receipt and write a movement on their shift); block custody transfers on a drawer flagged "needs count" until it is counted.

#### FND-410 Differences on branch transfers are absorbed by the company without an accountable party
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** The receiving custodian records what arrived; any difference is posted on the in-transit account with a note and the transfer shows it, but no custodian, courier or follow-up status exists; receiving 0.000 is allowed [Verified by test and schema].
- **Potential financial impact:** Cash lost between branches reduces company cash with a note as the only trace; repeated shortages on one route are not reported by route or carrier.
- **Affected procedures:** BP-415.
- **Recommendation:** Record the carrier/custodian on sending, require sender acknowledgement of a receipt difference (two-sided sign-off), add a "disputed" state and include transit differences in the difference review of FND-404.

#### FND-411 Period cut-off is inconsistent across lists and reports, and statements have no period
- **Classification:** Inconsistency (behaviour vs behaviour)
- **Severity:** Medium
- **Evidence:** The disbursements list filters on UTC calendar days while the expenses report uses the company time zone [Verified: list uses plain date comparison; reports use "at time zone"]. Shift list uses opening time, discrepancy totals use closing time, between-shifts uses opening time and after-uncounted uses the time found [Verified]. Cash statements are paged newest-first with no date range and no opening/closing balance per period [Verified].
- **Potential financial impact:** Month-end figures differ between screens for entries near midnight (Kuwait is UTC+3, so evening entries fall on different days); a period cash statement with opening and closing balance — the basic audit document — cannot be produced.
- **Affected procedures:** BP-417.
- **Recommendation:** Use the company time zone everywhere; add date range, opening balance, movements and closing balance to statements (per place and per branch) and an export; document which timestamp defines the period for each report.

#### FND-412 A fee on the cash method is counted in fee totals but posted nowhere
- **Classification:** Inconsistency (behaviour vs behaviour)
- **Severity:** Low
- **Evidence:** Payment settings allow a fee rule on the cash method; checkout computes and stores the fee on the cash payment and in the sale's fee total; the ledger posting skips the fee for cash [Verified]. The payments report sums fees from payment records.
- **Potential financial impact:** Misconfiguration would show "fees" and "net after fees" that reduce nothing anywhere.
- **Affected procedures:** BP-401, BP-416.
- **Recommendation:** Refuse a fee rule on the cash method (or force it to none) and state in BR-071 that fees apply to non-cash methods only.

#### FND-413 Processing fees are configured estimates, not settled amounts, and are not reconciled to the acquirer
- **Classification:** Owner decision to revisit
- **Severity:** Medium
- **Evidence:** Fees come from the owner-entered rule at payment time (OQ-026: real rates still to be entered); they are frozen on the payment and reduce the bank book balance immediately; they are not reversed on refunds (OQ-016); no acquirer settlement import or comparison exists [Verified]. Defaults are no fee.
- **Potential financial impact:** Bank book balances and "net after fees" diverge from reality by the difference between estimated and actual fees, VAT on fees, chargebacks and settlement timing.
- **Affected procedures:** BP-401, BP-416.
- **Recommendation:** Treat the configured fee as an estimate in report labels; add an acquirer-settlement reconciliation (batch total, actual fee, settlement date) once a terminal/gateway is integrated (OQ-013); decide OQ-016 and OQ-026.

#### FND-414 Accounts can be deactivated with a balance and keep receiving postings
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** A bank/other account can be set inactive regardless of balance; a method linked to it is not relinked and checkout does not check the account's status; only archived accounts refuse entries at database level [Verified].
- **Potential financial impact:** Money settles into an account management considers closed; its balance is still listed, so the error is visible but not prevented.
- **Affected procedures:** BP-401, BP-402, BP-416.
- **Recommendation:** Refuse deactivation while methods are linked or the balance is non-zero; refuse checkout with a method whose account is inactive.

#### FND-415 Documentation and configuration remnants out of step with behaviour
- **Classification:** Inconsistency (doc vs behaviour)
- **Severity:** Low
- **Evidence:** ADR-0089 and PROGRESS (2026-10-12 entry) say new companies get a "Cash on hand" account; since ADR-0090 only two bank accounts are created and cash settles in drawers [Verified by test]. PROGRESS lists "cash-to-bank transfers" as open under OQ-026; they are implemented (BP-411). The register's "default opening float" is configurable and displayed but unused since opening became a count [Verified]. The permission catalogue describes the custody right as "treasury counts, transfers" although it also grants disbursements, reversals, statements and branch transfers [Verified].
- **Potential financial impact:** None directly; misleads owners configuring registers and reviewers reading the ADRs.
- **Affected procedures:** BP-401, BP-403, BP-404.
- **Recommendation:** Amend ADR-0089's text and PROGRESS; remove or repurpose the default opening float; update the right's description.

#### FND-416 Weak segregation of duties around the register
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** The Branch Manager template holds "Configure registers" (set tolerance, restrict members, force-close with own count = "verified" close) and "Monitor all shifts", and by default has no "Financial reports"; when the owner grants custody to the same person they also count idle drawers, pay from and count the treasury, and reverse disbursements, with no second approval anywhere [Verified: templates and services]. The owner is the only built-in independent reviewer.
- **Potential financial impact:** One person can set a generous tolerance, close shifts with their own count and adjust the treasury by count; in a small company this may be accepted, but no compensating review exists in the system.
- **Affected procedures:** BP-404, BP-409, BP-410, BP-414.
- **Recommendation:** Separate "set tolerance" from "configure registers" (owner-only by default); flag in the discrepancy report shifts force-closed with a count by the same user who set the register's tolerance or counted the treasury the same day; add the approval queue of FND-408.

#### FND-417 Treasury of a deactivated branch keeps cash with no restriction
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** Branch deactivation checks only that the branch is not the main one; it does not check open shifts, drawer balances or the treasury balance; the treasury stays active and still counts in company cash [Verified: branches service; register deactivation does enforce a zero drawer].
- **Potential financial impact:** Cash recorded at a closed branch may be forgotten; sending it onward is still possible, so this is housekeeping.
- **Affected procedures:** BP-404, BP-415.
- **Recommendation:** Require zero drawers and treasury (or an outgoing branch transfer) and no open shift before deactivating a branch.

#### FND-418 Management counts have no denomination breakdown in the screen
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** The API accepts a breakdown on treasury and idle-drawer counts, but the management count dialog offers only a typed total [Verified: screen]; the POS offers a notes-and-coins grid.
- **Potential financial impact:** Treasury counts (the largest cash places) have less evidential support than drawer counts.
- **Affected procedures:** BP-410.
- **Recommendation:** Add the denomination grid to the management count dialog and print/export the count sheet.

#### FND-419 Manager cash moves during a shift need no cashier acknowledgement
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** A custodian may drop or top-up a drawer while the cashier's shift is open; the move is mirrored as a movement bearing the manager's name on the cashier's shift [Verified by test]; the cashier is not asked to confirm handing over or receiving the cash.
- **Potential financial impact:** Disputes over mid-shift pickups rest on the manager's record alone.
- **Affected procedures:** BP-407.
- **Recommendation:** Show a confirmation prompt on the till ("manager X took 4.000 from your drawer — confirm") recorded on the movement; until then, require the note field for manager moves on open shifts.

#### FND-420 Expense evidence is a free-text reference; categories are fixed
- **Classification:** Missing process
- **Severity:** Low
- **Evidence:** Receipt reference is optional free text; no attachment, no vendor name for expenses, no cost centre beyond branch; the seven categories are fixed in the database [Verified].
- **Potential financial impact:** Expense substantiation for audit and for any future VAT recovery is weak; reporting by project or cost centre is impossible.
- **Affected procedures:** BP-412.
- **Recommendation:** Allow a receipt image through the file storage, make the reference mandatory above a threshold, and allow owner-defined sub-categories.

#### FND-421 Idle-drawer count adjustments carry a generated reference, not a document
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** A later count of a drawer without an open shift books its difference with a random reference (it references the shift only when it follows an uncounted forced close); treasury counts likewise have no document number; traceability depends on the audit log and the statement description [Verified].
- **Potential financial impact:** Auditors cannot cite a count by number; linking a count to its breakdown and note requires the audit log.
- **Affected procedures:** BP-410.
- **Recommendation:** Create a numbered count document (e.g. a "CN-" series) holding place, expected, counted, breakdown, note and counter, referenced by the ledger entry.

#### FND-422 The custody right is too coarse
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** One branch-scoped right covers viewing balances and statements, transferring, counting, paying expenses and suppliers from the treasury, reversing any disbursement (including those recorded by others at the till) and sending/receiving/cancelling branch transfers [Verified: controllers and services]. Only bank deposits have a separate right.
- **Potential financial impact:** Granting read access to the cash position necessarily grants the power to move and pay cash and to undo payments; least-privilege assignment is impossible.
- **Affected procedures:** BP-407, BP-410, BP-412–415, BP-417.
- **Recommendation:** Split into at least: view cash (overview/statements), move cash (transfers, counts), pay cash (disbursements), reverse/approve (reversals and approvals), inter-branch; keep the existing right as the union for backward compatibility.

### D.5 Documented owner decisions touching this domain

| Id | Decision (one line) | Residual risk (one line) |
|---|---|---|
| BR-070 / ADR-0089 | Each company configures its own methods; defaults Cash, KNET, Visa/MC, payment link, WAMD, no fees | Real fee rates and settlement accounts still to be entered (OQ-026); ADR text mentions a cash account no longer created |
| BR-071 | Fee = none / fixed / % / fixed + %, half-up to the fils, never more than the payment | Estimate only; not reconciled to acquirer; applies even to cash if configured (FND-412) |
| BR-072 | Registers open to the branch or restricted to listed employees; one register per branch at start | None material |
| BR-073 | One employee per register, one open shift per employee, only the owner of the shift uses it; managers force-close with a note | Manager's own count counts as verified (FND-416) |
| BR-074 | Closing records expected, counted (optionally by denomination), difference; tolerance → balanced/over/short; closed shifts never change | Tolerance unlimited and self-set (FND-403); no note on shortage (FND-402) |
| BR-075 | Cash in/out needs a reason, "other" needs a note, cannot exceed drawer; drop/top-up are transfers; change swap moves nothing | Corrections/other leave custody with no destination (FND-407) |
| BR-076 / ADR-0090 | One cash ledger for drawers, treasuries (and in transit); cash sales/refunds hit only the shift's drawer; non-cash go to bank minus fee; transfers never revenue/expense; no overdraft; treasury pays out only after first count; owner rejected a clearing account | Bank book balances unreconciled (FND-406) |
| BR-077 | Opening = count; difference is between shifts (note beyond tolerance), never charged to the opener; first count = opening balance; closing difference booked on the shift, shown by name, never deducted automatically; cash stays in drawer | No settlement workflow (FND-404); opening counts unsourced (FND-405); not blind (FND-401, OQ-015) |
| BR-078 | Force-close with count = verified; without count = nothing booked, drawer needs count, later difference charged to the forced shift; custody holders may count idle drawers and treasuries | Book balance may move before the count (FND-409) |
| BR-079 | Cutover keeps history: old cash account archived, new places start at zero and are set by count; cash in/out removed from cashiers (supervisors keep it) | Archived balance vs opening counts unexplained (FND-405); supervisors can still remove cash by "correction" (FND-407) |
| BR-086 | Every non-cash payment settles into a bank account with its fee; cash into the drawer; two default banks | As BR-071/076 |
| BR-087 / ADR-0091 | Expenses (fixed categories) and supplier payments are real outflows with EX-/SP- numbers, from drawer (cash move) or treasury (custody); corrected only by reversal with reason; no payables yet | No limits/approvals (FND-408); reversal timing (FND-409) |
| BR-088 | Bank deposits are transfers needing the extra deposit right; reduce company cash | No deposit-in-transit or confirmation (FND-406) |
| BR-089 | Inter-branch cash goes through in transit; receiver confirms count, difference booked on the transfer with a note; sender may cancel before receipt; received/cancelled once | Transit differences unowned (FND-410) |
| BR-125 / OQ-016 | Fees stored per payment from the method's rule; not reversed on refunds | Fee totals may overstate cost on refunded sales |
| BR-126 / ADR-0092 | Shift difference = counted − expected; uncounted forced closes are neither balanced nor a difference; report shows between-shifts and after-uncounted differences | Mixed period bases (FND-411) |
| BR-126a | Cash by type and expenses report read the ledger; dashboard total cash for custody holders | Statements lack period framing (FND-411) |
| OQ-003 | Cash rounding to 0.005 KWD undecided | Counts in 5-fils coins may never match fils-exact expected cash; small permanent differences |
| OQ-013 | Card terminals not integrated; card amounts entered manually | Card settlements unverifiable in the system (FND-406/413) |
| OQ-015 | Blind closing undecided; expected is shown | FND-401 |
| OQ-026 | Actual fees per method and settlement bank undecided; defaults no fee | FND-413 |

### D.6 Technical mapping (appendix)

| BP id | Permission keys | Main tables | Screens / routes | Document number prefix |
|---|---|---|---|---|
| BP-401 | `payments.settings` (merchant); POS list: `sales.create` | `payment_methods`, `financial_accounts`, `audit_log` | manager-web `features/cash/PaymentsPage.tsx`; API `GET/POST/PATCH /manager/payment-methods`, `GET /pos/payment-methods` | — |
| BP-402 | `payments.settings` | `financial_accounts`, `financial_account_entries` | `PaymentsPage.tsx` (accounts tab, menu `/accounts`); `GET/POST/PATCH /manager/financial-accounts` | — |
| BP-403 | system; `branches.manage`; `registers.manage` | `financial_accounts` (kinds `register`, `treasury`, `in_transit`, `bank`), `payment_methods`, `registers` | `merchants/provision.ts`, `branches.service.ts`, `merchant-defaults.ts`; seeds `003-payment-defaults`, `004-payment-setup` | — |
| BP-404 | `registers.manage` (branch) | `registers`, `register_members`, `financial_accounts` | `RegistersPage.tsx`; `GET/POST/PATCH /manager/registers`, `POST /manager/registers/:id/status` | — |
| BP-405 | `shifts.operate` (branch, POS session) | `shifts` (`opening_*` columns, `opening_follows_shift_id`, `opening_is_initial`), `financial_account_entries` (`shift_open`, `register_initial_count`), `registers.needs_count` | pos-web `pages/ShiftPages.tsx` (`OpenShiftPage`); `GET /pos/registers`, `POST /pos/shifts`, `GET /pos/shifts/current` | — |
| BP-406 | `cash.move` (branch) | `cash_movements` (reasons `correction`, `other`, `change_received`), `financial_account_entries` (`cash_movement`/`adjustment`) | `ShiftPages.tsx` (`MovementDialog`); `POST /pos/shifts/current/cash-movements` | — |
| BP-407 | POS: `cash.move`; manager: `cash.custody` (branch) | `cash_transfers` (origin `pos_movement` / `manager`), `financial_account_entries` (`transfer`), `cash_movements` (`safe_drop`, `float_top_up`) | `ShiftPages.tsx`; `CashCustodyPage.tsx` (transfer dialog); `POST /manager/cash/transfers`, `GET /manager/cash/transfers` | — |
| BP-408 | `shifts.operate` | `shifts` (`close_type = normal`, `discrepancy_tolerance_minor`, `counted_breakdown`), `financial_account_entries` (`shift_close`) | `ShiftPages.tsx` (`CloseDialog`, `ClosedResult`); `POST /pos/shifts/current/close` | — |
| BP-409 | `registers.manage` (branch) | `shifts` (`close_type = forced` / `forced_uncounted`), `registers.needs_count` | `ShiftsPage.tsx` (force-close dialog); `POST /manager/shifts/:id/force-close` | — |
| BP-410 | `cash.custody` (branch) | `financial_account_entries` (`treasury_opening_count`, `treasury_count`, `register_initial_count`, `register_count`), `financial_accounts.counted_at`, `registers.needs_count` | `CashCustodyPage.tsx` (`CountDialog`); `POST /manager/cash/accounts/:id/counts` | — |
| BP-411 | POS: `cash.move` + `cash.deposit`; manager: `cash.deposit` (branch) | `cash_transfers` (origin `deposit` / `pos_movement`, `reference`), `cash_movements.bank_account_id` | `ShiftPages.tsx` (reason `bank_deposit`), `CashPayouts.tsx` (deposit dialog); `POST /manager/cash/deposits`, `GET /manager/cash/bank-accounts`, `GET /pos/cash/bank-accounts` | — |
| BP-412 | POS: `cash.move`; manager: `cash.custody` | `cash_disbursements` (kind `expense`, `category`), `financial_account_entries` (`expense`), `document_sequences` (`cash_expense`) | `ShiftPages.tsx` (reason `petty_expense`), `CashPayouts.tsx`; `POST /manager/cash/disbursements`, `GET /manager/cash/disbursements` | `EX-` |
| BP-413 | POS: `cash.move`; manager: `cash.custody`; supplier page: `purchasing.read` | `cash_disbursements` (kind `supplier_payment`, `supplier_id`, `purchase_order_id`), `financial_account_entries` (`supplier_payment`) | `ShiftPages.tsx` (reason `supplier_payment`), `CashPayouts.tsx`; `GET /manager/cash/suppliers`, `GET /manager/cash/suppliers/:id/orders`, `GET /manager/suppliers/:id/payments`, `GET /pos/cash/suppliers` | `SP-` |
| BP-414 | `cash.custody` (branch of original) | `cash_disbursements.reverses_id` (unique), trigger `cash_disbursements_guard` | `CashPayouts.tsx` (`ReverseDialog`); `POST /manager/cash/disbursements/:id/reverse` | `EX-` / `SP-` (reversal gets its own number) |
| BP-415 | `cash.custody` at sending (send/cancel) and receiving (receive) branch | `cash_branch_transfers` (status `in_transit` → `received` / `cancelled`), `cash_transfers` (origin `branch_transfer`), `financial_account_entries` (`branch_transfer_difference`), `document_sequences` (`cash_branch_transfer`) | `CashPayouts.tsx` (branch transfers); `POST /manager/cash/branch-transfers`, `/:id/receive`, `/:id/cancel`, `GET /manager/cash/branch-transfers` | `CT-` |
| BP-416 | `sales.create`, `refunds.create` (Sales/Refunds domains) | `payments` (`fee_minor`, `financial_account_id`, `shift_id`), `refund_payments`, `financial_account_entries` (`payment`, `fee`, `refund`) | `sales.service.ts`, `refunds.service.ts`, `packages/money/src/fees.ts` | receipt / refund numbers (other domains) |
| BP-417 | `cash.custody`, `shifts.view_all`, `reports.financial` (all branch-scoped) | all of the above (read) | `CashCustodyPage.tsx` (overview, `StatementDialog`), `ShiftsPage.tsx`, `DashboardPage.tsx` card; `GET /manager/cash/overview`, `GET /manager/cash/accounts/:id/entries`, `GET /manager/shifts`, `GET /manager/shifts/:id`, `GET /manager/shifts/discrepancies`, `GET /manager/reports/payments` (`custody`), `GET /manager/reports/expenses`, `GET /manager/reports/shifts` | — |
| BP-418 | system (migration `0033`) | `financial_accounts` (archived legacy `cash`), `shifts.legacy_open`, `registers.needs_count`, `role_permissions`, `audit_log` (`cash.cutover`, `role.permissions_changed`) | function `cash_custody_cutover` | — |

Database immutability rules relied on above [Verified in migrations 0011, 0033, 0035]: no update/delete on `financial_account_entries`, `cash_movements`, `cash_transfers`, `cash_disbursements` for the application role; no delete on `financial_accounts`, `payment_methods`, `registers`, `shifts`, `cash_branch_transfers`; trigger `shifts_closed_is_final`; trigger `financial_account_entries_guard` (archived accounts refuse entries; drawer entries must carry the open shift); trigger `cash_transfers_direction`; deferred constraint triggers `cash_transfers_balanced` and `cash_disbursements_posted`; trigger `cash_branch_transfers_forward`; row-level security by company on every table; `audit_log` append-only.

---

## Chapter E: Returns, refunds, exchanges, voids; and management reporting

### E.0 Scope and sources reviewed

- **Business purpose.** This domain covers everything that reverses or corrects a completed sale after
  the customer has paid — returns of goods with a refund of money, cancellation (void) of a sale
  made during the cashier's current shift, exchanges of goods, the approval of restricted refunds,
  the pay-back of money per original tender, the decision to put goods back in stock, and the refund
  receipt — together with the management reports that owners, managers and an external accountant
  rely on to understand sales, refunds, collections, fees, cash, shifts, expenses, stock and
  purchasing for a period. The domain therefore determines (a) whether money can leave the business
  through refunds without authority or trace, (b) whether stock and revenue stay consistent after a
  return, and (c) whether the figures presented to management reconcile to the underlying documents
  and are adequate for closing a period.
- **Files and screens reviewed (technical names allowed here).** Backend: `apps/api/src/modules/refunds/`
  (`refunds.service.ts`, `refunds.schema.ts`, `refunds.controller.ts`, `refunds.int.test.ts`),
  `apps/api/src/modules/reports/` (`reports.service.ts`, `reports.controller.ts`,
  `reports.int.test.ts`), `apps/api/src/modules/cash/cash-reports.int.test.ts`; the parts of
  `sales.service.ts` / `sales.schema.ts` that define refund policy settings, cost at time of sale and
  "refunded" figures on sales; the parts of `registers/shifts.service.ts` that compute drawer cash and
  the discrepancy report; `inventory/stock-ledger.service.ts` and `inventory/consumption.ts` for
  restock cost; migrations `0015_refunds.sql`, `0016_refunds_rls.sql`, `0017_refund_zero_total.sql`,
  `0022_report_indexes.sql`; `packages/contracts/src/refunds.ts`, `reports.ts`;
  `packages/permissions/src/catalog.ts`, `templates.ts`. Screens: POS `apps/pos-web/src/sale/ReturnsPage.tsx`;
  manager `features/refunds/RefundsPage.tsx`, `features/reports/{ReportsPage,OtherReports,shared}.tsx`,
  `features/dashboard/DashboardPage.tsx`, `features/sales/SalesPage.tsx` (refund policy fields) and the
  English definition strings in `apps/manager-web/src/i18n/en.ts`. Documentation used for orientation:
  `docs/BUSINESS_RULES.md` (BR-034/035, BR-090…095, BR-120…129, OQ-016/017), `docs/DECISIONS.md`
  (ADR-0056…0060, ADR-0068…0071, ADR-0090…0092), `docs/PROGRESS.md`, `docs/ROUTES.md`, `docs/AUTH.md`.
- **Coverage statement.** I did not execute the application or its tests; all statements rest on
  reading code, schema, migrations and test expectations. I did not review the end-to-end browser test
  (`e2e/refunds.spec.ts`) beyond its title, nor the customer-facing storefront's refund wording. The cash
  custody mechanics themselves (drawers, treasuries, deposits, disbursements) belong to another domain;
  I reviewed them only as far as the payments/cash, expenses and discrepancy reports read them. Gateway
  integration code was examined only to establish whether a gateway refund can ever be confirmed.

### E.1 Roles and authority matrix

Permissions are branch-scoped unless stated: the user must hold the permission **at the branch of the
sale / refund** (or merchant-wide). The owner implicitly holds every permission. All POS write
operations additionally require the actor to be bound to a branch (a POS session) and to have an
**open shift of their own**. Platform operator roles are a separate identity realm and can perform
none of these operations [Verified: no platform route in either controller; Inferred for the realm
separation itself, which is documented in the architecture rules].

| Operation | Permission (plain words) | Owner | Company Manager | Branch Manager | Supervisor | Cashier | Kitchen |
|---|---|---|---|---|---|---|---|
| Look up a receipt, preview a refund, request/perform a refund, print a refund receipt, withdraw own pending request (POS) | "Process returns and refunds" | yes | no (no POS access by default) | no (no POS access by default) | yes | yes | no |
| Perform an exchange (POS) | "Process returns and refunds" **and** "Create sales" | yes | no | no | yes | yes | no |
| Void (cancel) a sale of the own open shift (POS) | "Cancel an open or same-shift sale" | yes | no | no | yes | **no** | no |
| Approve a pending refund at the till (POS) | "Approve restricted refunds" | yes | no | no | yes | no | no |
| Approve or reject a pending refund in the manager app | "Approve restricted refunds" + manager access | yes | yes | yes (own branches) | no (no manager access) | no | no |
| Withdraw (cancel) another person's pending request | "Approve restricted refunds" | yes | yes* | yes* | yes | no | no |
| Perform a refund above the limit or outside the window **without** approval | holding "Approve restricted refunds" at the branch | yes | n/a (no POS) | n/a (no POS) | **yes** | no | no |
| View refund history, refund detail, unusual-activity report (manager) | "View sales" + manager access | yes | yes | yes (own branches) | no (has "View sales" but no manager access) | no | no |
| View a customer's refund history | "View customers" | yes | yes | yes | (POS only) | (POS only) | no |
| Set return window and refund approval limit | "Update company settings" (merchant-wide) | yes | yes | no | no | no | no |
| Sales report (incl. refunds, breakdowns) | "Sales reports" | yes | yes | yes (own branches) | no | no | no |
| Gross profit inside the sales report | "Payments, cash and financial reports" **for every branch in the report** | yes | yes | no | no | no | no |
| Payments & cash report, expenses report, shifts report | "Payments, cash and financial reports" | yes | yes | **no** | no | no | no |
| Inventory report, purchasing report | "Inventory reports and valuation" | yes | yes | yes (own branches) | no | no | no |
| Shift discrepancy report (manager) | "View all shifts" + manager access | yes | yes | yes | no (no manager access) | no | no |
| Dashboard total-cash card | "Cash custody" | yes | no (not in default template) | no | no | no | no |
| CSV export of any report table | same permission as the report (browser-side export) | as above | as above | as above | — | — | — |

\* The withdraw endpoint exists only on the POS path, so a manager without a POS session cannot in
practice withdraw a request; they reject it instead [Verified].

Branch scoping [Verified]: a branch manager of branch B receives 403 when approving a refund of branch A
and when asking for a report filtered to branch A; without a branch filter, reports and refund lists
are automatically restricted to the branches where the permission is held; a POS user only ever sees
sales of the branch their session is bound to.

### E.2 Procedures

#### BP-501 Receipt lookup and refund eligibility check (POS)
- **Business purpose:** Find the original sale a customer wants to return against and show the staff
  member what can still be returned, what was already returned, whether the return is inside the
  policy window and whether the sale may still be cancelled outright.
- **Actors and required authority:** POS user holding "Process returns and refunds" at the bound
  branch (Cashier, Supervisor, Owner).
- **Trigger / inputs:** The receipt number typed or scanned, or one of the cashier's recent sales
  chosen from a shortcut list on the returns screen.
- **Normal flow:**
  1. The staff member enters the receipt number (case-insensitive, trimmed). [Verified]
  2. The system searches only the sales of the **branch of the current POS session**; a sale of
     another branch answers "no sale with this receipt number at this branch". [Verified] (OQ-017:
     returns are same-branch only.)
  3. The system shows: receipt number, date/time of sale, cashier who sold, total, amount already
     refunded, amount still refundable; per line the quantity sold, already returned, still
     returnable, the line's net value and whether the item is inventory-tracked; per original payment
     the amount paid, already refunded and still refundable; a flag "within return window"; a flag
     "voidable" (true only if the sale belongs to the **viewer's own open shift** and has no active
     refund). [Verified]
  4. "Already refunded" and "refundable" at this stage include **pending and processing** refunds,
     not only completed ones, so quantities reserved by a waiting request cannot be requested twice.
     [Verified]
- **Exceptional cases and their handling:**
  - Receipt not found at this branch → refusal; no cross-branch lookup. [Verified]
  - User without a bound branch (not a POS session) → forbidden. [Verified]
  - The lookup records nothing; it is read-only. [Verified]
  - No customer identification, ID check or proof of purchase other than knowing the receipt number is
    required [Verified]; recent sales of the branch are offered as buttons, so a receipt number is not
    even needed for recent sales [Verified].
- **Existing controls:**
  - CTL-501 Branch confinement of lookup (same branch as the sale). [Verified]
  - CTL-502 Reserved quantities (pending/processing) are deducted from what is shown as refundable.
    [Verified]
  - CTL-503 Return-window flag computed from the merchant's configured window. [Verified]
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** A completed sale (Sales domain); refund policy settings (BP-513); the
  staff member's open POS shift for later steps.
- **Downstream effects:** BP-502…BP-508.
- **Observations:** FND-503 (no customer verification), FND-511 (presentation of "refunded" differs
  between POS and manager).

#### BP-502 Refund preview (amount computation and suggested pay-back)
- **Business purpose:** Tell the staff member, before anything is recorded, exactly how much will be
  refunded for the chosen quantities, how it will be split over the original tenders, and whether a
  supervisor's approval will be required.
- **Actors and required authority:** As BP-501.
- **Trigger / inputs:** Sale, list of lines with the quantity to return (optionally the restock flag).
- **Normal flow:**
  1. The system recomputes the sale's state under the merchant's isolation and checks the sale belongs
     to the session's branch. [Verified]
  2. For each chosen line the refund amount is the **paid net value of the units**: the line's net
     amount (after item and sale discounts) × (already refunded quantity + requested quantity) ÷ sold
     quantity, rounded half-up, minus what was already refunded on that line. The cumulative method
     guarantees that partial refunds of all units add up exactly to the line's net amount (e.g. three
     refunds of one unit of a 0.999 line give 0.333 + 0.333 + 0.333). [Verified; ADR-0057]
  3. The refund total is the sum of the line amounts (always ≤ the sale total). [Verified]
  4. Suggested pay-back: proportional to what each original payment can still refund, using
     largest-remainder allocation so the parts sum exactly; payments already fully refunded are
     skipped. [Verified; ADR-0058]
  5. Approval required? Only for actors who **do not** hold "Approve restricted refunds" at the branch:
     reason "over limit" when total > the merchant's refund approval limit (default 20.000 KWD),
     reason "outside window" when the sale is older than the return window (default 30 days,
     measured in fractional days from the sale timestamp to now). [Verified; ADR-0059]
- **Exceptional cases and their handling:**
  - A line position not on the sale → validation error. Quantity ≤ 0 → refusal. Quantity above the
    still-returnable quantity (sold − active refunds) → refusal "more than was sold (or already
    refunded)", stating the returnable quantity. [Verified]
  - Quantities are accepted to three decimals (weighed goods). [Verified]
  - The preview is recalculated live on the POS screen as quantities change. [Verified]
- **Existing controls:**
  - CTL-504 Refund amount derived from the sale's own recorded net line values; the cashier cannot
    type a refund amount. [Verified]
  - CTL-505 Exact integer arithmetic with cumulative rounding. [Verified]
- **Financial / stock / cash effect:** None (read-only).
- **Upstream dependencies:** BP-501.
- **Downstream effects:** BP-503, BP-508.
- **Observations:** none specific.

#### BP-503 Return and refund request (full, partial, by quantity)
- **Business purpose:** Record the return of goods against an original sale, reduce what can still be
  refunded on that sale, pay the customer back and (optionally) put the goods back in stock — as a new,
  immutable document that never alters the sale.
- **Actors and required authority:** POS user with "Process returns and refunds" at the branch and an
  **open shift of their own**.
- **Trigger / inputs:** Sale, lines (quantity, restock yes/no), reason (changed mind, defective, wrong
  item, damaged, price adjustment, other — "other" requires a note), optional note (≤ 500 chars),
  optional explicit pay-back allocation (payment id, amount, optional reference per tender, ≤ 10),
  a client-generated idempotency key.
- **Normal flow:**
  1. The system checks permission and the bound branch, then looks for an earlier request with the
     same idempotency key: if found with the same content, the earlier refund is returned unchanged
     (duplicate protection); if found with different content, the request is refused as a key
     conflict. [Verified]
  2. In one database transaction: the requester's own open shift is locked; the sale is serialised
     with an advisory lock so that concurrent requests on the same sale queue behind one another; the
     sale state (including reservations by pending requests) is re-read. [Verified; ADR-0056]
  3. Amounts are computed as in BP-502; the pay-back allocation is validated (BP-504). [Verified]
  4. Approval reasons are evaluated (BP-502 step 5). A refund document is inserted with a refund number
     = original receipt number + "-R" + sequence number per sale (the sequence counts every earlier
     refund of that sale, including rejected and cancelled ones), kind "refund", status
     "pending approval" (if reasons exist) or "processing", the reason/note, total, the approval
     reasons and the idempotency key and request fingerprint. Lines are stored with quantity, amount,
     the effective restock flag (requested flag **and** item is inventory-tracked) and the unit cost
     the item was sold with. [Verified]
  5. The planned pay-back rows are stored as "pending" per tender, carrying the tender kind, method
     name snapshot, the requester's shift and the verification type (gateway if the original payment
     was gateway-verified, otherwise manual). [Verified]
  6. If no approval is needed the refund is executed immediately (BP-504 settlement + BP-505 restock)
     and the status becomes "completed" (or stays "processing" when a gateway tender is involved,
     BP-509). The completion timestamp is set. [Verified]
  7. An audit entry "refund requested" or "refund completed" is written with sale id, total and
     approval reasons. [Verified]
  8. The POS shows a refund receipt dialog (print disabled while pending). [Verified]
- **Exceptional cases and their handling:**
  - No open shift → refusal "the cash refund needs the requesting cashier's open shift" (the check
    happens even when nothing is paid in cash, because the shift lock is the first step). [Verified
    by test: a hired cashier without a shift is refused.]
  - Drawer cannot cover the cash part → refusal, nothing recorded. [Verified]
  - Four identical simultaneous requests → one refund, same id returned to all. [Verified]
  - Two cashiers racing for the last returnable unit → exactly one succeeds, the others are refused as
    exceeding the sale; totals stay exact. [Verified]
  - Same line listed twice in one request → validation error. [Verified]
  - A sale belonging to another branch than the session → "sale not found". [Verified]
  - Refund of zero value is permitted by the schema (total ≥ 0) [Verified: migration 0017 relaxed
    the constraint]; this arises for fully discounted lines.
  - After a rejected or withdrawn request the quantities become returnable again. [Verified]
- **Existing controls:**
  - CTL-506 Idempotency key + content fingerprint: duplicates are replayed, mismatches refused.
    [Verified]
  - CTL-507 Per-sale serialisation (advisory lock) and per-tender/per-line reservation by active
    refunds: no combination of requests can exceed the sale. [Verified]
  - CTL-508 Own open shift required for every refund write. [Verified]
  - CTL-509 Reason mandatory from a closed list; free-text note mandatory for "other". [Verified]
  - CTL-510 Append-only records: the refund document cannot be deleted; its total and sale link are
    immutable; a refund in a final state (completed, rejected, cancelled) cannot be updated at all;
    refund lines cannot be updated or deleted; a settled pay-back row cannot change (database
    triggers and revoked privileges, confirmed by a test that attempts each forbidden statement).
    [Verified]
  - CTL-511 Audit trail of request/completion with actor, IP and details. [Verified]
- **Financial / stock / cash effect:** A new refund document; the sale's derived "refunded" and
  "refundable" figures change; on execution the cash drawer of the requester (cash part), the bank /
  internal account of the original tender (card or transfer part), and stock on hand and average cost
  for restocked lines (BP-505). The original sale, its lines and payments are untouched. Processing
  fees of the original payment are **not** reversed (OQ-016).
- **Upstream dependencies:** Completed sale; open shift; refund policy; payment methods' financial
  accounts.
- **Downstream effects:** Shift drawer expected cash (Cash custody); sales list/detail "refunded" and
  "net" figures (Sales); customer refund history (Customers); sales, payments, inventory reports
  (BP-514, BP-516, BP-519); unusual activity (BP-512).
- **Observations:** FND-502, FND-503, FND-506, FND-507, FND-515.

#### BP-504 Pay-back allocation per original tender and settlement
- **Business purpose:** Return money the way it was received — never more than each tender took —
  and move the cash out of the right drawer or the card/transfer money out of the right account.
- **Actors and required authority:** The requester (BP-503) chooses the allocation; settlement is
  performed by the system at completion or at approval.
- **Trigger / inputs:** Refund total; optional custom allocation.
- **Normal flow:**
  1. Default allocation = proportional to each original payment's remaining refundable amount
     (BP-502 step 4). [Verified]
  2. Custom allocation: each entry must name a payment of this sale, appear only once, be > 0 and ≤
     that payment's remaining refundable amount, and the entries must sum exactly to the refund total.
     [Verified]
  3. If the original tender was itself an **exchange credit** (the sale being refunded was paid with
     credit from an earlier return), that part is paid back **in cash** from the drawer. [Verified;
     ADR-0058]
  4. Settlement (immediately, or at approval): all manual tenders are marked "succeeded" at once;
     cash: a negative entry is posted to the drawer of the **requester's shift register** (whichever
     register took the sale), tagged with the refund number and the refund payment as source;
     card/transfer/custom: a negative entry is posted to the financial account of the original payment
     if it has one; if the original payment has no financial account, nothing is posted. Gateway
     tenders are left "pending" (BP-509). [Verified]
  5. Before posting cash, the system re-checks that the requester's shift is still open and that the
     drawer's current ledger balance covers the cash part. [Verified]
- **Exceptional cases and their handling:**
  - Allocation above one tender, not adding up, or naming a foreign payment → refusal with the
    remaining refundable amount of that tender in the message. [Verified]
  - A reference (e.g. terminal reversal number) is optional for card tenders. [Verified]
  - Exchanges and voids use the proportional default only; no custom allocation. [Verified]
- **Existing controls:**
  - CTL-512 Per-tender ceiling: the sum of pay-backs on a payment can never exceed that payment.
    [Verified]
  - CTL-513 Drawer sufficiency check against the cash ledger balance at settlement time. [Verified]
  - CTL-514 Cash leaves only through the cash ledger (single posting path). [Verified]
- **Financial / stock / cash effect:** Drawer balance −cash part (and the shift's expected cash falls
  by the same amount); bank/internal account −card part; fee entries unchanged.
- **Upstream dependencies:** Original payments with their accounts (Payments); open shift.
- **Downstream effects:** Shift close expected cash; payments & cash report "paid back", "cash
  refunds", "cash by type"; shifts report cash refunds per shift.
- **Observations:** FND-504, FND-505, FND-506.

#### BP-505 Restock decision and stock effect
- **Business purpose:** Return sellable goods to stock at the cost they left with; keep damaged or
  consumed goods out of sellable stock.
- **Actors and required authority:** The requester decides per line (checkbox, default **on**); the
  system applies it at completion/approval.
- **Trigger / inputs:** Restock flag per returned line.
- **Normal flow:**
  1. The effective flag is "requested **and** item is inventory-tracked"; non-tracked items (services,
     recipe dishes) are never restocked. [Verified]
  2. On execution, a stock movement of type "refund" (reason = refund/void/exchange, source = the
     refund) adds the quantity at the **unit cost recorded on the sale line** (the weighted-average
     cost at the time of sale for tracked items, or the catalogue cost for untracked recipe owners);
     the branch's weighted-average cost is recomputed with that cost. If the sold cost is unknown the
     ledger falls back to the current average, then the catalogue cost. [Verified]
  3. The movement records quantity, unit cost, value, resulting balance and average cost, and the user.
     [Verified]
- **Exceptional cases and their handling:**
  - Restock happens **even when the refund is still "processing"** because a gateway tender awaits
    confirmation (restock is not conditional on the money having moved). [Verified]
  - Reason "damaged"/"defective" does **not** change the default of the restock checkbox. [Verified]
  - Goods not restocked leave no stock record at all (no "returned damaged" location or write-off
    document); the inventory report counts them only as a quantity "returned, not restocked".
    [Verified]
- **Existing controls:**
  - CTL-515 Stock changes only through the stock ledger, with cost and source document. [Verified]
  - CTL-516 Non-tracked items cannot be restocked. [Verified]
- **Financial / stock / cash effect:** Stock on hand +quantity; stock value +quantity × sold cost;
  average cost updated. Inventory report movements show the refund type.
- **Upstream dependencies:** Sale line cost snapshot (Sales/Inventory).
- **Downstream effects:** Inventory valuation; gross profit "restocked cost" (BP-515).
- **Observations:** FND-501, FND-507, FND-508.

#### BP-506 Approval workflow: pending → approve / reject / withdraw
- **Business purpose:** Put a second person between the cashier and the customer's money when a
  refund is large or late.
- **Actors and required authority:** Approve/reject: "Approve restricted refunds" at the refund's
  branch (Supervisor at the till; Company/Branch Manager in the manager app; Owner). Withdraw: the
  requester, or anyone with the approve permission (POS path only).
- **Trigger / inputs:** A refund in status "pending approval"; optional decision note.
- **Normal flow:**
  1. The pending refund row is locked; if it is no longer pending, the action is refused ("no longer
     waiting for a decision") — this also makes a second approval click harmless. [Verified]
  2. **Approve:** the approver must not be the requester (self-approval refused even if the requester
     was promoted in the meantime); the sale is locked; status → "processing", decided-by, decided-at
     and note are stored; settlement and restock execute (BP-504/505) using the **stored allocation**;
     status → "completed" (or stays "processing" for gateway tenders); audit "refund approved" with the
     requester's id. [Verified]
  3. **Reject:** status → "rejected" with decider and note; reservations are released; audit "refund
     rejected". No self-approval check (rejecting one's own request is equivalent to withdrawing).
     [Verified]
  4. **Withdraw (cancel):** status → "cancelled"; audit "refund cancelled". [Verified]
  5. Manager screen: tab "Pending" lists pending requests; the detail dialog shows items, restock flags,
     payments, approval reasons and offers Approve / Reject with a note to holders of the approve
     permission. [Verified]
- **Exceptional cases and their handling:**
  - Cashier (no approve permission) → 401 on the manager path (no manager session) / 403 on the POS
    path. Branch manager of another branch → 403. [Verified]
  - Approval when the requester's shift has since been **closed** → refused "needs the requesting
    cashier's open shift" if a cash part exists; the request cannot be approved later because the shift
    reference is fixed at request time; it must be rejected and re-requested. [Verified by code;
    scenario Inferred]
  - Approval when the drawer no longer covers the cash → refused, request stays pending. [Verified]
  - Approval reasons are evaluated once at request time; a later change of policy does not re-evaluate
    pending requests. [Verified]
  - Holders of the approve permission never create pending requests for themselves: their own
    refunds complete directly whatever the amount or age. [Verified by test]
  - There is **no screen** that calls withdraw (API only). [Verified]
  - Pending requests do not block shift close. [Verified: no such check in the shift service]
- **Existing controls:**
  - CTL-517 Four-eyes rule for restricted refunds: self-approval refused by user identity. [Verified]
  - CTL-518 Approver permission checked at the refund's branch. [Verified]
  - CTL-519 Pending requests reserve quantities and tender amounts so approval can never overdraw.
    [Verified]
  - CTL-520 Decision metadata (who, when, note) stored and audited; the stored allocation is what is
    paid, not a re-computation. [Verified]
- **Financial / stock / cash effect:** None until approval; on approval as BP-504/505 — note the cash
  leaves the **requester's** drawer, the ledger entry and stock movement are stamped with the
  **approver** as creator.
- **Upstream dependencies:** BP-503; refund policy; roles.
- **Downstream effects:** Reports count the refund on its completion date, not its request date.
- **Observations:** FND-502, FND-509, FND-510, FND-516.

#### BP-507 Void (cancellation) of a sale of the open shift
- **Business purpose:** Undo a sale rung up by mistake or cancelled by the customer before leaving,
  without the formality of a return.
- **Actors and required authority:** "Cancel an open or same-shift sale" at the branch (Supervisor,
  Owner; **not** the default Cashier) with an open shift that is the sale's shift.
- **Trigger / inputs:** Sale id, reason (cashier error, customer cancelled, other + note), idempotency
  key.
- **Normal flow:**
  1. Replay check as BP-503. Own shift locked, sale locked. [Verified]
  2. The sale must belong to the **actor's own open shift** and have no active refund; otherwise
     refused "only sales of your open shift without refunds can be cancelled". A second void is
     refused the same way. [Verified]
  3. A refund document of kind "void" is created for **all lines, full quantities, restock = yes**
     (subject to tracked-item rule), pay-back proportional to the original tenders, executed
     immediately; audit "sale voided" with receipt number. [Verified]
  4. Because voids need the sale's own shift, a supervisor can void only sales they rang up
     themselves; a cashier's error must be corrected by a refund (BP-503) or by the cashier asking a
     supervisor to refund it at the supervisor's own till. [Verified by test]
- **Exceptional cases and their handling:**
  - No approval limit applies to voids. [Verified]
  - Voids of gateway-paid sales stay "processing" (BP-509). [Verified by code]
  - Drawer sufficiency applies to the cash part. [Verified]
- **Existing controls:**
  - CTL-521 Same-shift restriction and "no prior refund" rule. [Verified]
  - CTL-522 Separate permission from refunds, not granted to cashiers by default. [Verified]
  - CTL-523 Full restock at sold cost, immutable void document with reason. [Verified]
- **Financial / stock / cash effect:** As a full refund; the original sale still counts as a sale
  (reports show the sale and the void).
- **Upstream dependencies:** Sale of the current shift.
- **Downstream effects:** Shift drawer; sales report (sale count includes the voided sale, refunds
  include the void); unusual activity "voids" column.
- **Observations:** FND-519.

#### BP-508 Exchange through the checkout engine
- **Business purpose:** Take goods back and hand out other goods in one transaction, settling only
  the difference.
- **Actors and required authority:** "Process returns and refunds" **and** "Create sales" at the
  branch; open own shift.
- **Trigger / inputs:** Original sale, return lines (with restock flags), reason/note, new cart lines,
  optional sale discount, payments for the amount still due, the new total the cashier saw,
  idempotency key.
- **Normal flow:**
  1. Replay check; own shift and sale locked; return amount computed (BP-502). [Verified]
  2. If the return would require approval, the exchange is **refused** ("needs a supervisor") — there
     is no pending state for exchanges. [Verified; ADR-0060]
  3. Credit applied = min(return total, new sale total). A refund document of kind "exchange" is
     stored with the credit and the new sale's id; any credit **above** the new total is planned as
     pay-back to the original tenders (proportional). An internal "exchange credit" payment row
     (status succeeded, verification internal) is stored on the refund. [Verified]
  4. The new sale is completed through the normal checkout engine with the exchange credit as its first
     payment plus the customer's payments for the difference; the new sale must match the expected
     total exactly or the whole transaction (refund included) is rolled back. The customer of the
     original sale is inherited. [Verified]
  5. Settlement and restock of the return execute; audit "refund exchange" with both sale ids.
     [Verified]
  6. POS shows first the refund receipt then the new sale's receipt. [Verified]
- **Exceptional cases and their handling:**
  - Duplicate return line → validation error (not a server error). [Verified]
  - Wrong difference payment → refused atomically; no refund is recorded. [Verified]
  - Leftover credit on a card-paid original goes back to the **card**; but exchange credit sitting on
    the *new* sale is paid back **in cash** if that sale is itself later refunded (BP-504 step 3).
    [Verified]
  - The POS exchange panel allows only one payment method for the difference and no discount.
    [Verified]
- **Existing controls:**
  - CTL-524 Single transaction: return, credit and new sale succeed or fail together. [Verified]
  - CTL-525 Exchange credit is marked internal and excluded from "collected" money. [Verified]
  - CTL-526 Exchanges needing approval are refused rather than left half-done. [Verified]
- **Financial / stock / cash effect:** Return as BP-503/505; new sale as a normal sale (stock out,
  revenue, fees on the difference payment only); drawer: only the difference moves.
- **Upstream dependencies:** Catalogue availability at the branch; original sale.
- **Downstream effects:** Sales report counts the new sale as net sales and the return as a refund
  (gross-up); "sales by payment method" shows exchange credit as a tender.
- **Observations:** FND-504, FND-519.

#### BP-509 Gateway refunds awaiting confirmation
- **Business purpose:** Never tell the customer or the books that an online/gateway payment was
  refunded before the provider confirms it.
- **Actors and required authority:** As BP-503/506/507.
- **Trigger / inputs:** A pay-back row whose original payment was gateway-verified.
- **Normal flow:**
  1. At settlement, gateway rows stay "pending"; the refund stays "processing" with no completion
     time; manual rows of the same refund are settled; **restock is performed**. [Verified]
  2. The refund keeps reserving its quantities and amounts on the sale. [Verified]
  3. Reports treat it as not completed: excluded from "refunds", "paid back", restocked cost; listed
     under "refund allocations" with status pending in the payments report. [Verified]
- **Exceptional cases and their handling:**
  - **There is no code path, endpoint, job or screen that moves a pending gateway pay-back to
    succeeded or failed, or the refund to completed.** The database allows exactly that transition
    (status/reference of a pending row may change), but nothing uses it. The project log states that
    gateway refund confirmation was deferred and that paid online orders are "refunded through the
    existing refund engine (gateway refund stays pending)". [Verified]
  - Cancelling a **paid** online order in the manager app is refused with the instruction to refund
    the sale instead; that refund can only be initiated from a POS session with an open shift at the
    order's branch. [Verified]
- **Existing controls:**
  - CTL-527 Gateway tenders are never marked paid on assumption. [Verified]
  - CTL-528 Only a pending gateway row may change, and only its status/reference. [Verified]
- **Financial / stock / cash effect:** Stock goes back immediately; no money moves; revenue is not
  reduced in any report until completion, which currently never happens.
- **Upstream dependencies:** Online store / gateway (other domain).
- **Downstream effects:** Payments report pending allocations; indefinite reservation on the sale.
- **Observations:** FND-501, FND-521.

#### BP-510 Refund receipt
- **Business purpose:** Give the customer a document for the return and the money paid back.
- **Actors and required authority:** POS "Process returns and refunds" (POS session of the refund's
  branch). The manager app has no receipt endpoint for refunds. [Verified]
- **Trigger / inputs:** Refund id.
- **Normal flow:** The receipt shows company and branch names, kind (refund/void/exchange), refund
  number, original receipt number, cashier (requester), reason, lines with quantity and amount,
  total, pay-back per method (exchange credit labelled as such), branch footer. Printing is disabled
  while the request is pending. [Verified]
- **Exceptional cases:** A refund of another branch is "not found" to a POS session. [Verified]
  The receipt does not show pay-back status (pending vs paid) nor the approver. [Verified]
- **Existing controls:** CTL-529 Receipt built from the immutable refund record. [Verified]
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-503/507/508.
- **Downstream effects:** Customer evidence; none in the books.
- **Observations:** none specific.

#### BP-511 Refund history and detail (manager), customer refund history
- **Business purpose:** Let management review every return, approval and decision, trace it to the
  sale, and let customer service see a customer's returns.
- **Actors and required authority:** "View sales" + manager access (branch-scoped); customer history
  needs "View customers".
- **Trigger / inputs:** Filters status, kind, branch, sale, page; the API also accepts a date range
  (by **request date**, merchant-local days) which the screen does not expose. [Verified]
- **Normal flow:** List ordered newest first with number, date, kind, reason, branch, requester,
  total, status badge; detail dialog with link to the sale, reason/note, requester and time, decider
  and note, approval reasons, items with restock marker, pay-backs with status. Sale detail in the
  sales module shows "refunded" (completed only) and the sales list shows totals amount / refunded /
  net. Customer page lists the customer's refunds (last 200) within the viewer's branches. [Verified]
- **Exceptional cases:** Another merchant's refund → not found. [Verified] No CSV export, no
  reason breakdown, no period filter on screen. [Verified]
- **Existing controls:** CTL-530 Branch scoping by "View sales" permission; CTL-531 immutable history
  (CTL-510). [Verified]
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-503…509.
- **Downstream effects:** Period close support (BP-525).
- **Observations:** FND-511.

#### BP-512 Unusual refund activity report
- **Business purpose:** Detect employees whose refunds are disproportionate to their sales or who
  refund outside the return window.
- **Actors and required authority:** "View sales" + manager access (branch-scoped); optional branch
  and date filters.
- **Trigger / inputs:** Optional branch, from, to (merchant-local days; default: all time).
- **Normal flow:** Per employee: number and amount of their sales (by sale date), number of refunds
  (excluding voids), number of voids, refunded amount (completed refunds and voids by completion date,
  attributed to the **requester**), refund rate = refunded ÷ sales (two decimals, exact), count of
  refunds flagged "outside window", and a flag when rate > 10 % or any outside-window refund. Sorted by
  refunded amount. [Verified]
- **Exceptional cases:** Rate shown as 10 000 % when an employee has refunds but no sales in the
  period. Threshold is fixed in code, not configurable. [Verified]
- **Existing controls:** CTL-532 Detective control over cashier refund behaviour. [Verified]
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-503/507.
- **Downstream effects:** Management follow-up (manual).
- **Observations:** FND-520.

#### BP-513 Refund policy settings (return window, approval limit)
- **Business purpose:** Define when a refund needs a second person.
- **Actors and required authority:** "Update company settings" (merchant-wide: Owner, Company
  Manager); read with "Read company settings".
- **Trigger / inputs:** Return window in days (0–3650), approval limit in KWD, version for
  optimistic concurrency (shared with the maximum discount setting).
- **Normal flow:** Stored per merchant (defaults 30 days / 20.000 KWD); each change is audited with
  old and new values; the POS reads the policy on every refund evaluation. [Verified]
- **Exceptional cases:** Stale version → conflict. [Verified] The policy applies merchant-wide, not per
  branch; it does not apply to holders of the approve permission (BP-506). [Verified]
- **Existing controls:** CTL-533 Audit of policy changes; CTL-534 version check. [Verified]
- **Financial / stock / cash effect:** None directly.
- **Upstream dependencies:** Merchant settings.
- **Downstream effects:** BP-502/503/506/508.
- **Observations:** FND-502.

#### BP-514 Sales report
- **Business purpose:** Show for a period: how much was sold, discounted, refunded, by whom, where,
  when, of what, and how it was paid.
- **Actors and required authority:** "Sales reports" (branch-scoped); optional branch and employee
  filter.
- **Trigger / inputs:** From/to dates (≤ 366 days), optional branch, optional employee.
- **Normal flow / metric definitions (all exact integer sums in fils):**
  1. **Sale count**, **items sold** (Σ quantities), **gross sales** = Σ sale subtotals (unit price ×
     quantity before discounts), **item discounts**, **sale discounts**, **discounts**, **net sales** =
     Σ sale totals (= gross − discounts), **average sale** = net ÷ count (half-up). Sales count on their
     **completion time**. [Verified; BR-120]
  2. **Refund count** and **refunds** = Σ totals of refunds in status completed (kinds refund, void and
     exchange) counted on their **completion time**; **net after refunds** = net − refunds. [Verified;
     BR-121]
  3. **Previous period** figures for the same number of days immediately before. [Verified]
  4. Breakdowns: by day (zero-filled), by hour (merchant-local), by branch (gross, discounts, net,
     refunds, net after), by employee (POS sales rung up by the employee; refunds requested by the
     employee), by payment method (succeeded payments of the period's sales, including exchange
     credit), by product (sold vs refunded quantity and amount; top 1 000 by net), by category (the
     product's **current** category), by service type, by channel (POS / online). [Verified]
  5. **Gross profit** block only under the policy of BP-515. [Verified]
  6. On screen: KPI cards with % change vs previous, trend and by-hour bar charts, tables with CSV
     export, and a "How these figures are calculated" panel whose wording matches the implementation.
     [Verified]
- **Exceptional cases and their handling:**
  - from > to, period ≥ 366 days, malformed dates → 400. Branch of another merchant or unknown
    employee → 404. Branch outside the actor's permission → 403. [Verified]
  - The test suite proves that every breakdown (branch, employee, payment method, product, category,
    day, hour) sums to net sales and that the report equals the sales history totals **for the same
    day**. [Verified]
  - The by-employee table only includes **POS** sales; online sales have no employee and are omitted,
    so with online sales that table no longer adds up to net sales. [Verified by code]
  - Voided sales remain in sale count/average sale and the void is a refund; exchanges add a new sale
    and a refund. [Verified]
- **Existing controls:**
  - CTL-535 Reports read the immutable source tables at request time; no summary tables to drift.
    [Verified; ADR-0068]
  - CTL-536 Period and input validation; merchant isolation by row-level security. [Verified]
  - CTL-537 Reconciliation tests between breakdowns, totals and sales history. [Verified]
- **Financial / stock / cash effect:** None (read-only).
- **Upstream dependencies:** Sales, refunds, payments, catalogue.
- **Downstream effects:** Management decisions; period close (BP-525).
- **Observations:** FND-511, FND-514, FND-519.

#### BP-515 Gross profit policy
- **Business purpose:** Give an honest margin figure or none at all.
- **Actors and required authority:** Shown only when the viewer holds "Payments, cash and financial
  reports" for **every** branch in the report (all branches when unfiltered). [Verified]
- **Normal flow:** Cost of sales = Σ cost recorded on each sale of the period (the ledger's
  weighted-average cost at the moment of sale for tracked items; catalogue cost for untracked items;
  recipe cost for dishes). Restocked cost = Σ quantity × sold unit cost of restocked lines of refunds
  completed in the period. Gross profit = net after refunds − (cost of sales − restocked cost); margin
  % = gross profit ÷ net after refunds (one decimal). [Verified; ADR-0070]
- **Exceptional cases:** If **any** sale of the period has no cost, or any restocked line has no unit
  cost, the block says "not available" with the count of documents lacking a cost — one service item
  without a cost hides the margin for the whole period. Fees are not deducted; no tax or overhead.
  Returned goods **not** restocked keep their cost in cost of sales (the loss is embedded, not shown).
  [Verified]
- **Existing controls:** CTL-538 Cost snapshot at time of sale, immutable; CTL-539 all-or-nothing
  availability rule; CTL-540 permission gate for the whole scope. [Verified]
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** Stock ledger average cost; catalogue cost for untracked items.
- **Downstream effects:** Period close.
- **Observations:** FND-513, FND-508.

#### BP-516 Payments & cash report
- **Business purpose:** Reconcile money received and paid back per tender, the processing fees, the
  drawer cash, and every type of change in cash custody.
- **Actors and required authority:** "Payments, cash and financial reports" (branch-scoped); optional
  branch and employee.
- **Normal flow / definitions:**
  1. **Collections** per method: count and amount of succeeded, non-internal payments of sales,
     counted on **payment time** at the payment's branch (cash after change); **fees** = Σ fee stored on
     those payments; **paid back** = settled pay-back rows (excluding exchange credit) of refunds
     **completed** in the period; **net** = collected − paid back; **net after fees** = net − fees;
     previous period collected. [Verified; BR-123…125]
  2. **Cash**: cash sales (from collections), cash refunds (from pay-backs), cash in / cash out
     (POS cash movements of the period), net cash = sales − refunds + in − out — the same components
     as a drawer's expected cash. [Verified]
  3. **Cash by type** (custody): read from the cash ledger of registers and treasuries in the period:
     cash sales, cash refunds, drops (register → treasury), top-ups (treasury → register), bank
     deposits, expenses, supplier payments, corrections, count differences (shift open/close, register
     and treasury counts), opening counts, branch-to-branch transfers (net; −6.000 for the sending
     branch when filtered). [Verified by the cash-reports test]
  4. **Refund allocations**: pay-back rows per method and status (succeeded / pending) of refunds
     completed **or processing**, dated by completion, else decision, else request time. [Verified]
  5. By day: collected vs paid back; charts and CSV per table; definitions panel. [Verified]
- **Exceptional cases:** Employee filter applies to the sale's cashier for collections, to the
  requester for pay-backs, and to the **creator of the ledger entry** for cash movements and custody
  (for approved refunds that is the approver). [Verified] Fees are never reversed, so a fully refunded
  card sale still carries its fee. [Verified; OQ-016]
- **Existing controls:** CTL-541 Fees tie to the fees stored on each sale (tested); CTL-542 shift
  drawer figures tie to the shift record (tested); CTL-543 custody figures read the ledger, not a
  second copy. [Verified]
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** Payments, refunds, cash ledger, cash movements, transfers.
- **Downstream effects:** Bank/acquirer reconciliation (manual); period close.
- **Observations:** FND-505, FND-516, FND-522, FND-524.

#### BP-517 Expenses report
- **Business purpose:** Show cash expenses and supplier payments for the period.
- **Actors and required authority:** "Payments, cash and financial reports".
- **Normal flow:** Totals of expenses and supplier payments (each reversal subtracted on its own
  date), previous-period expenses, by category (count net of reversals), by branch, by supplier, by
  source (register vs treasury), by day. [Verified]
- **Exceptional cases:** A reversal in a later month shows as a negative in that month, not a
  restatement of the earlier month (consistent with no back-dating). [Verified]
- **Existing controls:** CTL-544 Disbursements are append-only with reversal links (other domain);
  report nets them. [Verified by test]
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** Cash disbursements (Cash custody).
- **Downstream effects:** Period close.
- **Observations:** none specific.

#### BP-518 Shifts report and discrepancy report
- **Business purpose:** Show per closed shift the opening float, cash sales, cash refunds, cash in/out,
  expected vs counted cash and the difference; aggregate by register; count balanced / over / short /
  uncounted.
- **Actors and required authority:** Shifts report: "Payments, cash and financial reports";
  discrepancy report: "View all shifts" (manager app).
- **Normal flow:** Shifts closed in the period (by close time); outcome from the discrepancy against
  the register tolerance; forced closes without a count are "uncounted" and excluded from register
  aggregates and from balanced/over/short. The discrepancy report adds totals by close type,
  differences found **between shifts** (at opening, first count excluded) and differences found
  **after an uncounted close**, attributed to that shift. [Verified by both tests]
- **Exceptional cases:** Cash refunds are attributed to the **requester's shift** (the drawer that paid
  them), consistent with the drawer calculation. [Verified]
- **Existing controls:** CTL-545 Report figures equal the shift's own expected/counted record (tested).
  [Verified]
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** Shifts, counts (Cash custody).
- **Downstream effects:** Cash loss investigation.
- **Observations:** none specific.

#### BP-519 Inventory report
- **Business purpose:** Value stock, list stock status, summarise movements and adjustments, and show
  sold / returned quantities per product.
- **Actors and required authority:** "Inventory reports and valuation" (branch-scoped).
- **Normal flow:** **Valuation** per branch = Σ on-hand × average cost (half-up per item) for tracked
  items with positive stock and a known cost; items with stock but no cost are counted as "unvalued".
  **Stock** list (up to 2 000) with status negative / out / low / in stock. **Movements** in the period
  by type with quantity in/out and value. **Adjustments** by kind and reason. **Product quantities**:
  sold, returned to stock, returned not restocked, net sold (refunds by completion date). [Verified]
- **Exceptional cases:** **Valuation and stock status are always "as of now"**, regardless of the
  requested period; there is no closing-stock figure as at a past date. [Verified]
- **Existing controls:** CTL-546 Valuation ties to stock levels (tested: 47 × 0.400 + 48 × 0.100).
  [Verified]
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** Stock ledger and levels (Inventory).
- **Downstream effects:** Period close.
- **Observations:** FND-512, FND-508.

#### BP-520 Purchasing report
- **Business purpose:** Summarise orders placed, goods received, open commitments, supplier activity
  and inter-branch transfers (with missing quantities and their value).
- **Actors and required authority:** "Inventory reports and valuation".
- **Normal flow:** Orders created in the period (not draft/cancelled) valued at quantity × order unit
  cost; receipts in the period valued at received quantity × order unit cost; open orders (approved /
  partially received) with their outstanding value; by supplier; receipt list (≤ 1 000); transfers
  dispatched in the period with dispatched/received/missing quantities and values at dispatch cost.
  [Verified]
- **Exceptional cases:** Transfers appear when either end is in scope. [Verified]
- **Existing controls:** CTL-547 Values derived from the documents (tested). [Verified]
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** Purchasing and transfers (other domain).
- **Downstream effects:** Payables follow-up (manual).
- **Observations:** FND-525.

#### BP-521 Report period, time zone, comparison and filters
- **Business purpose:** Make every report cut at the same, understandable boundaries.
- **Normal flow:** A period is whole **merchant-local calendar days** [from 00:00, to + 1 day 00:00)
  in the merchant's time zone (default Asia/Kuwait); the browser computes "today" in that zone and
  offers presets today / yesterday / last 7 / last 30 / this month / last month / custom; the previous
  period has the same number of days immediately before; recognition: sales at completion, refunds at
  completion, payments at receipt, pay-outs at refund completion, shifts at close, expenses at
  creation. A sale at 21:30 UTC falls on the next local day. [Verified; ADR-0069]
- **Exceptional cases:** Documents cannot be back-dated (all timestamps are set by the database at
  creation), so a closed period can only change by late completion of a refund, which is recognised
  in the later period — a strength for cut-off. [Verified] The time zone is one per merchant, not per
  branch [Verified]; whether it can be changed later and how a change would re-cut history is not
  guarded by any report logic [Inferred].
- **Existing controls:** CTL-548 Uniform boundary function used by every report; CTL-549 tested
  boundary case. [Verified]
- **Observations:** FND-511, FND-523.

#### BP-522 Report access and permission scoping
- **Business purpose:** Let each manager see only what they are entitled to.
- **Normal flow:** Tabs appear per permission; a branch manager sees only their branches (the branch
  list in results is restricted) and no profit; the company manager sees consolidated figures and
  profit; a custom "viewer" role with only sales viewing gets 403 on every report; a POS session cannot
  call manager reports (401); another merchant's branch or employee id → 404. [Verified by tests]
- **Existing controls:** CTL-550 Permission declared per endpoint plus branch re-check in the service.
  [Verified]
- **Observations:** FND-518 (no audit of report access).

#### BP-523 CSV export
- **Business purpose:** Take any report table into a spreadsheet.
- **Normal flow:** Built in the browser from the very values displayed; money as plain decimals with
  "(KWD)" in the header; UTF-8 byte-order mark for Arabic; cells starting with formula characters are
  neutralised. [Verified; ADR-0071]
- **Exceptional cases:** No server-side export, no XLSX, no export of KPI cards, no export of the
  refund history list. Exports are not logged. [Verified]
- **Existing controls:** CTL-551 Export equals the screen (tested); CTL-552 formula-injection
  protection (tested). [Verified]
- **Observations:** FND-518.

#### BP-524 Manager dashboard
- **Business purpose:** Landing page of the manager app.
- **Normal flow:** Shows a total-cash card (treasuries + drawers + in transit) to holders of "Cash
  custody", counts of branches / employees / roles, an onboarding checklist, and a permanent
  information banner saying sales and revenue figures "will appear here once those modules are in
  use". It contains **no** sales, refund or revenue KPI; those live on the Reports page. [Verified]
- **Observations:** FND-517.

#### BP-525 Period close using the reports (external accountant's view)
- **Business purpose:** Assess whether an external accountant can close a month from these reports
  alone.
- **What is available [Verified]:** net sales, discounts, refunds, net after refunds (sales report);
  collections per tender, fees, pay-backs, net after fees, cash by type incl. deposits, expenses and
  supplier payments (payments report); expenses by category/branch/supplier/source (expenses report);
  shift differences (shifts/discrepancy reports); current stock valuation and period movements by type
  with value (inventory report); purchases ordered/received and open commitments (purchasing report);
  gross profit under the policy; an immutable document trail with audit log.
- **What is missing or must be reconstructed [Verified unless stated]:** closing stock value as at
  period end (FND-512); the value of goods returned but not restocked (FND-508); the amount of refunds
  owed but not yet paid (processing/pending) at period end — only the pending gateway rows inside the
  period appear (FND-501, FND-522); a refund register for the period on the completion basis
  (FND-511); acquirer/gateway settlement vs recorded card collections and fees (FND-505, FND-524);
  supplier balances (received value vs supplier payments are in two different reports; no ledger of
  payables) (FND-525); any period lock or sign-off (Inferred: none exists).
- **Observations:** FND-501, FND-505, FND-508, FND-511, FND-512, FND-522, FND-525.

### E.3 Interdependencies with other domains

Refunds sit at the junction of sales, cash, stock and reporting. They consume the immutable sale (its
lines with net values and cost snapshots, and its payments with their tender accounts), they need an
open shift to exist (cash custody), they post to the cash ledger and the stock ledger through the same
single entry points every other module uses, and they are the only documents that reduce revenue after
the fact. Reports in turn read all of these tables without their own storage, so any weakness upstream
(e.g. a gateway refund that never completes) surfaces as a reporting inconsistency rather than a
reporting bug.

| This domain → other domain | What flows |
|---|---|
| Refunds → Sales | Derived "refunded" and "net" on sale detail and sales list; reservation of returnable quantities; exchange creates a new sale through the checkout engine and inherits the customer. |
| Refunds → Cash custody (registers, shifts, treasuries, bank) | Cash pay-backs leave the requester's drawer and lower the shift's expected cash; card/transfer pay-backs lower the tender's bank/internal account; fees are not touched. Shift close needs the drawer to include these entries. |
| Refunds → Inventory | Restock movements at sold cost; average cost updates; "returned not restocked" quantities only as a report figure. |
| Refunds → Customers | Customer refund history; exchange keeps the customer link. |
| Online store / gateway → Refunds | Paid online orders can only be cancelled by refunding the sale at a POS; gateway pay-backs wait for a confirmation that nothing provides. |
| Roles & permissions (Auth) → Refunds / Reports | Who may refund, void, approve, see history, see each report and gross profit; branch scoping of all of it; refund policy set by company settings. |
| Sales, Payments, Refunds, Shifts, Cash ledger, Stock ledger, Purchasing, Transfers → Reports | All report figures are computed from these source tables on demand with merchant-local day boundaries. |
| Reports → Management / external audit | KPIs, breakdowns, reconciliations, CSV; no period lock, no audit of access. |
| Audit log ← Refunds / Settings | Request, completion, approval, rejection, withdrawal, void, exchange, policy changes. |

### E.4 Findings

#### FND-501 Gateway refunds can never be confirmed; stock is restocked while revenue stays unreduced
- **Classification:** Missing process (and behaviour vs documented intent)
- **Severity:** High
- **Evidence:** A refund that pays back a gateway-verified tender is left "processing" with the
  pay-back row "pending"; no endpoint, job, webhook handler or screen changes that state afterwards
  (the only writers of these rows are the refund module itself; the project log says confirmation was
  deferred). Meanwhile the restock movement is executed immediately. Because reports count only
  completed refunds, net sales, "paid back" and gross profit do not reflect the return, while stock on
  hand and inventory value already do. [Verified]
- **Potential financial impact:** Overstated revenue and gross profit for every online return;
  inventory value and cost of sales inconsistent (goods counted in stock while their cost is still in
  cost of sales); customers owed money with no workflow, ageing or reminder; the sale's quantities stay
  reserved indefinitely.
- **Affected procedures:** BP-505, BP-509, BP-514, BP-515, BP-519, BP-525.
- **Recommendation:** Before any gateway goes live, implement (a) a confirmation/failure step for
  pending gateway pay-backs (manual confirmation by a manager with reference and amount as a minimum,
  automatic from the provider later), (b) a "refunds owed" list with ageing, and (c) either defer the
  restock until completion or report processing refunds separately in the sales and inventory reports
  so the two sides stay consistent.

#### FND-502 Holders of the approve permission bypass the refund limit and window for their own refunds
- **Classification:** Owner decision to revisit (segregation of duties)
- **Severity:** Medium
- **Evidence:** Approval reasons are evaluated only for actors who do not hold "Approve restricted
  refunds" at the branch; a supervisor's 25.000 KWD refund on a 20.000 limit completes directly, paid
  from the supervisor's own drawer, with no second person. Documented in ADR-0059 and BR-092 wording
  ("nobody approves their own refund" is honoured only for requests that become pending). [Verified]
- **Potential financial impact:** A single supervisor can take any amount of cash out of their drawer
  against any sale of the branch within the sale's refundable balance, with reason "changed mind", and
  only the unusual-activity report and the drawer count stand between that and a loss.
- **Affected procedures:** BP-503, BP-506, BP-513.
- **Recommendation:** Separate the "may refund without approval up to X" capability from the "may
  approve others" capability, or at least require a second approver above a higher merchant-set
  ceiling regardless of role; consider a daily cash-refund cap per employee.

#### FND-503 Cashiers can refund their own sales within the limit with cash from their own drawer and no customer verification
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** Any holder of "Process returns and refunds" (default Cashier) may refund any sale of
  the branch up to 20.000 KWD within 30 days, including sales they rang up minutes earlier, with the
  default restock on; the recent-sales shortcut on the returns screen means no receipt is needed; no
  customer, signature or ID is captured on the refund. Compensating controls: reasons list, immutable
  record, audit log, drawer count at shift close, unusual-activity report. [Verified]
- **Potential financial impact:** Classic "refund fraud" exposure (fictitious returns to pocket cash
  while stock appears to grow, later hidden by shrinkage) up to the limit per refund.
- **Affected procedures:** BP-501, BP-503, BP-512.
- **Recommendation:** Configurable per-role limit for approval-free refunds (e.g. cashiers 0 or a low
  amount), optional customer phone capture on refunds, a rule that refunds of one's own sales within
  the same shift need a supervisor (or must be voids by a supervisor), and surfacing "refunds of own
  sales" as a separate column in the activity report.

#### FND-504 Exchange credit is paid back in cash: a card-to-cash conversion path
- **Classification:** Owner decision to revisit
- **Severity:** Medium
- **Evidence:** When a sale paid (wholly or partly) with exchange credit is itself refunded, the credit
  part is paid back in cash from the drawer. A customer who paid by card, exchanges, then returns the
  exchanged goods, receives cash. Documented in ADR-0058. [Verified]
- **Potential financial impact:** Card chargeback plus cash paid out (double loss) on stolen or
  disputed cards; circumvents BR-091 "back to the original tender" in substance.
- **Affected procedures:** BP-504, BP-508.
- **Recommendation:** Trace exchange credit back to the tenders of the original sale (the link exists:
  the exchange payment references the refund, which references the original sale) and pay back
  proportionally to those tenders, falling back to cash only for the originally-cash part.

#### FND-505 Manual card and transfer refunds are recorded as paid immediately, with an optional reference and no acquirer reconciliation
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** For non-gateway card/transfer tenders the pay-back row is marked succeeded and a
  negative entry is posted to the tender's bank/internal account at once; the terminal reversal
  reference is optional; nothing later compares recorded card collections, fees and refunds with
  acquirer settlements. [Verified]
- **Potential financial impact:** The books show money returned that was never actually reversed at
  the terminal (or reversed twice); bank account figures in the cash module diverge from the real bank
  without detection.
- **Affected procedures:** BP-504, BP-516, BP-525.
- **Recommendation:** Make the reference mandatory for card/transfer pay-backs, and add a settlement
  reconciliation (per method, per day: collected − refunded − fees vs bank credit) with an exception
  list.

#### FND-506 Pay-backs to a tender without a financial account leave no money trace
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** If the original payment has no financial account, the pay-back is marked succeeded
  but no ledger entry is posted anywhere. Default methods are all mapped to accounts, so this affects
  only custom methods configured without an account. [Verified]
- **Potential financial impact:** Small; money paid back through such a method is invisible in cash
  custody.
- **Affected procedures:** BP-504.
- **Recommendation:** Refuse refunds (and sales) on methods without a settlement account, or post to a
  suspense account.

#### FND-507 Restock defaults to "yes" regardless of the return reason
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** The restock checkbox is ticked by default and the server default is also "restock";
  choosing reason "damaged" or "defective" does not change it. BR-093 says damaged goods are not
  restocked "when marked so" — i.e. it relies on the cashier remembering. [Verified]
- **Potential financial impact:** Damaged goods re-enter sellable stock and inventory value; later
  shrinkage write-offs misstate the period in which the loss occurred; gross profit of the return period
  is overstated by the restocked cost.
- **Affected procedures:** BP-503, BP-505, BP-515.
- **Recommendation:** Default restock to "no" for damaged/defective reasons (overridable with a note),
  and show the restock decision prominently on the approval dialog.

#### FND-508 Returned goods not restocked have no custody record or write-off document
- **Classification:** Missing process
- **Severity:** Medium
- **Evidence:** A non-restocked return produces no stock movement, no "damaged goods" location and no
  valued write-off; the only trace is the quantity column "returned, not restocked" in the inventory
  report; the cost remains inside cost of sales without a separate line. [Verified]
- **Potential financial impact:** Goods physically returned to the branch (and possibly resellable,
  returnable to the supplier or claimable under warranty) are untracked; management cannot see the
  value lost to damaged returns; opportunity for staff to keep "damaged" returns.
- **Affected procedures:** BP-505, BP-515, BP-519, BP-525.
- **Recommendation:** Record non-restocked returns as a movement into a non-sellable "returns /
  damaged" bucket per branch with value at sold cost, with a later disposal or supplier-return
  document; show "cost of returns not restocked" in the gross profit block.

#### FND-509 A pending request is bound to the requester's shift; once that shift closes it can only be rejected
- **Classification:** Control gap (operational)
- **Severity:** Low
- **Evidence:** The shift id is fixed at request time; at approval the system requires that shift to
  be open and sufficiently funded for the cash part; shift close does not warn about pending requests.
  [Verified by code; scenario Inferred]
- **Potential financial impact:** Delayed customer refunds and re-keying; risk of a duplicate request
  being created on a new shift while the old one is still pending (prevented by the reservation, but
  confusing).
- **Affected procedures:** BP-503, BP-506.
- **Recommendation:** Warn or block shift close while the cashier has pending requests, or let the
  approver choose the paying drawer (their own) at approval.

#### FND-510 Withdrawal of a pending request is documented but not offered on any screen
- **Classification:** Inconsistency (doc vs behaviour)
- **Severity:** Low
- **Evidence:** BR-094 and the routes documentation state pending requests can be withdrawn; the API
  supports it; neither the POS returns screen nor the manager refunds page calls it. [Verified]
- **Potential financial impact:** None directly; requests linger until a manager rejects them.
- **Affected procedures:** BP-506.
- **Recommendation:** Add a "my pending requests" list with withdraw on the POS.

#### FND-511 Three different date bases for refunds and no period-based refund register
- **Classification:** Inconsistency (behaviour vs behaviour) / Missing process
- **Severity:** Medium
- **Evidence:** Reports count refunds on completion date; the manager refund list filters (API only)
  by request date and the screen offers no date filter or export at all; the sales list's "refunded"
  and "net" totals attribute completed refunds to the **sale's** date; the POS lookup's "already
  refunded" includes pending/processing while the manager sale detail counts completed only. The
  reconciliation test ties the report to the sales history only because everything happens on one
  day. [Verified]
- **Potential financial impact:** An accountant comparing "refunds for October" from the sales list
  (by sale date) with the sales report (by completion date) will get different numbers whenever a
  return crosses a month end, with no document list to explain the difference.
- **Affected procedures:** BP-501, BP-511, BP-514, BP-521, BP-525.
- **Recommendation:** Add a refund register report for a period on the completion basis (with request
  date, approval, tenders, restock, reason), label the sales list totals as "refunds of these sales (any
  date)", and show pending/processing amounts separately everywhere.

#### FND-512 Inventory valuation is only available "as of now"; no closing stock at period end
- **Classification:** Missing process
- **Severity:** High
- **Evidence:** The inventory report's valuation and stock list ignore the requested period; only
  movements and adjustments are period-based; no snapshot or roll-forward (opening value + movements
  value = closing value) is offered. [Verified]
- **Potential financial impact:** Monthly closing stock — a balance-sheet figure and the counterpart
  of cost of sales — cannot be reproduced after the fact; management accounts for a past month are not
  auditable from the system.
- **Affected procedures:** BP-519, BP-525.
- **Recommendation:** Provide valuation as at any date from the ledger (balance and average cost after
  the last movement before the cut-off are already stored on each movement), plus a period roll-forward
  by movement type reconciling opening to closing value.

#### FND-513 One item without a cost hides gross profit for the whole period
- **Classification:** Control gap (usability of a key metric)
- **Severity:** Medium
- **Evidence:** If any sale in the period contains an item whose cost is unknown (e.g. a service),
  the profit block is replaced by "not available (n documents)". Service items have no cost unless
  one is entered. [Verified]
- **Potential financial impact:** Managers of mixed goods/services businesses never see a margin, or
  are tempted to enter fake costs to unlock it.
- **Affected procedures:** BP-515.
- **Recommendation:** Distinguish "cost not applicable (zero)" from "cost unknown" on the catalogue
  item, and show profit for the known part with the unknown share disclosed.

#### FND-514 Sales-by-employee breakdown omits online sales and so does not add up to net sales
- **Classification:** Inconsistency (doc vs behaviour)
- **Severity:** Low
- **Evidence:** The by-employee query is restricted to POS-channel sales while the summary includes
  online sales; BR-122 promises every breakdown always adds up to the totals; the test scenario has no
  online sales. [Verified by code]
- **Potential financial impact:** None; a reconciliation reader will see a gap.
- **Affected procedures:** BP-514.
- **Recommendation:** Add an "Online store" row to the employee table or document the exclusion.

#### FND-515 Audit event says "refund completed" for gateway refunds that are still processing
- **Classification:** Inconsistency (behaviour vs behaviour)
- **Severity:** Low
- **Evidence:** The audit action is chosen from whether approval was required, not from the resulting
  status. [Verified]
- **Potential financial impact:** Misleading audit trail.
- **Affected procedures:** BP-503, BP-509.
- **Recommendation:** Record "refund processing" when any pay-back remains pending, and a separate
  event on confirmation.

#### FND-516 Approved refunds are stamped with the approver as the creator of the cash and stock entries
- **Classification:** Inconsistency (behaviour vs behaviour)
- **Severity:** Low
- **Evidence:** On approval the ledger entry and stock movement carry the approver's user id while the
  cash leaves the requester's drawer; the payments report's employee filter attributes cash-by-type
  and cash movements by the entry creator (approver) but pay-backs and the cash block by the requester.
  [Verified]
- **Potential financial impact:** Per-employee cash analyses can disagree with each other.
- **Affected procedures:** BP-506, BP-516.
- **Recommendation:** Stamp entries with the requester (drawer owner) and keep the approver in the
  refund's decision fields; or filter custody by the shift's owner.

#### FND-517 The manager dashboard shows no sales KPIs and a stale "no sales yet" banner
- **Classification:** Inconsistency (doc vs behaviour)
- **Severity:** Low
- **Evidence:** The progress log and roadmap describe a dashboard with KPIs and charts; those exist on
  the Reports page, while the landing dashboard shows counts, a cash card (owner only by default) and a
  permanent banner stating that sales figures will appear "once those modules are in use". [Verified]
- **Potential financial impact:** None.
- **Affected procedures:** BP-524.
- **Recommendation:** Replace the banner with today's net sales / refunds / collections for the
  branches the user may see, linking to the reports.

#### FND-518 Report access and exports are not logged; exports exist only as browser CSV
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** No audit entry is written for viewing a financial report or exporting it; export is
  client-side CSV only (no XLSX/PDF, no KPI export, no scheduled or e-mailed reports). [Verified]
- **Potential financial impact:** Weak traceability of who extracted financial data; manual effort at
  close.
- **Affected procedures:** BP-522, BP-523.
- **Recommendation:** Log financial report access and exports; consider a server-side period pack
  export.

#### FND-519 Voided sales inflate sale count and average sale; exchanges gross up sales and refunds
- **Classification:** Owner decision to revisit
- **Severity:** Low
- **Evidence:** A void is a refund document; the original sale remains in net sales and in the sale
  count; an exchange adds a full new sale and a full refund. Documented in BR-121. [Verified]
- **Potential financial impact:** KPIs (count, average ticket) distorted by cashier errors; sales and
  refund totals both inflated by exchanges relative to how most retailers report them.
- **Affected procedures:** BP-507, BP-508, BP-514.
- **Recommendation:** Show voids and exchange returns as separate lines in the sales summary and offer
  "sales excluding voids" for count and average.

#### FND-520 Unusual-activity threshold is hard-coded and the default period is all time
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** 10 % flag threshold fixed in code; without dates the report covers the merchant's whole
  history, diluting recent behaviour; employees with refunds but no sales show 10 000 %. [Verified]
- **Potential financial impact:** Weak detective control for larger merchants.
- **Affected procedures:** BP-512.
- **Recommendation:** Make the threshold and default window settings; add refunds-of-own-sales,
  same-shift refunds and cash-only refund amounts as columns.

#### FND-521 Refunding an online order requires a POS session with an open shift at the branch
- **Classification:** Missing process
- **Severity:** Medium
- **Evidence:** Manager cancellation of a paid online order is refused ("refund the sale"); the refund
  endpoints need a bound branch and the requester's own open shift even when no cash is involved; the
  pay-back then waits forever (FND-501). [Verified]
- **Potential financial impact:** Online customer service cannot be done from the back office;
  delays and workarounds (e.g. a cashier opening a shift just to refund).
- **Affected procedures:** BP-503, BP-509.
- **Recommendation:** Allow refunds of gateway-paid sales from the manager app without a shift when
  no cash tender is involved, tied to the gateway confirmation step.

#### FND-522 "Refund allocations" uses a different date basis than the rest of the payments report
- **Classification:** Inconsistency (behaviour vs behaviour)
- **Severity:** Low
- **Evidence:** That table includes processing refunds and dates them by completion, else decision,
  else request time, whereas "paid back" uses completion only. [Verified]
- **Potential financial impact:** The table cannot be tied to "paid back" by simple subtraction.
- **Affected procedures:** BP-516.
- **Recommendation:** Split into "paid in period" (ties to paid back) and "outstanding at period end".

#### FND-523 One merchant-wide time zone; a change would re-cut all historical periods
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** Day boundaries use the merchant's single time zone; branches in other zones are not
  supported; the reports do not freeze the zone used for past periods. [Verified for the single zone;
  Inferred that it is editable through company settings]
- **Potential financial impact:** Restated daily figures after a zone change; negligible for a
  single-country merchant.
- **Affected procedures:** BP-521.
- **Recommendation:** Audit zone changes and state the zone on every exported report (already in the
  period block of the API).

#### FND-524 Processing fees are never reversed on refunds
- **Classification:** Owner decision to revisit
- **Severity:** Low
- **Evidence:** Fees stay on the original payment; "net after fees" of a fully refunded card sale is
  negative by the fee. Documented as OQ-016 / BR-125 pending the acquirer contract. [Verified]
- **Potential financial impact:** Over- or under-statement of fee expense depending on the acquirer's
  actual practice.
- **Affected procedures:** BP-504, BP-516.
- **Recommendation:** Confirm with each acquirer and make fee reversal a per-method setting.

#### FND-525 No supplier balances or payables view; purchases received and supplier payments live in different reports
- **Classification:** Missing process
- **Severity:** Medium
- **Evidence:** The purchasing report values receipts; the expenses report totals supplier payments;
  nothing nets them per supplier or shows what is owed at period end. [Verified]
- **Potential financial impact:** Month-end payables cannot be derived; risk of double payment or
  missed liabilities.
- **Affected procedures:** BP-517, BP-520, BP-525.
- **Recommendation:** A supplier statement (received value − payments = balance) per period, or at
  least both figures side by side per supplier.

### E.5 Documented owner decisions touching this domain

| Id | Decision (one line) | Residual risk (one line) |
|---|---|---|
| BR-034 / ADR-0056 | Sales, payments and refunds are never edited; a refund is a linked, append-only record with derived balances. | None material; strong for audit (see CTL-510). |
| BR-035 / ADR-0056 | A refund can never exceed the remaining refundable amount; pending requests reserve quantities. | A never-completing gateway refund reserves forever (FND-501). |
| BR-090 / OQ-017 | Returns need the original receipt, at the branch of the sale; refund = paid net value of the units. | Customers cannot return at another branch; receipt knowledge alone suffices (FND-503). |
| ADR-0057 | Cumulative half-up rounding for partial refunds. | None. |
| BR-091 / ADR-0058 | Pay back per original tender, never more than each; cash from the requester's drawer; exchange credit refunded in cash; fees not reversed. | Card-to-cash path (FND-504); fee treatment depends on acquirer (FND-524). |
| BR-092 / ADR-0059 | Approval above the limit (20.000) or outside the window (30 days) for users without the approve permission; nobody approves their own request. | Approvers' own refunds are unrestricted (FND-502). |
| BR-093 | Restock only when marked, at the cost sold with. | Default is "marked" (FND-507); no custody of non-restocked goods (FND-508). |
| BR-094 | Void only sales of the own open shift without returns, by holders of the void permission; pending requests can be withdrawn. | Withdraw not on screen (FND-510). |
| BR-095 | Gateway refunds complete only after confirmation. | No confirmation process exists (FND-501). |
| ADR-0060 | Exchanges are one transaction through the checkout engine; refused if approval would be needed. | Gross-up of sales and refunds (FND-519). |
| OQ-016 | Card processing fees are not reversed on refunds (pending acquirer contract). | FND-524. |
| ADR-0068 | Reports computed on demand from source tables; ≤ 366 days. | Performance at volume; no as-of inventory (FND-512). |
| ADR-0069 | Whole merchant-local days; sales at completion, refunds at completion, payments at receipt, shifts at close. | Three bases for refunds across screens (FND-511). |
| BR-120…BR-126a | Metric definitions (gross, discounts, net, refunds, collected, paid back, fees, net cash, cash by type, cash difference). | By-employee excludes online sales (FND-514). |
| BR-127 / ADR-0070 | Gross profit = net after refunds − (cost at sale − restocked cost); only with financial permission for the whole scope and only when every cost is known; fees not deducted. | All-or-nothing availability (FND-513); non-restocked returns' cost embedded (FND-508). |
| BR-128 | Inventory value = current quantity × average cost; unvalued items counted. | Current-only (FND-512). |
| BR-129 | Sales reports need the sales-report permission; payments/cash/shifts the financial permission; inventory/purchasing the inventory permission; branch managers see only their branches; cashiers have no report access. | Branch managers cannot see their own branch's cash/shift reports (by design). |
| ADR-0071 | CSV exports are built from the displayed values in the browser. | No server export or access log (FND-518). |
| ADR-0090…ADR-0092 | Cash custody ledger; cash refunds leave the paying shift's drawer; reports read the ledger; uncounted closes shown as such. | Approver stamped as creator of entries (FND-516). |
| ADR-0088 | Standing approval to publish to staging. | Not a control matter for this domain. |

### E.6 Technical mapping (appendix)

| BP id | Permission keys | Main tables | Screens / routes | Document number prefix / codes |
|---|---|---|---|---|
| BP-501 | `refunds.create` (POS, bound branch) | `sales`, `sale_lines`, `payments`, `refunds`, `refund_lines`, `refund_payments`, `shifts`, `sales_settings` | POS `/pos/returns`; `GET /api/v1/pos/refunds/lookup?receipt=` | Receipt number of the sale |
| BP-502 | `refunds.create` | as BP-501 | `POST /api/v1/pos/refunds/preview` | — ; errors `REFUND_EXCEEDS_SALE`, `INVALID_QUANTITY` |
| BP-503 | `refunds.create`; own open shift | `refunds`, `refund_lines`, `refund_payments`, `financial_account_entries`, `stock_movements`, `stock_levels`, `audit_log` | `POST /api/v1/pos/refunds`; POS `/pos/returns` | `<receipt>-R<n>`; audit `refund.requested` / `refund.completed`; errors `IDEMPOTENCY_CONFLICT`, `SHIFT_REQUIRED`, `INSUFFICIENT_CASH` |
| BP-504 | `refunds.create` (allocation); system at execute | `refund_payments`, `financial_account_entries`, `financial_accounts`, `payment_methods` | part of BP-503/506/507/508 | error `REFUND_ALLOCATION_INVALID`; entry type `refund`, source `refund_payment` |
| BP-505 | — (system) | `refund_lines.restock`, `stock_movements` (type `refund`), `stock_levels` | part of execute | movement reason = `refund` / `void` / `exchange` |
| BP-506 | `refunds.approve` (branch of refund); requester for cancel | `refunds` (status, decided_by_user_id, decided_at, decision_note, version) | `POST /api/v1/pos/refunds/:id/approve`, `POST /api/v1/pos/refunds/:id/cancel`, `POST /api/v1/manager/refunds/:id/approve`, `/reject`; manager `/manager/refunds` (tab Pending) | audit `refund.approved` / `refund.rejected` / `refund.cancelled`; errors `SELF_APPROVAL`, `REFUND_NOT_PENDING` |
| BP-507 | `sales.void`; own open shift | `refunds` (kind `void`), `refund_lines`, `refund_payments` | `POST /api/v1/pos/sales/:id/void`; POS `/pos/returns` (Cancel sale) | `<receipt>-R<n>`; audit `sale.voided`; error `NOT_VOIDABLE` |
| BP-508 | `refunds.create` + `sales.create` | `refunds` (kind `exchange`, `exchange_sale_id`, `exchange_credit_minor`), `payments` (method_kind `exchange`, `refund_id`), `sales` | `POST /api/v1/pos/exchanges`; POS `/pos/returns` (Exchange) | audit `refund.exchange`; errors `APPROVAL_REQUIRED`, `PAYMENT_TOTAL_MISMATCH` |
| BP-509 | — | `refund_payments` (status `pending`, verification `gateway`), `refunds` (status `processing`) | none (no confirmation route) | — |
| BP-510 | `refunds.create` (POS) | `refunds`, `merchants`, `branches` | `GET /api/v1/pos/refunds/:id/receipt`; POS receipt dialog | `<receipt>-R<n>` |
| BP-511 | `sales.read` (+ `manager.access`); `customers.read` | `refunds`, `sales`, `users` | `GET /api/v1/manager/refunds`, `/manager/refunds/:id`, `GET /api/v1/manager/customers/:id/refunds`; manager `/manager/refunds`, `/manager/sales/:id` | — |
| BP-512 | `sales.read` | `refunds`, `sales`, `memberships`, `users` | `GET /api/v1/manager/refunds/activity`; manager `/manager/refunds` (tab Activity) | flag threshold 10 % |
| BP-513 | `merchant.settings.read` / `merchant.settings.update` | `sales_settings` (`refund_window_days`, `refund_approval_limit_minor`, `version`) | `GET/PUT /api/v1/manager/sales-settings`; manager `/manager/sales` (Selling policy) | audit `sales.settings_updated` |
| BP-514 | `reports.sales` | `sales`, `sale_lines`, `refunds`, `refund_lines`, `payments`, `products`, `categories`, `users` | `GET /api/v1/manager/reports/sales`; manager `/manager/reports` (Sales) | — |
| BP-515 | `reports.financial` for whole scope | `sales.cost_minor`, `refund_lines.unit_cost_minor` | inside sales report (`profit`) | — |
| BP-516 | `reports.financial` | `payments`, `refund_payments`, `refunds`, `cash_movements`, `financial_account_entries`, `financial_accounts`, `cash_transfers` | `GET /api/v1/manager/reports/payments`; manager `/manager/reports` (Payments & cash) | — |
| BP-517 | `reports.financial` | `cash_disbursements`, `suppliers`, `branches`, `financial_accounts` | `GET /api/v1/manager/reports/expenses`; manager `/manager/reports` (Expenses) | — |
| BP-518 | `reports.financial`; `shifts.view_all` | `shifts`, `registers`, `payments`, `refund_payments`, `cash_movements` | `GET /api/v1/manager/reports/shifts`; `GET /api/v1/manager/shifts/discrepancies`; manager `/manager/reports` (Shifts), `/manager/shifts` | — |
| BP-519 | `reports.inventory` | `stock_levels`, `stock_movements`, `stock_adjustments`, `sale_lines`, `refund_lines`, `product_variants`, `products` | `GET /api/v1/manager/reports/inventory`; manager `/manager/reports` (Inventory) | — |
| BP-520 | `reports.inventory` | `purchase_orders`, `purchase_order_lines`, `purchase_receipts`, `purchase_receipt_lines`, `stock_transfers`, `stock_transfer_lines`, `suppliers` | `GET /api/v1/manager/reports/purchasing`; manager `/manager/reports` (Purchasing) | `PO-`, `GR-`, `TR-` (from other domain) |
| BP-521 | any `reports.*` | `merchants.timezone` | query `from`, `to`, `branchId`, `employeeId` on all report routes | period limit 366 days |
| BP-522 | `reports.sales` / `reports.financial` / `reports.inventory`; `manager.access` | `roles`, `role_assignments` | `@RequirePermission('manager', …)` on `ReportsController` | — |
| BP-523 | same as the report | — (browser) | `ReportTable` → `toCsv` in `features/reports/shared.tsx` | file `<table>-<from>-<to>.csv` |
| BP-524 | `manager.access`; `cash.custody` for the cash card | `financial_accounts` (via cash overview) | manager `/manager` (`DashboardPage`) | — |
| BP-525 | combination of the above | all of the above | all report tabs | — |

---

## Chapter F: Suppliers, purchasing and branch stock transfers

### F.0 Scope and sources reviewed

- **Business purpose.** This domain covers how a merchant brings goods into the business and
  moves them between its own branches. It holds the supplier master file, the purchase-order
  cycle (draft, submission, approval, goods receipt, close or cancel), the posting of received
  goods into branch stock at the agreed unit cost (which drives the weighted-average cost used
  for inventory valuation and gross profit), and the branch-to-branch transfer cycle (request,
  approval at the sending branch, dispatch into "in transit", receipt at the destination with a
  shortage explanation). It also covers the only financial link to suppliers that exists today:
  cash paid to a supplier is recorded as a cash disbursement that may name one purchase order.
  There is no supplier invoice, no accounts-payable balance, no return-to-supplier document and
  no landed-cost allocation; those absences are themselves part of the review.
- **Files/screens reviewed.** `apps/api/src/modules/purchasing/{purchasing.service.ts,
  purchasing.schema.ts, purchasing.controller.ts, purchasing.int.test.ts}`;
  `apps/api/src/modules/transfers/{transfers.service.ts, transfers.schema.ts,
  transfers.controller.ts}`; migrations `0018_purchasing_transfers.sql`,
  `0019_purchasing_transfers_rls.sql`, `0035_cash_disbursements_rules.sql` (supplier-payment
  guard); `apps/api/src/modules/cash/cash-payouts.service.ts` (supplier-payment side only) and
  the supplier parts of `cash-payouts.int.test.ts` and `registers/shifts.service.ts`;
  `apps/api/src/modules/inventory/stock-ledger.service.ts` (how receipts and transfers post);
  `apps/api/src/database/schema/sequences.schema.ts` (document numbering);
  `apps/api/src/modules/reports/reports.service.ts` (purchasing report, inventory valuation);
  `packages/permissions/src/{catalog.ts, templates.ts, evaluate.ts}`;
  `packages/contracts/src/purchasing.ts`; `packages/money/src/quantity.ts`;
  screens `apps/manager-web/src/features/purchasing/{SuppliersPage.tsx, PurchaseOrdersPage.tsx,
  ItemPicker.tsx}`, `apps/manager-web/src/features/transfers/TransfersPage.tsx`,
  `apps/manager-web/src/features/reports/OtherReports.tsx` (purchasing tab);
  `e2e/purchasing.spec.ts`; docs `BUSINESS_RULES.md` (BR-087, BR-100…104, BR-128, OQ-018),
  `DECISIONS.md` (ADR-0061…0064, 0070, 0091), `ROUTES.md`, `DATABASE.md`, `PROGRESS.md`,
  `TESTING.md`.
- **Coverage statement.** The cash-custody mechanics of disbursements (treasury counts,
  drawer balances, reversals) were read only as far as they touch suppliers; their full
  treatment belongs to the cash domain. The inventory ledger was read for how purchase
  receipts and transfers post, not for adjustments and counts (inventory domain). The platform
  side (plan limits) does not touch purchasing. I did not run the application or the tests;
  statements marked [Verified] rest on reading the code and the integration/e2e tests.

### F.1 Roles and authority matrix

Permission keys are translated into plain words; default role templates are those seeded for
every new merchant (editable by the owner). The owner holds every permission everywhere.
Platform operator roles (super admin, support, billing) belong to a separate identity realm and
can perform **none** of these operations [Verified].

| Operation | Permission needed (plain words) | Branch scoping | Owner | Company Manager | Branch Manager | Supervisor | Cashier | Kitchen |
|---|---|---|---|---|---|---|---|---|
| View suppliers list, order counts and purchased totals | "View suppliers and purchase orders" | Held at **any** branch is enough; totals shown are company-wide (FND-609) | Yes | Yes | Yes | No | No | No |
| Create / edit / deactivate a supplier | "Create purchase orders and suppliers" | Must be held **merchant-wide** (a branch-only assignment is refused by the service although the screen shows the button, FND-610) | Yes | Yes | **No** (branch-scoped template) | No | No | No |
| View supplier's cash payments | "View suppliers and purchase orders" | Payments shown only for branches where held | Yes | Yes | Yes (own branches) | No | No | No |
| List / open purchase orders | "View suppliers and purchase orders" | At the order's branch | Yes | Yes | Yes (own branches) | No | No | No |
| Create or edit a draft order; submit it | "Create purchase orders and suppliers" | At the receiving branch (edit: old and new branch) | Yes | Yes | Yes | No | No | No |
| Approve a submitted order | "Approve purchase orders" + not the creator (owner exempt) | At the receiving branch | Yes (even own orders) | Yes (not own) | **No** | No | No | No |
| Receive goods (full or partial) | "Receive goods" | At the receiving branch | Yes | Yes | Yes | No | No | No |
| Close a partially received order (reason required) | "Approve purchase orders" | At the receiving branch | Yes | Yes | No | No | No | No |
| Cancel an order before any receipt | "Create purchase orders and suppliers" **or** "Approve purchase orders" | At the receiving branch | Yes | Yes | Yes | No | No | No |
| Record a supplier payment from a branch treasury (optionally naming an order) | "Manage cash custody" | At the paying branch | Yes | **No** (not in template) | No | No | No | No |
| Record a supplier payment from the drawer at the POS (no order link) | "Record cash in / cash out" at POS | At the shift's branch | Yes (if POS access) | No | No | Yes | No (removed by owner decision BR-079) | No |
| List / open transfers | "View stock" | At source **or** destination | Yes | Yes | Yes | Yes | No | No |
| Request a transfer | "Request, dispatch and receive transfers" | At source **or** destination | Yes | Yes | Yes | No | No | No |
| Approve a transfer | "Approve transfers" | At the **source** branch | Yes | Yes | **No** | No | No | No |
| Dispatch a transfer | "Request, dispatch and receive transfers" | At the source branch | Yes | Yes | Yes | No | No | No |
| Receive a transfer, explain shortage (write-off) | "Request, dispatch and receive transfers" | At the destination branch | Yes | Yes | Yes | No | No | No |
| Cancel a transfer before dispatch | Requester (any status he holds "transfers" somewhere) **or** "Approve transfers" at the source | Source (approver) / none (requester) | Yes | Yes | Yes (if requester) | No | No | No |
| See the unit cost on a transfer | "Change prices and costs" (merchant-wide) or "Inventory reports and valuation" at the source | — | Yes | Yes | Yes (own source branches) | No | No | No |
| Purchasing report (orders, receipts, suppliers, transfers with missing value) | "Inventory reports and valuation" | For the branches in the report | Yes | Yes | Yes (own branches) | No | No | No |

Notes on scoping [Verified]:
- Route gates check the permission at the branch named in the request or "anywhere" when no
  branch is named; the service then re-checks at the document's branch. Lists are filtered to
  the branches where the viewer holds the permission; a branch manager of branch B sees only
  B's orders and transfers touching B (integration test "enforces purchasing permissions per
  branch").
- The owner bypasses every permission check including the "creator cannot approve" rule
  (BR-101, ADR-0062) [Owner decision].
- No default role except the owner holds "Manage cash custody", so out of the box only the
  owner can pay a supplier from a treasury; supervisors can pay a supplier from the drawer.
- A POS session (supervisor, cashier) cannot reach any purchasing or transfer endpoint even
  when presented as a management session: the management API answers "not authenticated"
  (integration test) [Verified]. Purchasing and transfers are management-app functions only.

### F.2 Procedures

#### BP-601 Maintain the supplier master file
- **Business purpose:** Keep a controlled list of the parties the business buys from, so that
  every purchase order and every supplier payment names a known, active supplier.
- **Actors and required authority:** A user with "Create purchase orders and suppliers" held
  merchant-wide (company manager, owner). Branch managers cannot create suppliers [Verified].
- **Trigger / inputs:** New supplier relationship, or change of contact/payment details.
  Fields: code (optional, up to 20 characters, unique per company ignoring letter case),
  Arabic and/or English name (at least one required), contact name, phone, e-mail (stored in
  lower case), address, tax number, payment terms (free text, up to 120 characters), notes,
  status active/inactive.
- **Normal flow:**
  1. Manager opens *Suppliers* and presses *New supplier*; fills the dialog and saves.
  2. System validates: a name is present; a code, if given, is not already used by another
     supplier of the company (duplicate → refusal "duplicate code").
  3. System stores the supplier with status *active* and version 1, and writes an audit entry
     "supplier created" with the status only.
  4. To edit, the manager clicks the row, changes fields and saves; the save carries the
     version the manager saw. If somebody else saved in between, the save is refused
     ("version conflict") and the manager must reload.
  5. To deactivate, the manager sets status *inactive* and saves. From then on no new
     purchase order and no new supplier payment can name the supplier; existing orders keep
     working (they can still be approved, received, closed) [Verified: only create/edit of an
     order checks the supplier status].
- **Exceptional cases and their handling:**
  - Duplicate code (any letter case) → refused [Verified].
  - Supplier never deleted; the database forbids deletion [Verified].
  - Inactive supplier on a new order → "supplier inactive" refusal [Verified by test].
  - Inactive supplier on a supplier payment (treasury or drawer) → refused [Verified by test].
  - Branch-only holder of the permission presses *New supplier* → the API refuses (403); the
    button was shown because the screen checks the permission "anywhere" [Verified, FND-610].
  - No duplicate check on name, tax number or phone; two records for the same real supplier
    are possible [Verified].
  - Payment terms are text; nothing computes due dates from them [Verified].
- **Existing controls:**
  - CTL-601 Unique supplier code per company (database unique index, case-insensitive).
  - CTL-602 Optimistic version on edits (no lost update between two managers).
  - CTL-603 Supplier records are never deleted; deactivation only.
  - CTL-604 Inactive supplier blocked from new orders and new payments.
  - CTL-605 Audit entry on create/update (actor, time, IP, status).
  - CTL-606 Tenant isolation by database row-level security; another company's supplier id is
    "not found" [Verified by test].
- **Financial / stock / cash effect:** None directly. The supplier row is the anchor for
  purchase values (received value Σ receipts) and for cash paid (Σ disbursements).
- **Upstream dependencies:** Active company; a user with merchant-wide purchasing authority.
- **Downstream effects:** BP-603 (orders), BP-609 (supplier payments), purchasing report
  (BP-615), expenses report in the cash domain (supplier payments by supplier).
- **Observations:** FND-609, FND-610, FND-620.

#### BP-602 Review a supplier: purchase history and cash paid
- **Business purpose:** Give management one place to see how much has been bought from a
  supplier and how much cash has been paid, in the absence of a payable ledger.
- **Actors and required authority:** Any holder of "View suppliers and purchase orders".
- **Trigger / inputs:** Supplier row on the *Suppliers* screen: *History* link (orders
  filtered by supplier) and *Payments* button (dialog).
- **Normal flow:**
  1. The list shows per supplier: number of orders (all statuses except cancelled, all
     branches) and *Purchased* = Σ over all goods receipts of quantity × order unit cost,
     rounded per receipt line, all branches [Verified].
  2. *History* opens the purchase-order list filtered to that supplier (branch-scoped).
  3. *Payments* shows every cash disbursement of kind "supplier payment" for that supplier in
     the branches the viewer may see, newest first (up to 200), each with its number (SP-…),
     the order number if one was named, description, receipt reference, and whether it is a
     reversal or has been reversed; a *Total paid* nets reversals [Verified].
- **Exceptional cases and their handling:**
  - The *Purchased* total ignores branch scoping while *Payments* respects it, so a branch
    manager compares a company-wide purchase figure with a branch-limited payment figure
    [Verified, FND-609].
  - Nothing shows "purchased minus paid" (no balance), by owner decision (BR-087, OQ-018).
  - Payments made at the POS appear here with their shift id but never with an order number
    (the POS payment cannot name an order) [Verified].
- **Existing controls:**
  - CTL-607 Payment list is branch-scoped by the viewer's purchasing authority.
  - CTL-608 Reversals are shown as separate negative lines, never hidden (append-only).
- **Financial / stock / cash effect:** Read-only.
- **Upstream dependencies:** BP-601, BP-606 (receipts), BP-609 (payments).
- **Downstream effects:** Management review; informal reconciliation of supplier statements.
- **Observations:** FND-602, FND-609.

#### BP-603 Create and edit a draft purchase order
- **Business purpose:** Record the intention to buy specific stock items, in specific
  quantities, at an agreed unit cost, for delivery to one branch; fix the cost at which the
  goods will later enter stock.
- **Actors and required authority:** "Create purchase orders and suppliers" at the receiving
  branch.
- **Trigger / inputs:** Supplier (active), receiving branch (active), optional expected date,
  optional note (≤ 1000 characters), 1–300 lines each with a stock-tracked active item,
  quantity (> 0, three decimals) and unit cost (≥ 0, KWD to the fils).
- **Normal flow:**
  1. Manager opens *Purchase orders → New order*; picks supplier and branch; searches items
     (the picker lists stock items with the on-hand at that branch; the unit cost is prefilled
     with the branch's current average cost or 0.000) [Verified].
  2. Enters quantities and unit costs; the screen shows the line total and order total
     (quantity × unit cost, rounded half-up per line).
  3. On *Save draft* the system checks supplier active, branch active, every item is an active
     stock-tracked item (services and other companies' items refused), quantities positive.
  4. The system draws the next gap-free number for the company (PO-000001, PO-000002 …) inside
     the same transaction, stores the header with status *draft*, the creator, the lines, and
     writes an audit entry "purchase order created" with the number.
  5. While the order is a draft, the creator (or any holder of the permission at the branch)
     may change supplier, branch, date, note and replace all lines; each save requires the
     current version. The database itself refuses any line change once the order is no longer
     a draft [Verified: trigger].
- **Exceptional cases and their handling:**
  - Zero unit cost accepted (free goods or forgotten price); receipt then posts stock at cost 0
    and pulls the average cost down [Verified, FND-617].
  - The same item may appear on two lines of one order (no uniqueness rule, unlike transfers)
    [Verified, FND-617].
  - Expected date is not checked against today; a past date is accepted [Verified].
  - No currency other than KWD, no tax field (OQ-004, OQ-002) [Owner decision pending].
  - Version conflict on concurrent edits → refused, reload required [Verified].
  - Double submission of the create form is prevented only by the button's "busy" state; there
    is no idempotency key on order creation, so a network retry could create two drafts
    [Inferred].
  - Cancelled drafts keep their number; numbers are never reused (gap-free sequence includes
    cancelled documents) [Verified].
- **Existing controls:**
  - CTL-609 Gap-free document numbers per company and document kind, assigned inside the
    creating transaction (a failed save releases the number).
  - CTL-610 Only active stock-tracked items of the same company can be ordered.
  - CTL-611 Lines editable only while draft (database trigger), header version check.
  - CTL-612 Permission checked at the receiving branch, and at both branches when the branch
    is changed.
  - CTL-613 Audit entries on create and update (update without before/after values).
- **Financial / stock / cash effect:** None. A draft is a commitment document only; totals are
  computed on request (ordered value, received value) and never stored.
- **Upstream dependencies:** BP-601 active supplier; active branch; catalog items flagged as
  stock-tracked (catalog domain).
- **Downstream effects:** BP-604…BP-608; the order's unit cost becomes the stock cost at
  receipt (BP-606) and therefore feeds inventory valuation and gross profit (Reports).
- **Observations:** FND-601, FND-608, FND-617, FND-619, FND-620.

#### BP-604 Submit a purchase order for approval
- **Business purpose:** Freeze the order and hand it to an approver.
- **Actors and required authority:** "Create purchase orders and suppliers" at the branch.
- **Trigger / inputs:** Draft order; the current version.
- **Normal flow:**
  1. On the order page the manager presses *Submit for approval*.
  2. System locks the order row, checks status *draft* and version, sets status *submitted*
     with the submission time, increments the version, and writes audit "purchase order
     submitted".
  3. From now on nothing on the order can be edited; the only exits are approval (BP-605) or
     cancellation (BP-608). There is no "reject back to draft" action [Verified, FND-611].
- **Exceptional cases and their handling:**
  - Submitting a non-draft → "invalid state" [Verified].
  - Editing after submission → "invalid state" [Verified by test].
- **Existing controls:**
  - CTL-614 Row lock + version check on every state change (no double transition).
  - CTL-615 Status machine enforced in the service; final states additionally enforced by a
    database trigger.
- **Financial / stock / cash effect:** None. A submitted order becomes eligible to be named on
  a supplier payment (BP-609) even though nothing is approved or received [Verified].
- **Upstream dependencies:** BP-603.
- **Downstream effects:** BP-605, BP-609.
- **Observations:** FND-602, FND-611.

#### BP-605 Approve a purchase order
- **Business purpose:** Authorise the commitment towards the supplier by a second person.
- **Actors and required authority:** "Approve purchase orders" at the receiving branch, and
  not the person who created the order; the owner may approve their own orders.
- **Trigger / inputs:** Submitted order; the current version.
- **Normal flow:**
  1. Approver opens the order and presses *Approve*.
  2. System locks the row, checks status *submitted* and version, refuses if the approver is
     the creator (unless owner), sets status *approved* with approver and time, writes audit
     "purchase order approved".
  3. The order is now receivable (BP-606) and cancellable until the first receipt (BP-608).
- **Exceptional cases and their handling:**
  - Self-approval by a non-owner → "another person must approve" [Verified by test].
  - Branch managers hold no approval right by default; their orders wait for a company
    manager or the owner [Verified by test].
  - No approval thresholds by amount, no second approver for large orders, no budget check
    [Verified, FND-608].
  - The approver cannot be the creator, but the approver may later receive the goods, and the
    creator may receive the goods; only the approval step is segregated [Verified, FND-606].
  - The supplier or branch may have been deactivated between submission and approval; approval
    does not re-check them [Verified].
- **Existing controls:**
  - CTL-616 Creator-cannot-approve rule enforced in the service (BR-101).
  - CTL-617 Approver identity and time stored on the document and in the audit log.
  - CTL-618 Approval permission is separate from creation and from receiving.
- **Financial / stock / cash effect:** None yet. The order's value counts in the purchasing
  report as "open value" from approval until it is fully received, closed or cancelled.
- **Upstream dependencies:** BP-604.
- **Downstream effects:** BP-606, BP-607, BP-608, BP-609, BP-615.
- **Observations:** FND-606, FND-608.

#### BP-606 Receive goods against an approved order (full or partial delivery)
- **Business purpose:** Bring delivered goods into the branch's stock at the agreed cost and
  keep the order's open quantity exact across several deliveries.
- **Actors and required authority:** "Receive goods" at the order's branch.
- **Trigger / inputs:** Physical delivery. Inputs: for each order line the quantity received
  now (> 0 on included lines), optional supplier invoice / delivery note reference (≤ 80
  characters), optional note, and a fresh idempotency key generated by the screen.
- **Normal flow:**
  1. Receiver opens the order (status *approved* or *partly received*) and presses *Receive
     delivery*. The dialog lists each line with its remaining quantity and **prefills the
     "receiving now" field with the full remaining quantity** [Verified, FND-607].
  2. Receiver corrects quantities, enters the supplier's reference, confirms.
  3. System first looks for a receipt with the same idempotency key: if found with the same
     payload it simply returns the order (safe retry); if found with a different payload it
     refuses ("key already used for another delivery").
  4. Inside one transaction the system locks the order row, checks status, recomputes each
     line's received quantity from all existing receipts, and refuses any line that would
     exceed what is still open ("more than is still open on the order"); duplicate lines in
     the request are refused; a line position that does not exist is refused.
  5. A goods-receipt document is created with the next gap-free number (GR-000001 …), the
     receiver, the reference, the key and a hash of the request; receipt lines store quantity
     **and the order line's unit cost** (copied, not entered).
  6. The inventory engine posts one *purchase receipt* movement per line at that unit cost:
     on-hand rises; the branch's weighted-average cost is recalculated
     ((old qty × old avg + received qty × order cost) ÷ new qty, rounded half-up to the
     fils); if the branch had zero/negative stock or no known cost, the order cost simply
     becomes the average [Verified: test 10 @ 1.000 + 4 @ 1.500 → 1.143].
  7. The order becomes *received* when every line's received quantity reaches the ordered
     quantity, otherwise *partly received*. Audit "purchase order received" records the
     receipt number, the lines and quantities, and whether the order is complete.
- **Exceptional cases and their handling:**
  - Over-receipt refused with zero tolerance; the remaining quantity is returned in the error
    [Verified by test: 6.001 against 6 open refused].
  - Retries with the same key never duplicate stock (test: four identical requests → stock 3).
  - Concurrent different deliveries racing for the remaining quantity: the row lock serialises
    them; only what is open is accepted (test: 2 of 4 accepted) [Verified].
  - Receiving a draft, submitted, closed, cancelled or fully received order → "invalid state"
    [Verified by test].
  - **Price on delivery cannot differ from the order.** The receipt has no price field; the
    receipt line copies the order cost. If the supplier invoices a different price, the
    system offers no way to correct the cost of the received stock or to record a variance
    [Verified, FND-601].
  - **Supplier invoice is not a document.** The free-text reference is the only trace; it is
    not unique, so the same invoice can be referenced on two receipts or two orders without
    warning [Verified, FND-614].
  - No batch/lot/expiry capture on receipt (relevant for restaurant stock) [Verified].
  - The receipt date is the posting time; a delivery received on Friday and keyed on Sunday
    counts on Sunday [Verified, FND-619].
  - Receipts are permanent: the database forbids update and delete of receipts and receipt
    lines. There is no "reverse a receipt" document; a wrong receipt can only be corrected by
    an inventory adjustment (inventory domain), which breaks the link to the order and leaves
    the order's received quantity overstated [Verified, FND-601].
  - A received (complete) order can never be reopened; closed and cancelled orders are final
    (database trigger) [Verified].
- **Existing controls:**
  - CTL-619 Idempotency key + request hash per company: safe retries, mismatched replays
    refused.
  - CTL-620 Order row lock while receiving; received quantities derived from receipts, never
    stored counters.
  - CTL-621 Hard cap: received ≤ ordered per line, no tolerance.
  - CTL-622 Receipt documents append-only (no update/delete rights), gap-free GR numbers.
  - CTL-623 Stock posted only through the single inventory engine, which writes an
    append-only movement carrying quantity, unit cost, value, average after, source document
    and user.
  - CTL-624 Cost of received stock is the approved order cost — nobody, including the owner,
    can change a line's cost after submission (database trigger on lines).
  - CTL-625 Audit of each receipt with lines and completion flag.
- **Financial / stock / cash effect:** Branch on-hand quantity increases by the received
  quantities; the branch average cost moves towards the order cost; inventory value rises by
  Σ quantity × order cost (per receipt line, half-up). The order's "received value" rises.
  No cash and no payable moves. The order and receipt become the evidence of goods received
  for any later supplier-statement reconciliation.
- **Upstream dependencies:** BP-605 (approved order). Opening stock/avg cost at the branch
  (inventory domain) determines the resulting average.
- **Downstream effects:** Inventory valuation and gross profit (Reports: BR-128, ADR-0070),
  POS availability, purchasing report receipts list and supplier totals (BP-615), supplier
  *Purchased* figure (BP-602). A receipt also makes an order "payable" in the picker (any
  non-draft, non-cancelled order already is).
- **Observations:** FND-601, FND-606, FND-607, FND-612, FND-614, FND-619.

#### BP-607 Close a partially received order with open quantities
- **Business purpose:** Formally give up the undelivered remainder (supplier out of stock,
  order reduced) so that the open commitment disappears from reports.
- **Actors and required authority:** "Approve purchase orders" at the branch.
- **Trigger / inputs:** Order in *partly received*; a reason (required, ≤ 500 characters);
  current version.
- **Normal flow:**
  1. Approver presses *Close*, types the reason, confirms.
  2. System locks the row, checks status *partly received*, requires the reason, sets status
     *closed* with the closer, time and reason; audit "purchase order closed" with the reason.
  3. Further receipts are refused; the closed order is final.
- **Exceptional cases and their handling:**
  - Missing reason → validation error (400) [Verified by test].
  - Closing an approved order with no receipts is not possible; it must be cancelled (BP-608)
    [Verified].
  - Closing does not touch stock; what was received stays received.
- **Existing controls:**
  - CTL-626 Reason mandatory and stored on the document and in the audit log.
  - CTL-627 Only the approval role may close; final state enforced by trigger.
- **Financial / stock / cash effect:** Open value of the order drops to zero in the
  purchasing report; "ordered value" of the period still shows the full original order (not
  reduced) [Verified, FND-621].
- **Upstream dependencies:** BP-606 at least one receipt.
- **Downstream effects:** BP-615.
- **Observations:** FND-621.

#### BP-608 Cancel a purchase order before any receipt
- **Business purpose:** Withdraw an order that will not be executed.
- **Actors and required authority:** "Create purchase orders and suppliers" **or** "Approve
  purchase orders" at the branch (the route itself is gated only by the read permission).
- **Trigger / inputs:** Order in *draft*, *submitted* or *approved*; optional reason; version.
- **Normal flow:**
  1. User presses *Cancel* on the order page (no dialog, no reason asked by the screen).
  2. System locks, checks status, sets *cancelled* with the user, time and reason (null when
     none), audit "purchase order cancelled".
- **Exceptional cases and their handling:**
  - Any order with a receipt → "orders with deliveries cannot be cancelled; close them"
    [Verified by test].
  - The creator may cancel an order that another person already approved; no second person
    is involved and no reason is required [Verified, FND-611].
  - Cancelled orders are excluded from supplier order counts and from the payable-order picker
    [Verified].
- **Existing controls:**
  - CTL-628 Cancellation blocked once goods were received (stock integrity).
  - CTL-629 Final state immutable; actor and time recorded.
- **Financial / stock / cash effect:** None. If a supplier payment already named the order
  (allowed from *submitted*), the payment stays linked to a cancelled order; nothing flags it
  [Verified, FND-602].
- **Upstream dependencies:** BP-603/604/605.
- **Downstream effects:** BP-615 (excluded from ordered value).
- **Observations:** FND-602, FND-611.

#### BP-609 Pay a supplier (cash disbursement linked to a supplier and optionally an order)
- **Business purpose:** Record real cash leaving the business towards a supplier, attributed
  to the supplier and, when known, to one purchase order. This is the only financial
  relationship with suppliers that the system keeps; it is deliberately **not** an
  accounts-payable ledger (BR-087, OQ-018).
- **Actors and required authority:** From a branch treasury in the management app: "Manage
  cash custody" at the paying branch. From a register drawer at the POS: "Record cash in /
  cash out" during the user's own open shift.
- **Trigger / inputs:** Supplier (active), amount > 0, optional purchase order of the same
  supplier that is not a draft and not cancelled, optional description and receipt reference,
  idempotency key. At the POS: supplier and amount; no order can be named [Verified].
- **Normal flow (management):**
  1. Manager opens *Cash → disbursements*, chooses kind "supplier payment", branch, supplier,
     optionally one of the supplier's orders (picker lists up to 50 latest non-draft,
     non-cancelled orders of that supplier, any branch), amount, reference.
  2. System checks supplier active and order belongs to the supplier and is payable; locks
     the branch treasury, requires it to have an opening count and enough cash; posts one
     ledger entry of type "supplier payment" on the treasury; stores the disbursement with
     the next SP- number; audit "cash disbursement created".
  3. The payment appears on the supplier page (BP-602), in the cash disbursement list and in
     the expenses report "by supplier" (Reports).
  4. A mistake is corrected by a reversal (reason required): a mirrored record puts the cash
     back; the original is never edited. Only one reversal per payment [Verified].
- **Exceptional cases and their handling:**
  - Order of another supplier → validation error; draft or cancelled order → "cannot be
    paid"; inactive supplier → refused [Verified by test].
  - **No ceiling:** the amount is not compared with the order value, with the received value
    or with previous payments; the same order can be paid twice or for more than its value;
    an order can be paid while merely *submitted* (not approved, nothing received)
    [Verified, FND-602].
  - The paying branch need not be the order's branch [Verified].
  - At the POS the supplier payment cannot name an order and the reference is optional; the
    payment is attributed to the supplier only [Verified, FND-602].
  - The database guard guarantees a reversal mirrors its original (same kind, amount,
    supplier, order, branch, source) and that each disbursement has exactly one ledger entry
    [Verified: migration 0035].
- **Existing controls:**
  - CTL-630 Supplier must be active; order must be the supplier's and not draft/cancelled.
  - CTL-631 Cash cannot leave a treasury that was never counted or that does not hold the
    amount; drawer cannot pay more than it holds.
  - CTL-632 Disbursements append-only; reversal-only correction with reason; one reversal.
  - CTL-633 Idempotency key per disbursement (safe retries).
  - CTL-634 Documented numbering SP-… and audit entries.
- **Financial / stock / cash effect:** Cash place (treasury or drawer) decreases; "cash by
  type" and the expenses report increase under supplier payments (not operating expenses);
  nothing changes on the order, the receipt or the stock. No payable balance exists to
  decrease.
- **Upstream dependencies:** BP-601 active supplier; BP-604 for an order link; cash custody
  (treasury counted) from the cash domain.
- **Downstream effects:** Cash reports and expenses report (Reports), supplier page totals
  (BP-602).
- **Observations:** FND-601, FND-602.

#### BP-610 Request a branch stock transfer
- **Business purpose:** Ask for goods to be moved from one branch to another (a "pull" by the
  receiving branch or a "push" by the sending branch).
- **Actors and required authority:** "Request, dispatch and receive transfers" at the source
  **or** at the destination.
- **Trigger / inputs:** Source branch, destination branch (different, both active), optional
  note (≤ 500), 1–300 lines with distinct stock-tracked active items and requested quantity
  > 0.
- **Normal flow:**
  1. User opens *Transfers → New transfer*, picks the two branches; the item picker shows the
     on-hand at the **source**; enters requested quantities; presses *Request transfer*.
  2. System checks both branches active, items valid, draws the next TR- number, stores the
     header (status *requested*, requester) and lines (requested quantity), audit "transfer
     requested".
- **Exceptional cases and their handling:**
  - Same branch twice → refused; duplicate item → refused; inactive branch → refused
    [Verified].
  - Requested quantity is not checked against the source's on-hand at request time (only at
    dispatch) [Verified].
  - A branch manager of neither branch cannot request a transfer between them [Verified by
    test].
  - Requested quantities and items can never be changed after creation (database trigger);
    there is no draft state and no edit — a wrong request must be cancelled and redone
    [Verified].
- **Existing controls:**
  - CTL-635 Gap-free TR numbers; requester and time recorded.
  - CTL-636 Requested lines immutable after creation (trigger).
  - CTL-637 Permission at one of the two branches; both branches must belong to the company
    (composite foreign keys + RLS).
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** Two active branches; stock items.
- **Downstream effects:** BP-611…BP-614.
- **Observations:** FND-605.

#### BP-611 Approve a transfer at the source branch
- **Business purpose:** Let the branch that gives up the stock authorise the movement.
- **Actors and required authority:** "Approve transfers" at the **source** branch.
- **Trigger / inputs:** Transfer in *requested*; version.
- **Normal flow:**
  1. Approver presses *Approve*; system locks, checks status and version, sets *approved*
     with approver and time; audit "transfer approved".
- **Exceptional cases and their handling:**
  - Destination's manager cannot approve [Verified by test].
  - **The requester may approve their own request** if they hold the approval right at the
    source; unlike purchase orders there is no creator-cannot-approve rule [Verified,
    FND-605].
  - No value or quantity threshold.
- **Existing controls:**
  - CTL-638 Approval right separate from the operational transfer right and checked at the
    source.
  - CTL-639 Approver identity and time on the document and in the audit log.
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-610.
- **Downstream effects:** BP-612, BP-614.
- **Observations:** FND-605.

#### BP-612 Dispatch a transfer (stock leaves the source and is "in transit")
- **Business purpose:** Record that goods physically left the sending branch and fix the
  cost at which they travel.
- **Actors and required authority:** "Request, dispatch and receive transfers" at the source.
- **Trigger / inputs:** Approved transfer; per line the dispatched quantity (0 ≤ q ≤
  requested; the dialog prefills the requested quantity); version. A note field exists on the
  request but is ignored by dispatch [Verified].
- **Normal flow:**
  1. Dispatcher presses *Dispatch*, adjusts quantities, confirms.
  2. System locks the transfer, checks status *approved* and version, validates quantities
     (positions exist, no duplicates, none above requested, at least one line > 0).
  3. The inventory engine posts a *transfer out* movement per moving line at the source with
     negative stock **always denied** regardless of the company's negative-stock policy, and
     respecting active online reservations; the movement's unit cost is the source's current
     average cost (or the item's catalogue cost when no average exists; null when neither).
  4. The dispatched quantity and that unit cost are written on each line (lines not included
     in the request get dispatched 0); status becomes *in transit* with dispatcher and time;
     audit "transfer dispatched" with the quantities.
- **Exceptional cases and their handling:**
  - More than requested → refused; source holds less than dispatched → "insufficient stock"
    even when the company allows negative stock [Verified by test].
  - Two dispatches racing on the same transfer: one succeeds, the other gets a version
    conflict [Verified by test].
  - Dispatching less than requested (or 0 for a line) needs no reason and leaves no note; the
    difference is simply not sent and is not re-requested automatically [Verified, FND-618].
  - After dispatch the transfer can neither be cancelled nor returned to the source through
    the system; the only exit is receipt at the destination [Verified, FND-604].
  - Lines whose unit cost is unknown travel without a cost; the destination then receives
    them at its own average or catalogue cost, and the discrepancy value is unknown
    [Verified, FND-625].
- **Existing controls:**
  - CTL-640 Stock can never be dispatched below zero or from reserved online stock.
  - CTL-641 Dispatched quantity and unit cost set once (trigger), movement append-only.
  - CTL-642 Row lock + version; status machine; audit with lines.
  - CTL-643 Unit cost shown only to users with cost visibility (prices/costs right or
    inventory reports at the source).
- **Financial / stock / cash effect:** Source on-hand decreases; the source's average cost is
  unchanged; inventory value at the source falls by dispatched quantity × average cost. The
  goods are now in **no branch's balance**: they are not in any stock level, not in the
  inventory valuation report, and not in the item's company-wide total (test: total 5 while
  5 are in transit, 9 after receipt of 4) [Verified, FND-604].
- **Upstream dependencies:** BP-611; sufficient source stock.
- **Downstream effects:** BP-613; purchasing report transfers section (dispatched value by
  branch pair, period = dispatch date).
- **Observations:** FND-604, FND-605, FND-618, FND-625.

#### BP-613 Receive a transfer at the destination, with discrepancy write-off
- **Business purpose:** Bring the goods into the destination's stock at the cost they left
  with, and account for anything that did not arrive.
- **Actors and required authority:** "Request, dispatch and receive transfers" at the
  **destination**.
- **Trigger / inputs:** Transfer in transit; per line the received quantity (0 ≤ q ≤
  dispatched; the dialog prefills the dispatched quantity); a note that becomes mandatory as
  soon as any line is short; version.
- **Normal flow:**
  1. Receiver presses *Receive*, enters what arrived, explains any shortage, confirms.
  2. System locks, checks status *in transit* and version, validates quantities (no line above
     dispatched), requires the note when short.
  3. The inventory engine posts a *transfer in* movement per arriving line at the destination
     **at the dispatch unit cost**; the destination's weighted average is recalculated with
     that cost (test: destination average becomes 1.200) [Verified].
  4. Received quantities are written once; status *received* with receiver, time and the
     discrepancy note (stored only when short); audit "transfer received" or "transfer
     received with discrepancy" listing dispatched vs received per line.
  5. The screen shows per line and in total the *Missing* quantity (dispatched − received)
     and the note.
- **Exceptional cases and their handling:**
  - More than dispatched → refused; surplus that physically arrived cannot be recorded on the
    transfer and must be booked as an inventory adjustment at the destination, without a link
    to the transfer [Verified, FND-622].
  - Short without a note → validation error (400) [Verified by test and e2e].
  - **The write-off is not a posting.** No stock movement, no adjustment document and no value
    entry is created for the missing quantity at either branch; the loss is the silent gap
    between the *transfer out* and the *transfer in*. Its value (missing × dispatch cost) is
    computed only in the purchasing report's transfer table [Verified, FND-603].
  - **Nobody approves the write-off.** The receiver alone decides the received quantity and
    writes the explanation; there is no threshold, no second approval, no acknowledgement by
    the sending branch, no claim or insurance follow-up [Verified, FND-603].
  - A transfer is received exactly once; there is no partial receipt followed by a later
    arrival of the rest; whatever is not keyed as received at that moment is missing
    forever on that document [Verified].
  - The receiver's note is discarded when nothing is short [Verified, FND-618].
  - A source manager alone cannot receive at the destination [Verified by test].
- **Existing controls:**
  - CTL-644 Received ≤ dispatched per line (service and database check constraint).
  - CTL-645 Shortage explanation mandatory; discrepancy visible on the document, the list
    (*Missing* column) and the purchasing report with its value.
  - CTL-646 Receipt at dispatch cost (no re-pricing between branches).
  - CTL-647 Received quantities set once; final state immutable (trigger); movement
    append-only.
  - CTL-648 Audit entry names the discrepancy explicitly (distinct action).
- **Financial / stock / cash effect:** Destination on-hand rises by received quantities;
  destination average moves towards the dispatch cost; inventory value at the destination
  rises by received × dispatch cost. Company stock value falls permanently by missing ×
  dispatch cost without any document of its own. No cash effect.
- **Upstream dependencies:** BP-612.
- **Downstream effects:** Inventory valuation (Reports), POS availability at the destination,
  purchasing report transfers table (missing quantity and value), inventory movements report
  (shows the in/out movements but not the loss as such).
- **Observations:** FND-603, FND-604, FND-613, FND-618, FND-622, FND-625.

#### BP-614 Cancel a transfer before dispatch
- **Business purpose:** Withdraw a request that is no longer needed.
- **Actors and required authority:** The requester, or a holder of "Approve transfers" at the
  source; the route also requires the operational transfer right somewhere.
- **Trigger / inputs:** Transfer in *requested* or *approved*; version. No reason field.
- **Normal flow:**
  1. User presses *Cancel*; system locks, checks status and version, sets *cancelled* with
     user and time; audit "transfer cancelled".
- **Exceptional cases and their handling:**
  - After dispatch → "transfers can only be cancelled before dispatch" [Verified by test].
  - No reason recorded [Verified, FND-611].
- **Existing controls:**
  - CTL-649 Cancellation blocked once stock moved; final state immutable.
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-610/611.
- **Downstream effects:** None.
- **Observations:** FND-604, FND-611.

#### BP-615 Purchasing and transfer reporting
- **Business purpose:** Give management and auditors a periodic view of commitments, goods
  received, supplier activity and inter-branch movements including losses in transit.
- **Actors and required authority:** "Inventory reports and valuation" for the branches in
  the report; costs on transfer documents additionally need cost visibility.
- **Trigger / inputs:** *Reports → Purchasing* tab with a period (whole local days, ≤ 366)
  and branch filter; CSV export of each table built from the displayed values.
- **Normal flow:** The report computes on demand [Verified]:
  1. Summary: orders created in the period (excluding drafts and cancelled, including closed)
     and their full ordered value; receipts in the period and their value (Σ receipt lines
     quantity × order cost, half-up per receipt line); open orders **as of now** (approved
     or partly received, not period-bound) and their open value.
  2. By supplier: orders and ordered value, receipts and received value, last receipt date.
  3. Receipt list (up to 1000): GR number, order number, supplier, branch, receiver, time,
     supplier reference, value.
  4. Transfers by branch pair, keyed on the **dispatch date**: number of transfers,
     dispatched and received quantities, missing quantity and missing value (received
     transfers only), dispatched value at dispatch cost.
- **Exceptional cases and their handling:**
  - Transfers still in transit at period end appear with dispatched value but no received or
    missing figures; there is no "in-transit balance" or aging view anywhere [Verified,
    FND-604].
  - Ordered value is not reduced for closed orders [Verified, FND-621].
  - Received value on the order page is rounded per order line over all receipts, whereas the
    report and the supplier list round per receipt line; totals can differ by a fils
    [Verified, FND-612].
  - Supplier payments are reported in the cash/expenses report, not here; no report puts
    received value and paid amount side by side per supplier or per order [Verified,
    FND-602].
- **Existing controls:**
  - CTL-650 Reports read the source documents directly (no summary tables to drift).
  - CTL-651 Branch scoping applied to orders, receipts and both ends of transfers.
- **Financial / stock / cash effect:** Read-only.
- **Upstream dependencies:** BP-603…BP-613.
- **Downstream effects:** Management review, external audit sampling of GR documents.
- **Observations:** FND-604, FND-612, FND-621.

#### BP-616 Supplier invoice matching, returns to supplier and landed costs (not implemented — what staff do today)
- **Business purpose:** Normally: match the supplier's invoice against order and receipt
  before payment (three-way match), send defective or excess goods back with a credit note,
  and add freight/customs to the cost of goods. The owner has left all three open (OQ-018;
  ADR-0070 for landed costs).
- **Actors and required authority:** Not applicable; described so the manual is honest about
  the gap.
- **Trigger / inputs:** Supplier invoice received; goods to return; freight bill.
- **Normal flow (actual practice the system allows):**
  1. **Invoice:** the receiver types the invoice or delivery-note number into the free-text
     reference on the goods receipt (BP-606). Quantity matching is implicit (receipt ≤
     order). Price matching does not exist: the system's cost is the order cost. Payment
     (BP-609) may name the order but checks nothing against it.
  2. **Return to supplier:** no document. Staff would post an inventory *decrease adjustment*
     with a reason at the branch (inventory domain). The stock leaves at the current average
     cost (not the purchase cost), the supplier is not named, no credit expected is recorded,
     and the order's received value stays unchanged [Inferred from the inventory contracts
     and ledger].
  3. **Landed costs:** freight, customs and handling paid in cash are recorded as expenses
     (category transport or other) in the cash domain; they never enter stock value or gross
     profit's cost of sales [Verified: ADR-0070 statement and absence of any cost field other
     than the order unit cost].
- **Exceptional cases and their handling:** None; the processes do not exist.
- **Existing controls:** None specific. CTL-623 (append-only movements) at least leaves an
  audit trail of the workaround adjustments.
- **Financial / stock / cash effect:** Three-way-match absence: cash may be paid for goods
  not received or at the wrong price without system resistance. Returns via adjustment:
  stock value falls at average cost; no receivable from the supplier is tracked. Landed
  costs: inventory value and cost of sales understated; expenses overstated in the period
  the freight is paid rather than when goods are sold.
- **Upstream dependencies:** Owner decision OQ-018 and a landed-cost policy.
- **Downstream effects:** Reports (gross profit, inventory value), cash domain.
- **Observations:** FND-601, FND-615, FND-616.

### F.3 Interdependencies with other domains

Purchasing is the main *inflow* side of the inventory engine and the only source of a
documented unit cost for bought-in goods; transfers redistribute that stock and its cost
between branches. The domain has no cash of its own: money reaches suppliers through the
cash-custody domain, which merely tags the payment with a supplier and an order. Reports read
all of these documents directly. Authority comes from the roles domain; branch activity
status from the branches domain; item eligibility (stock-tracked, active) from the catalog.

| This domain → other domain | What flows | Direction / nature |
|---|---|---|
| Purchasing → Inventory | Purchase-receipt movements (quantity, order cost) that raise on-hand and recompute the weighted-average cost; transfer out / transfer in movements | Stock and stock value |
| Inventory → Purchasing | Current on-hand and average cost shown in the item picker; negative-stock policy ignored for dispatch; online reservations respected at dispatch | Data / constraint |
| Purchasing → Reports | Orders, receipts, transfers (dispatched, received, missing and their values); order cost feeds inventory valuation (BR-128) and gross profit (ADR-0070) | Data, period cut-off on created/dispatched time |
| Cash custody → Purchasing | Supplier payments (SP-) and POS drawer payments tagged with supplier and optional order; shown on the supplier page; reversals mirrored | Money (outflow), reference only |
| Purchasing → Cash custody | Supplier activity status gates payments; order must be non-draft/non-cancelled to be named | Authority / validation |
| Roles & auth → Purchasing | Four purchasing permissions, two transfer permissions, cost-visibility permissions; owner bypass; branch scoping | Authority |
| Branches → Purchasing | Only active branches can be ordered for or transferred between; branch deactivation with open orders is not checked here | Constraint |
| Catalog → Purchasing | Only active, stock-tracked variants can be ordered or transferred; catalogue cost is the fallback when a branch has no average | Data |
| Online store → Transfers | Active reservations reduce what can be dispatched | Constraint |
| Audit log → all | Every create/transition/receipt writes an append-only audit entry | Traceability |

### F.4 Findings

#### FND-601 No supplier invoice and no three-way match; delivery price cannot differ from the order
- **Classification:** Missing process / Financial risk
- **Severity:** High
- **Evidence:** [Verified] The goods receipt copies the order line's unit cost and offers no
  price field; the only invoice trace is an optional free-text reference. There is no invoice
  document, no price variance, no way to re-cost received stock, and no way to reverse a
  receipt. The purchase order's lines are frozen by a database trigger after submission, so
  not even the owner can correct a cost. A supplier payment may name an order but is not
  compared with it.
- **Potential financial impact:** Stock is valued and cost of sales computed at the *agreed*
  price, not the *invoiced* price; price increases, discounts, freight on the invoice and
  invoice errors go unnoticed in inventory value and gross profit. Payments can be released
  without any system evidence that the invoice equals goods received at the agreed price.
- **Affected procedures:** BP-606, BP-609, BP-616
- **Recommendation:** Introduce a supplier invoice document matched to one or more receipts
  (quantity) and to the order (price) with a tolerance; record a price variance movement when
  the invoice price differs (either revalue the remaining stock or post the difference as a
  period variance — a policy decision for the owner); allow a receipt reversal document
  ("goods receipt correction") instead of a loose adjustment. Until then, make the supplier
  reference mandatory on receipts and payments and require that a payment naming an order
  cannot exceed that order's received value (see FND-602).

#### FND-602 Supplier payments are unbounded and unmatched: overpayment, duplicate and prepayment risk
- **Classification:** Control gap / Financial risk (partly an owner decision: no payable balance, BR-087/OQ-018)
- **Severity:** High
- **Evidence:** [Verified] A supplier payment may name any order of the supplier that is not a
  draft or cancelled — including a merely *submitted* order with nothing approved or
  received — and the amount is not checked against the order value, the received value or
  earlier payments; the same order can be paid repeatedly. The paying branch need not be the
  order's branch. POS drawer payments to a supplier cannot name an order and need no reference.
  No screen shows paid versus received per order; the supplier page shows total paid and the
  supplier list shows total purchased, both company-wide only for some roles (FND-609).
- **Potential financial impact:** Cash can be paid twice for one delivery, paid before goods
  arrive, or paid for more than was received, with the only detection being a manual
  comparison of two totals. In a multi-branch business with several people holding cash
  custody this is the most direct cash-leakage path in the domain.
- **Affected procedures:** BP-602, BP-604, BP-608, BP-609
- **Recommendation:** Even without a full payable ledger: (1) show on each order the
  cumulative payments that name it and warn/block when they would exceed the received value
  (or the ordered value for agreed prepayments, with a distinct "advance" flag and approval);
  (2) require a reference (invoice number) on every supplier payment and refuse a reference
  already used for the same supplier; (3) restrict POS drawer payments to suppliers to a
  per-payment limit or remove them in favour of treasury payments; (4) add a "received vs
  paid by supplier" report. The owner should revisit OQ-018: a minimal payable position per
  supplier (Σ received value − Σ payments) can be derived from existing data without a
  general ledger.

#### FND-603 Transfer discrepancy write-off is self-approved and never posted
- **Classification:** Control gap / Financial risk; also Inconsistency (doc vs behaviour)
- **Severity:** High
- **Evidence:** [Verified] At receipt, the destination user alone keys the received quantity;
  if short, a free-text note is the only requirement. No stock movement, adjustment document
  or value entry is created for the missing quantity at either branch; the loss is the gap
  between *transfer out* and *transfer in*. Its value appears only in the purchasing report's
  transfer table (missing × dispatch cost). BR-104, ADR-0064 and PROGRESS say the quantity is
  "written off" — it is recorded on the transfer, but no write-off posting exists. No
  threshold, second approval, source-branch acknowledgement or follow-up status exists.
- **Potential financial impact:** Shrinkage and theft between branches can be laundered as
  "missing in transit" by either the dispatcher or the receiver with no counter-signature; the
  loss does not surface in inventory movement or adjustment reports, only in a secondary
  table of the purchasing report, and no responsible party is recorded.
- **Affected procedures:** BP-612, BP-613
- **Recommendation:** Post the shortage as an explicit, append-only "transfer loss" movement
  (or adjustment with reason "transfer discrepancy") at a defined owner (source or destination
  per policy) so it appears in movement and adjustment reports with its value; require
  approval by a holder of the transfer-approval right at the source (or by the owner above a
  value threshold) before the transfer is final; notify the source branch; keep a status
  "received with discrepancy — pending review" with a resolution note; consider a carrier
  hand-over step (dispatched quantity countersigned).

#### FND-604 Stock in transit is not valued, not aged and cannot be recalled
- **Classification:** Financial risk / Missing process
- **Severity:** High
- **Evidence:** [Verified] After dispatch the goods are in no branch's stock level; the
  inventory valuation report and the item's company total exclude them (test: total 5 while 5
  are in transit). The purchasing report shows dispatched value for the period but no
  in-transit balance as of a date and no aging. A transfer cannot be cancelled or returned
  after dispatch; the only exit is receipt at the destination, so a transfer the destination
  never receives keeps company stock understated indefinitely.
- **Potential financial impact:** Inventory value at month end is understated by the value
  of everything in transit; management can neither see nor chase old open transfers;
  "lost" transfers never surface as a loss because they are never received (and FND-603 means
  even a received loss is not posted).
- **Affected procedures:** BP-612, BP-613, BP-614, BP-615
- **Recommendation:** Treat in-transit as a company-level stock location: show an "in
  transit" line in the inventory valuation (Σ dispatched − received × dispatch cost over
  transfers in transit) and an open-transfers list with age; allow the source (with approval)
  to recall an in-transit transfer (posting a transfer-in back at the source) or to mark it
  lost (posting the loss per FND-603); alert when a transfer is in transit beyond a configurable
  number of days.

#### FND-605 No segregation of duties on transfers
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** [Verified] The requester may approve their own transfer if they hold the
  approval right at the source; a company manager (merchant-wide role) can request, approve,
  dispatch and receive the same transfer alone; the owner can do everything. Purchase orders
  have a creator-cannot-approve rule; transfers have none.
- **Potential financial impact:** One person can move stock between branches and declare a
  shortage with nobody else involved (combined with FND-603).
- **Affected procedures:** BP-610, BP-611, BP-612, BP-613
- **Recommendation:** Apply the same rule as BR-101 (requester cannot approve, owner exempt
  if the owner so decides) and prevent the dispatcher from also being the receiver of the same
  transfer; record both names prominently on the document.

#### FND-606 Only approval is segregated on purchase orders; creator or approver may receive
- **Classification:** Control gap (partly Owner decision: owner exempt, BR-101)
- **Severity:** Medium
- **Evidence:** [Verified] The default branch manager creates and receives; the company
  manager creates, receives and approves others' orders; the approver may receive. The owner
  creates, approves and receives alone (documented exception). No value threshold triggers a
  stronger approval.
- **Potential financial impact:** A buyer who also receives can confirm receipt of goods that
  never arrived (fictitious purchases paid in cash via FND-602).
- **Affected procedures:** BP-603, BP-605, BP-606
- **Recommendation:** Offer a setting "receiver must differ from creator" (default on for
  orders above a threshold) and a value threshold above which a second approver or the owner
  is required; keep the owner exemption as an explicit owner decision with periodic review of
  owner-created orders.

#### FND-607 Receiving dialogs prefill the full expected quantity (no blind receiving)
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** [Verified] The goods-receipt dialog prefills "receiving now" with the full
  remaining quantity; the transfer dispatch dialog prefills the requested quantity and the
  transfer receipt dialog prefills the dispatched quantity. One click confirms everything.
- **Potential financial impact:** Short deliveries are booked as complete; stock is
  overstated at the order cost and the supplier is paid for goods not received.
- **Affected procedures:** BP-606, BP-612, BP-613
- **Recommendation:** Leave received quantities blank (or offer a merchant setting for blind
  receiving where the expected quantity is hidden until entered), and require an explicit
  confirmation when the receiver accepts the full remaining quantity on orders above a value
  threshold.

#### FND-608 No value-based approval limits or budget on purchase orders
- **Classification:** Missing process
- **Severity:** Medium
- **Evidence:** [Verified] Any holder of the approval right at the branch approves any amount;
  no second level, no budget or spend limit per supplier/branch/period.
- **Potential financial impact:** Large commitments approved by a single company manager
  without the owner's knowledge.
- **Affected procedures:** BP-605
- **Recommendation:** Add per-role or per-user approval limits and an "owner approval above X"
  rule; show the period's committed value against a branch budget on the report.

#### FND-609 Supplier list shows company-wide purchase totals to branch-scoped users
- **Classification:** Inconsistency (behaviour vs behaviour) / Control gap (information)
- **Severity:** Low
- **Evidence:** [Verified] The supplier list's order count and *Purchased* total sum all
  branches, while the order list and the supplier payments are filtered to the viewer's
  branches. A branch manager thus sees other branches' purchase volumes per supplier and
  compares them with payments of only their own branches.
- **Potential financial impact:** Misleading comparison; minor confidentiality leakage.
- **Affected procedures:** BP-601, BP-602
- **Recommendation:** Scope the supplier totals to the viewer's branches or label them as
  company-wide and hide them from branch-scoped users.

#### FND-610 Supplier creation needs a merchant-wide right while the screen and the catalogue suggest branch scope
- **Classification:** Inconsistency (doc vs behaviour)
- **Severity:** Low
- **Evidence:** [Verified] The permission "Create purchase orders and suppliers" is declared
  branch-scoped; the service requires it merchant-wide for suppliers; the screen shows *New
  supplier* to anyone holding it anywhere, so a default branch manager sees the button and
  receives a refusal. ROUTES.md documents the merchant-wide requirement; the permission
  description and BUSINESS_RULES do not.
- **Potential financial impact:** None; usability and clarity.
- **Affected procedures:** BP-601
- **Recommendation:** Either split a merchant-wide "Manage suppliers" permission or hide the
  button for branch-only holders; document the rule in BUSINESS_RULES.

#### FND-611 Cancellations need no reason; no "reject to draft"; creator may cancel an approved order
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** [Verified] Cancel of an order or transfer records no mandatory reason (the
  order screen sends none); an approver who disagrees can only cancel (final) rather than
  return the order to draft; the creator can cancel an order after someone else approved it.
- **Potential financial impact:** Weak audit trail of why commitments were withdrawn;
  rework of orders.
- **Affected procedures:** BP-604, BP-608, BP-614
- **Recommendation:** Require a reason on every cancellation; add "reject" (back to draft
  with a comment); require the approval right to cancel an approved order.

#### FND-612 Received value rounded differently on the order page and in supplier/report totals
- **Classification:** Inconsistency (behaviour vs behaviour) / Accuracy
- **Severity:** Low
- **Evidence:** [Verified] The order page computes received value per order line over all
  receipts (one rounding per line); the supplier list and purchasing report round per receipt
  line. With fractional quantities and odd costs (e.g. 2.5 at 0.333 received in two halves)
  the figures differ by one fils. BR-128 says "half-up per line" without saying which line.
- **Potential financial impact:** Fils-level differences between screens; audit queries.
- **Affected procedures:** BP-606, BP-615
- **Recommendation:** Define the rule (per receipt line is the natural one, since each receipt
  is a document) and use it everywhere; state it in BR-128.

#### FND-613 Documentation does not match behaviour on write-off and on schema
- **Classification:** Inconsistency (doc vs behaviour)
- **Severity:** Low
- **Evidence:** [Verified] BR-104/ADR-0064/PROGRESS describe the missing quantity as "written
  off" — no posting exists (FND-603). DATABASE.md lists a `received_quantity` column on
  purchase-order lines; received quantities are derived from receipts and no such column
  exists. DATABASE.md's movement reason list says "receipt" where the actual type is
  "purchase receipt".
- **Potential financial impact:** None directly; misleads auditors and future engineers.
- **Affected procedures:** BP-606, BP-613
- **Recommendation:** Correct the documents; describe the discrepancy as "recorded on the
  transfer, not posted" until FND-603 is addressed.

#### FND-614 Supplier reference on receipts is free text and not unique
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** [Verified] Optional, 80 characters, no uniqueness per supplier, no link to a
  payment's receipt reference.
- **Potential financial impact:** The same invoice can be received or paid twice; no system
  help in detecting duplicate supplier invoices.
- **Affected procedures:** BP-606, BP-609
- **Recommendation:** Make the reference mandatory on receipts and supplier payments and warn
  on reuse for the same supplier; longer term, replace by the invoice document (FND-601).

#### FND-615 Returns to supplier are not supported
- **Classification:** Owner decision to revisit (OQ-018) / Missing process
- **Severity:** Medium
- **Evidence:** [Verified] No document; PROGRESS and OQ-018 confirm. The workaround is an
  inventory decrease adjustment that names no supplier, leaves at average cost and expects no
  credit.
- **Potential financial impact:** Credits owed by suppliers are untracked; stock loss on
  return is indistinguishable from shrinkage in reports.
- **Affected procedures:** BP-616
- **Recommendation:** Add a "return to supplier" document linked to the order/receipt,
  posting stock out at the receipt cost and recording an expected credit; decide OQ-018.

#### FND-616 Landed costs are not capitalised
- **Classification:** Owner decision to revisit (ADR-0070) / Missing process
- **Severity:** Medium
- **Evidence:** [Verified] The only cost on a purchase is the order unit cost; freight,
  customs and handling are cash expenses.
- **Potential financial impact:** Inventory value and cost of sales understated, expenses
  overstated in the paying period; gross-profit percentages by product misleading for
  imported goods.
- **Affected procedures:** BP-606, BP-616
- **Recommendation:** Owner to adopt a policy (allocate landed costs to receipt lines by value
  or quantity, or keep them as period costs but label the gross profit accordingly); the
  system should then allow additional cost lines on a receipt.

#### FND-617 Zero unit cost and duplicate item lines accepted on purchase orders
- **Classification:** Control gap / Accuracy
- **Severity:** Low
- **Evidence:** [Verified] Unit cost ≥ 0 is accepted; a receipt at cost 0 lowers the average
  cost; the same item may appear on several lines (transfers refuse this).
- **Potential financial impact:** Accidental zero costs distort valuation and gross profit;
  duplicate lines confuse receiving.
- **Affected procedures:** BP-603, BP-606
- **Recommendation:** Warn (or require a note) for zero cost; refuse duplicate items on an
  order or merge them.

#### FND-618 Partial dispatch needs no explanation; notes are dropped
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** [Verified] Dispatching less than requested (even 0 for a line) requires no
  reason and the dispatch note is ignored; at receipt the note is kept only when short.
- **Potential financial impact:** Weak traceability of why requested goods were not sent.
- **Affected procedures:** BP-612, BP-613
- **Recommendation:** Require a note when dispatched < requested; store receive notes always.

#### FND-619 No document dates; cut-off depends on timely entry
- **Classification:** Control gap (cut-off)
- **Severity:** Low
- **Evidence:** [Verified] Receipts, dispatches and transfer receipts are stamped with the
  entry time; there is no delivery date or backdating; the expected date on an order is not
  validated. Reports cut off on these system times.
- **Potential financial impact:** Deliveries keyed after a period end move stock value and
  commitments across periods.
- **Affected procedures:** BP-606, BP-612, BP-613, BP-615
- **Recommendation:** Add a "delivery date" (bounded to a few days back, audited) distinct
  from the posting time, or at least report both; keep posting time as the ledger time.

#### FND-620 Thin audit detail for master-data and draft edits
- **Classification:** Control gap (audit trail)
- **Severity:** Low
- **Evidence:** [Verified] Supplier create/update audits only the status; draft order updates
  audit no before/after values (lines are physically replaced).
- **Potential financial impact:** Changes to supplier contact or payment terms, or to a draft's
  prices before submission, cannot be reconstructed.
- **Affected procedures:** BP-601, BP-603
- **Recommendation:** Record changed field names (and old/new values for cost-bearing fields)
  in the audit details, as the customers module already does for field names.

#### FND-621 Purchasing report counts closed orders at full ordered value; open value is "as of now"
- **Classification:** Inconsistency / Accuracy of reports
- **Severity:** Low
- **Evidence:** [Verified] Ordered value sums all lines of non-draft, non-cancelled orders
  created in the period, including the never-delivered remainder of closed orders; open
  orders and open value ignore the period.
- **Potential financial impact:** Commitment figures overstated; period comparisons of open
  value impossible.
- **Affected procedures:** BP-607, BP-615
- **Recommendation:** Report ordered value net of closed remainders (or show both), and offer
  open value as of the period end.

#### FND-622 Surplus arriving on a transfer cannot be recorded on it
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** [Verified] Received ≤ dispatched is enforced; a surplus must be booked as an
  unrelated inventory adjustment at the destination.
- **Potential financial impact:** Loses the link between the surplus and the transfer; the
  source's shortage (it dispatched less than it actually sent) stays unexplained.
- **Affected procedures:** BP-613
- **Recommendation:** Allow an "over-received" line with mandatory note that posts the surplus
  as a transfer-in at dispatch cost and flags the source for a count.

#### FND-623 Unknown dispatch cost leaves transfers and losses unvalued
- **Classification:** Accuracy / Control gap
- **Severity:** Low
- **Evidence:** [Verified] When the source has no average cost and the item has no catalogue
  cost, the line travels with no cost; the destination receives at its own average or
  catalogue cost; the missing value is not computable.
- **Potential financial impact:** Small; inconsistent valuation between branches for
  uncosted items.
- **Affected procedures:** BP-612, BP-613
- **Recommendation:** Refuse dispatch of uncosted items or require a cost entry at dispatch
  by a user with cost authority.

### F.5 Documented owner decisions touching this domain

| Id | Decision (one line) | Residual risk (one line) |
|---|---|---|
| BR-100 / ADR-0062 | Order states draft → submitted → approved → (partly) received; edit only drafts; cancel before receipt; close with reason | No reject-to-draft; cancel without reason; cost cannot be corrected after submission (FND-601, FND-611) |
| BR-101 / ADR-0062 | Approval needs a separate right; creator cannot approve, **owner exempt** | Owner can create, approve and receive alone; creator may receive (FND-606) |
| BR-102 / ADR-0063 | Several deliveries, never above ordered; each posts stock at the order cost and updates the average | Invoice price differences are invisible; no receipt reversal (FND-601) |
| BR-103 / ADR-0064 | Transfers requested, approved at source, dispatched (in transit), received at destination at dispatch cost; never send more than held | In-transit stock is in no valuation; no recall after dispatch (FND-604) |
| BR-104 / ADR-0064 | Short receipt needs a note; missing quantity recorded and "written off", never returns to source automatically | Write-off is not posted and is self-approved (FND-603) |
| BR-087 / ADR-0091 | Supplier payments are cash disbursements naming an active supplier and optionally a non-draft order; **no payable balance kept** | Overpayment, duplicate and prepayment undetected (FND-602) |
| BR-128 | Purchase values = Σ quantity × order cost (half-up per line); transfer values at dispatch cost; inventory value from stock levels | Rounding rule ambiguous (FND-612); in-transit excluded (FND-604) |
| OQ-018 | Supplier invoices, payables, payment terms and returns to supplier: not implemented, decision pending | Three-way match and returns absent (FND-601, FND-615) |
| ADR-0070 | Gross profit excludes landed costs; no policy yet | Cost of sales understated for imported goods (FND-616) |
| ADR-0061 | Gap-free PO-/GR-/TR- numbers per company, assigned in the creating transaction | Cancelled drafts consume numbers (acceptable, keeps sequence complete) |
| OQ-014 | Weighted-average costing (engineering default; FIFO open) | Receipt cost blends into the average; no lot costing |
| OQ-004 / OQ-002 | Single currency KWD; no tax fields | Foreign-currency purchases and future VAT cannot be recorded on orders |
| BR-079 | "Record cash in / cash out" removed from the default cashier role; supervisors keep it | Supervisors can still pay suppliers from the drawer without an order link (FND-602) |

### F.6 Technical mapping (appendix)

| BP id | Permission keys | Main tables | Screens / routes | Document number prefix |
|---|---|---|---|---|
| BP-601 | `purchasing.manage` (merchant-wide for suppliers), `purchasing.read` | `suppliers`, `audit_log` | `/manager/suppliers` (SuppliersPage, SupplierDialog); `GET/POST /manager/suppliers`, `PATCH /manager/suppliers/:id` | — |
| BP-602 | `purchasing.read` | `suppliers`, `purchase_orders`, `purchase_receipt_lines`, `cash_disbursements` | `/manager/suppliers` (SupplierPaymentsDialog), `/manager/purchasing?supplierId=`; `GET /manager/suppliers/:id/payments` | SP- (payments shown) |
| BP-603 | `purchasing.manage` at branch | `purchase_orders`, `purchase_order_lines`, `document_sequences`, `audit_log` | `/manager/purchasing/new`, `/manager/purchasing/:orderId` (OrderView, ItemPicker); `POST /manager/purchase-orders`, `PATCH /manager/purchase-orders/:id` | PO- |
| BP-604 | `purchasing.manage` at branch | `purchase_orders` | `POST /manager/purchase-orders/:id/submit` | PO- |
| BP-605 | `purchasing.approve` at branch (not creator unless owner) | `purchase_orders`, `audit_log` | `POST /manager/purchase-orders/:id/approve` | PO- |
| BP-606 | `purchasing.receive` at branch | `purchase_receipts`, `purchase_receipt_lines`, `stock_movements` (`purchase_receipt`), `stock_levels`, `audit_log` | ReceiveDialog on `/manager/purchasing/:orderId`; `POST /manager/purchase-orders/:id/receipts` | GR- |
| BP-607 | `purchasing.approve` at branch | `purchase_orders` | CloseDialog; `POST /manager/purchase-orders/:id/close` | PO- |
| BP-608 | `purchasing.manage` or `purchasing.approve` at branch (route: `purchasing.read`) | `purchase_orders` | `POST /manager/purchase-orders/:id/cancel` | PO- |
| BP-609 | `cash.custody` at branch (manager); `cash.move` (POS drawer) | `cash_disbursements`, `financial_account_entries`, `suppliers`, `purchase_orders` (composite FK on supplier) | `/manager/cash` (disbursements), POS cash-out reason `supplier_payment`; `POST /manager/cash/disbursements`, `POST …/:id/reverse`, `GET /manager/cash/suppliers/:id/orders`, `GET /pos/cash/suppliers` | SP- (EX- for expenses) |
| BP-610 | `inventory.transfer` at source or destination | `stock_transfers`, `stock_transfer_lines`, `document_sequences`, `audit_log` | `/manager/transfers/new` (NewTransferPage); `POST /manager/transfers` | TR- |
| BP-611 | `inventory.transfer.approve` at source | `stock_transfers` | `/manager/transfers/:transferId`; `POST /manager/transfers/:id/approve` | TR- |
| BP-612 | `inventory.transfer` at source; cost shown with `catalog.prices.manage` or `reports.inventory` | `stock_transfers`, `stock_transfer_lines`, `stock_movements` (`transfer_out`), `stock_levels`, `stock_reservations` (read) | QuantitiesDialog (dispatch); `POST /manager/transfers/:id/dispatch` | TR- |
| BP-613 | `inventory.transfer` at destination | `stock_transfers` (`discrepancy_note`), `stock_transfer_lines`, `stock_movements` (`transfer_in`), `stock_levels`, `audit_log` | QuantitiesDialog (receive); `POST /manager/transfers/:id/receive` | TR- |
| BP-614 | requester or `inventory.transfer.approve` at source (route: `inventory.transfer`) | `stock_transfers` | `POST /manager/transfers/:id/cancel` | TR- |
| BP-615 | `reports.inventory` (branch-scoped); `inventory.read` for lists | `purchase_orders`, `purchase_order_lines`, `purchase_receipts`, `purchase_receipt_lines`, `stock_transfers`, `stock_transfer_lines`, `stock_levels` | `/manager/reports` purchasing tab (OtherReports), `/manager/transfers`, `/manager/purchasing`; `GET /manager/reports/purchasing`, `GET /manager/transfers`, `GET /manager/purchase-orders` | PO-, GR-, TR- |
| BP-616 | — (not implemented); workaround uses `inventory.adjust`, `cash.custody` | `stock_adjustments` (workaround), `cash_disbursements` (expenses) | `/manager/inventory` adjustments, `/manager/cash` | — |

Immutability summary [Verified]: `purchase_receipts` and `purchase_receipt_lines` — no update,
no delete; `purchase_orders`, `suppliers`, `stock_transfers`, `stock_transfer_lines`,
`document_sequences` — no delete; `purchase_order_lines` change only while the order is a
draft (trigger); final order/transfer states immutable (trigger); transfer requested quantity
fixed, dispatched/received set once (trigger); `stock_movements` and `audit_log` append-only;
all tables under forced row-level security per company.

---

## Chapter G: Online store and online payments

### G.0 Scope and sources reviewed

- **Business purpose.** The online store lets a merchant sell its existing catalogue to the
  public without an account, from one chosen "fulfilment branch", for pickup or delivery.
  A shopper places an order, pays through a payment gateway, and the merchant prepares and
  hands over or delivers the goods. From an accounting standpoint the domain converts a
  shopper's intent (an order) into an immutable sale with a gateway-verified payment, books
  the money into the bank account linked to the online payment method net of a configured
  processing fee, deducts the stock of the fulfilment branch, and returns everything through
  the ordinary refund engine. Today only a **sandbox** gateway exists: no real money moves
  anywhere in this domain, and every observation below about money must be read as "when a
  real gateway is connected, this is how the money will be recorded".
- **Files/screens reviewed.** `apps/api/src/modules/ecommerce/ecommerce.service.ts`,
  `online-payments.service.ts`, `gateways/payment-gateway.ts`, `ecommerce.schema.ts`,
  `ecommerce.controller.ts`, `ecommerce.int.test.ts`; migrations `0025_ecommerce.sql`,
  `0026_ecommerce_rls.sql`, `0028_platform_rls.sql` (store visibility of suspended
  merchants), `0029_delivery_fee_cost.sql`; `sales.service.ts` (online sale completion, item
  loading), `inventory/stock-ledger.service.ts` (reservations), `refunds/refunds.service.ts`
  and controller (refund of gateway payments), `reports/reports.service.ts` (channel split,
  collections, refund allocations), `payments/payments.schema.ts` and `payments.service.ts`
  (online methods, gateway provider, settlement account), `customers.service.ts` (customer by
  phone), `subscriptions.service.ts` (plan feature), `config/env.ts` (sandbox switch);
  `packages/contracts/src/ecommerce.ts`, `packages/permissions` (catalog, role templates);
  `apps/store-web/src` (catalog, cart, checkout, order tracking, sandbox pay page);
  `apps/manager-web/src/features/online/OnlineStorePage.tsx` and its strings;
  `apps/manager-web/src/features/cash/PaymentsPage.tsx` (gateway selector); `e2e/store.spec.ts`;
  docs BR-140…BR-149, BR-161, BR-095, OQ-021, OQ-016, OQ-026, ADR-0049, ADR-0076…0079,
  ADR-0083, ADR-0084, ADR-0089/0090, PROGRESS (Prompt 16/18), ROUTES, AUTH §(online).
- **Coverage statement.** I did not review the receipt rendering of an online sale in the
  manager sales detail screen, the CSV exports of the reports, nor the storefront catalogue
  and product pages line by line (their behaviour is inferred from the API they call and the
  end-to-end test). The adapters for Tap, UPayments, Hesabe and Bookeey do not exist beyond a
  placeholder that refuses every call, so nothing provider-specific could be reviewed.

### G.1 Roles and authority matrix

Permissions in plain words: **"Manage online store"** (merchant-wide: store settings,
listings, manual reconciliation; held by Owner and Company Manager by default);
**"View and fulfil online orders"** (branch-scoped: the user must hold it at the order's
fulfilment branch; held by Owner, Company Manager and Branch Manager by default);
**"Payment settings"** (merchant-wide: make a method available online, choose its gateway,
fee and settlement account; Owner and Company Manager); **"Create refunds"** and
**"Approve refunds"** at the POS (Supervisor and Cashier create; Supervisor, Company Manager
and Branch Manager approve); **"Read sales"** (Owner, Company and Branch Managers).

| Operation | Who may perform it | Branch scoping |
|---|---|---|
| Configure the store (name, address, branch, pickup/delivery, fee, minimum, reservation time) and change its state draft/published/paused | Manage online store: Owner, Company Manager [Verified] | Merchant-wide; Branch Manager refused [Verified by test] |
| List / unlist products online | Manage online store: Owner, Company Manager [Verified] | Merchant-wide |
| Make a payment method available online, choose gateway, fee and settlement account | Payment settings: Owner, Company Manager [Verified] | Merchant-wide |
| Browse the storefront, place an order, pay, track an order | Anyone (public, no account) [Verified] | Store resolved from its public address; the client never names a merchant |
| View online orders list/detail | View and fulfil online orders: Owner, Company Manager, Branch Manager [Verified] | Only orders whose fulfilment branch is one where the user holds the permission; others are invisible (not just refused) [Verified by test] |
| Move an order forward (preparing / ready / out for delivery / completed) | Same as above [Verified] | Checked at the order's branch [Verified] |
| Cancel an unpaid or needs-attention order | Same as above [Verified] | Checked at the order's branch |
| Trigger "check pending payments" (reconciliation) | Manage online store [Verified] | Merchant-wide |
| Refund (fully or partly) a paid online order | POS users with Create refunds at the fulfilment branch, with their own open shift; approval by Approve refunds above limit / outside window [Verified] | Must be at the POS of the sale's branch; not possible from the management app [Verified] |
| Void a paid online order | Nobody: voiding needs the sale to belong to the voider's open shift and online sales have none [Verified] | — |
| Receive gateway notifications, expire reservations, create sales from confirmed payments | The system (webhook endpoint, 60-second job, lazy checks) [Verified] | — |
| Decide whether the online store feature is available to a merchant | Platform operators through the plan's feature list [Verified] | Platform realm |
| Cashier, Kitchen staff | No online permissions by default; no access to the management app [Verified] | — |

Note on segregation: the same Company Manager who configures the store and the payment
method's fee and settlement account also fulfils and cancels orders and approves refunds.
No step in this domain requires a second person [Verified].

### G.2 Procedures

#### BP-701 Configure the online store and change its state
- **Business purpose:** Decide whether the merchant sells online, from which branch, with
  which services (pickup, delivery, delivery fee, minimum order) and how long an unpaid order
  may hold stock.
- **Actors and required authority:** Owner or a user holding Manage online store (Company
  Manager by default) [Verified].
- **Trigger / inputs:** The "Store settings" tab of the Online store screen: state (draft,
  published, paused), public address (2–41 lowercase letters/digits/dashes; "pay", "assets",
  "api", "admin" are reserved), names and taglines in both languages, brand colour, contact
  phone/e-mail, fulfilment branch, pickup on/off, delivery on/off, delivery fee, minimum
  order, reservation minutes (5–1440, default 30), and the record's version number
  [Verified].
- **Normal flow:**
  1. The user opens the tab; the system shows the current settings, the public URL and the
     list of payment methods flagged "available online", each marked Ready or "Not connected"
     [Verified].
  2. The user edits and saves. The system checks: a store name exists in at least one
     language; pickup or delivery is enabled; a fulfilment branch is chosen unless the state
     is draft; the branch exists for this merchant; the version matches (optimistic
     concurrency) [Verified].
  3. Leaving draft (published or paused) requires the merchant's plan to include the online
     store feature [Verified].
  4. Publishing additionally requires at least one online payment method whose gateway is
     ready; today that can only be the sandbox gateway [Verified].
  5. The settings row is inserted or updated, its version incremented, and an audit entry
     "store updated" (state and address) is written with the user and IP [Verified].
- **Exceptional cases and their handling:**
  - Address already used by another merchant (case-insensitive) → refused as duplicate
    [Verified by test].
  - No ready gateway when publishing → refused "enable at least one online payment method
    that can take payments" [Verified].
  - Plan without the feature → refused "plan feature unavailable" [Verified].
  - Stale version → version conflict [Verified].
  - Paused: the storefront still shows the catalogue but checkout is refused "store closed";
    draft: the storefront answers "not found" [Verified by test].
  - A suspended or closed merchant's store disappears from the public (the public lookup
    requires the merchant to be active) [Verified in migration 0028].
  - The branch's status is not checked at save; the UI only offers active branches
    [Verified]. Deactivating the fulfilment branch later does not pause the store
    [Inferred: no such check exists].
  - A plan change that would remove the feature is refused while the store is published or
    paused [Verified in subscriptions].
- **Existing controls:**
  - CTL-701 Permission check merchant-wide; branch managers refused (tested).
  - CTL-702 Database constraints on state, address format, colour, non-negative money,
    reservation window; unique address across merchants.
  - CTL-703 Publishing gate: fulfilment branch + pickup/delivery + ready gateway + plan
    feature.
  - CTL-704 Optimistic version; audit entry with actor and IP.
  - CTL-705 Store settings cannot be deleted by the application role (no delete grant).
- **Financial / stock / cash effect:** None directly. The delivery fee and minimum order set
  here are copied into each order at checkout (snapshot), so later changes never alter
  existing orders [Verified].
- **Upstream dependencies:** Active branch; plan with the online store feature; at least one
  online payment method with a ready gateway (BP-703).
- **Downstream effects:** Storefront visibility (BP-704), checkout rules (BP-705),
  reservation duration (BP-706), delivery fee line on sales (BP-708).
- **Observations:** FND-715, FND-716.

#### BP-702 Manage product listings
- **Business purpose:** Choose which catalogue products are offered online. Prices, images,
  variants and stock are never duplicated; the store reads the catalogue and the fulfilment
  branch's stock [Verified].
- **Actors and required authority:** Manage online store [Verified].
- **Trigger / inputs:** "Products online" tab: search, tick products, "List online (n)" or
  "Remove from store (n)" (up to 5,000 ids per request) [Verified].
- **Normal flow:**
  1. The screen lists active products with their lowest active variant price and whether
     they are listed [Verified].
  2. Listing inserts a listing row per product (idempotent on repeat); unlisting deletes it.
     Products must belong to the merchant (all ids must be found) [Verified].
  3. An audit entry "products listed/unlisted" with the count is written [Verified].
- **Exceptional cases and their handling:**
  - Unknown product id → "product not found" and nothing changes [Verified].
  - A listed product that is later archived, or whose variant is inactive, or that is not
    available at the fulfilment branch, silently disappears from the storefront and cannot
    be bought [Verified in the storefront query].
  - Unlisted products cannot be bought even if their id is known [Verified by test].
- **Existing controls:**
  - CTL-706 Server-side filter: only active products, active variants, available at the
    fulfilment branch, and listed.
  - CTL-707 Audit entry with counts (not with product names).
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** Catalogue (Domain: Catalog).
- **Downstream effects:** BP-704, BP-705.
- **Observations:** None beyond the audit granularity (count only) noted under FND-716.

#### BP-703 Make a payment method available online (gateway, fee, settlement account)
- **Business purpose:** Decide which tender the shopper may use, which provider processes
  it, what processing fee the system will record, and into which internal bank account the
  money is booked. This is the only place where "where online money settles" is decided.
- **Actors and required authority:** Payment settings (Owner, Company Manager) [Verified];
  procedure owned by the Payments domain, described here for completeness.
- **Trigger / inputs:** Payment methods screen: kind (card, bank transfer, custom; never
  cash), "available in the online store", gateway provider (Tap, UPayments, Hesabe, Bookeey,
  or "Test gateway"), fee type (none / fixed / percentage / fixed + percentage), settlement
  account (a bank-type account; drawers, treasuries, in-transit and archived accounts are
  refused) [Verified].
- **Normal flow:**
  1. The user flags the method as available online and picks a provider.
  2. The online store settings and the storefront show the method; it is "Ready" only when
     the chosen provider has a working adapter — today only the sandbox ("Test gateway")
     [Verified].
  3. Each later online payment records the fee computed from this method's settings at
     payment time and posts the gross amount plus a negative fee entry into the linked
     account (BP-708) [Verified].
- **Exceptional cases and their handling:**
  - A method with a real provider name is listed in settings as "Not connected (needs
    approval and credentials)", hidden from shoppers, and refused at checkout [Verified by
    test].
  - A method without a settlement account: the online payment is recorded on the sale but
    no account entry is written at all — the money is then in no ledger [Verified in the
    sale completion code].
  - The cash method cannot be made an online method with a gateway? The schema allows a
    gateway provider on any kind; the UI hides the gateway field for cash [Verified]. Since
    the cash method has no settlement account (ADR-0090), an online "cash" payment would
    post nowhere [Inferred; not tested].
- **Existing controls:**
  - CTL-708 Only bank-type accounts may be linked; cash is refused.
  - CTL-709 Provider list limited by a database check; "gateway live" is always reported as
    false to the client (ADR-0049).
  - CTL-710 Fee calculated and frozen on each payment at payment time (rule changes never
    rewrite history).
- **Financial / stock / cash effect:** Determines the account credited and the fee debited by
  every online sale.
- **Upstream dependencies:** Internal balances (default "Bank account 1 / 2", ADR-0089).
- **Downstream effects:** BP-705 (method offered), BP-708 (posting), Reports (collections and
  fees by method), Cash custody (bank balances).
- **Observations:** FND-704, FND-718, FND-719.

#### BP-704 Public storefront: catalogue and availability
- **Business purpose:** Show the shopper what can be bought, at the catalogue price, with a
  truthful "available / sold out" indication, without revealing exact stock.
- **Actors and required authority:** Anyone; no session [Verified].
- **Trigger / inputs:** The store's public address.
- **Normal flow:**
  1. The system resolves the address to a merchant only if the store is published or paused
     and the merchant is active, then works inside that merchant's data boundary [Verified].
  2. The storefront returns branding, whether orders are accepted (published only), pickup/
     delivery, delivery fee, minimum order, the ready online payment methods and the
     categories of listed products [Verified].
  3. For each listed product variant it returns the catalogue price and: for tracked
     non-recipe items, "available" when on-hand minus active unexpired reservations is at
     least one whole unit, with a maximum orderable quantity of min(20, free units); for
     untracked items and recipe items, always available with maximum 20 [Verified].
  4. Product images are served publicly only for listed products, from the file storage
     [Verified].
- **Exceptional cases and their handling:**
  - Unknown address, draft store, suspended merchant → "not found" [Verified].
  - Another merchant's product id → "not found" (isolation) [Verified by test].
  - Negative stock policy: the storefront still computes free units from on-hand minus
    reservations; a merchant allowing negative stock shows "sold out" at zero but the
    checkout then reserves anyway (see BP-706) [Verified in code].
- **Existing controls:**
  - CTL-711 Merchant resolved by a security-definer lookup; the client never supplies a
    merchant id (ADR-0076).
  - CTL-712 Exact stock never exposed (cap of 20).
  - CTL-713 Recipe items' availability is not checked against ingredients at browse time
    (only at checkout reservation) [Verified].
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-701, BP-702, Inventory balances, catalogue prices.
- **Downstream effects:** BP-705.
- **Observations:** FND-707 (visibility of reservations).

#### BP-705 Shopper checkout (order placement)
- **Business purpose:** Turn the shopper's cart into a priced, numbered order that holds the
  stock and starts a payment, with the server as the only price authority.
- **Actors and required authority:** The shopper (anonymous) [Verified].
- **Trigger / inputs:** Cart lines (1–50 lines; whole quantities 1–20 per line), fulfilment
  (pickup/delivery), name (≤120), phone (6–30 characters), optional e-mail, delivery address
  (required for delivery), note, chosen payment method, the total the shopper saw, and a
  checkout key generated by the browser (kept across network retries, renewed after a
  refusal) [Verified].
- **Normal flow:**
  1. Rate limit: 30 checkouts per 10 minutes per client IP [Verified].
  2. Replay check: if an order already exists for this key with an identical request, the
     same order is returned; same key with a different basket is refused as a key conflict
     [Verified by test].
  3. Before pricing, the system reconciles the merchant's overdue unpaid orders so expired
     reservations release their stock first [Verified].
  4. In one transaction: the store must be published and offer the chosen fulfilment; the
     payment method must be active, online, with a gateway, and ready; every line must be a
     listed, active, branch-available variant; quantities must be whole units ≤ 20; the cart
     is priced by the shared pricing function (no discounts, no tax); the subtotal must reach
     the minimum order (delivery fee excluded from this test); subtotal + delivery fee must
     equal the total the shopper saw [Verified].
  5. The order receives the next number of the merchant's online-order sequence (prefix W,
     six digits, gap-free, per merchant not per branch) [Verified]; a customer profile is
     found by normalised phone or created (name/e-mail from the form, no creator) [Verified];
     the order is inserted with status "waiting for payment", a price snapshot per line, a
     reservation deadline (now + reservation minutes), an unguessable 32-hex tracking token
     and the request hash [Verified].
  6. Stock is reserved at the fulfilment branch for the tracked items (recipe items reserve
     their ingredients; untracked items reserve nothing), under the same row locks as every
     stock change (BP-706) [Verified].
  7. A payment attempt row ("initiated") for the full total is created and an anonymous
     audit entry "order placed" (number, total, IP) is written [Verified].
  8. Outside the transaction the gateway is asked to start the payment; its reference and
     hosted-page URL are stored on the attempt. The shopper is redirected to the gateway page
     (sandbox page today) [Verified].
- **Exceptional cases and their handling:**
  - Store paused/draft or fulfilment not offered → "store closed" [Verified by test].
  - Method not online or provider not ready → refused [Verified by test].
  - Item unlisted/inactive → "item unavailable" naming the line [Verified by test].
  - Fractional or >20 quantity → "invalid quantity" [Verified by test].
  - Subtotal below minimum → "minimum order" [Verified].
  - Total differs by even one fils → "total changed"; the browser then refreshes prices and
    renews the key [Verified by test].
  - Insufficient free stock (on-hand minus other reservations) → "insufficient stock"; the
    whole order is refused, nothing is written [Verified by test].
  - Two identical concurrent submissions race on the unique key; the loser returns the
    winner's order; a concurrent duplicate with a different body is refused [Verified].
  - Gateway refuses to start the payment: the attempt is marked failed with the reason, the
    order becomes "payment failed", the reservation is released; the shopper sees the failed
    order [Verified].
- **Existing controls:**
  - CTL-714 Server re-pricing with "total changed" refusal (BR-142).
  - CTL-715 Idempotency key unique per merchant with request-hash comparison (ADR-0053
    pattern).
  - CTL-716 Stock reservation inside the same transaction and locks as sales (ADR-0079).
  - CTL-717 Per-IP rate limit and hard caps on lines and quantities.
  - CTL-718 Price snapshot per line: the sale later uses the checkout price even if the
    catalogue price changes [Verified].
  - CTL-719 Anonymous audit entry with IP.
- **Financial / stock / cash effect:** No sale, no payment, no cash. Stock on hand is
  unchanged but a reservation reduces what the POS and transfers may take (BP-706). A
  customer profile may be created (Customers domain).
- **Upstream dependencies:** BP-701…BP-704, Inventory balances, Customers.
- **Downstream effects:** BP-706, BP-707, BP-711, Customers (profile and later spending).
- **Observations:** FND-708, FND-713, FND-714.

#### BP-706 Stock reservation lifecycle and expiry
- **Business purpose:** Prevent selling the same unit twice between the moment a shopper
  commits to pay and the moment the gateway confirms, without touching stock balances.
- **Actors and required authority:** System; parameters from BP-701.
- **Trigger / inputs:** Checkout (create), payment outcome (consume/release), manager
  cancellation (release), expiry (release), reservation minutes.
- **Normal flow:**
  1. Reserve: the stock level rows of the tracked items at the branch are locked in a fixed
     order; free = on-hand − other active unexpired reservations; if any line wants more than
     free (and negative stock is not allowed) the order is refused; otherwise one active
     reservation row per variant is written with the expiry time [Verified].
  2. While active and unexpired, a reservation is counted as unavailable by the stock
     engine for **sale** and **transfer-out** movements of other documents, unless the
     merchant allows negative stock [Verified]. POS sale refused at 4 units when 5 on hand
     and 2 reserved; store shows 3 [Verified by test].
  3. Consume: when the order is paid, the online sale deducts the stock (its own reservation
     is excluded from the "held" figure) and the reservation is marked consumed [Verified].
  4. Release: payment failed/cancelled, manager cancel, amount mismatch, late payment without
     stock, or expiry marks the reservation released [Verified].
  5. Expiry: orders still "waiting for payment" past their deadline are expired by the
     reconciliation (60-second background job outside tests; also lazily before every
     checkout, on every tracking page view of a pending order, on each orders-list load, and
     by the manager's button). Expiring marks the open attempt "expired", the order
     "expired" with a note, releases the stock and writes a system audit entry [Verified].
- **Exceptional cases and their handling:**
  - Reservation rows and the order deadline are set together but are separate values; the
    stock engine looks at the row's own expiry, the reconciliation at the order's deadline
    [Verified].
  - Expired is **not** final: a payment confirmed afterwards still completes the order if
    the stock is available (then the reservation is already released and the sale takes
    free stock); if not, the order needs attention (BP-710) [Verified by test].
  - Stock counts, adjustments, restaurant waste, refunds and purchase receipts ignore
    reservations (only sale and transfer-out respect them) [Verified]; a count can therefore
    set on-hand below the reserved quantity, and the paying order will later fail for lack
    of stock [Inferred consequence].
  - Negative stock allowed: reservations neither refuse nor protect; the POS can sell
    reserved units [Verified in code; BR-144 does not mention the exception, ADR-0079 does].
  - Reservation rows cannot be deleted by the application role [Verified].
- **Existing controls:**
  - CTL-720 Same row locks and fixed lock order as stock movements (no double-take).
  - CTL-721 Honoured by POS sales and transfers out (tested, including a concurrent race of
    three payments and two POS sales ending exactly at zero).
  - CTL-722 Automatic expiry with audit entry.
- **Financial / stock / cash effect:** No balance or value change. Stock "committed" is not a
  reported figure anywhere in management screens (see FND-707).
- **Upstream dependencies:** BP-705; inventory settings (negative stock policy).
- **Downstream effects:** POS checkout refusals, transfer dispatch refusals, storefront
  availability, BP-708.
- **Observations:** FND-707, FND-708, FND-720.

#### BP-707 Payment at the gateway and processing of notifications
- **Business purpose:** Obtain a provider-verified payment result and apply it exactly once
  to the right attempt and order, whatever the provider.
- **Actors and required authority:** The shopper on the gateway page; the provider (signed
  notification to a public endpoint); the system (verification calls).
- **Trigger / inputs:** Provider notification (raw body + signature header), or a
  server-to-server verification result during reconciliation or on the tracking page.
- **Normal flow:**
  1. The notification is parsed by the provider's adapter, which verifies the signature over
     the exact bytes (sandbox: HMAC-SHA256, constant-time comparison) and rejects malformed
     amounts/statuses [Verified].
  2. The provider reference is resolved to a merchant through a security-definer lookup;
     unknown references are refused [Verified].
  3. Inside the merchant's transaction the attempt row is locked; if the provider's event id
     was already stored, the call answers "duplicate" and nothing changes [Verified by test].
  4. The result is applied (BP-708 / BP-710 paths) and the event is stored once (provider,
     event id, status, amount, full payload, outcome) in an append-only table [Verified].
- **Exceptional cases and their handling:**
  - Wrong or forged signature, or a body altered after signing → rejected (401); nothing
    recorded [Verified by test].
  - Result "pending" → nothing changes [Verified].
  - Already settled attempt and a non-success result → "already settled" [Verified].
  - Already settled attempt (failed/cancelled/expired by us) and a **success** result →
    recorded as succeeded with the explanation "paid after the attempt was …; refund it at
    the provider", the order (if it has no sale) is flagged needs attention, audit entry
    "payment after close" (BR-161) [Verified by test].
  - Success with a different amount or currency → attempt marked **failed** with reason
    "amount or currency does not match", order needs attention, stock released, outcome
    "amount mismatch"; no sale [Verified by test].
  - Failure/cancellation on a pending order → attempt failed/cancelled, order "payment
    failed"/"cancelled", stock released, system audit entry [Verified by test].
  - Lock order (attempt before order) is the same in webhooks, manager actions and expiry;
    deadlocks are retried up to three times (ADR-0084) [Verified by test].
  - Only the sandbox adapter can parse notifications; real providers refuse with "gateway not
    configured" [Verified].
- **Existing controls:**
  - CTL-723 Signature verification over raw bytes before any database work.
  - CTL-724 One record per provider event id (unique index + lock); duplicates are no-ops.
  - CTL-725 Settled attempts are frozen by a database trigger (only initiated/expired may
    change) [Verified in migration 0026].
  - CTL-726 Every notification is kept with its payload for audit.
- **Financial / stock / cash effect:** None by itself; the effect comes from the applied
  outcome (BP-708, BP-710).
- **Upstream dependencies:** BP-705 (attempt with provider reference).
- **Downstream effects:** BP-708, BP-710, BP-711.
- **Observations:** FND-705, FND-701.

#### BP-708 Payment confirmation: the order becomes an online-channel sale
- **Business purpose:** Recognise the sale and its payment at the moment the provider
  confirms the money, deduct stock, book the money and the fee, and number a receipt — all
  with the same engine as the POS.
- **Actors and required authority:** System (triggered by BP-707 or BP-709).
- **Trigger / inputs:** A confirmed result on an attempt whose order is still "waiting for
  payment" or "expired" and has no sale [Verified].
- **Normal flow (one transaction, with a savepoint around the sale):**
  1. Attempt marked succeeded with completion time [Verified].
  2. If the order carries a delivery fee, the merchant's hidden service item "Delivery fee"
     (archived, untracked, cost 0) is found or created under a per-merchant lock and added
     as one line at the fee amount [Verified; cost set to 0 by migration 0029].
  3. The sale is created with channel "online": receipt number from the fulfilment branch's
     sequence (branch code + six digits, same sequence as POS receipts), no register, shift
     or cashier; lines at the checkout prices, no discounts; stock deducted through the
     stock ledger as a "sale" movement at weighted-average cost, consuming the order's own
     reservation; line and sale cost recorded (null if any cost unknown) [Verified].
  4. The total must equal the attempt amount (defensive check) [Verified].
  5. One payment row: method of the order, amount = total, fee computed from the method's
     settings, status succeeded, verification "gateway", reference = provider reference
     [Verified; test: 2 % fee on 3.000 = 0.060].
  6. If the method has a settlement account: two account entries — +total (payment) and
     −fee (fee) — dated now, with the receipt number as description and no user [Verified].
  7. System audit entry "sale completed online" (receipt, order number, total, provider
     reference) [Verified].
  8. Order updated to "paid" with sale id and paid time; reservation marked consumed;
     system audit "order paid" [Verified].
- **Exceptional cases and their handling:**
  - Stock no longer available (late payment after expiry, stock sold meanwhile): the sale
    part is rolled back to the savepoint, the attempt stays succeeded, the order is flagged
    needs attention ("paid after the reservation expired…; refund or restock"), stock
    released, audit "paid without stock"; the notification is still answered successfully
    [Verified by test].
  - Order already has a sale, or is not pending/expired (second successful attempt, or paid
    after cancel): attempt succeeded, **no second sale**; order flagged needs attention
    unless it already has a sale, in which case only the status note changes [Verified].
  - A payment whose amount differs never reaches this step (BP-707) [Verified].
  - Delivery fee line: a service with zero cost, so gross profit stays "available" and the
    fee is 100 % margin [Verified by test: profit 4.750 on 6.750 net].
  - The customer on the sale is the profile found/created at checkout; customer spending
    statistics include the online sale [Verified by test].
- **Existing controls:**
  - CTL-727 Sale, lines, payment, stock movement, account entries and audit in one
    transaction; sale ↔ order link unique (one sale per order, database constraint).
  - CTL-728 Sales and payments are append-only (no update/delete grants, per earlier
    domains); the online order's final states are frozen by trigger.
  - CTL-729 Fee frozen per payment; total cross-checked against the attempt.
  - CTL-730 Same lock order as POS (receipt sequence then stock) with retry on deadlock.
- **Financial / stock / cash effect:** Net sales +total (including delivery fee); payments
  collected +total under the method (card kind in the default set-up); processing fee
  −fee; settlement account balance +total −fee immediately; stock on hand −quantities at
  weighted-average cost; cost of sales +cost; receipt numbering advanced in the branch
  sequence; order no longer cancellable. All of this happens at **payment confirmation**,
  before any preparation or delivery [Verified].
- **Upstream dependencies:** BP-703 (method, fee, account), BP-705/BP-706, Inventory costs.
- **Downstream effects:** Reports (net sales by channel, collections, fees, profit, product
  report including "Delivery fee"), Cash custody (bank balance), Customers (history),
  Refunds (BP-714), Sales list and detail (channel filter).
- **Observations:** FND-704, FND-706, FND-711, FND-712.

#### BP-709 Reconciliation of pending payments (automatic and manual)
- **Business purpose:** Never leave an order waiting on a lost notification: ask the provider
  about open attempts and expire what was not paid in time.
- **Actors and required authority:** System every 60 seconds (merchants with overdue unpaid
  orders), before each checkout and orders-list load, on each tracking view of a pending
  order; manually by a user with Manage online store ("Check pending payments") [Verified].
- **Trigger / inputs:** Merchant (and optionally one order).
- **Normal flow:**
  1. For each open attempt of a pending order with a provider reference, the provider is
     asked for the status (outside any transaction); a non-pending answer is applied exactly
     as a notification would be (BP-707/BP-708) in its own transaction [Verified].
  2. Then, in one transaction, every pending order past its deadline is expired (attempt
     expired, order expired with note, stock released, audit) [Verified].
  3. The caller receives counts: checked, paid, expired; the manager sees them as a toast
     [Verified].
- **Exceptional cases and their handling:**
  - A failing verification or application of one attempt is logged and does not stop the
    others nor the expiry step (ADR-0084) [Verified].
  - Errors during the lazy reconciliation at checkout and list load are swallowed so the
    shopper/manager flow continues [Verified].
  - Reconciliation does not record a reconciliation document or who ran it (the manual
    trigger writes no audit entry) [Verified: no audit call in that path].
  - Sandbox verification after an API restart answers "pending" for references it no longer
    remembers; the order then simply expires at its deadline [Verified in adapter code].
- **Existing controls:**
  - CTL-731 Background job isolated per merchant and per attempt.
  - CTL-732 Expiry uses the same lock order as notifications.
- **Financial / stock / cash effect:** Same as the outcome applied (BP-708/BP-710) or stock
  release.
- **Upstream dependencies:** BP-705, BP-707.
- **Downstream effects:** BP-710, BP-711.
- **Observations:** FND-716 (no audit of manual reconciliation), FND-709.

#### BP-710 Orders needing attention and their resolution
- **Business purpose:** Isolate the cases where money and goods have diverged so a person
  decides: amount mismatch, payment after cancellation/failure, late payment without stock,
  a second payment on an already paid order.
- **Actors and required authority:** System flags; a user with View and fulfil online orders
  at the branch resolves [Verified].
- **Trigger / inputs:** The four cases above (BP-707/BP-708). The orders tab shows a warning
  badge "n need attention" and a filter; the order dialog shows the system's note
  [Verified].
- **Normal flow:**
  1. The order is flagged with a note explaining the case; a system audit entry names the
     attempt [Verified].
  2. The only action offered is **Cancel order** with an optional free-text note (the test
     uses "Refunded at the gateway"). Cancelling marks any still-open attempt cancelled,
     sets the order cancelled with the note, releases any reservation and writes an audit
     entry with the user [Verified].
  3. Nothing else is recorded: no refund document, no amount, no provider refund reference,
     no bank entry [Verified].
- **Exceptional cases and their handling:**
  - Case "paid twice" (order already has a sale): the order keeps its current status (paid,
    preparing…), only the note changes; it is **not** counted in the needs-attention filter
    and cannot be cancelled; the second succeeded attempt is visible only in the dialog's
    attempt list [Verified in code].
  - Case "amount mismatch": the attempt is shown as **Failed** although the provider
    reported a successful charge of a different amount [Verified].
  - Case "late payment, stock gone": the manager may instead restock and… there is no
    "retry fulfilment" action; the only path is cancel (and a manual refund at the provider)
    or a manual POS sale [Verified: no such action exists].
  - Cancelled is final (trigger) — a second notification afterwards is recorded as "payment
    after close" and re-flags the order as needs attention [Verified by test].
- **Existing controls:**
  - CTL-733 Money-taking results are never silently dropped (BR-161, tested).
  - CTL-734 Reservation released so stock is not blocked.
  - CTL-735 Audit entry of the cancellation with actor and IP.
- **Financial / stock / cash effect:** **None in the ledgers.** The succeeded attempt exists
  only in the online-attempt table; no payment row, no account entry, no sale, no refund
  record. The money the provider collected is invisible to collections, bank balances and
  reports [Verified].
- **Upstream dependencies:** BP-707, BP-708.
- **Downstream effects:** Manual refund at the provider (outside the system); gateway payout
  reconciliation (not provided — FND-704).
- **Observations:** FND-701, FND-705, FND-710, FND-717.

#### BP-711 Order tracking by the shopper
- **Business purpose:** Let the shopper follow the order and pay later within the
  reservation window without an account.
- **Actors and required authority:** Anyone holding the tracking link [Verified].
- **Trigger / inputs:** Store address + 32-hex token (format validated before lookup)
  [Verified].
- **Normal flow:**
  1. If the order is still waiting for payment, its open attempt is reconciled with the
     provider first [Verified].
  2. The page shows number, status, items, subtotal, delivery fee, total, fulfilment type,
     customer first name as entered, the timeline of statuses with times, and — while
     pending — the deadline and a "Pay now" button to the gateway page; the browser polls
     every 5 s while pending, 30 s afterwards [Verified].
- **Exceptional cases and their handling:**
  - Token of another store → "not found" [Verified by test].
  - The page never shows the sale's receipt number, the payment reference or the phone
    [Verified]; the shopper receives no e-mail or SMS at any step (no mail is sent by this
    module) [Verified].
- **Existing controls:**
  - CTL-736 Unguessable token, unique index, format check; tokens kept out of logs (Prompt 18
    fix, documented).
- **Financial / stock / cash effect:** None (may trigger BP-708 through reconciliation).
- **Upstream dependencies:** BP-705.
- **Downstream effects:** BP-714 (the customer cannot quote a receipt number — see FND-703).
- **Observations:** FND-703, FND-714.

#### BP-712 Fulfilment steps by the merchant
- **Business purpose:** Record the physical progress of a paid order to hand-over.
- **Actors and required authority:** View and fulfil online orders at the order's branch
  [Verified].
- **Trigger / inputs:** Order dialog buttons: Start preparing, Ready for pickup (pickup
  only), Out for delivery (delivery only), Mark completed; optional note; version [Verified].
- **Normal flow:**
  1. Allowed moves: paid → preparing | ready | out for delivery | completed; preparing →
     ready | out for delivery | completed; ready → completed; out for delivery → completed
     [Verified]. Steps may be skipped (paid → completed directly) [Verified].
  2. The order's status, note, version and timeline are updated; completion time set; an
     audit entry "order <step>" with user and IP is written [Verified].
  3. The list refreshes every 30 s; the shopper's timeline shows the steps [Verified by
     test].
- **Exceptional cases and their handling:**
  - Wrong step for the fulfilment type (ready on a delivery order) → "invalid state"
    [Verified by test].
  - Backward moves and moves from non-paid states → refused [Verified].
  - Stale version → conflict [Verified].
  - Completed is final (trigger) [Verified].
  - No integration with kitchen tickets or POS: a restaurant's online order does not appear
    on the kitchen screen [Inferred: no such link in the module].
  - No proof of hand-over (signature, code, courier) and no SLA/ageing [Verified: fields do
    not exist].
- **Existing controls:**
  - CTL-737 Forward-only state machine enforced server-side and frozen final state.
  - CTL-738 Branch-scoped permission re-checked on the order's branch.
  - CTL-739 Audit entry per step with actor; the order's own timeline stores only status and
    time (no actor).
- **Financial / stock / cash effect:** None — revenue, stock and money moved at BP-708.
- **Upstream dependencies:** BP-708.
- **Downstream effects:** Shopper timeline; management follow-up.
- **Observations:** FND-706.

#### BP-713 Cancellation of unpaid or needs-attention orders
- **Business purpose:** Close an order the merchant does not want to serve before money is
  recognised, and free its stock.
- **Actors and required authority:** View and fulfil online orders at the branch [Verified].
- **Trigger / inputs:** "Cancel order" + optional note + version.
- **Normal flow:** Open attempts marked cancelled; order cancelled with note and time;
  reservation released; audit entry [Verified].
- **Exceptional cases and their handling:**
  - Paid, preparing, ready, out for delivery, completed → refused "paid orders are cancelled
    by refunding their sale" [Verified by test].
  - A customer who pays on the gateway page after the merchant cancelled: the payment is
    recorded and the order returns to needs attention (BP-710) [Verified by test].
  - The shopper has no way to cancel their own order [Verified].
- **Existing controls:** CTL-737, CTL-738, CTL-735.
- **Financial / stock / cash effect:** Reservation released; nothing else.
- **Upstream dependencies:** BP-705.
- **Downstream effects:** Storefront availability.
- **Observations:** FND-717.

#### BP-714 Refund of a paid online order
- **Business purpose:** Return money and (optionally) goods for an online sale, since paid
  orders cannot be cancelled in place (ADR-0077).
- **Actors and required authority:** A POS user with Create refunds bound to the fulfilment
  branch and holding an open shift; approval by Approve refunds when over the limit or
  outside the return window; approval also possible from the management Returns page
  [Verified in refunds controller/service].
- **Trigger / inputs:** The POS returns screen: the sale's receipt number (branch sequence
  number, e.g. MAIN-000012) — not the online order number; lines and quantities; restock
  flag; allocation across the sale's payments [Verified].
- **Normal flow:**
  1. Lookup by receipt number at the cashier's branch; the online sale is found because its
     branch is the fulfilment branch [Verified].
  2. Amounts are computed cumulatively per line; the allocation defaults to the sale's only
     payment (the gateway payment); a custom allocation may only name payments of this sale,
     so the refund is always allocated to the gateway payment [Verified].
  3. The refund record is created (processing, or pending approval); refund payment rows are
     "pending" with verification "gateway" [Verified].
  4. On execution: restock lines go back to stock immediately at the cost they left with;
     gateway refund payments are **left pending** and the refund stays **processing**
     (BR-095) — no account entry is written for them [Verified].
- **Exceptional cases and their handling:**
  - There is no screen, endpoint, job or adapter call that confirms or settles a gateway
    refund; a processing refund stays so indefinitely [Verified: no such path exists].
  - Voiding is impossible (online sales have no shift) [Verified].
  - The refund's cash guard does not apply (no cash tender); shift still required to create
    the refund [Verified].
  - The management app shows the hint "paid orders are cancelled by refunding their sale
    from the Returns page", but a manager without POS access cannot do it [Verified].
  - Reports: refunds in "processing" are listed in the payments report by status; "paid
    back" counts only settled refund payments, so gateway refunds never enter paid-back
    totals (BR-124) [Verified].
- **Existing controls:**
  - CTL-740 Refund never exceeds the sale or any tender (shared refund engine).
  - CTL-741 Never "completed on assumption" for gateway tenders (BR-095).
  - CTL-742 Approval rules and audit as in the Refunds domain.
- **Financial / stock / cash effect:** Refund figure (net after refunds) −amount in the
  refund's period once completed — but online refunds are not completed, so the sales report
  "refunds" metric treats them as completed refunds? BR-121 says refunds = completed refunds;
  processing ones are excluded [Inferred from the rule; the report query for "refunds" was
  not read line by line]. Stock +restocked quantities immediately. Bank account: unchanged
  (no entry). Processing fee: not reversed (OQ-016).
- **Upstream dependencies:** BP-708; Refund policy settings; an open POS shift at the branch.
- **Downstream effects:** Reports (refund allocations by status), Inventory (restock), the
  manual refund the merchant must perform in the provider's portal.
- **Observations:** FND-702, FND-703, FND-718.

#### BP-715 Online orders screen, sales views and reporting of the online channel
- **Business purpose:** Give management visibility of online activity and keep POS and
  online figures distinguishable.
- **Actors and required authority:** View and fulfil online orders (orders tab); Read sales
  (sales list/detail with channel filter); Sales reports / Financial reports as per BR-129
  [Verified].
- **Trigger / inputs:** Online store screen, Sales screen (channel filter), Reports.
- **Normal flow:**
  1. Orders tab: status filter with counts per status, needs-attention badge, 25 per page,
     branch column, totals; dialog with customer, address, note, method, lines, delivery
     fee, attempts (provider, reference, status, amount, reason), timeline, link to the sale
     [Verified].
  2. Sales list: channel badge and filter; online sales have no cashier/register [Verified].
  3. Reports: "sales by channel" (count and net sales per channel); net sales, gross profit
     and product/category breakdowns include online sales; employee breakdown is POS only;
     collections and fees are by payment method, **not** split by channel; "cash by type"
     excludes online (no cash) [Verified].
- **Exceptional cases and their handling:**
  - A method available both at the POS and online merges its POS card payments and online
    payments in the collections report [Verified by construction of the query].
  - The dashboard has no online KPI (not reviewed in depth) [Inferred].
- **Existing controls:** CTL-738 (branch scoping on lists), report permissions (Reports
  domain).
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-708.
- **Downstream effects:** Management decisions; external audit sampling.
- **Observations:** FND-704, FND-706, FND-711.

#### BP-716 Operating the sandbox gateway
- **Business purpose:** Exercise the whole flow end-to-end without a provider.
- **Actors and required authority:** Platform configuration (environment switch and
  secret); the shopper on the test page; a merchant choosing "Test gateway" on a method.
- **Trigger / inputs:** Sandbox enabled when the environment switch is on, which is the
  default everywhere except production; in production it must be switched on explicitly and
  the development secret is refused [Verified].
- **Normal flow:**
  1. Checkout creates an in-memory "charge" and redirects to the hosted test page showing
     merchant, order number and amount, with a visible "test payment" warning [Verified].
  2. The shopper clicks succeed / fail / cancel; the system signs a notification itself and
     processes it exactly like a provider's (BP-707), then returns the shopper to tracking
     [Verified].
  3. Attempts show provider "mock" and references starting with "mock_" [Verified].
- **Exceptional cases and their handling:**
  - When the sandbox is enabled, a successful test click creates a **real** sale, stock
    deduction, payment row, fee and bank-account entries, with no money anywhere
    [Verified].
  - The test page endpoints are public; whoever knows the reference (the shopper) can settle
    it; a settled reference cannot be settled again [Verified].
  - Charges live in memory: after a restart, verification answers "pending" (harmless);
    settling still works because the page reads the database [Verified].
  - Merchants can pick "Test gateway" in their payment method settings in any environment;
    with the sandbox off the method is simply "not connected" [Verified].
- **Existing controls:**
  - CTL-743 Off by default in production; production refuses the development secret.
  - CTL-744 Visible warnings on the page and provider name on attempts.
- **Financial / stock / cash effect:** Identical to a real payment (BP-708) — which is the
  risk.
- **Upstream dependencies:** Environment configuration (Operations).
- **Downstream effects:** Every figure of BP-708/BP-715 in environments where it is on.
- **Observations:** FND-709.

### G.3 Interdependencies with other domains

The online store is a thin ordering layer on top of the shared engines: it owns the order
intent, the reservation and the gateway attempt, but every financial and stock effect is
produced by the sales, inventory, payments and refunds engines. Its money settles into the
internal bank accounts of the Cash custody domain at the moment of confirmation, and its
corrections go through the POS refund flow. Three things flow back into this domain: the
negative-stock policy (which can disable reservations), the plan feature (which can block
publishing), and the merchant's status (which hides the store but not the webhooks).

| From → To | What flows |
|---|---|
| Catalog → Online store | Products, variants, prices, images, branch availability; archived/inactive items vanish from the store |
| Inventory → Online store | On-hand at the fulfilment branch, weighted-average cost, negative-stock policy |
| Online store → Inventory | Reservations (commitments respected by POS sales and transfers out), sale movements on payment, restock on refund; the hidden "Delivery fee" service item created in the catalogue |
| Payments settings → Online store | Which methods are online, their provider, fee rule and settlement account |
| Online store → Cash custody / balances | Gross payment and negative fee entries on the linked bank account at confirmation time; nothing on drawers or treasuries |
| Online store → Sales | Immutable online-channel sales with branch receipt numbers, no cashier/shift |
| Sales/Refunds → Online store | Refund of an online sale (POS only, gateway tender left pending); no way back from a refund to the order's state |
| Online store → Customers | Profile found/created by phone at checkout; online sales in the customer's history and spending |
| Online store → Reports | Net sales by channel, product/category/profit figures (incl. delivery fee), collections and fees by method, refund allocations by status |
| Subscriptions/Platform → Online store | Feature gate when leaving draft; plan change blocked while published/paused; suspended/closed merchants' stores hidden; webhooks still processed |
| Audit → all | Anonymous checkout entries with IP, system entries for payment outcomes and expiry, user entries for settings, listings, steps and cancellations |
| Operations → Online store | Sandbox switch and secret, public store URL for return links, trusted proxies for shopper IP rate limits |

### G.4 Findings

#### FND-701 Money collected for "needs attention" cases exists in no ledger
- **Classification:** Financial risk / Control gap
- **Severity:** Critical
- **Evidence:** When a successful payment arrives after the order was cancelled or failed,
  after the reservation expired with stock gone, with a different amount, or as a second
  payment on a paid order, the system marks the attempt succeeded (or failed, for the amount
  case) and flags the order — but writes no payment row, no bank-account entry, no sale and
  no refund record. The only resolution offered is "Cancel order" with a free-text note
  [Verified in code and tests]. The provider nevertheless holds the merchant's money and
  will pay it out.
- **Potential financial impact:** Gateway payouts will exceed the system's collections by
  these amounts with no trace in the financial reports; refunds performed manually at the
  provider reduce payouts with no matching record either. Over time the bank balance in the
  system and the real bank statement diverge in both directions, and the amounts are
  unknown to management unless someone reads attempt lists order by order.
- **Affected procedures:** BP-707, BP-708, BP-710, BP-713
- **Recommendation:** Treat every provider-confirmed charge as money received: record it as
  an "unapplied online receipt" posting to the settlement account (gross and fee), list
  unapplied receipts on the Online store screen and in the payments report, and require a
  resolution record (refund at provider with provider refund reference, or application to a
  manually created sale) before the order can be closed. Until then, add a report of
  succeeded attempts without a sale, by day and amount.

#### FND-702 Gateway refunds can never complete inside the system
- **Classification:** Missing process
- **Severity:** High
- **Evidence:** A refund allocated to a gateway payment is stored "pending" and the refund
  stays "processing"; there is no endpoint, screen, job or adapter call that confirms,
  settles or rejects it, and no account entry is ever posted for it. Restocked goods go back
  to stock immediately [Verified]. BR-095 and PROGRESS describe the pending state as
  intended; the confirmation step "arrives with Prompt 16" (Prompt 11 notes) was not built
  [Verified: inconsistency between PROGRESS Prompt 11 and the delivered Prompt 16].
- **Potential financial impact:** Goods are back in stock while the customer's money is
  still shown in the bank balance; the refund never reduces "paid back"; the manager has no
  worklist of gateway refunds owed to customers and no record of the provider refund
  reference. Customers may be refunded twice (once manually, once when a real integration
  later "settles" pending rows) or never.
- **Affected procedures:** BP-714, BP-715
- **Recommendation:** Add a "mark refunded at provider" action on processing refunds
  (reference, date, user, optional actual fee), posting the negative entry on the settlement
  account and completing the refund; show processing gateway refunds as a worklist with
  ageing; when a real adapter exists, call its refund API and confirm by webhook.

#### FND-703 Paid online orders can only be refunded from a POS terminal by a cashier with an open shift; the customer has no receipt number
- **Classification:** Control gap / Missing process
- **Severity:** High
- **Evidence:** Refund creation is a POS-only operation bound to the actor's branch and
  requiring the requester's open shift; the management app only shows a hint pointing to
  "the Returns page" [Verified]. The shopper's tracking page shows the order number but
  never the receipt number, and the POS lookup accepts only receipt numbers at that branch
  [Verified]. No e-receipt is sent.
- **Potential financial impact:** Managers of a store that fulfils online orders from a
  warehouse branch without an active till cannot return money at all; cashiers must find the
  receipt number through the management sales screen or the order dialog; cancellation
  requests pile up as "needs attention"-like informal cases outside the system.
- **Affected procedures:** BP-711, BP-712, BP-714
- **Recommendation:** Allow a manager with Approve refunds to initiate a non-cash refund of
  an online sale from the order dialog (no shift needed since no cash moves), pre-allocated
  to the gateway payment; show the receipt number on the tracking page and the POS lookup by
  online order number.

#### FND-704 No reconciliation of gateway payouts to online sales; bank balance credited at confirmation with a merchant-entered fee
- **Classification:** Control gap
- **Severity:** High
- **Evidence:** Each online payment credits the method's bank account immediately for the
  gross amount and debits the fee from the method's own fee settings (percentage/fixed);
  the actual provider fee, payout date and payout batch are unknown to the system. There is
  no screen or export listing online payments by provider reference for a date range, and
  collections are grouped by method without a channel split [Verified]. The owner rejected a
  clearing account for card money (ADR-0090 context) [Owner decision].
- **Potential financial impact:** The "Bank account 1/2" balances are accrued receivables,
  not bank money; differences between provider settlement reports and the system (fees,
  chargebacks, FND-701 amounts, manual refunds) cannot be isolated; month-end bank
  reconciliation must be done entirely outside the system.
- **Affected procedures:** BP-703, BP-708, BP-715
- **Recommendation:** Provide a payments export by provider reference, order number, receipt
  number, amount, recorded fee and date (and the same for refunds), and a per-day
  "gateway collections" total per method and channel; when real providers exist, import or
  fetch settlement files and mark payments as paid out, posting fee differences.

#### FND-705 Amount-mismatch charges are recorded as "failed" attempts
- **Classification:** Inconsistency (behaviour vs record)
- **Severity:** Medium
- **Evidence:** A signed success notification whose amount or currency differs from the
  order marks the attempt "failed" with the reason "amount or currency does not match"; the
  manager's attempt list shows "Failed" although the provider charged the customer
  [Verified by code and test].
- **Potential financial impact:** Staff reading "Failed" may tell the customer no money was
  taken; the charged amount is nowhere recorded (only in the stored notification payload).
- **Affected procedures:** BP-707, BP-710
- **Recommendation:** Store the provider's amount on the attempt, use a distinct state
  ("charged, amount differs") and include these in the unapplied-receipts list of FND-701.

#### FND-706 Revenue is recognised at payment confirmation; unfulfilled paid orders have no owner, ageing or hand-over evidence
- **Classification:** Owner decision to revisit / Control gap
- **Severity:** Medium
- **Evidence:** The sale, stock deduction and bank entry occur when the gateway confirms;
  fulfilment steps change only the order's status. Steps may jump straight from paid to
  completed; the order's own timeline stores status and time but not who acted (the audit
  log does); there is no due time, no ageing view, no delivery proof, and no automatic
  alert for paid orders left unprepared [Verified].
- **Potential financial impact:** Period revenue and cost of sales include goods still on
  the shelf (sold but not handed over); a paid order forgotten for days is still "revenue";
  disputes about non-delivery cannot be evidenced from the system.
- **Affected procedures:** BP-708, BP-712, BP-715
- **Recommendation:** Keep recognition at payment (customary for prepaid retail) but add:
  a report of paid-not-completed orders with age and value for period-end cut-off, a target
  time per fulfilment type with visual ageing, the acting user in the order timeline, and a
  completion note/proof field made mandatory for delivery.

#### FND-707 Reserved (committed) stock is invisible to management and unprotected under the negative-stock policy
- **Classification:** Control gap / Inconsistency (doc vs behaviour)
- **Severity:** Medium
- **Evidence:** No inventory screen, report or export shows reservations; on-hand is shown
  gross. Only sale and transfer-out movements respect reservations; counts and adjustments
  do not. When the merchant allows negative stock, reservations neither refuse the checkout
  nor protect against POS sales [Verified]. BR-144 states reserved stock "cannot be sold at
  the POS or transferred" without the exception that ADR-0079 acknowledges [Verified doc
  discrepancy].
- **Potential financial impact:** Stock counts performed while orders are pending will show
  "available" units that are promised; a merchant with negative stock enabled can oversell
  online and then face late payments without stock (FND-701 cases).
- **Affected procedures:** BP-704, BP-706
- **Recommendation:** Show "reserved" and "available to sell" next to on-hand in inventory
  views and exports; warn when counting items with active reservations; keep reservation
  protection even when negative stock is allowed, or state the exception in BR-144.

#### FND-708 Anonymous shoppers can tie up stock through reservations
- **Classification:** Financial risk
- **Severity:** Medium
- **Evidence:** A checkout may hold up to 20 units of each of 50 variants for the
  reservation time (default 30 min, up to 24 h), 30 times per 10 minutes per IP, with no
  limit per phone number or per store, and no cap on concurrently open unpaid orders
  [Verified]. The minimum order and the "insufficient stock" refusal are the only brakes.
- **Potential financial impact:** Lost POS and transfer sales of popular items during the
  hold; large reservation windows chosen by merchants (up to 24 h) multiply the exposure.
- **Affected procedures:** BP-705, BP-706
- **Recommendation:** Cap open unpaid orders per phone/IP, shorten the default window for
  tracked items, let managers see and release open reservations, and alert when reserved
  exceeds a share of on-hand.

#### FND-709 Sandbox gateway creates real financial records without money; enabled by default outside production
- **Classification:** Financial risk / Control gap
- **Severity:** Medium (High if ever enabled in a merchant-facing environment)
- **Evidence:** With the sandbox on, a click on the public test page produces a sale, stock
  deduction, payment, fee and bank entries indistinguishable in reports from a real payment
  (only the attempt shows provider "mock"); merchants can select "Test gateway" on their
  methods in any environment; staging runs with it on [Verified]. Production needs an
  explicit switch and refuses the development secret [Verified]. Charges are in memory, which
  is harmless for integrity but means verification is meaningless after a restart
  [Verified].
- **Potential financial impact:** Any environment used by real merchants with the sandbox on
  (a pilot on staging, a misconfigured production) records fictitious revenue, fictitious
  bank balances and real stock deductions; the "Test gateway" option visible to merchants
  invites this.
- **Affected procedures:** BP-703, BP-708, BP-716
- **Recommendation:** Hide "Test gateway" from merchant settings unless the platform marks
  the merchant as a test tenant; watermark sandbox sales (channel "online-test" or a flag
  excluded from reports); refuse publishing with only the sandbox ready outside explicitly
  designated test tenants.

#### FND-710 A second successful payment on an already-paid order is not surfaced
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** When an order already has a sale and another attempt succeeds, the order
  keeps its status (so it is not in the needs-attention count/filter) and only the status
  note changes; the extra charge is visible solely in the dialog's attempt list [Verified in
  code].
- **Potential financial impact:** Double charges go unnoticed until the customer complains;
  amount unrecorded in ledgers (FND-701).
- **Affected procedures:** BP-708, BP-710
- **Recommendation:** Add an explicit "extra payment" flag/counter on orders, include it in
  the attention badge and in the unapplied-receipts list.

#### FND-711 Delivery fee is booked as product revenue at 100 % margin and is refundable as an item
- **Classification:** Owner decision to revisit
- **Severity:** Low
- **Evidence:** The fee is a sale line on a hidden service product "Delivery fee" with zero
  cost; it enters net sales, gross profit and product/category reports as a product
  (uncategorised); it can be refunded line by line like goods [Verified; ADR-0077,
  migration 0029].
- **Potential financial impact:** Product-mix and margin analyses include delivery income;
  if the merchant pays couriers, the "profit" on delivery is overstated; refund of goods
  without the fee (or vice versa) is left to the cashier's judgement.
- **Affected procedures:** BP-708, BP-714, BP-715
- **Recommendation:** Report delivery fees as a separate "other income" line in sales
  reports (filter the service SKU out of product analyses) and decide a refund policy for the
  fee (automatic with full refunds, never with partial).

#### FND-712 Sale date is the confirmation time, not the provider's charge time
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** The sale and bank entries are dated when the notification or reconciliation
  is processed; the provider's own timestamp is not stored (only the raw payload)
  [Verified].
- **Potential financial impact:** Payments charged just before midnight and confirmed after
  (or confirmed days later by a late notification) fall into the next period; provider
  settlement reports will not match by day.
- **Affected procedures:** BP-708, BP-709
- **Recommendation:** Store the provider's charge time on the attempt and payment and show
  both in exports; accept the system date for recognition but document the rule.

#### FND-713 Customer profiles are created or linked from unauthenticated phone input
- **Classification:** Control gap (data integrity / privacy)
- **Severity:** Medium
- **Evidence:** Checkout finds a customer by normalised phone or creates one with the typed
  name and e-mail; no verification of the phone, no creator recorded; an existing profile's
  name is kept, so an order typed with someone else's number attaches to that person's
  history and spending [Verified].
- **Potential financial impact:** Polluted customer master data and spending statistics;
  privacy exposure of an existing customer's purchase history association; abuse of any
  future loyalty scheme (OQ-019).
- **Affected procedures:** BP-705
- **Recommendation:** Mark online-created profiles as unverified; link orders to an existing
  profile only after phone verification (OTP) or keep the order's contact separate until a
  manager merges; record the source on the profile.

#### FND-714 No customer notifications; the tracking link is shown once
- **Classification:** Missing process
- **Severity:** Low
- **Evidence:** The module sends no e-mail or SMS at placement, payment, readiness or
  completion; the shopper's only access is the tracking URL in the browser after checkout
  [Verified].
- **Potential financial impact:** Lost links lead to support contacts, disputes and refund
  requests that the system cannot evidence; paid-but-unfulfilled orders are not noticed by
  the customer early.
- **Affected procedures:** BP-705, BP-711, BP-712
- **Recommendation:** Send the tracking link and the receipt number by e-mail/SMS on
  payment and on readiness; allow lookup by order number + phone.

#### FND-715 Fulfilment branch status is not enforced after publishing
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** Saving checks only that the branch exists; deactivating the branch does not
  pause the store or refuse checkouts, and the store would keep creating sales and stock
  movements at an inactive branch [Verified at save; consequence Inferred].
- **Potential financial impact:** Sales recorded at a closed location; stock deducted from a
  branch nobody operates.
- **Affected procedures:** BP-701, BP-705
- **Recommendation:** Require an active branch at save and at checkout; auto-pause the
  store when its branch is deactivated.

#### FND-716 Audit trail housekeeping: store settings and listings logged against the wrong target; manual reconciliation unlogged
- **Classification:** Control gap (audit trail)
- **Severity:** Low
- **Evidence:** Settings and listing changes are recorded with the target type "online
  order" and the merchant id as target; listing changes record only a count, not which
  products; the manual "check pending payments" action writes no audit entry [Verified].
- **Potential financial impact:** Harder forensic review of who exposed which products or
  changed the fee/minimum/reservation time.
- **Affected procedures:** BP-701, BP-702, BP-709
- **Recommendation:** Use a "store" target type, log changed fields (before/after) and the
  product ids listed/unlisted, and log manual reconciliations with their counts.

#### FND-717 Resolution of flagged orders relies on a free-text note
- **Classification:** Control gap (evidence)
- **Severity:** Medium
- **Evidence:** Cancelling a needs-attention order accepts an optional note; nothing forces a
  reason, a refund reference, an amount or a second person [Verified].
- **Potential financial impact:** No evidence that the customer's money was actually
  returned at the provider; the same person who cancels could keep a payout difference
  unnoticed (combined with FND-701).
- **Affected procedures:** BP-710, BP-713
- **Recommendation:** Require a structured resolution (refunded at provider with reference /
  fulfilled manually with receipt / other with reason) and a mandatory note; show resolved
  cases in a dedicated report.

#### FND-718 Processing fee and its non-reversal are defaults awaiting the owner's contracts
- **Classification:** Owner decision to revisit
- **Severity:** Low
- **Evidence:** Fees come from the method's settings (default none) and are never reversed
  on refunds (OQ-016, OQ-026) [Verified; Owner decision].
- **Potential financial impact:** Fee expense misstated until real rates are entered; refund
  fee treatment may not match the acquirer's.
- **Affected procedures:** BP-703, BP-708, BP-714
- **Recommendation:** Enter contracted rates per method before go-live; revisit reversal once
  contracts are known.

#### FND-719 No real gateway is connected
- **Classification:** Owner decision to revisit
- **Severity:** Low (as documented)
- **Evidence:** Tap, UPayments, Hesabe and Bookeey are placeholders that refuse every call;
  activation needs owner approval, credentials and provider sandbox tests (BR-143, ADR-0078,
  OQ-021) [Verified; Owner decision].
- **Potential financial impact:** None today; at activation the findings FND-701/702/704
  become live money issues.
- **Affected procedures:** All
- **Recommendation:** Resolve FND-701, FND-702 and FND-704 before the first live gateway.

#### FND-720 Late payments after expiry create sales at stale prices without review
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** An expired order whose payment is confirmed later (even much later) becomes
  a sale at the checkout snapshot prices and delivery fee if stock exists, with no manager
  approval [Verified by test].
- **Potential financial impact:** Sales below current prices after a price rise; stock
  committed unexpectedly days later.
- **Affected procedures:** BP-706, BP-708
- **Recommendation:** Accept late confirmations only within a grace period (e.g. 24 h);
  beyond it, treat as an unapplied receipt for manual decision.

### G.5 Documented owner decisions touching this domain

| Id | Decision (one line) | Residual risk (one line) |
|---|---|---|
| BR-140 / ADR-0076 | Store states draft/published/paused; separate public app; publish needs branch, pickup/delivery and a ready gateway | Only the sandbox can be "ready" today (FND-709) |
| BR-141 | Only listed active products at catalogue price; stock of the fulfilment branch; untracked/recipe items always available | Recipe availability unchecked until checkout |
| BR-142 / ADR-0051-0053 pattern | Server re-pricing, total-changed refusal, whole quantities ≤20, idempotent checkout | None material |
| BR-143 / ADR-0078 / ADR-0049 | Gateway abstraction; sandbox only; real providers never live without approval and credentials | Live-money controls untested (FND-701/702/704) |
| BR-144 / ADR-0079 | Reservations for the store's window; honoured by POS sales and transfers | Disabled under negative-stock policy; invisible to management (FND-707) |
| BR-145 / ADR-0077 | Payment confirmation creates an online-channel sale once; mismatches and late payments without stock need attention | Money of flagged cases off-ledger (FND-701) |
| BR-146 | Fulfilment flow paid→…→completed; only unpaid/needs-attention cancellable; paid orders refunded | Refund only from POS, gateway refund never completes (FND-702/703) |
| BR-147 | Each notification processed once with valid signature | None material |
| BR-148 / ADR-0083 / migration 0029 | Delivery fee as a zero-cost service line; fees as for POS cards | Delivery income shown as product margin (FND-711) |
| BR-149 | No shopper accounts; customer by phone; unguessable tracking link | Unverified phone linking (FND-713); no notifications (FND-714) |
| BR-161 | Payments after cancel/failure are recorded and flagged, never ignored | Recorded only on the attempt, not in ledgers (FND-701) |
| BR-095 | Gateway refunds complete only after gateway confirmation | No confirmation path exists (FND-702) |
| BR-153 | Suspended merchants' stores disappear; started payments still recorded | None material |
| ADR-0084 | One lock order and automatic retry on deadlock | None material (tested) |
| ADR-0089 / ADR-0090 | Non-cash methods settle straight into bank accounts minus fee; no clearing account | Bank balance ≠ bank statement until payout reconciliation exists (FND-704) |
| OQ-016 / OQ-026 | Fees not reversed on refunds; default no fees; settlement accounts by default | Fee expense and refund treatment provisional (FND-718) |
| OQ-021 | Which gateways, delivery zones, coupons, cash on delivery, automatic gateway refunds — open | Live activation blocked on these decisions (FND-719) |

### G.6 Technical mapping (appendix)

| BP id | Permission keys | Main tables | Screens / routes | Document number prefix | Refusal codes / audit actions |
|---|---|---|---|---|---|
| BP-701 | `online.manage` | `online_stores`, `subscriptions`/`plans` (feature) | `/manager/online` (Store settings); `GET/PUT /manager/online/store` | — | `DUPLICATE_CODE`, `GATEWAY_NOT_CONFIGURED`, `PLAN_FEATURE_UNAVAILABLE`, version conflict; audit `online.store_updated` |
| BP-702 | `online.manage` | `online_listings`, `products` | `/manager/online` (Products online); `GET/PUT /manager/online/listings` | — | audit `online.products_listed` / `online.products_unlisted` |
| BP-703 | `payments.settings` | `payment_methods` (`available_online`, `gateway_provider`, `fee_*`, `financial_account_id`), `financial_accounts` | `/manager/payments`; `POST/PATCH /manager/payment-methods` | — | audit `payment_method.created/updated` |
| BP-704 | public | `online_stores`, `online_listings`, `products`, `product_variants`, `stock_levels`, `stock_reservations`, `product_images`; function `store_merchant(slug)` | `/store/:slug`, `/store/:slug/products/:id`; `GET /store/:slug`, `/products`, `/products/:id`, `/images/...` | — | 404 for draft/unknown/suspended |
| BP-705 | public (rate-limited) | `online_orders`, `online_order_lines`, `stock_reservations`, `online_payments`, `customers`, `document_sequences` | `/store/:slug/checkout`; `POST /store/:slug/checkout` | `W-000001` (per merchant) | `STORE_CLOSED`, `PAYMENT_METHOD_UNAVAILABLE`, `GATEWAY_NOT_CONFIGURED`, `ITEM_UNAVAILABLE`, `INVALID_QUANTITY`, `MINIMUM_ORDER`, `TOTAL_CHANGED`, `INSUFFICIENT_STOCK`, `IDEMPOTENCY_CONFLICT`; audit `online.order_placed` (anonymous) |
| BP-706 | system | `stock_reservations`, `stock_levels`, `inventory_settings` | — (background job every 60 s; `online_orders_due_merchants()`) | — | `INSUFFICIENT_STOCK`; audit `online.order_expired` |
| BP-707 | public (signed) | `online_payments`, `payment_events`; function `online_payment_merchant(provider, ref)` | `POST /webhooks/payments/:provider` | — | `PAYMENT_SIGNATURE_INVALID` (401), 404 unknown reference; audit `online.payment_failed/cancelled`, `online.payment_after_close` |
| BP-708 | system | `sales` (`channel='online'`, `online_order_id`), `sale_lines`, `payments` (`verification='gateway'`), `financial_account_entries`, `stock_movements`, `stock_levels`, `receipt_sequences`, `products`/`product_variants` (SKU `ONLINE-DELIVERY`) | Sale visible at `/manager/sales/:id` | Receipt `{BRANCH}-000001` (branch sequence) | `PAYMENT_TOTAL_MISMATCH`; audit `sale.completed_online`, `online.order_paid`, `online.paid_without_stock` |
| BP-709 | `online.manage` (manual) / system | `online_payments`, `online_orders`, `stock_reservations` | `/manager/online` button "Check pending payments"; `POST /manager/online/reconcile` | — | no audit for the manual trigger |
| BP-710 | `online.orders` (branch) | `online_orders` (`status='needs_attention'`, `status_note`), `online_payments` | `/manager/online` (Orders, filter needs attention); `POST /manager/online/orders/:id/action` | — | audit `online.order_cancel` |
| BP-711 | public (token) | `online_orders` (`tracking_token`) | `/store/:slug/orders/:token`; `GET /store/:slug/orders/:token` | — | 404 |
| BP-712 | `online.orders` (branch) | `online_orders` (`history` jsonb, `version`) | `/manager/online` order dialog; `POST /manager/online/orders/:id/action` | — | `INVALID_STATE`, version conflict; audit `online.order_preparing/ready/out_for_delivery/completed` |
| BP-713 | `online.orders` (branch) | `online_orders`, `online_payments`, `stock_reservations` | same as BP-712 (action `cancel`) | — | `INVALID_STATE`; audit `online.order_cancel` |
| BP-714 | `refunds.create` (POS, branch), `refunds.approve` (POS or manager) | `refunds`, `refund_lines`, `refund_payments` (`verification='gateway'`, `status='pending'`), `stock_movements` | `/pos/returns`; `GET /pos/refunds/lookup`, `POST /pos/refunds`, `/pos/refunds/:id/approve`, `/manager/refunds/:id/approve|reject` | Refund number (Refunds domain) | `SHIFT_REQUIRED`, `REFUND_EXCEEDS_SALE`, `REFUND_ALLOCATION_INVALID`; refund stays `processing` |
| BP-715 | `online.orders`, `sales.read`, `reports.sales`, `reports.financial` | `online_orders`, `sales`, `payments`, `refund_payments` | `/manager/online`, `/manager/sales?channel=online`, `/manager/reports` (`byChannel`, collections, refund allocations) | — | — |
| BP-716 | platform configuration (`PAYMENT_MOCK_ENABLED`, `PAYMENT_MOCK_SECRET`, `PUBLIC_STORE_URL`) | in-memory charges; `online_payments` (`provider='mock'`) | `/store/pay/:reference`; `GET/POST /payments/mock/:reference` | — | 404 when sandbox disabled |

Database immutability summary [Verified in migrations 0025/0026]: `online_order_lines` and
`payment_events` cannot be updated or deleted by the application role; `online_stores`,
`online_orders`, `stock_reservations`, `online_payments` cannot be deleted; orders in
`completed`, `payment_failed`, `cancelled` and attempts in `succeeded`, `failed`,
`cancelled` are frozen by triggers; `expired` and `needs_attention` remain changeable by
design; one sale per online order is enforced by a unique constraint; the sale row for the
online channel must have an order link and no shift (check constraint).

---

## Chapter H: Restaurant operations

### H.0 Scope and sources reviewed

- **Business purpose.** The restaurant module turns the retail POS into a table-service and
  counter-service system for merchants that cook what they sell. It lets a company switch the
  module on per subscription plan, lay out dining areas and tables per branch, define kitchen
  (preparation) stations with routing by product category, define modifier groups (size,
  doneness, add-ons with surcharges and optional ingredient consumption) and recipes
  (ingredients consumed per unit sold), take dine-in, takeaway and pickup orders, send them to
  the kitchen display, progress them through preparation, cancel items before or after they
  are sent (with supervisor authority, a reason and optional waste recording), move and combine
  tables, and finally settle the order by one or several bills that go through the standard
  checkout engine (shift, exact tenders, receipt numbering, stock deduction, audit). The order
  itself is a mutable "intent" document and never carries money; each bill is an immutable sale
  of the Sales domain with a service type (dine-in / takeaway / pickup) for lists and reports.
- **Files and screens reviewed (technical names allowed here).** API:
  `apps/api/src/modules/restaurant/restaurant.schema.ts`, `restaurant-config.service.ts`,
  `restaurant-orders.service.ts`, `restaurant.controller.ts`, `restaurant.int.test.ts`;
  migrations `apps/api/drizzle/0023_restaurant.sql`, `0024_restaurant_rls.sql`; the checkout
  engine parts that bills reuse (`sales/sales.service.ts` — `completeSaleInTx`, `loadItems`,
  `parseCart`), `inventory/consumption.ts`, `inventory/stock-ledger.service.ts`,
  `registers/shifts.service.ts` (`lockOwnShift`), `refunds/refunds.service.ts` (void and restock
  rules), `reports/reports.service.ts` (service-type table, movement report); permission
  catalog and role templates (`packages/permissions/src/catalog.ts`, `templates.ts`); contracts
  `packages/contracts/src/restaurant.ts`. Web: POS `apps/pos-web/src/restaurant/RestaurantPages.tsx`
  (floor, order, modifier, cancel, bill, move/merge dialogs), `KitchenPage.tsx`, `routes.tsx`,
  `sale/dialogs.tsx` (receipt); manager `apps/manager-web/src/features/restaurant/RestaurantPage.tsx`
  and `features/sales/SalesPage.tsx`. Documents: `docs/BUSINESS_RULES.md` BR-130…BR-139,
  OQ-020, OQ-023; `docs/DECISIONS.md` ADR-0072…0075 (and the audit-F3 note on OQ-023);
  `docs/PROGRESS.md` (Prompt 15, Prompt 18 audit fixes); `docs/AUTH.md` §3.5; `docs/TESTING.md`.
- **Coverage statement.** I did not execute the application or the e2e browser test
  (`e2e/restaurant.spec.ts`); its scenario is taken from `docs/TESTING.md` and the unit/web tests.
  The Sales, Refunds, Inventory, Cash-custody and Reports domains are referenced only as far as
  a restaurant bill uses them; their internal rules (discount limits, refund approvals, shift
  close, weighted-average cost) are audited in their own chapters. The audit-log table itself
  (append-only guarantees) is outside this chapter.

### H.1 Roles and authority matrix

Permission keys, in plain words:
- **"Configure restaurant"** (`restaurant.manage`): tables, areas and stations at a branch when
  held for that branch; the module switch, modifier groups and menu recipes only when held
  merchant-wide (no branch restriction).
- **"Take restaurant orders"** (`restaurant.orders`): floor view, open/modify/move/combine/cancel
  orders at the POS session's branch.
- **"Void sent items"** (`restaurant.void_item`): cancel an item already sent to the kitchen.
- **"Use the kitchen display"** (`kitchen.access`).
- **"Create sales"** (`sales.create`) is needed to pay a bill; **"Give discounts"**
  (`sales.discount`), **"Exceed discount limit"** (`sales.discount.override_limit`) apply to bill
  discounts exactly as to retail sales (Sales domain).
- All POS operations run against the **branch the POS session is bound to**; the permission must
  be held at that branch (or merchant-wide). Manager configuration is checked against the
  branch given in the request. **[Verified]**

| Operation | Permission (plain words) | Owner | Company Manager | Branch Manager | Supervisor | Cashier | Kitchen | Platform operator |
|---|---|---|---|---|---|---|---|---|
| Switch module on/off, auto-send setting | Configure restaurant, merchant-wide | Yes | Yes (template is merchant-wide) | No (branch-scoped) | No | No | No | No (but a plan's features decide whether "on" is allowed) |
| Create/edit areas, tables, stations at a branch | Configure restaurant at that branch | Yes | Yes | Yes, own branch | No | No | No | No |
| Create/edit modifier groups; attach groups and recipes to a menu item | Configure restaurant, merchant-wide | Yes | Yes | No | No | No | No | No |
| View branch layout | Configure restaurant or Take orders at the branch | Yes | Yes | Yes | Yes | Yes | No | No |
| View floor, open order, add items, send to kitchen, move, combine, cancel unsent items, cancel an unsent order, quote a bill | Take restaurant orders at bound branch (+ POS access) | Yes* | No by default (no POS access) | No by default | Yes | Yes | No | No |
| Cancel an item already sent to the kitchen (with/without waste) | Take orders **and** Void sent items | Yes* | Holds Void but no POS access by default | Same | Yes | **No** | No | No |
| Pay a bill (any split of unpaid items) | Take orders screen + Create sales (+ own open shift) | Yes* | No by default | No by default | Yes | Yes | No | No |
| Discount on a bill / exceed limit | Give discounts / Exceed discount limit | Yes* | — | — | Yes / Yes | Yes / No | No | No |
| Kitchen display and ticket progression | Use the kitchen display at bound branch | Yes* | No by default | No by default | Yes | No | Yes | No |
| Refund or void a paid bill | Refund permissions (Refunds domain) | Yes* | approve only | approve only | Yes | create only | No | No |
| See restaurant sales in lists/reports | Read sales / Sales reports (Sales & Reports domains) | Yes | Yes | Yes, own branch | Yes (list) | No | No | No |

\* The owner holds every permission but still needs a POS session bound to a branch and, to pay,
an open shift of their own. **[Verified]** Managers reach the POS only when explicitly given POS
access and the order permission (CLAUDE.md §3.7, BR-014) — the Company/Branch Manager templates
hold "Void sent items" but not POS access, so by default they cannot void from the floor
**[Verified]**. Platform operators are a separate realm; their only influence is the plan
feature list (`restaurant`) checked when the module is switched on **[Verified]**.

### H.2 Procedures

#### BP-801 Enable the restaurant module and its settings
- **Business purpose:** Decide per company whether table/kitchen service is available and
  whether takeaway/pickup items go to the kitchen automatically once paid.
- **Actors and required authority:** Owner or a manager with merchant-wide "Configure
  restaurant". The POS reads the setting (any authenticated POS user) to show or hide the
  Tables and Kitchen tabs.
- **Trigger / inputs:** Manager → Restaurant → Setup tab: "enable" and "auto-send on payment"
  checkboxes, plus the current settings version.
- **Normal flow:**
  1. The manager ticks "enable" and saves. The system checks the version (optimistic lock),
     then — only when turning the module **on** from off — checks the subscription plan includes
     the `restaurant` feature **[Verified]**.
  2. The settings row is created or updated (enabled, auto-send, version +1) and an audit entry
     "settings updated" with the new enabled flag is written **[Verified]**.
  3. POS staff with "Take orders" or "Kitchen display" see the Tables / Kitchen tabs on their
     next refresh (the client caches the setting for 60 seconds) **[Verified]**.
- **Exceptional cases and their handling:**
  - Stale version → refused (409 conflict) **[Verified]**.
  - Plan without the feature → refused at enable time; disabling never needs the feature
    **[Verified]**.
  - Branch-scoped manager → forbidden (merchant-wide authority required) **[Verified by test]**.
  - Disabling with open orders: no check is made. Open orders remain open; the floor, menu,
    kitchen board, order creation and **bill payment** refuse with "module disabled", while
    adding items, sending, cancelling, moving and combining still work through the API
    **[Verified]** (see FND-813).
  - Default when no row exists: disabled, auto-send on **[Verified]**.
- **Existing controls:**
  - CTL-801 Merchant-wide authority required for the switch (branch managers excluded).
  - CTL-802 Subscription feature gate at enable time.
  - CTL-803 Optimistic version on the settings row; audit entry on every change.
- **Financial / stock / cash effect:** None directly. Indirectly, disabling blocks collection
  of money on open orders.
- **Upstream dependencies:** Subscription plan with the restaurant feature (Platform domain);
  product catalog.
- **Downstream effects:** Every other procedure in this chapter; POS navigation.
- **Observations:** FND-813.

#### BP-802 Define dining areas and tables
- **Business purpose:** Model the floor of each branch so that one open order can be attached
  to one physical table.
- **Actors and required authority:** "Configure restaurant" at the branch (Branch Manager and
  above).
- **Trigger / inputs:** Manager → Restaurant → Floor tab: branch selector; new area (Arabic
  and/or English name); new/edit table (area, code, seats 1–100, active/inactive).
- **Normal flow:**
  1. The manager creates an area; the system stores it with position and status and audits
     "area created/updated" **[Verified]**.
  2. The manager creates a table under an area. The code is upper-cased, limited to letters,
     digits and dashes (max 10) and must be unique per branch (case-insensitive by
     upper-casing) **[Verified]**. Seats default to 4.
  3. Tables and areas are **deactivated, never deleted** (database delete right revoked)
     **[Verified]**; inactive tables/areas disappear from the POS floor.
- **Exceptional cases and their handling:**
  - Duplicate code at the branch → "duplicate code" refusal **[Verified by test]**.
  - Edit with a stale version → conflict; unknown id → not found **[Verified]**.
  - A table can be deactivated while it has an open order: no check exists. The order stays
    open, the table cannot receive a second order (unique open-order-per-table index), and the
    order is **no longer shown anywhere in the POS** because the floor lists only active tables
    of active areas and the queue lists only takeaway/pickup orders **[Verified]** (FND-802).
  - A branch manager of branch B cannot create areas at branch A → forbidden **[Verified by test]**.
- **Existing controls:**
  - CTL-804 Branch-scoped authority on layout objects.
  - CTL-805 Unique table code per branch; name required (Arabic or English).
  - CTL-806 Deactivate-not-delete; audit on create/update.
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** Branch exists (Branches domain); module enabled is **not** required
  to configure.
- **Downstream effects:** BP-806 (orders need an active table), BP-813, floor view.
- **Observations:** FND-802.

#### BP-803 Define kitchen stations and category routing
- **Business purpose:** Route each ordered item to the preparation screen that makes it
  (kitchen, bar, grill…).
- **Actors and required authority:** "Configure restaurant" at the branch.
- **Trigger / inputs:** Station name, "default station" flag, the list of product categories
  routed to it, status.
- **Normal flow:**
  1. The manager creates stations per branch. One station may be marked **default**; it
     receives every item whose category is not routed elsewhere **[Verified]**.
  2. Each category can be routed to only one station per branch (unique constraint); saving a
     station replaces its whole routing list **[Verified]**.
  3. Category ids are checked to belong to the merchant (foreign keys ignore tenant isolation;
     Prompt 18 audit fix) **[Verified]**.
- **Exceptional cases and their handling:**
  - Second default station at a branch → refused ("already has a default station"); the
    uniqueness applies only to active stations, so an inactive default can be kept **[Verified]**.
  - Category already routed to another station → refused **[Verified]**.
  - No station at all, or an item whose category has no route and no default station: "send to
    kitchen" is refused with an explanatory message **[Verified]**. Because paid takeaway/pickup
    orders are auto-sent inside the payment transaction, this refusal also **fails the payment**
    when auto-send is on (FND-814).
  - Station deactivated with open tickets: tickets keep their station id; the kitchen board lists
    only active stations but the ticket query is not filtered by station status when "all
    stations" is selected **[Inferred]**.
- **Existing controls:**
  - CTL-807 One default station per branch; one station per category per branch.
  - CTL-808 Cross-tenant category ids rejected.
  - CTL-809 Audit on create/update; deactivate-not-delete.
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** Categories (Catalog domain).
- **Downstream effects:** BP-808 ticket creation; BP-815 auto-send.
- **Observations:** FND-814.

#### BP-804 Define modifier groups, modifiers, surcharges and modifier ingredients
- **Business purpose:** Capture guest choices (size, doneness, add-ons) that change the price
  and/or consume an extra ingredient.
- **Actors and required authority:** Merchant-wide "Configure restaurant" (groups are shared by
  all branches).
- **Trigger / inputs:** Group name, minimum and maximum selections (0 ≤ min ≤ max ≤ 50; min ≥ 1
  means "required"), status; per option: name, surcharge (≥ 0, KWD 3 decimals), optional
  ingredient (a stock-tracked variant) and quantity consumed per unit of the item.
- **Normal flow:**
  1. The manager saves the group with its full option list. Options with an id are updated,
     new ones inserted; options **left out are deactivated, never deleted**, because past orders
     and bills refer to them **[Verified]**.
  2. Ingredient variant ids are checked to belong to the merchant **[Verified by test]**;
     ingredient and quantity must be given together (database check and contract) **[Verified]**.
  3. Surcharge and ingredient quantity are stored exactly (integer fils; 3-decimal quantity)
     **[Verified]**.
- **Exceptional cases and their handling:**
  - Minimum above maximum, empty name, negative surcharge → validation refusal **[Verified]**.
  - Another merchant's variant as ingredient → 400 **[Verified by test]**.
  - The UI offers as ingredient only stock-tracked items **[Verified]**; the API does not itself
    re-check that a modifier ingredient is stock-tracked (recipes do) — an untracked ingredient
    simply produces no stock movement **[Verified]**.
  - Price change of a modifier after an item was ordered: the order keeps its **snapshot** of the
    modifier name and surcharge; the bill uses the snapshot (see BP-815) **[Verified]**.
- **Existing controls:**
  - CTL-810 Merchant-wide authority; versioned group row; audit on save.
  - CTL-811 Deactivate-not-delete for options; order-level snapshot immutable (no update/delete
    on order-item modifiers at database level).
- **Financial / stock / cash effect:** Determines future unit prices (surcharge) and future
  ingredient deductions.
- **Upstream dependencies:** Catalog variants for ingredients; stock-tracking flags.
- **Downstream effects:** BP-807 (validation of choices), BP-811 and BP-815 (ingredient
  deduction), receipts.
- **Observations:** FND-803 (snapshot asymmetry), FND-815.

#### BP-805 Configure a menu item: modifier groups and recipe
- **Business purpose:** Attach the choice lists to a product and define which ingredients one
  unit of the item consumes, so that stock and cost of sales are computed from ingredients
  rather than from the finished dish.
- **Actors and required authority:** Merchant-wide "Configure restaurant".
- **Trigger / inputs:** For a product: ordered list of modifier groups (max 20); per variant a
  recipe (up to 50 ingredients, each a stock-tracked variant of another product with a positive
  3-decimal quantity).
- **Normal flow:**
  1. The manager edits the item. The system replaces the product's group links and each
     variant's recipe lines in full (link tables are replaced, not versioned) and audits
     "menu item updated" with counts **[Verified]**.
  2. Validation: a recipe is allowed only on products that are **not** stock-tracked themselves
     (otherwise the dish and its ingredients would both be deducted) **[Verified by test]**;
     ingredients must be stock-tracked; an item cannot be its own ingredient; recipe variants
     must belong to the product **[Verified]**.
- **Exceptional cases and their handling:**
  - Recipe on a tracked item → 409 "turn off stock tracking first" **[Verified by test]**.
  - Untracked ingredient → "ingredients must be stock-tracked items" **[Verified]**.
  - Another merchant's product id → not found **[Verified by test]**.
  - Recipe changes are **not historised**: a bill consumes the recipe in force at payment time;
    the sale line keeps the computed unit cost, but the recipe lines themselves are overwritten
    **[Verified]**.
- **Existing controls:**
  - CTL-812 Double-deduction guard (recipe only on untracked items).
  - CTL-813 Ingredient ownership and tracking checks; self-reference check at database level.
  - CTL-814 Audit entry with group and recipe-line counts.
- **Financial / stock / cash effect:** Determines the stock deduction and cost of sales of
  future bills and waste.
- **Upstream dependencies:** Catalog (products, variants, tracking flag), BP-804.
- **Downstream effects:** BP-811 (waste), BP-815 (sale stock movement and cost), Inventory
  valuation, gross-profit report.
- **Observations:** FND-817 (no recipe history).

#### BP-806 Open an order (dine-in, takeaway, pickup)
- **Business purpose:** Start a document that collects what a party ordered before any money
  changes hands.
- **Actors and required authority:** POS user with "Take restaurant orders" at the bound branch;
  the POS screen additionally requires an open shift (UI guard), the API does not **[Verified]**.
- **Trigger / inputs:** Tap a free table (dine-in; optional guest count 1–100), or "New
  takeaway / New pickup" with an optional customer name (60 chars) and note (300 chars).
- **Normal flow:**
  1. The system checks the module is enabled and, for dine-in, that the table exists at the
     session's branch and is active **[Verified]**.
  2. It draws the next **order number** `R-000001…` from a merchant-wide, gap-free counter
     (row-locked upsert) **[Verified]**; cancelled or merged orders keep their number.
  3. It stores the order (type, table, guests, label, note, opened-by user, opened-at, status
     open) and audits "order opened" with number and type **[Verified]**.
  4. The floor shows the table as occupied with the running amount due and kitchen badges;
     takeaway/pickup orders appear in the queue **[Verified]**. The floor refreshes every 10 s.
- **Exceptional cases and their handling:**
  - Table already has an open order → "table occupied" (partial unique index on open orders per
    table, also protecting against two tablets opening the same table simultaneously)
    **[Verified by test]**.
  - Inactive or foreign-branch table → not found **[Verified by test]**; another merchant's table
    id → not found **[Verified by test]**.
  - Module disabled → refused **[Verified by test]**.
  - Orders have **no link to a shift or business day**; they stay open across shift closes and
    calendar days with no ageing or warning **[Verified]** (FND-801, FND-824).
  - There is no manager-side endpoint or screen listing open orders; visibility is limited to the
    POS floor of that branch **[Verified]** (FND-801).
- **Existing controls:**
  - CTL-815 One open order per table enforced by the database.
  - CTL-816 Branch binding of the POS session; table must belong to the same branch.
  - CTL-817 Gap-free order numbering; opened-by user recorded; audit entry.
- **Financial / stock / cash effect:** None; the order is unbilled revenue exposure until BP-815.
- **Upstream dependencies:** BP-801, BP-802.
- **Downstream effects:** BP-807…BP-815.
- **Observations:** FND-801, FND-810, FND-824.

#### BP-807 Add items with modifiers and notes
- **Business purpose:** Record what the guests ordered, with choices and kitchen instructions.
- **Actors and required authority:** "Take restaurant orders" at the branch; any such user, not
  only the one who opened the order **[Verified]**.
- **Trigger / inputs:** Menu tile; if the product has modifier groups, a dialog enforcing the
  min/max per group, a quantity (up to 6 integer and 3 decimal digits) and a note (200 chars);
  the order's current version.
- **Normal flow:**
  1. The system locks the order row, requires it to be open, and bumps its version only if the
     client's version matches (two tablets editing the same table: the stale one is refused)
     **[Verified by test]**.
  2. Each item is checked to be sellable at this branch (active product and variant, branch
     availability) **[Verified]**.
  3. Every chosen modifier must belong to one of the product's groups and each group's min/max
     must hold; otherwise the whole request is refused with the first problem named
     **[Verified by test]**.
  4. The item is inserted (position, quantity, note, added-by user, kitchen status "pending")
     with an immutable **snapshot of chosen modifiers (name and surcharge)**. The item's base
     price is **not** snapshotted; the displayed unit price is always the catalog price of the
     moment plus the snapshot surcharges **[Verified]**.
  5. Audit "items added" with the **count** of items only **[Verified]**.
- **Exceptional cases and their handling:**
  - Order closed/cancelled/merged → "already closed" **[Verified]**.
  - Zero/negative quantity → refused; unavailable item → "cannot be sold here" **[Verified]**.
  - Price override and line discounts are not possible on order items **[Verified]**.
  - Quantity or product of an item cannot be edited afterwards; the only correction is cancel
    and re-add (database trigger forbids quantity/variant changes on sent items, and the API
    offers no edit at all) **[Verified]**.
  - Items can be added to an order that already has paid bills, until it is closed **[Verified]**.
- **Existing controls:**
  - CTL-818 Row lock + optimistic version per order.
  - CTL-819 Server-side modifier validation (membership and min/max), server-side availability.
  - CTL-820 Immutable modifier snapshot; added-by user per item.
- **Financial / stock / cash effect:** None yet (no stock, no cash). The "due" figure on the floor
  is computed live at current prices.
- **Upstream dependencies:** BP-804, BP-805, Catalog prices and branch availability.
- **Downstream effects:** BP-808, BP-815.
- **Observations:** FND-803, FND-816, FND-817.

#### BP-808 Send items to the kitchen
- **Business purpose:** Commit the ordered items to preparation; creates the work tickets per
  station.
- **Actors and required authority:** "Take restaurant orders" at the branch.
- **Trigger / inputs:** "Send to kitchen" button (enabled when the order has unsent items);
  also performed automatically for takeaway/pickup inside BP-815 when auto-send is on.
- **Normal flow:**
  1. The system locks the order and collects items in status "pending" **[Verified]**.
  2. Each item is routed by its product's category to the station that owns that category at
     the branch, else to the default station; one **ticket per station** per send is created and
     the items move to "queued" with their station and ticket ids **[Verified by test]**.
  3. The order version is bumped and "sent to kitchen" is audited with item and ticket counts
     **[Verified]**.
  4. Repeating "send" with nothing pending creates nothing (idempotent) **[Verified by test]**.
- **Exceptional cases and their handling:**
  - No station/default station → refused with a set-up message **[Verified]**.
  - Items added later form a new ticket; earlier tickets are unaffected **[Verified by test]**.
  - Sending does **not** touch stock (ADR-0074) **[Verified by test]**.
- **Existing controls:**
  - CTL-821 Order lock; status "pending" is the only source of a new ticket (no double tickets).
  - CTL-822 Audit entry with counts.
- **Financial / stock / cash effect:** None. From this point an item can be cancelled only by a
  holder of "Void sent items" (BP-811).
- **Upstream dependencies:** BP-803, BP-807.
- **Downstream effects:** BP-809, BP-811.
- **Observations:** none specific.

#### BP-809 Kitchen display and status progression
- **Business purpose:** Let preparation staff see what to cook, in which order, with notes and
  modifiers, and signal readiness.
- **Actors and required authority:** "Use the kitchen display" at the bound branch (Kitchen
  role; Supervisor also has it). Kitchen staff need no shift and land on the kitchen screen
  **[Verified]**.
- **Trigger / inputs:** Board refreshed every 5 s; optional station filter; one button per
  ticket advancing New → Preparing → Ready → Done.
- **Normal flow:**
  1. The board lists tickets in New/Preparing/Ready, plus Done tickets of the last 15 minutes,
     with order number, table or customer label, item quantities, modifiers, notes and an age
     badge (amber from 8 min, red from 15 min) **[Verified]**.
  2. A tap moves the ticket **forward only**; timestamps started/ready/completed are set (a
     skipped step is back-filled) and every non-cancelled item on the ticket takes the
     corresponding status (preparing, ready, **served** when completed) **[Verified by test]**.
  3. A stale or repeated tap that would not move forward is ignored and returns the current
     state; a forward move with a stale version is refused **[Verified by test]**.
- **Exceptional cases and their handling:**
  - Cancelled ticket → refused **[Verified]**.
  - Kitchen staff cannot create orders or bills (403) and the kitchen never creates sales,
    payments or stock movements **[Verified by test]**.
  - A cashier without kitchen permission cannot change tickets (403) **[Verified by test]**.
  - Ticket status changes are **not written to the audit log**; only ticket timestamps remain
    **[Verified]** (FND-811).
  - "Served" is set by the kitchen's "Done", not by the waiter; there is no runner/handover step
    **[Verified]** (FND-811).
- **Existing controls:**
  - CTL-823 Forward-only state machine with optimistic version; branch-bound.
  - CTL-824 Segregation: kitchen permission cannot order or bill.
- **Financial / stock / cash effect:** None (BR-138).
- **Upstream dependencies:** BP-808.
- **Downstream effects:** Floor badges (ready count); BP-811 (status "served" still cancellable).
- **Observations:** FND-811.

#### BP-810 Cancel an item before it is sent
- **Business purpose:** Correct an entry mistake or a changed mind before the kitchen starts.
- **Actors and required authority:** "Take restaurant orders" at the branch (any waiter/cashier).
- **Trigger / inputs:** Tap the item → reason (1–200 chars, free text, mandatory in UI and API).
- **Normal flow:**
  1. Order and item rows are locked; the item must be in this order, not cancelled, not paid
     **[Verified]**.
  2. For a pending item the waste flag is ignored; the item becomes "cancelled" with reason,
     time and cancelled-by user; the row is kept **[Verified]**.
  3. If every remaining item is paid and at least one bill exists, the order closes
     automatically **[Verified]**.
  4. Audit "item cancelled" with order id, sent=false, waste=false, reason **[Verified]**.
- **Exceptional cases and their handling:**
  - Already cancelled → "already cancelled" (final; database trigger also forbids any later
    update of a cancelled item) **[Verified by test]**.
  - Paid item → "use a refund instead" **[Verified]**.
  - No stock or cash effect **[Verified by test]**.
- **Existing controls:**
  - CTL-825 Mandatory reason; cancelled-by user; immutable cancelled row.
  - CTL-826 Paid items cannot be cancelled (API and database trigger).
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-807.
- **Downstream effects:** Due amount; BP-815 closing rule.
- **Observations:** FND-817 (free-text reasons, thin audit).

#### BP-811 Cancel (void) an item already sent to the kitchen — waste and ingredient deduction
- **Business purpose:** Handle items the kitchen already received: refused by the guest,
  dropped, wrongly entered, or given away.
- **Actors and required authority:** "Take restaurant orders" **and** "Void sent items" at the
  branch (Supervisor by default; Cashier refused with 403) **[Verified by test]**.
- **Trigger / inputs:** Tap the sent item → warning, reason, and a "wasted (prepared and thrown
  away)" checkbox **pre-ticked** for sent items **[Verified]**.
- **Normal flow:**
  1. Locks as in BP-810; the supervisor's permission is checked because the item is not pending
     **[Verified]**.
  2. If **waste** is ticked: the item's consumption is expanded (recipe ingredients, or the item
     itself if it is stock-tracked, plus modifier ingredients) and deducted **now** from the
     branch stock through the inventory ledger as an *adjustment* with reason "restaurant
     waste", source = the order item, the cancel reason as note, and the supervisor as user. The
     ledger values the movement at the current weighted-average cost **[Verified by test]**.
  3. If waste is **not** ticked ("not prepared"): no stock movement at all **[Verified]**.
  4. The item becomes cancelled (reason, time, wasted flag, cancelled-by). If no live item is
     left on the ticket, the ticket is cancelled **[Verified by test]**. Order closes if settled.
  5. Audit "item cancelled" with sent=true, waste flag and reason **[Verified]**.
- **Exceptional cases and their handling:**
  - Insufficient ingredient stock and negative stock not allowed (the default) → the waste
    deduction fails with "insufficient stock" and the cancellation is **not** recorded; the only
    way through is to untick "wasted" **[Verified from ledger rules]** (FND-807).
  - Items in status "served" (kitchen pressed Done) can still be cancelled by a supervisor, with
    or without waste **[Verified]**: a served item voided as "not prepared" leaves neither a stock
    deduction nor revenue — this is the de-facto "complimentary" path and has no separate
    authorisation, limit or report (FND-808).
  - Waste is **never valued or listed** in any restaurant or waste report; it appears only in the
    inventory movement totals under "adjustment" and in the stock-movement ledger with reason key
    `restaurant_waste`, for which the manager UI has no label **[Verified / Inferred for the
    label]** (FND-805).
  - Voiding does not affect any bill; paid items are excluded (BR-139).
- **Existing controls:**
  - CTL-827 Separate permission for sent items (Supervisor and above).
  - CTL-828 Mandatory reason; cancelled-by user; immutable cancelled row; ticket auto-cancel.
  - CTL-829 Waste deduction through the single stock ledger (valued, append-only, traceable to
    the order item and user).
- **Financial / stock / cash effect:** With waste: stock quantities and stock value of the
  ingredients decrease at average cost; no sales figure; the loss is not reported as a cost
  line anywhere. Without waste: nothing changes.
- **Upstream dependencies:** BP-805 (recipe), BP-808.
- **Downstream effects:** Inventory ledger and valuation; stock-count variances (an unrecorded
  waste shows up later as shrinkage).
- **Observations:** FND-805, FND-807, FND-808.

#### BP-812 Cancel a whole order
- **Business purpose:** Abandon an order that never reached the kitchen (walk-out before
  ordering, duplicate entry).
- **Actors and required authority:** "Take restaurant orders" at the branch; no reason is asked.
- **Trigger / inputs:** "Cancel order" button (enabled only when nothing was sent and no bill
  exists) with the order version.
- **Normal flow:**
  1. The order is locked; it must have no paid items and no item sent to the kitchen (cancelled
     items do not count) **[Verified]**.
  2. All pending items are cancelled with reason "order cancelled", waste=false and the user;
     the order becomes "cancelled" with closed-at **[Verified]**; audit "order cancelled".
- **Exceptional cases and their handling:**
  - Paid bills exist → refused ("cannot be cancelled") **[Verified]**.
  - Sent items exist → "cancel the sent items first" (which needs a supervisor) **[Verified]**.
  - Stale version → conflict. Final status is enforced by a database trigger (no further update
    of a closed/cancelled/merged order) **[Verified]**.
- **Existing controls:**
  - CTL-830 Cannot cancel around paid bills or sent items.
  - CTL-831 Database finality trigger; audit entry.
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-806.
- **Downstream effects:** Table freed.
- **Observations:** FND-817 (no reason captured for whole-order cancellation).

#### BP-813 Move an order to another table
- **Business purpose:** Re-seat guests without re-entering their order.
- **Actors and required authority:** "Take restaurant orders" at the branch (any such user, not
  only the waiter who opened it).
- **Trigger / inputs:** "Move table" → list of free active tables of the branch.
- **Normal flow:**
  1. Order locked and must be open and dine-in; target table must exist at the branch and be
     active **[Verified]**.
  2. Table id is replaced under the version check; audit "order moved" with from/to table ids
     **[Verified by test]**.
- **Exceptional cases and their handling:**
  - Target occupied → "table occupied" (database index, race-safe) **[Verified by test]**.
  - Takeaway/pickup → "only dine-in orders sit at a table"; converting an order type is not
    possible **[Verified]**.
  - No limit on how often an order moves; no approval **[Verified]**.
- **Existing controls:**
  - CTL-832 Row lock + version; occupancy index; audit with from/to.
- **Financial / stock / cash effect:** None (BR-137).
- **Upstream dependencies:** BP-802, BP-806.
- **Downstream effects:** Floor view; later bills still carry the order id (service type unchanged).
- **Observations:** FND-810.

#### BP-814 Combine (merge) two orders
- **Business purpose:** Join two parties or two tables into one bill.
- **Actors and required authority:** "Take restaurant orders" at the branch.
- **Trigger / inputs:** From the target order: "Combine" → choose another open order (any
  occupied table or queue order); target version.
- **Normal flow:**
  1. Both orders are locked in a fixed id order (deadlock-safe); both must be open at the branch;
     the target's version is checked **[Verified]**.
  2. The **source** must have no paid item; otherwise refused **[Verified by test]**.
  3. All non-cancelled items of the source are re-numbered after the target's items and moved,
     with their kitchen status and tickets; the source becomes "merged" with a pointer to the
     target and a closed-at time; cancelled items stay on the source **[Verified by test]**.
  4. Audit "orders merged" on the target with the source id **[Verified]**.
- **Exceptional cases and their handling:**
  - Same order → refused; a paid bill on the **target** does not block merging into it
    **[Verified]**.
  - Order types may differ (a takeaway can be merged into a dine-in order); future bills carry the
    target's service type, so service-type reporting follows the target **[Verified]** (FND-822).
  - The merge dialog lists only orders visible on the floor; an order on a deactivated table
    cannot be chosen (FND-802).
- **Existing controls:**
  - CTL-833 Deterministic double lock; source-paid guard so revenue is never moved or doubled.
  - CTL-834 Source finality (database trigger) and audit link.
- **Financial / stock / cash effect:** None (BR-137).
- **Upstream dependencies:** BP-806/807.
- **Downstream effects:** BP-815 bills on the target.
- **Observations:** FND-810, FND-822.

#### BP-815 Quote and pay a bill (split bills, tenders, discounts) and order closing
- **Business purpose:** Convert chosen unpaid items into money through the standard checkout:
  one immutable sale per bill, with receipt, payments into the cashier's drawer, stock deduction
  and cost of sales.
- **Actors and required authority:** POS user with "Take restaurant orders" (to reach the
  screen and quote) and "Create sales" at the branch, with **their own open shift** at that
  branch **[Verified]**. Discounts need "Give discounts"; above the merchant's maximum
  percentage, "Exceed discount limit" (Sales domain rules) **[Verified]**.
- **Trigger / inputs:** "Pay bill" → tick the unpaid items to include (all pre-ticked) → quoted
  total → the common payment dialog (one or several tenders, cash tendered/change, card
  reference) → idempotency key generated by the client; optional customer; optional order-level
  discount (API only, see exceptions).
- **Normal flow:**
  1. **Quote.** The chosen items are validated (belong to the order, not cancelled, not already
     paid) and priced: **current catalog price per item + snapshot modifier surcharges**, times
     quantity, minus an optional order discount; the quote returns subtotal, discounts, total
     **[Verified by test: 4.500 for 2 × 2.250]**.
  2. **Pay.** A request hash is computed; a replay with the same idempotency key and payload
     returns the first bill unchanged **[Verified by test]**.
  3. Inside one transaction: module must be enabled; the cashier's open shift at the branch is
     locked (one checkout at a time per shift); the order is locked and must be open; items are
     re-validated; the checkout engine re-prices every line from the catalog (never trusting the
     client), checks discount rights and limit, checks that the total equals the total the
     cashier saw (otherwise "prices changed, review"), checks that tenders cover the total
     exactly, numbers the receipt (gap-free per branch), **deducts stock once** — recipe
     ingredients and modifier ingredients for recipe items, the item itself for tracked items —
     computes the cost of sale from the consumed quantities at average cost, and writes the sale
     with its lines, modifier snapshot, payments and drawer entries, linked to the order id and
     service type **[Verified by test: stock bun/patty −2, cheese −4, cola −2; cost 0.700 per
     burger]**.
  4. The paid items are stamped with the sale id (database trigger then forbids any change to
     them) **[Verified]**.
  5. For takeaway/pickup with auto-send on, unsent items are sent to the kitchen in the same
     transaction **[Verified by test]**.
  6. If every non-cancelled item is now paid and at least one bill exists, the order closes
     (status closed, closed-at) and the table is freed **[Verified by test]**; audit "bill paid"
     with sale id and item count.
  7. The receipt dialog opens; the order screen lists bills with receipt numbers; the "paid"
     figure is the sum of bill totals **[Verified]**.
- **Exceptional cases and their handling:**
  - Split by items: several bills over disjoint item sets **[Verified by test]**; split among
    payers: several tenders on one bill **[Verified by test]**. **No fractional split** of one item
    (e.g. one dish shared by two bills) and no "equal shares" split **[Verified; stated in
    PROGRESS]**.
  - Paying an item twice → "already paid" (409); three simultaneous pays of the same item → one
    sale, two refusals, stock deducted once **[Verified by test]**.
  - No open shift → "open a shift first" (409) **[Verified]**; module disabled → refused.
  - Total changed since the quote (price edited in the catalog meanwhile) → "prices changed"; the
    cashier re-quotes and the guest pays the **new** price **[Verified]** (FND-803).
  - Item deactivated or removed from the branch after ordering → "item unavailable"; it can only
    be cancelled/voided, never billed **[Verified]** (FND-816).
  - Ingredient stock insufficient and negative stock not allowed → "insufficient stock" and the
    **bill cannot be paid** although the food was served **[Verified from engine rules]** (FND-806).
  - Discounts: the API accepts an order-level discount on quote and pay with the retail rules;
    the POS bill dialog **offers no discount control** **[Verified]** (FND-804). Line discounts
    and price overrides are never possible on bills **[Verified]**.
  - Auto-send failing (no station) rolls back the payment **[Verified]** (FND-814).
  - Refund/void of a bill afterwards: handled by the Refunds domain; recipe items are **never
    restocked** (they are not stock-tracked), tracked items (e.g. a canned drink) are restocked by
    default **[Verified]**. The order is **not** reopened and the items keep their sale id
    (database forbids clearing it), so they cannot be billed again; the order's "paid" figure
    still counts the refunded bill **[Verified]** (FND-812).
- **Existing controls:**
  - CTL-835 Idempotency key + request hash; replay returns the same bill; unique-key race handled.
  - CTL-836 Order row lock + item "already paid" check + database trigger on paid items
    (no double billing even under concurrency).
  - CTL-837 Checkout engine: server pricing, discount rights/limit, expected-total check, exact
    tenders, shift lock, gap-free receipt, single stock deduction, cost capture, audit.
  - CTL-838 Service type and order id stamped on the sale; modifier snapshot copied to the sale.
  - CTL-839 Automatic close only when everything is paid and at least one bill exists.
- **Financial / stock / cash effect:** Register drawer (and card/other tenders) increase by the
  tenders; sales figures increase by the bill total; stock quantities and value decrease for the
  consumed ingredients/items at average cost; cost of sales recorded on the sale. After commit the
  sale, its lines, modifier snapshot and payments are immutable (Sales domain); the paid order
  items are frozen.
- **Upstream dependencies:** Open shift (Cash custody), catalog prices and availability,
  BP-805 recipes, payment methods.
- **Downstream effects:** Sales lists and reports (service type), cash reconciliation at shift
  close, inventory valuation and gross profit, refunds, customer history when a customer is
  attached.
- **Observations:** FND-803, FND-804, FND-806, FND-809, FND-812, FND-816.

#### BP-816 Receipts, lists and reports for restaurant sales
- **Business purpose:** Show guests and management what was sold with which options, and let
  management analyse dine-in / takeaway / pickup / retail separately.
- **Actors and required authority:** Receipt: the cashier (POS). Lists: "Read sales"; reports:
  "Sales reports" (Reports domain scoping by branch).
- **Trigger / inputs:** Receipt after payment or from the order's bill list; manager sales list;
  sales report for a period.
- **Normal flow:**
  1. The POS receipt prints each line with the modifier **names** under it and a unit price that
     already includes the surcharges; discounts, totals, tenders and change follow **[Verified]**.
  2. The sales API lists sales with a service-type filter (dine-in, takeaway, pickup, retail)
     and the detail carries the restaurant order id and modifiers **[Verified by test]**.
  3. The sales report has a "by service type" table (count and net sales) next to the channel
     table; gross profit uses the recorded cost of sales **[Verified by test]**.
- **Exceptional cases and their handling:**
  - The manager sales list screen offers a **channel** filter and column but **no service-type
    filter or column**, and the manager sale detail does not show modifiers; the capability exists
    only in the API **[Verified]** (FND-815).
  - The receipt does not itemise the surcharge amounts; BR-132 says modifier prices are "printed
    on the receipt" — they are embedded in the unit price **[Verified]** (FND-815).
  - No report of open orders, voids/waste by employee or reason, average spend per guest, table
    turnover or kitchen times, although the data (guests, timestamps, cancelled items) is stored
    **[Verified]** (FND-801, FND-805, FND-819).
  - Sales by employee attribute each bill to the **cashier who took payment**; the waiter who
    opened the order or added items is recorded on the order only **[Verified]** (FND-809).
- **Existing controls:**
  - CTL-840 Service type persisted on every bill (database check restricts values); sale detail
    links back to the order.
  - CTL-841 Modifier snapshot persisted on sale lines (immutable).
- **Financial / stock / cash effect:** Reporting only.
- **Upstream dependencies:** BP-815.
- **Downstream effects:** Management review, external audit sampling.
- **Observations:** FND-805, FND-809, FND-815, FND-819.

#### BP-817 Floor supervision and end-of-day handling of open orders (largely absent)
- **Business purpose:** Make sure every order that was served is billed before the shift and
  the day close, and that abandoned orders are explained.
- **Actors and required authority:** Should be the shift supervisor / branch manager; today the
  floor view is available to anyone with "Take restaurant orders" at the branch (POS only).
- **Trigger / inputs:** Floor screen (10-second refresh) showing due amount and kitchen badges per
  table; queue of takeaway/pickup orders.
- **Normal flow (as it exists):**
  1. Staff look at the floor; occupied tables show the live amount due.
  2. Shift close (Cash custody domain) counts the drawer against drawer entries; it **does not
     consider** open restaurant orders **[Verified: no reference in the shifts service]**.
- **Exceptional cases and their handling:**
  - Orders left open survive shift close and day change silently; they are still editable the
    next day by anyone at the branch **[Verified]**.
  - Orders on deactivated tables vanish from the floor (FND-802).
  - Management has no screen, list, export or report of open or historical orders, cancelled
    items, merges or moves other than the audit log entries **[Verified]**.
- **Existing controls:**
  - CTL-842 Live due amount per table on the floor; audit log of order events (opened, items
    added, sent, cancelled, moved, merged, bill paid) with user, time and IP.
- **Financial / stock / cash effect:** Unbilled revenue is invisible to finance until billed.
- **Upstream dependencies:** BP-806…BP-815.
- **Downstream effects:** Cash custody cut-off; sales report completeness.
- **Observations:** FND-801, FND-802, FND-824.

### H.3 Interdependencies with other domains

The restaurant module deliberately owns no money and no stock of its own: an order is a
promise, a bill is a Sales-domain sale, stock moves only through the Inventory ledger (at
payment or at waste), cash moves only through the register drawer of the paying cashier's shift
(Cash custody), and corrections of paid items go through Refunds. Configuration leans on the
Catalog (products, variants, categories, prices, branch availability, tracking flags) and on the
Platform plan features. Reports consume the service type and the cost captured on each bill.

| From Restaurant → to | What flows | Direction / notes |
|---|---|---|
| Sales (checkout engine) | Bill = chosen order items at current price + modifier snapshot; order id and service type on the sale; receipt number | Restaurant calls the engine inside its own transaction; the engine owns pricing, discount rights, tenders, numbering |
| Cash custody (registers, shifts) | Tenders of each bill into the paying cashier's drawer; shift must be open and is locked per checkout | Restaurant has no shift concept of its own; open orders are invisible to shift close |
| Inventory | Stock deduction at payment (recipe + modifier ingredients, or the item), valued at average cost; waste adjustments at void time | Only through the stock ledger; negative-stock policy of Inventory governs whether a bill or a waste can be recorded |
| Refunds | Refund or void of a bill; recipe items never restocked; order not reopened | One-way: refunds do not inform the order |
| Catalog | Products/variants/prices/categories/availability define the menu; tracking flag decides recipe eligibility | Price edits change the amount due of open orders immediately |
| Customers | Optional customer on a bill (needs customer-read right) | Bill-level only, not order-level |
| Reports | Service-type table, cost of sales, employee attribution (cashier), movement totals incl. waste under "adjustment" | No restaurant-specific reports |
| Platform / Subscriptions | Plan feature `restaurant` gates enabling | Enabling only; no later re-check |
| Auth / RBAC | Four permissions; kitchen role; branch binding of POS sessions | Managers need explicit POS rights to act on the floor |
| Audit | Entries for settings, layout, modifiers, menu, order events, bills; none for kitchen status | Append-only log (Audit domain) |

### H.4 Findings

#### FND-801 Open orders are unbilled revenue with no management visibility, ageing or cut-off control
- **Classification:** Control gap / Missing process
- **Severity:** High
- **Evidence:** Orders carry no shift or business-day link; shift close ignores them; they stay
  open and editable indefinitely by any POS user with the order permission at the branch; the
  only view is the POS floor of that branch; there is no manager endpoint, list, export or
  report of open or historical orders; the floor requires an open shift in the UI only
  **[Verified]**. ADR-0073 describes orders as "mutable intent" but no document addresses how
  long they may remain open or who reviews them.
- **Potential financial impact:** Food served and never billed (walk-outs, collusion: open an
  order, serve, leave it open and cancel items the next day as "not prepared") is undetectable
  from the sales and cash records; period cut-off of revenue is unreliable at month end.
- **Affected procedures:** BP-806, BP-815, BP-817
- **Recommendation:** Add a manager list of orders (open/closed/cancelled/merged, with age, due,
  opened-by, branch) and an "open orders" block on the shift-close and daily summary; require a
  supervisor acknowledgement (reason) to close a shift or a day with open orders older than a
  configurable age; add an "orders open longer than X hours" alert in the dashboard.

#### FND-802 Dine-in orders on a deactivated table or area disappear from every screen while staying open
- **Classification:** Control gap
- **Severity:** High
- **Evidence:** A table or area can be set inactive with no check for an open order; the floor
  shows only active tables of active areas and the queue shows only non-dine-in orders; the move
  and combine dialogs are built from the floor; the order remains open, unbilled and reachable
  only by its URL or the database **[Verified]**.
- **Potential financial impact:** Unbilled revenue silently hidden; table permanently blocked
  from reuse once reactivated (occupancy index) without any visible reason.
- **Affected procedures:** BP-802, BP-806, BP-814, BP-817
- **Recommendation:** Refuse deactivating a table/area with an open order (or force a move
  first); show orders of inactive tables in an "unassigned" section of the floor; include them in
  the manager order list (FND-801).

#### FND-803 Item price is charged at payment time, modifier surcharge at ordering time (OQ-023)
- **Classification:** Owner decision to revisit
- **Severity:** Medium
- **Evidence:** The order item stores no base price; due amounts and bills use the catalog price
  of the moment plus the surcharge snapshot; a catalog price change between ordering and payment
  changes the guest's bill, protected only by the "prices changed, review" check for the cashier
  **[Verified]**. Documented as an open owner question (OQ-023, "audit F3") and in ADR-0073.
- **Potential financial impact:** Disputes with guests over menu prices; revenue measured at a
  price the guest did not agree to; no record of the price at ordering for audit; inconsistent
  treatment between item and modifier.
- **Affected procedures:** BP-804, BP-807, BP-815
- **Recommendation:** Decide and document; the usual hospitality practice is to snapshot the
  unit price (and surcharges) when the item is added and to let a supervisor re-price
  explicitly. At minimum, record the ordered price on the item for audit and warn the cashier
  when the billed price differs from it.

#### FND-804 Bill discounts exist in the API but not on the POS bill screen
- **Classification:** Inconsistency (doc vs behaviour)
- **Severity:** Low
- **Evidence:** BR-134 and PROGRESS present bill discounts as delivered; the quote and pay
  endpoints accept an order-level discount with retail rules; the bill dialog sends none and has
  no control for it **[Verified]**.
- **Potential financial impact:** None today; staff may give "discounts" by voiding items
  instead (see FND-808), which is worse for control.
- **Affected procedures:** BP-815
- **Recommendation:** Either add the discount control to the bill dialog (with the same
  limit/override behaviour as retail) or amend BR-134/PROGRESS to say discounts are API-only.

#### FND-805 Waste is valued in the ledger but reported nowhere; void reasons are not analysable
- **Classification:** Missing process (adequacy of reports)
- **Severity:** Medium
- **Evidence:** Waste movements carry quantity, average cost and value, user and reason, but the
  inventory report groups them into the generic "adjustment" line; the adjustments-by-reason
  table reads only adjustment documents, not restaurant waste; the manager UI has no label for
  the `restaurant_waste` reason; there is no report of cancelled/voided items by employee,
  reason, wasted/not wasted, or of their sales value **[Verified; label Inferred]**.
- **Potential financial impact:** Food cost leakage and void abuse remain invisible to
  management; stock-count variances cannot be explained.
- **Affected procedures:** BP-811, BP-816
- **Recommendation:** Add a "voids and waste" report (count, sales value forgone, ingredient
  cost, by employee/reason/shift) and include waste value as its own line in the inventory
  report; label the reason in the UI.

#### FND-806 A bill cannot be paid when ingredient stock is insufficient (negative stock denied)
- **Classification:** Financial risk
- **Severity:** High
- **Evidence:** Stock is deducted at payment through the ledger with the merchant's negative
  stock policy (default: deny); a shortage on any ingredient rejects the whole bill with
  "insufficient stock" after the food has been cooked and served **[Verified from code paths]**.
  The documented rule (BR-135) states the timing but not the consequence.
- **Potential financial impact:** Money for served food cannot be collected at the till; staff
  will work around it (cancel items as "not prepared", retail sale of a different item,
  under-the-counter cash), each of which misstates revenue or stock.
- **Affected procedures:** BP-815
- **Recommendation:** For restaurant bills, treat ingredient shortfalls as stock exceptions
  rather than payment blockers: allow the sale and let the balance go negative with a flagged
  movement and a manager alert, or deduct ingredients at "send to kitchen" with a clear
  policy. Document the chosen behaviour.

#### FND-807 Waste cannot be recorded when ingredient stock is insufficient, inviting "not prepared" declarations
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** The waste deduction uses the same ledger rule; a shortage rejects the void; the
  supervisor's only option is to untick "wasted", which records no stock effect **[Verified]**.
- **Potential financial impact:** Waste understated, stock overstated until the next count;
  shrinkage unexplained.
- **Affected procedures:** BP-811
- **Recommendation:** Always allow waste deductions (force negative with a flag) and surface
  the resulting negative balances to management.

#### FND-808 Complimentary or served-then-voided items leave no stock or revenue trace and have no second control
- **Classification:** Financial risk
- **Severity:** High
- **Evidence:** Any item not yet paid, including those the kitchen marked served, can be voided
  by a holder of "Void sent items" with a free-text reason; whether it is treated as waste is a
  checkbox the voider controls; "not wasted" removes the item without any stock movement; there
  is no "complimentary / on the house" concept, no limit per shift, no second approval and no
  report **[Verified]**. BR-136 says a prepared item "is recorded as waste", but the system
  relies on the voider's declaration.
- **Potential financial impact:** Classic hospitality fraud: serve, collect cash informally,
  void as "not prepared"; stock is then short at the next count with no explanation; revenue
  understated.
- **Affected procedures:** BP-811
- **Recommendation:** Default served items to "wasted/consumed" and require a distinct reason
  code (complimentary, guest complaint, wrong order, dropped) with a manager-visible report;
  record a zero-priced sale line for complimentary items so that food cost is captured; set
  per-shift void thresholds that need a second approver.

#### FND-809 Restaurant sales are attributed to the cashier who takes payment, not to the waiter
- **Classification:** Missing process
- **Severity:** Medium
- **Evidence:** Every bill is a sale of the paying user's membership and shift; the order's
  opened-by and each item's added-by users are stored on the order only; the employee report and
  sales list show the cashier **[Verified]**.
- **Potential financial impact:** Waiter performance, tip pooling and responsibility for
  voids/moves cannot be measured from sales data; in a counter-service set-up this is fine, in
  table service it is a reporting gap.
- **Affected procedures:** BP-815, BP-816
- **Recommendation:** Carry the order's server (opened-by, or an explicit "server" field) onto
  the sale and add a "sales by server" report; keep the cashier as the cash custodian.

#### FND-810 No ownership of tables: any order-taker at the branch may modify, move, merge or bill any order
- **Classification:** Control gap (segregation of duties)
- **Severity:** Medium
- **Evidence:** All order endpoints check only the permission at the branch; moves and merges
  need no supervisor; the audit log records who did what, which is the compensating control
  **[Verified]**.
- **Potential financial impact:** Items can be shifted between tables to confuse billing or to
  "lose" items before payment; responsibility for shortfalls is diluted.
- **Affected procedures:** BP-807, BP-813, BP-814
- **Recommendation:** Optionally assign a server to each order and require a supervisor (or
  the assigned server) for moves/merges and for cancellations on another server's order; show
  merges and moves in the order history and in the manager order list.

#### FND-811 Kitchen status changes are not audited and "served" is declared by the kitchen
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** Ticket progression writes timestamps on the ticket but no audit entry naming the
  user; pressing "Done" sets items to "served" without any waiter or runner confirmation
  **[Verified]**.
- **Potential financial impact:** Weak evidence in disputes about whether an item was actually
  served before a void; kitchen performance per employee cannot be reviewed.
- **Affected procedures:** BP-809, BP-811
- **Recommendation:** Record the user on each ticket transition (audit or ticket columns) and
  consider a waiter-side "served" confirmation.

#### FND-812 Refunding or voiding a bill does not reopen the order or flag it
- **Classification:** Inconsistency (behaviour vs behaviour)
- **Severity:** Medium
- **Evidence:** After a full void (e.g. wrong items billed) the order items keep their sale id
  (the database forbids clearing it), the order stays closed, its "paid" figure still counts the
  refunded bill, and the items cannot be billed again; the guest must be re-entered as a new
  order with new kitchen tickets **[Verified]**. BR-139 only says corrections go through
  refunds.
- **Potential financial impact:** Duplicate kitchen tickets and double food cost if the kitchen
  re-cooks; confusing order history; refunded bills shown as "paid" on the order.
- **Affected procedures:** BP-815, BP-816
- **Recommendation:** Show refunded/voided bills as such on the order and in the floor "paid"
  figure; allow a supervisor to re-open a fully voided bill's items for re-billing without
  re-sending to the kitchen.

#### FND-813 Disabling the module with open orders traps unbilled revenue
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** No open-order check on disable; payment is refused while the module is off, but
  adding, sending, cancelling, moving and merging are still accepted by the API **[Verified]**.
- **Potential financial impact:** Orders that can be altered but not billed until the module is
  re-enabled; inconsistent enforcement of the switch.
- **Affected procedures:** BP-801
- **Recommendation:** Refuse disabling while open orders exist (or list them); apply the module
  check uniformly to all order mutations.

#### FND-814 Payment of a takeaway/pickup bill fails when no kitchen station exists and auto-send is on
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** Auto-send runs inside the payment transaction and throws when no station can
  receive an item, rolling the sale back **[Verified]**. Default setting is auto-send on.
- **Potential financial impact:** Till blocked by a configuration omission at a new branch.
- **Affected procedures:** BP-803, BP-815
- **Recommendation:** Skip auto-send (with a warning) when routing is impossible, or validate
  station set-up when the module is enabled per branch.

#### FND-815 Manager screens lag the API: no service-type filter/column, no modifiers on the manager sale detail, surcharges not itemised on receipts
- **Classification:** Inconsistency (doc vs behaviour)
- **Severity:** Low
- **Evidence:** The manager sales list filters by channel only; the API supports service type;
  the manager sale detail shows no modifiers; the POS receipt prints modifier names under the
  line and a unit price that includes surcharges, whereas BR-132 says modifier prices are printed
  **[Verified]**.
- **Potential financial impact:** Weaker management review and guest transparency.
- **Affected procedures:** BP-816
- **Recommendation:** Add the service-type filter/column and modifier display in the manager
  app; print "+ surcharge" amounts next to each modifier on the receipt.

#### FND-816 Items made unavailable after ordering cannot be billed
- **Classification:** Financial risk
- **Severity:** Medium
- **Evidence:** Billing re-validates each item against current status and branch availability;
  an item deactivated or withdrawn from the branch after it was ordered (and possibly served)
  returns "item unavailable"; the only exits are cancel/void **[Verified]**.
- **Potential financial impact:** Served food that cannot be charged; revenue leakage during menu
  changes.
- **Affected procedures:** BP-807, BP-815
- **Recommendation:** Allow billing of already-ordered items regardless of later availability
  changes (availability should gate ordering, not settlement).

#### FND-817 Thin order-level audit trail: no item detail on "items added", free-text reasons, no recipe history
- **Classification:** Control gap (audit trail)
- **Severity:** Low
- **Evidence:** The "items added" audit entry records only a count; cancellation reasons are free
  text with no reason codes; whole-order cancellation asks no reason; recipe and routing changes
  overwrite the previous definition without history (the audit entry has counts only)
  **[Verified]**.
- **Potential financial impact:** Harder reconstruction of what was ordered when and why items
  disappeared; cost-of-sales changes after recipe edits cannot be explained from history.
- **Affected procedures:** BP-805, BP-807, BP-810, BP-812
- **Recommendation:** Log item ids, quantities and the unit price at the time in the audit
  details; introduce reason codes for cancellations; keep a versioned recipe history.

#### FND-819 Guest counts and kitchen timings are captured but never reported
- **Classification:** Missing process
- **Severity:** Low
- **Evidence:** Guests per dine-in order, opened/closed times and ticket timestamps are stored;
  no report uses them (covers, average spend per guest, table turnover, preparation time)
  **[Verified]**.
- **Potential financial impact:** Management information only.
- **Affected procedures:** BP-806, BP-809, BP-816
- **Recommendation:** Add a restaurant operations report when the module matures.

#### FND-822 Merging mixes service types; the bill takes the target's type
- **Classification:** Inconsistency (behaviour vs behaviour)
- **Severity:** Low
- **Evidence:** A takeaway order can be merged into a dine-in order (or the reverse); later
  bills are stamped with the target's service type **[Verified]**.
- **Potential financial impact:** Minor distortion of the service-type report.
- **Affected procedures:** BP-814, BP-816
- **Recommendation:** Restrict merges to the same service type or let the user confirm the
  resulting type.

#### FND-824 "Waiters need an open shift" is enforced by the screen, not by the system
- **Classification:** Inconsistency (doc vs behaviour)
- **Severity:** Low
- **Evidence:** PROGRESS states waiters need an open shift to use the floor; the POS route guard
  enforces it, the API does not: opening, adding, sending, cancelling, moving and merging need no
  shift; only payment locks a shift; orders record no shift **[Verified]**.
- **Potential financial impact:** Order activity cannot be tied to a shift for cut-off; a user
  without a shift can alter orders through the API.
- **Affected procedures:** BP-806, BP-817
- **Recommendation:** Either drop the claim or enforce it server-side and record the shift (or
  business day) on the order for cut-off reporting.

### H.5 Documented owner decisions touching this domain

| Id | Decision (one line) | Residual risk (one line) |
|---|---|---|
| BR-130 / ADR-0072 | Restaurant is an optional per-company module on top of the retail POS; the menu is the catalog | Disabling with open orders is unguarded (FND-813) |
| BR-131 | One open order per table; dine-in needs a table; takeaway/pickup carry a name | Orders on deactivated tables vanish from view (FND-802) |
| BR-132 | Required groups must be answered; surcharges added to the unit price and printed | Surcharge amounts are not itemised on the receipt (FND-815) |
| BR-133 / ADR-0073 | A bill pays chosen unpaid items at the current price; each item paid once; order closes when all paid | Price at payment ≠ price at ordering (FND-803); refund does not reopen (FND-812) |
| BR-134 | Bill discounts follow retail rules and limits | Not reachable from the POS bill screen (FND-804) |
| BR-135 / ADR-0074 | Stock deducted at payment (ingredients for recipe items), never on kitchen events | Shortfalls block payment (FND-806); open orders hold no stock (reservations) |
| BR-136 / ADR-0074 | Voiding a sent item needs a supervisor and a reason; if prepared it is waste and ingredients are deducted | "Prepared" is the voider's declaration; no limit or report (FND-805, FND-808); waste blocked by shortfalls (FND-807) |
| BR-137 | Moving or combining never changes money; orders with paid bills cannot be combined | Any order-taker may move/merge; mixed service types (FND-810, FND-822) |
| BR-138 / ADR-0075 | Kitchen status only moves forward; tickets per station; never creates money | Kitchen transitions unaudited (FND-811) |
| BR-139 | Paid items are corrected by refunds of their bill, not by editing the order | Recipe items never restocked; order shows refunded bills as paid (FND-812) |
| OQ-020 | Service charge, tips, courses/fire timing, kitchen printers, reservations: not implemented | Tips/service charge handled outside the system if at all; cash reconciliation may not match guest payments |
| OQ-023 (audit F3) | Implemented: modifiers priced at ordering, item at payment; owner decision pending | See FND-803 |
| ADR-0088 (indirect) | Plan feature `restaurant` gates enabling (checked once at enable time) | Plan downgrades do not switch the module off |

### H.6 Technical mapping (appendix)

| BP id | Permission keys | Main tables | Screens / routes | Document number prefix |
|---|---|---|---|---|
| BP-801 | `restaurant.manage` (merchant-wide); read: `@Authenticated` | `restaurant_settings`, `audit_log` | `/manager/restaurant` Setup tab; `GET/PUT /manager/restaurant/settings`; `GET /pos/restaurant/settings` | — |
| BP-802 | `restaurant.manage` (branch) | `dining_areas`, `dining_tables` | `/manager/restaurant` Floor tab; `/manager/restaurant/layout`, `/areas`, `/tables` | — |
| BP-803 | `restaurant.manage` (branch) | `kitchen_stations`, `kitchen_station_categories` | `/manager/restaurant` Floor tab; `/manager/restaurant/stations` | — |
| BP-804 | `restaurant.manage` (merchant-wide) | `modifier_groups`, `modifiers` | `/manager/restaurant` Modifiers tab; `/manager/restaurant/modifier-groups` | — |
| BP-805 | `restaurant.manage` (merchant-wide) | `product_modifier_groups`, `recipe_components` | `/manager/restaurant` Menu tab; `GET /manager/restaurant/menu`, `PUT /manager/restaurant/menu/:productId` | — |
| BP-806 | `pos.access`, `restaurant.orders` (bound branch) | `restaurant_orders`, `document_sequences` (kind `restaurant_order`) | `/pos/tables` (FloorPage); `GET /pos/restaurant/floor`, `POST /pos/restaurant/orders` | `R-000001` |
| BP-807 | `restaurant.orders` | `restaurant_order_items`, `restaurant_order_item_modifiers` | `/pos/tables/orders/:orderId` (OrderPage, ModifierDialog); `POST /pos/restaurant/orders/:id/items`; `GET /pos/restaurant/menu` | — |
| BP-808 | `restaurant.orders` | `kitchen_tickets`, `restaurant_order_items` | OrderPage "Send to kitchen"; `POST /pos/restaurant/orders/:id/send` | — |
| BP-809 | `kitchen.access` | `kitchen_tickets`, `restaurant_order_items` | `/pos/kitchen` (KitchenPage); `GET /pos/kitchen/tickets`, `POST /pos/kitchen/tickets/:id/status` | — |
| BP-810 | `restaurant.orders` | `restaurant_order_items` | CancelItemDialog; `POST /pos/restaurant/orders/:id/items/:itemId/cancel` | — |
| BP-811 | `restaurant.orders` + `restaurant.void_item` | `restaurant_order_items`, `kitchen_tickets`, `stock_movements` (type `adjustment`, reason `restaurant_waste`, source `restaurant_item`), `stock_levels` | CancelItemDialog (waste checkbox); same endpoint as BP-810 | — |
| BP-812 | `restaurant.orders` | `restaurant_orders`, `restaurant_order_items` | OrderPage "Cancel order"; `POST /pos/restaurant/orders/:id/cancel` | — |
| BP-813 | `restaurant.orders` | `restaurant_orders` (unique index `restaurant_orders_open_table_key`) | MoveDialog; `POST /pos/restaurant/orders/:id/move` | — |
| BP-814 | `restaurant.orders` | `restaurant_orders` (status `merged`, `merged_into_id`), `restaurant_order_items`, `kitchen_tickets` | MoveDialog (merge mode); `POST /pos/restaurant/orders/:id/merge` | — |
| BP-815 | `restaurant.orders` (quote), `sales.create` (pay), `sales.discount`, `sales.discount.override_limit`, `customers.read` (customer) | `sales` (`restaurant_order_id`, `service_type`), `sale_lines`, `sale_line_modifiers`, `payments`, `orders` (idempotency), `shifts`, `stock_movements` (type `sale`), `restaurant_order_items.sale_id` | BillDialog + PaymentDialog + ReceiptDialog; `POST /pos/restaurant/orders/:id/quote`, `POST /pos/restaurant/orders/:id/pay` | Receipt number of the Sales domain (per branch) |
| BP-816 | `sales.read`, `reports.sales`, `reports.financial` | `sales`, `sale_line_modifiers`, `stock_movements` | POS ReceiptDialog; `/manager/sales?serviceType=`; `/manager/reports/sales` (`byServiceType`) | — |
| BP-817 | `restaurant.orders` (floor only) | `restaurant_orders`, `audit_log` (`target_type = restaurant`, actions `restaurant.*`) | `/pos/tables`; no manager screen | — |

---

## Chapter I: Platform operation and subscriptions (the SaaS operator's side)

### I.0 Scope and sources reviewed

**Business purpose.** The platform operator is the company that hosts the software and sells it to
merchants. This chapter treats the operator as the *secondary accounting entity* of the manual: the
merchant remains the primary subject, and here we describe what the operator's staff can do to a
merchant, what facts the platform records about each merchant, and where the operator's actions
could touch a merchant's books. The operator's staff (called *operators*) work in a separate console
(`/platform`) with their own identity realm. They onboard merchants, suspend, reactivate or close
them, define subscription plans with usage limits and feature switches, assign a plan and a
subscription status to each merchant, and read a cross-merchant audit trail. Plan limits are enforced
inside the merchant's own daily operations (creating a branch, register, product or employee). No
money flows between operator and merchant inside the system: prices on plans are display values,
nothing is invoiced, collected or accrued, and subscription statuses are typed in by hand.

**Files and screens reviewed (technical names allowed here).**
- API: `apps/api/src/modules/platform-admin/platform.service.ts`, `platform.controller.ts`,
  `platform.schema.ts`, `operators.ts`, `platform.int.test.ts`;
  `apps/api/src/modules/subscriptions/subscriptions.service.ts`, `subscriptions.controller.ts`,
  `subscriptions.schema.ts`; `apps/api/src/modules/auth/platform-auth.service.ts`,
  `db-session.resolver.ts`, `login.service.ts` (suspended-company answer),
  `password-reset.service.ts` (account set-up e-mail); `apps/api/src/database/cli/create-operator.ts`,
  `bootstrap-operator.ts`; `apps/api/src/database/database.service.ts` (operator context);
  `apps/api/src/modules/merchants/provision.ts`; `apps/api/src/modules/iam/invitation-acceptance.service.ts`;
  `apps/api/src/modules/ecommerce/online-payments.service.ts` (webhooks and reconcile job for a
  suspended merchant); call sites of the capacity/feature checks in branches, registers, catalog,
  employees, restaurant and e-commerce services.
- Migrations: `apps/api/drizzle/0027_platform_subscriptions.sql`, `0028_platform_rls.sql`,
  `0030_audit_hardening.sql` (platform parts), plus the revoke statements of `0003_identity_rls.sql`.
- Contracts: `packages/contracts/src/platform.ts`; permission catalogue and role templates in
  `packages/permissions/src`.
- Screens: `apps/platform-web/src` (Overview, Merchants, Merchant detail with status and subscription
  dialogs, New merchant dialog, Plans, Audit log, layout and texts) and
  `apps/manager-web/src/features/subscription/SubscriptionPage.tsx`.
- Documents (claims, verified against code): `docs/BUSINESS_RULES.md` BR-150…BR-158, OQ-011, OQ-022;
  `docs/DECISIONS.md` ADR-0007, ADR-0080, ADR-0081, ADR-0082, ADR-0084, ADR-0086; `docs/AUTH.md` §3.5, §8;
  `docs/PROGRESS.md` (Prompt 17/18 entries); `docs/OPERATIONS.md` (operator bootstrap, incidents);
  `docs/DATABASE.md` (migration catalogue); `docs/TESTING.md`.

**Coverage statement.** I did not run the application or the tests; statements marked [Verified]
rest on reading the code and the integration test assertions. I did not review the Playwright
end-to-end test for the platform (`e2e/platform.spec.ts`) line by line, nor the platform-web unit
tests. Session lifetimes for operators (15 minutes idle, 8 hours absolute) are taken from `docs/AUTH.md`
and are marked [Inferred] because the session-policy code was not read. The internal mechanics of
completing an online sale after a confirmed payment belong to the online-store domain; here I only
confirmed that the path exists and does not consult the merchant's status.

### I.1 Roles and authority matrix

Operators hold exactly one of three roles. There is no per-branch or per-merchant scoping on the
operator side: a role applies to every merchant on the platform. Merchant users (owner, employees)
can never call platform functions, and an operator session can never call merchant functions
[Verified: integration test "keeps merchant users out of /platform"].

| Operation | Plain-words authority | Super administrator | Support | Billing | Merchant Owner | Company Manager | Branch Manager / Supervisor / Cashier / Kitchen |
|---|---|---|---|---|---|---|---|
| Create an operator account, re-key an operator | Command-line tool run with the database owner role (no screen, no API) | Whoever holds server/database access | — | — | — | — | — |
| Sign in to the console (password + authenticator code) | Any active operator | Yes | Yes | Yes | No | No | No |
| Read the platform overview, merchant list, merchant detail, plan list, plan readiness check | Any operator role | Yes | Yes | Yes | No | No | No |
| Create a merchant and its owner account | Support roles | Yes | Yes | No | No | No | No |
| Suspend / reactivate a merchant | Support roles | Yes | Yes | No | No | No | No |
| Close a merchant permanently | Super administrator only (checked in the service; the console hides the button for others) | Yes | No | No | No | No | No |
| Create or edit subscription plans (limits, features, price, default, archive) | Billing roles | Yes | No | Yes | No | No | No |
| Change a merchant's plan, subscription status, trial end, end date | Billing roles | Yes | No | Yes | No | No | No |
| Read the platform audit log | Support roles | Yes | Yes | No | No | No | No |
| View own company's subscription, usage and public plans (`/manager` page) | Merchant permission "read company settings", merchant-wide (no branch scoping) | — | — | — | Yes (owner holds every permission) | Yes (template) | No (not in templates; could be granted to a custom role) |
| Change own plan or status from the merchant side | Not possible: no endpoint; database refuses without an operator context | — | — | — | No | No | No |
| Be subject to plan limits when creating branches, registers, products, invitations, or enabling restaurant / publishing the store | Whoever holds the merchant permission for that operation (branches.manage, registers.manage, catalog.manage, employees.manage, restaurant.manage, online.manage) | — | — | — | Yes | Yes | Per their permissions |

Notes on the matrix [Verified unless stated]:
- The controller lets Support call the status endpoint with "closed", but the service refuses it with
  "Only a super administrator can close a merchant" (test asserts 403).
- Billing cannot read the audit log, although Billing's own actions are written to it.
- The console derives the operator's role from the first "permission" of the session for display only;
  the API enforces every action [Verified: `shared.tsx` comment and controller decorators].
- Employee accounts are created only through invitations (there is no direct "create employee"
  endpoint), so the employee limit is guarded at invitation and at reactivation [Verified: controller
  routes of the IAM module].

### I.2 Procedures

#### BP-901 Creating and re-keying an operator account (command line)
- **Business purpose:** Give a member of the operator's staff access to the console with a defined role,
  or revoke/reset that access.
- **Actors and required authority:** A person with shell access to the API host and the database
  *owner* role (the API's runtime role is forbidden from inserting, updating or deleting operators,
  except the two sign-in progress columns) [Verified: migration 0030]. On a hosted service without a
  shell, the very first super administrator can be created at start-up from an environment variable,
  once, while no operator exists [Verified: `bootstrap-operator.ts`; OPERATIONS.md].
- **Trigger / inputs:** e-mail (lower-cased), full name, role (super administrator, support, billing;
  default support).
- **Normal flow:**
  1. The tool generates a random one-time password and a new authenticator (TOTP) secret, encrypts the
     secret with the platform's MFA key and stores the operator as *active*.
  2. It prints the e-mail, the one-time password, the TOTP secret and the authenticator URI once; the
     instruction is to share them through a secure channel. Nothing is e-mailed.
  3. If an operator with that e-mail already exists, the same command *re-keys* them: new password,
     new TOTP secret, and every open console session of that operator is ended with reason
     "operator re-keyed" [Verified: `operators.ts`].
  4. In development, a seed creates a demo super administrator with a known password and TOTP secret
     [Verified: seed 100]. Production refuses development secrets (ADR-0086) [Inferred from ADR].
- **Exceptional cases and their handling:**
  - Unknown role or missing arguments: the tool exits with usage help.
  - Role values are constrained by a database check (three values only).
  - The bootstrap does nothing once any operator exists; it cannot add or re-key operators later.
  - There is no command to *disable* an operator or change their role without re-keying; the status
    column admits "disabled" but only direct SQL as database owner can set it [Verified: no CLI option;
    OPERATIONS.md incident table proposes re-keying as the response].
  - Loss of the MFA encryption key makes every operator's second factor undecryptable; OPERATIONS.md
    says to back it up [Verified: documentation; `platform-auth.service.ts` decrypts on every sign-in].
- **Existing controls:**
  - CTL-901 Operators are not creatable through the API; the runtime database role lacks the privilege.
  - CTL-902 Re-keying ends all sessions of the operator.
  - CTL-903 Role and status values are constrained by database checks; e-mail unique and lower-case.
  - CTL-904 TOTP secret stored encrypted (AES-256-GCM per schema comment).
- **Financial / stock / cash effect:** None. Creates/updates one operator record; no audit entry is
  written for the creation itself [Verified: `upsertOperator` writes no audit row].
- **Upstream dependencies:** Database owner credentials; MFA encryption key configured.
- **Downstream effects:** Enables BP-902 and every other platform procedure.
- **Observations:** FND-907, FND-915.

#### BP-902 Operator sign-in with a second factor, session and sign-out
- **Business purpose:** Authenticate operator staff strongly before they can see or change merchant data.
- **Actors and required authority:** Any active operator.
- **Trigger / inputs:** e-mail and password; then a 6-digit authenticator code.
- **Normal flow:**
  1. Password step: the system rate-limits attempts per IP (10 per 15 minutes) and failures per e-mail
     (5 per 15 minutes) [Verified: code; limits per AUTH.md]. A wrong password, an unknown e-mail or a
     *disabled* operator all receive the same "invalid credentials" answer and an audit entry
     "platform login failed" with the e-mail as detail [Verified].
  2. On success the system issues a short-lived sign-in ticket; no session exists yet.
  3. Code step: rate-limited per IP; wrong codes are counted per operator (5 per 15 minutes, independent
     of IP). The accepted time step is claimed atomically so the same code cannot be reused, even
     concurrently; a reused code is treated as wrong and audited "platform MFA failed" [Verified].
  4. A platform session is created; audit "platform login succeeded" with the session as target and the
     IP. The console opens on the overview.
  5. Every later request re-checks that the operator is still active and still holds a valid role; a
     session whose operator was disabled is revoked on sight [Verified: `db-session.resolver.ts`].
  6. Sessions are short (15 minutes idle, 8 hours absolute) [Inferred: AUTH.md §3; policy code not read].
- **Exceptional cases and their handling:**
  - Ticket expired or invalid: "invalid sign-in step".
  - Operator disabled between step 1 and step 2: refused as an invalid step.
  - A merchant's cookie presented to a platform endpoint, or vice versa: 401 [Verified: test].
- **Existing controls:**
  - CTL-905 Mandatory second factor for every operator; no bypass path exists.
  - CTL-906 Rate limits per IP, per e-mail and per operator; audit of failed and successful sign-ins.
  - CTL-907 Replay protection on authenticator codes (monotonic last-step claim).
  - CTL-908 Separate identity realm: cookies, guards and tables are distinct from merchant users.
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-901.
- **Downstream effects:** All platform procedures; the platform audit log (BP-916) shows sign-ins.
- **Observations:** FND-905 (reads after sign-in are not individually audited).

#### BP-903 Platform overview (cross-merchant summary)
- **Business purpose:** Give the operator a management view of the customer base without opening any
  merchant's books.
- **Actors and required authority:** Any operator role.
- **Trigger / inputs:** Opening the console; the screen refreshes itself every 60 seconds.
- **Normal flow:** The screen shows [Verified: `platform_overview()` and `OverviewPage`]:
  1. Merchants: total, active, suspended, closed, new in the last 30 days.
  2. Subscriptions: trials ending within 7 days; "lapsed" subscriptions (stored status past due, expired
     or cancelled, or a trial whose end has passed, or any end date in the past); merchants per plan.
  3. Usage: active branches across the platform; active user memberships (this count *includes* owners);
     number of sales in the last 24 hours; number of online orders in the last 24 hours.
  4. The five newest merchants with status.
- **Exceptional cases and their handling:**
  - The summary functions refuse to run unless the transaction carries an operator identity, even for
    the runtime database role [Verified: migration 0030 `platform_assert_operator()`].
  - No amounts are shown: counts only (no revenue, no cash).
- **Existing controls:**
  - CTL-909 Cross-merchant reads go only through fixed summary functions that return counts and
    identities, never business documents (ADR-0080).
  - CTL-910 Summary functions require an operator context (defence in depth).
- **Financial / stock / cash effect:** None (read only).
- **Upstream dependencies:** BP-902.
- **Downstream effects:** Management information for the operator; none for merchants.
- **Observations:** FND-905, FND-910.

#### BP-904 Merchant list and search
- **Business purpose:** Find a merchant and see its commercial standing at a glance.
- **Actors and required authority:** Any operator role.
- **Trigger / inputs:** Free text (name in either language, legal name, contact e-mail, owner e-mail,
  or the merchant's identifier; up to 100 characters), status filter, page (25 rows, API maximum 100).
- **Normal flow:** For each merchant the list shows name, owner e-mail, plan and *effective*
  subscription status, number of active branches, number of active non-owner employees, time of the
  last sale, and merchant status [Verified]. Rows open the merchant detail.
- **Exceptional cases and their handling:**
  - Search text is matched literally as a substring, case-insensitively; wildcard characters are not
    interpreted [Verified: test "wildcards are text"].
  - The list is ordered newest first; no export.
- **Existing controls:** CTL-909, CTL-910.
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-902.
- **Downstream effects:** Entry point for BP-905…BP-912.
- **Observations:** FND-905.

#### BP-905 Merchant detail (profile, onboarding, usage, history, platform actions)
- **Business purpose:** Review one merchant before acting on it, and see the history of what the
  platform has done to it.
- **Actors and required authority:** Any operator role to read; action buttons depend on role (BP-906…912).
- **Trigger / inputs:** Merchant identifier.
- **Normal flow:** The detail runs inside that merchant's data context with the operator identity set
  [Verified: `withPlatformContext`]. It shows:
  1. Company profile: names, legal name, contact e-mail/phone, language, creation date, status.
  2. Owner: name, e-mail, last sign-in (the later of the user's last login and the newest session).
  3. Onboarding: owner has signed in; products exist; first sale date; last sale date; number of
     sales in the last 30 days; online store status (none/draft/published/paused).
  4. Subscription: plan, effective status, start, trial end, end date, usage versus limits for branches,
     employees (including pending invitations), active products, registers; features included.
  5. Branches with status and number of staff assigned (merchant-wide assignments count in every branch).
  6. Subscription history: the last 50 events (created/changed, from→to plan and status, operator, reason).
  7. Platform actions on this merchant: the last 20 platform audit entries.
- **Exceptional cases and their handling:**
  - Unknown merchant: "not found" (404) [Verified: test].
  - A closed merchant shows no action buttons at all [Verified: `MerchantDetailPage`].
  - What is deliberately *not* shown: sales amounts, customers, cash balances, stock, payment
    attempts, employees' names [Verified: queries return counts and dates only; BR-157].
- **Existing controls:**
  - CTL-911 Per-merchant reads run under that merchant's row-level security with the operator id set,
    so the operator cannot read across merchants in one query.
  - CTL-912 Operator actions are recorded with the merchant as event owner, so the merchant's own audit
    trail (manager audit page) shows platform actions against it [Verified: test on `audit_log`].
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-904.
- **Downstream effects:** BP-906…BP-912.
- **Observations:** FND-905.

#### BP-906 Creating a merchant on behalf of its owner (operator onboarding)
- **Business purpose:** Open a new customer account when the owner does not self-register (sales-led
  onboarding), on a chosen plan, and hand the owner a secure way to set a password.
- **Actors and required authority:** Support or Super administrator (Billing refused, 403 [Verified]).
- **Trigger / inputs:** Company name (Arabic or English, at least one), optional legal name and phone,
  default language, optional plan (otherwise the default plan), owner full name and e-mail.
- **Normal flow:**
  1. The system looks up the e-mail. If it belongs to an *active* existing user, that person becomes the
     owner of the new company without any change to their password; the full name typed by the
     operator is ignored and no e-mail is sent to them [Verified: `send` is set only for new users].
  2. Otherwise a new user is created with a random, unusable password.
  3. In one transaction the system provisions the company: merchant record (status active), main branch
     "MAIN", owner membership, default payment set-up and default register, the five role templates
     [Verified: `provision.ts`]; then the subscription (BP-917) with reason "Created by the platform";
     then, for a new user, a single-use account set-up token valid for 72 hours [Verified].
  4. Audit "platform merchant created" with branch id, owner e-mail, whether the owner already had an
     account, and the plan [Verified].
  5. After the transaction commits, the welcome e-mail with the set-up link is sent.
  6. The owner opens the link, sets a password, signs in to `/manager`; their subscription page shows
     the chosen plan [Verified: test]. An existing owner signing in is asked to pick a company
     ("select merchant") [Verified: test].
- **Exceptional cases and their handling:**
  - Existing user is disabled: refused "owner account is disabled" (409).
  - Same e-mail registered concurrently: refused "e-mail was just registered" (409) [Verified].
  - Plan given but archived or unknown: refused as a validation error (an active plan is required)
    [Verified: `createInitial`].
  - Before the set-up link is used, sign-in fails with invalid credentials (401) [Verified: test].
  - If the e-mail cannot be delivered, the merchant and the owner exist but the owner has no usable
    password; the console offers no "resend set-up e-mail"; the owner must use "forgot password"
    [Inferred: no resend endpoint found in the platform controller].
- **Existing controls:**
  - CTL-913 Whole provisioning is one database transaction (no half-created merchant).
  - CTL-914 Owner credential is never known to the operator (random hash + e-mailed single-use link).
  - CTL-915 Audit entry with operator, role, IP and whether an existing account was attached.
- **Financial / stock / cash effect:** Creates an empty set of books for the new merchant: default
  payment methods, a default register with zero balance and default financial accounts [Inferred from
  the names of the helper functions; their internals belong to the Payments domain]. No money or stock.
- **Upstream dependencies:** At least one active default plan (BP-910); SMTP configured for the e-mail.
- **Downstream effects:** The merchant's whole life cycle (every other domain). Plan limits of the chosen
  plan apply from the first action (BP-913).
- **Observations:** FND-908, FND-916.

#### BP-907 Suspending a merchant
- **Business purpose:** Stop a merchant's use of the system at once (non-payment, fraud check, legal
  order, owner request) while preserving every record.
- **Actors and required authority:** Support or Super administrator (Billing refused, 403 [Verified]).
- **Trigger / inputs:** Reason (3–500 characters, mandatory; the console disables the button under 3
  characters), the merchant's current version number (optimistic lock).
- **Normal flow:**
  1. The merchant row is locked; version compared; status must currently be *active*.
  2. Status becomes *suspended*; version increments.
  3. Every open session of every user of that merchant (manager and POS) is revoked with reason
     "merchant suspended"; the number of sessions ended is recorded [Verified: test expects 2].
  4. Audit "platform merchant suspended" with from/to status, reason, sessions ended, operator role, IP;
     the entry is also visible in the merchant's own audit trail.
  5. Effects observable by the merchant and public, from that moment [Verified: test]:
     - Any request on an existing session answers 401 (every request re-checks the merchant's status).
     - Sign-in of a user whose companies are *all* inactive answers "company suspended, contact the
       platform support" (403) after the password is proven; a user with another active company can
       still sign in there [Inferred for the multi-company case from `noAccessError` logic].
     - Pending invitations cannot be accepted ("company account is suspended") [Verified].
     - The public online store disappears (404), because the store lookup requires an active merchant
       [Verified: `store_merchant`].
  6. What does **not** stop [Verified: no status check on these paths]:
     - Gateway webhooks for payments already started: a confirmed payment still completes the online
       order (status paid, a sale is created, reserved stock is consumed); a late success after a
       cancelled/failed attempt flags the order "needs attention".
     - The background reconcile job (every 60 s) keeps querying the gateway for open attempts of
       suspended merchants, completing paid ones and expiring unpaid ones (releasing reserved stock).
     - Nothing is done to open POS shifts, drawer balances, held orders, open purchase orders, pending
       transfers or active reservations: they remain as they were.
- **Exceptional cases and their handling:**
  - Stale version: "changed by someone else, reload" (409) [Verified: test]. The merchant's own
    profile edits share the same version counter, so an owner saving settings at the same moment causes
    this benign conflict.
  - Already suspended: "already suspended" (409). Closed: "closed merchant cannot be changed" (409).
  - Database trigger: a status change without an operator context is refused; merchant code paths never
    carry one, so no merchant action and no bug in merchant code can lift or impose a suspension
    [Verified: test against the runtime role].
- **Existing controls:**
  - CTL-916 Mandatory reason, operator, role and IP recorded; visible to the merchant's owner in their audit.
  - CTL-917 Optimistic locking by version; row lock during the change.
  - CTL-918 Immediate effect through per-request status re-check and session revocation.
  - CTL-919 Database trigger: status changes only with an operator context.
- **Financial / stock / cash effect:** No balance changes by the suspension itself. Indirectly: online
  sales may still be *created* (sale, stock consumption, online payment recorded) while staff cannot
  fulfil, refund or even see them; cash counted in open shifts is frozen un-reconciled until
  reactivation.
- **Upstream dependencies:** BP-905.
- **Downstream effects:** Online store (hidden), Online payments (continue), Cash custody (open shifts
  frozen), Reports (gap in activity), BP-908 to reverse.
- **Observations:** FND-904, FND-912.

#### BP-908 Reactivating a suspended merchant
- **Business purpose:** Restore access once the cause of suspension is resolved.
- **Actors and required authority:** Support or Super administrator.
- **Trigger / inputs:** Reason (3–500 characters), version.
- **Normal flow:** Status back to *active* (only from suspended); audit "platform merchant reactivated"
  with reason. Sessions are not restored; users sign in again. Store reappears at once [Verified: test].
  No sessions are revoked on reactivation (the count recorded is 0).
- **Exceptional cases and their handling:** Already active (409); closed (409, final); stale version (409).
- **Existing controls:** CTL-916, CTL-917, CTL-919.
- **Financial / stock / cash effect:** None by itself. Open shifts resume as they were; online orders
  completed during the suspension await fulfilment.
- **Upstream dependencies:** BP-907.
- **Downstream effects:** Merchant operations resume; the merchant owner should reconcile what happened
  during the suspension (see Recommendation in FND-904).
- **Observations:** FND-904.

#### BP-909 Closing a merchant permanently
- **Business purpose:** Terminate the relationship with a merchant for good.
- **Actors and required authority:** Super administrator only (service check; Support receives 403
  [Verified: test]).
- **Trigger / inputs:** Reason, version. The console labels the button "Close permanently" and warns
  "Closing is final and cannot be undone. Data is kept for records."
- **Normal flow:**
  1. Same mechanics as suspension (sessions revoked with reason "merchant closed", audit "platform
     merchant closed") from either *active* or *suspended*.
  2. Afterwards no status change is accepted by the service (409) and the database trigger refuses
     reopening even for an operator context ("a closed merchant cannot be reopened") [Verified].
  3. Sign-in by the owner answers the same "company suspended" message as a suspension [Verified: test].
  4. All data remains in the database indefinitely; merchants cannot be deleted by the application role
     [Verified: migration 0003 revokes delete on merchants; no purge routine exists].
- **Exceptional cases and their handling:**
  - No pre-closing checks of any kind: open shifts, cash in drawers and treasuries, stock on hand,
    unpaid purchase orders, pending online orders, pending invitations and active reservations are not
    examined, closed or reported [Verified: `setStatus` performs no such queries].
  - Gateway webhooks and the reconcile job continue exactly as for a suspended merchant (BP-907 step 6).
  - There is no data export, hand-over report or anonymisation step [Verified: no such endpoint].
- **Existing controls:**
  - CTL-920 Reserved to the highest operator role; irreversible by design (trigger).
  - CTL-916, CTL-917, CTL-919 as above.
- **Financial / stock / cash effect:** None recorded. The merchant's last balances (drawers, treasuries,
  bank accounts, stock quantities and values) are frozen as they stand; there is no closing document
  that states them.
- **Upstream dependencies:** BP-905; normally BP-907 first (not required).
- **Downstream effects:** Platform statistics (closed count); the merchant's books become inaccessible
  to the merchant; retention question (OQ-022).
- **Observations:** FND-904, FND-906, FND-911, FND-912.

#### BP-910 Managing subscription plans
- **Business purpose:** Define the commercial offer: what a plan allows (limits), what it includes
  (features), its display price and period, its trial length, and which plan new merchants start on.
- **Actors and required authority:** Billing or Super administrator (Support refused, 403 [Verified]).
  Every operator can *view* plans.
- **Trigger / inputs:** Code (2–40 lower-case letters/digits/`_`/`-`, unique case-insensitively), names
  in both languages, optional descriptions, status (active/archived), default flag, public flag, four
  optional limits (empty = unlimited; 0–100,000; branches and registers cannot be 0), features
  (restaurant, online store), optional price (up to 9 digits and 3 decimals, KWD only) with a billing
  period (month/year; price and period must be set together or not at all), trial days (0–365),
  sort order, version.
- **Normal flow:**
  1. Create: a new plan row. If marked default, the previous default is unmarked in the same
     transaction (exactly one default is also enforced by a unique index) [Verified].
  2. Edit: version checked; same default handling; all fields overwritten in place (there is no plan
     versioning; price and limits history exist only in the audit log details).
  3. Audit "platform plan created/updated" with code, limits, features, price, status, default flag.
  4. The plan list shows the number of merchants currently on each plan.
- **Exceptional cases and their handling:**
  - Duplicate code (any case): "another plan uses this code" (409) [Verified: test].
  - Price without period or period without price: validation error (400) [Verified: test].
  - Removing the default flag from the default plan: "choose another default instead" (409)
    [Verified: test]; a default plan cannot be archived (database check "default must be active").
  - Archiving: allowed at any time; merchants already on the plan stay on it; it can no longer be
    assigned (BP-912) or chosen at onboarding (BP-906); it is hidden from merchants' comparison list.
  - Deleting a plan: impossible for the application role [Verified: revoke in migration 0028].
  - **Lowering a limit or removing a feature on a plan that merchants already use is not checked
    against their usage** [Verified: `savePlan` runs no usage query]. Merchants above the new limit keep
    their records (nothing is removed) but cannot create more; a restaurant module already enabled or a
    store already published stays so, because the feature is checked only when enabling/publishing.
  - Changing a plan's code after merchants subscribed is allowed; history rows reference the plan by
    identifier, so past events display the *new* code [Verified: joins on plan id].
- **Existing controls:**
  - CTL-921 Unique code, exactly one active default, numeric and range checks at API and database level.
  - CTL-922 Optimistic locking on plan edits; audit of every save with the full commercial terms.
  - CTL-923 Plans cannot be deleted; archiving is the only withdrawal.
- **Financial / stock / cash effect:** None. The price is a display value; nothing is billed (BR-155).
- **Upstream dependencies:** BP-902.
- **Downstream effects:** BP-906 (plan choice), BP-911/BP-912 (assignment), BP-913/BP-914 (enforcement),
  BP-915 (what merchants see), the seeded starting plans: `standard` (default, unlimited, all features,
  30-day trial), `basic` (1 branch, 3 employees, 200 products, 1 register, no features, no trial),
  `professional` (5 branches, 25 employees, unlimited products, 10 registers, both features, no trial);
  none priced [Verified: migration 0028].
- **Observations:** FND-902, FND-903.

#### BP-911 Plan change readiness check
- **Business purpose:** Tell the operator, before changing a plan, whether the merchant's current usage
  and enabled features fit the target plan, and whether the move is an upgrade or a downgrade.
- **Actors and required authority:** Any operator role (read); the console runs it automatically in
  the subscription dialog whenever the target plan changes.
- **Trigger / inputs:** Merchant, target plan.
- **Normal flow:** The system counts active branches, active non-owner employees plus pending
  unexpired invitations, active products and active registers, compares each with the target plan's
  limit, and checks whether the restaurant module is enabled or the online store is published/paused
  while the target plan lacks that feature. It answers: fits yes/no, direction (upgrade when every
  limit is equal or higher and features are only added; downgrade when the opposite; "change" when
  mixed; "same"), and the list of issues ("branches: 2 in use, plan allows 1") [Verified: test].
- **Exceptional cases and their handling:** Unknown plan or merchant: 404. The check is advisory; the
  binding check is repeated inside the change transaction (BP-912).
- **Existing controls:** CTL-924 Binding re-check inside the change transaction, under the subscription
  row lock (no reliance on the screen).
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-905, BP-910.
- **Downstream effects:** BP-912.
- **Observations:** none.

#### BP-912 Changing a merchant's subscription (plan, status, dates)
- **Business purpose:** Record the commercial state of the relationship: which plan the merchant is on,
  whether the subscription is in trial, active, past due, cancelled or expired, and until when.
- **Actors and required authority:** Billing or Super administrator (Support refused, 403 [Verified]).
- **Trigger / inputs:** Target plan, status (five values), trial end (mandatory when status is trial;
  the console sends it only in that case and clears it otherwise), optional end date, reason
  (3–500 characters), subscription version.
- **Normal flow:**
  1. The merchant's single subscription row is locked (exclusive); version compared.
  2. If the plan changes: the target must be active (archived refused), and the readiness check must
     pass; otherwise "the merchant uses more than this plan allows" with the list of issues (409)
     [Verified: test "PLAN_CHANGE_BLOCKED"].
  3. End date, if given, must be after the subscription's *start* date (not after today).
  4. The subscription row is updated in place: plan, status, end, trial end, version+1. The start date
     never changes [Verified: not in the update set].
  5. An append-only history event "changed" is written: from/to plan, from/to status, operator, reason.
  6. Audit "platform subscription changed" with the same facts plus the dates and IP.
  7. The merchant's subscription page reflects the change at its next load (BP-915).
- **Exceptional cases and their handling:**
  - Stale version: 409 [Verified: test].
  - Status "trial" without a trial end: validation error. A trial end *in the past* is accepted and the
    effective status immediately reads "trial ended" [Verified: no lower bound on the date].
  - Status "expired" or "cancelled" needs no end date; "active" with an end date in the past reads
    "expired" on screen while the stored status stays "active" [Verified: `effectiveStatus`].
  - **Nothing happens automatically** when a trial end or end date passes: no status change, no
    e-mail, no restriction. Only the displayed *effective* status and the "lapsed" counter change
    [Verified: no scheduler touches subscriptions; test "lapsed subscription does not block work"].
  - Database guards: an update to the subscription row or a "changed" event without an operator context
    is refused; deletion is impossible; events cannot be updated or deleted [Verified: test and migration].
  - A concurrent merchant action that is creating a branch/product etc. waits on the same row lock;
    the change then counts the just-created items (ADR-0084 lock order) [Verified: `assertCapacity`].
- **Existing controls:**
  - CTL-925 Readiness check enforced in the transaction; archived plans not assignable.
  - CTL-926 Append-only subscription history with operator and reason; audit entry with IP.
  - CTL-927 Operator-only trigger on subscription updates and "changed" events; no deletes.
  - CTL-928 Exactly one subscription per merchant (unique constraint).
- **Financial / stock / cash effect:** None in the merchant's books; nothing is charged or credited
  ("Changing a plan never charges the merchant" is displayed in the dialog). The platform records no
  receivable, no invoice and no payment.
- **Upstream dependencies:** BP-905, BP-910, BP-911.
- **Downstream effects:** BP-913/BP-914 (new limits apply to the next creation), BP-915, overview counters.
- **Observations:** FND-901, FND-909.

#### BP-913 Enforcement of plan limits inside merchant operations (capacity checks)
- **Business purpose:** Make the commercial limits real: a merchant cannot grow beyond its plan.
- **Actors and required authority:** The merchant user performing the guarded operation (branch,
  register, invitation, employee reactivation, product). Owners are not exempt.
- **Trigger / inputs:** Any of the guarded creations or reactivations [Verified: call sites]:
  - Create a branch (checks branches *and* registers, because the branch gets a default register);
    reactivate an inactive branch (branches).
  - Create a register; reactivate a register (registers).
  - Send an invitation (employees: active non-owner members + pending, unexpired invitations);
    reactivate a deactivated employee (employees). Resending an invitation does not re-check (it already
    counts).
  - Create a product; restore an archived product (active products).
- **Normal flow:**
  1. Inside the same database transaction as the creation, the merchant's subscription and plan are
     read. If the relevant limit is unlimited, a *shared* lock is taken (creations proceed in parallel; a
     concurrent plan change waits for them). If limited, an *exclusive* lock on the subscription row
     serialises all guarded creations of that merchant.
  2. Current usage is counted; if used + 1 would exceed the limit the operation is refused with
     "Your plan allows N …; M in use. Ask the platform to change your plan." (409) and the path of the
     limit (e.g. employees 3/3) [Verified].
  3. Otherwise the creation proceeds and commits.
- **Exceptional cases and their handling:**
  - Concurrency: six simultaneous product creations on a plan allowing 3 produce exactly 3 successes and
    3 refusals [Verified: test; TESTING.md notes the test fails without the lock].
  - Freeing capacity: archiving a product, deactivating a branch/register/employee, or an invitation
    expiring or being revoked, frees a slot [Verified: test "archiving frees a slot; restoring needs one"].
  - Existing records are never deleted or disabled by a limit; a merchant moved (by an operator) to a
    plan with lower limits is prevented by BP-912, but a plan *edited* to lower limits leaves the
    merchant above the limit (see FND-903) — then every further creation is refused until usage falls.
  - A merchant without a subscription row (should not occur) gets the default plan created "on first
    use" [Verified: `current()`].
- **Existing controls:**
  - CTL-929 Checks run in the creating transaction under a row lock (no over-allocation under load).
  - CTL-930 Backend-only enforcement; the merchant UI merely displays usage.
- **Financial / stock / cash effect:** None directly; refusals prevent new branches/registers (new cash
  places) and new products (new stock items) beyond the plan.
- **Upstream dependencies:** BP-917 or BP-912 (a subscription and plan).
- **Downstream effects:** Branches & employees domain, Catalogue, Registers (other chapters).
- **Observations:** FND-903.

#### BP-914 Enforcement of plan features (restaurant module, online store)
- **Business purpose:** Reserve optional modules to plans that include them.
- **Actors and required authority:** Merchant user with restaurant management (merchant-wide) or
  online store management permission.
- **Trigger / inputs:** Switching the restaurant module from off to on; saving the online store with a
  status other than draft (published or paused).
- **Normal flow:** The plan's feature list is read in the merchant transaction (no lock); if the feature
  is absent the save is refused: "Your plan does not include restaurant/ecommerce. Ask the platform to
  change your plan." (409) [Verified: test].
- **Exceptional cases and their handling:**
  - The check is one-directional: an already enabled module or published store is not disabled when the
    plan loses the feature through a plan *edit* (BP-910); through a plan *change* (BP-912) the move is
    blocked while the feature is in use.
  - A draft store can be configured on any plan; only leaving draft needs the feature.
- **Existing controls:** CTL-931 Backend check at the moment of enabling/publishing; plan-change check
  refuses removing a feature in use.
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-917/BP-912.
- **Downstream effects:** Restaurant and Online store domains.
- **Observations:** FND-903.

#### BP-915 The merchant's own subscription page
- **Business purpose:** Let the merchant's management see their plan, standing and headroom, and
  compare public plans.
- **Actors and required authority:** Merchant users with "read company settings" (owner; Company
  Manager template). Merchant identity comes from the session only; no merchant identifier is accepted
  from the client [Verified: controller comment and test "nothing about others"].
- **Trigger / inputs:** Opening the Subscription page in `/manager`.
- **Normal flow:** Shows plan name and description, effective status badge, a warning banner when the
  status is past due, expired, trial ended or cancelled ("lapsed"), start date, trial end, end date,
  usage bars per limit (bar turns to warning colour at 100 %), feature badges ("not included" where
  absent), and the list of *public, active* plans with price per month/year or "price on request" and
  their limits/features, marking "your plan" [Verified: `SubscriptionPage.tsx`].
- **Exceptional cases and their handling:**
  - No action is possible from this page: no upgrade request, no payment, no contact form. The hint text
    tells the merchant plans are changed by the platform [Verified: page comment and texts].
  - Hidden (non-public) plans assigned by an operator still display as the current plan.
- **Existing controls:** CTL-932 Read-only; row-level security hides other merchants' subscriptions
  [Verified: test on the runtime role].
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-917.
- **Downstream effects:** None (information only).
- **Observations:** FND-901 (no way to pay or request an upgrade).

#### BP-916 Platform audit trail
- **Business purpose:** Provide an independent record of what operator staff did, to whom and why.
- **Actors and required authority:** Support or Super administrator to read; every operator's actions
  are written regardless of role.
- **Trigger / inputs:** Optional merchant filter, action text filter (substring), paging (50 per page
  by API; the console loads the latest 100 without paging).
- **Normal flow:** Entries are those whose actor is an operator or whose action name starts with
  "platform." — therefore: failed and successful operator sign-ins and failed MFA codes, merchant
  created, suspended, reactivated, closed, subscription changed, plan created/updated. Each entry shows
  time, operator name (or "anonymous" for failed sign-ins), action, merchant, reason and IP; the full
  detail object (from/to values, limits, sessions ended) is stored [Verified: `platform_audit()`].
- **Exceptional cases and their handling:**
  - Audit rows cannot be updated or deleted by the application role [Verified: migration 0003].
  - Reads (overview, lists, merchant detail) do not produce entries [Verified: no `record` call on reads].
  - Entries without a merchant (plan changes, sign-ins) are shown with "—" as merchant.
  - Operator creation/re-keying by CLI is not in the audit log (BP-901).
- **Existing controls:**
  - CTL-933 Immutable audit log; operator, role, IP, reason and before/after values stored.
  - CTL-934 Platform entries about a merchant are also visible to that merchant's owner.
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** All write procedures above.
- **Downstream effects:** External audit evidence of operator interventions in merchants' books.
- **Observations:** FND-905, FND-906.

#### BP-917 Initial subscription at registration or first use (automatic)
- **Business purpose:** Guarantee every merchant has exactly one subscription from birth.
- **Actors and required authority:** System, triggered by self-service registration (owner), operator
  onboarding (BP-906) or, as a safety net, the first subscription read of a merchant lacking one.
- **Trigger / inputs:** New merchant; plan chosen by an operator or the default plan.
- **Normal flow:** If the plan has trial days > 0, status *trial* with trial end = now + trial days;
  otherwise *active*; start = now; one history event "created" with reason ("Self-service
  registration", "Created by the platform", "Created on first use", "Existing merchant" for the
  backfill) [Verified]. The seeded default plan `standard` carries a 30-day trial, so self-registered
  merchants start as "Trial" with unlimited limits and all features.
- **Exceptional cases and their handling:**
  - No default plan configured: registration fails with an internal error (should not occur; default
    uniqueness and presence are seeded).
  - A second creation for the same merchant is ignored silently (unique constraint, "do nothing").
  - The "created" event is the only subscription event a merchant code path may write (trigger allows
    it without an operator context).
- **Existing controls:** CTL-928; CTL-935 Trial end computed by the database clock.
- **Financial / stock / cash effect:** None.
- **Upstream dependencies:** BP-910 (an active default plan).
- **Downstream effects:** BP-913…BP-915.
- **Observations:** FND-902.

#### BP-918 Billing, invoicing and collection of subscription fees (not implemented)
- **Business purpose:** In a SaaS business the operator invoices each merchant per period, collects
  payment, tracks receivables, applies taxes, and reacts to non-payment (dunning, grace, suspension).
- **Actors and required authority:** Would be the Billing role.
- **Trigger / inputs:** None exist.
- **Normal flow:** None. What exists: a display price and period per plan (KWD, 3 decimals), a
  free-text subscription status including "past due", an optional end date, and the operator's ability
  to suspend (BP-907). The merchant has no place to pay, no invoice, no statement; the operator has no
  receivable ledger, no revenue figure, no tax handling, no collection job [Verified: no tables, services
  or screens beyond those listed; ADR-0082, OQ-022].
- **Exceptional cases and their handling:** Not applicable.
- **Existing controls:** None specific. The dialog states that changing a plan never charges the merchant.
- **Financial / stock / cash effect:** None recorded anywhere. The operator's revenue, receivables and
  VAT obligations, if any, must be kept in an external system by hand from the information visible in
  BP-904/BP-905 (plan, status, dates).
- **Upstream dependencies:** Owner decisions on pricing, provider, VAT, grace rules (OQ-022).
- **Downstream effects:** None in the system.
- **Observations:** FND-901, FND-909.

### I.3 Interdependencies with other domains

The operator never writes a merchant's financial or stock records directly: every change it makes is to
the merchant's *status* or *subscription*, and the consequences propagate through access control and
plan enforcement. Two platform decisions nevertheless have book-keeping consequences inside merchants:
suspension/closing during live activity (frozen shifts, online payments that still complete) and plan
edits that silently leave merchants above their limits.

| This domain → other domain | What flows | Direction / nature |
|---|---|---|
| Platform → Authentication & sessions | Suspension/closing revokes every merchant session and blocks sign-in and invitation acceptance; operator sign-in is its own realm | Authority |
| Platform → Branches, Registers, Employees, Catalogue | Plan limits refuse creation/reactivation beyond the plan; usage counts come from those modules' tables | Authority (limits); data (counts) |
| Platform → Restaurant, Online store | Feature switches: module enable and store publish require the plan feature; suspended/closed merchants' public store is hidden | Authority |
| Online payments → Platform (independence) | Webhooks and the reconcile job keep completing/expiring online orders of suspended or closed merchants: sales created, stock reservations consumed or released, without staff access | Money and stock continue to move |
| Platform → Cash custody | No interaction: open shifts, drawer and treasury balances are untouched by suspension or closing; no closing count is demanded | Gap (see FND-904) |
| Platform → Inventory | No interaction: stock on hand and value are untouched; closing records no final stock position | Gap (see FND-904) |
| Platform → Audit (merchant side) | Platform actions on a merchant appear in the merchant's own audit trail with the operator as actor | Data (traceability) |
| Platform → Reports | None: no platform revenue report; merchant reports show the activity gap of a suspension only indirectly | Gap |
| Merchants → Platform | Self-registration creates the default subscription; merchant usage feeds the operator's overview, list and detail (counts, last sale date, store status) | Data (summaries only) |
| Operator billing (external) → Platform | Payment of subscription fees happens outside the system; an operator transcribes the result as a status ("active", "past due") | Manual, undocumented |

### I.4 Findings

#### FND-901 No billing, invoicing, receivables or collection process for subscriptions
- **Classification:** Owner decision to revisit (ADR-0082 / BR-155 / OQ-022) — presented as a decision
  with its risks, and as a missing process from the accounting standpoint.
- **Severity:** High (for the operator as an accounting entity; no effect on merchants' books).
- **Evidence:** [Verified] Plans carry a display price and period only; subscription status and dates
  are typed by operators; no invoice, payment, receivable, tax or revenue record exists; the merchant
  page offers no way to pay or request a change; the dialog states that changes never charge the
  merchant. [Verified] The "Billing" role name exists but its powers are plan and subscription editing
  only.
- **Potential financial impact:** The operator has no system record of revenue earned, amounts due or
  collected, so its own accounts, VAT position (if applicable in the jurisdiction, OQ-011) and
  collection follow-up depend on spreadsheets; "past due" can be set or forgotten by hand; a dispute
  with a merchant has no evidential invoice.
- **Affected procedures:** BP-910, BP-912, BP-915, BP-918.
- **Recommendation:** Decide pricing and provider (OQ-022). Until then, keep an external
  subscription ledger reconciled monthly to the platform's merchant list (plan, status, dates), and
  require the reason field of every status change to cite the external invoice/receipt reference.
  When billing is built: immutable invoices per period, a receivable per merchant, payment records,
  automatic "past due" after a defined grace period, and a dunning policy approved by the owner.

#### FND-902 Default plan is unlimited with a trial that has no consequence when it ends
- **Classification:** Financial risk
- **Severity:** Medium
- **Evidence:** [Verified] The seeded default plan `standard` has no limits, both features and a
  30-day trial; when the trial end passes the effective status becomes "trial ended" but nothing
  changes for the merchant (no restriction, no notification, no task for operators beyond a counter on
  the overview). Self-registered merchants therefore enjoy the full product indefinitely unless an
  operator acts manually.
- **Potential financial impact:** Revenue leakage; unlimited consumption of hosting resources by
  non-paying merchants; "trials ending in 7 days" is the only prompt and it disappears once the date
  passes (the merchant then only counts as "lapsed").
- **Affected procedures:** BP-910, BP-912, BP-917.
- **Recommendation:** Owner to decide the post-trial behaviour (read-only, limited plan, suspension
  after a grace period). Meanwhile make a limited plan the default and keep `standard` assignable by
  operators; add an operator work list of trials that ended without a status change.

#### FND-903 Plan edits are not checked against merchants already on the plan
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** [Verified] Editing a plan overwrites its limits, features, price and code in place with
  no query of subscribed merchants' usage. A merchant can end up above its limits (further creations
  refused without any plan change having been agreed), or keep using a feature the plan no longer
  includes (restaurant stays enabled, store stays published) because features are checked only when
  enabling/publishing. Price and limit history survive only in audit log details; past subscription
  events display the plan's *current* code and name.
- **Potential financial impact:** Commercial terms applied to a merchant can change without a
  per-merchant record, reason or consent; disputes about "what was agreed" cannot be settled from the
  subscription history alone; merchants may be blocked unexpectedly.
- **Affected procedures:** BP-910, BP-913, BP-914.
- **Recommendation:** When editing a plan that has subscribers, run the readiness check for each of
  them and either refuse the edit, or require creating a new plan (and archiving the old) so that each
  merchant's terms stay versioned; store a snapshot of limits/price on each subscription event.

#### FND-904 Suspension and closing ignore open shifts, cash balances, stock and pending documents
- **Classification:** Control gap / Financial risk
- **Severity:** High (closing is irreversible); Medium for suspension.
- **Evidence:** [Verified] The status change revokes sessions and writes an audit entry only. No check or
  record of: open POS shifts and their drawer balances, branch/company treasury balances, stock on hand
  and value, open purchase orders or transfers, pending online orders and active reservations. Closing
  produces no final statement of balances. [Verified] The console warns only that "data is kept".
- **Potential financial impact:** A merchant closed with cash in drawers and stock in branches has no
  system record of those final positions for hand-over, liquidation or dispute; a suspension during an
  open shift freezes un-reconciled cash in the cashier's custody with no count, and when reactivated
  the shift continues as if nothing happened (cut-off and custody weakened).
- **Affected procedures:** BP-907, BP-908, BP-909.
- **Recommendation:** Before closing, require (or at least display and record in the audit details) a
  snapshot: number of open shifts, drawer/treasury/bank balances, stock value, pending online orders and
  purchase documents; refuse closing while shifts are open unless the super administrator confirms with
  an explicit override reason. On reactivation after a suspension, force a cash count on every shift
  that was open at suspension time (the system already has a "needs count" mechanism for registers).

#### FND-905 Operator reads of merchant data are not audited
- **Classification:** Control gap
- **Severity:** Low (data exposed is summaries only) — Medium if impersonation is ever added.
- **Evidence:** [Verified] Only writes and sign-ins create audit entries; opening a merchant's detail
  (owner e-mail, last sign-in, branch list, sales counts, store status, subscription history) leaves no
  trace. BR-158/AUTH.md §8 say "all actions audited"; reads are not treated as actions.
- **Potential financial impact:** Limited; an external auditor cannot show which staff looked at which
  merchant (privacy and confidentiality evidence).
- **Affected procedures:** BP-903, BP-904, BP-905, BP-916.
- **Recommendation:** Record at least merchant-detail views (operator, merchant, time) with light
  retention; state clearly in the documentation that list/overview reads are not logged.

#### FND-906 No dual control for irreversible or commercially significant operator actions
- **Classification:** Control gap
- **Severity:** Medium
- **Evidence:** [Verified] A single super administrator can create plans, assign any plan or status,
  suspend and permanently close any merchant with a free-text reason; no second approval, no cooling-off
  period, no notification to the merchant owner other than the entry in the merchant's audit trail (which
  the owner can read only after reactivation). The first super administrator is created by whoever
  controls the deployment (bootstrap variable).
- **Potential financial impact:** A single compromised or mistaken operator account can shut a trading
  business permanently and irreversibly, or grant unlimited free plans.
- **Affected procedures:** BP-901, BP-909, BP-910, BP-912.
- **Recommendation:** Require a second super administrator's confirmation (or a time-delayed execution
  that another operator can cancel) for closing and for assigning a plan with a price lower than the
  current one; send the owner an e-mail on suspension, reactivation, closing and subscription change.

#### FND-907 No operator offboarding or role change procedure
- **Classification:** Missing process
- **Severity:** Medium
- **Evidence:** [Verified] Operators can be created or re-keyed by CLI; there is no command or screen to
  disable one, change their role or list them. The "disabled" status requires direct SQL by the database
  owner. Re-keying (the documented incident response) rotates credentials but keeps the account alive and
  prints new credentials to the console. Operator creation and re-keying are not written to the audit log.
- **Potential financial impact:** Departed staff may keep access until someone with database access
  intervenes; no evidential record of when operator access was granted or removed.
- **Affected procedures:** BP-901, BP-902.
- **Recommendation:** Add CLI commands to list, disable and change the role of operators, each writing a
  platform audit entry; review the operator list monthly against HR records.

#### FND-908 An operator can attach any existing user as owner of a new company without consent or notice
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** [Verified] When the owner e-mail belongs to an existing active user, that person becomes
  owner of the new merchant with no e-mail sent and the full name typed by the operator silently
  ignored; the operator only sees "existing account" in the audit details.
- **Potential financial impact:** Negligible financially; a user may find a company attached to their
  identity (liability for a merchant they did not open) and the operator may believe a different person
  was onboarded because of the ignored name.
- **Affected procedures:** BP-906.
- **Recommendation:** Notify the existing user by e-mail, and warn the operator in the console when the
  e-mail already exists (show the registered name) before creating.

#### FND-909 Subscription dates and statuses are free-form and the period is not modelled
- **Classification:** Inconsistency (behaviour vs behaviour) / Missing process
- **Severity:** Low
- **Evidence:** [Verified] The start date is set once and never changes on plan change; the end date
  only has to be after the start; a trial end in the past is accepted; "cancelled"/"expired" need no
  end date; "active" with a past end date displays "expired" while stored "active"; the overview
  "lapsed" count and the merchant badge use slightly different rules (overview counts any past end date
  irrespective of status; the badge excludes cancelled from the end-date rule). The unused "notes" column
  on the subscription is never written.
- **Potential financial impact:** Statuses cannot be relied upon for revenue periods or churn
  measurement; reconciling with an external billing ledger requires manual interpretation.
- **Affected procedures:** BP-903, BP-912, BP-918.
- **Recommendation:** Define allowed status transitions and date rules (e.g. a new start on plan change,
  end date ≥ today unless status is expired/cancelled), and compute "lapsed" with one shared rule.

#### FND-910 Overview staff count differs from the employee definitions used elsewhere
- **Classification:** Inconsistency (behaviour vs behaviour)
- **Severity:** Low
- **Evidence:** [Verified] The overview's "active user memberships" counts owners; the merchant list and
  plan usage count non-owner employees (usage also adds pending invitations); the per-branch count in the
  detail counts distinct assignments (merchant-wide assignments appear in every branch).
- **Potential financial impact:** None; management information only.
- **Affected procedures:** BP-903, BP-904, BP-905.
- **Recommendation:** Label the overview figure "memberships incl. owners" or align it with the plan
  usage definition.

#### FND-911 Data retention, export and deletion after closing are undefined
- **Classification:** Owner decision to revisit (OQ-022, OQ-011) / Missing process
- **Severity:** Medium
- **Evidence:** [Verified] A closed merchant's data stays forever; the application role cannot delete
  merchants; there is no export for the merchant, no anonymisation and no retention schedule. The console
  states "Data is kept for records". Hosting region/data residency is open (OQ-011).
- **Potential financial impact:** Statutory record-keeping obligations of the merchant (accounting
  records retention) depend on the operator keeping the data accessible on request, with no agreed
  procedure or fee; conversely privacy obligations may require deletion of personal data after a period.
- **Affected procedures:** BP-909.
- **Recommendation:** Owner to decide a retention period and an export deliverable (sales, refunds,
  stock, cash ledgers in a readable format) handed to the owner at closing; record the hand-over in the
  audit log; define who may access a closed merchant's data and how (currently nobody through the UI).

#### FND-912 Online payments keep completing sales for merchants that cannot act on them
- **Classification:** Financial risk (residual risk of the owner decision BR-153)
- **Severity:** Medium
- **Evidence:** [Verified] Webhook handling and the 60-second reconcile job do not consult the merchant's
  status: for a suspended or closed merchant a confirmed payment marks the order paid, creates a sale and
  consumes reserved stock; unpaid orders expire and release stock. Staff have no access to fulfil,
  refund or contact the customer, and the public store is hidden so the customer cannot track the order.
  [Owner decision] BR-153 requires that started payments are recorded so "no money is lost".
- **Potential financial impact:** Customers are charged for goods that cannot be delivered while the
  suspension lasts; refunds need a staff session that does not exist; for a closed merchant the sale is
  final and the customer's claim has no process. Sales and stock consumption dated during the suspension
  distort cut-off for the merchant's reports.
- **Affected procedures:** BP-907, BP-909.
- **Recommendation:** On suspension, pause new checkouts (already the case via the hidden store) and
  show operators the count of pending online payments of that merchant; on closing, refuse while any
  payment attempt is open, or require that the super administrator records how the customers will be
  refunded. Consider letting a suspended merchant's owner sign in read-only to handle refunds.

#### FND-913 Documentation claims versus behaviour: minor discrepancies
- **Classification:** Inconsistency (doc vs behaviour)
- **Severity:** Low
- **Evidence:** [Verified] (a) BR-158 and AUTH.md §8 state that every platform action is audited; reads
  and CLI operator creation are not (FND-905, FND-907). (b) BR-153 lists what stops at suspension but not
  that gateway callbacks and the reconcile job continue to create sales and move stock (the console hint
  does say payments "are still recorded"). (c) PROGRESS.md says operator accounts are "managed with the
  CLI only"; in fact only creation and re-keying exist. Everything else claimed in BR-150…BR-157 and
  ADR-0080…0082 was found consistent with the code and tests.
- **Potential financial impact:** None directly; risk of false assurance to auditors.
- **Affected procedures:** BP-901, BP-907, BP-916.
- **Recommendation:** Amend BR-153 and BR-158 wording to match behaviour.

#### FND-914 Billing role cannot see the audit trail of its own actions
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** [Verified] Billing receives 403 on the audit log while its plan and subscription changes
  are recorded there; the merchant detail does show the last 20 platform entries for that merchant, which
  partially compensates.
- **Potential financial impact:** None; self-review and hand-over between billing staff are harder.
- **Affected procedures:** BP-916.
- **Recommendation:** Allow Billing a filtered view (plan and subscription actions) or document the
  restriction as intentional.

#### FND-915 Single encryption key for all operator second factors
- **Classification:** Control gap (operational)
- **Severity:** Low
- **Evidence:** [Verified] Every operator's TOTP secret is encrypted with one environment key; loss of
  the key locks all operators out (documented in OPERATIONS.md with a "back it up" warning); rotation
  requires re-keying every operator.
- **Potential financial impact:** Platform operations halt until keys are restored; no effect on
  merchants' books.
- **Affected procedures:** BP-901, BP-902.
- **Recommendation:** Keep the key in a managed secret store with a tested recovery; keep a break-glass
  procedure (bootstrap of a new super administrator is blocked once any operator exists, so recovery
  needs database access).

#### FND-916 Welcome e-mail is sent after commit without retry or visibility
- **Classification:** Control gap
- **Severity:** Low
- **Evidence:** [Verified] The set-up link (72 hours, single use) is e-mailed after the transaction
  commits; an e-mail failure does not roll back the merchant and is not shown in the console or audit
  log; no "resend" exists in the platform console. The owner can still use the public "forgot password"
  flow [Inferred].
- **Potential financial impact:** None; onboarding delay and support effort.
- **Affected procedures:** BP-906.
- **Recommendation:** Record e-mail dispatch success/failure in the audit details and add a "resend
  set-up e-mail" action for Support.

### I.5 Documented owner decisions touching this domain

| Id | Decision (one line) | Residual risk (one line) |
|---|---|---|
| BR-150 / ADR-0081 | One subscription per merchant; new merchants start on the default plan (trial if the plan has trial days); plans archived, never deleted | Default plan is unlimited with a 30-day trial that has no effect when it ends (FND-902) |
| BR-151 / ADR-0081 | Limits on active branches, employees (incl. pending invitations), active products, active registers; creation/reactivation beyond a limit refused; nothing removed | Plan edits can leave merchants above limits without a per-merchant record (FND-903) |
| BR-152 | Merchant status changed only by operators with a reason; support/super suspend and reactivate; only super closes; closing final | No dual control; no pre-closing checks of cash and stock (FND-904, FND-906) |
| BR-153 | Suspension immediate: sessions end, sign-in refused, invitations blocked, store hidden; data kept; started online payments still recorded | Sales and stock movements continue without staff; customers charged but unserved (FND-912) |
| BR-154 | Plan change allowed only when usage fits and no feature in use is removed | None material; the check is sound and locked |
| BR-155 / ADR-0082 | No automatic billing; prices informational; statuses set by operators; lapsed status never blocks work | Operator has no revenue/receivable record; indefinite free use possible (FND-901, FND-902) |
| BR-156 | Merchants see only their own subscription, usage and public plans | None; verified by RLS test |
| BR-157 / ADR-0080 | Operators see summaries only, never sales lines or customers; per-merchant access runs in that merchant's context with the operator id | Reads not logged (FND-905) |
| BR-158 / ADR-0086 | Operators created by CLI only; platform actions audited with operator, reason and IP; runtime role cannot create operators | No disable/role-change tooling; creation not audited (FND-907) |
| ADR-0007 | Operators are a separate identity realm with mandatory MFA | Single MFA key is a single point of failure (FND-915) |
| ADR-0084 | One lock order; subscription row lock shared for unlimited, exclusive for limited plans | None; concurrency test confirms no over-allocation |
| OQ-022 (open) | Pricing, billing provider, invoices/VAT, lapse behaviour, retention after closing — implemented as: no billing, lapse never blocks, closing keeps data | All of FND-901, FND-902, FND-911 remain until decided |
| OQ-011 (open) | Hosting provider, region and data residency | Retention and access to closed merchants' records undefined (FND-911) |
| AUTH.md §8 | No merchant impersonation initially; if added, consent/reason, time limit, read-only, visible to owner | Support cannot act inside a suspended merchant's books (refunds) — see FND-912 |

### I.6 Technical mapping (appendix)

| BP id | Permission keys / role gates | Main tables | Screens / routes | Document number prefix |
|---|---|---|---|---|
| BP-901 | database owner role; CLI `platform:create-operator`; env `PLATFORM_BOOTSTRAP_EMAIL` | `platform_operators`, `sessions` | none (CLI) | — |
| BP-902 | `@Public` `POST /auth/platform/login`, `POST /auth/platform/mfa`; `@RequirePlatformRole` on every platform route | `platform_operators`, `sessions`, `auth_tickets`, `rate_limit_buckets`, `audit_log` | `/platform/login` (`LoginPage.tsx`) | — |
| BP-903 | `platform.super_admin`, `platform.support`, `platform.billing` — `GET /platform/overview` | `platform_overview()`, `platform_plan_counts()`, `plans` | `/platform` (`OverviewPage.tsx`) | — |
| BP-904 | any platform role — `GET /platform/merchants` | `platform_merchants()` (merchants, memberships, users, branches, subscriptions, plans, sales) | `/platform/merchants` (`MerchantsPage.tsx`) | — |
| BP-905 | any platform role — `GET /platform/merchants/:id` | `merchants`, `memberships`, `users`, `sessions`, `products`, `sales`, `online_stores`, `branches`, `role_assignments`, `subscription_events`, `platform_audit()` | `/platform/merchants/:merchantId` (`MerchantDetailPage.tsx`) | — |
| BP-906 | `platform.super_admin`, `platform.support` — `POST /platform/merchants` | `users`, `merchants`, `branches`, `memberships`, `roles`, `role_permissions`, `registers`, `financial_accounts`, `payment_methods`, `subscriptions`, `subscription_events`, `password_reset_tokens`, `audit_log` (`platform.merchant.created`) | `NewMerchantDialog.tsx` | — |
| BP-907 | `platform.super_admin`, `platform.support` — `POST /platform/merchants/:id/status` (`suspended`) | `merchants` (trigger `merchants_status_guard`), `sessions` (`revoke_reason = merchant_suspended`), `audit_log` (`platform.merchant.suspended`) | `StatusDialog` in `MerchantDetailPage.tsx` | — |
| BP-908 | same roles — status `active` | `merchants`, `audit_log` (`platform.merchant.reactivated`) | `StatusDialog` | — |
| BP-909 | `platform.super_admin` only (service check) — status `closed` | `merchants` (trigger refuses reopening), `sessions` (`merchant_closed`), `audit_log` (`platform.merchant.closed`) | `StatusDialog` | — |
| BP-910 | `platform.super_admin`, `platform.billing` — `POST /platform/plans`, `PUT /platform/plans/:id`; any role `GET /platform/plans` | `plans` (unique `plans_code_key`, `plans_default_key`; no delete), `audit_log` (`platform.plan.created/updated`) | `/platform/plans` (`PlansPage.tsx`, `PlanDialog`) | — |
| BP-911 | any platform role — `GET /platform/merchants/:id/plan-check?planId=` | `subscriptions`, `plans`, `branches`, `memberships`, `invitations`, `products`, `registers`, `restaurant_settings`, `online_stores` | `SubscriptionDialog` readiness panel | — |
| BP-912 | `platform.super_admin`, `platform.billing` — `PUT /platform/merchants/:id/subscription` | `subscriptions` (trigger `subscriptions_operator_only`), `subscription_events` (trigger `subscription_events_operator_only`, no update/delete), `audit_log` (`platform.subscription.changed`) | `SubscriptionDialog` | — |
| BP-913 | merchant permissions of the guarded operation (`branches.manage`, `registers.manage`, `employees.manage`, `catalog.manage`) — error `PLAN_LIMIT_REACHED` | `subscriptions` (row lock), `plans`, usage tables above | manager branches/registers/employees/products screens | — |
| BP-914 | `restaurant.manage` (merchant-wide), `online.manage` — error `PLAN_FEATURE_UNAVAILABLE` | `plans.features`, `restaurant_settings`, `online_stores` | manager restaurant settings, online store settings | — |
| BP-915 | `merchant.settings.read` — `GET /manager/subscription` | `subscriptions`, `plans` (RLS `merchant_isolation`) | `/manager/subscription` (`SubscriptionPage.tsx`) | — |
| BP-916 | `platform.super_admin`, `platform.support` — `GET /platform/audit` | `audit_log` via `platform_audit()` (no update/delete) | `/platform/audit` (`AuditPage.tsx`) | — |
| BP-917 | system (registration `@Public`, onboarding, lazy creation) | `subscriptions` (`subscriptions_merchant_key`), `subscription_events` (`kind = created`) | — | — |
| BP-918 | — (not implemented) | — (`plans.price_minor`, `plans.billing_period`, `subscriptions.status` only) | — | — |

---

## Appendix 1 — Consolidated findings register (by severity)

Severity totals: 1 Critical, 22 High, 70 Medium, 87 Low (180 findings). Full text of each finding is in section X.4 of its chapter.

| Id | Finding | Classification | Severity | Chapter |
|---|---|---|---|---|
| FND-701 | Money collected for "needs attention" cases exists in no ledger | Financial risk / Control gap | Critical | G |
| FND-101 | Merchant audit trail is written but cannot be read by the merchant | Missing process / Control gap | High | A |
| FND-102 | Ownership transfer and owner succession are not implemented although documented | Inconsistency (doc vs behaviour) / Missing process | High | A |
| FND-201 | Stock adjustments have no approval, value limit or segregation of duties | Control gap | High | B |
| FND-207 | Switching off stock tracking (or changing goods to service) hides existing balances from valuation without a movement | Financial risk | High | B |
| FND-406 | Bank account balances are never reconciled; deposits are credited on the depositor's word | Missing process | High | D |
| FND-407 | Cash out "correction" / "other" removes cash from custody with no destination and no approval | Financial risk | High | D |
| FND-408 | Disbursements have no limits, no approval and no link to what is owed | Control gap | High | D |
| FND-501 | Gateway refunds can never be confirmed; stock is restocked while revenue stays unreduced | Missing process (and behaviour vs documented intent) | High | E |
| FND-512 | Inventory valuation is only available "as of now"; no closing stock at period end | Missing process | High | E |
| FND-601 | No supplier invoice and no three-way match; delivery price cannot differ from the order | Missing process / Financial risk | High | F |
| FND-602 | Supplier payments are unbounded and unmatched: overpayment, duplicate and prepayment risk | Control gap / Financial risk (partly an owner decision: no payable balance, BR-087/OQ-018) | High | F |
| FND-603 | Transfer discrepancy write-off is self-approved and never posted | Control gap / Financial risk; also Inconsistency (doc vs behaviour) | High | F |
| FND-604 | Stock in transit is not valued, not aged and cannot be recalled | Financial risk / Missing process | High | F |
| FND-702 | Gateway refunds can never complete inside the system | Missing process | High | G |
| FND-703 | Paid online orders can only be refunded from a POS terminal by a cashier with an open shift; the customer has no receipt number | Control gap / Missing process | High | G |
| FND-704 | No reconciliation of gateway payouts to online sales; bank balance credited at confirmation with a merchant-entered fee | Control gap | High | G |
| FND-801 | Open orders are unbilled revenue with no management visibility, ageing or cut-off control | Control gap / Missing process | High | H |
| FND-802 | Dine-in orders on a deactivated table or area disappear from every screen while staying open | Control gap | High | H |
| FND-806 | A bill cannot be paid when ingredient stock is insufficient (negative stock denied) | Financial risk | High | H |
| FND-808 | Complimentary or served-then-voided items leave no stock or revenue trace and have no second control | Financial risk | High | H |
| FND-901 | No billing, invoicing, receivables or collection process for subscriptions | Owner decision to revisit (ADR-0082 / BR-155 / OQ-022) — presented as a decision with its risks, and as a missing process from the accounting standpoint. | High (for the operator as an accounting entity; no effect on merchants' books). | I |
| FND-904 | Suspension and closing ignore open shifts, cash balances, stock and pending documents | Control gap / Financial risk | High (closing is irreversible); Medium for suspension. | I |
| FND-103 | No self-service password change and no session overview | Control gap | Medium | A |
| FND-104 | Owner e-mail is never verified at self-registration | Owner decision to revisit | Medium | A |
| FND-105 | Audit entries for profile-type edits record the fact but not the values | Control gap (audit trail) | Medium | A |
| FND-108 | Invitation grants are authorised at invitation time, not at acceptance | Control gap (authorisation) | Medium | A |
| FND-109 | Branch deactivation has no operational pre-conditions | Control gap | Medium | A |
| FND-110 | Account lock-out by failed attempts can be triggered by anyone who knows an e-mail | Control gap (availability) / Owner decision to revisit | Medium | A |
| FND-113 | Default templates concentrate cash custody in the owner and leave segregation choices implicit | Owner decision to revisit | Medium | A |
| FND-202 | Stock counts are not blind, overwrite intervening movements and have no variance sign-off | Missing process | Medium | B |
| FND-203 | Average unit cost is limited to whole fils, distorting costs of low-value units | Financial risk | Medium | B |
| FND-204 | Negative balances are valued at zero and their cost basis is discarded on replenishment | Financial risk (consequence of an owner-permitted policy) | Medium | B |
| FND-206 | Stock held by archived variants/products or at inactive branches is frozen | Control gap | Medium | B |
| FND-210 | Restaurant waste bypasses the adjustment document, reason catalogue and adjustments report | Inconsistency (behaviour vs behaviour) | Medium | B |
| FND-211 | Transfer shortfalls leave the ledger without a write-off movement (shared with the Transfers chapter) | Control gap | Medium | B |
| FND-212 | "Customer return (outside POS)" lets stock re-enter outside the refund controls | Control gap | Medium | B |
| FND-213 | No point-in-time valuation, roll-forward or reserved-quantity visibility | Missing process | Medium | B |
| FND-301 | No supervisory override on another cashier's till | Inconsistency (doc vs behaviour) and Control gap | Medium | C |
| FND-302 | Price override is not bounded and bypasses the discount limit | Control gap | Medium | C |
| FND-304 | Non-cash payments can settle nowhere; cash fees are stored but never posted | Financial risk and Inconsistency (doc vs behaviour) | Medium | C |
| FND-305 | Card and transfer payments are self-declared ("manual" verification) | Owner decision to revisit / Missing process | Medium | C |
| FND-312 | Zero-total sales complete without a payment or a reason | Financial risk | Medium | C |
| FND-317 | "Net" in the sales history differs from "net after refunds" in the reports | Inconsistency (behaviour vs behaviour) | Medium | C |
| FND-401 | Closing is not blind | Owner decision to revisit | Medium | D |
| FND-402 | No explanation required for a closing shortage of any size | Control gap | Medium | D |
| FND-403 | Tolerance is unlimited, set by the monitoring manager, and silently reclassifies differences as "balanced" | Control gap | Medium | D |
| FND-404 | No follow-up or settlement process for shift and count differences | Missing process | Medium | D |
| FND-405 | Opening balances by count are created without source, note or second person | Owner decision to revisit | Medium | D |
| FND-409 | Book balances of a drawer can change under a cashier without their count or a movement on their shift | Control gap | Medium | D |
| FND-410 | Differences on branch transfers are absorbed by the company without an accountable party | Control gap | Medium | D |
| FND-411 | Period cut-off is inconsistent across lists and reports, and statements have no period | Inconsistency (behaviour vs behaviour) | Medium | D |
| FND-413 | Processing fees are configured estimates, not settled amounts, and are not reconciled to the acquirer | Owner decision to revisit | Medium | D |
| FND-416 | Weak segregation of duties around the register | Control gap | Medium | D |
| FND-422 | The custody right is too coarse | Control gap | Medium | D |
| FND-502 | Holders of the approve permission bypass the refund limit and window for their own refunds | Owner decision to revisit (segregation of duties) | Medium | E |
| FND-503 | Cashiers can refund their own sales within the limit with cash from their own drawer and no customer verification | Control gap | Medium | E |
| FND-504 | Exchange credit is paid back in cash: a card-to-cash conversion path | Owner decision to revisit | Medium | E |
| FND-505 | Manual card and transfer refunds are recorded as paid immediately, with an optional reference and no acquirer reconciliation | Control gap | Medium | E |
| FND-507 | Restock defaults to "yes" regardless of the return reason | Control gap | Medium | E |
| FND-508 | Returned goods not restocked have no custody record or write-off document | Missing process | Medium | E |
| FND-511 | Three different date bases for refunds and no period-based refund register | Inconsistency (behaviour vs behaviour) / Missing process | Medium | E |
| FND-513 | One item without a cost hides gross profit for the whole period | Control gap (usability of a key metric) | Medium | E |
| FND-521 | Refunding an online order requires a POS session with an open shift at the branch | Missing process | Medium | E |
| FND-525 | No supplier balances or payables view; purchases received and supplier payments live in different reports | Missing process | Medium | E |
| FND-605 | No segregation of duties on transfers | Control gap | Medium | F |
| FND-606 | Only approval is segregated on purchase orders; creator or approver may receive | Control gap (partly Owner decision: owner exempt, BR-101) | Medium | F |
| FND-607 | Receiving dialogs prefill the full expected quantity (no blind receiving) | Control gap | Medium | F |
| FND-608 | No value-based approval limits or budget on purchase orders | Missing process | Medium | F |
| FND-614 | Supplier reference on receipts is free text and not unique | Control gap | Medium | F |
| FND-615 | Returns to supplier are not supported | Owner decision to revisit (OQ-018) / Missing process | Medium | F |
| FND-616 | Landed costs are not capitalised | Owner decision to revisit (ADR-0070) / Missing process | Medium | F |
| FND-705 | Amount-mismatch charges are recorded as "failed" attempts | Inconsistency (behaviour vs record) | Medium | G |
| FND-706 | Revenue is recognised at payment confirmation; unfulfilled paid orders have no owner, ageing or hand-over evidence | Owner decision to revisit / Control gap | Medium | G |
| FND-707 | Reserved (committed) stock is invisible to management and unprotected under the negative-stock policy | Control gap / Inconsistency (doc vs behaviour) | Medium | G |
| FND-708 | Anonymous shoppers can tie up stock through reservations | Financial risk | Medium | G |
| FND-709 | Sandbox gateway creates real financial records without money; enabled by default outside production | Financial risk / Control gap | Medium (High if ever enabled in a merchant-facing environment) | G |
| FND-710 | A second successful payment on an already-paid order is not surfaced | Control gap | Medium | G |
| FND-713 | Customer profiles are created or linked from unauthenticated phone input | Control gap (data integrity / privacy) | Medium | G |
| FND-717 | Resolution of flagged orders relies on a free-text note | Control gap (evidence) | Medium | G |
| FND-803 | Item price is charged at payment time, modifier surcharge at ordering time (OQ-023) | Owner decision to revisit | Medium | H |
| FND-805 | Waste is valued in the ledger but reported nowhere; void reasons are not analysable | Missing process (adequacy of reports) | Medium | H |
| FND-807 | Waste cannot be recorded when ingredient stock is insufficient, inviting "not prepared" declarations | Control gap | Medium | H |
| FND-809 | Restaurant sales are attributed to the cashier who takes payment, not to the waiter | Missing process | Medium | H |
| FND-810 | No ownership of tables: any order-taker at the branch may modify, move, merge or bill any order | Control gap (segregation of duties) | Medium | H |
| FND-812 | Refunding or voiding a bill does not reopen the order or flag it | Inconsistency (behaviour vs behaviour) | Medium | H |
| FND-816 | Items made unavailable after ordering cannot be billed | Financial risk | Medium | H |
| FND-902 | Default plan is unlimited with a trial that has no consequence when it ends | Financial risk | Medium | I |
| FND-903 | Plan edits are not checked against merchants already on the plan | Control gap | Medium | I |
| FND-906 | No dual control for irreversible or commercially significant operator actions | Control gap | Medium | I |
| FND-907 | No operator offboarding or role change procedure | Missing process | Medium | I |
| FND-911 | Data retention, export and deletion after closing are undefined | Owner decision to revisit (OQ-022, OQ-011) / Missing process | Medium | I |
| FND-912 | Online payments keep completing sales for merchants that cannot act on them | Financial risk (residual risk of the owner decision BR-153) | Medium | I |
| FND-106 | Audit log immutability relies on database grants only; no tamper-evidence or retention policy | Control gap | Low | A |
| FND-107 | Documentation does not match behaviour in several identity details | Inconsistency (doc vs behaviour) | Low | A |
| FND-111 | Refused privileged actions are not audited | Control gap (audit trail) | Low | A |
| FND-112 | POS inactivity lock is detected in the browser, not by the server | Inconsistency (rule wording vs behaviour) | Low | A |
| FND-114 | Failed sign-in audit rows store attempted e-mails without a company and are unreviewable | Control gap (audit trail / privacy) | Low | A |
| FND-115 | Operator lifecycle beyond creation is manual | Missing process | Low | A |
| FND-116 | Reactivating a branch silently restores all dormant grants | Control gap (authorisation) | Low | A |
| FND-117 | Members with no role assignments remain active, invisible to branch managers, and count against plan capacity | Control gap (housekeeping) | Low | A |
| FND-205 | Valuation can drift from the sum of movement values because the average is rounded | Financial risk | Low | B |
| FND-208 | Catalog audit entries do not record most attribute changes | Control gap | Low | B |
| FND-209 | The "sale void" movement type exists in the schema and the screen filter but is never produced | Inconsistency (doc vs behaviour) | Low | B |
| FND-214 | Balance-equals-ledger integrity relies on code discipline only | Control gap | Low | B |
| FND-216 | Items can be stocked with no cost at all; the gap is reported only as "unvalued" | Control gap | Low | B |
| FND-218 | Increases by users without the price right are valued at a cost that may not be actual | Control gap | Low | B |
| FND-220 | Adjustment documents have no human-readable document number | Control gap | Low | B |
| FND-222 | Price and cost history exists only in the audit log | Missing process | Low | B |
| FND-223 | Two cost concepts (catalog standard cost vs moving average) are not explained to users | Inconsistency (doc vs behaviour) | Low | B |
| FND-303 | Above-limit discounts are not flagged and the limit in force is not kept | Control gap | Low | C |
| FND-306 | Cut-off follows a fixed merchant time zone; branch time zone is unused | Inconsistency (behaviour vs behaviour) | Low | C |
| FND-307 | Staff can attach their own or a colleague's customer profile | Missing process | Low (becomes Medium once loyalty or store credit exists, OQ-019) | C |
| FND-308 | Receipt contents are not fixed against a legal or commercial requirement | Owner decision to revisit | Low | C |
| FND-309 | Held sales: attribution drift, overwritten intent, no expiry | Control gap | Low | C |
| FND-310 | Reprint only during the current shift; reprints uncounted | Missing process | Low | C |
| FND-311 | Abandoned carts and cleared lines leave no trace | Missing process | Low | C |
| FND-313 | Discount limit applied per discount, not combined | Owner decision to revisit | Low | C |
| FND-314 | Online store reuses inactive customers | Inconsistency (doc vs behaviour) | Low | C |
| FND-315 | Duplicate customers without a phone | Control gap | Low | C |
| FND-316 | Till search exposes phone numbers broadly | Control gap | Low | C |
| FND-318 | Average sale uses gross spent and counts exchanges as purchases | Inconsistency (clarity) | Low | C |
| FND-412 | A fee on the cash method is counted in fee totals but posted nowhere | Inconsistency (behaviour vs behaviour) | Low | D |
| FND-414 | Accounts can be deactivated with a balance and keep receiving postings | Control gap | Low | D |
| FND-415 | Documentation and configuration remnants out of step with behaviour | Inconsistency (doc vs behaviour) | Low | D |
| FND-417 | Treasury of a deactivated branch keeps cash with no restriction | Control gap | Low | D |
| FND-418 | Management counts have no denomination breakdown in the screen | Control gap | Low | D |
| FND-419 | Manager cash moves during a shift need no cashier acknowledgement | Control gap | Low | D |
| FND-420 | Expense evidence is a free-text reference; categories are fixed | Missing process | Low | D |
| FND-421 | Idle-drawer count adjustments carry a generated reference, not a document | Control gap | Low | D |
| FND-506 | Pay-backs to a tender without a financial account leave no money trace | Control gap | Low | E |
| FND-509 | A pending request is bound to the requester's shift; once that shift closes it can only be rejected | Control gap (operational) | Low | E |
| FND-510 | Withdrawal of a pending request is documented but not offered on any screen | Inconsistency (doc vs behaviour) | Low | E |
| FND-514 | Sales-by-employee breakdown omits online sales and so does not add up to net sales | Inconsistency (doc vs behaviour) | Low | E |
| FND-515 | Audit event says "refund completed" for gateway refunds that are still processing | Inconsistency (behaviour vs behaviour) | Low | E |
| FND-516 | Approved refunds are stamped with the approver as the creator of the cash and stock entries | Inconsistency (behaviour vs behaviour) | Low | E |
| FND-517 | The manager dashboard shows no sales KPIs and a stale "no sales yet" banner | Inconsistency (doc vs behaviour) | Low | E |
| FND-518 | Report access and exports are not logged; exports exist only as browser CSV | Control gap | Low | E |
| FND-519 | Voided sales inflate sale count and average sale; exchanges gross up sales and refunds | Owner decision to revisit | Low | E |
| FND-520 | Unusual-activity threshold is hard-coded and the default period is all time | Control gap | Low | E |
| FND-522 | "Refund allocations" uses a different date basis than the rest of the payments report | Inconsistency (behaviour vs behaviour) | Low | E |
| FND-523 | One merchant-wide time zone; a change would re-cut all historical periods | Control gap | Low | E |
| FND-524 | Processing fees are never reversed on refunds | Owner decision to revisit | Low | E |
| FND-609 | Supplier list shows company-wide purchase totals to branch-scoped users | Inconsistency (behaviour vs behaviour) / Control gap (information) | Low | F |
| FND-610 | Supplier creation needs a merchant-wide right while the screen and the catalogue suggest branch scope | Inconsistency (doc vs behaviour) | Low | F |
| FND-611 | Cancellations need no reason; no "reject to draft"; creator may cancel an approved order | Control gap | Low | F |
| FND-612 | Received value rounded differently on the order page and in supplier/report totals | Inconsistency (behaviour vs behaviour) / Accuracy | Low | F |
| FND-613 | Documentation does not match behaviour on write-off and on schema | Inconsistency (doc vs behaviour) | Low | F |
| FND-617 | Zero unit cost and duplicate item lines accepted on purchase orders | Control gap / Accuracy | Low | F |
| FND-618 | Partial dispatch needs no explanation; notes are dropped | Control gap | Low | F |
| FND-619 | No document dates; cut-off depends on timely entry | Control gap (cut-off) | Low | F |
| FND-620 | Thin audit detail for master-data and draft edits | Control gap (audit trail) | Low | F |
| FND-621 | Purchasing report counts closed orders at full ordered value; open value is "as of now" | Inconsistency / Accuracy of reports | Low | F |
| FND-622 | Surplus arriving on a transfer cannot be recorded on it | Control gap | Low | F |
| FND-623 | Unknown dispatch cost leaves transfers and losses unvalued | Accuracy / Control gap | Low | F |
| FND-711 | Delivery fee is booked as product revenue at 100 % margin and is refundable as an item | Owner decision to revisit | Low | G |
| FND-712 | Sale date is the confirmation time, not the provider's charge time | Control gap | Low | G |
| FND-714 | No customer notifications; the tracking link is shown once | Missing process | Low | G |
| FND-715 | Fulfilment branch status is not enforced after publishing | Control gap | Low | G |
| FND-716 | Audit trail housekeeping: store settings and listings logged against the wrong target; manual reconciliation unlogged | Control gap (audit trail) | Low | G |
| FND-718 | Processing fee and its non-reversal are defaults awaiting the owner's contracts | Owner decision to revisit | Low | G |
| FND-719 | No real gateway is connected | Owner decision to revisit | Low (as documented) | G |
| FND-720 | Late payments after expiry create sales at stale prices without review | Control gap | Low | G |
| FND-804 | Bill discounts exist in the API but not on the POS bill screen | Inconsistency (doc vs behaviour) | Low | H |
| FND-811 | Kitchen status changes are not audited and "served" is declared by the kitchen | Control gap | Low | H |
| FND-813 | Disabling the module with open orders traps unbilled revenue | Control gap | Low | H |
| FND-814 | Payment of a takeaway/pickup bill fails when no kitchen station exists and auto-send is on | Control gap | Low | H |
| FND-815 | Manager screens lag the API: no service-type filter/column, no modifiers on the manager sale detail, surcharges not itemised on receipts | Inconsistency (doc vs behaviour) | Low | H |
| FND-817 | Thin order-level audit trail: no item detail on "items added", free-text reasons, no recipe history | Control gap (audit trail) | Low | H |
| FND-819 | Guest counts and kitchen timings are captured but never reported | Missing process | Low | H |
| FND-822 | Merging mixes service types; the bill takes the target's type | Inconsistency (behaviour vs behaviour) | Low | H |
| FND-824 | "Waiters need an open shift" is enforced by the screen, not by the system | Inconsistency (doc vs behaviour) | Low | H |
| FND-905 | Operator reads of merchant data are not audited | Control gap | Low (data exposed is summaries only) — Medium if impersonation is ever added. | I |
| FND-908 | An operator can attach any existing user as owner of a new company without consent or notice | Control gap | Low | I |
| FND-909 | Subscription dates and statuses are free-form and the period is not modelled | Inconsistency (behaviour vs behaviour) / Missing process | Low | I |
| FND-910 | Overview staff count differs from the employee definitions used elsewhere | Inconsistency (behaviour vs behaviour) | Low | I |
| FND-913 | Documentation claims versus behaviour: minor discrepancies | Inconsistency (doc vs behaviour) | Low | I |
| FND-914 | Billing role cannot see the audit trail of its own actions | Control gap | Low | I |
| FND-915 | Single encryption key for all operator second factors | Control gap (operational) | Low | I |
| FND-916 | Welcome e-mail is sent after commit without retry or visibility | Control gap | Low | I |

## Appendix 2 — Index of procedures

| Id | Procedure | Chapter |
|---|---|---|
| BP-101 | Merchant self-registration (company creation by the owner) | A |
| BP-102 | Company profile maintenance | A |
| BP-103 | Sign-in to the management application | A |
| BP-104 | Sign-in to the point of sale (merchant and branch binding) | A |
| BP-105 | Switching company, interface or branch during a session | A |
| BP-106 | Session validity, timeouts, sign-out and forced revocation | A |
| BP-107 | POS screen lock and unlock | A |
| BP-108 | Password recovery and manager-triggered reset | A |
| BP-109 | Platform operator sign-in and operator provisioning | A |
| BP-110 | Branch creation | A |
| BP-111 | Branch update (details and receipt texts) | A |
| BP-112 | Branch deactivation and reactivation | A |
| BP-113 | Employee invitation (create, resend, revoke) | A |
| BP-114 | Invitation acceptance (joining the company) | A |
| BP-115 | Employee profile maintenance | A |
| BP-116 | Employee deactivation and reactivation | A |
| BP-117 | Changing an employee's role assignments | A |
| BP-118 | Role creation and editing (custom roles) | A |
| BP-119 | Role deletion | A |
| BP-120 | Authorisation of every request (permission evaluation, branch scoping, tenant isolation) | A |
| BP-121 | Audit trail: what is recorded, who can read it, and whether it can be altered | A |
| BP-201 | Maintain product categories | B |
| BP-202 | Create a product (simple or with variants) | B |
| BP-203 | Edit a product, its variants, prices and costs | B |
| BP-204 | Restrict a product to selected branches | B |
| BP-205 | Archive or restore a product | B |
| BP-206 | Manage product images | B |
| BP-207 | Distribute the catalog and stock availability to the POS | B |
| BP-208 | Configure the negative-stock policy | B |
| BP-209 | Record opening stock | B |
| BP-210 | Record a stock increase | B |
| BP-211 | Record a stock decrease (write-off) | B |
| BP-212 | Record a stock count | B |
| BP-213 | Set a low-stock alert threshold | B |
| BP-214 | View stock levels, per-branch breakdown, summary and valuation | B |
| BP-215 | View movement history and adjustment documents | B |
| BP-216 | Post a stock movement through the inventory engine (cross-cutting) | B |
| BP-217 | Honour online-store stock reservations | B |
| BP-218 | Expand sold items into stock consumption (recipes and modifiers) | B |
| BP-219 | Reconcile stock quantities and value to movements over a period | B |
| BP-301 | Configure the selling policy | C |
| BP-302 | Build the cart at the till | C |
| BP-303 | Apply an item or sale discount within the limit | C |
| BP-304 | Apply a discount above the limit (supervisory discount, up to 100 %) | C |
| BP-305 | Override a selling price at the till | C |
| BP-306 | Attach a customer to the sale (or sell walk-in) | C |
| BP-307 | Take payment and complete the sale (the checkout) | C |
| BP-308 | Sales created by other engines (exchange, restaurant bill, online order) | C |
| BP-309 | Hold (suspend) a sale, resume it, discard it | C |
| BP-310 | Receipt, reprint and recent sales at the till | C |
| BP-311 | Review sales history and a sale's detail in management | C |
| BP-312 | Void a completed sale (window and authority, summary) | C |
| BP-313 | Create and maintain customer profiles (management) | C |
| BP-314 | Customer purchase history, refunds and spending summary | C |
| BP-401 | Configure payment methods and processing fees | D |
| BP-402 | Configure bank accounts and other non-cash places | D |
| BP-403 | Default setup of a new company, a new branch and a new register | D |
| BP-404 | Configure registers (access, tolerance, status) | D |
| BP-405 | Open a shift by counting the drawer | D |
| BP-406 | Cash in / cash out during a shift (corrections, "other", change swap) | D |
| BP-407 | Drop to treasury and top-up from treasury | D |
| BP-408 | Close own shift with a count | D |
| BP-409 | Manager force close (with count / without count) and attribution of a later difference | D |
| BP-410 | Count a treasury, or a register without an open shift | D |
| BP-411 | Bank deposit (from a drawer at the till; from a treasury in management) | D |
| BP-412 | Expense paid in cash | D |
| BP-413 | Supplier payment in cash | D |
| BP-414 | Reverse an expense or supplier payment | D |
| BP-415 | Branch-to-branch cash transfer (send, receive, cancel) | D |
| BP-416 | Settlement of sale payments and refunds into cash places (cross-domain summary) | D |
| BP-417 | Cash overview, statements, shift monitoring, discrepancy report and cash reports | D |
| BP-418 | Cutover from the old company cash account (one-time, 2026-10-12) | D |
| BP-501 | Receipt lookup and refund eligibility check (POS) | E |
| BP-502 | Refund preview (amount computation and suggested pay-back) | E |
| BP-503 | Return and refund request (full, partial, by quantity) | E |
| BP-504 | Pay-back allocation per original tender and settlement | E |
| BP-505 | Restock decision and stock effect | E |
| BP-506 | Approval workflow: pending → approve / reject / withdraw | E |
| BP-507 | Void (cancellation) of a sale of the open shift | E |
| BP-508 | Exchange through the checkout engine | E |
| BP-509 | Gateway refunds awaiting confirmation | E |
| BP-510 | Refund receipt | E |
| BP-511 | Refund history and detail (manager), customer refund history | E |
| BP-512 | Unusual refund activity report | E |
| BP-513 | Refund policy settings (return window, approval limit) | E |
| BP-514 | Sales report | E |
| BP-515 | Gross profit policy | E |
| BP-516 | Payments & cash report | E |
| BP-517 | Expenses report | E |
| BP-518 | Shifts report and discrepancy report | E |
| BP-519 | Inventory report | E |
| BP-520 | Purchasing report | E |
| BP-521 | Report period, time zone, comparison and filters | E |
| BP-522 | Report access and permission scoping | E |
| BP-523 | CSV export | E |
| BP-524 | Manager dashboard | E |
| BP-525 | Period close using the reports (external accountant's view) | E |
| BP-601 | Maintain the supplier master file | F |
| BP-602 | Review a supplier: purchase history and cash paid | F |
| BP-603 | Create and edit a draft purchase order | F |
| BP-604 | Submit a purchase order for approval | F |
| BP-605 | Approve a purchase order | F |
| BP-606 | Receive goods against an approved order (full or partial delivery) | F |
| BP-607 | Close a partially received order with open quantities | F |
| BP-608 | Cancel a purchase order before any receipt | F |
| BP-609 | Pay a supplier (cash disbursement linked to a supplier and optionally an order) | F |
| BP-610 | Request a branch stock transfer | F |
| BP-611 | Approve a transfer at the source branch | F |
| BP-612 | Dispatch a transfer (stock leaves the source and is "in transit") | F |
| BP-613 | Receive a transfer at the destination, with discrepancy write-off | F |
| BP-614 | Cancel a transfer before dispatch | F |
| BP-615 | Purchasing and transfer reporting | F |
| BP-616 | Supplier invoice matching, returns to supplier and landed costs (not implemented — what staff do today) | F |
| BP-701 | Configure the online store and change its state | G |
| BP-702 | Manage product listings | G |
| BP-703 | Make a payment method available online (gateway, fee, settlement account) | G |
| BP-704 | Public storefront: catalogue and availability | G |
| BP-705 | Shopper checkout (order placement) | G |
| BP-706 | Stock reservation lifecycle and expiry | G |
| BP-707 | Payment at the gateway and processing of notifications | G |
| BP-708 | Payment confirmation: the order becomes an online-channel sale | G |
| BP-709 | Reconciliation of pending payments (automatic and manual) | G |
| BP-710 | Orders needing attention and their resolution | G |
| BP-711 | Order tracking by the shopper | G |
| BP-712 | Fulfilment steps by the merchant | G |
| BP-713 | Cancellation of unpaid or needs-attention orders | G |
| BP-714 | Refund of a paid online order | G |
| BP-715 | Online orders screen, sales views and reporting of the online channel | G |
| BP-716 | Operating the sandbox gateway | G |
| BP-801 | Enable the restaurant module and its settings | H |
| BP-802 | Define dining areas and tables | H |
| BP-803 | Define kitchen stations and category routing | H |
| BP-804 | Define modifier groups, modifiers, surcharges and modifier ingredients | H |
| BP-805 | Configure a menu item: modifier groups and recipe | H |
| BP-806 | Open an order (dine-in, takeaway, pickup) | H |
| BP-807 | Add items with modifiers and notes | H |
| BP-808 | Send items to the kitchen | H |
| BP-809 | Kitchen display and status progression | H |
| BP-810 | Cancel an item before it is sent | H |
| BP-811 | Cancel (void) an item already sent to the kitchen — waste and ingredient deduction | H |
| BP-812 | Cancel a whole order | H |
| BP-813 | Move an order to another table | H |
| BP-814 | Combine (merge) two orders | H |
| BP-815 | Quote and pay a bill (split bills, tenders, discounts) and order closing | H |
| BP-816 | Receipts, lists and reports for restaurant sales | H |
| BP-817 | Floor supervision and end-of-day handling of open orders (largely absent) | H |
| BP-901 | Creating and re-keying an operator account (command line) | I |
| BP-902 | Operator sign-in with a second factor, session and sign-out | I |
| BP-903 | Platform overview (cross-merchant summary) | I |
| BP-904 | Merchant list and search | I |
| BP-905 | Merchant detail (profile, onboarding, usage, history, platform actions) | I |
| BP-906 | Creating a merchant on behalf of its owner (operator onboarding) | I |
| BP-907 | Suspending a merchant | I |
| BP-908 | Reactivating a suspended merchant | I |
| BP-909 | Closing a merchant permanently | I |
| BP-910 | Managing subscription plans | I |
| BP-911 | Plan change readiness check | I |
| BP-912 | Changing a merchant's subscription (plan, status, dates) | I |
| BP-913 | Enforcement of plan limits inside merchant operations (capacity checks) | I |
| BP-914 | Enforcement of plan features (restaurant module, online store) | I |
| BP-915 | The merchant's own subscription page | I |
| BP-916 | Platform audit trail | I |
| BP-917 | Initial subscription at registration or first use (automatic) | I |
| BP-918 | Billing, invoicing and collection of subscription fees (not implemented) | I |
