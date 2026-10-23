---
name: security-audit
description: Project-specific security review checklist for Arabat (route access declarations, branch scoping, cross-merchant IDOR, public/store/device/print-agent endpoints, rate limits, Zod input, second-person approvals, logs, uploads, CSP, store-design XSS) and how to record findings in docs/audit/FINDINGS_STATUS.md. Use when asked to review a diff, PR or module for security, run a "security audit", before merging any new endpoint / public route / upload / token flow, or when a finding must be logged.
---

# Security audit (Arabat)

Review the diff (`git diff origin/main...HEAD`) or the named module against every section below.
For each hit, cite file:line and record it (last section). Related skills: `tenant-isolation`
(RLS, `withMerchantTx`, fixtures), `new-permission` (catalog, roles), `audit-log` (what to log),
`money-rules`, `cash-ledger`, `online-store`, `device-app`, `run-tests`.

## 1. Route access declaration
- Every handler has exactly one of `@Public`, `@Authenticated(iface)`, `@RequirePermission(iface, key)`,
  `@RequirePlatformRole(...)`, `@RequirePrintAgent`, `@RequireDevice`
  (`apps/api/src/kernel/access/access.decorators.ts`); `RouteAccessAuditor` refuses to boot otherwise.
- `@Authenticated` gives any signed-in user of that interface: flag it on anything that reads or writes
  business data; it should be `@RequirePermission` with the narrowest key (`packages/permissions/src/catalog.ts`).
- Interface must match the namespace: `/manager/*` → `'manager'`, `/pos/*` → `'pos'`; never reuse a
  manager permission on a POS route to "save a key" (CLAUDE.md §3.6–3.7, AUTH.md §3.3).
- Platform routes: `@RequirePlatformRole` only; a merchant session can never reach them (CLAUDE.md §3.8).
  Cross-merchant platform writes go through `withPlatformContext` (`apps/api/src/database/database.service.ts`).

## 2. Branch scoping (the guard is only a coarse gate)
- `AccessGuard` checks the permission at a branch **only** for the POS binding, `:branchId` or
  `?branchId` (`access.guard.ts`, `branchFromRequest`). A branch id in the **body** or reached via a
  record (sale, shift, transfer, register) is NOT checked: the service must call
  `assertCan(actor, key, branchId)` (`kernel/access/assert.ts`) for every affected branch.
- Lists and reports filter to `permissionBranchScope` / `branchesWithPermission`
  (`packages/permissions/src/evaluate.ts`); pattern: `branchScope` in `modules/reports/reports.service.ts`.
- Transfers touch two branches: check source and destination rights separately (ADR-0098).
- Merchant-scoped permissions granted at a branch grant nothing (AUTH.md §3.6) — do not add shortcuts.

## 3. Tenant context and IDOR
- `merchant_id` comes only from `request.actor` / `request.device` / `request.printAgent` / the store
  slug resolved server-side — never from body, query or header (CLAUDE.md §3.10, ADR-0004).
- Every lookup by id runs inside `withMerchantTx`/`withContext` and also filters `merchant_id`
  explicitly; `app_owner` code paths (seeds, CLIs, `database.db` outside a tx) are not RLS-filtered
  (CLAUDE.md §9, ADR-0105). Details: `tenant-isolation` skill.
- IDOR probes to reason through: id of another merchant's row (must 404, not 403-with-data), id of
  another branch of the same merchant, ids inside arrays (lines, variants, tenders, `overrideId`,
  `confirms_transfer_id`), and FK targets in writes (composite FKs `(merchant_id, id)`, AUTH.md §5).
- Anti-escalation: role grants via `canGrant`, member edits via `canManageMember`; never touch the owner
  or oneself (AUTH.md §3.6). Ownership changes only via `OwnershipService` (ADR-0104).

## 4. Public and token-authenticated surfaces
- Public controllers today: `auth`, `pin-sign-in`, `ecommerce` (store), `store-design`, `invitations`,
  `trials`, `links`, `site`, `pricing`, `devices`, `health` (`grep -rln "@Public()" apps/api/src`).
  Any new `@Public` route needs: a reason, Zod body, a `RateLimiterService.consume` key per IP (and per
  e-mail / account where relevant), and no internal ids, costs or staff data in the answer.
- Limits live in `AUTH_LIMITS` (`modules/auth/rate-limiter.service.ts`) and per-controller constants
  (e.g. `CHECKOUT_LIMIT`, `ACCOUNT_LIMIT` in `modules/ecommerce/ecommerce.controller.ts`); table in AUTH.md §2.2.
- No account enumeration: same answer and a dummy Argon2 verify for unknown e-mails; registration's 409
  is the only accepted exception (ADR-0025).
- Shopper tokens `st_…`: resolve with `StoreAccountsService.resolve` and then `assertStore(customer,
  merchantId)` so a token from store A is useless on store B (`store-accounts.service.ts`, ADR-0124).
- Device tokens: 43-char base64url, hashed lookup via `device_authenticate`; revoked → 401
  (`kernel/access/device-resolver.ts`, ADR-0112). Printing routes reject non-primary devices
  (`NOT_PRIMARY_DEVICE`, `access.guard.ts`).
- Print-agent socket (`modules/printing/print-agent.gateway.ts`): auth in the handshake, rooms by
  agent / company / branch only; any new emit must target a room scoped to one merchant.
- Secrets in links (`/orders/:token`, reset, invite, PIN-link `#key`) are stored as SHA-256 hashes
  (`kernel/crypto/tokens.ts`), single-use / expiring, and redacted from URLs in logs (`redactUrl`).
- Webhooks verify signatures over `rawBody` (`bootstrap.ts`); never trust a gateway status without it.

## 5. Input validation
- Every `@Body/@Query/@Param` with structure goes through `new ZodPipe(schema)` with a schema from
  `packages/contracts/src` (`kernel/validation/zod.pipe.ts`). Flag raw `body as X`, `z.any()`,
  unbounded strings/arrays (`.max()` missing), and `passthrough()` objects written to JSONB.
- Money fields are decimal strings parsed to bigint, never `number` (`money-rules`, CLAUDE.md §3.11).
## 6. Financial and stock invariants (bypass = security bug)
- Stock only via `StockLedgerService.apply`; cash only via `modules/payments/cash-ledger.ts`; records
  append-only (CLAUDE.md §4, §10). Any `update`/`delete` on a ledger, sale or refund table is a finding.
- Multi-step writes in one transaction; plan limits via `SubscriptionsService.assertCapacity` inside it.
- Second-person controls must hold server-side, including for the approver's own documents:
  deposits (ADR-0096), stock adjustments / counts (ADR-0097), transfer losses (ADR-0098), till
  overrides — cashier can't approve self, grant single-use, bound to membership+shift+branch, 10 min
  (ADR-0100, AUTH.md §7), own-sale refunds (ADR-0101), payouts above limit (ADR-0091/FND-408).
  Check: same user as requester refused, owner override flagged and audited, grant cannot be replayed.
- Selling decisions come from `packages/pos-core` via `rules()`; a service re-deciding a price, limit
  or right outside pos-core is a finding (ADR-0112).
- Closed periods: `assertPeriodOpen` on dated purchasing documents (ADR-0103).

## 7. Secrets, PII and logs
- Pino redacts only `REDACT_PATHS` (`kernel/logging/logger.ts`: auth header, cookies, `*.password`,
  `*.passwordHash`, `*.token` — one level deep). Never log bodies, PINs, TOTP codes, reset/invite keys,
  shopper tokens, card references or e-mails with free text; add a path when a new secret field exists.
- No secrets in the repo or in tests beyond dev defaults; production refuses dev secrets
  (`config/env.ts`, `DEV_SECRETS`). Error answers are problem+json without stack traces
  (`kernel/errors/problem.filter.ts`).

## 8. Uploads
- Bytes go through `toStorableImage` (sniffed type, pixel limit, re-encoded WebP, metadata dropped;
  `kernel/storage/image.ts`, ADR-0129) and then `FileStorage.put` with an app-generated key
  (`assertStorageKey`, `kernel/storage/file-storage.ts`). Never trust filename or content-type; never
  `fs.write` directly. Multipart limits: 2 MiB, 1 file (`bootstrap.ts`). Serve by row id read inside
  `withMerchantTx` (`catalog.service.ts` `readImage`), never by a client-given storage key.

## 9. Browser: CSP, CSRF, XSS
- CSP in `configureApp` (`bootstrap.ts`): scripts `'self' 'wasm-unsafe-eval'`, frames only YouTube
  nocookie / Vimeo / TikTok, `frame-ancestors 'self'`. Adding a CDN, inline script, `unsafe-eval` or
  a new frame/connect source needs an ADR. Fonts never as `data:` (CLAUDE.md §9).
- CSRF: per-interface cookies (`mgr_sid`/`pos_sid` Lax, `plat_sid` Strict) + `registerOriginCheck`
  (`kernel/http/origin-check.ts`, ADR-0026). New origins only via `TRUSTED_ORIGINS`.
- Store design / link pages are merchant-controlled content rendered to the public. No
  `dangerouslySetInnerHTML` / `innerHTML` exists in `apps/*/src` — keep it so; text is plain React
  text, no HTML or markdown rendering. Links must pass `isSafeLinkUrl` / `designLinkSchema`
  (`packages/contracts/src/store-design.ts`) or `linkUrlSchema` (`links.ts`, BR-200); videos via
  `videoEmbed` only; colours via hex regex. Any new `href`/`src`/`style` from merchant data needs one.
- Store sub-domains: build hosts only with `storeAddress` / `storePath` (ADR-0136); host parsing in
  `kernel/http/store-host.ts` must not let a crafted `Host` pick another merchant.

## 10. Tests
- Each fix ships an integration test that fails without it (other merchant / branch, missing
  permission, self-approval, replayed grant, 429). Run per `run-tests`; never skip a test.

## Recording findings — `docs/audit/FINDINGS_STATUS.md`
- One table row: `| FND-<n> | <finding, one line> | Critical/High/Medium/Low | <Ch.> | <package or —> | <Status> | <note> |`.
- Chapter letter = domain of `BUSINESS_PROCEDURES_MANUAL.md` (A access/identity, B inventory,
  C POS selling, D cash, E refunds/reports, F purchasing/transfers, G online store, H restaurant,
  I platform); id = next free number in that chapter's hundred (A → 1xx, … I → 9xx). Grep the file
  for the highest id first. Rows are grouped by severity, then id.
- Status: Open / In Progress / Fixed (merged, not re-verified) / Tested (covered by tests that ran,
  name the test file in the note) / Deferred (with the owner decision). Update the "Last update …
  Totals" line in the same edit. A significant fix also gets an ADR (`new-adr`).
- Report to the owner in Arabic; credentials or exploitable details stay out of commit messages.
