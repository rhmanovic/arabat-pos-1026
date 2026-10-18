# Application Routing Structure

Status: the tables below list the implemented routes (verified against each app's
`routes.tsx`, Prompt 18). Each SPA uses React Router (data mode, `createBrowserRouter`)
with its own `basename` and a route-level `RequirePermission` guard (UX only — the API is
the authority). Routes are not lazy-loaded yet (recommended for the manager app). Plan
features (restaurant, online store) are enforced by the API (`PLAN_FEATURE_UNAVAILABLE`).

Legend: 🔓 public · 🔑 permission required · 🧩 feature-gated · ⏳ later milestone

---

## 1. `/manager` — manager-web

Public: `/login`, `/register`, `/forgot-password`, `/reset-password`, `/accept-invite`.
Every other route requires a manager session; each page is wrapped in `RequirePermission`
(UX only) and every API call is enforced server-side. Sidebar items are hidden without
the permission.

| Route | Screen | Permission (UI guard) |
|---|---|---|
| `/` | Dashboard | `manager.access` |
| `/products`, `/products/new`, `/products/:productId` | Products, editor (variants, barcodes, images, prices) | `catalog.read` / `catalog.manage` |
| `/categories` | Categories | `catalog.read` |
| `/inventory`, `/inventory/adjustments`, `/inventory/adjustments/new`, `/inventory/adjustments/:id`, `/inventory/movements`, `/inventory/returns` | Stock levels, adjustments, movement ledger, returned goods kept out of stock | `inventory.read` / `inventory.adjust` |
| `/transfers`, `/transfers/new`, `/transfers/:transferId` | Branch transfers | `inventory.read` / `inventory.transfer` |
| `/suppliers`, `/purchasing`, `/purchasing/new`, `/purchasing/:orderId` | Suppliers, purchase orders, receiving | `purchasing.read` / `purchasing.manage` |
| `/sales`, `/sales/:saleId` | Sales (POS + online, channel filter), detail and receipt | `sales.read` |
| `/refunds` | Returns history, approvals, unusual activity | `sales.read` |
| `/reports` | Reports (tabs per report permission: sales, payments & cash incl. cash by type, expenses, shifts, inventory, purchasing) | any `reports.*` |
| `/customers`, `/customers/:customerId` | Customers, history, notes | `customers.read` |
| `/restaurant` | Restaurant setup (module, floor, stations, modifiers, menu) | `restaurant.manage` |
| `/online` | Online store: orders, settings, products online | `online.orders` / `online.manage` |
| `/payments` | Payment methods and internal balances | `payments.settings` |
| `/cash` | Cash custody: treasury and register balances per branch, counts, statements, transfers, expenses and supplier payments, bank deposits, transfers between branches | `cash.custody` (deposits: `cash.deposit`) |
| `/registers` | Registers | `registers.manage` |
| `/devices` | Local-first devices (ADR-0112): offline selling limit, name, branch, register code, online / last sync, remove; exceptions after uploads (negative stock, device clock, not accepted) to mark handled | `registers.manage` (limit: `merchant.settings.read` / `.update`) |
| `/printers` | Receipt printers (print agents, token shown once, online state, auto-print setting); the sale page has "Print receipt" (ADR-0111) | `registers.manage` (setting: `merchant.settings.*`) |
| `/shifts`, `/shifts/:shiftId` | Shift history, X/Z summary, cash discrepancies, follow-up of differences; pending cash-out decisions | `shifts.view_all` |
| `/branches` | Branches | `branches.read` |
| `/employees`, `/employees/:membershipId` | Employees, invitations, role assignments | `employees.read` |
| `/roles` | Roles and permissions | `employees.read` |
| `/subscription` | Own plan, usage and limits | `merchant.settings.read` |
| `/settings` | Company profile | `merchant.settings.read` |
| `/audit` | Audit log: the company's recorded events (period, action, record type filters; CSV) | `audit.read` |

## 2. `/pos` — pos-web

Public: `/login`, `/forgot-password`, `/reset-password`, `/accept-invite`. A POS session is
bound to one branch. Full-screen layout (no sidebar): top strip with company, branch,
cashier, clock, language, Lock and Sign out.

| Route | Screen | Permission |
|---|---|---|
| `/` | Register: shift strip, search/scan, categories, product grid, cart with customer, discounts, held carts, recent sales, payment (cash/card/split), receipt | `sales.create` (open shift) |
| `/shift` | Open shift (count the drawer; blind for cashiers under BR-162, otherwise against the expected balance), cash in/out (drop to / top-up from treasury), count and close, X/Z summary | `shifts.operate` / `cash.move` |
| `/returns` | Find sale, return lines, refund / exchange / void, refund receipt | `refunds.create` |
| `/tables`, `/tables/orders/:orderId` | Restaurant floor and order (module enabled) | `restaurant.orders` |
| `/kitchen` | Kitchen display | `kitchen.access` |
| (any route) | Lock screen when the session is locked (idle 5 min or Lock button) | session |

## 2a. `/` — landing-web (public landing page, ADR-0113)

One static page: product introduction (ar/en, language remembered in the browser), in-page
sections `#home`, `#features`, `#why`, `#start`; sign-up links to `/manager/register`, sign-in to
`/manager/`, and the footer links `/pos/`. No session and no API call. Until 2026-10-18 `/` redirected to
`/manager/`.

## 2a-bis. `/pricing` — landing-web (public pricing page, ADR-0114)

A second page of the landing build: price card, then three steps like a presentation
(system → devices with quantities → contact form) with a running cart (sticky panel on desktop,
bottom bar on phones), confirmation with the request number, and FAQ. Reads
`GET /api/v1/public/pricing`; sends `POST /api/v1/public/pricing/requests`. Nothing is paid online.

## 2a-ter. `/start` — landing-web (free-trial sign-up funnel, ADR-0115)

The single call to action of the site ("أنشئ حساب وجهّز محلك"). Steps: business type → demo
till (sample products per business, optional receipt by e-mail = lead) → set up the shop (own
devices, or devices to try with availability and waiting list) → account (name, e-mail,
password, optional shop name) → 6-digit e-mail code → trial started (session set, link to
`/manager/`). Anonymous funnel steps are counted. `/manager/register` stays open.

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
| `/platform/trials` | Trials & leads: leads by stage with trial activity, device trials (approve, waiting list, delivered → trial from delivery, returned, reject), trial stock per device (available = stock − out), funnel numbers per step, trial settings | any operator (settings and stock: super admin, billing) | ✓ |
| `/platform/requests` | Purchase requests from the pricing page: status filter with counts, details (lines, totals, contact), follow-up status and note | any operator | ✓ |
| `/platform/offer` | Pricing page offer: system yearly price and devices (add, price, hide, order, photo) | any operator (edit: super admin, billing) | ✓ |
| `/platform/plans` | Plans with limits, features, informational price; create / edit | any operator (edit: super admin, billing) | M8 ✓ |
| `/platform/audit` | Platform audit log | super admin, support | M8 ✓ |
| `/platform/assistant` | Assistant usage: every question with its answer, lookups, tokens and estimated cost, totals per merchant, filters (app, days, merchant, text), JSONL export | super admin only | ✓ |
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
| `GET /manager/inventory/adjustments?status=`, `GET /manager/inventory/adjustments/:id` | `inventory.read` (value at cost only with cost rights) |
| `POST /manager/inventory/adjustments` | `inventory.adjust` at the branch (+ `catalog.prices.manage` to enter unit costs) |
| `POST /manager/inventory/adjustments/:id/decision`, `POST …/:id/withdraw` | `inventory.adjust` at the branch; approver ≠ requester (owner excepted, flagged); withdraw by the requester (BR-169) |
| `GET /manager/inventory/damaged-returns?branchId=&status=`, `POST /manager/inventory/damaged-returns/:id/dispose` | `inventory.read` (branch-scoped) / `inventory.adjust` at the branch, note required (BR-175) |
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
| `POST /manager/shifts/:id/force-close` | `registers.manage` at the shift's branch (note required; optional `countedCash` — without it the shift closes `forced_uncounted`) |
| `GET /manager/cash/overview`, `GET /manager/cash/accounts/:id/entries?from=&to=&page=` (period with balance brought forward, BR-184), `POST /manager/cash/accounts/:id/counts`, `GET/POST /manager/cash/transfers` | `cash.custody` (branch-scoped; ADR-0090) |
| `GET/POST /manager/cash/disbursements`, `POST /manager/cash/disbursements/:id/reverse`, `GET /manager/cash/suppliers`, `GET /manager/cash/suppliers/:id/orders`, `GET/POST /manager/cash/branch-transfers`, `POST …/:id/receive`, `POST …/:id/cancel` | `cash.custody` (branch-scoped; ADR-0091) |
| `GET /manager/cash/bank-accounts`, `POST /manager/cash/deposits` | `cash.deposit` at the treasury's branch |
| `GET /manager/suppliers/:id/payments`, `GET /manager/suppliers/:id/statement?from=&to=` | `purchasing.read` (branch-scoped; the statement is received vs. paid with the running difference, BR-188) |
| `GET /manager/reports/expenses?from=&to=&branchId=&employeeId=` | `reports.financial` (branch-scoped; ADR-0092) |
| `GET /pos/cash/suppliers` / `GET /pos/cash/bank-accounts` | POS `cash.move` / `cash.deposit` |
| `GET /pos/payment-methods` | POS `sales.create` (active POS methods, no fees) |
| `GET /pos/registers`, `GET /pos/shifts/current`, `POST /pos/shifts`, `POST /pos/shifts/current/close` | POS `shifts.operate` at the bound branch + register access |
| `GET /manager/audit?from=&to=&action=&targetType=&actorId=&page=&pageSize=` | `audit.read` (company-wide; ADR-0093) |
| `GET /manager/periods`, `GET /manager/periods/:period` | `reports.financial` (the pack needs every report right company-wide; BR-189) |
| `POST /manager/periods/:period/close` | `periods.close` (merchant-wide; sequential, ended months only; ADR-0103) |
| `POST /manager/merchant/ownership-transfers`, `DELETE /manager/merchant/ownership-transfers` | authenticated manager session; the service requires the owner (BR-020, R5.2) |
| `POST /manager/merchant/ownership-transfers/accept` | authenticated manager session of the named member, with the e-mailed code |
| `POST /auth/manager/password`, `GET /auth/manager/sessions`, `DELETE /auth/manager/sessions/:id`, `POST /auth/manager/sessions/revoke-others` | authenticated manager session (own account only; BR-193) |
| `POST /manager/employees/:id/sessions/revoke`, `POST /manager/employees/:id/unlock` | `employees.manage` (members the actor may manage; BR-193) |
| `GET /manager/products/:id/price-history` | `catalog.read` (cost rows only with `catalog.prices.manage`; BR-191) |
| `POST /platform/merchants/:id/owner-freeze`, `POST /platform/merchants/:id/owner-release` | platform support or super admin (BR-020) |
| `POST /platform/merchants/:id/ownership-transfer` | platform super admin only (BR-020) |
| `POST /manager/shifts/:id/movements/:movementId/decision` | `shifts.view_all` at the branch; approver ≠ requester (owner excepted, flagged; ADR-0094) |
| `POST /pos/shifts/current/cash-movements/:movementId/withdraw` | POS `cash.move` (own open shift) |
| `GET /manager/merchant/controls` | `merchant.settings.read` (internal-control checklist, BR-165) |
| `GET /manager/cash/payout-requests?branchId=&status=`, `POST /manager/cash/payout-requests`, `POST …/:id/decision`, `POST …/:id/withdraw` | `cash.custody` at the branch; decision by someone other than the requester (owner excepted, flagged; ADR-0095) |
| `GET /manager/cash/variances?branchId=&status=&from=&to=`, `POST /manager/cash/variances/:sourceType/:sourceId/followup` | `shifts.view_all` (branch-scoped); settled / written off need `cash.custody` (BR-167) |
| `GET /manager/cash/deposits/pending?branchId=`, `POST /manager/cash/deposits/:id/settle` | `cash.deposit` at the deposit's branch; settler ≠ depositor (owner excepted, flagged; BR-168) |
| `GET /manager/cash/bank-accounts/:id/reconciliation`, `POST /manager/cash/bank-accounts/:id/reconciliations` | `cash.deposit` (bank-side control; BR-168) |
| `POST /pos/shifts/current/cash-movements` | POS `cash.move` (own open shift) |

Screens: `/manager/payments` (methods + internal balances, fee preview),
`/manager/registers`, `/manager/shifts` (monitoring + discrepancy report tab),
`/manager/shifts/:id` (detail, force close); POS `/pos/` shows "Open a shift" until a
shift is open, then the sale screen with a shift strip; `/pos/shift` (expected cash,
cash in/out, close with optional note/coin count, closing result).

### Checkout API (Prompt 10)

| Method & path | Permission |
|---|---|
| `POST /pos/sales` (checkout, idempotency key, optional `overrideId`, `zeroTotalReason`) | POS `sales.create`, own open shift; `sales.discount`, `sales.discount.override_limit`, `sales.price_override`, `sales.zero_total` as needed, held by the cashier or lent by a supervisor override (BR-177) |
| `POST /pos/overrides` (supervisor e-mail + password on the cashier's till → single-use grant) | POS `sales.create`, own open shift; the approver must hold overridable rights the cashier lacks |
| `GET /pos/sales/recent`, `GET /pos/sales/:id/receipt`, `GET /pos/sales/settings`, `GET /pos/sales/lookup?receipt=` (any receipt of the branch, read-only) | POS `sales.create` (session branch only) |
| `POST /pos/sales/:id/print` (logged, numbered copy sent to the print agent), `POST /pos/cart-events` (cleared cart / removed line above the threshold) | POS `sales.create`, own open shift |
| `POST /pos/orders` (hold; expires after the company limit), `GET /pos/orders/suspended`, `POST /pos/orders/:id/cancel` | POS `sales.create` |
| `GET /manager/sales?branchId=&q=&from=&to=&flag=` (`flag`: zero_total, above_limit, price_override, supervised), `GET /manager/sales/:id`, `GET …/:id/receipt` | `sales.read` (branch-scoped) |
| `GET/PUT /manager/sales-settings` | `merchant.settings.read` / `merchant.settings.update` |

Screens: POS `/pos/` is the sale screen (search/scan box with Enter, category chips,
product tiles with stock badges, cart with line editing — quantity, discount, price change
with reason — order discount, hold/resume, recent sales, payment dialog with split payments,
cash tendered/change, supervisor panel for exceptions beyond the cashier's rights, zero-total
reason, receipt with 80 mm printing).
Manager `/manager/sales` (list, filters incl. unusual sales, flags, totals, selling policy with
price-change bounds) and `/manager/sales/:id` (exceptions block: above limit, free-sale reason,
supervisor override).

### POS assistant API (ADR-0107)

| Method & path | Permission |
|---|---|
| `GET /pos/assistant` (`{ enabled }`: false until `ANTHROPIC_API_KEY` is configured) | POS `pos.access` |
| `POST /pos/assistant/chat` (`messages` ≤ 20 turns ending with the cashier's, `language`, `cart` as display text, `conversationId` from the browser → `{ reply, toolsUsed }`; 503 `ASSISTANT_DISABLED` when off; 60 per cashier per 10 min; every question is recorded in `assistant_requests` for the platform) | POS `pos.access`; the lookups inside run with the cashier's rights at the session branch (`catalog.read` for stock, `sales.create` for the Pay screen's payment methods and the shift's sales, `shifts.operate` for the shift) |

| `GET /pos/assistant/conversations`, `GET /pos/assistant/conversations/:id` (the cashier's own past conversations on the register: first question, times, turns; one conversation as questions and answers; never tokens or cost) | POS `pos.access` |
| `GET /manager/assistant` (`{ enabled }`) | manager `manager.access` |
| `GET /manager/assistant/conversations`, `GET /manager/assistant/conversations/:id` (the same for the user's own management conversations) | manager `manager.access` |
| `POST /manager/assistant/chat` (same body; `branchId` = the branch selected in the top bar or null for all → `{ reply, toolsUsed }`) | manager `manager.access`; lookups with the user's rights: `search_products` (`catalog.read`, stock with `inventory.read`), `payment_methods` (`payments.settings`), `stock_summary` (`inventory.read`), `sales_today` (`reports.sales`) |

Screen: one shared launcher (`AssistantLauncher` in `web-core`) in both apps, mounted in the
layout: a floating **Assistant** button at the bottom inline-end corner of every page opens a
panel above the content (full screen on phones); Escape closes it and the active conversation
is kept across pages. The register also opens it with F9 and sends the sale as display text
(the sale screen publishes it through `AssistantCartProvider`); the management app sends the
branch selected in the top bar. Each app contributes only its bindings and strings
(`PosAssistant`, `ManagerAssistant`). Answers are rendered from a small allowed markup (paragraphs, "-" bullets,
"1." steps, **bold**, `code`) by `AssistantMarkup` in `web-core`, as React elements, never as
HTML; the guides tell the model to use nothing else. On phones the manager panel fills the
screen (the launcher hides under it) and the input is not focused automatically, so the
on-screen keyboard does not cover the answer; sending blurs the box. "My past conversations"
in the chat footer lists the user's own conversations of that app (newest first, 50 at most)
and reopens one with its id, so the next question continues it; a question recorded without
an id (older browser) is listed on its own. The chat is laid out like a chat app (owner
request): the user's conversations down the side with "New conversation" on top (phones: a
"My conversations" switch), the active one in the middle, a growing composer below (Enter
sends on a keyboard, breaks the line on a touch screen). Nothing is kept in the browser: when
the chat opens on an untouched state it resumes the user's latest conversation from the server
if its last turn is within 30 minutes, so a reload (the register's silent one included) comes
back to the same conversation. The assistant only reads (BR-194).

### Device API (ADR-0112, contract `docs/DEVICE_API.md`)

| Method & path | Permission |
|---|---|
| `POST /device/register` (`{ email, password, deviceName, merchantId?, branchId? }` → `select_branch` choices or `registered` with the device and its token, shown once) | public, the credentials of a holder of `registers.manage` at the branch; rate-limited like a login |
| `GET /device/me` | device bearer token (401 `UNAUTHENTICATED`, 401 `DEVICE_REVOKED`) |
| `GET /device/sync?since=<version>` (snapshot of the branch: full without `since`, product changes since it otherwise; `docs/DEVICE_API.md`) | device bearer token |
| `POST /device/sync` (`{ records: [...] }`, up to 200, causal order; per record `accepted` / `duplicate` / `refused`; `docs/DEVICE_API.md`) | device bearer token |
| `GET /manager/devices`, `POST /manager/devices/:id/revoke` | manager `registers.manage` |
| `GET /manager/device-settings`, `PUT /manager/device-settings` (`{ offlineLimitHours }`, 1–720) | manager `merchant.settings.read` / `merchant.settings.update` |
| `GET /manager/device-exceptions?status=open\|resolved`, `POST /manager/device-exceptions/:id/resolve` (`{ note }`) | manager `registers.manage` (per branch) |
| `PUT /manager/employees/:membershipId/pin` (`{ pin }`: 6–12 digits, not one repeated digit, not a straight run → 204) | own PIN: `manager.access`; others: `employees.manage` within the usual anti-escalation rule |

### Server-side receipt printing API (ADR-0111)

| Method & path | Permission |
|---|---|
| `GET /manager/print-agents` (`{ agents: [{ id, name, branchId, lastSeenAt, online, createdAt }] }`; online = seen < 60 s ago) | manager `registers.manage` |
| `POST /manager/print-agents` (`{ name, branchId? }` → `{ id, token }`; the token is shown only here) | manager `registers.manage` (at the branch; company-wide when `branchId` is null) |
| `DELETE /manager/print-agents/:id` (204; token stops working, sockets disconnected) | manager `registers.manage` |
| `GET` / `PUT /manager/print-settings` (`{ autoPrintReceipts }`, default true) | manager `merchant.settings.read` / `.update` |
| `POST /manager/sales/:id/print` (numbered copy as a new job → `{ id, status, createdAt, copyNumber, agentOnline }`) | manager `sales.read` at the sale's branch |
| `POST /pos/sales/:id/print` (the till's "Print receipt": same answer; copy logged with the cashier's shift) | POS `sales.create` at the session branch |
| `GET /print-agent/jobs/pending` (`[{ id, html, orderUuid, createdAt }]`, oldest first, max 50) | agent bearer token |
| `POST /print-agent/jobs/:id/claim` (`{ id, html }`; 409 when already claimed) | agent bearer token |
| `POST /print-agent/jobs/:id/result` (`{ ok, error? }` → `{ id, status }`; 409 when not claimed by this agent) | agent bearer token |

Socket.IO (path `/socket.io`): namespace `/print-agent`, `auth: { token }` (refused:
`connect_error` "unauthorized"); event `print:job` `{ id }`.

### Returns API (Prompt 11)

| Method & path | Permission |
|---|---|
| `GET /pos/refunds/lookup?receipt=`, `POST /pos/refunds/preview` (reasons incl. `own_sale`, `referenceRequired` per pay-back), `POST /pos/refunds` (optional `customerContact`, references on non-cash pay-backs), `GET /pos/refunds/:id/receipt`, `POST /pos/refunds/:id/cancel` | POS `refunds.create` (own open shift for writes) |
| `POST /pos/exchanges` | POS `refunds.create` + `sales.create` |
| `POST /pos/sales/:id/void` | POS `sales.void` (sale of the own open shift, no refunds yet) |
| `POST /pos/refunds/:id/approve` | POS `refunds.approve` (supervisor at the till; not the requester; pays the cash part from their own shift when the requester's shift is closed) |
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
| `GET /platform/assistant?merchantId=&surface=&from=&to=&q=&page=&pageSize=` (questions, totals, by merchant), `GET /platform/assistant/export?…` (JSONL, one line per question with the thread) | super admin only (ADR-0107 amendment) |
| `GET /platform/offer-items`, `GET /platform/sales-requests?status=`, `GET /platform/sales-requests/:id`, `PUT /platform/sales-requests/:id` (status, note, version) | any operator (ADR-0114) |
| `POST /platform/offer-items`, `PUT /platform/offer-items/:id`, `POST`/`DELETE /platform/offer-items/:id/image` | super admin, billing |
| `GET /platform/trials/settings`, `GET /platform/trials/stock`, `GET /platform/trials/leads?stage=`, `GET /platform/trials/devices?status=`, `PUT /platform/trials/devices/:id`, `GET /platform/trials/funnel?days=` | any operator (ADR-0115) |
| `PUT /platform/trials/settings`, `PUT /platform/trials/stock/:itemId` | super admin, billing |
| `GET /public/trial`, `POST /public/trial/events`, `POST /public/trial/demo-receipt` (10/h per IP, 3/h per e-mail), `POST /public/trial/start` (registration limit), `POST /public/trial/resend`, `POST /public/trial/verify` (sets the manager session) | 🔓 public |
| `GET /public/pricing` (active system + devices), `GET /public/pricing/images/:id`, `POST /public/pricing/requests` (5 per hour per IP; priced on the server) | 🔓 public |
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
| `GET /manager/reports/sales` | `reports.sales` (profit only with `reports.financial` for the whole scope; every report view is audited as `report.viewed`, BR-187) |
| `GET /manager/reports/today` | `reports.sales` (dashboard KPIs: today and yesterday in the merchant's zone, BR-187) |
| `POST /manager/reports/exports` | authenticated manager session (records a browser CSV export as `report.exported`, BR-187) |
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
| `GET /manager/transfers/in-transit?branchId=` | `inventory.read` (goods on the road, valued with cost rights; BR-173) |
| `POST /manager/transfers/:id/recall` | `inventory.transfer` at the source; reason required (BR-173) |
| `POST /manager/transfers/:id/losses`, `POST …/:id/losses/:lossId/decision` | claim: `inventory.transfer` at the destination; decision: `inventory.transfer.approve` at the source, claimant ≠ decider (owner excepted, flagged; BR-172) |

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
