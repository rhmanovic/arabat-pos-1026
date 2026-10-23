---
name: online-store
description: Working map of the online store. Use for any work on the public storefront (/store, {slug}.arabatapp.com), the online console (/online), link pages (/links), store design (headers, footers, sections, product/cart/checkout pages), listings and collections, product discounts, promotions, delivery and pickup, online orders, shopper accounts, payment gateways or store domains.
---

# Online store — working map

The store sells the **POS catalog** (one catalog, one price, one stock). Online tables only add
presentation, orders and settings. Plan and phase history: `docs/ONLINE_STORE_PLAN.md`; domains:
`docs/CUSTOM_DOMAINS_PLAN.md`; routes: `docs/ROUTES.md` §2b (store), §2c (links), §2d (online).

## Apps and API

| App / path | What | Session / permission |
|---|---|---|
| `apps/store-web` → `/store/:slug/…`, served at `/` on `{slug}.arabatapp.com` | Public storefront (also `/store/pay/:ref`, `/store/links/:slug`) | none; shopper bearer `st_…` for `account/*` |
| `apps/online-web` → `/online` | Store console (orders, products, categories, collections, delivery-areas, branches, promotions, discounts, analytics, design, settings) | manager cookie; `online.manage` or `online.orders` |
| `apps/links-web` → `/links` | Link-page editor | manager cookie; `online.manage` |

| API controller (prefix) | File |
|---|---|
| `manager/online/*` (console), `store/:slug/*` (public), `pos/online-orders` (till hand-over), `store/:slug/account/*` | `apps/api/src/modules/ecommerce/ecommerce.controller.ts` |
| `manager/online/design*`, `store/:slug` design reads | `apps/api/src/modules/ecommerce/store-design.controller.ts` |
| `manager/online/transfer` (catalog import/export) | `apps/api/src/modules/ecommerce/catalog-transfer.controller.ts` |
| `manager/link-page`, `public/links/:slug` | `apps/api/src/modules/links/links.controller.ts` |
| `manager/discounts` (product discounts, shared with POS) | `apps/api/src/modules/catalog/discounts.controller.ts` |

Permissions: `packages/permissions/src/catalog.ts` — `online.manage` (merchant-wide settings,
design, listings, promotions, link page) and `online.orders` (branch-scoped order handling).
Creating/renaming shared categories also needs `catalog.manage`. Publishing needs the plan feature
`ecommerce` (`subscriptions.assertFeature`). The `site` module (`apps/api/src/modules/site`) is the
landing page's "Our apps" menu (ADR-0117), **not** the store.

## Key backend files (`apps/api/src/modules/ecommerce/`)

| File | Responsibility |
|---|---|
| `ecommerce.service.ts` | Store settings, slug availability/history, listings, catalog for the shopper, checkout, order actions (`mark_paid`, confirm, cancel…) |
| `ecommerce.schema.ts`, `design.schema.ts`, `accounts.schema.ts`, `promotions.schema.ts` | Drizzle tables (`online_*`, `stock_reservations`, `online_store_designs`, `customer_accounts`/`customer_sessions`, `online_promotions`) |
| `online-payments.service.ts` | Gateway attempts, webhooks, reservation consume/release |
| `gateways/payment-gateway.ts` | `MockGateway` (sandbox) and `UnconfiguredGateway`; no real adapter |
| `promotions.service.ts` | `PromotionsService.apply` — one promotion per order |
| `fulfilment.service.ts`, `store-hours.ts` | Delivery areas, serving branches, hours and slots |
| `order-notifications.service.ts` | Order e-mails, sent after commit in the background |
| `pos-handover.service.ts` | Ready pickup order paid at the till (sale in the cashier's shift) |
| `store-accounts.service.ts` | Shopper register / sign-in / reset / addresses |
| `store-design.service.ts` | Draft / publish of the design document |
| `store-share.service.ts` | Share links / QR |
| `catalog/discount-offers.ts` | `offersFor` / `inForce` — price in force for every price path |
| `kernel/http/store-host.ts` | `storeSlugFromHost`, `storeAddress`, `storeHostRewrite` (Fastify `rewriteUrl`) |
| `web/serve-web.ts` | Serves the SPAs, 301 from old `/store/{slug}`, link-preview tags (ADR-0134) |

Contracts: `packages/contracts/src/ecommerce.ts` (`RESERVED_STORE_SLUGS`, `isStoreSubdomain`),
`store-design.ts` (whole design schema), `links.ts`, `discounts.ts`. Pricing rules: `packages/pos-core/src/discounts.ts` (`offerAt`, `discountedPrice`).

## Rules that must not be broken

1. **Prices:** never change catalog prices for a discount. The price in force comes from
   `offersFor` / `inForce` (API) and `offerAt` (pos-core, tills); the largest discount wins.
   Sale and online-order lines keep `regular_unit_price_minor` + `product_discount_id`.
   `product_discounts` are archived, never deleted. No online price override exists.
2. **Promotions:** one per order, computed by `POST /store/:slug/quote` / `PromotionsService.apply`;
   checkout refuses a stale code (`PROMOTION_INVALID`); recorded as the sale's order discount; does
   not apply to discounted items unless `stacks_with_discounts`.
3. **Stock:** availability = on hand − active `stock_reservations` at the serving branch.
   Reservations go through `StockLedgerService.reserve`; deductions only through
   `StockLedgerService.apply`. Pay-on-receipt orders reserve **nothing**; the sale (and deduction)
   happens when payment is recorded (`completeOnlineSaleInTx`).
4. **Addresses:** build links only with `storeAddress` (API) and `storePath`
   (`apps/store-web/src/address.ts`). Host `{slug}.STORE_DOMAIN` is rewritten to `/store/{slug}/…`;
   old `/store/{slug}/…` answers 301 to the sub-domain, except the console preview frame
   (`?preview=1`, `Sec-Fetch-Dest: iframe`). Store and link-page slugs share one namespace
   (`link_slug_available`); renamed slugs live 90 days in `online_store_slug_history`.
5. **Tenancy:** the merchant comes from the slug/host via SECURITY DEFINER functions
   (`store_merchant`, `link_page_merchant`, `customer_session_lookup`) — never from the client.
6. **Shopper realm:** `customer_accounts` is a third identity realm reaching only
   `/store/:slug/account/*`; bearer `st_…` tokens hashed in `customer_sessions`, kept in
   `localStorage` per store (no cookie). Reset by e-mail only; no SMS / WhatsApp / OTP.
7. **E-mails after commit:** order notifications are queued only after the transaction commits;
   a failed e-mail is logged, never surfaced.
8. **Design:** one `online_store_designs` row with `draft` and `published` jsonb. Edits write the
   draft; shoppers see the published doc. Every new field needs a default that keeps today's look
   (an unparsable design falls back to the legacy layout). The preview orders nothing.
9. **Payments:** sandbox `MockGateway` only (`PAYMENT_MOCK_ENABLED`, off in production). Gateway
   and custom-domain screens in settings are UI placeholders. A real gateway, live payments or paid
   domain services need the owner's explicit approval (CLAUDE.md §3.13).
10. **One catalog:** every product gets a listing by trigger `products_online_listing`; listings are
    never deleted. `online_listings.visible` is set only in the console; `products.pos_visible`
    only in Business management. Categories are shared (`categories.online_*` columns).
11. Composite FKs never carry `on delete set null`; pictures go through `FileStorage` + `toStorableImage`.

## Design system — where things live

Schema and catalogs of options: `packages/contracts/src/store-design.ts` (`storeDesignSchema`,
`SECTION_TYPES`, `HEADER_LAYOUTS`, `HEADER_ACTIONS`, `FOOTER_LAYOUTS`, `FOOTER_BLOCK_TYPES`,
`FOOTER_PRESETS`, `PRODUCT_LAYOUTS`, `productPageSchema`, `PRODUCT_PAGE_PRESETS`, `cartPageSchema`,
`checkoutPageSchema`, `CART_PRESETS`, `READY_SECTIONS`, `HOME_LAYOUTS`, `SECTION_STYLES`,
`applySectionStyle`, `CATEGORY_LAYOUTS`, `COLUMN_LAYOUTS`).

| Piece | Editor (`apps/online-web/src/features/design/`) | Renderer (`apps/store-web/src/`) |
|---|---|---|
| Header, top bar, nav, side menu | `HeaderEditor.tsx`, `ShellEditors.tsx` | `design/Header.tsx`, `design/Shell.tsx` |
| Footer | `FooterEditor.tsx` | `design/Footer.tsx` |
| Page sections, ready styles | `SectionEditor.tsx`, `LayoutEditors.tsx`, `PageTools.tsx` | `design/sections.tsx`, `sections-more.tsx`, `sections-layout.tsx`, `frame.tsx` |
| Product page | `ProductPageEditor.tsx` | `pages/ProductPage.tsx`, `design/product-parts.tsx` |
| Cart / checkout | `CartEditors.tsx` | `pages/CartPage.tsx`, `pages/CheckoutPage.tsx` |
| Discount badge / sale look | `SaleEditor.tsx` | `design/sale.tsx` |
| Whole page + draft/publish | `DesignPage.tsx` | `design/context.tsx`, `pages/HomePage.tsx`, `pages/StoreLayout.tsx` |

## Topic → ADR → main file

| Topic | ADR (in `docs/DECISIONS.md`) | Start in |
|---|---|---|
| Link page | 0116 (+ amendments 1–3) | `modules/links/links.service.ts`, `apps/links-web/src/pages/EditorPage.tsx` |
| Pay on receipt, slug, `mark_paid` | 0118 | `ecommerce.service.ts` |
| Console app `/online` | 0119, look 0127 / 0131 | `apps/online-web/src/routes.tsx` |
| Listings, merchandising | 0121 (categories superseded by 0130) | `features/products/ProductsPage.tsx` |
| One catalog, collections, POS switch | 0130 (+ amendment 1) | `features/collections/CollectionsPage.tsx` |
| Delivery areas, branches, hours, e-mails, till hand-over | 0123 | `fulfilment.service.ts`, `pos-handover.service.ts` |
| Shopper accounts | 0124 | `store-accounts.service.ts`, `store-web/src/pages/AccountPages.tsx` |
| Promotions | 0125 | `promotions.service.ts`, `features/promotions/PromotionsPage.tsx` |
| Gateway / domain placeholders, analytics, SEO, PWA | 0126, settings tabs 0135 | `features/settings/GatewaysTab.tsx`, `DomainTab.tsx` |
| Store design (header v2, footer v2, sections v2, product page, cart/checkout, styles, motion, search) | 0128 + amendments 1–8 | `store-design.ts` (contracts) |
| Product discounts | 0133 | `catalog/discount-offers.ts`, `features/discounts/DiscountsPage.tsx` |
| Link previews (WhatsApp) | 0134 | `apps/api/src/web/serve-web.ts` |
| Sub-domains, 301s | 0136 | `kernel/http/store-host.ts`, `store-web/src/address.ts` |
| Earlier store / gateway basis | 0076–0079 | `online-payments.service.ts` |

## Tests

Integration: `apps/api/src/modules/ecommerce/ecommerce.int.test.ts`, `catalog-transfer.int.test.ts`,
`modules/links/links.int.test.ts`, `modules/catalog/discounts.int.test.ts`; unit:
`kernel/http/store-host.test.ts`, `packages/contracts/src/store-design.test.ts`,
`apps/store-web/src/address.test.ts`; e2e: `e2e/store.spec.ts`, `e2e/links.spec.ts`.
User guide: `docs/user-guide/24-manager-online-store.md`.
