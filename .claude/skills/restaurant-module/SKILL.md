---
name: restaurant-module
description: Working map of the restaurant module (tables, dine-in/takeaway/pickup orders, bills and split bills, kitchen stations and the kitchen display, modifiers, recipes and ingredient consumption). Use for any change under apps/api/src/modules/restaurant, pos-web /tables or /kitchen, manager-web /restaurant, stockConsumption, or restaurant permissions, BR-130…139 and ADR-0072…0075.
---

# Restaurant module

Optional module on top of the retail POS (ADR-0072, BR-130). The menu **is** the product
catalog; the module adds tables, modifiers, recipes, stations, orders and kitchen tickets.
Schema changes: use the `new-migration` skill. Tests: `run-tests`. New rule/decision: `new-adr`.

## Key files
- API: `apps/api/src/modules/restaurant/` — `restaurant.schema.ts`, `restaurant.controller.ts`
  (`RestaurantManagerController` = `/manager/restaurant/*`, `RestaurantPosController` = `/pos/restaurant/*`
  and `/pos/kitchen/*`), `restaurant-config.service.ts` (switch, layout, stations, groups, menu
  items/recipes), `restaurant-orders.service.ts` (orders, bills, kitchen).
- Consumption: `apps/api/src/modules/inventory/consumption.ts` (`stockConsumption`, `consumptionCosts`).
- Checkout: `apps/api/src/modules/sales/sales.service.ts` (`completeSaleInTx` with `restaurant: { orderId, serviceType }`).
- Contracts: `packages/contracts/src/restaurant.ts`. Permissions: `packages/permissions/src/catalog.ts`, `templates.ts`.
- Migrations: `apps/api/drizzle/0023_restaurant.sql` (tables, `sales.restaurant_order_id`, `sales.service_type`),
  `0024_restaurant_rls.sql` (RLS, revokes, guard triggers, partial unique indexes).
- POS web: `apps/pos-web/src/restaurant/RestaurantPages.tsx` (`FloorPage`, `OrderPage`, modifier/cancel/bill/move
  dialogs, `useRestaurantEnabled`), `KitchenPage.tsx`; routes in `apps/pos-web/src/routes.tsx`; nav in `sale/SalePage.tsx`.
- Manager web: `apps/manager-web/src/features/restaurant/RestaurantPage.tsx` (Setup, Floor, Modifiers, Menu tabs).
- Docs: `docs/DATABASE.md` §"Restaurant model", `docs/ROUTES.md` §"Restaurant API", user guide
  `docs/user-guide/11-pos-restaurant-orders.md`, `12-pos-kitchen-display.md`, `30-manager-restaurant-setup.md`,
  open findings 144–162 in `docs/user-guide/CODE_FINDINGS.md`.

## Data model (restaurant.schema.ts)
- Config: `restaurant_settings` (PK merchant; `enabled` default false, `auto_send_on_payment` default true);
  per branch `dining_areas`, `dining_tables` (code unique per branch, seats 1–100), `kitchen_stations`
  (+ `kitchen_station_categories`: one station per category per branch; one active `is_default` per branch).
- Merchant-wide: `modifier_groups` (`min_select`/`max_select`, 0 = optional, max ≤ 50), `modifiers`
  (`price_minor` ≥ 0 added to unit price; optional `component_variant_id` + `component_quantity` per unit),
  `product_modifier_groups`, `recipe_components` (ingredients per unit of a variant).
- Orders: `restaurant_orders` (`R-…` via `nextDocumentNumber`, type `dine_in|takeaway|pickup`, dine-in needs
  `table_id`, status `open|closed|cancelled|merged`, `merged_into_id`), `restaurant_order_items` (`kitchen_status`
  `pending→queued→preparing→ready→served|cancelled`, `station_id`, `ticket_id`, paying `sale_id`, `wasted`),
  `restaurant_order_item_modifiers` (name + price snapshot), `kitchen_tickets` (`new→preparing→ready→completed|cancelled`).
- Bills: `sales.restaurant_order_id`, `sales.service_type`; `sale_line_modifiers` snapshot (printed by
  `apps/api/src/modules/printing/receipt-html.ts`).

## Order lifecycle → sale (ADR-0073)
1. `POST /pos/restaurant/orders` — branch = `actor.boundBranchId` (`posBranch`); `TABLE_OCCUPIED` comes from the
   partial unique index `restaurant_orders_open_table_key` (BR-131).
2. `POST …/:id/items` — items must be sellable at the branch (`SalesService.loadItems`); modifiers must belong
   to the item's groups and satisfy min/max per group, else `MODIFIER_INVALID` (BR-132). Modifier price is
   snapshotted now; the item price is read at payment (OQ-023 open; finding 161 proposes snapshotting).
3. `POST …/send` — routes `pending` items by category to a station (fallback: default station; none →
   `INVALID_STATE`), one ticket per station per send; repeating sends nothing twice (ADR-0075).
4. `POST …/quote` then `POST …/pay` (needs `sales.create` + own open shift via `ShiftsService.lockOwnShift`):
   chosen unpaid items → one immutable sale through `completeSaleInTx` (idempotency key, exact payments,
   receipt number, stock, print job). Split bill = several pays over different items; split tender = several
   payments on one bill. Takeaway/pickup auto-send on pay when `autoSendOnPayment`.
5. `closeIfSettled` closes the order when ≥1 bill exists and no unpaid non-cancelled item remains (BR-133).
   Caveat: paying unsent items closes the order and they never reach the kitchen (finding 148).
- `move` changes only `table_id`; `merge` moves unpaid items + tickets, refused if the source has a paid
  bill (BR-137); locks both orders in id order. `cancel` refused with paid or sent items.

## Kitchen display (ADR-0075, BR-138)
- `GET /pos/kitchen/tickets?stationId=` shows `new|preparing|ready` plus completed in the last 15 minutes.
- `POST /pos/kitchen/tickets/:id/status` moves forward only (`TICKET_ORDER`); backwards/repeat taps are no-ops;
  items follow (`ITEM_FOR_TICKET`: completed → `served`). Never touches sales, payments or stock.
- A ticket whose items are all cancelled becomes `cancelled` (`cancelItem`).
- **No real-time channel**: React Query polling — kitchen 5 s, floor 10 s, order 15 s (`refetchInterval` in
  `KitchenPage.tsx` / `RestaurantPages.tsx`). The Socket.IO `/print-agent` namespace is for receipts only.
- Restaurant is online-only: not on local-first devices (ADR-0112; `docs/DEVICE_API.md`).

## Modifiers, recipes and stock (ADR-0074, BR-135/136)
- `stockConsumption(tx, inputs)` is the single expansion: recipe item → its ingredients (not itself); each
  chosen modifier with a component adds `qty × component_quantity` (half-up milli product). Callers pass the
  result to `StockLedgerService.apply` once. Used by sale checkout, restaurant waste, device ingest, online sale.
- Recipes only on products with `track_inventory = false`; ingredients must be stock-tracked; an item cannot be
  its own ingredient (`saveMenuItem`). Recipe sale lines store `track_inventory = false`, so refunds never restock.
- Stock moves only on payment, or on cancelling a **sent** item as waste (adjustment reason `restaurant_waste`,
  `sourceType: 'restaurant_item'`). Cancelling an unsent item has no stock effect.

## Permissions (packages/permissions/src/catalog.ts)
| Permission | Grants |
|---|---|
| `restaurant.manage` | `/manager/restaurant` setup; settings, menu and modifier groups need it merchant-wide (`assertMerchantWide`), layout/areas/tables/stations at the branch |
| `restaurant.orders` | POS floor, menu, orders, items, send, move, merge, cancel, quote |
| `restaurant.void_item` | cancel an item already sent to the kitchen (BR-136) |
| `kitchen.access` | `/pos/kitchen` board; `kitchen` role template = `pos.access`, `kitchen.access`, `catalog.read` |
| `sales.create` | paying a bill |
- Enabling the module checks the plan feature `restaurant` (`SubscriptionsService.assertFeature`, ADR-0081);
  every POS call runs `assertEnabled` (`MODULE_DISABLED`). Kitchen-only users land on `/kitchen` (`routes.tsx`).

## Rules not to break
- Money only via the sale created by `pay`; never write revenue, payments or stock from kitchen or
  order edits (ADR-0073, BR-138). Corrections of paid items are refunds of the bill (BR-139).
- DB guards (0024): cancelled items final; paid items keep sale/qty/variant/order; sent items keep qty and
  variant (cancel and re-add); closed/cancelled/merged orders immutable; `app_runtime` cannot DELETE config,
  orders, items or tickets, nor UPDATE/DELETE modifier snapshots — deactivate (`status = 'inactive'`) instead.
- Every order change locks the order row (`lockOrder` … `for update`) and bumps `version`; client sends
  `version` for optimistic concurrency (`versionConflict`).
- Prices: integer fils (`bigint`), quantities milli; product discounts in force apply via `offersFor`/`inForce`
  (ADR-0133). Never floats.
- Every write records an audit event via `RestaurantConfigService.record` (`restaurant.*` actions).
- New restaurant tables: RLS enabled, never `FORCE` (0024 forced it; 0048 removed it, CLAUDE.md §9).

## Tests
- API integration: `apps/api/src/modules/restaurant/restaurant.int.test.ts` (full table → kitchen → split bill
  with money and stock; move/merge/cancel/waste; concurrent double-billing; module switch, roles, branch
  scope, tenant isolation). No separate unit test covers `consumption.ts`; extend the restaurant int test.
- Web: `apps/pos-web/src/restaurant/restaurant.test.tsx`, `apps/manager-web/src/features/restaurant/restaurant.test.tsx`.
- E2E: `e2e/restaurant.spec.ts` (setup, modifiers, kitchen display, split bill, stock).
- Update BR-130…139 / ADR-0072…0075, DATABASE.md and the user-guide sections when behaviour changes.
