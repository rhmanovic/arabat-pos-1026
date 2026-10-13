# Business Rules

Confirmed rules come from the product owner. Each rule has an id so code, tests
and decisions can reference it. Rules marked **Default (engineering)** are
engineering defaults pending owner confirmation.

## 1. Tenancy and accounts — Confirmed

- **BR-001** The system is multi-tenant. Each company (merchant) is a tenant.
- **BR-002** Each tenant has exactly one primary **owner/manager** account.
- **BR-003** A tenant has multiple **employee** accounts, created or invited by
  authorized management.
- **BR-004** A tenant has one or more **branches**.
- **BR-005** Each tenant has its own products, inventory, sales and business
  data; no tenant can see or affect another tenant's data.
- **BR-006** Roles and permissions are configurable per tenant.

## 2. Interfaces and access — Confirmed

- **BR-010** Three separate interfaces: `/manager` (business management),
  `/pos` (employee cashier), `/platform` (SaaS operator administration).
- **BR-011** Each interface has its own layout, navigation and workflows.
- **BR-012** Authentication is centralized; permissions and branch restrictions
  are enforced by the backend.
- **BR-013** Employee accounts do **not** automatically access management
  functions.
- **BR-014** Managers may access the POS **only if explicitly authorized**.
- **BR-015** `/platform` is restricted to SaaS operator staff; merchant
  accounts never access it.
- **BR-016** All interfaces support **Arabic (RTL) and English (LTR)**.
- **BR-017** A company has multiple users, and access is controlled per branch.
- **BR-018** The POS is optimized for speed, barcode scanning and touch devices.
- **BR-019** All interfaces use the same backend business services; critical
  logic is never duplicated per interface.
- **BR-040** Merchant owners register themselves (self-service, Prompt 4). Registration
  creates the company, its main branch ("الفرع الرئيسي") and the owner account.
- **BR-041** A user may belong to several merchants; every session is bound to exactly
  one merchant (and, in the POS, one branch) chosen at sign-in.
- **BR-042** Sign-in and password recovery never reveal whether an e-mail is registered.
- **BR-044** Employees join a merchant only through an invitation from an authorized
  manager; they set their own password. Managers never see or set passwords.
- **BR-045** Nobody can grant permissions beyond their own authority, manage the owner,
  manage themselves, or manage a more privileged employee.
- **BR-046** Branch-scoped administration: a branch manager sees and manages only the
  employees and settings of their assigned branches.
- **BR-047** The main branch cannot be deactivated; deactivating a branch removes all
  access granted at it (including open POS sessions there).
- **BR-048** Default roles: Owner, Company Manager, Branch Manager, Supervisor, Cashier.
  Roles are editable and merchants can create their own.
- **BR-043** Password reset links are single-use, expire after 30 minutes and end all
  sessions of the account.

## 3. Access rules — Default (engineering)

- **BR-020** The owner always has full access to all branches and both merchant
  interfaces; the owner cannot be removed, demoted or deactivated by another
  tenant user. Ownership transfer is an explicit, audited action.
- **BR-021** Non-owner users only see and act on branches they are assigned to.
- **BR-022** A POS session operates on exactly one branch at a time.
- **BR-023** Deactivating a user immediately revokes all their sessions.
- **BR-024** A user may hold different roles at different branches (e.g.
  manager at branch A, cashier at branch B).
- **BR-025** A user can never grant a permission they do not hold.
- **BR-026** Actions beyond a cashier's permissions (void, refund, discount
  above limit, price override) require a manager override, which is audited.
- **BR-027** One open shift per register; sales require an open shift.

- **BR-049** Products are never deleted, only archived; archived products are hidden
  from the POS and remain in history. Prices have at most 3 decimals (fils).
- **BR-050** Sales store a snapshot of name, SKU and price at the time of sale, so later
  price changes never alter past sales (enforced from the checkout slice).
- **BR-051** A product is sold in all branches unless restricted to selected branches.
- **BR-052** Services do not track inventory.

- **BR-060** Stock is kept per branch and per product variant. Only stock-tracked goods
  have balances; services never do.
- **BR-061** Inventory valuation uses the moving weighted-average cost (ADR-0043).
- **BR-062** No overselling by default: a sale or decrease that would take stock below
  zero is refused. The owner may explicitly allow negative stock in inventory settings.
- **BR-063** Manual adjustments always have a type and a reason (opening, increase:
  found / customer return / received / correction / other; decrease: damaged / expired /
  lost / theft / internal use / correction / other; count). "Other" requires a note.
  Opening stock only for items without stock history at that branch.
- **BR-064** Stock history is permanent: adjustments cannot be edited or deleted;
  mistakes are corrected with a new adjustment.
- **BR-065** A low-stock alert threshold can be set per item and branch; the item is
  "low" when its balance is at or below the threshold, "out" at zero, "negative" below.
- **BR-066** Costs and stock values are visible only to users with price-management or
  inventory-report rights; cashiers see quantities only.

- **BR-070** Each merchant configures its own payment methods (cash, card, bank transfer,
  custom), each enabled/disabled and available at the POS and/or (later) online. New
  merchants start with Cash, Card (KNET) and Bank transfer without fees.
- **BR-071** Processing fee per payment: none, fixed, percentage, or fixed + percentage;
  rounded half-up to the fils; never more than the payment.
- **BR-072** Registers belong to a branch; open to everyone allowed to work shifts at the
  branch, or restricted to listed employees. Every branch starts with one register.
- **BR-073** Shift policy: one employee per register at a time; one open shift per
  employee; only the owner of the shift uses it; managers may force-close with a note.
- **BR-074** Closing a shift records expected cash, counted cash (optionally by notes and
  coins) and the difference (counted − expected). Differences within the register's
  tolerance are "balanced"; otherwise "over" or "short". Closed shifts never change.
- **BR-075** Cash in/out needs a reason ("other" requires a note) and cannot take out more
  cash than the drawer holds. Drop to treasury and top-up from treasury are transfers between
  the register and its branch treasury; a change swap moves no money (ADR-0090).
- **BR-076** Cash places (ADR-0090): every register (drawer) has a balance that carries over
  between shifts; every branch has its own treasury; bank accounts belong to the company.
  Company cash = all treasuries + all registers. Cash sales and cash refunds change only the
  register of the shift; KNET, cards, payment link and WAMD go straight to their bank minus the
  fee. Money moves between places only by a recorded transfer, which is never a sale, revenue or
  expense. No transfer may take more than the source holds; a treasury pays out only after its
  first count.
- **BR-077** A shift is a period of responsibility. Opening = count against the register's
  expected balance; a difference is "between shifts" (needs a note beyond the tolerance) and is
  never charged to the opening cashier; the first count of a register is its opening balance, not
  a difference. Closing = count; the difference is booked on the shift (shown by cashier name,
  never deducted automatically) and the cash stays in the drawer.
- **BR-078** Manager force-close: with the manager's own count it is a verified close; without a
  count it is "forced, not counted": nothing is booked, the register keeps its book balance and
  needs a count, and the difference found at the next count is attributed to the forced shift.
  Anyone with `cash.custody` may count a register without an open shift or a treasury.
- **BR-079** Cutover to custody (2026-10-12): history is kept and nothing is reset. The old cash
  account becomes the archived «حساب النقد القديم» (statement only, in no total, belongs to no
  branch); new treasuries and registers start at 0 "not yet counted" and get their opening balance
  from a physical count («رصيد افتتاحي بالجرد»); a shift open at cutover closes the old way and its
  count becomes the drawer balance; sales reports are unchanged. `cash.move` was removed from the
  cashier role, existing cashiers included (owner decision); supervisors keep it.

- **BR-087** Expenses and supplier payments (ADR-0091) are real cash outflows, recorded in their
  own register (number EX-/SP-), never as transfers, sales or revenue. An expense has a fixed
  category (supplies, maintenance, transport, hospitality, utilities, cleaning, other — "other"
  needs a description); a supplier payment names an active supplier and optionally one of its
  submitted or later purchase orders. Paid from the drawer at the POS (`cash.move`) or from a
  branch treasury in management (`cash.custody`). A mistake is corrected by a reversing record
  (reason required) that returns the cash to where it was paid from; records are never edited.
  Supplier payments are not operating expenses; no payable balance is kept yet.
- **BR-088** Bank deposits move cash from a drawer (POS) or a branch treasury (management) into an
  active bank account. They need `cash.deposit` in addition to the usual permission, are
  transfers (not expenses), and reduce company cash.
- **BR-089** Cash sent between branches leaves the sending treasury into "in transit" (still
  company cash). The receiving branch confirms the amount it counted; a difference needs a note
  and is booked on the transfer. The sender may cancel before receipt (the cash returns). A
  transfer is received or cancelled once (`cash.custody` at the receiving / sending branch).

- **BR-080** Pricing: line amount = price × quantity rounded half-up to the fils; item
  discounts (percent or amount, never more than the line); a sale discount on the
  remaining amount is shared across the items exactly; the total is the sum of the items.
- **BR-081** Discounts need `sales.discount`; above the merchant's limit (default 10 %,
  per item and per sale) they need `sales.discount.override_limit` (supervisor).
- **BR-082** Price changes at the till need `sales.price_override`; the original price
  and the change are kept on the sale and in the audit log.
- **BR-083** A sale is completed only when the payments equal the total exactly; only
  cash may be over-tendered (the difference is change). Split payments are allowed.
- **BR-084** Selling requires the cashier's own open shift; every sale records merchant,
  branch, register, shift and employee. Stock is deducted at completion, all-or-nothing;
  no overselling unless the merchant allows negative stock.
- **BR-086** Every non-cash payment settles into a bank account: the payment and its processing
  fee are posted to that account's ledger. Cash payments settle into the register drawer of the
  shift (BR-076). A new company starts with a treasury per branch, a drawer account per register,
  two bank accounts and the methods Cash → register drawer, KNET → bank 1, Visa/Mastercard → bank 2,
  payment link → bank 1, WAMD → bank 1, all without fees and all editable (ADR-0089, amended by
  ADR-0090). Fee rates are entered by the owner per method.
- **BR-085** Held (suspended) sales reserve no stock; any cashier at the branch may resume
  or discard them; a held sale can be completed once.

- **BR-090** Returns are made against the original receipt at the branch of the sale;
  item quantities can be partial; the refund amount is the paid (net) value of the units.
- **BR-091** Refunds go back to the original payment methods (split payments per tender,
  never more than each tender); cash comes from the cashier's drawer.
- **BR-092** Approval by a supervisor/manager is required above the refund limit or after
  the return window (both configurable); nobody approves their own refund.
- **BR-093** Returned items go back to stock only when marked so (not for damaged goods),
  at the cost they were sold with.
- **BR-094** A sale of the cashier's open shift may be cancelled (void) by users with
  `sales.void` while it has no returns; held sales can be discarded; pending refund
  requests can be withdrawn.
- **BR-095** Gateway refunds are completed only after the gateway confirms them.

- **BR-100** Purchase orders go draft → submitted → approved → received; only drafts can
  be edited; an order can be cancelled only before anything was received, and an order
  with open quantities can be closed with a reason.
- **BR-101** Approving a purchase order needs `purchasing.approve`; the person who created
  the order cannot approve it (except the owner).
- **BR-102** Goods can be received in several deliveries, never more than ordered; each
  delivery adds stock at the order's unit cost and updates the average cost.
- **BR-103** Branch transfers are requested, approved at the source, dispatched (stock
  leaves the source and is "in transit") and received at the destination. A source can
  never send more than it holds.
- **BR-104** If less arrives than was sent, the receiver must explain it; the missing
  quantity is recorded as a discrepancy and written off.

- **BR-110** A sale may name a registered, active customer or be a walk-in sale (no
  customer). Choosing a customer at the till needs `customers.read`; creating a basic
  profile there (name, phone, e-mail) needs `customers.create`. An exchange keeps the
  original sale's customer.
- **BR-111** Customers get a number `C-000001…`. A phone number can belong to only one
  customer per merchant; local 8-digit numbers are treated as Kuwaiti (+965).
- **BR-112** A customer's purchases, refunds, total spent, net spend (spent − refunded) and
  average sale come from their sales and refunds; a manager sees the totals of the
  branches they are allowed to view.
- **BR-113** Cashiers see only the customer's name, number and phone. E-mail, address,
  notes and spending are management information.
- **BR-114** Customers are deactivated, never deleted; inactive customers cannot be used
  for new sales. Notes cannot be edited or removed.

Restaurant (Prompt 15):
- **BR-130** The restaurant module is enabled per company; without it the POS works as a
  retail POS only.
- **BR-131** A table has at most one open order. Dine-in orders need a table; takeaway and
  pickup orders may carry a name.
- **BR-132** Required modifier groups must be answered (minimum/maximum per group);
  modifier prices are added to the item's unit price and printed on the receipt.
- **BR-133** A bill pays chosen unpaid items at the current price; an item is paid at most
  once; an order closes when every remaining item is paid.
- **BR-134** Discounts on a bill follow the same rules and limits as retail sales.
- **BR-135** Stock is deducted when items are paid (ingredients for recipe items), never
  when the kitchen works on them.
- **BR-136** Cancelling an item already sent to the kitchen needs a supervisor
  (`restaurant.void_item`) and a reason; if it was prepared it is recorded as waste and
  its ingredients are deducted.
- **BR-137** Moving or combining tables never changes money; orders with paid bills
  cannot be combined.
- **BR-138** Kitchen status only moves forward and never creates sales or payments.
- **BR-139** Paid restaurant items are corrected by refunds of their bill (Prompt 11),
  not by editing the order.

Security hardening (Prompt 18):
- **BR-160** The POS locks after 5 minutes without input or on demand; only the same
  user's password unlocks it; five wrong passwords end the session. Others sign in with
  their own account.
- **BR-161** A payment confirmed after its order was cancelled or failed is recorded (never
  ignored) and the order is flagged "needs attention" for a refund at the provider.

Remediation session 1 (2026-10-13, owner decisions D1 and the audit-log change; see
`docs/audit/REMEDIATION_PLAN.md`):
- **BR-162** Cash counts are **blind** by default: a user without `shifts.view_all` at the branch
  is shown no expected drawer balance before counting at opening or closing, needs no
  "expected" figure to open, and is not asked to explain an opening difference they cannot see
  (it is still booked between shifts and shown to them once recorded); the expected cash and
  the difference appear after the count. Owners and supervisors who monitor shifts keep seeing
  the figures. The owner may switch the policy off in the selling policy (`merchant.settings.update`);
  cashiers can never change it.
- **BR-163** The company's audit trail is readable by holders of `audit.read` in the management
  application (filters: period in local days, action, record type, actor; CSV export of the
  displayed rows). Entries without a company (failed sign-ins, platform-only actions) are not
  shown; entries can never be edited or deleted.

Remediation session 2 (2026-10-13, owner decisions D2 and D3):
- **BR-164** Cash-out controls. A **correction** at the till only reverses a posted "other"
  movement (or an earlier correction) of the same shift, the opposite way, up to what is left of
  it, and needs a note; drops, top-ups, deposits and disbursements are reversed by their own
  opposite record. An **"other" cash-out** above the company's per-movement limit, or taking the
  shift's "other" cash-outs above the per-shift limit (owner-set in the selling policy; defaults
  20.000 and 50.000 KWD), is recorded **pending**: no cash leaves the books until a holder of
  `shifts.view_all` at the branch approves it in management; nobody approves their own request;
  rejecting needs a reason; the cashier may withdraw it; a shift cannot be closed by its cashier
  while a request is pending, and a manager's forced close rejects what is pending. The **owner**
  posts such a cash-out directly: the movement is flagged *above the limit / owner override* and
  the audit entry says so. A register's tolerance can never exceed the owner-set company
  maximum (default 1.000 KWD), and whoever closes a shift while seeing the expected figure must
  explain a difference beyond the tolerance (a blind cashier is not asked).
- **BR-165** Cash custody outside the owner. A default **Treasurer** role (manager access, cash
  custody, bank deposits, shift monitoring, financial reports, supplier and branch reading; no
  selling, master data or employee administration) exists in every company. The dashboard shows
  an internal-control checklist to holders of company-settings reading: no treasurer other than
  the owner, active employees without any role, registers above the tolerance maximum, and
  cash-outs awaiting approval.

Platform and subscriptions (Prompt 17):
- **BR-150** Every merchant has exactly one subscription to a plan. New merchants start on
  the default plan (trial when the plan has trial days). Plans can be archived, never
  deleted; archived plans cannot be assigned.
- **BR-151** Plan limits (empty = unlimited): active branches, employees (active
  non-owner members plus pending invitations), active products, active registers. Creating
  or reactivating beyond a limit is refused (`PLAN_LIMIT_REACHED`); existing records are
  never removed. A new branch also needs room for its default register.
- **BR-152** Merchant status is active, suspended or closed and is changed only by
  platform operators, with a reason. Support and super admins suspend and reactivate; only
  super admins close. Closing is final.
- **BR-153** Suspension takes effect at once: every session ends, sign-in answers
  "company suspended", invitations cannot be accepted and the online store disappears.
  Data is kept. Online payments already started are still recorded (no money is lost).
- **BR-154** A plan change is allowed only when current usage fits the new plan and no
  feature in use (restaurant module, non-draft online store) would be removed.
- **BR-155** No automatic billing. Plan prices are informational; subscription status
  (trial, active, past due, cancelled, expired) and dates are set by operators and never
  block daily work by themselves (ADR-0082).
- **BR-156** Merchants see only their own subscription, usage and the public plans.
- **BR-157** Operators see merchant summaries (counts, plan, last sale date), never sales
  lines, customers or other business documents.
- **BR-158** Operators are created only with the CLI; every platform action (sign-in,
  merchant creation, status, subscription and plan changes) is audited with operator,
  reason and IP.

Online store (Prompt 16):
- **BR-140** A store is draft (hidden), published (open for orders) or paused (browse
  only). Publishing needs a fulfilment branch, pickup or delivery, and at least one
  online payment method whose gateway is ready.
- **BR-141** Only listed, active products appear online, at their catalog price; stock
  and availability are those of the fulfilment branch. Untracked and recipe items are
  always available.
- **BR-142** Checkout re-prices the cart on the server and refuses it if the total the
  shopper saw changed (`TOTAL_CHANGED`) or is below the minimum order (`MINIMUM_ORDER`).
  Whole quantities only, at most 20 per item. Repeating a checkout with the same key
  returns the same order.
- **BR-143** Online payments go through a gateway; only the sandbox gateway is active.
  Tap, UPayments, Hesabe and Bookeey are not connected until the owner approves them and
  tested credentials exist. The sandbox never moves real money.
- **BR-144** An unpaid order reserves its stock for the store's reservation time
  (default 30 minutes). Reserved stock cannot be sold at the POS or transferred.
- **BR-145** When payment is confirmed the order becomes a sale (channel "online") and
  stock is deducted once. Failed, cancelled or expired payments release the stock. A
  payment whose amount differs from the order, or that arrives after the stock was sold,
  is not turned into a sale: the order needs attention.
- **BR-146** Order flow: paid → preparing → ready (pickup) or out for delivery
  (delivery) → completed. Only unpaid or needs-attention orders can be cancelled; paid
  orders are cancelled by refunding their sale.
- **BR-147** Each gateway notification is processed once (provider event id), only with
  a valid signature, and repeated notifications change nothing.
- **BR-148** The delivery fee is part of the sale total (its own line); processing fees
  of the online method apply as for POS card payments.
- **BR-149** Shoppers need no account; a customer profile is found or created by phone
  number. Orders are tracked through an unguessable link.

Report metrics (Prompt 14; all exact, in fils, merchant-local days):
- **BR-120** *Gross sales* = Σ unit price × quantity of items sold, before discounts.
  *Discounts* = item discounts + sale discounts. *Net sales* (sales revenue) = gross −
  discounts = Σ completed sale totals. *Average sale* = net sales ÷ number of sales
  (half-up).
- **BR-121** *Refunds* = completed refunds, cancelled sales and exchange returns,
  counted in the period they were completed. *Net after refunds* = net sales − refunds.
- **BR-122** Breakdowns by branch, employee (who rang up the sale / requested the
  refund), product, category (the product's current category), hour and day always add
  up to the totals. "Sales by payment method" is the amount applied to the period's
  sales per tender, including exchange credit.
- **BR-123** *Payments collected* = succeeded payments received for sales in the period
  (cash counted after change), excluding internal exchange credit. It is not revenue.
- **BR-124** *Paid back* = settled refund payments of refunds completed in the period,
  per method; gateway refunds still waiting are listed separately and not counted.
- **BR-125** *Processing fees* = fees stored on each payment from the method's settings;
  not reversed on refunds (OQ-016). *Net cash* = cash sales − cash refunds + cash in −
  cash out (the same entries as the drawer's expected cash).
- **BR-126** *Cash difference* of a shift = counted − expected at closing; balanced when
  within the register's tolerance, otherwise over or short.
  A shift force-closed without a count is "not counted": neither balanced nor a difference.
  The discrepancy report also shows, by close type, the differences found between shifts
  (at opening, by register; first counts excluded) and those found after an uncounted close
  (attributed to that shift and its cashier) (ADR-0092).
- **BR-126a** *Cash by type* = changes of the registers' and treasuries' cash ledger in the
  period: cash sales and refunds, drops, top-ups, bank deposits, expenses and supplier payments
  (net of reversals), corrections, count differences, opening counts, transfers between branches.
  *Expenses report* = cash expenses by category, branch, source and day, and supplier payments
  by supplier, each reversal subtracted on its own date (`reports.financial`). The dashboard
  shows total cash on hand (treasuries + drawers + in transit) to `cash.custody` holders.
- **BR-127** *Gross profit* — see ADR-0070; never shown when costs are missing or to users
  without `reports.financial`.
- **BR-128** *Inventory value* = current quantity × weighted-average cost per item and
  branch; items without a known cost are counted, not valued. Purchase values are
  Σ quantity × order unit cost (half-up per line); transfer values use the cost at
  dispatch.
- **BR-129** Access: sales reports need `reports.sales`; payments, cash and shift reports
  need `reports.financial`; inventory and purchasing reports need `reports.inventory`;
  each for the branches in the report. Branch managers see only their branches; the
  default cashier role has no report access.

## 4. Money — Confirmed

- **BR-030** Default currency is **KWD** with **3 decimal places** (1 KWD = 1000 fils).
- **BR-031** No floating-point arithmetic for monetary calculations, anywhere.

## 5. Money — Default (engineering)

- **BR-032** Amounts are computed and stored as integer minor units.
- **BR-033** Rounding mode for computed amounts (percentage discounts, tax):
  **half-up** to the currency's minor unit, applied per line, then summed.
- **BR-034** Sales, payments and refunds are never edited or deleted; corrections
  are compensating records (void/refund) with audit trail.
- **BR-035** A refund can never exceed the remaining refundable amount of the
  original sale.

## 6. Open business questions (need owner decision before the related slice)

| Id     | Question                                                                 | Needed for          |
|--------|--------------------------------------------------------------------------|---------------------|
| OQ-001 | ~~Languages~~ Arabic + English confirmed (BR-016). Still open: which is the **default** for new merchants? (engineering default: Arabic) | M0 UI shells |
| OQ-002 | Tax: Kuwait currently has no VAT. Should tax be configurable from day 1 (for future VAT / GCC tenants)? | Sales slice |
| OQ-003 | Cash rounding: should cash totals be rounded (e.g. to 0.005 KWD)?        | Sales/payments      |
| OQ-004 | Will tenants operate in currencies other than KWD (multi-currency per tenant or per branch)? | Catalog/sales |
| OQ-005 | Does the POS need to work offline (network outage) and sync later?      | POS architecture    |
| OQ-006 | Employee POS login: email + password (implemented default) — add quick PIN switching on shared terminals? | POS |
| OQ-007 | Is the BR-033 rounding rule (half-up per line) acceptable?              | Sales slice         |
| OQ-008 | ~~Subscription plans~~ **Resolved:** plans and limits implemented (Prompt 17); billing remains open in OQ-022. | — |
| OQ-009 | Receipt requirements (printer types, legal fields, e-receipts)?         | Sales slice         |
| OQ-010 | ~~Merchant sign-up~~ **Resolved:** self-service owner registration (Prompt 4, BR-040). | — |
| OQ-011 | Hosting provider, region and data residency (Kuwait / GCC requirements?) — affects cost | Deployment |
| OQ-012 | Number display: Latin digits (0-9) or Arabic-Indic (٠-٩) by default? (engineering default: Latin, configurable) | M0 UI |
| OQ-014 | Costing method: weighted average (implemented default) or FIFO required for accounting? | Reports / accounting |
| OQ-015 | Blind closing: should cashiers count the drawer without seeing the expected amount first? (implemented: expected is shown) | POS shifts |
| OQ-016 | Should card processing fees be reversed on refunds (depends on the acquirer contract)? Implemented: not reversed. | Refunds / reports |
| OQ-017 | Returns without a receipt or at another branch: allowed? Implemented: receipt required, same branch. | Refunds |
| OQ-019 | Loyalty points, store credit and promotions: rules (earning rate, expiry, use as payment)? Also: should customers be able to request erasure of their personal data (anonymisation while keeping sales)? Not implemented. | Customers |
| OQ-020 | Restaurant: service charge or tips? Courses/fire timing? Printing tickets on kitchen printers (vs. screen)? Table reservations? Not implemented. | Restaurant |
| OQ-023 | Restaurant bills: charge the item price at ordering time or at payment time? Implemented: modifiers at ordering, item at payment (audit F3). | Restaurant |
| OQ-024 | Discount limit: per discount (implemented: item and sale discounts checked separately, so 10 % + 10 % passes) or combined? | Sales |
| OQ-026 | Actual processing fees per method (KNET, Visa/Mastercard, payment link, WAMD) and which bank account each settles into. Defaults: no fees; KNET, link and WAMD → bank 1, Visa/Mastercard → bank 2. Cash custody is decided (ADR-0090, ADR-0091). | Payments |
| OQ-025 | Verify the owner's e-mail at self-registration (blocks squatting someone's address)? Not implemented. | Auth |
| OQ-022 | Subscription pricing and billing: prices per plan, billing provider, invoices/VAT, what happens automatically when a subscription lapses (grace period, read-only, suspension), and data retention after closing? Implemented: no billing, lapse never blocks, closing keeps data. | Platform |
| OQ-021 | Online store: which gateway(s) first and the merchant contracts/credentials; delivery zones and fees per area; shopper accounts, coupons, scheduled orders; cash on delivery; automatic gateway refunds? Not implemented. | Online store |
| OQ-018 | Supplier invoices, payments and balances (accounts payable) and returns to suppliers: needed, and with which payment terms? Not implemented yet. | Purchasing |
| OQ-013 | Card payments: manual entry of card amount only, or integrated card terminals (e.g. KNET)? | M4 / later |
