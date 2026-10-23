---
name: audit-log
description: How to write, name, shape and test audit-log entries (audit_log, AuditService.recordIn, diffFields) and variant price/cost history (price_history). Use when adding or changing any security, permission/role, financial, override, reprint, cleared-cart, report-view/export or platform-operator action, when a feature must "be audited", or when touching the manager/platform audit pages.
---

# Audit log and history

Rule of the house: security-relevant and financial actions are written to an audit log, and
records are append-only (CLAUDE.md §4). Schema/migration work goes through the `new-migration`
skill; running tests through `run-tests`; a new rule worth recording through `new-adr`.

## Where things live

| What | Path |
|---|---|
| Service (`recordIn`, `record`, `listForMerchant`) | `apps/api/src/modules/audit/audit.service.ts` |
| Table `audit_log` | `apps/api/src/modules/audit/audit.schema.ts` |
| Merchant read API `GET /manager/audit` (`audit.read`) | `apps/api/src/modules/audit/audit.controller.ts` |
| Field diff `diffFields` / `hasChanges` | `apps/api/src/kernel/audit-diff.ts` |
| `price_history` table / writer / reader | `modules/catalog/catalog.schema.ts`, `catalog.service.ts` (`history`, `priceHistory`) |
| Platform read `GET /platform/audit` (`SUPPORT` roles) | `modules/platform-admin/platform.controller.ts` → SQL fn `platform_audit` (`drizzle/0028_platform_rls.sql`) |
| Manager page (`/manager/audit`, guard `audit.read`) | `apps/manager-web/src/features/audit/AuditLogPage.tsx` (+ `audit.test.tsx`) |
| Platform page | `apps/platform-web/src/pages/AuditPage.tsx` |
| Integration test of the read API | `apps/api/src/modules/audit/audit.int.test.ts` |

## What must be audited

- Auth/security: sign-ins (failed), lock-outs, password change/reset, sessions revoked, PIN set/reset,
  POS lock/unlock, device register/revoke (`auth.*`, `employee.*`, `device.*`; `modules/auth/login.service.ts`).
- Permissions: role create/update/delete (delete stores the permission set, BR-191),
  `employee.roles_changed` with `before`/`after` assignments (`modules/iam/employees.service.ts`).
- Ownership transfer/freeze (ADR-0104, BR-020) and every platform-operator write (`platform.*`).
- Financial: sales, voids, refunds, cash movements, bank deposits/reconciliation, stock adjustments,
  period close, settings that change limits (`sales.settings_updated`).
- Overrides: `sale.override_granted` / `_refused` (ADR-0100, `modules/sales/overrides.service.ts`).
- Reprints `sale.reprinted`, cleared carts `cart.cleared` / `cart.line_removed` above the
  company threshold (ADR-0101, BR-182, `modules/sales/sales.service.ts`).
- Report views `report.viewed` and CSV exports `report.exported` with period and scope
  (BR-187, ADR-0102, `modules/reports/reports.service.ts`).
- Master-data edits with old/new values: company profile, branches, employee profiles,
  categories, products and per-variant price/cost, suppliers, draft purchase orders (BR-191).

## Writing an entry

Use `recordIn(tx, event)` inside the **same transaction** as the change, so the entry commits or
rolls back with it (`audit.service.ts`). Inject `AuditService` as a value import (NestJS DI, CLAUDE.md §9).

```ts
return this.database.withMerchantTx(actor.merchantId, async (tx) => {
  const before = await this.load(tx, id);
  await tx.update(things).set(fields).where(eq(things.id, id));
  await this.audit.recordIn(tx, {
    merchantId: actor.merchantId,       // never from the client
    actorType: 'user',                  // 'user' | 'operator' | 'anonymous' | 'system'
    actorId: actor.userId,
    action: 'thing.updated',
    targetType: 'thing',
    targetId: id,                       // uuid column: put non-uuid refs in details
    ip,                                 // controller passes req.ip
    details: { changes: diffFields(before, fields, Object.keys(fields) as (keyof typeof fields)[]) },
  });
});
```

- Most services wrap this in a private `record(tx, actor, action, targetType, targetId, ip, details)`
  helper (e.g. `catalog.service.ts`, `employees.service.ts`); follow the module's existing helper.
- `record(event)` (own transaction, swallows errors) is only for events with no other write:
  failed sign-ins (`login.service.ts`) and `report.exported` (`reports.service.ts`).
- Platform writes: inside `withPlatformContext`, `actorType: 'operator'`, `actorId: actor.operatorId`,
  `merchantId` of the affected merchant or `null`; `PlatformService.record` adds `operatorRole`
  (`platform-admin/platform.service.ts`). Rows with `merchant_id` NULL never show to merchants (BR-163).
- Shopper (store account) events use `actorType: 'anonymous'`, `targetType: 'customer_account'`
  (`ecommerce/store-accounts.service.ts`).
- Money in `details` as decimal strings via `Money...toDecimalString()` (e.g. `cart.cleared`), never floats.
- SQL-only audit rows (migrations) use `actor_type 'system'` (`drizzle/0033_cash_custody_rules.sql`).

## `changes` via diffFields

`diffFields(before, after, keys)` returns only changed keys as `{ field: { from, to } }`;
`undefined`/`null`/`''` compare equal, dates become ISO text, bigints strings (`kernel/audit-diff.ts`,
BR-191). Pass an explicit key list for the fields the user may edit (e.g. `['jobTitle','phone','employeeCode']`
in `employees.service.ts`); use `hasChanges(diff)` to skip no-op edits. Store under `details.changes`
(`catalog.service.ts`, `branches.service.ts`, `merchants.service.ts`); a settings change may spread the
diff into `details` directly (`sales.settings_updated`, see `audit.int.test.ts`).

## Action names

`<domain>.<past_tense_event>` in lower snake case, optionally `<domain>.<object>.<event>`. Reuse the
module's prefix; grep before inventing one:
`grep -rhoE "action: '[a-z_]+\.[a-z_.]+'" apps/api/src | sort -u`.
Existing patterns: `auth.login.failed`, `auth.password_changed`, `employee.roles_changed`, `role.deleted`,
`product.updated`, `catalog.discount_created`, `sale.completed`, `sale.voided`, `refund.approved`,
`inventory.adjustment_requested`, `period.closed`, `bank.reconciled`, `report.viewed`,
`merchant.ownership_transferred`, `platform.merchant.suspended`, `platform.plan.created`, `online.order_handed_over`.
The manager filter matches substrings of `action` (`listForMerchant`), so keep prefixes consistent.

## Never log

- No passwords, hashes, tokens, PINs, reset/invite codes, session ids, API keys or card data.
- Personal data only as far as the event needs: ids over names/e-mails. Accepted exception:
  `auth.login.failed` stores the typed e-mail because there is no user id (`login.service.ts`).
- Notes/reasons the user typed for overrides are kept (`overrides.service.ts`); they are business data.

## Append-only

`audit_log`: `UPDATE, DELETE` revoked from `app_runtime`, RLS insert only for the current merchant
or NULL (`drizzle/0003_identity_rls.sql`); entries can never be edited or deleted (BR-163). Never add an
update/delete path; corrections are new entries. New history tables follow the same pattern
(RLS + `REVOKE UPDATE, DELETE`, see `new-migration`).

## price_history (ADR-0104, BR-191)

- Every change of a variant's selling price or cost appends a row (`kind` `price`|`cost`,
  `from_minor`/`to_minor` bigint, `source` `manual`|`created`, `changed_by_user_id`) via
  `CatalogService.history` from `saveVariants`, in the same transaction; creation writes `source: 'created'`.
- Insert-only with RLS (`drizzle/0047_ownership_hygiene_history.sql`). Read via
  `GET /manager/products/:id/price-history`; cost rows only with `catalog.prices.manage`.
- It complements, not replaces, the `product.updated` audit entry (which carries `variants` diffs).
- Product discounts never change catalog prices, so they do not write price_history (ADR-0133).

## Tests

- Integration (`*.int.test.ts`): the `owner` pool is not filtered by RLS, so filter by `merchant_id` / `target_id` yourself (CLAUDE.md §9):
  ```ts
  const audit = await owner.query(
    `select details from audit_log where action = 'product.updated' and target_id = $1`, [p.id]);
  expect(audit.rows[0].details.variants).toContainEqual({ variantId: small.id, price: { from: '3.000', to: '2.750' } });
  ```
  (`modules/catalog/catalog.int.test.ts`; more in `sales.int.test.ts`, `sales-overrides.int.test.ts`,
  `discounts.int.test.ts`, `platform-admin/platform.int.test.ts`).
- Through the API: `GET /manager/audit?action=...` returns `actorType`, `targetType`, `targetId`, `details`,
  and another company cannot see it (`audit.int.test.ts`).
- Assert also that a rolled-back/refused action leaves **no** entry, and that `details` holds no secret.
