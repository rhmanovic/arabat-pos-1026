# Operations runbook

Status: staging runs on Railway (§8). Production on Google Cloud in Doha is prepared but not
created (§9, ADR-0105); domain, e-mail provider and payment gateways still need the owner's
decision (OQ-021, OQ-022). Commands below were run in the development environment unless marked
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

Hosting provider and region: Google Cloud, Doha (ADR-0105; §9), second backup location
open; domain and TLS; transactional
e-mail provider; production secrets store; backup storage location; payment gateway
choice, merchant contracts and credentials, sandbox certification (OQ-021); subscription
pricing and billing provider (OQ-022); legal receipt fields and tax (OQ-002, OQ-009).

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

## 9. Production on Google Cloud, Doha (ADR-0105) — prepared, not created

Nothing below exists yet: it needs the owner's Google Cloud account (billing on) and the
owner's approval of the go-live. Files: `infra/gcp/config.example.env` (copy to the
git-ignored `infra/gcp/config.env`), `provision.sh`, `deploy.sh`, `move-from-railway.sh`,
`backup-export.workflow.yaml`. Run them from a machine with `gcloud` signed in as a project
owner (or Cloud Shell), Docker and Node 24 (`pnpm build` first).

### 9.1 Components

| Part | Google service | Setting |
|---|---|---|
| API + four apps | Cloud Run service `arabat-web` | 1 vCPU / 1 GiB, min 1 / max 3 instances, CPU always allocated (the API reconciles online payments every minute), ingress only from the load balancer, startup probe `/api/v1/health/ready`, liveness `/api/v1/health/live` |
| Migrations | Cloud Run job `arabat-migrate` | `hosted-start.js --migrate-only`, run by `deploy.sh` before each release |
| Database | Cloud SQL PostgreSQL 18 Enterprise `db-custom-1-3840` | zonal (no HA), 20 GB SSD auto-increase, connector-only access (no authorised networks), TLS required, deletion protection |
| Images | Cloud Storage `UPLOADS_BUCKET` | private, uniform access, 30-day soft delete; `FILE_STORAGE_DRIVER=gcs` |
| Domain / TLS | External Application Load Balancer | static IP, Google-managed certificate, HTTP → HTTPS redirect |
| Secrets | Secret Manager (`me-central1` only) | `db-admin-url`, `app-owner-password`, `app-runtime-password`, `mfa-encryption-secret`, `smtp-url` |
| Builds | Cloud Build → Artifact Registry `arabat` | image tag = commit |

Database connection: Cloud Run mounts the Cloud SQL socket, so `db-admin-url` is
`postgresql://postgres:…@localhost/arabat?host=/cloudsql/PROJECT:me-central1:INSTANCE`;
`hosted-start` derives the `app_owner` / `app_runtime` URLs from it. Cloud SQL's `postgres`
user has no SUPERUSER and no BYPASSRLS: `app_owner` is exempt from RLS only as table owner
(migration 0048); `app_runtime` always goes through RLS.

### 9.2 First set-up
1. Owner: Google Cloud account, project, billing, budget alert; give the engineer the
   Owner role on the project.
2. `cp infra/gcp/config.example.env infra/gcp/config.env` and fill in project, domain,
   alert e-mail and `BACKUP_BUCKET_LOCATION` (owner's choice, §9.5).
3. `bash infra/gcp/provision.sh` — APIs, repository, service accounts, Cloud SQL, secrets,
   buckets, exports, enhanced backups, load balancer, uptime check. It prints the IP.
4. Data: either `move-from-railway.sh` (§9.6) or nothing (an empty start).
5. `bash infra/gcp/deploy.sh` (§9.3). First platform operator: set
   `PLATFORM_BOOTSTRAP_EMAIL` on the job once (`gcloud run jobs update arabat-migrate
   --update-env-vars PLATFORM_BOOTSTRAP_EMAIL=…`), execute it, read the one-time credentials in
   the job's log, then remove the variable.
6. DNS: `A` record of the domain → the printed IP; wait until
   `gcloud compute ssl-certificates describe arabat-cert --global` shows `ACTIVE`.
7. E-mail: put the provider's SMTP URL into the `smtp-url` secret
   (`printf %s 'smtps://…' | gcloud secrets versions add smtp-url --data-file=-`), redeploy.
8. Monitoring → Alerting: an e-mail channel; alert policies on the `arabat-ready` uptime
   check, on Cloud SQL backup failures and on failed `arabat-db-export` executions.
9. Checks in §9.4, then the first restore drill (§9.5).

### 9.3 Release
`bash infra/gcp/deploy.sh` from a clean, green commit: Cloud Build image → migration job
(the release stops if it fails) → new Cloud Run revision, which receives traffic only once
its readiness probe passes. Roll back: `gcloud run services update-traffic arabat-web
--region=me-central1 --to-revisions=PREVIOUS=100` (migrations are expand-only, §3).
Production releases need the owner's approval each time; the standing approval covers
Railway staging only (ADR-0088).

### 9.4 Checks after the first deploy
- `https://DOMAIN/api/v1/health/ready` → `ok`; `/manager`, `/pos`, `/platform`, `/store`
  load; the `run.app` address answers 404/403 (ingress closed).
- Client IP: sign in once and look at the newest `audit_log` / session row: the address must
  be the client's public IP, not a Google address (`35.191.x`, `130.211.x`). If it is
  Google's, change `TRUST_PROXY` in `config.env` and redeploy.
- Upload a product image, redeploy, the image is still there (Cloud Storage).
- `PAYMENT_MOCK_ENABLED` is `false` (deploy.sh sets it); no test payments in production.

### 9.5 Backups and restore
| Layer | What | Kept |
|---|---|---|
| Cloud SQL automated backups | daily at 23:00 UTC (02:00 Kuwait) | 90 backups |
| Point-in-time recovery | transaction logs | 7 days (Enterprise maximum) |
| Final backup | taken if the instance is ever deleted | 365 days |
| Enhanced backups (Backup and DR vault) | hourly + monthly, enforced retention, outside the project's control | 90 days / 1 year |
| SQL exports (Workflows + Scheduler) | daily `daily/arabat-<time>.sql.gz`, monthly `monthly/…` | ≥ 90 days (retention policy), daily deleted at 95 days, monthly to Coldline after 30 and deleted at 370 days |

- If Backup and DR is not offered in Doha, `provision.sh` fails at that step: remove the
  step and rely on the other four layers (record it in PROGRESS.md).
- After the owner confirms 90 days: `bash infra/gcp/provision.sh --lock-backup-bucket` — the
  retention can then never be shortened or removed, not even by the project owner.
- Restore (never over the live instance): `gcloud sql backups list --instance=…`; restore a
  backup or a point in time into a **new** instance (`gcloud sql instances clone … 
  --point-in-time=…`), check it (§4 restore checks), then point `db-admin-url` at it and redeploy.
- Monthly drill: clone to a temporary instance at a recent point in time, run the §4 checks
  (row counts, RLS policies, `app_runtime` sees nothing without a merchant), delete the clone,
  note the date and duration in PROGRESS.md.

### 9.6 Moving Railway's database (once, before production opens)
Decide first whether the pilot data moves at all: it contains test payments made with the
mock gateway (FND-709). If it moves:
1. Release this commit to Railway (migration 0048 must have run there).
2. Stop Railway writes (web service → 0 replicas) at a quiet hour.
3. `RAILWAY_DATABASE_URL=… bash infra/gcp/move-from-railway.sh` (Railway's public Postgres
   URL). It refuses unless Cloud SQL is still empty, restores in one transaction, runs the
   migrations (nothing pending) and compares row counts table by table. A copy of the dump
   stays in `var/`.
4. `bash infra/gcp/deploy.sh`, checks in §9.4, then switch the domain.
5. Keep Railway stopped, not deleted, for two weeks as the way back.
Railway staging has no volume (§8), so there are no product images to copy.

Rehearsal (2026-10-15, local): `bash scripts/verify-managed-postgres.sh` — PostgreSQL 18 with
an admin that has CREATEROLE/CREATEDB but no SUPERUSER/BYPASSRLS: two `--migrate-only` in
parallel (one waits for the lock), a third run idempotent, API ready as `app_runtime`, dump
of the development database restored with `--roles-only` + `pg_restore --role=app_owner`,
row counts equal, `app_runtime` sees 0 branches without a merchant and `app_owner` all 3.
The upgrade of a pre-0048 database (BYPASSRLS owner, forced RLS) was rehearsed with a
superuser admin: 0048 applied, BYPASSRLS removed, no table forced.
