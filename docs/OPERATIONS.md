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
sign in), e-mail delivery (`MAIL_PROVIDER=smtp` with a reachable `SMTP_URL`, or
`MAIL_PROVIDER=resend|brevo` with `MAIL_API_KEY`; the API warns at start-up when it is left at
the local Mailpit default), `MAIL_FROM`, `PUBLIC_MANAGER_URL`, `PUBLIC_POS_URL`,
`PUBLIC_STORE_URL`, `TRUST_PROXY` (hop count or proxy CIDRs of the load balancer).
Optional: `SALES_NOTIFY_EMAIL` (default `info@arabatapp.com`) receives the pricing-page requests (ADR-0114).
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

## 7a. Domain and e-mail (ADR-0108)

DNS of `arabatapp.com` is in Cloudflare. Records in place (2026-10-14):

| Record | Value | Purpose |
|---|---|---|
| `MX arabatapp.com` | `1 smtp.google.com` | Google Workspace mailboxes |
| `TXT arabatapp.com` | `v=spf1 include:_spf.google.com ~all` | SPF for Workspace |
| `TXT _dmarc.arabatapp.com` | `v=DMARC1; p=quarantine; adkim=r; aspf=r; pct=100` | DMARC (tightened after a test message showed SPF, DKIM and DMARC pass) |
| `TXT arabatapp.com` | `google-site-verification=…` | Workspace domain verification (verified 2026-10-14) |
| `TXT google._domainkey.arabatapp.com` | `v=DKIM1; k=rsa; p=…` (2048-bit) | Workspace DKIM |
| `TXT resend._domainkey.send.arabatapp.com` | `p=…` | Resend DKIM (region eu-west-1) |
| `CNAME rsend.send.arabatapp.com` | `rsend-euw1.forge.rmta.net` (DNS only) | Resend sending / SPF |
| `CNAME send.send.arabatapp.com` | `send.forge.rmta.net` (DNS only) | Resend return-path / SPF |

Google Workspace (Business Starter, monthly, 14-day trial) is active on `arabatapp.com` with
one user, the owner; further addresses are added as aliases. Resend (free plan) holds `send.arabatapp.com`; receiving is off; click / open tracking
must stay off (reset and invitation links must not pass through a tracker). At deployment set in production
`SMTP_URL=smtps://resend:<API key>@smtp.resend.com:465` and
`MAIL_FROM=no-reply@send.arabatapp.com`,.

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
| `MAIL_PROVIDER`, `MAIL_API_KEY`, `MAIL_FROM` | Railway blocks outbound SMTP below the Pro plan, so staging sends through a provider's HTTP API: `MAIL_PROVIDER=resend` or `brevo` with the provider's `MAIL_API_KEY` and a `MAIL_FROM` sender the provider has verified (ADR-0106). Without them password reset, invitation and account set-up e-mails are not delivered (the API logs a warning at start-up) |
| `ANTHROPIC_API_KEY`, `ASSISTANT_MODEL` | optional; the POS assistant (ADR-0107) is off without the key. Paid usage per question: set only with the owner's approval; `ASSISTANT_MODEL` defaults to `claude-opus-5-5`. Every model turn is logged as `assistant turn: N in / M out, cache write W / read R, stop …` (the cost record); `scripts/ops/assistant-trial.mjs --log <api log>` runs three demo questions and sums them at list price. Every question is also recorded in `assistant_requests` with its cost at the list prices in `apps/api/src/modules/assistant/assistant.pricing.ts` (update that table, and the trial script's, when Anthropic's price list changes); the super admin reads and exports them on `/platform/assistant` |

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
Forgotten operator password, authenticator kept: `node apps/api/dist/database/cli/reset-operator-password.js
--email …` sets a new one-time password only (TOTP secret, role and status unchanged), ends the
operator's sessions and writes `platform.operator.password_reset` to the audit log. On Google Cloud run
it as a one-off execution of the `arabat-migrate` job with `--args` overridden and read the password in
that execution's log (`create-operator.js` would also replace the authenticator).

Current staging deployment (2026-10-12): Railway project `arabat-pos`, environment
`production`, services `Postgres` + `web`, URL `https://web-production-bf628.up.railway.app`
(deploys on push to the connected branch). Verified after deploy: `/api/v1/health/ready` ok
(database ok), `/manager`, `/pos` and `/platform` load and report the server connected. No
volume yet; e-mail goes through Resend (below). First platform operator created by the bootstrap (credentials only
in the deploy log of 2026-10-12 14:42 UTC). Since 2026-10-14 21:47 UTC the web service follows
branch `claude/tender-wright-t34f5x` (POS assistant, ADR-0107) at the owner's request to try
the assistant as a cashier; switch it back to the default branch in the service's Source
settings once the branch is merged. `ANTHROPIC_API_KEY` is set on the service only with the
owner's say-so (paid usage). Since 2026-10-14 it holds a dedicated Anthropic workspace key
named `arabat-pos-staging` (rotated in from the owner's personal key, which is to be revoked
in the Anthropic Console); rotate it again by setting the variable on the web service, which
redeploys.

E-mail on staging (2026-10-15, ADR-0106): the web service sends through **Resend** with
`MAIL_PROVIDER=resend`, `MAIL_FROM=Arabat POS <no-reply@send.arabatapp.com>` and
`MAIL_API_KEY` holding the Resend key named `arabat-pos-staging` (sending access only,
restricted to the domain, created 2026-10-15; it lives only in the Railway variable, never in
the repository). The domain verified at Resend is the **subdomain `send.arabatapp.com`**, not
the root (the root's MX, SPF and DKIM belong to Google Workspace): its records on Cloudflare
are the DKIM TXT `resend._domainkey.send.arabatapp.com` and the CNAMEs
`send.send.arabatapp.com` and `rsend.send.arabatapp.com` (return-path and tracking hosts).
Sending from `no-reply@arabatapp.com` is refused by Resend with
`403 The arabatapp.com domain is not verified`; verify the root domain at Resend first if a
root-domain sender is ever wanted. Rotate the key by creating a new one in the Resend
dashboard, setting `MAIL_API_KEY` on the web service and revoking the old one. Verified
2026-10-15 04:23 UTC: a password reset requested on `/manager/forgot-password` logged
`E-mail "إعادة تعيين كلمة المرور | Reset your password" sent` from `ResendMailer`; a failure
logs `Password reset request failed: ResendMailer: provider answered <status> <body>`.

**Railway gotcha (2026-10-15):** a deployment triggered by a variable change or by
"Redeploy" is built from the service's stored source, which keeps reverting to the
repository's default branch (`claude/busy-babbage-yty2bo`, which has no `MAIL_PROVIDER`
code: it falls back to SMTP and logs `connect ECONNREFUSED ::1:1025`). After any variable
change, set it with deploys skipped and run `connect-service-source` (repo
`rhmanovic/arabat-pos-1026`, branch `claude/tender-wright-t34f5x`) so the build comes from
the right branch; `list-deployments` shows each deployment's `meta.branch`. Pushes to the
branch are also not picked up reliably; reconnect the source after pushing.
`POST /auth/password/forgot` for an address that has no
active merchant user answers 202 and logs nothing (anti-enumeration), so the end-to-end
check needs an existing account. `.github/workflows/staging-smoke.yml` (manual
`workflow_dispatch`, once the file is on the default branch) runs the readiness check or
such a reset request from a GitHub runner; the first run on 2026-10-15 00:41 UTC got 202 for
an address without a staging account, so no e-mail was sent yet.

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

## 9. Production on Google Cloud, Doha (ADR-0105) — created 2026-10-15

Created on 2026-10-15 with the owner's approval (cost, go-live, DNS). Project `arabat-511416`
(number 881032041590), region `me-central1`. What exists:

| Resource | Name / value |
|---|---|
| Domain | `https://www.arabatapp.com` (primary, owner 2026-10-15); `arabatapp.com` and `app.arabatpos.com` → 301 to it. Cloudflare `A` records (zones `arabatapp.com`, `arabatpos.com`) → `34.49.242.209`, DNS only (not proxied) |
| Load balancer | static IP `arabat-ip` 34.49.242.209; `arabat-https-rule` (443) → `arabat-https-proxy` (certs `arabat-cert-<host>`, one per host) → `arabat-https` (host rule: redirect hosts → 301 to `DOMAIN`) → `arabat-backend` → serverless NEG `arabat-neg`; `arabat-http-rule` (80) → `arabat-http-redirect` (301 to HTTPS) |
| Cloud Run | service `arabat-web` (ingress internal + load balancer; `https://arabat-web-881032041590.me-central1.run.app` is closed), job `arabat-migrate` |
| Cloud SQL | `arabat-prod-db` (PostgreSQL 18, `db-custom-1-3840`, zonal), database `arabat`, connection `arabat-511416:me-central1:arabat-prod-db`; started **empty** (Railway untouched) |
| Images | Artifact Registry `me-central1-docker.pkg.dev/arabat-511416/arabat/arabat:<commit>` |
| Buckets | `arabat-prod-uploads` (me-central1), `arabat-prod-db-exports` (europe-west3, 90-day retention **not locked**) |
| Secrets | `db-admin-url`, `app-owner-password`, `app-runtime-password`, `mfa-encryption-secret`, `smtp-url` (**placeholder** `smtp://localhost:25` until the Cloudflare token) |
| Service accounts | `arabat-run` (Cloud Run), `arabat-backup` (exports), `arabat-admin` (Owner; used to run the scripts) |
| Backups | Cloud SQL backups + PITR; Backup and DR vault `arabat-vault`, plan `arabat-sql-plan` (every 6 hours — the Cloud SQL minimum — kept 90 days; monthly kept 1 year), association `arabat-sql`; workflow `arabat-db-export` with scheduler jobs `arabat-db-export-daily` / `-monthly` |
| Monitoring | uptime check `arabat-ready`; **no notification channel or alert policies yet** (§9.2 step 8) |

The rest of this section is the runbook. Files: `infra/gcp/config.example.env` (copy to the
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
7. E-mail (Cloudflare Email Service): onboard `arabatapp.com` (`MAIL_DOMAIN`) under Email Service → Email
   Sending (adds SPF/DKIM/DMARC on `cf-bounce`), create an API token with *Email Sending: Edit*,
   and put `smtps://api_token:<token>@smtp.mx.cloudflare.net:465` into the `smtp-url` secret
   (`printf %s 'smtps://…' | gcloud secrets versions add smtp-url --data-file=-`), redeploy.
7b. E-mail through Resend (the domain verified there is `send.arabatapp.com`, `MAIL_DOMAIN`):
   store a Resend key with sending access as the secret `mail-api-key`
   (`printf %s 're_…' | gcloud secrets create mail-api-key --replication-policy=user-managed --locations=me-central1 --data-file=-`)
   and redeploy; `deploy.sh` then sets `MAIL_PROVIDER=resend` and `MAIL_API_KEY`. Without it
   e-mail goes to `smtp-url` (still the placeholder: invitations and password resets are not sent).
7a. Assistant (paid Anthropic usage, owner approval): store the key once with
   `printf %s 'sk-ant-…' | gcloud secrets create anthropic-api-key --replication-policy=user-managed --locations=me-central1 --data-file=-`
   (later keys: `gcloud secrets versions add anthropic-api-key --data-file=-`), then redeploy;
   `deploy.sh` passes it as `ANTHROPIC_API_KEY` only when the secret exists. Without it the chat
   panel on `/pos` and `/manager` only says the assistant is not enabled.
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

Results of the first deploy (2026-10-15, from Cloud Build): health ok, the four apps 200,
HTTP → 301 HTTPS, `run.app` 404, mock payments off. Open: client IP (a failed sign-in for
`ip-check@arabatpos.com` came from 34.18.38.234 — its audit row must show that address) and the
image-upload-survives-redeploy check (needs a first merchant).

### 9.5 Backups and restore
| Layer | What | Kept |
|---|---|---|
| Cloud SQL automated backups | daily at 23:00 UTC (02:00 Kuwait) | 90 backups |
| Point-in-time recovery | transaction logs | 7 days (Enterprise maximum) |
| Final backup | taken if the instance is ever deleted | 365 days |
| Enhanced backups (Backup and DR vault) | every 6 hours (Cloud SQL minimum) + monthly, enforced retention, outside the project's control | 90 days / 1 year |
| SQL exports (Workflows + Scheduler) | daily `daily/arabat-<time>.sql.gz`, monthly `monthly/…` | ≥ 90 days (retention policy), daily deleted at 95 days, monthly to Coldline after 30 and deleted at 370 days |

- Backup and DR is offered in Doha (checked 2026-10-15); it refuses a backup more often than every 6 hours for Cloud SQL.
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

## 10. Receipt printer at the till

The front end never prints (owner decision 2026-10-17, ADR-0111 amendment): no
`window.print()`, no print dialog, no print CSS. Every receipt is a server print job printed by
the print agent on the computer with the printer (§11). The till and the sale page only show the
receipt on screen; their "Print receipt" button queues a numbered copy. The earlier browser
printing and its Chrome `--kiosk-printing` launcher were removed.

Printer used at the first till: ImagePlus 810 (80 mm paper, 72 mm / 576 dots printable at
203 dpi, ESC/POS, Zywell driver), macOS CUPS queue `Printer_POS_80C` over USB; driver page
sizes 72 × 210 mm (default, the receipt HTML's page size), 72 × 297 mm, 72 × 3276 mm.

## 11. Server-side receipt printing (print agents, ADR-0111)

Receipts of sales from any device (phone, tablet, another computer) print on the computer that
has the receipt printer, through a separately built print agent:
1. Manager → **Receipt printers** (`/printers`) → **Add printer**: name, branch (or all
   branches). Copy the token shown; it is never shown again (create a new agent if lost).
2. Configure the agent with the server address `https://www.arabatapp.com` and the token. It
   uses `Authorization: Bearer <token>` on `/api/v1/print-agent/...` and Socket.IO
   (`/socket.io`, namespace `/print-agent`, `auth: { token }`).
3. The agent shows as **Online** while it is connected or called the API in the last 60 s.
4. "Print receipts automatically" (on by default) sends every completed sale; "Print receipt"
   on the till's receipt and on the manager's sale page sends a numbered copy at any time. The
   message says "أُرسل للطابعة", or "لا توجد طابعة متصلة" when no agent of the branch was seen
   in the last minute (the copy then waits and prints when one connects).
Removing an agent stops its token at once. Failed jobs keep the agent's error in
`print_jobs.error`; they are not retried by themselves.
