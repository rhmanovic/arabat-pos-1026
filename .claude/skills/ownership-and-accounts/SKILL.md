---
name: ownership-and-accounts
description: Working map of merchant sign-in, sessions, memberships, branch role assignments, employee invitations, password reset, the protected owner, ownership transfer and the platform's owner freeze. Use for any change to apps/api/src/modules/auth, iam (employees, invitations), merchants/ownership.service.ts, the owner-freeze / ownership-transfer platform endpoints, or the manager /account, accept-invite and reset-password pages.
---

# Accounts, sessions and ownership

Read first: `docs/AUTH.md` (§2 sessions, §3 authorization, §6 employee lifecycle), BR-010..015,
BR-020..025, BR-043, BR-192, BR-193 in `docs/BUSINESS_RULES.md`, ADR-0104 in `docs/DECISIONS.md`.
Permission keys and the catalog: `new-permission` skill. PIN sign-in on tills: `device-app` skill.
Running it locally (demo accounts, Mailpit `http://localhost:8025`): `run-api-locally` skill.

## Identity model
- Two realms that never mix (ADR-0007, AUTH.md §1): merchant `users` + `memberships`, platform
  `platform_operators` (TOTP mandatory, created only by CLI, AUTH.md §8). Same e-mail = two identities.
- Tables: `users`, `memberships`, `roles`, `role_permissions`, `role_assignments`, `invitations`,
  `invitation_assignments` (`apps/api/src/modules/iam/iam.schema.ts`); `sessions`, `auth_tickets`,
  `password_reset_tokens`, `rate_limit_buckets` (`auth/auth.schema.ts`); `ownership_transfers`,
  `merchants.owner_frozen_at/_reason` (`merchants/merchants.schema.ts`).
- Role assignment = `(membership, role, branch_id | NULL)`; NULL = all branches (AUTH.md §3.1).
  Evaluation is `can()` in `packages/permissions/src/evaluate.ts`; the owner (`memberships.is_owner`)
  passes every check. `manager.access` and `pos.access` are independent (BR-013/014).
- Exactly one owner per merchant and the owner is always active: DB index
  `memberships_one_owner_per_merchant` and check `memberships_owner_active`
  (`apps/api/drizzle/0002_identity.sql`). Never write `is_owner` outside `OwnershipService.transfer`.

## Sessions (`apps/api/src/modules/auth/`)
- Opaque 256-bit token in an HttpOnly cookie, only its SHA-256 in `sessions` (`session.service.ts`).
  One cookie per interface, path `/api/v1`: `mgr_sid`, `pos_sid` (Lax), `plat_sid` (Strict); idle /
  absolute lifetimes in `session-policy.ts` (manager 60 min / 12 h, pos 8 h / 16 h, platform 15 min / 8 h).
  No bearer tokens for merchant users (shopper `st_…` tokens belong to the `online-store` skill).
- `DbSessionResolver` (`db-session.resolver.ts`) re-validates on **every request**: user active,
  `password_changed_at` not after session creation, membership + merchant active, owner not frozen,
  interface permission still held, POS bound branch still eligible. Failing sessions are revoked
  (`context_invalid`). So deactivation / permission removal needs no extra session code (BR-023).
- POS lock: `POST /auth/pos/lock` → resolver answers `401 SESSION_LOCKED` until
  `POST /auth/pos/unlock` with the same user's password (`pos-lock.service.ts`, ADR-0085).
- Merchant id comes only from the session; services run in `withMerchantTx` (RLS). Reading the
  `merchants` row for a merchant user needs the merchant context too (see `LoginService.complete`).

## Sign-in flows
- `LoginService.login` (`login.service.ts`): IP limit, per-e-mail failure lock (10 / 15 min,
  `RateLimiterService.hitAndCheck` e-mails the holder on lock, BR-193), dummy Argon2 verify for
  unknown e-mails, generic `INVALID_CREDENTIALS`. Specific errors (`ACCOUNT_DISABLED`,
  `MERCHANT_SUSPENDED`, `INTERFACE_NOT_PERMITTED` + `availableInterfaces`) only after the password.
- Several merchants or POS branches → `select_merchant` ticket (`ticket.service.ts`, 5 min, 5 tries)
  → `POST /auth/login/select`. Every path ends in `LoginService.complete`, which refuses a frozen owner
  (`403 OWNER_FROZEN`), creates the session and audits `auth.login.succeeded`. New sign-in paths
  (PIN, switch-merchant, switch-interface) must go through `complete`, never `sessions.create` directly.
- Registration: `RegistrationService.createAccount` (one transaction: user, merchant, main branch,
  owner membership, role templates); also used by trials (ADR-0115). Platform-created merchants get a
  72 h setup link via `PasswordResetService.issueAccountSetup`.
- Password reset (`password-reset.service.ts`): `POST /auth/password/forgot` always `202`, work runs
  in the background (`drain()` in tests); token single-use, 30 min, revokes all sessions (BR-043).
- Self-service (`account.service.ts`, BR-193): `POST /auth/manager/password` (current password; other
  sessions end via `password_changed_at`, current one re-issued), `GET /auth/manager/sessions`,
  `DELETE /auth/manager/sessions/:id`, `POST /auth/manager/sessions/revoke-others`. UI:
  `apps/manager-web/src/features/account/AccountPage.tsx`.
- Platform: `platform-auth.service.ts` (password → `mfa_required` → TOTP); never touch merchant cookies.

## Employees (`apps/api/src/modules/iam/`)
- Invite only: `POST /manager/employees/invitations` (`employees.manage`), single-use 7-day e-mailed
  link; resend issues a new token, revoke cancels (`employees.service.ts`, AUTH.md §6). Nobody joins a
  merchant on their own; the manager never sees a token or password.
- Acceptance: `POST /auth/invitations/preview|accept` (`invitation-acceptance.service.ts`). New users set
  a password; existing users confirm their current one. Each grant is re-checked with `canGrant` against
  the inviter's **current** access and dropped if the role/branch is gone (ADR-0104). Pages:
  `/manager/accept-invite`, `/pos/accept-invite`.
- Manage: `PATCH /manager/employees/:id`, `POST …/status`, `PUT …/assignments`, `POST …/sessions/revoke`,
  `POST …/unlock`, `POST …/password-reset`, `DELETE …/pin` (`iam.controller.ts`). Each goes through
  `manageableMember` → `canManageMember`: **never the owner, never oneself**, and only if every existing
  grant of the target is within the actor's authority; grants need `canGrant` (AUTH.md §3.6, BR-025).
  Violations: `403 PRIVILEGE_ESCALATION`, nothing partially applied.
- Global identity (name, e-mail, password) belongs to the user; managers edit only membership fields.
- Grants at a deactivated branch are dormant; reactivation needs `dormantGrants: keep|clear`
  (`GRANTS_NEED_CONFIRMATION`, BR-192, `modules/branches/branches.service.ts`).

## Owner protection and ownership transfer (BR-020, ADR-0104)
- Ownership moves **only** through `OwnershipService.transfer(tx, …)`
  (`apps/api/src/modules/merchants/ownership.service.ts`): in one transaction it clears the old
  owner's flag first, sets the new one, revokes the old owner's sessions on that merchant
  (`ownership_transferred`) and audits `merchant.ownership_transferred`; `notifyBoth` e-mails after commit.
  The old owner stays a plain member with no assignments added.
- Owner flow (`merchants.controller.ts`, all `@Authenticated('manager')`, owner checked in the service):
  `POST /manager/merchant/ownership-transfers` `{toMembershipId, password}` → 72 h code e-mailed
  (one pending; a new start cancels the old), `DELETE …/ownership-transfers` cancels,
  `POST …/ownership-transfers/accept` `{token}` by the named member while signed in to `/manager`.
  Errors: `TRANSFER_INVALID`, `INVALID_STATE`. UI: `features/company/CompanySettingsPage.tsx`.
- Platform flow (`platform-admin/platform.service.ts`, `withPlatformContext`, optimistic `version`):
  `POST /platform/merchants/:id/ownership-transfer` (super admin, `reason`) calls the same `transfer()`.
- Freeze: `POST /platform/merchants/:id/owner-freeze|owner-release` (support, super admin, reason) sets
  `owner_frozen_at`, ends the owner's sessions (`owner_frozen`); employees are unaffected. A frozen owner
  is refused in `LoginService.complete`, in `DbSessionResolver`, and hidden from PIN sign-in
  (`pin-sign-in.service.ts`). Any new entry point must apply the same check.
- Never add an endpoint or service path that demotes, deactivates, edits assignments of, or ends
  sessions of the owner on another user's behalf; `canManageMember` already returns false for owners.

## Audit and e-mail
- Write audit rows in the same transaction (`audit.recordIn(tx, …)`); edits carry `changes` from
  `diffFields` (`apps/api/src/kernel/audit-diff.ts`, BR-191). Action names in use: `auth.login.*`,
  `auth.account_locked`, `auth.pin_login.*`, `auth.pos.locked`, `merchant.ownership_transfer.*`,
  `platform.merchant.owner_frozen|owner_released|ownership_transferred`.
- E-mail only through `Mailer` (`apps/api/src/kernel/mail/mailer.ts`; SMTP to Mailpit `:1025` locally,
  Resend / Brevo in production) and after the transaction commits.

## Tests
- Integration (`run-tests` skill for commands and DB setup): `auth/auth.int.test.ts`,
  `auth/hardening.int.test.ts`, `auth/pin-sign-in.int.test.ts`, `iam/iam.int.test.ts`,
  `iam/account-hygiene.int.test.ts`, `merchants/ownership.int.test.ts`; unit: `packages/permissions/src/evaluate.test.ts`.
- Fixtures in `apps/api/src/testing/`: `createCompany`, `registerOwner`, `ApiClient`, `sessionCookie`,
  `freshIp`, `uniqueEmail`, `PASSWORD` (`auth-fixtures.ts`); read e-mailed tokens/codes from
  `InMemoryMailer.outbox` / `lastTo` (`test-app.ts`), never from Mailpit.
- Use `freshIp()` per test so rate limits do not leak across tests. Owner-role fixtures that change
  merchant status need `app.operator_id` (CLAUDE.md §9).
- E2E: `e2e/auth.spec.ts`, `e2e/employees.spec.ts`, `e2e/platform.spec.ts`.
- Every new rule here gets an integration test that proves the refusal (owner untouchable, frozen owner
  refused at login **and** on an existing session, escalation refused with nothing written).
