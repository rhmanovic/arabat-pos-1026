# Online Store — Phased Development Plan

Status: **approved by the owner on 2026-10-20** with one change: unpaid orders reserve **no**
stock (see Phase 1). Phases 1 (ADR-0118), 2 (ADR-0119), 4 (ADR-0121) and 5 (ADR-0123) are implemented. **Phase 3 was cancelled
by the owner on 2026-10-20**: payment methods stay one shared set (POS methods, with the "available
online" flag and gateway for the store; pay on receipt needs none). Each phase
is implemented as one or more vertical slices (DB → API → UI → tests → docs), recorded in
`DECISIONS.md`, `BUSINESS_RULES.md`, `ROUTES.md`, `DATABASE.md`, `PROGRESS.md` and the
user guide, released to staging after the tests pass (ADR-0088) and to production on the
owner's word.

Every phase below is **independently shippable**: it works on its own, leaves the product in
a consistent state, and the next phase builds on it without rework.

## 0. Where we are today (facts from the code, 2026-10-20)

- One API module, `ecommerce` (`apps/api/src/modules/ecommerce`), tables `online_stores`,
  `online_listings`, `online_orders`, `online_order_lines`, `stock_reservations`,
  `online_payments`, `payment_events` (migrations 0025/0026; ADR-0076…0079).
- The public storefront is `apps/store-web` at `/store/:slug`; the merchant is resolved from
  the slug by `store_merchant(slug)` and everything then runs under RLS. The client never sends
  a merchant id.
- **Products, prices, stock and images are the POS catalog** (`online_listings` only says
  which products are shown; availability is on-hand minus active reservations at the
  fulfilment branch; selling deducts stock through `StockLedgerService`). Nothing is
  duplicated — this stays.
- Management lives **inside the manager app** as one page with three tabs
  (`/manager/online`: orders, settings, products).
- **Payment methods are the POS table** `payment_methods` with two flags
  (`available_in_pos`, `available_online`) and a `gateway_provider`. The storefront shows
  only methods that have a *ready* gateway; in production no gateway is ready
  (`PAYMENT_MOCK_ENABLED=false`), so:
  - a store **cannot be published** (`GATEWAY_NOT_CONFIGURED` in `saveStore`, BR-140);
  - **checkout refuses** every method (`PAYMENT_METHOD_UNAVAILABLE` / `GATEWAY_NOT_CONFIGURED`);
  - `online_orders.payment_method_id` is NOT NULL and every order opens a gateway attempt, so
    cash on delivery and pay-at-pickup are structurally impossible.
- **Store address:** `online_stores.slug` already exists and is chosen by the merchant
  (`^[a-z0-9][a-z0-9-]{1,40}$`, unique, reserved words `pay links assets api admin`), giving
  `https://www.arabatapp.com/store/<slug>`. Gaps: no availability check before saving, the
  link-page namespace is checked one way only (a store may take a slug a link page uses), a
  renamed slug breaks old links, and the field is buried in the settings tab.
- Currency is hard-coded `KWD` in the store (M12 debt). One fulfilment branch per store. One
  flat delivery fee. No customer accounts, no coupons, no delivery zones, no notifications.

## 1. Target architecture (what changes, what does not)

| Area | Decision |
|---|---|
| Catalog / stock / prices | **Unchanged.** The store sells the POS catalog from the fulfilment branch's inventory. Online-only attributes (listing, order, description, extra images) live in `online_*` tables, never in the catalog. |
| Console | New SPA **`apps/online-web`** served at **`/online`** (its own layout and navigation). Signs in with the manager session like `links-web` (same cookie, `appInterface="manager"`, ADR-0116), needs `online.manage` or `online.orders`. `/manager/online` becomes a redirect; the manager dashboard keeps a card. |
| Online payment methods | **Own entity, own console section.** `payment_methods.channel` (`pos` / `online`), online rows managed only in `/online/payments`, POS rows only in `/manager/payments`. Online kinds: `pay_on_delivery`, `pay_at_pickup`, `bank_transfer`, `gateway`. The POS never sees online methods and vice-versa. |
| Store without a payment method | **Allowed.** Orders may be placed unpaid ("pay when you receive"); the merchant records the payment when the goods are handed over. The sale (financial document) is still created only when money is received (ADR-0077 kept). |
| Store address | Keep the path form `/store/<slug>` as the canonical address now; subdomains and custom domains come in a later phase without changing the API (ADR-0076). |
| Money / finance | Unchanged rules: integer minor units, append-only, cash through the cash ledger, non-cash through settlement accounts (ADR-0090/0101). |

## 2. Phases

### Phase 1 — Store works without a payment method + store naming (unblocks production) ✅
Size: M. Migration 0066. ADR-0118. BR-206…BR-210. **Done 2026-10-20.**

**A. Unpaid orders ("pay when you receive")**
- `online_orders.payment_method_id` nullable; new `payment_status` (`unpaid` / `paid` /
  `refunded`), `paid_at`, `paid_method_id`, `collected_by_membership_id`.
- New order status **`placed`** (unpaid, awaiting the merchant) in front of the existing chain:
  `placed → confirmed → preparing → ready | out_for_delivery → completed`, plus
  `cancelled` (by the merchant with a reason, or by the shopper from the tracking page while
  still `placed`). `pending_payment → paid` stays for gateway orders.
- Checkout: when the shopper picks no online method (or none exists) the order is created
  `placed` with **no gateway attempt** and **no stock reservation** (owner's decision): only
  what is free at checkout can be ordered; the stock is deducted when the payment is recorded.
  Stale `placed` orders are cancelled by staff (no automatic expiry).
- **Recording the payment:** `POST /online/orders/:id/actions {action:'mark_paid', methodId,
  reference?}` (permission `online.orders`, branch-scoped) creates the sale through
  `completeOnlineSaleInTx` with the chosen *POS* tender: cash goes to the fulfilment
  branch's treasury through the cash ledger; card / transfer goes to the method's settlement
  account with a mandatory reference (ADR-0101 rules reused). Audit `online.order.paid`.
  Refunds use the existing refund engine.
- Publishing no longer requires a ready gateway (BR-140 amended). The storefront checkout
  shows "Pay on delivery / at pickup" when no online method is available.
- Manager page (still the current one in this phase): `placed` orders, confirm / cancel /
  mark paid actions, unpaid badge, hold-hours setting.
- Tests: checkout without methods, hold expiry, mark paid (cash → treasury, card → settlement
  + reference), refund of a marked-paid order, POS cannot sell reserved stock, e2e store
  flow without a gateway.

**B. Store naming (address) made first-class**
- `GET /online/store/slug-availability?slug=` (format, reserved, taken by a store **or a link
  page**, with 3 suggestions). `saveStore` calls `link_slug_available` so the namespace is
  checked both ways.
- `online_store_slug_history` (merchant, old slug, until): a renamed store keeps answering on
  its old slug for 90 days (`store_merchant` resolves history too; storefront redirects to the
  new address). Rename rate: at most once per 24 h.
- Reserved words extended (`store manager pos platform device start pricing www mail`).
- UI: the slug field becomes the first thing in settings, with the full address preview
  `https://www.arabatapp.com/store/<slug>`, live availability, copy button and QR.

**Done when:** a merchant on a plan with `ecommerce` can publish a store with zero payment
methods, receive an order, confirm it, hand it over, record cash, and the cash shows in the
branch treasury; the address is chosen and checked in the UI.

### Phase 2 — Separate console app `/online` ✅
Size: L. No migration. ADR-0119. **Done 2026-10-20** (frontend separation only, at the owner's
request: same backend, database, catalog, stock, customers, accounts and permissions).

- New SPA `apps/online-web` (`@arabat/online-web`, base `/online/`, dev port 5178), own
  `OnlineLayout` (sidebar, store switcher-free, RTL/LTR), served by `serve-web.ts` and the
  Dockerfile like the other apps. Session: manager cookie, guard = `online.manage` or
  `online.orders`; no access without them (BR).
- Pages moved from the manager tab page, each becoming a full page: **Dashboard** (orders
  today, unpaid, to prepare, revenue by channel), **Orders** (list, filters, detail, actions,
  print through the branch print agent), **Products** (listings with drag ordering,
  per-product online toggle, bulk list/unlist by category), **Settings** (identity, address,
  fulfilment, hours), **Payments** (placeholder listing the online methods; full editor in
  Phase 3), **Appearance** (colour, logo, banner), **Link page** (opens `/links`).
- `/manager/online` → redirect to `/online/`; manager navigation entry becomes an external
  link; dashboard card updated. API routes move from `manager/online/*` to `online/*`
  (old paths kept as aliases for one release).
- i18n ar/en, tests (component tests per page, e2e: sign in to `/online`, publish, process an
  order), user guide chapter `33-online-console.md`.

**Done when:** every online-store task is done in `/online` and nothing online remains in
`/manager` except the entry link and the sales/report views.

### Phase 3 — Online payment methods (separate from POS) ✗ cancelled
**Cancelled by the owner (2026-10-20).** Payment methods remain shared between the POS and the
store as today. The text below is kept for the record only.

- `payment_methods.channel text not null default 'pos'` (`pos` | `online`), CHECK that
  `available_in_pos` / `available_online` are consistent, then both flags are retired
  (derived from `channel`). Migration: every row with `available_online = true` is copied
  into an `online` row (so a method used by both channels becomes two rows), `gateway_provider`
  is only allowed on `channel = 'online'`, kind `cash` is only allowed on `pos`.
- Online kinds: `pay_on_delivery` (cash or card on the doorstep), `pay_at_pickup`,
  `bank_transfer` (instructions text + optional receipt upload through `FileStorage`,
  merchant confirms), `gateway` (provider). Each online method carries its
  **settlement mapping**: the POS tender it posts as (cash → treasury, else settlement
  account), so finance stays single-sourced.
- `/online/payments`: create / edit / order / enable; bank details with Arabic and English
  instructions; which methods apply to pickup vs delivery.
- POS: lists `channel='pos'` only (removes the `PAYMENT_NOT_VERIFIED` guard case); device sync
  filters the same way. Manager `/payments` no longer shows the online flag or gateway.
- Phase 1's "mark paid" becomes "confirm payment" against the online method's mapping.
- Tests: migration on seeded data, POS never sees online rows, storefront lists only active
  online methods for the chosen fulfilment, bank-transfer confirm, receipts, reports by method.

**Done when:** a merchant configures COD, pay-at-pickup and bank transfer in `/online` without
touching POS methods, and online sales reconcile in the cash and settlement reports.

### Phase 4 — Catalog and merchandising online ✅
Size: L. Migration 0067. ADR-0121. **Done 2026-10-20** — with these differences from the text
below: **no online price override** (the owner's principle: one catalog, one price, one stock
for the POS and the store), no server-side image variants and no trigram index (the storefront
sorts and searches the loaded list), SEO limited to the page title; the rest as planned
(store titles / descriptions, drag ordering, featured, max per order, store categories with
pictures, all catalog pictures in a gallery, logo and banner, sorting, share link, hide
out-of-stock setting). Bulk listing into a category is done from the "not in the store" table.

- `online_listings` gains `title_en/ar`, `description_en/ar` (rich text, sanitised),
  `position` (drag ordering, API), `featured`, `online_price_minor` (optional override,
  bounded by the company price rules and logged in `price_history`), `max_per_order`.
- `online_categories` (merchant, name ar/en, image, position, product membership) so the
  store's navigation is independent of POS categories; a listing may still fall back to the
  POS category.
- Multiple product images online (reuse `product_images`, choose which are shown), image
  variants resized server-side (`sharp`) and cached; banner / logo in `FileStorage` (GCS in
  production).
- Storefront: category navigation, search (trigram index on names), sorting, variant
  selection with per-variant availability, "notify me" (Phase 6), SEO meta per product, share
  links.
- Bulk tools: list all products of a category, import ordering, hide out-of-stock toggle
  (setting).

**Done when:** a merchant with 500 products can curate what the store shows, in which order,
with online descriptions and prices, and shoppers can browse by category and search.

### Phase 5 — Fulfilment: delivery areas, pickup branches, notifications, printing ✅
Size: L. Migration 0068. ADR-0123. BR-215…BR-220. **Done 2026-10-20** — differences from the text
below: notifications are **e-mail only** (shopper and store); no SMS / WhatsApp provider was
connected (paid service, needs the owner's approval) and in-console push stays the overview
counts; hours live on the store with a per-branch override (no per-area windows); the Kuwait
areas are a pick-list in the console, not seeded rows. Everything else as planned, including
the POS hand-over (sale in the cashier's shift, cash into the drawer).


- **Delivery areas** `online_delivery_areas` (merchant, name ar/en, governorate/area list for
  Kuwait seeded, fee, minimum order, free-delivery threshold, estimated time, active). Checkout
  picks the area; fee comes from the area (the flat fee becomes the fallback).
- **Several pickup branches:** `online_store_branches` (branch, pickup enabled, delivery
  enabled, hours, preparation time). The shopper chooses the branch; stock, prices and
  reservations use that branch (today: one fulfilment branch).
- **Order schedule:** ASAP or a time slot (store hours per day, slot length, capacity per slot).
- **Notifications:** order placed / confirmed / ready / out for delivery / delivered, to the
  shopper (SMS + WhatsApp provider behind an adapter, e-mail through the existing SMTP) and to
  the merchant (push in the console, e-mail). Provider credentials are environment secrets;
  sending real SMS needs the owner's approval (cost).
- **Printing:** a confirmed online order prints at the branch through the print agent
  (`PrintJobsService`, ADR-0111) like a POS receipt (kitchen / packing slip template in
  `pos-core`).
- **POS hand-over:** the POS can open a `ready` pickup order by code / QR, take the payment with
  POS tenders and complete it (the sale is created there with `channel='online'`), so the
  cashier never leaves the till.

**Done when:** a restaurant or shop with three branches runs delivery by area and pickup per
branch, customers are notified, and orders print at the branch.

### Phase 6 — Customer accounts ✅ (ADR-0124, migration 0069, BR-221…223)
Done 2026-10-20 **without messaging** (owner: "لا تسوي رسائل"). Differences from the sketch:

- E-mail + password accounts (`customer_accounts`, bearer tokens `st_…` kept per store in the
  browser) instead of phone OTP; password reset by e-mail through the existing `Mailer`. SMS
  stays an adapter point for a provider the owner approves.
- Separate identity realm reaching only `/store/:slug/account/*`; one account per `customers`
  record, attached by phone to the till's customer (BR-114).
- Saved addresses, own orders with tracking links, profile and password; checkout prefills and
  can save the address; guest checkout stays; the merchant may turn accounts off.
- Not done: "notify me when back in stock", one-click re-order, OTP.

### Phase 7 — Promotions ✅ (ADR-0125, migration 0069, BR-224…226)
Done 2026-10-20. Differences from the sketch:

- `online_promotions` (codes and automatic offers: percentage / fixed / free delivery, minimum,
  total and per-customer limits, dates, scope order / categories / products) and append-only
  `online_promotion_uses`; one promotion per order (the entered code when it fits, else the
  best automatic offer); `POST /store/:slug/quote` gives the totals and why a code fails.
- The discount is the sale's **order discount** (`pos-core` pricing), not per-line discounts;
  reports reconcile through the existing discount fields. No buy-X-get-Y, no stacking;
  first-order discount = `max_uses_per_customer = 1`.

### Phase 8 — Real payment gateway (sandbox → live) — frontend placeholder only (ADR-0126)
Done 2026-10-20 as a "Coming soon" section in `/online/settings` (K-net, cards, wallets) with
the note that each needs a provider contract and the owner's approval. **Backend not built**
(owner: "فقط الفرونت اند"). When the owner picks a provider: `initiate / verify / parseWebhook`
for real, idempotent webhooks, refunds through the provider API, credentials per merchant
through the platform (encrypted, never in the repo), sandbox certification from `e2e`. **Live
activation only with the owner's explicit approval** (CLAUDE.md §3.13).

### Phase 9 — Own address: subdomain and custom domain — frontend placeholder only (ADR-0126)
Done 2026-10-20 as a "Store address on the web" section in `/online/settings` (current
`/store/<slug>` address, future subdomain and custom-domain rows). **Backend not built:**
`<slug>.arabatapp.com` (wildcard certificate, host-based resolution in `store_merchant`),
`online_store_domains` (verification TXT, managed certificate, CSP / CORS per host), platform
approval page.

### Phase 10 — Analytics, SEO and PWA — frontend only (ADR-0126)
Done 2026-10-20 in the browser: `/online/analytics` (orders, revenue, average, lost rate,
revenue per day, top products, mix, discounts; channel split from the sales report), storefront
meta + Open Graph per page and JSON-LD `Product`, PWA manifest and service worker (app shell
offline, API always network). **Backend not built:** `online_events` stream (visits,
conversion, abandoned carts), sitemap, bot SSR for link previews, image CDN rules.

### Storefront design ✅ (ADR-0128, migration 0070, BR-227…231)
Added on 2026-10-20 at the owner's request: header, navigation bar, side menu, footer and the
sections of the home, products and categories pages, with shop and restaurant templates, a
picture library, a live preview and draft / publish. See ADR-0128.

## 3. Cross-cutting rules for every phase

- Permissions: `online.manage` (merchant-wide) and `online.orders` (branch-scoped) stay; Phase 3
  adds `online.payments` (settings of online methods) and Phase 5 `online.fulfil` if the
  branch staff role needs a narrower grant. Default deny on every new route.
- Plan feature `ecommerce` gates publishing and the console (unchanged); platform limits may
  add `online_products` later.
- Currency: new code reads `merchants.default_currency`; the hard-coded `KWD` in the store
  is removed in Phase 1 as part of touching checkout (M12 criterion 1 for the storefront).
- Tests before "done": unit (`pos-core` / services), integration (`*.int.test.ts` on
  PostgreSQL), e2e (`e2e/store.spec.ts` grows per phase), `pnpm verify`.
- Docs updated in the same session; user-guide chapter per phase.

## 4. Suggested order and what each phase unblocks

| Phase | Unblocks |
|---|---|
| 1 | Real merchants can use the store in production today (no gateway needed), with their own address. |
| 2 | Room for all the settings that follow; the manager app stays clean. |
| 3 | Cancelled (owner): tenders stay shared. |
| 4 | Stores with large catalogs become presentable. |
| 5 | Multi-branch delivery/pickup operations; staff workflow (print, POS hand-over). |
| 6–7 | Repeat business and promotions. |
| 8 | Card payments online (needs owner approval and provider contract). |
| 9–10 | Branding, discovery and growth. |

Phases 1 and 2 are proposed to start first, in that order (1 is small and unblocks production;
2 gives the console every later phase needs). Phases 6, 7 and 8 can be reordered on business
priority without rework.
