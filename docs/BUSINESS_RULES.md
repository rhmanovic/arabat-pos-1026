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
  cash than the drawer is expected to hold.

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
- **BR-085** Held (suspended) sales reserve no stock; any cashier at the branch may resume
  or discard them; a held sale can be completed once.

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
| OQ-008 | Subscription plans / billing for tenants: in scope, and when?           | Platform slice      |
| OQ-009 | Receipt requirements (printer types, legal fields, e-receipts)?         | Sales slice         |
| OQ-010 | ~~Merchant sign-up~~ **Resolved:** self-service owner registration (Prompt 4, BR-040). | — |
| OQ-011 | Hosting provider, region and data residency (Kuwait / GCC requirements?) — affects cost | Deployment |
| OQ-012 | Number display: Latin digits (0-9) or Arabic-Indic (٠-٩) by default? (engineering default: Latin, configurable) | M0 UI |
| OQ-014 | Costing method: weighted average (implemented default) or FIFO required for accounting? | Reports / accounting |
| OQ-015 | Blind closing: should cashiers count the drawer without seeing the expected amount first? (implemented: expected is shown) | POS shifts |
| OQ-013 | Card payments: manual entry of card amount only, or integrated card terminals (e.g. KNET)? | M4 / later |
