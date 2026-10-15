#!/usr/bin/env bash
# One-time creation of the Google Cloud production environment in Doha (ADR-0105,
# OPERATIONS.md §9). Re-running skips what already exists. Every resource here is billed:
# run it only with the owner's approval of the cost (DECISIONS.md ADR-0105).
#
# Usage: bash infra/gcp/provision.sh            (reads infra/gcp/config.env)
#        bash infra/gcp/provision.sh --lock-backup-bucket   (irreversible, see §9.5)
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=config.example.env
source ./config.env

gc() { gcloud --project="$PROJECT_ID" --quiet "$@"; }
exists() { gc "$@" >/dev/null 2>&1; }
step() { printf '\n== %s\n' "$*"; }
bind_project_role() { # member role — retried: a new service account takes a while to be visible to IAM
  local i
  for i in 1 2 3 4 5 6; do
    gc projects add-iam-policy-binding "$PROJECT_ID" --member="$1" --role="$2" --condition=None \
      >/dev/null && return 0
    sleep $((i * 5))
  done
  return 1
}
random_secret() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-48; }
put_secret() { # name value — creates the secret once; never overwrites a stored value
  if exists secrets describe "$1"; then
    echo "secret $1 exists (kept)"
  else
    printf '%s' "$2" | gc secrets create "$1" --replication-policy=user-managed \
      --locations="$REGION" --data-file=-
  fi
}

if [[ "${1:-}" == "--lock-backup-bucket" ]]; then
  step "Lock the retention policy of gs://$BACKUP_BUCKET (cannot be undone or shortened)"
  read -r -p "Type the bucket name to confirm: " answer
  [[ "$answer" == "$BACKUP_BUCKET" ]] || { echo "Not confirmed."; exit 1; }
  gc storage buckets update "gs://$BACKUP_BUCKET" --lock-retention-period
  exit 0
fi

PROJECT_NUMBER=$(gc projects describe "$PROJECT_ID" --format='value(projectNumber)')
RUN_SA="arabat-run@$PROJECT_ID.iam.gserviceaccount.com"
BACKUP_SA="arabat-backup@$PROJECT_ID.iam.gserviceaccount.com"
CONNECTION="$PROJECT_ID:$REGION:$SQL_INSTANCE"

step "Enable the APIs"
gc services enable run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com compute.googleapis.com \
  cloudscheduler.googleapis.com workflows.googleapis.com monitoring.googleapis.com \
  logging.googleapis.com backupdr.googleapis.com

step "Artifact Registry repository $AR_REPO ($REGION)"
exists artifacts repositories describe "$AR_REPO" --location="$REGION" ||
  gc artifacts repositories create "$AR_REPO" --location="$REGION" --repository-format=docker

step "Service accounts"
exists iam service-accounts describe "$RUN_SA" ||
  gc iam service-accounts create arabat-run --display-name="Arabat Cloud Run"
exists iam service-accounts describe "$BACKUP_SA" ||
  gc iam service-accounts create arabat-backup --display-name="Arabat database exports"
for role in roles/cloudsql.client roles/secretmanager.secretAccessor roles/logging.logWriter; do
  bind_project_role "serviceAccount:$RUN_SA" "$role"
done
for role in roles/cloudsql.viewer roles/cloudsql.editor roles/workflows.invoker roles/logging.logWriter; do
  bind_project_role "serviceAccount:$BACKUP_SA" "$role"
done

step "Cloud SQL $SQL_INSTANCE: PostgreSQL 18, $SQL_TIER, no HA, daily backups + 7 days PITR"
if ! exists sql instances describe "$SQL_INSTANCE"; then
  # 23:00 UTC = 02:00 Kuwait. Maintenance on Sunday 00:00 UTC (03:00 Kuwait).
  # Public IP without authorised networks: only the Cloud SQL connector (IAM) can connect.
  gc sql instances create "$SQL_INSTANCE" --region="$REGION" --database-version=POSTGRES_18 \
    --edition=ENTERPRISE --tier="$SQL_TIER" --availability-type=ZONAL \
    --storage-type=SSD --storage-size="$SQL_STORAGE_GB" --storage-auto-increase \
    --backup-start-time=23:00 --retained-backups-count=90 \
    --enable-point-in-time-recovery --retained-transaction-log-days=7 \
    --deletion-protection --final-backup --final-backup-retention-days=365 \
    --maintenance-window-day=SUN --maintenance-window-hour=0 \
    --connector-enforcement=REQUIRED --ssl-mode=ENCRYPTED_ONLY \
    --database-flags=log_min_duration_statement=2000
fi
exists sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE" ||
  gc sql databases create "$DB_NAME" --instance="$SQL_INSTANCE"

step "Secrets (generated here, stored only in Secret Manager)"
if ! exists secrets describe db-admin-url; then
  ADMIN_PW=$(random_secret)
  gc sql users set-password postgres --instance="$SQL_INSTANCE" --password="$ADMIN_PW"
  put_secret db-admin-url "postgresql://postgres:$ADMIN_PW@localhost/$DB_NAME?host=/cloudsql/$CONNECTION"
fi
put_secret app-owner-password "$(random_secret)"
put_secret app-runtime-password "$(random_secret)"
# Keep a copy of this one outside Google too: losing it locks platform operators out.
put_secret mfa-encryption-secret "$(random_secret)"
# Filled in once an e-mail provider is chosen (OPERATIONS.md §9.2); a placeholder until then.
put_secret smtp-url "smtp://localhost:25"

step "Bucket gs://$UPLOADS_BUCKET (product images, private, $REGION)"
exists storage buckets describe "gs://$UPLOADS_BUCKET" ||
  gc storage buckets create "gs://$UPLOADS_BUCKET" --location="$REGION" \
    --uniform-bucket-level-access --public-access-prevention --soft-delete-duration=30d
gc storage buckets add-iam-policy-binding "gs://$UPLOADS_BUCKET" \
  --member="serviceAccount:$RUN_SA" --role=roles/storage.objectUser >/dev/null

step "Bucket gs://$BACKUP_BUCKET (database exports, $BACKUP_BUCKET_LOCATION, 90-day retention)"
if ! exists storage buckets describe "gs://$BACKUP_BUCKET"; then
  gc storage buckets create "gs://$BACKUP_BUCKET" --location="$BACKUP_BUCKET_LOCATION" \
    --uniform-bucket-level-access --public-access-prevention --retention-period=90d
fi
cat >"${TMPDIR:-/tmp}/arabat-backup-lifecycle.json" <<'JSON'
{ "rule": [
  { "action": { "type": "Delete" }, "condition": { "age": 95, "matchesPrefix": ["daily/"] } },
  { "action": { "type": "SetStorageClass", "storageClass": "COLDLINE" },
    "condition": { "age": 30, "matchesPrefix": ["monthly/"] } },
  { "action": { "type": "Delete" }, "condition": { "age": 370, "matchesPrefix": ["monthly/"] } }
] }
JSON
gc storage buckets update "gs://$BACKUP_BUCKET" \
  --lifecycle-file="${TMPDIR:-/tmp}/arabat-backup-lifecycle.json"
# Cloud SQL's own service account writes the export files.
SQL_SA=$(gc sql instances describe "$SQL_INSTANCE" --format='value(serviceAccountEmailAddress)')
gc storage buckets add-iam-policy-binding "gs://$BACKUP_BUCKET" \
  --member="serviceAccount:$SQL_SA" --role=roles/storage.objectCreator >/dev/null

step "Daily and monthly exports (Workflows + Cloud Scheduler)"
gc workflows deploy arabat-db-export --location="$REGION" --source=backup-export.workflow.yaml \
  --service-account="$BACKUP_SA"
for job in daily monthly; do
  schedule='0 0 * * *'                       # 00:00 UTC = 03:00 Kuwait, after the backup
  [[ "$job" == monthly ]] && schedule='30 0 1 * *'
  args=$(printf '{"project":"%s","instance":"%s","database":"%s","bucket":"%s","prefix":"%s"}' \
    "$PROJECT_ID" "$SQL_INSTANCE" "$DB_NAME" "$BACKUP_BUCKET" "$job")
  if ! exists scheduler jobs describe "arabat-db-export-$job" --location="$REGION"; then
    gc scheduler jobs create http "arabat-db-export-$job" --location="$REGION" \
      --schedule="$schedule" --time-zone=UTC \
      --uri="https://workflowexecutions.googleapis.com/v1/projects/$PROJECT_ID/locations/$REGION/workflows/arabat-db-export/executions" \
      --http-method=POST --oauth-service-account-email="$BACKUP_SA" \
      --message-body="{\"argument\": $(printf '%s' "$args" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"
  fi
done

step "Enhanced backups: every 6 hours (the minimum for Cloud SQL), immutable, in a backup vault ($BACKUP_VAULT_RETENTION_DAYS days)"
# If Backup and DR is not offered in $REGION the commands fail here; the standard backups
# (90 daily, PITR 7 days) and the exports above still apply (OPERATIONS.md §9.5).
if ! exists backup-dr backup-vaults describe arabat-vault --location="$REGION"; then
  gc backup-dr backup-vaults create arabat-vault --location="$REGION" \
    --backup-min-enforced-retention="${BACKUP_VAULT_RETENTION_DAYS}d" --no-async
fi
if ! exists backup-dr backup-plans describe arabat-sql-plan --location="$REGION"; then
  gc backup-dr backup-plans create arabat-sql-plan --location="$REGION" \
    --resource-type=sqladmin.googleapis.com/Instance \
    --backup-vault="projects/$PROJECT_ID/locations/$REGION/backupVaults/arabat-vault" \
    --backup-rule="rule-id=six-hourly,retention-days=$BACKUP_VAULT_RETENTION_DAYS,recurrence=HOURLY,hourly-frequency=6,time-zone=UTC,backup-window-start=0,backup-window-end=24" \
    --backup-rule="rule-id=monthly,retention-days=365,recurrence=MONTHLY,days-of-month=1,time-zone=UTC,backup-window-start=0,backup-window-end=6"
fi
# The plan is created asynchronously; it can be associated only once ACTIVE.
for _ in $(seq 1 60); do
  [[ "$(gc backup-dr backup-plans describe arabat-sql-plan --location="$REGION" \
    --format='value(state)')" == ACTIVE ]] && break
  sleep 5
done
exists backup-dr backup-plan-associations describe arabat-sql --location="$REGION" ||
  gc backup-dr backup-plan-associations create arabat-sql --location="$REGION" \
    --workload-project="$PROJECT_ID" --resource="projects/$PROJECT_ID/instances/$SQL_INSTANCE" \
    --resource-type=sqladmin.googleapis.com/Instance \
    --backup-plan="projects/$PROJECT_ID/locations/$REGION/backupPlans/arabat-sql-plan"

step "Load balancer with Google-managed certificates for $DOMAIN ${REDIRECT_DOMAINS:-}"
exists compute addresses describe arabat-ip --global ||
  gc compute addresses create arabat-ip --global --ip-version=IPV4
exists compute network-endpoint-groups describe arabat-neg --region="$REGION" ||
  gc compute network-endpoint-groups create arabat-neg --region="$REGION" \
    --network-endpoint-type=serverless --cloud-run-service="$SERVICE"
# No --protocol / port name: a serverless NEG backend refuses a port name.
exists compute backend-services describe arabat-backend --global ||
  gc compute backend-services create arabat-backend --global \
    --load-balancing-scheme=EXTERNAL_MANAGED
[[ -n "$(gc compute backend-services describe arabat-backend --global \
  --format='value(backends[].group)')" ]] ||
  gc compute backend-services add-backend arabat-backend --global \
    --network-endpoint-group=arabat-neg --network-endpoint-group-region="$REGION"
# $DOMAIN is served; each of $REDIRECT_DOMAINS answers 301 to https://$DOMAIN (same path).
# The map is re-imported on every run so a change of domains in config.env takes effect.
cat >"${TMPDIR:-/tmp}/arabat-https.yaml" <<YAML
name: arabat-https
defaultService: https://www.googleapis.com/compute/v1/projects/$PROJECT_ID/global/backendServices/arabat-backend
YAML
if [[ -n "${REDIRECT_DOMAINS:-}" ]]; then
  cat >>"${TMPDIR:-/tmp}/arabat-https.yaml" <<YAML
hostRules:
- hosts: [$(echo $REDIRECT_DOMAINS | sed 's/ /, /g')]
  pathMatcher: to-primary
pathMatchers:
- name: to-primary
  defaultUrlRedirect:
    hostRedirect: $DOMAIN
    httpsRedirect: true
    stripQuery: false
    redirectResponseCode: MOVED_PERMANENTLY_DEFAULT
YAML
fi
gc compute url-maps import arabat-https --global --source="${TMPDIR:-/tmp}/arabat-https.yaml"
# One Google-managed certificate per host name: each turns ACTIVE on its own once its DNS
# record points here, so adding a host never takes the others' certificate down.
CERTS=()
for host in $DOMAIN ${REDIRECT_DOMAINS:-}; do
  cert="arabat-cert-${host//./-}"
  exists compute ssl-certificates describe "$cert" --global ||
    gc compute ssl-certificates create "$cert" --global --domains="$host"
  CERTS+=("$cert")
done
CERT_LIST=$(IFS=,; echo "${CERTS[*]}")
if exists compute target-https-proxies describe arabat-https-proxy --global; then
  gc compute target-https-proxies update arabat-https-proxy --global --ssl-certificates="$CERT_LIST"
else
  gc compute target-https-proxies create arabat-https-proxy --global \
    --url-map=arabat-https --ssl-certificates="$CERT_LIST"
fi
exists compute forwarding-rules describe arabat-https-rule --global ||
  gc compute forwarding-rules create arabat-https-rule --global \
    --load-balancing-scheme=EXTERNAL_MANAGED --address=arabat-ip \
    --target-https-proxy=arabat-https-proxy --ports=443
# HTTP → HTTPS redirect (within the same forwarding-rule charge for the first five rules).
if ! exists compute url-maps describe arabat-http-redirect --global; then
  cat >"${TMPDIR:-/tmp}/arabat-redirect.yaml" <<YAML
name: arabat-http-redirect
defaultUrlRedirect:
  httpsRedirect: true
  redirectResponseCode: MOVED_PERMANENTLY_DEFAULT
YAML
  gc compute url-maps import arabat-http-redirect --global \
    --source="${TMPDIR:-/tmp}/arabat-redirect.yaml"
fi
exists compute target-http-proxies describe arabat-http-proxy --global ||
  gc compute target-http-proxies create arabat-http-proxy --global --url-map=arabat-http-redirect
exists compute forwarding-rules describe arabat-http-rule --global ||
  gc compute forwarding-rules create arabat-http-rule --global \
    --load-balancing-scheme=EXTERNAL_MANAGED --address=arabat-ip \
    --target-http-proxy=arabat-http-proxy --ports=80

step "Uptime check and alerts to $ALERT_EMAIL"
# Re-created when the domain changes (an uptime check's host cannot be edited).
read -r UPTIME UPTIME_HOST < <(gc monitoring uptime list-configs \
  --format='value(displayName,name,monitoredResource.labels.host)' |
  awk '$1 == "arabat-ready" { print $2, $3; exit }') || true
if [[ -n "${UPTIME:-}" && "$UPTIME_HOST" != "$DOMAIN" ]]; then
  gc monitoring uptime delete "$UPTIME"
  UPTIME=""
fi
[[ -n "${UPTIME:-}" ]] ||
  gc monitoring uptime create arabat-ready --resource-type=uptime-url \
    --resource-labels="host=$DOMAIN,project_id=$PROJECT_ID" --path=/api/v1/health/ready \
    --protocol=https --period=1 --timeout=10

IP=$(gc compute addresses describe arabat-ip --global --format='value(address)')
cat <<DONE

Provisioned. Next (OPERATIONS.md §9):
  0. Data: either move Railway's database (move-from-railway.sh) or start empty; then
     bash infra/gcp/deploy.sh   (first image, migrations, Cloud Run service)
  1. DNS: A records $DOMAIN ${REDIRECT_DOMAINS:-} → $IP (the certificate turns ACTIVE only after that, up to 60 min).
  2. Monitoring → Alerting: notification channel $ALERT_EMAIL; policies for the uptime check
     arabat-ready and for failed backups / exports (§9.5).
  3. E-mail provider: replace the smtp-url secret, then redeploy.
  4. Once the owner confirms the 90-day export retention:
       bash infra/gcp/provision.sh --lock-backup-bucket
  Project number $PROJECT_NUMBER, Cloud SQL connection $CONNECTION.
DONE
