---
name: new-api-endpoint
description: Add or change a route in the Arabat API (apps/api/src/modules/*, /api/v1) end to end — access decorator, Zod contract, tenant-scoped service transaction, errors, audit entry, api-client method, ROUTES.md row and integration tests. Use whenever you create a new @Get/@Post/@Patch/@Delete handler, controller or module, or change who may call an existing one.
---

# New API endpoint

Read CLAUDE.md §3–4 and `docs/AUTH.md` §3–5 first. Schema change needed? Do **new-migration**
first. New permission or significant decision? Use **new-adr**. Running tests: **run-tests**.

## 1. Layout (one module per business area)

```
apps/api/src/modules/<area>/
  <area>.module.ts       @Module({ imports, controllers, providers, exports })
  <area>.controller.ts   HTTP only: decorators, pipes, actor, req.ip → service
  <area>.service.ts      all logic, permission checks, transactions, audit
  <area>.schema.ts       Drizzle tables (see new-migration)
  <area>.int.test.ts     integration tests (real PostgreSQL)
```
- Register a new module in `imports` of `apps/api/src/app.module.ts`. Prefix `api/v1`
  (`API_PREFIX`, `bootstrap.ts`); paths start with `manager/`, `pos/`, `platform/`, `store/`, `public/`.
- Keep **value imports** for injected classes (not `import type`): Nest needs decorator
  metadata (CLAUDE.md §9).

## 2. Access declaration (mandatory, default deny)

Exactly one decorator per handler, from `apps/api/src/kernel/access/access.decorators.ts`:
`@Public()`, `@Authenticated(iface)`, `@RequirePermission('manager'|'pos', key)`,
`@RequirePlatformRole(...roles)`, `@RequirePrintAgent()`, `@RequireDevice()`.
- Missing one → `RouteAccessAuditor` (`kernel/access/route-access.auditor.ts`) refuses boot
  (`MissingAccessDeclarationError`); `AccessGuard` (`kernel/access/access.guard.ts`) denies too.
- Keys live in `packages/permissions/src/catalog.ts` (`PERMISSIONS`, scope `merchant`|`branch`);
  add new ones to `templates.ts` if default roles should hold them; then `pnpm build:packages`.
- Never make `/manager` reachable through a `pos` permission or vice versa (CLAUDE.md §3.6–3.7).

## 3. Branch scoping

`AccessGuard` checks the permission **at the branch** when the request names one
(`actor.boundBranchId` for POS, `:branchId` param or `?branchId` query); otherwise only
`canAnywhere` (held somewhere). So the **service must** then:
- `assertCan(actor, key, branchId)` (`kernel/access/assert.ts`) for every affected branch,
  `null` for merchant-scope actions;
- filter lists with `permissionBranchScope` / `accessibleBranches` from `@arabat/permissions`
  (pattern: `BranchesService.list`, `apps/api/src/modules/branches/branches.service.ts`).
Branch ids in a body are client input: always `assertCan` them (AUTH.md §4).

## 4. Tenant context and transactions

- Actor from `@CurrentMerchantActor()` / `@CurrentPlatformActor()`
  (`kernel/access/current-actor.ts`); `actor.merchantId` comes from the session. Never accept a
  `merchantId` from body, query or params (CLAUDE.md §3.10, ADR-0004).
- Run every DB access in `this.database.withMerchantTx(actor.merchantId, async (tx) => …)`
  (`apps/api/src/database/database.service.ts`): sets `app.merchant_id` for RLS, retries deadlock /
  serialization failures — so keep e-mail and other side effects **outside** the callback.
- Platform code acting on a merchant: `withPlatformContext(operatorId, merchantId, …)` (ADR-0080).
- Multi-step writes in one transaction (CLAUDE.md §3.12); stock only via
  `StockLedgerService.apply`, cash only via `modules/payments/cash-ledger.ts`, plan limits via
  `SubscriptionsService.assertCapacity` / `assertFeature` inside the same `tx` (CLAUDE.md §10).
- Updates check `version` (409 on no row, `BranchesService.update`); financial / inventory rows
  are append-only (CLAUDE.md §4).

## 5. Contracts and validation

- Request/response schemas live in `packages/contracts/src/<area>.ts`, exported from
  `packages/contracts/src/index.ts`; money is a string schema (`moneySchema`, `catalog.ts`), never
  a JS number (CLAUDE.md §3.11). Rebuild with `pnpm build:packages`.
- Validate with `ZodPipe` (`kernel/validation/zod.pipe.ts`):
  `@Body(new ZodPipe(createXSchema)) body: z.output<typeof createXSchema>`; params/queries too
  (`ParseUUIDPipe` for ids). Failure → 400 `VALIDATION_FAILED` with `issues`.

## 6. Errors

- Throw `AppError` (`kernel/errors/app-error.ts`): `forbidden()`, `notFound()`, `conflict(msg)`,
  `validation(issues)` or `new AppError(status, 'CODE', msg)`. A new code must be added to
  `ERROR_CODES` in `packages/contracts/src/errors.ts`. Any other exception becomes an opaque 500
  (`kernel/errors/problem.filter.ts`).
- Selling decisions belong in `packages/pos-core` (pure); call them through
  `rules(() => decide(...))` (`kernel/errors/pos-rule.ts`, ADR-0112), which maps `PosRuleError`
  to `AppError` (example: `modules/sales/sales.service.ts`). See **device-app**.

## 7. Audit

Security-relevant and financial writes call `this.audit.recordIn(tx, { merchantId, actorType:
'user', actorId: actor.userId, action: '<area>.<verb>', targetType, targetId, ip, details })`
inside the same `tx` (`modules/audit/audit.service.ts`; `AuditModule` is `@Global`).
Pass `req.ip` from the controller; field changes go in `details.changes` via `diffFields`
(`kernel/audit-diff.ts`, ADR-0104).

## 8. Skeleton (from `apps/api/src/modules/periods/periods.controller.ts`)

```ts
@Controller('manager/periods')
export class PeriodsController {
  constructor(private readonly periods: PeriodsService) {}       // value import

  @RequirePermission('manager', 'periods.close')
  @Post(':period/close')
  close(
    @CurrentMerchantActor() actor: MerchantActor,
    @Param('period', new ZodPipe(periodKeySchema)) period: string,
    @Body(new ZodPipe(closePeriodSchema)) body: z.output<typeof closePeriodSchema>,
    @Req() req: FastifyRequest,
  ): Promise<PeriodPack> {
    return this.periods.close(actor, period, body, req.ip);
  }
}
```
Service shape: `assertCan(...)` → `withMerchantTx(actor.merchantId, tx => { work; audit.recordIn })`.

## 9. Web side

- Add a method in `createApiClient` (`packages/api-client/src/client.ts`) that parses the reply
  with the contract schema (see `periods: { list, get, close }`); call it via `useApi()`
  (`packages/web-core/src/api-context.tsx`) + TanStack Query, as in
  `apps/manager-web/src/features/periods/PeriodsPage.tsx`. UI guards are cosmetic only.

## 10. Docs

Add a `Method & path | Permission` row (branch scoping, ADR/BR) to the API table in
`docs/ROUTES.md`; update `docs/PROGRESS.md` and touched docs (CLAUDE.md §5.7).

## 11. Integration tests (`<area>.int.test.ts`, run by `pnpm test:integration`)

Copy the harness of `apps/api/src/modules/periods/periods.int.test.ts`:
`prepareIntegrationDatabase()` (`testing/integration-db.ts`) → `createTestApp({ env: testEnv({
DATABASE_URL: prepared.runtimeUrl }), mailer })` (`testing/test-app.ts`) → `createCompany(app,
db, mailer)` (`testing/auth-fixtures.ts`), which gives owner `cookies`, `main` / second branch,
template `roles`, `hire(assignments, 'manager'|'pos')`, `ownerPos(branchId)`. Cover at least:
- happy path with the response shape and the audit row;
- **permission denied**: a hired role without the key gets 403, e.g.
  `const bm = await c.hire([{ roleId: c.roles.branch_manager, branchId: c.main }], 'manager');`
  `expect((await c.client.request('POST', path, { cookies: bm.cookies, body })).statusCode).toBe(403);`
- no session → 401; wrong interface (pos cookie on `/manager/*`) → 403 (TESTING.md §3.3);
- other branch: a branch-scoped role acting on `c.second` → 403;
- tenant isolation: a second `createCompany` cannot read/update the first's ids (404/403,
  TESTING.md §3.2); invalid body → 400 `VALIDATION_FAILED`.
Fixtures written through the `owner` pool bypass RLS: filter by `merchant_id` yourself
(CLAUDE.md §9). Then run `pnpm verify`, `pnpm test:integration`, `pnpm test:e2e`.
