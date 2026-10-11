# Roadmap

Delivery is organized as **functional vertical slices**: each slice includes DB
migration, backend, frontend, tests and documentation, and is only marked done
when its tests pass. Order may change based on owner priorities.

## Phase 0 — Foundation
- [x] 0.1 Project instructions and documentation structure
- [ ] 0.2 Monorepo scaffold (pnpm workspaces, TypeScript strict, ESLint/Prettier)
- [ ] 0.3 API skeleton (NestJS + Fastify), health endpoint, config, error format
- [ ] 0.4 PostgreSQL connection, migration tooling, `app_runtime` role, RLS helper
- [ ] 0.5 Three SPA shells (`/manager`, `/pos`, `/platform`) with distinct layouts
- [ ] 0.6 `packages/money` with full unit tests (KWD 3 decimals)
- [ ] 0.7 Test infrastructure (Vitest, DB tests, Playwright) and CI workflow

## Phase 1 — Identity, tenancy and access
- [ ] 1.1 Tenants and owner account (creation path per OQ-010)
- [ ] 1.2 Centralized login/logout/session for manager and POS
- [ ] 1.3 Branches CRUD (manager)
- [ ] 1.4 Roles & permissions management (manager)
- [ ] 1.5 Employee invitation / creation, branch assignment
- [ ] 1.6 POS login with branch selection; access denied without `pos.access`
- [ ] 1.7 Platform operator login and tenant list/suspend
- [ ] 1.8 Audit log for security events
- [ ] 1.9 Tenant-isolation and authorization test suite

## Phase 2 — Catalog
- [ ] Categories, products, variants, barcodes/SKU, branch prices

## Phase 3 — Inventory
- [ ] Stock ledger, opening stock, adjustments, branch transfers, low-stock

## Phase 4 — Sales (POS core)
- [ ] Cart, discounts, cash/card tenders (no live gateway), receipts
- [ ] Voids and refunds with permissions; shift/cash drawer sessions

## Phase 5 — Reporting
- [ ] Sales by day/branch/employee/product, inventory valuation

## Later / to be decided
- Offline POS (OQ-005), customers & loyalty, purchasing & suppliers, tax/VAT
  (OQ-002), subscriptions & billing (OQ-008), integrations, deployment
  (requires owner approval).
