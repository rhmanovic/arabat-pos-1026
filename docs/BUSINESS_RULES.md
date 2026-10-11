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

## 3. Access rules — Default (engineering)

- **BR-020** The owner always has full access to all branches and both merchant
  interfaces; the owner cannot be removed, demoted or deactivated by another
  tenant user. Ownership transfer is an explicit, audited action.
- **BR-021** Non-owner users only see and act on branches they are assigned to.
- **BR-022** A POS session operates on exactly one branch at a time.
- **BR-023** Deactivating a user immediately revokes all their sessions.

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
| OQ-001 | UI languages: Arabic + English with RTL? Which is the default?          | First UI slice      |
| OQ-002 | Tax: Kuwait currently has no VAT. Should tax be configurable from day 1 (for future VAT / GCC tenants)? | Sales slice |
| OQ-003 | Cash rounding: should cash totals be rounded (e.g. to 0.005 KWD)?        | Sales/payments      |
| OQ-004 | Will tenants operate in currencies other than KWD (multi-currency per tenant or per branch)? | Catalog/sales |
| OQ-005 | Does the POS need to work offline (network outage) and sync later?      | POS architecture    |
| OQ-006 | Employee POS login: email + password, or quick PIN switching on a shared terminal? | POS auth slice |
| OQ-007 | Is the BR-033 rounding rule (half-up per line) acceptable?              | Sales slice         |
| OQ-008 | Subscription plans / billing for tenants: in scope, and when?           | Platform slice      |
| OQ-009 | Receipt requirements (printer types, legal fields, e-receipts)?         | Sales slice         |
| OQ-010 | Tenant sign-up: self-service, or created only by platform operators?    | Platform/tenancy    |
