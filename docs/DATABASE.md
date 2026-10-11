# Database

Status: **Conventions and initial entity design defined. No migrations exist yet.**
The tenant is called **merchant** in the schema (`merchant_id`).

---

## 1. Engine and access
- PostgreSQL **18.x** in all environments (local Docker image `postgres:18`).
  Until CI is pinned, schema must also run on PostgreSQL 16+ (the cloud sandbox
  has 16) — so no reliance on PG18-only features (UUIDv7 is generated in the
  application, not with PG18 `uuidv7()`).
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
    using (merchant_id = current_setting('app.merchant_id', true)::uuid)
    with check (merchant_id = current_setting('app.merchant_id', true)::uuid);
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
| purchasing | `suppliers`, `purchase_orders`, `purchase_order_lines`, `goods_receipts`, `goods_receipt_lines` |
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

## 8. Migration workflow
1. Change the Drizzle schema in the owning module (`modules/<m>/infrastructure/schema.ts`).
2. `pnpm db:generate` → review SQL by hand; add RLS policies, grants, checks.
3. `pnpm db:migrate` locally; run integration tests incl. isolation tests.
4. Commit schema + migration together. **Never edit an applied migration.**
5. Production changes follow expand → migrate data → contract.
