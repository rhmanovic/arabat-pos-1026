# Application Routing Structure

Status: **Designed. Not yet implemented.** Each SPA uses React Router (data
mode, `createBrowserRouter`) with its own `basename`, lazy-loaded feature
routes, and a route-level `RequirePermission` guard (UX only — the API is the
authority). Feature-gated routes (restaurant, e-commerce) render only if the
subscription includes the feature.

Legend: 🔓 public · 🔑 permission required · 🧩 feature-gated · ⏳ later milestone

---

## 1. `/manager` — manager-web

Implemented screens (Prompt 6): `/` dashboard, `/settings` company profile,
`/branches`, `/employees`, `/employees/:membershipId`, `/roles`, plus
`/login`, `/register`, `/forgot-password`, `/reset-password`, `/accept-invite`.
Modules not built yet (products, inventory, sales, payments, purchasing, suppliers,
reports, customers) appear in the sidebar **disabled with "Not available yet"**,
never as working pages. Sidebar items are hidden without the required permission;
every page is additionally wrapped in `RequirePermission` and every API call is
enforced server-side.

Planned table (status per milestone):

| Route | Screen | Permission | Milestone |
|---|---|---|---|
| `/manager/login` | Sign in | 🔓 | M1 |
| `/manager/select-merchant` | Choose company (multi-membership users) | session | M1 |
| `/manager/accept-invite/:token` | Accept invitation, set password | 🔓 | M1 |
| `/manager/forgot-password`, `/manager/reset-password/:token` | Password reset | 🔓 | M1 |
| `/manager` | Dashboard (KPIs for accessible branches) | `manager.access` | M1 (shell), M7 (KPIs) |
| `/manager/branches`, `/manager/branches/:id` | Branches | `branches.read` | M1 |
| `/manager/staff`, `/manager/staff/:membershipId` | Employees, invitations, role assignments per branch | `users.read` | M1 |
| `/manager/roles`, `/manager/roles/:id` | Roles & permission matrix | `roles.read` | M1 |
| `/manager/catalog/products`, `/manager/catalog/products/:id` | Products & variants, barcodes | `catalog.read` | M2 |
| `/manager/catalog/categories` | Categories | `catalog.read` | M2 |
| `/manager/catalog/prices` | Branch price lists | `catalog.prices.manage` | M2 |
| `/manager/catalog/taxes` | Tax rates | `catalog.manage` | M2 |
| `/manager/inventory` | Stock on hand per branch | `inventory.read` | M3 |
| `/manager/inventory/adjustments`, `/new` | Adjustments | `inventory.adjust` | M3 |
| `/manager/inventory/transfers`, `/:id` | Branch transfers | `inventory.transfer` | M3 |
| `/manager/registers` | Registers per branch | `registers.manage` | M4 |
| `/manager/shifts`, `/manager/shifts/:id` | Shift history, X/Z reports | `shifts.view_all` | M4 |
| `/manager/sales`, `/manager/sales/:id` | Sales history & receipt | `sales.read` | M4 |
| `/manager/orders`, `/manager/orders/:id` | Orders (held/online/table) | `orders.manage` | M4 |
| `/manager/refunds`, `/manager/refunds/:id` | Refunds | `sales.read` | M5 |
| `/manager/customers`, `/manager/customers/:id` | Customers | `customers.read` | M5 |
| `/manager/purchasing/suppliers` | Suppliers | `suppliers.manage` | M6 |
| `/manager/purchasing/orders`, `/:id` | Purchase orders | `purchase_orders.manage` | M6 |
| `/manager/purchasing/receipts/:id` | Goods receipt | `goods.receive` | M6 |
| `/manager/reports/sales`, `/inventory`, `/shifts`, `/payments` | Reports | `reports.*` | M7 |
| `/manager/restaurant/tables`, `/modifiers` | 🧩 Restaurant setup | `catalog.manage` | M9 |
| `/manager/ecommerce/store`, `/listings` | 🧩 Online store | `catalog.manage` | M10 |
| `/manager/settings/company` | Company profile, language, timezone | `merchant.settings.read` | M1 |
| `/manager/settings/payment-methods` | Payment methods | `payment_methods.manage` | M4 |
| `/manager/settings/receipts` | Receipt layout | `merchant.settings.update` | M4 |
| `/manager/settings/subscription` | Current plan (read-only) | `subscription.read` | M8 |
| `/manager/audit-log` | Audit log | `audit.read` | M1 |
| `/manager/account` | My profile, language, password | session | M1 |

Layout: persistent sidebar (start side; flips with `dir`), top bar with branch
switcher, language toggle, user menu.

---

## 2. `/pos` — pos-web

| Route | Screen | Permission | Milestone |
|---|---|---|---|
| `/pos/login` | Sign in (large touch keypad; PIN mode later) | 🔓 | M1 |
| `/pos/setup` | Select branch (only those with `pos.access`) & register | `pos.access` | M1 (branch), M4 (register) |
| `/pos/shift/open` | Open shift, opening float | `shifts.open` | M4 |
| `/pos/sell` | **Register screen**: search/scan, product grid, cart, pay panel | `sales.create` | M4 |
| `/pos/sell/pay` | Payment (cash keypad, card, split) — modal route | `sales.create` | M4 |
| `/pos/receipt/:saleId` | Receipt / reprint | `sales.create` | M4 |
| `/pos/orders` | Held carts / open orders | `orders.create` | M4 |
| `/pos/sales` | This shift's sales | `sales.create` | M4 |
| `/pos/refund` | Find sale → select lines → refund | `refunds.create` or override | M5 |
| `/pos/customers` | Quick customer lookup/create | `customers.read` | M5 |
| `/pos/cash` | Cash in / cash out | `cash.move` | M4 |
| `/pos/shift/close` | Count drawer, close shift, Z summary | `shifts.close` | M4 |
| `/pos/tables` | 🧩 Floor plan / open tabs | `orders.create` | M9 |
| `/pos/kitchen` | 🧩 Kitchen display | `orders.manage` | M9 |
| `/pos/lock` | Lock screen (idle) | session | M1 |

Layout: full-screen, no sidebar; top strip with branch/register/shift, cashier,
language toggle, lock button. Override dialog (manager approval) is a global
modal available on any POS route.

---

## 3. `/platform` — platform-web

| Route | Screen | Permission | Milestone |
|---|---|---|---|
| `/platform/login`, `/platform/mfa` | Sign in + TOTP | 🔓 | M1 |
| `/platform` | Overview (merchant counts, health) | operator | M1 / M8 |
| `/platform/merchants`, `/new`, `/:id` | Merchant list, create (with owner invite), detail, suspend | `platform.super_admin` / `platform.support` | M1 |
| `/platform/plans`, `/:id` | Plans & features | `platform.billing` | M8 |
| `/platform/subscriptions` | Merchant subscriptions | `platform.billing` | M8 |
| `/platform/operators` | Operator accounts | `platform.super_admin` | M1 |
| `/platform/audit` | Platform audit log | `platform.super_admin` | M1 |
| `/platform/system` | System status | operator | M8 |

---

## 4. Implemented management API (Prompt 5)

| Method & path | Permission |
|---|---|
| `GET/POST /manager/branches`, `GET/PATCH /manager/branches/:id`, `POST /manager/branches/:id/status` | `branches.read` / `branches.manage` / `branches.update` |
| `GET /manager/permissions`, `GET /manager/roles` | `employees.read` |
| `POST /manager/roles`, `PATCH/DELETE /manager/roles/:id` | `roles.manage` |
| `GET /manager/employees`, `GET /manager/employees/:membershipId` | `employees.read` |
| `POST /manager/employees/invitations`, `…/:id/resend`, `…/:id/revoke` | `employees.manage` |
| `PATCH /manager/employees/:id`, `POST …/:id/status`, `PUT …/:id/assignments`, `POST …/:id/password-reset` | `employees.manage` |
| `POST /auth/invitations/preview`, `POST /auth/invitations/accept` | public (token) |
| `POST /auth/pos/switch-branch` | POS session |

### Catalog API (Prompt 7)

| Method & path | Permission |
|---|---|
| `GET /manager/categories` | `catalog.read` |
| `POST /manager/categories`, `PATCH /manager/categories/:id`, `POST …/:id/status` | `catalog.manage` |
| `GET /manager/products?q=&categoryId=&status=&branchId=&sort=&page=` , `GET /manager/products/:id` | `catalog.read` |
| `POST /manager/products`, `PATCH /manager/products/:id`, `POST …/:id/status` | `catalog.manage` (+ `catalog.prices.manage` to set prices/costs or add variants) |
| `POST /manager/products/:id/images` (multipart), `DELETE …/images/:imageId` | `catalog.manage` |
| `GET /manager/products/:id/images/:imageId` | `catalog.read` |
| `GET /pos/catalog` (ETag / 304) , `GET /pos/catalog/images/:productId/:imageId` | `pos.access` at the bound branch |

Manager screens: `/manager/products` (search, filters, sort, pagination),
`/manager/products/new`, `/manager/products/:id` (editor with variants, barcodes,
branch availability, images, archive), `/manager/categories`.

### Inventory API (Prompt 8)

| Method & path | Permission |
|---|---|
| `GET /manager/inventory/levels?branchId=&q=&categoryId=&stock=all\|low\|out\|in_stock&sort=&page=` | `inventory.read` (branch, or all readable branches aggregated) |
| `GET /manager/inventory/summary?branchId=` | `inventory.read` |
| `GET /manager/inventory/variants/:variantId` | `inventory.read` (per readable branch) |
| `PUT /manager/inventory/thresholds` | `inventory.adjust` at the branch |
| `GET /manager/inventory/movements?branchId=&variantId=&type=&from=&to=&page=` | `inventory.read` |
| `GET /manager/inventory/adjustments`, `GET /manager/inventory/adjustments/:id` | `inventory.read` |
| `POST /manager/inventory/adjustments` | `inventory.adjust` at the branch (+ `catalog.prices.manage` to enter unit costs) |
| `GET /manager/inventory/settings` / `PUT …/settings` | `inventory.read` / `merchant.settings.update` |
| `GET /pos/inventory/availability?variantIds=` | POS `catalog.read` at the bound branch (no costs) |

Costs and values appear only with `catalog.prices.manage` or `reports.inventory` for every
branch in the result.

Manager screens: `/manager/inventory` (stock list, summary cards, threshold dialog,
per-branch breakdown, settings dialog), `/manager/inventory/adjustments`,
`/manager/inventory/adjustments/new`, `/manager/inventory/adjustments/:id`,
`/manager/inventory/movements`.

## 5. API namespaces (backend)

| Prefix | Consumers | Notes |
|---|---|---|
| `/api/v1/health` | infra | 🔓 |
| `/api/v1/auth/manager/*`, `/auth/pos/*`, `/auth/platform/*`, `/auth/password/*`, `/auth/invitations/*` | all apps | Centralized `AuthService` |
| `/api/v1/manager/<module>/*` | manager-web | `manager.access` + per-route permission + branch |
| `/api/v1/pos/<module>/*` | pos-web | `pos.access` + permission; branch from POS session |
| `/api/v1/platform/<module>/*` | platform-web | operator realm |
| `/api/v1/public/*` | ⏳ storefront (M10) | not in scope yet |

Example — the same `SalesService` behind two adapters:
- `POST /api/v1/pos/sales` (create sale in the bound branch/shift)
- `GET  /api/v1/manager/sales?branchId=&from=&to=` (history, filtered to accessible branches)

## 5. Serving & URLs
- Production: one origin; the proxy serves `/manager/*`, `/pos/*`,
  `/platform/*` from each app's static build with SPA fallback to that app's
  `index.html`, and forwards `/api/*` to the API.
- `/` redirects to `/manager` (marketing site is out of scope).
