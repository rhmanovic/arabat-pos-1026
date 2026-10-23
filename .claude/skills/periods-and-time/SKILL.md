---
name: periods-and-time
description: Rules for dates, the merchant's time zone, report periods, report access logging and the month-end close. Use when a task filters or groups by a date range, adds or changes a report, statement, dashboard figure or CSV export, touches `merchants.timezone`, `period_closes`, `/manager/periods`, or a document that carries a business date (purchase orders, receipts).
---

# Periods, time zones, reports and month close

Rules come from BR-184…BR-190 (`docs/BUSINESS_RULES.md`), ADR-0102 and ADR-0103
(`docs/DECISIONS.md`). Read those entries before changing behaviour; a new rule needs an ADR/BR
(skill `new-adr`), a new column or table a migration (skill `new-migration`).

## 1. One clock per company (BR-184)

- Every cut is made on the merchant's local calendar days in `merchants.timezone` (default
  `Asia/Kuwait`, `DEFAULT_TIMEZONE`). Never use the server clock's zone, UTC days, or the branch
  time zone column (kept but unused, FND-306, ADR-0102).
- Store instants as `timestamptz` (`createdAt()` / `updatedAt()` in
  `apps/api/src/database/schema/columns.ts`). Business dates (`purchase_orders.document_date`,
  `purchase_receipts.received_on`) are plain `date` columns already expressed in the merchant's
  zone. The migration default `current_date` is the DB zone: always set the value from the
  service (`businessDate`, below), never rely on the default.
- The zone is validated with `Intl` (`assertTimezone` / `isValidTimezone`), accepted at
  registration (`company.timezone`) and on `PATCH /manager/merchant`; a change needs
  `merchant.settings.update`, stamps `timezone_changed_at` and audits
  `merchant.timezone_changed` (from → to). Changing it re-cuts every past day.

## 2. Cut ranges only through `apps/api/src/kernel/time/period.ts`

| Need | Use |
|---|---|
| Zone inside a merchant tx | `merchantTimezone(tx, merchantId)` |
| `column` in local days [from, to] (either optional) | `withinLocalDays(tz, column, from, to)` → `>= dayStart(from)` and `< dayEnd(to)` (half-open) |
| Day bounds as SQL timestamptz | `dayStart(tz, date)`, `dayEnd(tz, date)` (exclusive = next day 00:00) |
| Group by local day | `localDay(tz, column)` → `'YYYY-MM-DD'` |
| Today in the zone (JS) | `todayIn(tz, now?)` |
| Local day start as a JS `Date` | `localDayStart(tz, date)` (DST-safe two-pass probe) |
| Date arithmetic | `addDays(date, n)` on `'YYYY-MM-DD'` strings |
| Month 'YYYY-MM' → first/last day | `monthBounds(period)` in `apps/api/src/modules/periods/periods.service.ts` |

- Never write `::date`, `date_trunc`, `at time zone 'UTC'`, `new Date().toISOString().slice(0,10)`
  or `<= to 23:59:59` for a period. There is no week helper: build weeks from `addDays` on local
  dates, not from Postgres `date_trunc('week')`.
- Pass outer columns as `sql.raw('s.created_at')` (qualified; CLAUDE.md §9 Drizzle gotcha).

## 3. Which timestamp a record counts on (BR-184, BR-190)

- Sale: its completion (`sales.created_at`; a sale row is written at completion).
- Refund: `completed_at` (status `completed`) in reports; the refund register uses
  `coalesce(completed_at, created_at)` so a pending refund sits on its request day
  (`apps/api/src/modules/refunds/refunds.service.ts`). Refunds of a period are those completed in
  it, not the refunds of the listed sales; sales-history "net" = report "net after refunds".
- Cash entries, disbursements, variances, stock movements: posting time (`created_at`). They are
  stamped at posting and cannot be backdated.
- Purchasing: the business date is what the period lock checks; the posting time stays the basis
  of stock and purchasing reports and of the supplier statement.
- Statements (cash account `GET /manager/cash/accounts/:id/entries`, supplier
  `GET /manager/suppliers/:id/statement`) take `from`/`to`, compute the running balance over all
  lines and return the balance brought forward (`localDayStart` for the cut, ADR-0102).
- Supplier statement (BR-188, `apps/api/src/modules/cash/cash-payouts.service.ts`
  `supplierStatement`, `purchasing.read`, branch-scoped): receipts valued at order cost
  (`quantity × purchase_order_lines.unit_cost_minor`) vs. supplier payments and reversals;
  positive balance = owed to the supplier.

## 4. Month close (BR-189, ADR-0103)

- `period_closes` (migration `apps/api/drizzle/0046_period_close.sql`): one row per merchant and
  'YYYY-MM', with day bounds, zone, closer, note and the pack JSONB; RLS; no update/delete for
  `app_runtime`. A close is final: no reopen endpoint, ever (by design).
- `PeriodsService` (`apps/api/src/modules/periods/periods.service.ts`): statuses `closed` /
  `closable` / `open` / `current`. Close only an ended month, in order, starting with the
  registration month (`firstMonth`), else `PERIOD_NOT_CLOSABLE` (409). The pack is built from
  `ReportsService.sales / payments / inventory` plus direct ledger queries, stored as computed,
  audited `period.closed`. An open month returns the same pack computed live.
- Rights: reading `reports.financial`; closing `periods.close` plus `reports.sales`,
  `reports.financial`, `reports.inventory` company-wide (`assertFullScope`) — a pack is never
  partial (`packages/permissions/src/catalog.ts`, `templates.ts`).
- If you add a figure to the pack, change `PeriodPack` in `packages/contracts/src/periods.ts`
  and keep old stored packs readable (they are never rewritten).

## 5. Document dates and the lock (BR-190)

- Any service that accepts a business date goes through a `businessDate`-style helper
  (`apps/api/src/modules/purchasing/purchasing.service.ts`): default `todayIn(tz)`, at most 7 days
  back, never ahead (`VALIDATION_FAILED`), then `assertPeriodOpen(tx, merchantId, date)` →
  `PERIOD_CLOSED` (409). Call it inside the writing transaction; put a backdated date in the
  audit entry.
- A new document type with a user-chosen date must do the same and be added to the pack's
  document counts. Posted-at-entry records (sales, refunds, cash, stock) need no lock.

## 6. Adding or changing a report

1. Contract in `packages/contracts/src/reports.ts`: reuse `reportQuerySchema` (`from`, `to`
   ≤ 366 days, optional `branchId`, `employeeId`) and return `period` (`reportPeriodSchema`, incl.
   `timezone` and the previous same-length period). Add the report name to the
   `reportExportSchema.report` enum. Run `pnpm build:packages`.
2. Controller `apps/api/src/modules/reports/reports.controller.ts`: `@RequirePermission('manager',
   'reports.sales' | 'reports.financial' | 'reports.inventory')`, `@Query(new ZodPipe(...))`,
   pass `req.ip`. A new permission goes in `packages/permissions/src/catalog.ts` + templates.
3. Service `ReportsService`: one `withMerchantTx`; `this.context(tx, actor, permission, query)`
   (re-checks branch scope — `branchId` via `assertCan`, else the permission's branch scope);
   filter with `this.within(c, …)`, `this.branches(c, …)`, `this.member(c, …)`; zero-fill days
   with `eachDay`; sum money as integer minor units in SQL (`sum(...)::text` → bigint → `money()`),
   never floats (CLAUDE.md §3.11); figures needing a wider right check `coversScope` (e.g.
   profit needs `reports.financial` for the whole scope, BR-185).
4. Call `this.viewed(tx, actor, '<report>', c, ip)` in the same transaction (`report.viewed`,
   BR-187). Report-like pages outside `ReportsService` must audit their views too.
5. Web: render tables with the shared table in `apps/manager-web/src/features/reports/shared.tsx`
   inside `ReportExportContext` so the browser CSV export calls `api.reports.logExport`
   (`POST /manager/reports/exports`, `report.exported`). There is no server-side CSV (ADR-0102).
   Arabic and English strings, logical Tailwind classes.

## 7. Tests (skill `run-tests` for commands and fixtures)

- Integration patterns: `apps/api/src/modules/reports/period-controls.int.test.ts` (Kuwait
  offset helpers `today()`, `kuwaitDayStart()`, moving `created_at` with the owner pool) and
  `apps/api/src/modules/periods/periods.int.test.ts` (backdating `merchants.created_at`, closing
  in order, `PERIOD_CLOSED` on a purchasing date).
- For every new date filter cover: a row at 23:30 local the day before (outside), at 00:00 and
  01:30 local (inside, still the previous UTC day for Kuwait UTC+3), a refund completed on a
  later day than its sale, and the `to` day's last minute vs. next day 00:00.
- Kuwait has no DST; when touching `period.ts` also test a DST zone (e.g. `Europe/London`
  last Sunday of March/October, `America/New_York`) and a zone west of UTC
  (`America/Los_Angeles`) plus a non-whole-hour one (`Asia/Kolkata`). No unit test for
  `period.ts` exists yet; a pure one belongs at `apps/api/src/kernel/time/period.test.ts`.
- Assert the audit rows (`report.viewed`, `report.exported`, `period.closed`) and the 403 for a
  branch-limited actor.
