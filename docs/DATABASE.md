# Database

Status: **Identity tables implemented (Prompt 4).** Later modules are added per slice.
The tenant is called **merchant** in the schema (`merchant_id`).

---

## 1. Engine and access
- PostgreSQL **18.x** in all environments (local Docker image `postgres:18`, CI
  service `postgres:18`). UUIDv7 is generated in the application.
- Access via Drizzle ORM + node-postgres. Schema changes **only** through
  versioned SQL migrations in the repo (drizzle-kit generate → hand review).
- Roles:
  - `app_owner` — owns schema objects, runs migrations.
  - `app_runtime` — used by the API: DML only, **no superuser, no `BYPASSRLS`**.

## 2. Naming & column conventions
- `snake_case`, plural table names.
- PK `id uuid` (UUIDv7, time-ordered → index-friendly).
- FK `<entity>_id`; merchant-owned children use composite FKs
  `(merchant_id, <entity>_id) → parent(merchant_id, id)`; every merchant table
  has `unique (merchant_id, id)` to support this.
- `created_at timestamptz not null default now()`, `updated_at` on mutable rows,
  `created_by` / `updated_by` (membership or operator id) where relevant.
- `version int not null default 1` on editable master data (optimistic locking).
- Status enums as `text` + `check` constraints (easier migrations than PG enums).
- Bilingual display names: `name_en text`, `name_ar text`,
  `check (coalesce(name_en, name_ar) is not null)`.

## 3. Multi-tenancy
- Every merchant-owned table: `merchant_id uuid not null`.
- RLS on every such table:
  ```sql
  alter table <t> enable row level security;
  alter table <t> force row level security;
  create policy merchant_isolation on <t>
    using (merchant_id = app_current_merchant_id())
    with check (merchant_id = app_current_merchant_id());
  ```
  `app.merchant_id` is set per transaction with `SET LOCAL` by the kernel's
  `withMerchantTx()`. When it is unset, no rows are visible.
- Unique business keys are scoped: `unique (merchant_id, sku)` etc.
- Global tables (no RLS, accessed only by specific modules): `users`,
  `sessions`, `platform_operators`, `plans`, `plan_features`, `currencies`.
  `merchants` itself is readable through a policy on `id = app.merchant_id` and
  through the platform module's audited path.

## 4. Money, quantities, rates
- Money: `bigint` minor units + `currency char(3)`. KWD = 3 decimals
  (1.250 KWD → `1250`). Columns suffixed `_minor` (e.g. `total_minor`).
- Forbidden types for money: `real`, `double precision`, `money`. Money is never
  converted to a JS `number`.
- `currencies (code, exponent, name_en, name_ar)` reference table (KWD=3).
- Quantities: `numeric(18,3)`; handled with decimal.js in TS.
- Rates: `numeric(9,6)` as a fraction (e.g. `0.050000` = 5%) or basis points —
  documented per column.

## 5. Append-only rules
- Insert-only tables: `sales`, `sale_lines`, `sale_line_taxes`, `payments`,
  `refunds`, `refund_lines`, `stock_movements`, `cash_movements`,
  `audit_log`, `goods_receipt_lines`.
- Enforced by: no UPDATE/DELETE grants for `app_runtime` on these tables
  (status columns that must change, e.g. `sales.status = voided`, are avoided by
  storing voids as separate rows referencing the sale).
- `stock_levels` is a cached balance updated in the **same transaction** as the
  movement; it can always be rebuilt from `stock_movements`.

## 6. Entity relationship design

### 6.1 Identity, organization and access (Milestone M1)

```mermaid
erDiagram
  merchants ||--o{ branches : has
  merchants ||--o{ memberships : has
  users ||--o{ memberships : "belongs via"
  merchants ||--o{ roles : defines
  roles ||--o{ role_permissions : grants
  memberships ||--o{ role_assignments : has
  roles ||--o{ role_assignments : "assigned in"
  branches |o--o{ role_assignments : "scopes (NULL = all)"
  merchants ||--o{ invitations : issues
  users ||--o{ sessions : opens
  platform_operators ||--o{ sessions : opens
  merchants ||--|| merchant_settings : has
  merchants ||--o| subscriptions : has
  plans ||--o{ subscriptions : "subscribed by"
  plans ||--o{ plan_features : includes
  merchants ||--o{ audit_log : records

  merchants {
    uuid id PK
    text legal_name
    text display_name_en
    text display_name_ar
    text status "active|suspended|closed"
    char3 default_currency "KWD"
    text default_language "ar|en"
    text timezone "Asia/Kuwait"
  }
  branches {
    uuid id PK
    uuid merchant_id FK
    text code
    text name_en
    text name_ar
    text status
    text timezone
  }
  users {
    uuid id PK
    citext email UK
    text password_hash
    text full_name
    text preferred_language
    text status
  }
  memberships {
    uuid id PK
    uuid merchant_id FK
    uuid user_id FK
    bool is_owner "one per merchant"
    text status "invited|active|inactive"
  }
  roles {
    uuid id PK
    uuid merchant_id FK
    text name
    text template_key "nullable"
  }
  role_permissions {
    uuid merchant_id FK
    uuid role_id FK
    text permission_key
  }
  role_assignments {
    uuid id PK
    uuid merchant_id FK
    uuid membership_id FK
    uuid role_id FK
    uuid branch_id FK "NULL = merchant-wide"
  }
  sessions {
    uuid id PK
    bytea token_hash UK
    text realm
    text interface
    uuid user_id
    uuid operator_id
    uuid merchant_id
    uuid branch_id
    uuid register_id
    timestamptz expires_at
    timestamptz revoked_at
  }
  platform_operators {
    uuid id PK
    citext email UK
    text password_hash
    text platform_role
    text mfa_secret_enc
  }
  audit_log {
    uuid id PK
    uuid merchant_id "NULL for platform events"
    text actor_type
    uuid actor_id
    text action
    text target_type
    uuid target_id
    jsonb details
    timestamptz occurred_at
  }
```

Key constraints:
- `unique (merchant_id, user_id)` on memberships;
  `unique (merchant_id) where is_owner` (exactly one owner, enforced together
  with creation logic).
- `unique (merchant_id, name)` on roles; `unique (membership_id, role_id, branch_id)`
  with `NULLS NOT DISTINCT` semantics for assignments.
- `unique (merchant_id, code)` on branches.

### 6.2 Catalog, inventory, customers (M2–M3)

```mermaid
erDiagram
  merchants ||--o{ categories : has
  categories ||--o{ products : groups
  products ||--o{ product_variants : has
  product_variants ||--o{ product_barcodes : "identified by"
  product_variants ||--o{ branch_prices : "priced per branch"
  branches ||--o{ branch_prices : ""
  tax_rates ||--o{ products : "applies to"
  product_variants ||--o{ stock_movements : moves
  branches ||--o{ stock_movements : at
  product_variants ||--o{ stock_levels : ""
  branches ||--o{ stock_levels : ""
  stock_adjustments ||--o{ stock_movements : produces
  stock_transfers ||--o{ stock_movements : produces
  merchants ||--o{ customers : has
  customers ||--o{ customer_notes : ""

  products {
    uuid id PK
    uuid category_id FK
    text name_en
    text name_ar
    text type "standard|service|weighed"
    bool track_stock
    uuid tax_rate_id
  }
  product_variants {
    uuid id PK
    uuid product_id FK
    text sku
    bigint default_price_minor
    bigint cost_minor
  }
  stock_movements {
    uuid id PK
    uuid branch_id
    uuid variant_id
    numeric qty_delta
    text reason "sale|refund|adjustment|transfer_in|transfer_out|receipt|opening"
    text source_type
    uuid source_id
    bigint unit_cost_minor
  }
  stock_levels {
    uuid branch_id PK
    uuid variant_id PK
    numeric on_hand
  }
```

Every product has at least one variant (simple products have exactly one), so
sales, stock and prices always reference `product_variants`.

### 6.3 Registers, shifts, orders, sales, payments, refunds (M4–M5)

```mermaid
erDiagram
  branches ||--o{ registers : has
  registers ||--o{ shifts : "opened on"
  memberships ||--o{ shifts : "opened by"
  shifts ||--o{ cash_movements : records
  shifts ||--o{ sales : contains
  orders ||--o| sales : "converted to"
  orders ||--o{ order_lines : has
  sales ||--o{ sale_lines : has
  sale_lines ||--o{ sale_line_taxes : has
  sales ||--o{ payments : "paid by"
  payment_methods ||--o{ payments : ""
  sales ||--o{ refunds : "refunded by"
  refunds ||--o{ refund_lines : has
  sale_lines ||--o{ refund_lines : references
  refunds ||--o{ payments : "refund tenders"
  customers |o--o{ sales : ""

  shifts {
    uuid id PK
    uuid register_id
    uuid opened_by
    bigint opening_float_minor
    bigint counted_cash_minor
    bigint expected_cash_minor
    text status "open|closed"
  }
  sales {
    uuid id PK
    uuid branch_id
    uuid shift_id
    text receipt_number "per branch sequence"
    char3 currency
    bigint subtotal_minor
    bigint discount_minor
    bigint tax_minor
    bigint total_minor
    uuid voids_sale_id "set on a void document"
    uuid idempotency_key
  }
  sale_lines {
    uuid id PK
    uuid sale_id
    uuid variant_id
    text name_en_snapshot
    text name_ar_snapshot
    numeric quantity
    bigint unit_price_minor
    bigint line_discount_minor
    bigint line_total_minor
  }
  payments {
    uuid id PK
    uuid sale_id
    uuid refund_id
    uuid payment_method_id
    bigint amount_minor
    bigint tendered_minor
    bigint change_minor
  }
  refunds {
    uuid id PK
    uuid sale_id
    uuid shift_id
    uuid approved_by
    bigint total_minor
    text reason
  }
```

- Sale lines **snapshot** names, prices and tax so historic receipts never
  change when the catalog changes.
- Receipt numbers: gap-free per branch via `receipt_sequences`
  (row lock in the sale transaction).
- `sales.idempotency_key` unique per merchant.

### 6.4 Later modules (entities only; designed in detail when scheduled)
| Module | Entities |
|---|---|
| purchasing | implemented (Prompt 12) — see §8 |
| restaurant | `dining_areas`, `dining_tables`, `modifier_groups`, `modifiers`, `order_line_modifiers`, `kitchen_tickets` |
| ecommerce | `online_stores`, `channel_listings` (+ `orders.channel = 'online'`) |
| reporting | `daily_sales_summary` (branch, date, totals) and SQL views |
| subscriptions | `plans`, `plan_features`, `subscriptions` (already in 6.1) |
| idempotency | `idempotency_keys (merchant_id, key, request_hash, response, expires_at)` |
| outbox | `outbox_events` (when async delivery is first needed) |

## 7. Indexing guidelines
- Every merchant table: indexes lead with `merchant_id`.
- Time-series tables (`sales`, `stock_movements`, `audit_log`):
  `(merchant_id, branch_id, created_at desc)`; designed so time partitioning
  can be added without changing application code.
- Barcode lookup: `unique (merchant_id, barcode)`.

## 8. Implemented migrations

| File | Content |
|---|---|
| `apps/api/drizzle/0000_bootstrap.sql` | `GRANT USAGE` on schema to `app_runtime`; default privileges (DML on tables, sequences, functions) for objects created by `app_owner`; function `app_current_merchant_id()` (NULL when unset) for RLS policies |
| `apps/api/drizzle/0001_currencies.sql` | `currencies` reference table (code, exponent, `name_en`, `name_ar`); `app_runtime` is read-only on it |
| `apps/api/drizzle/0002_identity.sql` | `merchants`, `branches`, `users`, `memberships`, `roles`, `role_permissions`, `role_assignments`, `sessions`, `auth_tickets`, `password_reset_tokens`, `rate_limit_buckets`, `platform_operators`, `audit_log` (generated) |
| `apps/api/drizzle/0003_identity_rls.sql` | `app_current_user_id()`; RLS (forced) on merchants, memberships, branches, roles, role_permissions, role_assignments, audit_log; `DELETE` revoked on merchants; `UPDATE/DELETE` revoked on audit_log; lookup indexes |

| `apps/api/drizzle/0004_employees.sql` | `invitations`, `invitation_assignments`; branch settings (`phone`, `address`, `receipt_header`, `receipt_footer`); employee profile on memberships (`job_title`, `phone`, `employee_code`) |
| `apps/api/drizzle/0005_employees_rls.sql` | `app_current_invite_hash()`; RLS on invitations (merchant context or matching invite token hash) and invitation_assignments; data migration of renamed permission keys and `manager` → `company_manager` |

| `apps/api/drizzle/0006_catalog.sql` | `categories` (self-referencing tree), `products`, `product_variants` (`price_minor`/`cost_minor` bigint, currency), `product_barcodes`, `product_branch_availability`, `product_images` |
| `apps/api/drizzle/0007_catalog_rls.sql` | Forced RLS on all catalog tables; `DELETE` revoked on products and variants (archive only); `pg_trgm` + trigram indexes on names and SKU |

| `apps/api/drizzle/0008_inventory.sql` | `inventory_settings`, `stock_levels`, `stock_adjustments`, `stock_adjustment_lines`, `stock_movements` (generated) |
| `apps/api/drizzle/0009_inventory_rls.sql` | Forced RLS on all inventory tables; `UPDATE/DELETE` revoked on the ledger and adjustment documents; `DELETE` revoked on `stock_levels` |

| `apps/api/drizzle/0010_payments_registers.sql` | `financial_accounts`, `financial_account_entries`, `payment_methods`, `registers`, `register_members`, `shifts`, `cash_movements` (generated) |
| `apps/api/drizzle/0011_payments_registers_rls.sql` | Forced RLS; append-only grants on entries and cash movements; no deletes of configuration; trigger making closed shifts immutable; trigger allowing cash movements only on open shifts |
| `apps/api/drizzle/0012_shift_tolerance.sql` | `shifts.discrepancy_tolerance_minor` (tolerance snapshot at closing) |

| `apps/api/drizzle/0013_sales.sql` | `sales_settings`, `receipt_sequences`, `orders`, `order_lines`, `sales`, `sale_lines`, `payments` (generated) |
| `apps/api/drizzle/0014_sales_rls.sql` | Forced RLS; `UPDATE/DELETE` revoked on sales, sale lines and payments; triggers making completed/cancelled orders and their lines final |

| `apps/api/drizzle/0015_refunds.sql` | `refunds`, `refund_lines`, `refund_payments`; refund policy columns on `sales_settings`; `payments.refund_id` + nullable method for exchange credit (generated) |
| `apps/api/drizzle/0016_refunds_rls.sql` | Forced RLS; no deletes; refund lines immutable; triggers: final refund states immutable, only pending refund payments may settle |
| `apps/api/drizzle/0017_refund_zero_total.sql` | Allow zero-value refunds (returning free items to stock) |

| `apps/api/drizzle/0018_purchasing_transfers.sql` | `document_sequences`, `suppliers`, `purchase_orders`, `purchase_order_lines`, `purchase_receipts`, `purchase_receipt_lines`, `stock_transfers`, `stock_transfer_lines` (generated) |
| `apps/api/drizzle/0019_purchasing_transfers_rls.sql` | Forced RLS; no deletes; receipts append-only; triggers: order lines editable only while draft, final order/transfer states immutable, transfer line quantities set once |
| `apps/api/drizzle/0020_customers.sql` | `customers`, `customer_notes`; `orders.customer_id`, `sales.customer_id` with composite merchant FKs and `sales_customer_idx` (generated) |
| `apps/api/drizzle/0021_customers_rls.sql` | Forced RLS; `DELETE` revoked on customers; notes append-only; trigram indexes on name and phone |

Customer model (implemented, Prompt 13):
- `customers`: `code` (C-…, document sequence), `full_name`, canonical `phone` (unique per
  merchant when present), `email`, `address`, `preferred_language`, `status`
  active | inactive, creator and creating branch, version. Merchant-wide.
- `customer_notes`: append-only (author, time).
- `sales.customer_id` / `orders.customer_id`: nullable (walk-in). Stats are derived.
- Future (not built): `customer_loyalty_entries`, `customer_credit_entries` as append-only
  ledgers keyed by customer, when OQ-019 is decided.

Purchasing and transfer model (implemented, Prompt 12):
- `suppliers`: names ar/en, unique `lower(code)` per merchant, contact, tax number,
  payment terms, active/inactive (never deleted).
- `purchase_orders` (`PO-…`): supplier, receiving branch, status, expected date, creator,
  approver, close reason, version. Lines: variant, quantity, `unit_cost_minor`,
  `received_quantity`.
- `purchase_receipts` (`GR-…`): order, receiver, supplier reference, idempotency key;
  lines: order line position and quantity. Stock movements reference the receipt.
- `stock_transfers` (`TR-…`): source, destination, status, requester/approver/dispatcher/
  receiver with timestamps, discrepancy note. Lines: requested, dispatched and received
  quantities and the dispatch `unit_cost_minor`.

Refund model (implemented, Prompt 11):
- `refunds`: linked to the original sale (never changed); `kind` refund | void | exchange;
  `status` pending_approval → processing → completed, or rejected / cancelled;
  `refund_number` = `{receipt}-R{n}`; requester's shift (cash leaves that drawer);
  approval reasons, decision (who, when, note); idempotency key + request hash;
  exchange credit and the new sale id for exchanges.
- `refund_lines`: original sale line, quantity, amount, `restock` flag, unit cost.
- `refund_payments`: allocated to the original payments (`original_payment_id`), or
  `method_kind = 'exchange'` for credit moved to the new sale; `status` pending →
  succeeded (gateway refunds stay pending until verified).
- Refundable balances are derived: sold − Σ(active refunds) per line and per payment
  (active = pending_approval, processing, completed), computed under a per-sale advisory
  lock, so concurrent requests can never exceed the sale.

Checkout model (implemented, Prompt 10):
- `orders`: the intent document — `suspended` (held cart) → `completed` | `cancelled`;
  a direct checkout is inserted as `completed`. `idempotency_key` + `request_hash`
  (unique per merchant) make retries return the first result.
- `sales` (1:1 with a completed order): receipt number (`{BRANCH}-{000001}`, gap-free
  per branch from `receipt_sequences`), subtotal, line discounts, order discount, total,
  paid, change, fees, cost of goods; a check constraint enforces
  `total = subtotal − line discounts − order discount` and `paid = total`.
- `sale_lines`: name/SKU/price snapshots, list vs effective unit price (override flag),
  gross, line discount, allocated order discount, net (`net = gross − both discounts`),
  unit cost from the inventory ledger.
- `payments`: method snapshot, amount, tendered/change (cash), fee (computed with the
  method's rule at payment time), `status` succeeded | pending | failed, `verification`
  manual | gateway. Only succeeded payments complete a sale; gateway methods are refused
  until a verified integration exists.

Payments, registers and shifts (implemented, Prompt 9):
- `payment_methods`: per merchant; `kind` cash | card | bank_transfer | custom (exactly one
  cash method, partial unique index); `status`, `available_in_pos`, `available_online`;
  fee `fee_type` none | fixed | percentage | fixed_plus_percentage with
  `fee_fixed_minor` (bigint fils) and `fee_percent` numeric(6,3); optional
  `financial_account_id`; `gateway_provider` + `gateway_config` jsonb (placeholder only,
  no secrets, never live).
- `financial_accounts` + `financial_account_entries`: internal balances; the balance is the
  sum of signed append-only entries (written by payments/fees/refunds from Prompt 10).
- `registers` (branch, code unique per branch, `access_mode` branch | restricted,
  default opening float, discrepancy tolerance) + `register_members`.
- `shifts`: one open shift per register and per membership (partial unique indexes);
  closing stores expected, counted, `discrepancy = counted − expected` (check
  constraint), close type normal | forced, optional denomination breakdown; a trigger
  rejects any update of a closed shift.
- `cash_movements`: cash_in | cash_out with reason, note, author, optional idempotency key.

Financial model separation (Prompt 9 requirement) — each figure has its own record and is
never derived from another by subtraction:

| Concept | Record | Introduced |
|---|---|---|
| Order value | `orders` / `order_lines` (mutable intent) | Prompt 10 |
| Sales revenue | `sales` / `sale_lines` (immutable, net of discounts) | Prompt 10 |
| Customer payments | `payments` (method, amount, shift) | Prompt 10 |
| Processing fees | `payments.fee_minor`, computed with `processingFee()` from the method's rule at payment time | Prompt 10 (rule: Prompt 9) |
| Refunds | `refunds` / `refund_payments` | Prompt 11 |
| Cash movements | `cash_movements` (non-sale drawer cash) | Prompt 9 |
| Internal balances | `financial_accounts` + `financial_account_entries` | Prompt 9 |

Inventory model notes (implemented, Prompt 8):
- Quantities are `numeric(14,3)` (exact thousandths, e.g. kg); the API exchanges them as
  decimal strings and the code computes with bigint milli-units (`@arabat/money` quantity
  helpers). Never floats.
- `stock_movements` is the append-only ledger: signed `quantity`, `balance_after`,
  `unit_cost_minor`, `value_minor`, `avg_cost_after_minor`, `movement_type`
  (opening, adjustment, count, sale, sale_void, refund, transfer_out, transfer_in,
  purchase_receipt), `source_type`/`source_id` of the originating document and the user.
- `stock_levels` (PK merchant, branch, variant) holds the current balance, the moving
  weighted-average cost and the optional low-stock threshold. It only changes together
  with a ledger row, under `SELECT … FOR UPDATE` taken in variant-id order (no lost
  updates, no deadlocks). Invariant (tested): `on_hand = sum(movements.quantity)`.
- `stock_adjustments` + `_lines` are manual documents (opening, increase, decrease,
  count) with reason, note, author and an optional idempotency key
  (`unique (merchant_id, idempotency_key)` + request hash).
- `inventory_settings.allow_negative_stock` (default false) is the oversell policy.

Catalog model notes (implemented, Prompt 7):
- Every product has at least one variant; a simple product has exactly one (the
  default). Prices and costs live on variants as integer fils (`bigint`), with a
  `currency` column (KWD).
- SKU: unique per merchant, case-insensitive (`unique (merchant_id, lower(sku))`),
  including archived variants, so an SKU is never silently reused.
- Barcode: primary key `(merchant_id, barcode)` — unique across all active variants of
  the merchant. Archiving a variant releases its barcodes.
- Products and variants are archived, never deleted (sales will reference them).
- `available_in_all_branches = false` restricts a product to the rows in
  `product_branch_availability`.
- Images: metadata row in `product_images`; bytes in `FileStorage` (local disk in
  development, key `merchants/<id>/products/<id>/<imageId>`); max 2 MB, 8 per product,
  type detected from magic bytes (JPEG/PNG/WebP).

Migration role: `app_owner` has **BYPASSRLS** (ADR-0031) so data migrations and
cross-merchant seeds work; owner-role scripts and test fixtures must therefore filter
by `merchant_id` explicitly. The API's `app_runtime` role never bypasses RLS.

Identity model notes (implemented):
- `users` is global (one identity, many memberships); e-mail stored lower-cased
  (`check email = lower(email)`), unique.
- `memberships`: `unique (merchant_id, user_id)`, exactly one owner per merchant
  (partial unique index), an owner membership must be active.
- `role_assignments.branch_id` NULL = all branches; `UNIQUE NULLS NOT DISTINCT
  (membership_id, role_id, branch_id)`; composite FKs `(merchant_id, …)` to
  memberships, roles and branches.
- `sessions` check constraint: a merchant session always has `merchant_id` and
  `membership_id`, a POS session always a `branch_id`; platform sessions have neither.
- Global tables without RLS (`users`, `sessions`, `auth_tickets`,
  `password_reset_tokens`, `rate_limit_buckets`, `platform_operators`) are only read
  by the auth module; token columns hold SHA-256 hashes.
- RLS read exception: with `app.user_id` set, a user sees their own memberships and
  those merchants (ADR-0029).

Seeds: `100-dev-demo-merchants` (development only) creates "Demo Store" (2 branches)
and "Second Shop", users owner/manager/cashier/multi `@demo.arabat.test` and the dev
platform operator, all with password `Demo-Pass-2026`.

Seeds (`apps/api/src/database/seeds`, run as `app_owner` in one transaction,
idempotent, each seed declares the environments it may run in):
`001-currencies` (KWD=3, BHD=3, OMR=3, SAR, AED, QAR, USD, EUR = 2) and the
development-only `100-dev-demo-merchants`.

Connection management: `DatabaseService` owns one `pg.Pool` (size
`DATABASE_POOL_MAX`, statement timeout, idle-error handler), exposes
`withTransaction()` and `withMerchantTx(merchantId)` — the latter validates the
UUID and runs `set_config('app.merchant_id', id, true)` (transaction-local). The
pool is closed on shutdown. Role/database bootstrap: `docker/postgres/init/`.

RLS policy template (verified by `database.int.test.ts`):
```sql
using (merchant_id = app_current_merchant_id())
with check (merchant_id = app_current_merchant_id())
```

## 9. Migration workflow
1. Change the Drizzle schema in the owning module (`modules/<m>/infrastructure/schema.ts`).
2. `pnpm db:generate` → review SQL by hand; add RLS policies, grants, checks.
3. `pnpm db:migrate` locally; run integration tests incl. isolation tests.
4. Commit schema + migration together. **Never edit an applied migration.**
5. Production changes follow expand → migrate data → contract.
