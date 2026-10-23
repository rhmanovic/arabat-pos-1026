---
name: operations-runbook
description: Production operations other than releasing — backups and restore (Cloud SQL, PITR, Backup and DR vault, `arabat-db-export` workflow, scripts/ops/db-backup.sh / db-restore.sh), migration rollback, health checks and Cloud Run logs, incident response, restore drills, scripts/perf/load-test.mjs, scripts/ops/assistant-trial.mjs and scripts/verify-managed-postgres.sh. Use when production is down or misbehaving, data looks damaged, a backup/restore/drill is asked for, or the owner asks "وش صار؟" about an outage; use deploy-production for releases.
---

# Operations runbook (production, Google Cloud Doha)

Sources: docs/OPERATIONS.md §1, §3–§6, §9 (9.1, 9.2a, 9.5, 9.6), ADR-0105, ADR-0122,
CLAUDE.md §2, §3.13, §8a, §9. Releasing, rollback of a release, gcloud sign-in and clean-up
are in the **deploy-production** skill; local runs in **run-api-locally** / **sandbox-setup**.

## Hard limits (owner's explicit approval in this conversation, every time)
- Never restore over, delete, stop or resize the live instance `arabat-prod-db`; restores go
  into a **new** instance / empty database only (OPERATIONS §4, §9.5).
- Never edit or delete financial / inventory rows; corrections are new documents (refund,
  void, adjustment) — CLAUDE.md §4, OPERATIONS §3, §6 "Data correction".
- Never delete or revoke a key, secret, service account or remote branch (CLAUDE.md §8a,
  OPERATIONS §9 "Owner's rule (2026-10-20)", ADR-0122). Rotating a leaked secret = add a new
  version; ask first.
- Never run `provision.sh --lock-backup-bucket` (irreversible), `provision.sh` (new paid
  resources), `move-from-railway.sh` or `reset-merchant-data.js --apply` (OPERATIONS §9.2a,
  §9.5, §9.6) without approval. Monthly drill clones cost money: ask before creating one.
- Ending sessions or suspending a merchant in production is a security action: confirm with
  the owner unless an active compromise is confirmed, then report at once.
- The session's safety layer refuses, whatever IAM allows: a service account granting itself
  roles (the owner adds roles in the console), `provision.sh` without an explicit approval
  sentence from the owner in the conversation, and reading production data through an ad-hoc
  Cloud Run job (check through `/platform`, e.g. its audit log, instead).
- A read-only diagnosis (logs, `describe`, `list`) needs no approval; sign in exactly as in
  deploy-production §3 and clean up as in its §6.

## 1. Health and logs
- `GET /api/v1/health/live` = process up; `GET /api/v1/health/ready` = DB round trip, 503
  `"status":"down"` when the DB is unreachable, includes `version` (= image commit tag)
  (`apps/api/src/modules/health/health.controller.ts`).
- The sandbox usually cannot reach `www.arabatapp.com`; probe through the Cloud Build curl
  step in deploy-production §4. Uptime check `arabat-ready` polls `/api/v1/health/ready`
  every minute (`infra/gcp/provision.sh`). **No alert policies or notification channel exist
  yet** (OPERATIONS §9 table, PROGRESS.md "Not done / open") — nobody is paged.
- Logs are pino JSON on stdout with `reqId` (= `x-request-id` header); secrets/tokens are
  redacted (OPERATIONS §5). Read them with
  `gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="arabat-web" AND severity>=WARNING' --freshness=1h --limit=200`
  (migrations: `resource.type="cloud_run_job" AND resource.labels.job_name="arabat-migrate"`).
- Messages that matter (OPERATIONS §5): `Transaction retried after 40P01` (sustained =
  lock-order bug, `database/database.service.ts`), `reconcile failed for merchant`
  (`ecommerce/online-payments.service.ts`), `Audit write failed` (`audit/audit.service.ts`),
  `applying … failed`; also online orders in `needs_attention`.
- Service shape (OPERATIONS §9.1): Cloud Run `arabat-web` min 1 / max 3, ingress only from
  the load balancer (`run.app` must answer 404); job `arabat-migrate`; Cloud SQL zonal, no HA.

## 2. Incident response
1. **Triage** (read-only): ready/live result, current revision
   (`gcloud run services describe arabat-web --region=me-central1`), recent revisions, error
   logs by `reqId`, Cloud SQL state (`gcloud sql instances describe arabat-prod-db`). Note the
   UTC start time and what changed (last release in PROGRESS.md).
2. **Tell the owner in Arabic** right away: what is affected (manager / POS / store), since
   when, what you will do next; copy errors as they are (CLAUDE.md §2, ADR-0122). Never claim
   a fix you have not verified.
3. **Mitigate** per OPERATIONS §6:
   - Release caused it → traffic back to the previous revision (deploy-production §5; covered
     by ADR-0122). Then fix forward on `main`.
   - API unhealthy, DB fine → logs by `reqId`; a new revision restarts instances.
   - DB down → no HA: wait for Cloud SQL recovery or restore into a new instance (§3 below,
     approval). POS terminals show "server unreachable"; device tills keep selling locally
     (device-app skill, ADR-0112).
   - Account compromise → disable the user / re-key the operator; end sessions with
     `update sessions set revoked_at = now(), revoke_reason = 'incident' where user_id = '…'`
     (or `merchant_id`); review `audit_log` (OPERATIONS §6).
   - Leaked `mfa-encryption-secret` / mail / gateway secret → new secret version, re-key
     operators, redeploy (OPERATIONS §6); approval first, old versions are not deleted.
   - Payment taken, order unpaid → `/online` orders "needs attention", "Check pending
     payments"; money refunds happen at the provider (OPERATIONS §6).
   - Merchant must be stopped → `/platform` → merchant → Suspend with a reason (data kept).
   - Forgotten operator password → `reset-operator-password.js` via one `arabat-migrate`
     execution with `--args` (OPERATIONS §8; not `create-operator.js`).
4. **Record**: entry in `docs/PROGRESS.md` (time line UTC, cause, action, revision, what is
   still open); a lasting decision → **new-adr** skill. Re-check `/health/ready` before closing.

## 3. Backups and restore (OPERATIONS §9.5, `infra/gcp/provision.sh`)
| Layer | Schedule | Kept |
|---|---|---|
| Cloud SQL automated backups | 23:00 UTC daily | 90 backups; final backup 365 days |
| PITR (transaction logs) | continuous | 7 days |
| Backup and DR vault `arabat-vault`, plan `arabat-sql-plan` | every 6 h + monthly | 90 d / 1 y, enforced |
| SQL exports: workflow `arabat-db-export` (`infra/gcp/backup-export.workflow.yaml`), scheduler `arabat-db-export-daily` (00:00 UTC) / `-monthly` (00:30 UTC on the 1st) | serverless export (`offload: true`) to `gs://arabat-prod-db-exports/{daily,monthly}/arabat-<time>.sql.gz` (europe-west3) | ≥ 90 d retention (not locked) |
- Check backups: `gcloud sql backups list --instance=arabat-prod-db`,
  `gcloud workflows executions list arabat-db-export --location=me-central1`,
  `gcloud storage ls gs://arabat-prod-db-exports/daily/`. A failed execution raises
  `Export failed …` in the workflow.
- Restore (approval): clone / restore into a **new** instance
  (`gcloud sql instances clone arabat-prod-db <new> --point-in-time=<RFC3339>`), run the §4
  checks of OPERATIONS (row counts, RLS policies present, `app_runtime` sees 0 rows without a
  merchant context), then point secret `db-admin-url` at it (new version) and redeploy.
- Logical dump / restore anywhere else: `DATABASE_OWNER_URL=… scripts/ops/db-backup.sh <dir>`
  (custom format, `pg_restore --list` check, `.sha256`); `TARGET_DATABASE_URL=…
  scripts/ops/db-restore.sh <file.dump>` (checks the checksum, refuses a non-empty target,
  roles `app_owner`/`app_runtime` must exist), then `pnpm db:migrate` against it. Use client
  tools of the server's major version (PG 18) (OPERATIONS §4).
- Also back up images (`gs://arabat-prod-uploads`, 30-day soft delete) and keep a copy of
  `mfa-encryption-secret` outside Google — losing it locks every operator out (OPERATIONS §2).
- First restore drill is still **open** (PROGRESS.md). Drill = clone to a temporary instance,
  §4 checks, delete only that clone, record date and duration in PROGRESS.md (OPERATIONS §9.5).

## 4. Migration rollback (OPERATIONS §3)
- No down migrations; released migrations are never edited; every migration is
  expand-only and works with the previous revision, so app rollback = previous revision.
- A wrong migration → new corrective migration (**new-migration** skill), released normally.
- Damaged data → restore into a new database (§3) + correcting documents, never row edits.
- A failed `arabat-migrate` execution stops the release (deploy-production §3); read the job
  log, fix forward. Migrations run under an advisory lock, so parallel runs wait.

## 5. Cloudflare and domains
- The session reaches `api.cloudflare.com` through the proxy (credentials injected; never print
  them). Allowed: read zones, read and create/edit DNS records of `arabatapp.com`
  (`*.arabatapp.com` and `stores.arabatapp.com` are proxied; `www`, root and mail records DNS
  only), read SSL settings. Not allowed: Registrar (domains, renewals), creating API tokens,
  Custom Hostnames (needs Cloudflare for SaaS enabled by the owner, OPERATIONS §9). Never delete a
  record or a token without the owner.
- Adding or changing a production host (done 2026-10-15 for `www.arabatapp.com`): `A` record
  → `34.49.242.209`, DNS only; set `DOMAIN` / `REDIRECT_DOMAINS` in `infra/gcp/config.env` and
  re-run `provision.sh` (approval): one managed certificate per host (`arabat-cert-<host>`) and a
  301 host rule. Keep the old certificate on `arabat-https-proxy` until the new ones are ACTIVE
  (15–40 min), then detach it; redeploy so the app's public URLs follow.
- A domain's registrar and expiry: RDAP (`https://rdap.verisign.com/com/v1/domain/<name>`) through Firecrawl (the sandbox cannot reach it).

## 6. E-mail delivery (OPERATIONS §8)
- Every outgoing message is built by `renderEmail` (`apps/api/src/kernel/mail/template.ts`):
  bilingual layout (Arabic RTL, then English), subject `ar | en`, caller text HTML-escaped, and
  the plain-text part keeps the link or code on a line of its own (integration tests parse
  `token=` and the code line from `text`). New e-mails go through it, never hand-written HTML.
- Sender: only `send.arabatapp.com` is verified at Resend, so `MAIL_FROM` must be
  `…@send.arabatapp.com`; a root-domain sender is refused with 403 `domain is not verified`.
  Production sends over SMTP (`SMTP_URL` to `smtp.resend.com`), staging over Resend's HTTP API
  (`MAIL_PROVIDER=resend`); both log `E-mail "<subject>" sent` (`SmtpMailer` / `ResendMailer`)
  on success and `Password reset request failed: …` / `Invitation e-mail failed: …` on refusal.
- "Nothing arrived" triage: `POST /auth/password/forgot` for an address without an active user
  answers 202 and logs **nothing** (anti-enumeration); the per-address limit is 5 per hour
  (429). So check first that the account exists, then the log lines above, then the provider's
  dashboard. The sandbox proxy blocks `api.resend.com`; on Railway `get-logs` with
  `types: ["dns","network-flow"]` shows whether the API reached `api.resend.com` at all.

## 7. Scripts
- `scripts/verify-managed-postgres.sh` — local rehearsal of Cloud SQL (admin without
  SUPERUSER/BYPASSRLS): parallel `--migrate-only`, idempotent re-run, API ready as
  `app_runtime`, dump restore, RLS visibility. Needs Docker, `pnpm build`, seeded dev DB
  (`pnpm db:up`); run it after changing roles, grants, RLS or `hosted-start`. Port
  `CHECK_PG_PORT` (default 55432). Local only (OPERATIONS §9.6 "Rehearsal").
- `scripts/perf/load-test.mjs --base http://localhost:3100 --products 5000 --sales 3000
  --concurrency 16 [--reads 30]` — creates its own merchant and loads a production build;
  development/staging only, **never production** (header of the script).
- `scripts/ops/assistant-trial.mjs --log var/api.log` — three Arabic questions to the POS
  assistant against a local API; paid Anthropic usage: only with the owner's approval
  (OPERATIONS §8; start the API with `env -u ANTHROPIC_BASE_URL`, CLAUDE.md §9).
