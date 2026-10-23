---
name: tenant-isolation
description: Runtime multi-tenancy rules for apps/api - where merchant_id comes from, running queries inside withMerchantTx / withContext / withPlatformContext, app_owner vs app_runtime, SECURITY DEFINER lookups for public/device/shopper routes, and cross-tenant tests. Use when writing or reviewing any API service, controller, background job, seed, CLI or integration fixture that reads or writes merchant data, or when a query unexpectedly returns no rows / fails with "row-level security".
---

# Tenant isolation at runtime

Read first: `CLAUDE.md` §3.8, §3.10, §9; `docs/AUTH.md` §1, §4, §5; `docs/DATABASE.md` §3;
ADR-0004, ADR-0007, ADR-0080, ADR-0105 in `docs/DECISIONS.md`. SQL for RLS policies, grants and
FKs in migrations is covered by the **new-migration** skill; running tests by **run-tests**.

## 1. The two database roles (ADR-0105, migration `0048_rls_owner_without_bypass.sql`)
- The API connects as `app_runtime`: no superuser, no BYPASSRLS, owns nothing, so every
  `merchant_isolation` policy applies (asserted in `apps/api/src/database/database.int.test.ts`).
- `app_owner` owns every table; no table forces RLS, so the owner **sees all merchants**.
  Migrations, seeds (`apps/api/src/database/seeds/`), CLIs (`apps/api/src/database/cli/`) and test
  fixtures run as owner and must filter `where merchant_id = $1` themselves (CLAUDE.md §9).
  Setting `app.merchant_id` on an owner connection does **not** filter anything.
- Never write `force row level security` (Cloud SQL would lock the owner out, CLAUDE.md §9).

## 2. Where the merchant id comes from (AUTH.md §5.1, ADR-0004)
Never take `merchantId` from a body, query, path or header. The only sources are:
| Caller | Source | Code |
|---|---|---|
| Manager / POS user | `@CurrentMerchantActor() actor` → `actor.merchantId` (from the session row) | `kernel/access/current-actor.ts`, `modules/auth/db-session.resolver.ts` |
| Login with several companies | `merchantId` in `/auth/login/select` is accepted only if it matches one of the user's memberships | `modules/auth/login.service.ts` (`select`) |
| Device / print agent | `device_authenticate` / `print_agent_authenticate(token_hash)` → `merchantId` | `kernel/access/device-resolver.ts`, `print-agent-resolver.ts` |
| Public storefront | slug/host → `store_merchant(slug)` (published/paused only) | `ecommerce.service.ts` `merchantOf`, `kernel/http/store-host.ts` |
| Shopper (`st_…` bearer) | `customer_session_lookup(hash)`; then `assertStore(customer, merchantId)` so a token of store A is refused on store B | `modules/ecommerce/store-accounts.service.ts` |
| Payment webhook | `online_payment_merchant(provider, reference)` | `online-payments.service.ts` |
| Background job | a `SECURITY DEFINER` function returning merchant ids, then one `withMerchantTx` per merchant, each in its own try/catch | `online-payments.service.ts` `reconcileDue` |
| Platform operator | path `:merchantId`, allowed only inside `withPlatformContext` (§4) | `modules/platform-admin/platform.service.ts` |

Ids of other rows sent by the client (branchId, productId, variantId…) are untrusted: load them
inside the merchant transaction so RLS hides foreign rows, and answer **404** (not 403) when
they are missing (pattern of `catalog.int.test.ts` "tenant isolation"). The guard's
`branchFromRequest` only checks the permission at that branch id (`kernel/access/access.guard.ts`);
the service must still read the branch under RLS.

## 3. Running queries in a tenant context (`apps/api/src/database/database.service.ts`)
- `withMerchantTx(actor.merchantId, async (tx) => …)` — the default for all merchant work. It
  validates the id as a UUID and runs `set_config('app.merchant_id', id, true)` (transaction-local,
  never leaks to the next pooled transaction; tested). Retries deadlocks/serialization failures,
  so keep e-mail, gateway calls and other side effects **outside** the work function.
- `withContext({ merchantId?, userId?, inviteHash? }, …)` — sign-in and invitation acceptance
  before a merchant is chosen (`app.user_id`, `app.invite_hash`, used by `0003_identity_rls.sql`).
- `withPlatformContext(operatorId, merchantId | null, …)` — platform only (ADR-0080): sets the
  merchant context plus `app.operator_id`, which DB triggers require for merchant status and
  subscription changes (`0028_platform_rls.sql`). Merchant code paths must never call it.
- `withTransaction` / bare `database.db` carry **no** context: merchant tables return zero rows.
  Use them only for global tables (`users`, `sessions`, `currencies`, `plans`…) and for the
  `SECURITY DEFINER` lookup functions above.
- Pass the `tx` you were given into helpers (`assertCapacity(tx, …)`, `nextDocumentNumber(tx, …)`,
  `StockLedgerService.apply`); opening a second transaction loses atomicity, not just context.
- Inserts still set `merchantId: actor.merchantId` explicitly (`catalog.service.ts`); the policy's
  `with check` rejects any other value with "new row violates row-level security policy".
- Anything keyed outside the DB is prefixed by merchant too, e.g. storage keys
  `${actor.merchantId}/products/…` (`catalog.service.ts`, through `FileStorage`).

## 4. Platform realm separation (ADR-0007, ADR-0080, AUTH.md §1)
- Operators live in `platform_operators`, log in at `/auth/platform/login` + MFA, cookie
  `plat_sid`; routes use `@RequirePlatformRole(...)` and `@CurrentPlatformActor()`.
- The guard compares `actor.interface` with the route's interface; a merchant cookie in
  `plat_sid` or an operator cookie in `mgr_sid` gets 401 (`platform.int.test.ts` "platform access").
- Cross-merchant reads only through the summary functions `platform_merchants`,
  `platform_overview`, `platform_audit`, `platform_plan_counts` — never business documents.
  Only `modules/platform-admin/platform.service.ts` calls them; `withPlatformContext` is also
  used by the platform parts of `pricing`, `site`, `trials` and `assistant-usage`.

## 5. Composite foreign keys (AUTH.md §5.5; ADR-0123 / migration 0068; CLAUDE.md §10)
- A child references `(merchant_id, parent_id) → parent(merchant_id, id)`, backed by
  `unique (merchant_id, id)` on the parent (e.g. `products_merchant_id_id_key` in
  `modules/catalog/catalog.schema.ts`). That makes a cross-merchant reference impossible even if
  a service forgets a check.
- Never `on delete set null` on a composite FK (it nulls `merchant_id`); use a single-column FK
  to the parent `id` for nullable "set null" links.

## 6. Cross-tenant tests (TESTING.md §3.2) — required for every new table and endpoint
Integration tests (`*.int.test.ts`) create two companies with `createCompany(app, db, mailer)`
(`apps/api/src/testing/auth-fixtures.ts`) and prove B's data is invisible and immutable to A:
```ts
const a = await company(); const b = await company();
const pb = (await create(b, simple({ nameEn: 'Secret product' }))).json();
expect((await a.client.request('GET', `/manager/products/${pb.id}`, { cookies: a.cookies })).statusCode).toBe(404);
// list does not contain it; update/status change → 404; referencing B's category / variant /
// branch from A's create or update → 404   (modules/catalog/catalog.int.test.ts "tenant isolation")
```
- Cover read, list, update, and **reference** (foreign id inside A's payload).
- RLS-only proof: `database.int.test.ts` "isolates merchants…" and "prevents writing rows for
  another merchant" (expects `/row-level security/`).
- Owner-role fixtures go through `DbFixtures.inMerchant` and still filter by `merchant_id` in SQL;
  merchant status / subscription fixtures also need
  `select set_config('app.operator_id', gen_random_uuid()::text, true)` (CLAUDE.md §9).

## 7. Common mistakes
- Reading `merchantId` from `req.body`/`query` or a contract field "for convenience".
- Querying through `this.database.db` and getting `[]`, then "fixing" it by adding a merchant
  id from the client instead of wrapping in `withMerchantTx`.
- Trusting that a seed or fixture is scoped because it set `app.merchant_id` (owner ignores RLS).
- Returning 403 for a foreign id (leaks existence) instead of 404.
- A new `SECURITY DEFINER` lookup that returns business rows instead of just a merchant id, or
  without `REVOKE ALL … FROM PUBLIC` + `GRANT EXECUTE … TO app_runtime` (see new-migration).
- A background loop that processes all merchants in one transaction or lets one failure stop
  the others.
- Calling `withPlatformContext` from merchant code to get past an operator-only trigger.
