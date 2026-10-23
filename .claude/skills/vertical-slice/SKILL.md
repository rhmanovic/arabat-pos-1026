---
name: vertical-slice
description: Ordered checklist for shipping a complete feature in this repo — migration, Drizzle schema, Zod contract, NestJS module/controller/service, permission, api-client, web page with ar/en strings, unit/web/integration/e2e tests and docs. Use when asked to build or add a new feature, screen, entity or workflow end to end (not a one-file fix).
---

# Building a vertical slice (DB → API → UI → tests → docs)

CLAUDE.md §4 requires functional vertical slices, not disconnected layers. Reference slice:
product discounts, commit `057d8c8` (ADR-0133, BR-242). Read it with `git show --stat 057d8c8`
when unsure how a layer looks. Do the steps in order; each layer builds on the previous one.

## 0. Before writing code
1. `git fetch origin main` and start from it (CLAUDE.md §8a). Take migration / ADR / BR numbers
   from `origin/main` only.
2. Read `docs/BUSINESS_RULES.md`, `docs/AUTH.md`, `docs/ROUTES.md` and the ADRs of the module you
   touch. If the owner confirmed a business rule or a significant design choice, write it down
   with the **new-adr** skill (ADR-0133 + BR-242 were written in the same commit as the code).
3. Pick the owning module under `apps/api/src/modules/<module>/` (discounts live in `catalog/`).
   Stock changes go only through `StockLedgerService.apply`, cash only through
   `payments/cash-ledger.ts`, periods through `kernel/time/period.ts` (CLAUDE.md §10).
4. If selling rules are involved (prices, limits, tenders), put the pure rule in
   `packages/pos-core/src/` and call it from services (ADR-0112; `pos-core/src/discounts.ts`).
   Device-side work: see the **device-app** skill. Store / console work: **online-store** skill.

## 1. Database
Follow the **new-migration** skill. What the reference slice did:
- Schema file `apps/api/src/modules/<module>/<name>.schema.ts` (drizzle-kit globs
  `src/**/*.schema.ts`, `apps/api/drizzle.config.ts`); columns from
  `apps/api/src/database/schema/columns.js` (`id`, `merchantId`, `createdAt`, `updatedAt`).
- Every tenant table: `merchant_id` NOT NULL, `unique(merchant_id, id)`, CHECK constraints for
  enums / value ranges, `version` for optimistic locking.
- Hand-added at the end of the SQL (`apps/api/drizzle/0073_product_discounts.sql`): `ENABLE ROW
  LEVEL SECURITY` + `merchant_isolation` policy on `app_current_merchant_id()`; `REVOKE DELETE`
  for records that must be archived, not deleted (CLAUDE.md §4 append-only). Never `force row
  level security` (CLAUDE.md §9).
- Money columns are `bigint` `*_minor` (fils); never floats (CLAUDE.md §3.11, `packages/money`).

## 2. Contract (`packages/contracts/src/`)
- New file `<feature>.ts` with Zod schemas for the response (`productDiscountSchema`), list,
  and the save input (`saveProductDiscountSchema`); export types. Money crosses the wire as
  `moneySchema` / `moneyAmountSchema` from `catalog.ts` (strings, never numbers).
- Add `export * from './<feature>.js'` to `packages/contracts/src/index.ts`.
- New error codes go in `packages/contracts/src/errors.ts` **and** their message in
  `packages/i18n/src/locales/{ar,en}.ts` (`DISCOUNT_ARCHIVED` in 057d8c8).
- Run `pnpm build:packages` — the API reads `dist/` (CLAUDE.md §9).

## 3. Permission
Reuse an existing key from `packages/permissions/src/catalog.ts` when one fits (discounts reuse
`online.manage` to read and `catalog.prices.manage` to write). A new key, its scope
(`merchant` / `branch`) and role templates (`templates.ts`): **new-permission** skill.

## 4. API (`apps/api/src/modules/<module>/`)
Details in the **new-api-endpoint** skill. Shape of the reference slice:
- `<feature>.controller.ts`: `@Controller('manager/<feature>')` (namespaces in `docs/ROUTES.md`);
  every route carries `@RequirePermission('manager', '<key>')` (or `@Public` /
  `@Authenticated` / `@RequirePlatformRole`), else the API refuses to boot (CLAUDE.md §9). Body
  through `new ZodPipe(schema)`, ids through `ParseUUIDPipe`, actor via `@CurrentMerchantActor()`.
- `<feature>.service.ts`: re-check rights with `can(actor.access, key, null)` and throw
  `AppError.forbidden()`; all writes inside `this.database.withMerchantTx(actor.merchantId, tx => …)`
  (sets RLS context, CLAUDE.md §3.12); merchant id comes from the actor, never the body
  (CLAUDE.md §3.10); `select … for update` + `version` check → `versionConflict()`; audit in the
  same tx with `AuditService.recordIn(tx, { action: '<module>.<thing>_<verb>', … })` (CLAUDE.md §4).
- Register controller and service in `<module>.module.ts`; new modules also in
  `apps/api/src/app.module.ts`. Keep value imports for injected classes (CLAUDE.md §9).
- Plan limits: `SubscriptionsService.assertCapacity` in the creating transaction (CLAUDE.md §10).

## 5. API client (`packages/api-client/src/client.ts`)
Import the schemas and add typed methods in the right group, e.g.
`discounts: () => request('GET', '/manager/discounts', { schema: productDiscountListSchema })`.
Source-only package: no build needed.

## 6. Web UI (`apps/<app>/src/`)
Pick the app by audience (CLAUDE.md §3.4: manager-web, pos-web, online-web, platform-web …).
Conventions: **frontend-conventions** skill. The reference slice (in `apps/online-web`):
- Page `src/features/<feature>/<Feature>Page.tsx`: guard with `useSession().can(...)` →
  `<AccessDenied />`; data via `useApi()` + TanStack Query; primitives from `@arabat/ui`;
  money via `formatMoney(Money.fromJSON(...))` from `@arabat/i18n` / `@arabat/money`.
- Route in `src/routes.tsx`; menu entry with `anyOf: ['<key>']` in `src/app/navigation.ts`.
- Strings in **both** `src/i18n/ar.ts` and `src/i18n/en.ts` (app namespace; parity is asserted
  with `flattenKeys` in `src/app.test.tsx`). Logical Tailwind classes only (`ms-/pe-/start-`).
- The UI only hides; the backend decides (CLAUDE.md §3.5).

## 7. Tests (run them — **run-tests** skill)
- Pure rules: `packages/pos-core/src/pos-core.test.ts` (or the package's own `*.test.ts`).
- Integration: `apps/api/src/modules/<module>/<feature>.int.test.ts` using
  `prepareIntegrationDatabase`, `createTestApp`, `createCompany` / `DbFixtures` from
  `apps/api/src/testing/`. Cover: happy path, validation, permission denied, other-tenant
  isolation, version conflict, audit row, money edge cases (`docs/TESTING.md` §3).
- Web: `apps/<app>/src/app.test.tsx` with `renderApp` + `fakeApiFetch` from
  `@arabat/web-core/testing`; assert the request body and the read-only / denied state.
- E2E: one user-visible flow in `e2e/<area>.spec.ts` (helpers in `e2e/helpers.ts`).
- `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e` must all pass. Never skip a test.

## 8. Docs (same commit)
- `docs/DATABASE.md`: ER line + migration catalogue row (new-migration skill).
- `docs/ROUTES.md`: the web route and each API endpoint with its permission.
- `docs/BUSINESS_RULES.md` / `docs/DECISIONS.md`: BR / ADR (new-adr skill).
- `docs/TESTING.md`: a `### Results YYYY-MM-DD (<feature>, ADR-xxxx)` block listing tests added.
- `docs/PROGRESS.md`: dated entry (owner's request, decisions, what each layer got, not done).
- `docs/user-guide/*.md` when merchants see the change; `docs/ROADMAP.md` if a milestone moves.
- `CLAUDE.md` §10 only for a new invariant other sessions must know.

## 9. Finish
Commit, merge to `main` and report in Arabic: **finish-task** skill. Release only per the
**deploy-production** skill (CLAUDE.md §3.13).
