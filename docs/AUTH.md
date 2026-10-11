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
  | pos | screen lock after 5 min idle (re-auth to unlock) | 16 h (a long shift) |
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

### 3.4 Permission catalog (initial — grows per milestone)

| Area | Keys (examples) | Scope |
|---|---|---|
| Access | `manager.access`, `pos.access` | branch |
| Merchant | `merchant.settings.read`, `merchant.settings.update` | merchant |
| Branches | `branches.read`, `branches.create`, `branches.update` | merchant |
| Users | `users.read`, `users.invite`, `users.update`, `users.deactivate` | merchant |
| Roles | `roles.read`, `roles.manage`, `roles.assign` | merchant |
| Catalog | `catalog.read`, `catalog.manage`, `catalog.prices.manage` | merchant |
| Inventory | `inventory.read`, `inventory.adjust`, `inventory.transfer`, `inventory.count` | branch |
| Registers | `registers.manage`, `shifts.open`, `shifts.close`, `shifts.view_all`, `cash.move` | branch |
| Sales | `sales.create`, `sales.read`, `sales.void`, `sales.discount`, `sales.discount.override_limit`, `sales.price_override` | branch |
| Orders | `orders.create`, `orders.manage` | branch |
| Refunds | `refunds.create`, `refunds.without_receipt` | branch |
| Payments | `payment_methods.manage` | merchant |
| Customers | `customers.read`, `customers.manage` | merchant |
| Purchasing | `suppliers.manage`, `purchase_orders.manage`, `goods.receive` | branch |
| Reports | `reports.sales`, `reports.inventory`, `reports.financial` | branch |
| Audit | `audit.read` | merchant |
| Subscription | `subscription.read` | merchant |

### 3.5 System role templates (seeded per merchant, editable copies except Owner)
| Template | Interface access | Typical permissions |
|---|---|---|
| Owner (implicit, not a role row) | both | everything |
| Manager | `manager.access` (+ `pos.access` **only if ticked**) | branch operations, reports, staff at branch |
| Cashier | `pos.access` | `sales.create`, `orders.create`, `shifts.open/close`, `customers.read` |
| Inventory Clerk | `manager.access` | `inventory.*`, `goods.receive`, `catalog.read` |
| Accountant | `manager.access` | `reports.*`, `sales.read`, `audit.read` |

Rules: a user cannot grant permissions they do not hold themselves
(no privilege escalation); only owner or `roles.manage` holders edit roles;
the last owner cannot be removed; all role/assignment changes are audited.

---

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

## 6. Employee lifecycle
1. Authorized manager (`users.invite`) creates an invitation: e-mail, roles,
   branches. Token hashed, expires (72 h), single use. In local dev the e-mail
   goes to Mailpit; no paid e-mail provider without approval.
2. Employee accepts → sets password → membership `active`.
3. Alternatively (OQ-006) a manager creates a POS-only staff account directly.
4. Deactivation → membership `inactive`, sessions revoked, history retained.

---

## 7. Manager override on POS
For an action the cashier is not permitted to perform (e.g. void, refund,
discount above limit), the POS asks a second user to approve on the same
device:
- Approver authenticates (password; PIN if OQ-006 adopts PINs).
- Backend checks `can(approver, permission, branch)`.
- Issues a single-use **approval token** bound to (action, target document,
  amount, branch, expiry 2 min).
- The action endpoint consumes the token; the audit log records cashier,
  approver, action and amounts.

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
- Merchant impersonation/support access is **not** provided initially; if
  added, it requires explicit merchant consent or a recorded reason, a time
  limit, read-only by default, and is visible to the merchant owner.
