---
name: new-permission
description: Add, rename or re-scope a merchant permission key, change a default role template, or gate an endpoint/screen behind a permission (packages/permissions, roles editor, POS/manager access, supervisor overrides). Use whenever a feature needs a new right, a role should gain or lose a right, or a question comes up about can(), branch scope, owner, platform roles or sale_overrides.
---

# Adding or changing a permission

Sources: `docs/AUTH.md` §3–§8, `packages/permissions/src/{catalog,evaluate,templates}.ts`,
BR-012..BR-024 and BR-177 in `docs/BUSINESS_RULES.md`.

## 1. Decide the key and scope
- Key format `area.resource.action` or `area.action`, lower-case, dot-separated
  (`sales.discount.override_limit`, `cash.deposit`). Keys are code-defined; merchants only
  compose them into roles and cannot invent keys (catalog.ts header, AUTH.md §3.1).
- Scope (catalog.ts):
  - `branch` — granted per branch; a merchant-wide assignment (`branch_id NULL`) grants it at
    every branch. Use for anything done *at* a branch (selling, stock, shifts, branch staff).
  - `merchant` — only a merchant-wide assignment grants it; inside a role assigned at one branch
    it grants nothing (AUTH.md §3.6). Use for company-wide master data and settings
    (`catalog.manage`, `periods.close`, `online.manage`, `roles.manage`).
- Prefer a new narrow key over widening an existing one (least privilege, e.g. `cash.deposit`
  on top of `cash.move`, ADR-0091). A new key that changes who may do something financial or
  security-relevant is a significant decision: record it with the `new-adr` skill.

## 2. Edit the catalog (`packages/permissions/src/catalog.ts`)
- Add `'key': { scope, group, description }` to `PERMISSIONS` under its group comment.
  `description` is English; it is served by `GET /api/v1/manager/permissions` (iam.controller.ts) and
  quoted to the POS assistant (`assistant.prompt.ts`), so write it as a plain sentence.
- A new group: extend `PermissionGroup` here and add `permGroup.<group>` labels (step 4).
- Rename: never silently change a key. Add the old→new pair to `RENAMED_PERMISSIONS`
  (templates.ts) and write a data migration that rewrites `role_permissions` (precedent
  `apps/api/drizzle/0005_employees_rls.sql`: insert new key `ON CONFLICT DO NOTHING`, delete old).
- Platform operators are **not** in this catalog: they use the small fixed `PLATFORM_ROLES`
  list and `@RequirePlatformRole(...)` (catalog.ts, AUTH.md §8, ADR-0007). Never give a merchant
  key to an operator or a platform role to a merchant user (BR-015).

## 3. Default roles (`packages/permissions/src/templates.ts`)
- Templates: `company_manager`, `branch_manager`, `supervisor`, `cashier`, `treasurer`,
  `kitchen`. Owner is not a role: `memberships.is_owner` implies every permission at every
  branch in both merchant interfaces (BR-020, `can()` returns true).
- `company_manager` / `branch_manager` never get `pos.access`; `cashier` never gets
  `manager.access` (BR-013, BR-014; asserted in `evaluate.test.ts`). Do not add `cash.move` to
  `cashier` (ADR-0090).
- **Existing merchants are not updated automatically.** `provision.ts`
  (`apps/api/src/modules/merchants/provision.ts`) copies templates only for new merchants, and
  seed `apps/api/src/database/seeds/002-role-templates.ts` only adds *missing templates*; it
  never changes an existing role (merchants customise them). Consequence: a new key reaches
  existing companies only through the owner (implicit) or a role edit. Precedent:
  `sales.zero_total`, `cash.deposit`, `periods.close` shipped with no backfill.
- Backfilling existing roles changes merchants' customised data → ask the owner first and
  record an ADR. If approved, write a data migration (`new-migration` skill) that targets
  `roles.template_key`, uses `ON CONFLICT DO NOTHING`, and writes one `audit_log` row per role
  (`actor_type 'system'`, `action 'role.permissions_changed'`, ADR in `details`) — copy
  `apps/api/drizzle/0033_cash_custody_rules.sql` (removal of `cash.move`). A brand-new template
  needs no migration: `002-role-templates` adds it on the next `db:seed` (ADR-0094 treasurer).

## 4. Labels in the roles editor (manager-web)
- Add `perm['<key>']` to `apps/manager-web/src/i18n/en.ts` **and** `ar.ts` (and
  `permGroup.<group>` for a new group). `ar.ts` is typed `ManagerResources`, so a key present
  in `en.ts` but missing in `ar.ts` fails typecheck; a key missing from both silently shows the
  raw key (`usePermissionLabel` in `apps/manager-web/src/app/context.tsx`) — check both.
- `RolesPage.tsx` renders the catalog from the API grouped by `group`, shows scope and disables
  keys the editor does not hold; no code change is needed for an ordinary key.

## 5. Enforce it on the backend (default deny)
- Every route carries exactly one of `@Public`, `@Authenticated`, `@RequirePermission(iface,
  key)`, `@RequirePlatformRole`, `@RequirePrintAgent`, `@RequireDevice`
  (`apps/api/src/kernel/access/access.decorators.ts`); a route without one makes the API refuse
  to boot (`route-access.auditor.ts`).
- `can()` (evaluate.ts) denies unknown keys, inactive memberships and suspended merchants (even
  owners), and branch keys without a matching branch. With a branch in the request the guard
  checks that branch; otherwise only `canAnywhere`, so the service must `assertCan` per branch
  and filter SQL with `permissionBranchScope` (AUTH.md §4, BR-021). Never trust a client branch.
- Interfaces: `/manager` needs `manager.access`, `/pos` needs `pos.access` at the chosen branch
  (`POS_ACCESS_DENIED`); neither implies the other; managers reach the POS only with an explicit
  `pos.access` assignment at that branch (AUTH.md §3.3, BR-013/014). Both are re-checked on every
  request (`db-session.resolver.ts`). Hiding a nav item (`navigation.ts`) is UX only.
- Owner: never removable, demotable or manageable by others (`canManageMember`); granting needs
  `employees.manage` plus every granted key at that branch (`canGrant`); role editors may only
  include keys they hold merchant-wide (`roles.service.ts`) → `403 PRIVILEGE_ESCALATION`
  (AUTH.md §3.6).
- Selling rights: decide them in `packages/pos-core` and check them in `completeSaleInTx`, not in
  the controller (ADR-0100, ADR-0112). If a cashier may borrow the right from a supervisor at the
  till, add it to `OVERRIDABLE_PERMISSIONS` (`packages/contracts/src/sales.ts`); `lendableRights`
  (`packages/pos-core/src/overrides.ts`) then lends it through a single-use 10-minute
  `sale_overrides` grant (`POST /pos/overrides`, BR-177, AUTH.md §7). Device tills receive the
  user's keys through `device-sync.service.ts` — see the `device-app` skill.
- Plan features (`SubscriptionsService.assertFeature`, e.g. `restaurant`, `ecommerce`) are
  checked in addition to permissions, never instead of them (AUTH.md §3.2).

## 6. Rebuild and test
- `pnpm build:packages` after editing `permissions` or `contracts` (the API reads `dist/`;
  `pnpm typecheck` also builds them; CLAUDE.md §9).
- Unit: extend `packages/permissions/src/evaluate.test.ts` (scope behaviour, template
  assertions; it already checks every template key exists in the catalog).
- Integration (`*.int.test.ts`, fixtures in `apps/api/src/testing/auth-fixtures.ts`): the new
  endpoint answers 403 without the key, 403 at another branch for a branch key, 403 for a
  branch-only assignment of a merchant key, 200 for the owner; escalation cases in
  `apps/api/src/modules/iam/iam.int.test.ts`; override cases in
  `apps/api/src/modules/sales/sales-overrides.int.test.ts`.
- Web: a manager-web test that the gated screen/button is hidden without the key.
- Run everything with the `run-tests` skill (`pnpm verify`, `pnpm test:integration`,
  `pnpm test:e2e`).

## 7. Docs
- Update the catalog table in `docs/AUTH.md` §3.4 (and §3.5 if a template changed), the BR that
  motivates the right in `docs/BUSINESS_RULES.md`, and `docs/PROGRESS.md`.
