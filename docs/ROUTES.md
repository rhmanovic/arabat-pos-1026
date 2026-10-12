# Application Routing Structure

Status: **Implemented routes are marked ✓; others are designed only.** Each SPA uses React Router (data
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
Modules not built yet appear in the sidebar **disabled with "Not available yet"** (none at present),
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
| `/manager/transfers`, `/new`, `/:id` | Branch transfers | `inventory.transfer` or `inventory.transfer.approve` | M3 ✓ |
| `/manager/registers` | Registers per branch | `registers.manage` | M4 |
| `/manager/shifts`, `/manager/shifts/:id` | Shift history, X/Z reports | `shifts.view_all` | M4 |
| `/manager/sales`, `/manager/sales/:id` | Sales history & receipt | `sales.read` | M4 |
| `/manager/orders`, `/manager/orders/:id` | Orders (held/online/table) | `orders.manage` | M4 |
| `/manager/refunds`, `/manager/refunds/:id` | Refunds | `sales.read` | M5 |
| `/manager/customers`, `/manager/customers/:id` | Customers, profile, history, notes | `customers.read` | M5 ✓ |
| `/manager/suppliers` | Suppliers | `purchasing.read` | M6 ✓ |
| `/manager/purchasing`, `/new`, `/:id` | Purchase orders, receiving | `purchasing.read` | M6 ✓ |
| `/manager/purchasing/receipts/:id` | Goods receipt | `goods.receive` | M6 |
| `/manager/reports` | Reports dashboard (tabs per permission) | any `reports.*` | M7 ✓ |
| `/manager/restaurant/tables`, `/modifiers` | 🧩 Restaurant setup | `catalog.manage` | M9 |
| `/manager/online` | Online store: orders (status filter, detail, fulfilment steps, cancel unpaid), store settings (status, address, branding, fulfilment, fees, reservation time, payment methods), products online | `online.orders` / `online.manage` | M10 ✓ |
| `/manager/subscription` | Own plan, status, usage vs limits, available plans | `merchant.settings.read` | M8 ✓ |
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
| (sale screen) | Customer picker on the cart: search, choose, create, walk-in | `customers.read` / `customers.create` | M5 ✓ |
| `/pos/cash` | Cash in / cash out | `cash.move` | M4 |
| `/pos/shift/close` | Count drawer, close shift, Z summary | `shifts.close` | M4 |
| `/pos/tables` | 🧩 Floor plan / open tabs | `orders.create` | M9 |
| `/pos/kitchen` | 🧩 Kitchen display | `orders.manage` | M9 |
| `/pos/lock` | Lock screen (idle) | session | M1 |

Layout: full-screen, no sidebar; top strip with branch/register/shift, cashier,
language toggle, lock button. Override dialog (manager approval) is a global
modal available on any POS route.

---

## 2b. `/store` — store-web (public storefront, Prompt 16)

No session; every call goes to the public store API. Cart kept per store in the browser.

| Route | Screen |
|---|---|
| `/store/:slug` | Catalog (search, categories, sold-out badges) |
| `/store/:slug/products/:productId` | Product details, options, quantity, add to cart |
| `/store/:slug/cart` | Cart (exact totals, minimum order, sold-out items removed) |
| `/store/:slug/checkout` | Contact, pickup/delivery, address, payment method, summary |
| `/store/:slug/orders/:token` | Order tracking (status, history, pay link while unpaid) |
| `/store/pay/:reference` | Sandbox gateway page (mock adapter only) |

## 3. `/platform` — platform-web

| Route | Screen | Permission | Milestone |
|---|---|---|---|
| `/platform/login`, `/platform/mfa` | Sign in + TOTP | 🔓 | M1 |
| `/platform` | Overview (merchant counts by status, trials ending, lapsed, usage, plans, newest) | any operator | M8 ✓ |
| `/platform/merchants` | List, search, status filter, create merchant (dialog) | any operator (create: super admin, support) | M8 ✓ |
| `/platform/merchants/:id` | Profile, owner, onboarding, usage vs limits, branches, subscription (change with readiness check), history, platform actions; suspend / reactivate / close | any operator (actions per role) | M8 ✓ |
| `/platform/plans` | Plans with limits, features, informational price; create / edit | any operator (edit: super admin, billing) | M8 ✓ |
| `/platform/audit` | Platform audit log | super admin, support | M8 ✓ |
| `/platform/operators` | Operator accounts | — | CLI only (AUTH.md §8) |

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

### Payments, registers and shifts API (Prompt 9)

| Method & path | Permission |
|---|---|
| `GET/POST /manager/payment-methods`, `PATCH /manager/payment-methods/:id` | `payments.settings` |
| `GET/POST /manager/financial-accounts`, `PATCH /manager/financial-accounts/:id` | `payments.settings` |
| `GET /manager/registers?branchId=`, `POST /manager/registers`, `PATCH /manager/registers/:id`, `POST …/:id/status` | `registers.manage` at the branch |
| `GET /manager/shifts?branchId=&status=&outcome=&from=&to=`, `GET /manager/shifts/:id` | `shifts.view_all` (branch-scoped) |
| `GET /manager/shifts/discrepancies?branchId=&from=&to=` | `shifts.view_all` |
| `POST /manager/shifts/:id/force-close` | `registers.manage` at the shift's branch (note required) |
| `GET /pos/payment-methods` | POS `sales.create` (active POS methods, no fees) |
| `GET /pos/registers`, `GET /pos/shifts/current`, `POST /pos/shifts`, `POST /pos/shifts/current/close` | POS `shifts.operate` at the bound branch + register access |
| `POST /pos/shifts/current/cash-movements` | POS `cash.move` (own open shift) |

Screens: `/manager/payments` (methods + internal balances, fee preview),
`/manager/registers`, `/manager/shifts` (monitoring + discrepancy report tab),
`/manager/shifts/:id` (detail, force close); POS `/pos/` shows "Open a shift" until a
shift is open, then the sale screen with a shift strip; `/pos/shift` (expected cash,
cash in/out, close with optional note/coin count, closing result).

### Checkout API (Prompt 10)

| Method & path | Permission |
|---|---|
| `POST /pos/sales` (checkout, idempotency key) | POS `sales.create`, own open shift; `sales.discount`, `sales.discount.override_limit`, `sales.price_override` as needed |
| `GET /pos/sales/recent`, `GET /pos/sales/:id/receipt`, `GET /pos/sales/settings` | POS `sales.create` (session branch only) |
| `POST /pos/orders` (hold), `GET /pos/orders/suspended`, `POST /pos/orders/:id/cancel` | POS `sales.create` |
| `GET /manager/sales?branchId=&q=&from=&to=`, `GET /manager/sales/:id`, `GET …/:id/receipt` | `sales.read` (branch-scoped) |
| `GET/PUT /manager/sales-settings` | `merchant.settings.read` / `merchant.settings.update` |

Screens: POS `/pos/` is the sale screen (search/scan box with Enter, category chips,
product tiles with stock badges, cart with line editing — quantity, discount, price
override by permission — order discount, hold/resume, recent sales, payment dialog with
split payments, cash tendered/change, receipt with 80 mm printing).
Manager `/manager/sales` (list, filters, totals, selling policy) and `/manager/sales/:id`.

### Returns API (Prompt 11)

| Method & path | Permission |
|---|---|
| `GET /pos/refunds/lookup?receipt=`, `POST /pos/refunds/preview`, `POST /pos/refunds`, `GET /pos/refunds/:id/receipt`, `POST /pos/refunds/:id/cancel` | POS `refunds.create` (own open shift for writes) |
| `POST /pos/exchanges` | POS `refunds.create` + `sales.create` |
| `POST /pos/sales/:id/void` | POS `sales.void` (sale of the own open shift, no refunds yet) |
| `POST /pos/refunds/:id/approve` | POS `refunds.approve` (supervisor at the till; not the requester) |
| `GET /manager/refunds`, `GET /manager/refunds/:id`, `GET /manager/refunds/activity` | `sales.read` (branch-scoped) |
| `POST /manager/refunds/:id/approve`, `POST /manager/refunds/:id/reject` | `refunds.approve` at the refund's branch |

Screens: POS `/pos/returns` (find by receipt or recent sale, quantities per line, restock
toggle, reason, live refund preview with pay-back allocation, refund / exchange with new
items and difference / cancel sale, printable refund receipt). Manager `/manager/refunds`
(history with filters, waiting-for-approval with approve/reject, unusual activity per
employee); sale detail shows refunded amount; selling policy has return window and
approval limit.

### Restaurant API (Prompt 15)

| Method & path | Permission |
|---|---|
| `GET /manager/restaurant/settings` | any manager session; `PUT` needs merchant-wide `restaurant.manage` |
| `GET /manager/restaurant/layout?branchId=`, `POST/PUT /manager/restaurant/areas`, `/tables`, `/stations` | `restaurant.manage` at the branch |
| `GET /manager/restaurant/menu`, `PUT /manager/restaurant/menu/:productId`, `POST/PUT /manager/restaurant/modifier-groups` | merchant-wide `restaurant.manage` (menu read: any) |
| `GET /pos/restaurant/settings` | POS session |
| `GET /pos/restaurant/menu`, `GET /pos/restaurant/floor`, `POST /pos/restaurant/orders`, `GET /pos/restaurant/orders/:id` | POS `restaurant.orders` (module enabled) |
| `POST /pos/restaurant/orders/:id/items`, `/send`, `/move`, `/merge`, `/cancel`, `/quote`, `/items/:itemId/cancel` | POS `restaurant.orders` (sent items: `restaurant.void_item`) |
| `POST /pos/restaurant/orders/:id/pay` | POS `sales.create` + `restaurant.orders`, own open shift, idempotent |
| `GET /pos/kitchen/tickets?stationId=`, `POST /pos/kitchen/tickets/:id/status` | POS `kitchen.access` |

Screens: manager `/manager/restaurant` (Setup: module switch and stock policy; Tables &
stations per branch; Modifiers; Menu with groups and recipes). POS `/pos/tables` (floor by
area with open-order totals and kitchen badges, takeaway/pickup queue),
`/pos/tables/orders/:id` (menu, modifier dialog with required/optional groups and note,
items with kitchen status, send, cancel/waste, move, combine, split bill → payment →
receipt), `/pos/kitchen` (station filter, New / Preparing / Ready columns, timers). Kitchen-
only staff land on `/pos/kitchen`. Sales list and reports show the service type.

### Platform and subscription API (Prompt 17)

| Method & path | Platform role |
|---|---|
| `GET /platform/overview`, `GET /platform/merchants?q=&status=&page=`, `GET /platform/merchants/:id`, `GET /platform/merchants/:id/plan-check?planId=`, `GET /platform/plans` | any operator |
| `POST /platform/merchants`, `POST /platform/merchants/:id/status` (close: super admin only), `GET /platform/audit?merchantId=&action=` | super admin, support |
| `PUT /platform/merchants/:id/subscription`, `POST /platform/plans`, `PUT /platform/plans/:id` | super admin, billing |
| `GET /manager/subscription` | merchant `merchant.settings.read` (own merchant only) |

### Online store API (Prompt 16)

| Method & path | Permission |
|---|---|
| `GET/PUT /manager/online/store`, `GET/PUT /manager/online/listings`, `POST /manager/online/reconcile` | merchant-wide `online.manage` |
| `GET /manager/online/orders?status=`, `GET /manager/online/orders/:id`, `POST /manager/online/orders/:id/action` | `online.orders` (branch of the order) |
| `GET /store/:slug`, `/products`, `/products/:id`, `/images/:productId/:imageId` | 🔓 published or paused store |
| `POST /store/:slug/checkout` | 🔓 published store; idempotency key; 30 per 10 min per IP |
| `GET /store/:slug/orders/:token` | 🔓 tracking token |
| `POST /webhooks/payments/:provider` | 🔓 provider signature (raw body) |
| `GET/POST /payments/mock/:reference` | 🔓 sandbox only (disabled in production by default) |

### Reports API (Prompt 14)

All take `from`, `to` (local dates, ≤ 366 days), optional `branchId` (checked against the
permission and the merchant) and, where it applies, `employeeId` (membership).

| Method & path | Permission |
|---|---|
| `GET /manager/reports/sales` | `reports.sales` (profit only with `reports.financial` for the whole scope) |
| `GET /manager/reports/payments` | `reports.financial` |
| `GET /manager/reports/shifts` | `reports.financial` |
| `GET /manager/reports/inventory` | `reports.inventory` |
| `GET /manager/reports/purchasing` | `reports.inventory` |

Screen: `/manager/reports` — tabs per permission (Sales, Payments & cash, Shifts,
Inventory, Purchasing); period presets and custom dates, the top-bar branch context as
branch filter, employee filter; KPI cards with change vs the previous period; SVG charts
(trend by day, by hour, collections) with accessible tooltips; detailed tables with CSV
export; metric definitions on every tab.

### Customers API (Prompt 13)

| Method & path | Permission |
|---|---|
| `GET /manager/customers?q=&status=&sort=` | `customers.read` (any branch); stats scoped to the viewer's branches |
| `GET /manager/customers/:id`, `/:id/sales`, `/:id/refunds`, `/:id/notes` | `customers.read` |
| `POST /manager/customers` | `customers.create` |
| `PATCH /manager/customers/:id` (incl. status) | `customers.manage` |
| `POST /manager/customers/:id/notes` | `customers.manage` |
| `GET /pos/customers?q=` | POS `customers.read` at the branch (active only, basic fields) |
| `POST /pos/customers` | POS `customers.create` at the branch |
| `POST /pos/sales`, `POST /pos/orders` | optional `customerId` (needs `customers.read`) |

### Purchasing and transfers API (Prompt 12)

| Method & path | Permission |
|---|---|
| `GET /manager/suppliers` | `purchasing.read` |
| `POST /manager/suppliers`, `PATCH /manager/suppliers/:id` | `purchasing.manage` (merchant-wide) |
| `GET /manager/purchase-orders`, `GET /manager/purchase-orders/:id` | `purchasing.read` (branch-scoped) |
| `POST /manager/purchase-orders`, `PATCH /…/:id`, `POST /…/:id/submit`, `POST /…/:id/cancel` | `purchasing.manage` at the order's branch |
| `POST /manager/purchase-orders/:id/approve`, `POST /…/:id/close` | `purchasing.approve` at the branch (not the creator unless owner) |
| `POST /manager/purchase-orders/:id/receipts` | `purchasing.receive` at the branch (idempotent) |
| `GET /manager/transfers`, `GET /manager/transfers/:id` | `inventory.read` at source or destination |
| `POST /manager/transfers` | `inventory.transfer` at source or destination |
| `POST /manager/transfers/:id/approve` | `inventory.transfer.approve` at the source |
| `POST /manager/transfers/:id/cancel` | requester or approver, before dispatch |
| `POST /manager/transfers/:id/dispatch` | `inventory.transfer` at the source |
| `POST /manager/transfers/:id/receive` | `inventory.transfer` at the destination |

Screens: `/manager/suppliers` (list with order count and received value, create/edit,
history link), `/manager/purchasing` (filters by status/supplier, editor for drafts with
item search and exact totals, submit/approve/cancel/close, delivery dialog with
remaining quantities, delivery history), `/manager/transfers` (request with available
stock, approve, dispatch and receive dialogs, discrepancy note, missing quantity per line).

## 5. API namespaces (backend)

| Prefix | Consumers | Notes |
|---|---|---|
| `/api/v1/health` | infra | 🔓 |
| `/api/v1/auth/manager/*`, `/auth/pos/*`, `/auth/platform/*`, `/auth/password/*`, `/auth/invitations/*` | all apps | Centralized `AuthService` |
| `/api/v1/manager/<module>/*` | manager-web | `manager.access` + per-route permission + branch |
| `/api/v1/pos/<module>/*` | pos-web | `pos.access` + permission; branch from POS session |
| `/api/v1/platform/<module>/*` | platform-web | operator realm |
| `/api/v1/store/:slug/*` | store-web | 🔓 merchant resolved from the store address |
| `/api/v1/webhooks/payments/:provider`, `/api/v1/payments/mock/*` | gateways, sandbox page | 🔓 signature-checked / sandbox only |

Example — the same `SalesService` behind two adapters:
- `POST /api/v1/pos/sales` (create sale in the bound branch/shift)
- `GET  /api/v1/manager/sales?branchId=&from=&to=` (history, filtered to accessible branches)

## 5. Serving & URLs
- Production: one origin; the proxy serves `/manager/*`, `/pos/*`,
  `/platform/*`, `/store/*` from each app's static build with SPA fallback to that app's
  `index.html`, and forwards `/api/*` to the API.
- `/` redirects to `/manager` (marketing site is out of scope).
