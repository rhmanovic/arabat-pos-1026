#!/usr/bin/env bash
# Releases the current commit to Google Cloud production (ADR-0105, OPERATIONS.md §9.3):
#   1. Cloud Build builds the Dockerfile into Artifact Registry (tag = commit),
#   2. the Cloud Run job runs migrations and reference seeds (hosted-start --migrate-only)
#      and the release stops if they fail,
#   3. the Cloud Run service gets the new revision; Cloud Run moves traffic only after the
#      readiness probe passes, so a broken build never replaces the running one.
# Production releases need the owner's approval (CLAUDE.md §3.13); staging approval does
# not cover this.
#
# Usage: bash infra/gcp/deploy.sh             (reads infra/gcp/config.env)
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=config.example.env
source ./config.env

gc() { gcloud --project="$PROJECT_ID" --quiet "$@"; }

[[ -z "$(git status --porcelain)" ]] || { echo "Commit or stash local changes first."; exit 1; }
TAG=$(git rev-parse --short=12 HEAD)
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$AR_REPO/arabat:$TAG"
RUN_SA="arabat-run@$PROJECT_ID.iam.gserviceaccount.com"
CONNECTION="$PROJECT_ID:$REGION:$SQL_INSTANCE"
SECRETS="DATABASE_ADMIN_URL=db-admin-url:latest,APP_OWNER_PASSWORD=app-owner-password:latest,APP_RUNTIME_PASSWORD=app-runtime-password:latest,MFA_ENCRYPTION_SECRET=mfa-encryption-secret:latest,SMTP_URL=smtp-url:latest"
# The assistant (ADR-0107 amendment) is on only when the secret `anthropic-api-key` exists;
# without it no request leaves the server and the chat opens with "not enabled".
if gc secrets describe anthropic-api-key >/dev/null 2>&1; then
  SECRETS="$SECRETS,ANTHROPIC_API_KEY=anthropic-api-key:latest"
  echo "== Assistant: on (secret anthropic-api-key)"
else
  echo "== Assistant: off (no secret anthropic-api-key)"
fi
# E-mail (invitations, password reset): through Resend's HTTP API when the secret `mail-api-key`
# exists (the domain verified at Resend is MAIL_DOMAIN, send.arabatapp.com); otherwise SMTP_URL.
MAIL_VARS=""
if gc secrets describe mail-api-key >/dev/null 2>&1; then
  SECRETS="$SECRETS,MAIL_API_KEY=mail-api-key:latest"
  MAIL_VARS=",MAIL_PROVIDER=resend"
  echo "== E-mail: Resend (secret mail-api-key)"
else
  echo "== E-mail: SMTP_URL (no secret mail-api-key)"
fi
ENV_VARS="APP_VERSION=$TAG,PAYMENT_MOCK_ENABLED=false,FILE_STORAGE_DRIVER=gcs,GCS_BUCKET=$UPLOADS_BUCKET,TRUST_PROXY=$TRUST_PROXY,PUBLIC_MANAGER_URL=https://$DOMAIN/manager,PUBLIC_POS_URL=https://$DOMAIN/pos,PUBLIC_STORE_URL=https://$DOMAIN/store,STORE_DOMAIN=${STORE_DOMAIN:-},MAIL_FROM=Arabat POS <no-reply@${MAIL_DOMAIN:-$DOMAIN}>$MAIL_VARS"

echo "== Build $IMAGE"
if ! gc artifacts docker images describe "$IMAGE" >/dev/null 2>&1; then
  gc builds submit "$(git rev-parse --show-toplevel)" --region="$REGION" --tag="$IMAGE"
fi

echo "== Migrations (job $MIGRATE_JOB)"
gc run jobs deploy "$MIGRATE_JOB" --region="$REGION" --image="$IMAGE" \
  --service-account="$RUN_SA" --set-cloudsql-instances="$CONNECTION" \
  --set-secrets="$SECRETS" --set-env-vars="^|^${ENV_VARS//,/|}" \
  --command=node --args=apps/api/dist/database/cli/hosted-start.js,--migrate-only \
  --cpu=1 --memory=1Gi --max-retries=0 --task-timeout=15m
gc run jobs execute "$MIGRATE_JOB" --region="$REGION" --wait

echo "== Service $SERVICE"
# One instance always on with CPU always allocated: the API reconciles online payments
# every minute in the background (OPERATIONS.md §9.1). Up to 3 instances under load.
# Ingress only through the load balancer, so the run.app address is closed.
gc run deploy "$SERVICE" --region="$REGION" --image="$IMAGE" \
  --service-account="$RUN_SA" --add-cloudsql-instances="$CONNECTION" \
  --set-secrets="$SECRETS" --set-env-vars="^|^${ENV_VARS//,/|}" \
  --cpu=1 --memory=1Gi --min-instances=1 --max-instances=3 --concurrency=80 \
  --no-cpu-throttling --cpu-boost --timeout=300 --execution-environment=gen2 \
  --ingress=internal-and-cloud-load-balancing --allow-unauthenticated \
  --startup-probe=httpGet.path=/api/v1/health/ready,initialDelaySeconds=5,periodSeconds=5,failureThreshold=24,timeoutSeconds=4 \
  --liveness-probe=httpGet.path=/api/v1/health/live,periodSeconds=30,failureThreshold=3,timeoutSeconds=5

echo "Released $TAG to https://$DOMAIN"
