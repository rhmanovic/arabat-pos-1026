# Authentication & Permissions Design

Status: **Implemented (Prompt 4)** — sessions, sign-in for all three interfaces, owner
registration, password recovery, operator TOTP, rate limits, CSRF origin check.
Employee/role management APIs follow in Prompt 5.
Implements requirements BR-010..BR-015 and ADR-0001, ADR-0006, ADR-0007, ADR-0011.

---

## 1. Identity realms

| Realm | Table | Interfaces | Notes |
|---|---|---|---|
| Merchant | `users` (+ `memberships`) | `/manager`, `/pos` | One user can belong to several merchants. |
| Platform | `platform_operators` | `/platform` | Completely separate table, login endpoint, cookie and guards. MFA mandatory. |

A merchant session can never call `/api/v1/platform/*`, and a platform session
can never call merchant endpoints. Same e-mail in both realms = two unrelated
identities.

---

## 2. Authentication (centralized)

One `AuthService` implements credential checks, session issuing, revocation,
password reset and MFA for all interfaces. Interface-specific endpoints are
thin wrappers:

Implemented endpoints (prefix `/api/v1`):

| Endpoint | Access | Purpose |
|---|---|---|
| `POST /auth/register` | public | Owner self-registration: user + merchant + main branch + owner membership + role templates + manager session, one transaction |
| `POST /auth/login` `{interface: manager\|pos, email, password}` | public | → `authenticated`, or `select_merchant` (ticket + eligible merchants/branches) |
| `POST /auth/login/select` `{ticket, merchantId, branchId?}` | public (ticket) | Second step; single-use ticket, 5 min, 5 attempts |
| `POST /auth/platform/login` → `POST /auth/platform/mfa` | public | Operator password → `mfa_required` ticket → TOTP → platform session |
| `POST /auth/password/forgot` `{email, interface}` | public | Always `202 {status:"accepted"}`; work happens in the background |
| `POST /auth/password/reset` `{token, password}` | public (token) | Single-use, 30 min; revokes all sessions of the user |
| `GET /auth/{iface}/me` | session | Actor, merchant, POS branch, effective permissions, `availableInterfaces`, merchant count, expiry |
| `GET /auth/{manager\|pos}/merchants` | session | Merchants the user may open in this interface |
| `POST /auth/{manager\|pos}/switch-merchant` | session | New session for another membership (old one revoked) |
| `POST /auth/{manager\|pos}/switch-interface` `{target, branchId?}` | session | Controlled manager ↔ POS switch; re-checks permissions; may answer `select_branch` |
| `POST /auth/{iface}/logout` | session | Revokes the session, clears the cookie |
| `GET /manager/merchant`, `PATCH /manager/merchant` | `merchant.settings.read/update` | Company profile (optimistic `version`) |
| `GET /manager/branches` | `branches.read` | Branches limited to the user's accessible branches |

Interface routing after sign-in: the login request names the interface. If the user
has no access to it but to another one, the API answers `403 INTERFACE_NOT_PERMITTED`
with `availableInterfaces` (only after the password is proven) and the UI links to
the right application. Permissions always come from the database, never from a
client-side role label.

### 2.1 Sessions
- Opaque random token (256-bit). Only its **SHA-256 hash** is stored in `sessions`.
- Session row: `realm`, `interface` (`manager|pos|platform`), `user_id` or
  `operator_id`, `merchant_id`, `branch_id` / `register_id` (POS), `created_at`,
  `last_seen_at`, `expires_at`, `idle_timeout`, `revoked_at`, `ip`, `user_agent`.
- Cookies (one per interface so a person can be logged into manager and POS in
  the same browser without mixing contexts):

  | Cookie | Path | Flags |
  |---|---|---|
  | `mgr_sid` | `/api/v1` | HttpOnly, SameSite=Lax, Secure (`COOKIE_SECURE`, default on in production) |
  | `pos_sid` | `/api/v1` | HttpOnly, SameSite=Lax, Secure |
  | `plat_sid` | `/api/v1` | HttpOnly, SameSite=Strict, Secure |

  The guard for each namespace reads **only** its own cookie
  (`/api/v1/manager/*` → `mgr_sid`, etc.).
- Default timeouts (configurable per merchant later):

  | Interface | Idle | Absolute |
  |---|---|---|
  | manager | 60 min | 12 h |
  | pos | screen lock after 5 min without input, server-enforced (`SESSION_LOCKED`, unlock with the user's password; ADR-0085) — server idle expiry 8 h | 16 h (a long shift) |
  | platform | 15 min | 8 h |
- Revocation is immediate: deactivating a user/membership, changing password,
  or suspending a merchant revokes the relevant sessions.
- Permission changes take effect on the next request (permissions are
  evaluated per request, cached per request only).

### 2.2 Credential security
- Argon2id hashing (OWASP parameters), password policy (min length 10, breached
  list check later).
- Rate limit + exponential backoff per account and per IP on login, MFA and
  reset endpoints; generic error messages (no account enumeration).
- CSRF: SameSite cookies **plus** an origin check on every state-changing `/api`
  request (OWASP "verify origin with standard headers"): `Sec-Fetch-Site: cross-site`
  or an `Origin` that is neither the API host nor in `TRUSTED_ORIGINS` → `403
  ORIGIN_REJECTED`. (Replaces the double-submit token idea; ADR-0026.)
- API responses carry `Cache-Control: no-store`.
- Account enumeration: sign-in and recovery never reveal whether an account exists
  (same response, dummy Argon2 verify for unknown e-mails, recovery work done after
  the response). Registration must say "e-mail already registered" (409) — accepted
  trade-off, rate limited per IP (ADR-0025).

Rate limits (fixed windows in PostgreSQL `rate_limit_buckets`, shared by all
instances; scaled by `AUTH_RATE_LIMIT_SCALE`; `429 RATE_LIMITED` + `Retry-After`):

| Key | Limit |
|---|---|
| sign-in per IP | 30 / 10 min |
| failed sign-ins per e-mail (account lock; also blocks the correct password) | 10 / 15 min, reset on success or password reset |
| registration per IP | 10 / hour |
| recovery per IP / per e-mail | 20 / hour, 5 / hour |
| reset per IP | 20 / hour |
| merchant selection per IP | 30 / 10 min |
| platform sign-in per IP / failures per e-mail | 10 / 15 min, 5 / 15 min |
| TOTP per IP (+ 5 attempts per ticket) | 20 / 15 min |
| wrong TOTP codes per operator (any IP/ticket) | 5 / 15 min |
| wrong passwords on a locked POS (then the session ends) | 5 / 15 min |

Client IPs come from `X-Forwarded-For` only when `TRUST_PROXY` names the load balancer
(ADR-0086); otherwise the socket address is used.
- MFA: TOTP (RFC 6238, ±1 step, replay-protected via `mfa_last_step`) mandatory for
  platform operators; secrets AES-256-GCM encrypted with `MFA_ENCRYPTION_KEY`.
  Merchant-user MFA: planned.
- Session validation on **every request** (`DbSessionResolver`): token hash lookup
  (interface-specific cookie), not revoked, idle and absolute expiry, user active,
  password not changed after session creation, membership active, merchant active,
  interface permission still granted, POS branch still allowed. Failing sessions are
  revoked on sight. Sliding idle expiry is written at most once per minute.

---

## 3. Authorization model

### 3.1 Concepts

| Concept | Definition |
|---|---|
| **Permission** | Code-defined key `area.resource.action` with a **scope** (`merchant` or `branch`). Stored in `packages/permissions`; not editable by merchants. |
| **Role** | Per-merchant named set of permission keys. Merchants can create/edit roles. System templates are seeded. |
| **Role assignment** | `(membership, role, branch_id NULL \| branch)` — NULL means all branches (merchant-wide). |
| **Owner** | `memberships.is_owner = true`. Implicitly all permissions, all branches, both interfaces. Cannot be removed/demoted by others. |

### 3.2 Evaluation

```
can(actor, permission, branchId?):
  if actor.membership.status != active or merchant.status != active → deny
  if actor.is_owner → allow
  for each assignment in actor.assignments:
     if permission ∈ assignment.role.permissions:
        if permission.scope == 'merchant' and assignment.branch_id IS NULL → allow
        if permission.scope == 'branch'
           and (assignment.branch_id IS NULL or assignment.branch_id == branchId) → allow
  deny
```

- `accessibleBranches(actor)` = all branches if owner or any merchant-wide
  assignment; otherwise the set of assignment `branch_id`s.
- List endpoints filter by `accessibleBranches` **in the SQL query**, not after.
- Subscription feature gates (e.g. `restaurant`, `ecommerce`, `max_branches`)
  are checked in addition to permissions.

### 3.3 Interface access permissions
| Key | Scope | Meaning |
|---|---|---|
| `manager.access` | branch | May sign in to `/manager` and see data of that branch |
| `pos.access` | branch | May sign in to `/pos` at that branch |

- Holding `pos.access` never implies `manager.access`, and vice versa
  (BR-013, BR-014).
- POS login: after authentication, the user must pick a branch where they hold
  `pos.access`; otherwise login is refused with `POS_ACCESS_DENIED`.

### 3.4 Permission catalog (implemented, `packages/permissions/src/catalog.ts`)

| Group | Keys | Scope |
|---|---|---|
| Access | `manager.access`, `pos.access` | branch |
| Sales | `sales.create`, `sales.read`, `sales.discount`, `sales.discount.override_limit`, `sales.price_override`, `sales.void`, `sales.zero_total` | branch |
| Refunds | `refunds.create`, `refunds.approve` | branch |
| Registers | `registers.manage`, `shifts.operate`, `shifts.view_all`, `cash.move`, `cash.custody`, `cash.deposit` | branch |
| Catalog | `catalog.read` (branch), `catalog.manage`, `catalog.prices.manage` (merchant) | mixed |
| Inventory | `inventory.read`, `inventory.adjust`, `inventory.transfer`, `inventory.transfer.approve` | branch |
| Purchasing | `purchasing.read`, `purchasing.manage`, `purchasing.approve`, `purchasing.receive` | branch |
| Customers | `customers.read`, `customers.create`, `customers.manage` | branch |
| Reports | `reports.sales`, `reports.financial`, `reports.inventory` | branch |
| Period close | `periods.close` (close a month and lock it; BR-189) | merchant |

Ownership transfer and the platform's owner freeze are described in BR-020 (ADR-0104); self-service
password change and session management in BR-193.
| Payments | `payments.settings` | merchant |
| Employees | `employees.read`, `employees.manage` (branch); `roles.manage` (merchant) | mixed |
| Branches | `branches.read`, `branches.update` (branch); `branches.manage` (merchant) | mixed |
| Company | `merchant.settings.read`, `merchant.settings.update`, `audit.read` | merchant |

### 3.5 Default roles (templates, editable by holders of `roles.manage`)
| Template | Typical assignment | Highlights |
|---|---|---|
| Owner | implicit (membership flag) | everything, cannot be demoted/deactivated |
| `company_manager` — مدير الشركة | all branches | full management, **no POS** |
| `branch_manager` — مدير الفرع | one branch | branch operations, staff of that branch, **no POS** |
| `supervisor` — مشرف | one branch | POS + overrides, voids, refund approval, cash moves |
| `cashier` — كاشير | one branch | POS selling, limited discounts, refunds, restaurant orders (no `cash.move` since ADR-0090; granted per employee) |
| `kitchen` — طاقم المطبخ | one branch | POS sign-in to the kitchen display only (`kitchen.access`) |

Restaurant permissions (Prompt 15): `restaurant.manage` (branch: tables, areas, stations;
merchant-wide: module switch, modifier groups, recipes), `restaurant.orders`,
`restaurant.void_item` (cancel items already sent to the kitchen), `kitchen.access`.

Platform roles (Prompt 17): all operators read the overview, merchants, plans and plan
checks; `platform.support` and `platform.super_admin` create merchants, suspend and
reactivate, and read the platform audit log; only `platform.super_admin` closes a
merchant; `platform.billing` and `platform.super_admin` manage plans and subscriptions; only
`platform.super_admin` reads the assistant usage record (conversations, tokens, cost; ADR-0105).
Merchant owners and employees never hold platform roles (separate realm, ADR-0007), and
the database refuses merchant-status and subscription changes without an operator context
(ADR-0080). Sign-in of a user whose companies are all suspended answers
`MERCHANT_SUSPENDED` (after the password is proven); invitations of a suspended company
cannot be accepted.

Online store permissions (Prompt 16): `online.manage` (merchant-wide: store settings,
listings, reconciliation), `online.orders` (branch: view and move online orders of the
fulfilment branch). `company_manager` has both, `branch_manager` has `online.orders`.
Shoppers are anonymous: the public store API has no session and resolves the merchant from
the store address; gateway webhooks are authenticated by the provider signature only.

New merchants get all templates at registration; the `002-role-templates` seed adds
missing templates to existing merchants without touching customized roles.

### 3.6 Anti-escalation (enforced in services, unit + integration tested)
- **Granting** a role at branch B (or all branches): the actor must hold
  `employees.manage` there **and every permission of the role there** (`canGrant`).
- **Managing** an employee (profile, status, roles): never the owner, never oneself,
  and only if every existing grant of the target is within the actor's authority
  (`canManageMember`).
- **Editing roles**: requires `roles.manage`; a role may contain only permissions the
  editor holds merchant-wide, and a role holding more than the editor cannot be edited
  or deleted. Unknown keys are rejected. Roles in use cannot be deleted.
- A merchant-scoped permission inside a role assigned at a branch grants nothing.
- Grants at a deactivated branch grant nothing.
- Violations answer `403 PRIVILEGE_ESCALATION` and are never partially applied.

## 4. Request pipeline (NestJS guards, in order)

| # | Guard | Fails with |
|---|---|---|
| 1 | `SessionGuard` — reads the namespace's cookie, loads & validates session, sliding idle | 401 |
| 2 | `RealmGuard` — merchant vs platform matches namespace | 403 |
| 3 | `InterfaceGuard` — session.interface matches namespace | 403 |
| 4 | `MerchantContextGuard` — merchant from session (never request), merchant active, sets request context | 403 / 423 (suspended) |
| 5 | `FeatureGuard` — `@RequireFeature()` vs subscription | 403 `FEATURE_NOT_IN_PLAN` |
| 6 | `PermissionGuard` — `@RequirePermission(key)`; **routes without a declaration fail closed** (`@Public()` is the explicit opt-out) | 403 |
| 7 | `BranchGuard` — target branch (path/body or POS session binding) ∈ accessible branches for that permission | 403 |

Branch handling in `PermissionGuard`: with a branch in the request (POS session
binding, `:branchId`, `?branchId`) the permission must hold **at that branch**;
otherwise the guard only checks that it is held **somewhere** (`canAnywhere`) and the
service performs the exact per-branch checks (`assertCan`) and filters queries to the
actor's branches (`permissionBranchScope`).

Then the service runs inside `withMerchantTx(ctx, fn)` which executes
`SET LOCAL app.merchant_id = <id>` (and `app.actor_id`) so PostgreSQL RLS
applies to every statement. A startup check enumerates all routes and fails
the boot if any route lacks a permission/public declaration.

---

## 5. Tenant isolation (defence in depth)
1. Merchant id only from the session.
2. Repositories require a `MerchantContext` argument (type-level enforcement).
3. RLS (`FORCE ROW LEVEL SECURITY`) on every merchant-owned table.
4. Runtime DB role without `BYPASSRLS`; platform module uses a dedicated,
   audited code path for cross-merchant operations.
5. Composite FKs `(merchant_id, id)` prevent cross-merchant references.
6. Automated isolation test suite (see `TESTING.md`).

---

## 6. Employee lifecycle (implemented, Prompt 5)
1. An authorized manager invites (`POST /manager/employees/invitations`): e-mail, name,
   profile fields and role assignments (each checked by `canGrant`). Employees can
   never join a merchant by themselves.
2. A single-use link (token hash stored, 7 days) is e-mailed (Mailpit locally); the
   manager never sees a token or password. Resend issues a new token; revoke cancels.
3. The person opens `/manager/accept-invite` or `/pos/accept-invite`: a new user
   chooses a password (policy enforced); an existing user confirms with their current
   password. Acceptance is atomic: membership + assignments (only roles/branches that
   still exist and are active) + audit.
4. Managers edit merchant-specific profile fields (job title, phone, employee code),
   (de)activate (sessions revoked immediately), replace role assignments, and trigger
   a password-reset e-mail. The global identity (name, e-mail, password) belongs to
   the user.

## 7. Manager override on POS
Implemented for selling exceptions (BR-177, ADR-0100): when a cart needs a
right the cashier lacks (discount, discount above the limit, price change,
free sale), the POS asks a second user to approve on the same device:
- Approver authenticates with their own e-mail and password
  (`POST /pos/overrides`, throttled like a sign-in; the cashier cannot approve
  for themself).
- Backend loads the approver's access and keeps only the overridable rights
  they hold at the branch and the cashier lacks.
- Issues a single-use **grant** (`sale_overrides`) bound to the cashier's
  membership, shift and branch, expiring after 10 minutes.
- Checkout consumes the grant (`overrideId`); the sale stays on the cashier's
  shift and records the approver and the rights supplied; the audit log records
  the grant and the sale. Refund and void approvals keep their own flow until
  R3.4.

---

## 8. Platform operators

Operators are created only with the CLI (never through the API):
`pnpm --filter @arabat/api run platform:create-operator -- --email … --name … --role platform.super_admin`
prints a one-time password and the TOTP secret/otpauth URI. Development seed:
`operator@platform.arabat.test` / `Demo-Pass-2026`; current dev code:
`pnpm --filter @arabat/api run dev:totp`.

- Roles: `platform.super_admin`, `platform.support`, `platform.billing`
  (code-defined, small set).
- MFA mandatory; short sessions; all actions audited in the platform audit log.
- The `--` separator pnpm forwards to the CLI is ignored (fixed in Prompt 17).
- Merchant impersonation/support access is **not** provided initially; if
  added, it requires explicit merchant consent or a recorded reason, a time
  limit, read-only by default, and is visible to the merchant owner.
