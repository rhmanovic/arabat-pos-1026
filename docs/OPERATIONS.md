# Operations runbook

Status: prepared and verified locally (Prompt 18). **Nothing is deployed**; hosting,
domain, e-mail provider and payment gateways need the owner's approval first (OQ-011,
OQ-021, OQ-022). Commands below were run in the development environment unless marked
"production".

## 1. Components

| Component | What | Health |
|---|---|---|
| API | `node apps/api/dist/main.js` (NestJS + Fastify, stateless, horizontal scaling) | `GET /api/v1/health/live` (process), `GET /api/v1/health/ready` (database round trip; 503 when down) |
| Web apps | Static builds of `apps/{manager,pos,platform,store}-web/dist` served under `/manager`, `/pos`, `/platform`, `/store` by the API (`SERVE_WEB=true`) or a CDN/reverse proxy | — |
| PostgreSQL 18 | Roles `app_owner` (schema owner, migrations, seeds, operator CLI; BYPASSRLS) and `app_runtime` (API; no BYPASSRLS) | `pg_isready` |
| SMTP | Password reset, invitations, owner set-up e-mails | provider status |

Single-instance limitation: the **mock** payment gateway keeps its charges in memory
(test payments only). Rate limits and sessions are in PostgreSQL and work across instances.

## 2. Configuration (environment variables)

Required in production: `NODE_ENV=production`, `DATABASE_URL` (app_runtime),
`DATABASE_OWNER_URL` (only for migrations/CLI jobs, not the API process),
`MFA_ENCRYPTION_KEY` (32 random bytes, base64 — **back it up**: without it no operator can
sign in), `SMTP_URL`, `MAIL_FROM`, `PUBLIC_MANAGER_URL`, `PUBLIC_POS_URL`,
`PUBLIC_STORE_URL`, `TRUST_PROXY` (hop count or proxy CIDRs of the load balancer).
The API refuses to start in production with the development `MFA_ENCRYPTION_KEY` or the
default mock-gateway secret, and refuses `TRUST_PROXY=true`. Never put `NODE_ENV` in a
`.env` read by Vite builds (CLAUDE.md §9). Secrets come from the platform's secret store,
never from the repository.

## 3. Build and release

1. CI (`.github/workflows/ci.yml`) on every push/PR: lint, format, typecheck, build, unit
   and web tests; then PostgreSQL 18 + Mailpit services, migrations, seeds, integration
   and Playwright E2E tests. A release is only built from a green commit.
2. Build: `pnpm install --frozen-lockfile && pnpm build` (packages, API, four SPAs).
3. Before switching traffic: run migrations **once** with the owner role
   (`DATABASE_OWNER_URL=… pnpm db:migrate`). Migrations are forward-only and run in a
   transaction each.
4. Start the new API version; wait for `/health/ready` = 200; switch traffic; stop the
   old version.

### Migration rollback strategy
- Migrations are never edited after release and have no "down" scripts.
- Every migration must be **backward compatible with the previous app version**
  (expand → migrate → contract): add columns/tables first, remove them in a later release.
  Then an application rollback is simply redeploying the previous build.
- If a migration itself is wrong: write a new corrective migration (forward fix).
- If data was damaged: restore from backup (§4) into a new database, verify, switch
  `DATABASE_URL`. Financial records are append-only, so partial repairs are done with new
  correcting documents (refund, adjustment), never by editing rows.

## 4. Backups and restore

- Production: the managed database's point-in-time recovery (WAL archiving, ≥ 14 days)
  **plus** a nightly logical backup: `DATABASE_OWNER_URL=… scripts/ops/db-backup.sh <dir>`
  (custom format, compressed, archive listed and SHA-256 written). Store copies off-site,
  encrypted; keep 30 daily / 12 monthly.
- Restore (never over a live database):
  1. Create an empty database owned by `app_owner`; grant `CONNECT, TEMPORARY` to
     `app_runtime`.
  2. `TARGET_DATABASE_URL=… scripts/ops/db-restore.sh <file.dump>` (checks the checksum,
     refuses a non-empty target).
  3. `DATABASE_OWNER_URL=<restored> pnpm db:migrate` (applies newer migrations, if any).
  4. Smoke test: `/health/ready`, sign in, open a recent sale and a report.
- Verified drill (2026-10-12, dev database with 8,194 sales / 26,502 stock movements, run
  inside the PostgreSQL 18 container because the host has `pg_dump` 16): backup 1.6 s
  (6.9 MB); restore into an empty database 2.9 s; all 78 RLS policies, 17 triggers and 7
  security-definer functions present; with `app_runtime` and no merchant context 0 rows
  are visible, with one merchant's context only that merchant's rows. Use client tools of
  the **same major version** as the server.
- Also back up `var/uploads` (or the object store that replaces it) and the secrets.

## 5. Logging and monitoring

- Logs: structured JSON (pino) on stdout with `reqId` (also returned as `x-request-id`).
  Passwords, cookies, authorization headers, tokens and order-tracking tokens in URLs are
  redacted. Ship stdout to the log platform; keep 30 days.
- Alert on: `/health/ready` failing; 5xx rate > 1 % over 5 min; log messages
  `Transaction retried after 40P01` (deadlocks; occasional is fine, sustained means a lock
  order problem), `reconcile failed`, `applying … failed`, `Audit write failed`; online
  orders in `needs_attention` (manager Online store page); database CPU, connections
  (pool size `DATABASE_POOL_MAX` per instance), disk, replication lag.
- Not available yet: a metrics endpoint (Prometheus/OpenTelemetry) and tracing — add before
  scaling beyond a few instances.

## 6. Incident procedures

| Situation | Action |
|---|---|
| API unhealthy | Check `/health/ready` (database) and logs by `reqId`; restart instances; roll back to the previous build (§3) if a release caused it. |
| Database down | Fail over (managed HA) or restore (§4). POS terminals show "server unreachable" (no offline selling, OQ-005). |
| Suspected account compromise | Disable the user (manager) or operator (CLI re-key, which also ends their sessions); end sessions: `update sessions set revoked_at = now(), revoke_reason = 'incident' where user_id = '…'` (or `merchant_id` / all). Review `audit_log`. |
| Leaked `MFA_ENCRYPTION_KEY` / SMTP / gateway secrets | Rotate the secret; re-key every operator with the CLI; rotate gateway webhook secrets at the provider. |
| Payment taken but order not paid | Manager → Online store → orders "needs attention" (late or mismatched payments); "Check pending payments" re-asks the gateway; refunds of money taken happen at the provider (no automatic gateway refunds yet). |
| Merchant must be stopped (fraud, non-payment) | Platform → merchant → Suspend with a reason: sessions end at once, the store goes offline, data is kept. |
| Data correction | Never edit financial rows; use refunds, voids and stock adjustments, which are audited. |

## 7. Deployment prerequisites (owner decisions)

Hosting provider and region / data residency (OQ-011); domain and TLS; transactional
e-mail provider; production secrets store; backup storage location; payment gateway
choice, merchant contracts and credentials, sandbox certification (OQ-021); subscription
pricing and billing provider (OQ-022); legal receipt fields and tax (OQ-002, OQ-009).

## 7a. Domain and e-mail (ADR-0105)

DNS of `arabatapp.com` is in Cloudflare. Records in place (2026-10-14):

| Record | Value | Purpose |
|---|---|---|
| `MX arabatapp.com` | `1 smtp.google.com` | Google Workspace mailboxes |
| `TXT arabatapp.com` | `v=spf1 include:_spf.google.com ~all` | SPF for Workspace |
| `TXT _dmarc.arabatapp.com` | `v=DMARC1; p=none; adkim=r; aspf=r` | DMARC, monitor-only |

Still to add once the owner has signed up: the Workspace verification TXT and DKIM
(`google._domainkey`), and the Resend records of `send.arabatapp.com` (DKIM, SPF/MX of its
bounce domain), which are unique to the Resend account. Then set in production
`SMTP_URL=smtps://resend:<API key>@smtp.resend.com:465` and
`MAIL_FROM=no-reply@send.arabatapp.com`, and tighten DMARC to `p=quarantine`.

## 8. Staging on Railway (approved by the owner, 2026-10-12)

Files: `Dockerfile` (builds the API and the four apps; base image overridable with
`--build-arg NODE_IMAGE=…`), `railway.json` (Dockerfile build, health check
`/api/v1/health/ready`), `apps/api/src/database/cli/hosted-start.ts` (start command). With
one superuser URL from the platform, the start command creates/updates `app_owner` and
`app_runtime`, applies migrations and reference seeds as `app_owner`, then starts the API as
`app_runtime` (RLS enforced). Verified locally against a fresh database in production mode
(the Docker image itself is built by Railway; this sandbox cannot pull base images).

Services: **Postgres** (Railway template) + **web** (this repository, branch to deploy).
Variables of the web service:

| Variable | Value |
|---|---|
| `DATABASE_ADMIN_URL` | `${{Postgres.DATABASE_URL}}` |
| `APP_OWNER_PASSWORD`, `APP_RUNTIME_PASSWORD` | two different random strings, ≥ 32 characters |
| `MFA_ENCRYPTION_SECRET` | random string ≥ 40 characters (keep a copy: losing it locks operators out) |
| `TRUST_PROXY` | `1` (Railway's edge proxy) |
| `PUBLIC_MANAGER_URL` / `PUBLIC_POS_URL` / `PUBLIC_STORE_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}/manager` / `/pos` / `/store` |
| `PAYMENT_MOCK_ENABLED`, `PAYMENT_MOCK_SECRET` | `true` and a random string **on staging only**: test payments create sales and bank entries without money (FND-709); the API logs a warning when it is on in a production build, and it must never be set for an environment used by a real merchant (owner decision D7) |
| `SMTP_URL`, `MAIL_FROM` | optional; without them password reset and invitation e-mails are not delivered |

Generate a public domain under the web service's Networking settings. Railway injects
`PORT=8080`, so the domain's target port must be **8080** (not the Dockerfile's `EXPOSE
3000`). First platform operator without a shell: set `PLATFORM_BOOTSTRAP_EMAIL` (and
optionally `PLATFORM_BOOTSTRAP_NAME`); while no operator exists, the start command creates
one `platform.super_admin` and prints its one-time password and TOTP secret to the deploy
log once (`apps/api/src/database/cli/bootstrap-operator.ts`). It never re-keys or adds
operators afterwards. Optional: a volume
mounted at `/app/var` keeps uploaded product images across deploys. First platform operator:
open a shell on the web service (`railway ssh`) and run
`node apps/api/dist/database/cli/create-operator.js --email … --name … --role platform.super_admin`.

Current staging deployment (2026-10-12): Railway project `arabat-pos`, environment
`production`, services `Postgres` + `web`, URL `https://web-production-bf628.up.railway.app`
(deploys on push to the connected branch). Verified after deploy: `/api/v1/health/ready` ok
(database ok), `/manager`, `/pos` and `/platform` load and report the server connected. No
volume and no SMTP yet. First platform operator created by the bootstrap (credentials only
in the deploy log of 2026-10-12 14:42 UTC).

### Cash custody cutover (ADR-0090, migration 0033)

Runs automatically with the migrations; it is guarded per merchant (skips a merchant that already
has a treasury). After the deploy:
1. The old cash account appears archived as «حساب النقد القديم» on the payments page; its history
   stays, it is in no total.
2. Every branch treasury and register starts at 0 "not yet counted". The owner (or anyone with
   `cash.custody`) records each treasury's opening count on `/manager/cash`; until then the
   treasury cannot pay out (top-ups and transfers from it are refused).
3. A shift that was open at deploy closes the old way; its counted cash becomes the drawer
   balance. Other registers get their balance from the count at their next opening.
4. Cashier roles no longer have `cash.move`; grant it per employee or role where needed.

### Cash custody phase B (ADR-0091, migrations 0034–0035)

Applied automatically. Each merchant gets one "Cash in transit" account. The owner has
`cash.deposit` implicitly; grant it to other roles (it is in no template) before they deposit
cash to a bank. Supplier payments and expenses already recorded at the POS before this release
as plain cash-out movements stay as they are (cash movements, not disbursements).
