---
name: deploy-production
description: Release `main` to staging (Railway, ADR-0088) and to production on Google Cloud Doha (`infra/gcp/deploy.sh`, ADR-0122), including checks, rollback and the PROGRESS.md release record. Use whenever asked to release, deploy, publish or "انشر" to staging or production, or after finishing work that must go live.
---

# Releasing Arabat (staging + production)

Sources: CLAUDE.md §3.13 and §8a, docs/OPERATIONS.md §3, §8, §9 (§9.3 release), ADR-0088,
ADR-0105, ADR-0110, ADR-0122. If anything here disagrees with ADR-0122, ADR-0122 wins.

## Hard limits (never cross, not even when asked indirectly)
- Never delete, revoke, rotate or retype a key, secret, service account or service-account
  key (Secret Manager, IAM keys, Railway variables, sandbox env vars). Keys are moved, never
  pasted into the repo, a log or chat. Never print a secret.
- Never set `PAYMENT_MOCK_ENABLED=true` in production, never connect a live payment gateway,
  never add paid costs (SMS, gateways, larger instances, `anthropic-api-key`, HA, new
  resources, `provision.sh`) without the owner's explicit approval in this conversation.
- Never delete a remote branch. Never `--force` push `main`.
- Never run `provision.sh --lock-backup-bucket`, `move-from-railway.sh` or
  `reset-merchant-data.js --apply` as part of a release.
- Release only from `main`. Staging approval (ADR-0088) never covers production; production is
  covered only by ADR-0122 and only after all preconditions below.

## 1. Preconditions (all must hold; otherwise stop)
```bash
git fetch origin main && git switch main && git pull --ff-only origin main
git status --porcelain            # must be empty (deploy.sh refuses otherwise)
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
pnpm verify && pnpm test:integration && pnpm test:e2e   # see the run-tests skill for env prep
```
Note the three pass counts; they go into the release record. Any failure: fix it (never skip
or disable a test), merge to `main`, start again. Work from a `claude/*` branch is merged into
`main` and pushed first (§8a).

## 2. Staging (Railway, standing approval ADR-0088)
- Service `web` in project `arabat-pos` follows branch `main`
  (`https://web-production-bf628.up.railway.app`). Push `main` to `origin`.
- Pushes are not picked up reliably and variable changes rebuild from a stale default branch:
  reconnect the source (Railway tool `connect-service-source`, repo `rhmanovic/arabat-pos-1026`,
  branch `main`), then `list-deployments` until the newest has `meta.branch = main`, the
  commit you pushed and status `SUCCESS`. Note the deployment id (8 chars).
- A variable change alone also rebuilds from the stale branch: set it with `set-variables`
  `skipDeploys: true`, then `connect-service-source` (one build instead of two).
- Judge what is running by `list-deployments` (`meta.branch`, `commitHash`), never by
  `Mapped {…}` route lines in `get-logs`: Railway drops lines in the start-up burst, so a missing
  route line proves nothing. The `get-logs` `filter` is a plain substring.
- Check readiness: `https://web-production-bf628.up.railway.app/api/v1/health/ready` → 200, or
  run the `Staging smoke` GitHub workflow (`check=health`) if the sandbox cannot reach it.
  `workflow_dispatch` works only for a workflow file that exists on the default branch (404
  otherwise).
- E-mail on staging (Resend over HTTP, OPERATIONS §8): `check=forgot-password` with `email` in
  the same workflow, for an address that **has an active account** (an unknown address answers
  202 and logs nothing; 5 requests per address per hour, then 429). In the deploy log success is
  `E-mail "…" sent` from `ResendMailer`; refusal is `Password reset request failed:
  ResendMailer: provider answered <status> …` (seen: 401 `API key is invalid` = wrong
  `MAIL_API_KEY`; 403 `domain is not verified` = sender not under `send.arabatapp.com`, the only
  domain verified at Resend). `types: ["dns","network-flow"]` in `get-logs` shows whether
  `api.resend.com` was contacted at all.
- If Railway answers "Deploys have been paused temporarily", retry later and record
  "Staging not updated" in the release entry. If no Railway tool/access exists in the session,
  say so to the owner (in Arabic) instead of inventing a result, and write
  `Staging not updated: no Railway access in this session` in the release entry.

## 3. Production (Google Cloud `arabat-511416`, `me-central1`, ADR-0122)
Needs: `gcloud` (at `/usr/local/bin/gcloud` in the sandbox) and a service-account key in an env
var (base64 of the JSON key), tried in this order:
- `GCP_Admin_KEY_01` — `arabat-admin` (project Owner).
- `GCP_SA_KEY_B64` — `arabat-deployer@arabat-511416.iam.gserviceaccount.com`: enough for the whole
  of `deploy.sh` and for `gcloud run jobs execute arabat-migrate` (release `50d8325b1d9e` on
  2026-10-20 was made with it), and for read-only diagnosis (lists / describes Cloud Run services
  and revisions, Cloud SQL instances, Artifact Registry, secret names, buckets and builds). It has
  no project Viewer (so `builds submit` stops after submitting, see below), is refused
  `projects get-iam-policy`, and has no IAM key rights.
- `GCP_ADMIN_KEY_B64` is a dead key: `gcloud auth activate-service-account` fails with
  `invalid_grant: Invalid JWT Signature` (the key was deleted in GCP). Check that the key you pick
  still signs in before starting the work.
If gcloud is missing, every variable is absent, or sign-in fails: **stop**, release nothing, and
tell the owner in Arabic exactly what is missing and the error text as is.

```bash
cp infra/gcp/config.example.env infra/gcp/config.env       # git-ignored; values are correct as is
# Sign in without writing the key to disk or printing it (process substitution):
gcloud auth activate-service-account --key-file=<(printf %s "$GCP_Admin_KEY_01" | base64 -d)
gcloud config set project arabat-511416
# The sandbox may export CLOUDSDK_AUTH_ACCESS_TOKEN, which overrides the activated account;
# if commands run as the wrong identity, prefix them with `env -u CLOUDSDK_AUTH_ACCESS_TOKEN`.
gcloud run services describe arabat-web --region=me-central1 \
  --format='value(status.latestReadyRevisionName)'          # note PREVIOUS revision for rollback
bash infra/gcp/deploy.sh 2>&1 | tee "$SCRATCHPAD/deploy-$(git rev-parse --short=12 HEAD).log"
```
`$SCRATCHPAD` = this session's scratchpad directory. What `deploy.sh` does: Cloud Build image
`me-central1-docker.pkg.dev/arabat-511416/arabat/arabat:<12-char commit>` (skipped if it already
exists) → Cloud Run job `arabat-migrate` (`hosted-start.js --migrate-only`: migrations + reference
seeds as `app_owner`; **the release stops if it fails**) → new `arabat-web` revision, which gets
traffic only after `/api/v1/health/ready` passes. It always sets `PAYMENT_MOCK_ENABLED=false`,
`FILE_STORAGE_DRIVER=gcs`, `STORE_DOMAIN`, and adds `ANTHROPIC_API_KEY` / `MAIL_API_KEY` only if
those secrets already exist (never create them yourself). If it stops right after
`builds submit` (an identity without project Viewer cannot stream build logs), run it once more:
the image is found and the release continues.

Read the log of **this** run only (a new file per run, started in the same command): a wait loop
on an older log reads the previous release. `Released <tag>` must equal `git rev-parse --short=12
HEAD`. If the push of `main` is refused ("fetch first", another session pushed), `git pull
--rebase origin main` your unpushed commits, check what came in, then push.

Migrations must be expand-only and backward compatible with the previous revision (OPERATIONS
§3); never edit a released migration. From the log note: commit tag, migration execution name
(`arabat-migrate-xxxxx`) and whether a migration was applied, and the new revision
(`arabat-web-000NN-xxx`).

## 4. Smoke checks (from inside Google Cloud)
The sandbox usually cannot reach `www.arabatapp.com`; check through a Cloud Build step:
```bash
cat > "$SCRATCHPAD/check.yaml" <<'EOF'
steps:
- name: gcr.io/cloud-builders/curl
  entrypoint: bash
  args: ['-c', 'set -e; B=https://www.arabatapp.com; curl -sS -w " %{http_code}\n" $$B/api/v1/health/ready;
    for p in /api/v1/health/live /manager/ /pos/ /platform/ /store/ /online/ /links/; do
    curl -s -o /dev/null -w "%{http_code} $$p\n" $$B$$p; done']
EOF
gcloud builds submit --no-source --region=me-central1 --config="$SCRATCHPAD/check.yaml"
```
Shell variables inside a Cloud Build step are written `$$B` / `$$p`: a single `$` is a Cloud
Build substitution and the build is rejected.
Pass = `ready` 200 with `"version":"<commit tag>"` and database ok, every page 200. Add the
checks the change itself needs (e.g. a store sub-domain `https://<slug>.arabatapp.com/` 200, old
`/store/<slug>` 301). Note the build id (8 chars).

Production and staging have separate databases (production started empty, 2026-10-15):
accounts made on Railway do not exist on `www.arabatapp.com`. An owner who says "the password
is right on Railway but refused here" needs a production account (`/manager/register` or the
platform), or an approved move of Railway's data before anything is registered (OPERATIONS §9.6).

## 5. Rollback (any failed check)
```bash
gcloud run services update-traffic arabat-web --region=me-central1 --to-revisions=PREVIOUS=100
```
Re-run the smoke check, then report to the owner at once in Arabic with the error copied as
is. Never roll back a migration or edit data: fix forward with a new migration / correcting
documents (OPERATIONS §3). Damaged data: restore into a new instance only (OPERATIONS §9.5),
with the owner's approval.

## 6. Clean up (always, also after a failure)
```bash
gcloud auth revoke --all
rm -f infra/gcp/config.env
```
Do not delete or revoke the key in GCP, and do not unset the env variables.

## 7. Record the release
Add to the feature's entry in `docs/PROGRESS.md` (newest entries are near the top), commit
`docs(progress): record the <change> release` on `main` and push:
```
- Verified (cloud sandbox): `pnpm verify` 440, `pnpm test:integration` 321, `pnpm test:e2e` 47.
- Released (ADR-0122, ADR-0088): staging (Railway, deployment `4c1fe69f`, SUCCESS) and production
  `b242b3c8e6f7` (revision `arabat-web-00075-mmt`, migration job `arabat-migrate-j9tpl`, no new
  migration). Cloud Build check `69736008`: ready 200, database ok; `/manager/`, `/store/` and
  `/online/` 200. Signed out, `config.env` removed; no key deleted.
```
Use `Released (ADR-0122):` alone when staging was not updated, and say why. Name an applied
migration (`migration 0070 applied`). Then report to the owner in Arabic: commit, revision,
migration result, health version, anything not done.
