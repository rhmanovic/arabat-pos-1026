---
name: subscriptions-platform
description: Working map of the /platform operator realm, subscription plans and limits, free trials, the public pricing page and the landing "Our apps" menu. Use for any work in apps/platform-web, apps/landing-web, or the API modules platform-admin, subscriptions, trials, pricing, site or merchants (status, plan change, PLAN_LIMIT_REACHED, assertCapacity, a new limited resource, trial length, offer items, site_apps).
---

# Platform, subscriptions, trials and public site — working map

Nothing is billed and no payment gateway is live: plan prices and offer prices are display
values, subscription dates never block work, only an operator's suspension does (BR-155,
ADR-0082, ADR-0114 "Not done"). Never add charging, invoices or automatic suspension without
the owner's decision (CLAUDE.md §3.13).

## 1. Operator realm (separate from merchants)
- Operators are `platform_operators` rows created only by CLI (`apps/api/src/database/cli/create-operator.ts`,
  `pnpm --filter @arabat/api run platform:create-operator`), never through the API (BR-158, AUTH.md §8).
  Sign-in is `POST /auth/platform/login` then `/auth/platform/mfa` (TOTP mandatory).
- Roles: `platform.super_admin`, `platform.support`, `platform.billing` (`packages/permissions/src/catalog.ts`
  `PLATFORM_ROLES`). Groups `ANY` / `SUPPORT` / `BILLING` are declared per controller
  (`modules/platform-admin/platform.controller.ts`): billing + super admin change plans, subscriptions,
  offer items, trial settings and site apps; support + super admin change merchant status; only super
  admin closes a merchant or transfers ownership (BR-152).
- Every `/platform/*` route uses `@RequirePlatformRole(...)` (`kernel/access/access.decorators.ts`); the guard
  refuses any actor whose `realm !== 'platform'` (`kernel/access/access.guard.ts`), so merchant sessions
  never reach it. Use `@CurrentPlatformActor()` and `actor.operatorId`. Public endpoints use `@Public()`.
- Operators read across merchants only through `SECURITY DEFINER` summary functions (`platform_merchants`,
  `platform_overview`, `platform_audit`, `platform_plan_counts`, `platform_trial_activity`), never sales
  lines or customers (ADR-0080, BR-157). Do not add a query that reads merchant documents from platform code.

## 2. `withPlatformContext` and the operator triggers
- `DatabaseService.withPlatformContext(operatorId, merchantId | null, work)` (`apps/api/src/database/database.service.ts`)
  sets `app.merchant_id` and `app.operator_id` (SET LOCAL). Pass the merchant id when touching one
  merchant's rows (RLS), `null` for global tables.
- Triggers raise `insufficient_privilege` without an operator (`app_current_operator_id()`, migration
  `0028_platform_rls.sql`): `subscriptions` UPDATE, non-`created` `subscription_events`, `merchants.status`
  change (closed is final); also `offer_items` (0056), `sales_requests` UPDATE (0056), trial settings /
  device trials (0057), `site_apps` (0062). Any write to these tables must run in `withPlatformContext`.
- Fixtures and seeds running as owner must call
  `select set_config('app.operator_id', gen_random_uuid()::text, true)` first (CLAUDE.md §9).
- Audit platform actions with the operator as actor and the merchant as event owner (ADR-0080).
- Merchant status / ownership: `modules/platform-admin/platform.service.ts`, `modules/merchants/controls.service.ts`,
  `modules/merchants/ownership.service.ts` (ownership moves only through `OwnershipService`, ADR-0104).

## 3. Plans, subscriptions and limits (ADR-0081, BR-150–156)
- Tables in `modules/subscriptions/subscriptions.schema.ts`: global `plans` (nullable `max_*` = unlimited,
  `features` `restaurant` / `ecommerce`, `trial_days`, informational price), one `subscriptions` row per
  merchant, append-only `subscription_events`. Plans are archived, never deleted.
- `SubscriptionsService.createInitial` opens the first subscription (registration, onboarding, seeds);
  `current()` creates the default one if missing.
- `assertCapacity(tx, merchantId, limit, adding = 1)` must be called **inside the same transaction as the
  insert / reactivation it guards** (BR-151). It takes a share lock on unlimited plans and an update
  lock on limited ones; never take share then update yourself (deadlock note in the service). Callers:
  `branches.service.ts` (branch + its default register), `registers/shifts.service.ts`, `iam/employees.service.ts`
  (invitations count), `catalog/catalog.service.ts`. Features: `assertFeature` in restaurant-config and ecommerce.
- Plan changes go through `planCheck` and are refused with `PLAN_CHANGE_BLOCKED` if usage or a feature in
  use does not fit; data is never disabled (BR-154).

### Adding a new limited resource
1. Contracts `packages/contracts/src/platform.ts`: add the key to `PLAN_LIMITS` and to the plan `limits`
   objects (view + save schema); then `pnpm build:packages`.
2. Migration (skill `new-migration`): `plans.max_<x>` nullable integer + CHECK `>= 0` like the others in
   `subscriptions.schema.ts`; decide the value for the seeded plans (`standard` stays unlimited).
3. `subscriptions.service.ts`: `LIMIT_COLUMN`, `toPlan`, and a counted subquery in `usage()` (active rows
   only, filtered by `merchant_id`).
4. `platform.service.ts` plan create / update mapping (around `maxRegisters: input.limits.registers`).
5. Call `assertCapacity(tx, merchantId, '<x>')` in every create **and** reactivate path of the resource.
6. UI: `apps/platform-web/src/pages/PlansPage.tsx` and `apps/manager-web/src/features/subscription/SubscriptionPage.tsx`
   iterate `PLAN_LIMITS`; add `limit_<x>` strings in both apps' `src/i18n/ar.ts` and `en.ts`.
7. Tests: extend `describe('plan limits')` in `modules/platform-admin/platform.int.test.ts` (limit hit,
   reactivation, concurrent creations); update BR-151 (skill `new-adr`) and DATABASE.md.

## 4. Free trials and the funnel (ADR-0115 + amendments 1–3)
- Module `modules/trials`. Public: `GET /public/trial` (offer: price, trial lengths), `POST /public/trial/events`
  (anonymous steps `business` / `devices` / `account`), `POST /public/trial/start`. No e-mail code any more
  (amendment 1); `trial_signups` and the `receipt` stage remain unused — do not drop them.
- `start` rate-limits per IP, refuses a taken e-mail (`EMAIL_TAKEN`), then calls
  `RegistrationService.createAccount` (`modules/auth/registration.service.ts`, shared with `/manager/register`)
  with `trialDays` and an `after(tx, ids)` callback that writes the lead and device request **in the same
  transaction**. Sales e-mails are sent after commit. Add new sign-up side effects through `after`, not
  after the call.
- Every trial number is an operator setting (`trial_settings`: `trialDaysOwn`, `trialDaysDevices`;
  `offer_items.trial_stock`) at `/platform/trials/*`. The account opens with `trialDaysOwn`; marking a device
  trial `delivered` extends the trial to at least `trialDaysDevices` from then (`extendTrial`). The settings
  override `plans.trial_days`, which applies only to other registrations.
- Device availability = `trial_stock` minus units in `approved` / `delivered` requests; status moves are the
  `NEXT` table in `trials.service.ts`.

## 5. Pricing page and offer items (ADR-0114)
- Module `modules/pricing`: global `offer_items` (`system` single active item + `device`), `sales_requests`.
  Public `GET /public/pricing`, `GET /public/pricing/images/:id`, `POST /public/pricing/requests`
  (5 per IP per hour, unused by the site since amendment 3). Operator API `/platform/offer-items`,
  `/platform/sales-requests`; UI routes `/platform/offer` (`OfferPage.tsx`) and `/platform/requests`.
- Prices are `bigint` fils computed on the server; the page's `@arabat/money` totals are display only.
  Photos go through `FileStorage` + `toStorableImage` (CLAUDE.md §9).
- The pricing form posts `/public/trial/start` (amendment 3); every main call to action links to `/pricing`.

## 6. Public site apps menu (ADR-0117)
- Module `modules/site`, global `site_apps` (no RLS, operator-only trigger, deleting allowed and audited
  `site.app.deleted`). `GET /public/site/apps`; `/platform/site-apps` read by any operator, written by
  super admin + billing with `version` (409 on stale). Addresses: site path or `http(s)://` only (contract +
  DB CHECK). UI `SiteAppsPage.tsx`; landing `src/apps-menu.tsx` hides the menu when the list is empty.

## 7. Front ends
- `apps/platform-web` (basename `/platform`): routes in `src/routes.tsx`, pages in `src/pages/`, strings in
  `src/i18n/{ar,en}.ts` (both required, RTL/LTR).
- `apps/landing-web` (ADR-0113): three Vite inputs `index.html` (`/`), `pricing.html` (`/pricing`),
  `start.html` (`/start`); no session, no router; copy in `src/content.ts`; own `@theme` in
  `src/styles.css` (not `@arabat/ui`). Served by `apps/api/src/web/serve-web.ts`.

## 8. Tests
Use skill `run-tests` for commands and fixtures. Relevant suites:
- Integration: `modules/platform-admin/platform.int.test.ts` (access, oversight, status, plan limits,
  onboarding), `trials/trials.int.test.ts`, `pricing/pricing.int.test.ts`, `site/site.int.test.ts`,
  `merchants/controls.int.test.ts`, `merchants/ownership.int.test.ts`. Operators in tests are made with
  `upsertOperator` (`platform-admin/operators.ts`) and signed in through login + MFA (see `operator()` helper
  in `platform.int.test.ts`).
- Web: `apps/platform-web/src/{app,platform,site-apps}.test.tsx`, `apps/landing-web/src/*.test.ts(x)`,
  `apps/manager-web/src/features/subscription/subscription.test.tsx`.
- Always test both the allowed role and a refused role / merchant session for a new `/platform` route.
