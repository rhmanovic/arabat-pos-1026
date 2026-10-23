---
name: new-migration
description: Use when adding or changing a database table, column, constraint, index, trigger or function in apps/api (any new apps/api/drizzle/NNNN_*.sql migration or *.schema.ts change). Covers numbering from main, drizzle-kit generation, hand-added RLS / grants / append-only rules, applying, testing and the DATABASE.md catalogue.
---

# Adding a database migration

Read first: `CLAUDE.md` §3 (items 10–12), §8a, §9; `docs/DATABASE.md` §2–§5 and §9.

## 1. Take the number from `main`
```bash
git fetch origin main
git ls-tree --name-only origin/main apps/api/drizzle/ | sort | tail -3   # highest NNNN on main
```
- Your migration is the next free number on **origin/main**, not on your branch (ADR-0110:
  parallel branches once all took 0048). If your branch is behind, rebase/merge `origin/main`
  first so `apps/api/drizzle/meta/_journal.json` and the latest `NNNN_snapshot.json` match main.
- Never edit or renumber a migration that is already on `main` or applied anywhere.

## 2. Change the Drizzle schema
- Schema files: `apps/api/src/modules/<module>/<name>.schema.ts` (glob `./src/**/*.schema.ts` in
  `apps/api/drizzle.config.ts`). A new file must also be exported from
  `apps/api/src/database/schema/index.ts`.
- Use the helpers in `apps/api/src/database/schema/columns.ts`: `id()`, `merchantId()`,
  `createdAt()`, `updatedAt()`. Columns are camelCase in TS; `casing: 'snake_case'` maps them.
- Per merchant-owned table (copy `apps/api/src/modules/catalog/discounts.schema.ts`):
  - `merchantId: merchantId().references(() => merchants.id)`
  - `unique('<table>_merchant_id_id_key').on(t.merchantId, t.id)` (target for composite FKs)
  - children reference parents with a **composite FK**:
    `foreignKey({ columns: [t.merchantId, t.parentId], foreignColumns: [parent.merchantId, parent.id] })`
  - **Never `onDelete: 'set null'` on a composite FK** — it nulls `merchant_id` too. If the child
    must survive the parent's deletion with a null link, reference the parent `id` alone
    (`.references(() => parent.id, { onDelete: 'set null' })`), as 0068 did.
  - status/enum columns are `text` + `check('<table>_status_valid', sql\`... in (...)\`)`;
    bilingual names `nameEn`/`nameAr` + `check(... coalesce(...) is not null)`;
    `version: integer().notNull().default(1)` on editable master data.
  - index leading with `merchant_id`: `index('<table>_merchant_idx').on(t.merchantId, ...)`.
- Money: `bigint({ mode: 'bigint' })`, column suffix `_minor` (KWD 3 decimals: 1.250 → 1250).
  Never `real`, `double precision`, `money`, or a JS `number`. Quantities `numeric(18,3)`;
  moving average cost is `avg_cost_micro` (fils × 1000).

## 3. Generate and hand-finish the SQL
```bash
pnpm db:generate --name <short_snake_name>   # → apps/api/drizzle/NNNN_<short_snake_name>.sql + meta/
```
- With `--name` the file and its `_journal.json` `tag` already carry the name; without it,
  rename the file to `NNNN_<short_snake_name>.sql` **and** change the `tag` of its entry in
  `apps/api/drizzle/meta/_journal.json` to the same name (`idx` must equal NNNN).
- The number is only final once the branch is merged: parallel work renumbers (the assistant
  migrations were 0048/0049 on their branch and are 0049/0050 on `main`). Take NNNN from
  `origin/main` right before merging (step 1), not from when the work started.
- For SQL that has no schema change (data backfill, function, trigger only):
  `pnpm --filter @arabat/api exec drizzle-kit generate --custom --name <short_snake_name>`.
- A `NOT NULL` column whose default is a SQL function (``.default(sql`new_store_code()`)``):
  drizzle-kit does not create the function; add `CREATE FUNCTION` (and `GRANT EXECUTE … TO
  app_runtime`) at the **top** of the file. A VOLATILE default fills each existing row on its own.
- **drizzle-kit asks interactively** ("create column or rename?", "create table or rename?") and
  hangs without a TTY. Give it one and answer with Enter (first choice = create):
  `script -qec "pnpm db:generate" /dev/null < <(printf '\n\n\n')`; read the generated SQL to confirm
  it chose create, not rename. Avoid renaming tables/columns in the same migration as adding
  others (keep the old name and document it, as `register_code_sequences` in 0065).
- **A new `NOT NULL` column on a table that has rows:** the generated `ADD COLUMN … NOT NULL`
  fails in production (and in the test DB after seeds). Hand-edit to expand → backfill → contract:
  `ADD COLUMN x text`, `UPDATE … SET x = …` (filtered/partitioned by `merchant_id`), then
  `ALTER COLUMN x SET NOT NULL` (0065 `pos_devices.code`).
- **Immutability triggers block backfills:** an `UPDATE` of closed/final rows in a migration is
  refused by the row's own trigger (`shifts_closed_is_final` stopped 0064 in production). Inside
  the migration: `ALTER TABLE t DISABLE TRIGGER <name>;` → update → `ENABLE TRIGGER <name>;`
  (each as its own statement-breakpoint). Never `DISABLE TRIGGER ALL` (that includes FK checks).
- Read the generated SQL line by line: no unintended `DROP`, no `ON DELETE set null` on a
  multi-column FK, composite FKs present, checks rendered with qualified column names.
- Append, after the generated statements, each separated by `--> statement-breakpoint`:

```sql
--> statement-breakpoint
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON <table> USING (merchant_id = app_current_merchant_id())
  WITH CHECK (merchant_id = app_current_merchant_id());
--> statement-breakpoint
-- Append-only financial / inventory record: corrections are new rows (void, refund, adjustment).
REVOKE UPDATE, DELETE ON <table> FROM app_runtime;
```
(Taken from `apps/api/drizzle/0073_product_discounts.sql` and `0041_transfer_losses_in_transit.sql`.)

Rules for that SQL:
- **Every** table with `merchant_id` gets RLS enable + the `merchant_isolation` policy above.
- **Never write `FORCE ROW LEVEL SECURITY`.** `app_owner` is exempt only as table owner (no
  BYPASSRLS on Cloud SQL, ADR-0105); `database.int.test.ts` fails if any table is forced.
- Grants: `0000_bootstrap.sql` sets default privileges, so new tables already give `app_runtime`
  SELECT/INSERT/UPDATE/DELETE and functions EXECUTE. Do not re-grant; **revoke** what the role
  must not do:
  - append-only (sales, payments, stock/cash movements, audit, approvals…): `REVOKE UPDATE, DELETE`
  - never-deleted master data named by financial rows: `REVOKE DELETE` (0073)
  - only some columns may change: `REVOKE UPDATE` then `GRANT UPDATE (col_a, col_b) ON t TO app_runtime` (0063)
  - after `CREATE OR REPLACE` of a `SECURITY DEFINER` function: `GRANT EXECUTE ON FUNCTION f(args) TO app_runtime` (0063/0069)
- Guard state changes that must be one-way with a `BEFORE UPDATE` trigger (pattern:
  `cash_movements_decision` in `0037_cash_out_controls.sql`).
- Merchant status / subscription writes in a migration need
  `select set_config('app.operator_id', gen_random_uuid()::text, true)` (trigger).
- Data backfills run as `app_owner` with no RLS filter: always filter/join by `merchant_id`.
- Prefer expand → migrate data → contract for anything production already uses.

## 4. Apply and test
Migrations run from compiled code, so build first:
```bash
pnpm build:packages && pnpm --filter @arabat/api build
pnpm db:migrate             # needs DATABASE_OWNER_URL (app_owner) in .env; runs dist/database/cli/migrate.js
pnpm verify                 # lint, typecheck, unit tests
pnpm test:integration       # real PostgreSQL: migrations, runtime privileges, RLS isolation
pnpm test:e2e
```
- Add/extend an `*.int.test.ts` in the owning module: rows of merchant B are invisible inside
  `withMerchantTx(merchantA)`, revoked UPDATE/DELETE fail for `app_runtime`, checks reject bad data.
- Owner-role fixtures must filter by `merchant_id` themselves (RLS does not apply to them).
- Never skip or disable a failing test; fix the migration (it is not yet on main, so you may
  regenerate it) and re-run.

## 5. Document (same session)
- `docs/DATABASE.md` §8 "Implemented migrations": add a row at the **top** of the table,
  newest first, e.g.
  `| \`apps/api/drizzle/NNNN_name.sql\` | ADR-XXXX: tables/columns, checks, RLS, revokes |`;
  update §6 entity design if a new entity appears and the status line at the top.
- New business rule → `docs/BUSINESS_RULES.md`; significant design → ADR in `docs/DECISIONS.md`
  (next free ADR number on `main`); results → `docs/PROGRESS.md`.
- Commit schema file, SQL, `meta/_journal.json` and `meta/NNNN_snapshot.json` together.
