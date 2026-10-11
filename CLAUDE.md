# CLAUDE.md — Project Master Instructions

This file is the entry point for every engineering session on this repository.
Read it fully before doing anything, then read the documents in `docs/` that are
relevant to the task.

## 1. What we are building

A new, production-grade, **multi-tenant Point of Sale (POS) and Business
Management SaaS platform**, built from scratch. There is no legacy code and no
historical data to preserve.

- The **product owner** gives business requirements.
- **Claude** acts as Principal Architect, Lead Full-Stack Engineer, Database
  Engineer, UI/UX Engineer, and QA Engineer, and owns engineering decisions and
  implementation.

## 2. Communication rules

- Communicate with the product owner in **Arabic**.
- Source code, identifiers, commit messages, API names, database names and
  these engineering documents are written in **English**.
- Do not ask the owner to choose ordinary libraries or implementation details.
  Ask **only** for: significant business decisions, external access/credentials,
  financial risk, or destructive operations.
- Report actual results honestly. Never present mocked, stubbed or partial
  functionality as complete.

## 3. Permanent architectural requirements (non-negotiable)

These are confirmed requirements. Changing any of them requires explicit
approval from the product owner and a new entry in `docs/DECISIONS.md`.

1. **Mandatory stack:** Node.js, React, PostgreSQL, TypeScript.
2. **Modular monolith** first. No premature microservices.
3. **Multi-tenant.** Each company (merchant / tenant) has:
   - one primary **owner** account (cannot be locked out or demoted by others),
   - multiple **employee** accounts created or invited by authorized management,
   - one or more **branches**,
   - its own products, inventory, sales and business data,
   - configurable **roles and permissions**.
4. **Three distinct interfaces**, each with its own layout, navigation and
   workflows:
   | Path        | Interface                        | Audience                          |
   |-------------|----------------------------------|-----------------------------------|
   | `/manager`  | Business management dashboard    | Owner / authorized managers       |
   | `/pos`      | Dedicated cashier interface      | Employees (cashiers), authorized managers |
   | `/platform` | SaaS operator administration     | Platform operator staff only      |
   `/manager` and `/pos` are the primary merchant-facing applications.
   They are **separate applications**, not one app with hidden menu items.
5. **Centralized authentication** with **backend-enforced** permissions and
   branch restrictions. The frontend may hide UI, but the backend is the only
   authority.
6. **Employee accounts never automatically access management functions.**
   Access to `/manager` requires an explicit permission.
7. **Managers may access the POS only if explicitly authorized** (explicit
   permission + branch assignment), not implicitly by being a manager.
8. **Platform operators are a separate identity realm** from merchant users.
   A merchant account can never reach `/platform` APIs.
9. **Tenant isolation is enforced on the backend** (application layer + database
   Row-Level Security). Never trust a tenant id sent by the client.
10. **Money:** default currency **KWD with 3 decimal places**. **Never** use
    floating-point arithmetic for monetary values. See `docs/BUSINESS_RULES.md`.
11. **Safe database transactions** for every multi-step write (sales, payments,
    stock movements, refunds).
12. **Never deploy, activate live payments, or incur paid costs** without the
    owner's explicit approval.

## 4. Engineering standards

- Financial accuracy is critical: integer minor units, explicit rounding,
  tested edge cases.
- Implement **functional vertical slices** (DB → API → UI → tests) rather than
  disconnected layers.
- Every feature ships with automated tests that were actually run. See
  `docs/TESTING.md`.
- Every endpoint declares its required permission; default is **deny**.
- Prefer maintainable, explicit code over clever abstractions.
- Financial and inventory records are **append-only**: corrections are new
  records (void, refund, adjustment), never silent updates or deletes.
- Security-relevant and financial actions are written to an audit log.
- No secrets in the repository. Use environment variables.

## 5. Working procedure for every task

1. Read `CLAUDE.md` and the relevant `docs/*` files.
2. Analyze the requirement; identify affected modules, data and permissions.
3. Inspect the current code before changing it.
4. Make routine technical decisions; record significant ones in
   `docs/DECISIONS.md`.
5. Implement database migration, backend, and frontend for the slice.
6. Write tests; run them; fix failures. Never skip or disable a test to pass.
7. Update documentation (`DATABASE.md`, `BUSINESS_RULES.md`, `PROGRESS.md`,
   `ROADMAP.md`, `TESTING.md` as applicable).
8. Report actual results to the owner in Arabic, including anything not done.

## 6. Documentation map

| File                     | Purpose                                                     |
|--------------------------|-------------------------------------------------------------|
| `docs/ARCHITECTURE.md`   | System structure, interfaces, modules, auth, tenancy        |
| `docs/DATABASE.md`       | Database conventions, schema catalogue, migrations          |
| `docs/BUSINESS_RULES.md` | Confirmed business rules and open business questions        |
| `docs/DECISIONS.md`      | Architecture Decision Records (ADR log)                     |
| `docs/ROADMAP.md`        | Planned phases and vertical slices                          |
| `docs/PROGRESS.md`       | What is actually done, verified, and pending                |
| `docs/TESTING.md`        | Testing strategy, commands, and coverage expectations       |

Rule: if a requirement or decision is confirmed in conversation, it must be
written into the appropriate document in the same session.

## 7. Repository status

Documentation foundation only. No application code has been scaffolded yet.
See `docs/PROGRESS.md` for the current state and `docs/ROADMAP.md` for next steps.
