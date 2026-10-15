#!/usr/bin/env bash
# Moves the Railway database into Cloud SQL once, before production opens (ADR-0105,
# OPERATIONS.md §9.6). Rehearsed locally by scripts/verify-managed-postgres.sh.
#
#   1. checks that Railway runs migration 0048 (no table forces RLS),
#   2. dumps Railway (pg_dump 18, custom format) — Railway must be stopped first,
#   3. checks that the Cloud SQL database is still empty (provision.sh, before deploy.sh)
#      and prepares the roles (hosted-start --roles-only),
#   4. restores as app_owner in one transaction, keeping the grants,
#   5. runs hosted-start --migrate-only (nothing should be pending) and compares row counts.
# Then release with deploy.sh. To start production without Railway's data, skip this script.
#
# Needs: Docker (postgres:18 for pg_dump / pg_restore), cloud-sql-proxy, gcloud, `pnpm build`.
# Usage: RAILWAY_DATABASE_URL=postgresql://…(Railway's public URL) bash infra/gcp/move-from-railway.sh
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=config.example.env
source ./config.env
ROOT=$(git rev-parse --show-toplevel)

gc() { gcloud --project="$PROJECT_ID" --quiet "$@"; }
secret() { gc secrets versions access latest --secret="$1"; }
pg18() { docker run --rm --network host -i -v "$WORK:/work" postgres:18 "$@"; }
: "${RAILWAY_DATABASE_URL:?set RAILWAY_DATABASE_URL to Railway Postgres public URL}"
PROXY_PORT=${PROXY_PORT:-6543}
WORK=$(mktemp -d)
cleanup() { [[ -n "${PROXY_PID:-}" ]] && kill "$PROXY_PID" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

echo "== Source checks"
FORCED=$(pg18 psql -X -At "$RAILWAY_DATABASE_URL" -c \
  "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relforcerowsecurity")
[[ "$FORCED" == 0 ]] || { echo "Deploy migration 0048 to Railway first ($FORCED tables force RLS)."; exit 1; }
cat <<'ASK'
Railway must accept no more writes during the move: set the web service to 0 replicas
(Railway → web → Settings → Deploy) or remove its domain, and wait for open shifts to close.
ASK
read -r -p "Type MOVE when Railway is stopped: " answer
[[ "$answer" == MOVE ]] || { echo "Not confirmed."; exit 1; }

echo "== Dump Railway"
pg18 pg_dump --format=custom --no-owner --file=/work/railway.dump "$RAILWAY_DATABASE_URL"
pg18 pg_restore --list /work/railway.dump | grep -v ' EXTENSION ' >"$WORK/restore.list"
cp "$WORK/railway.dump" "$ROOT/var/railway-$(date -u +%Y%m%dT%H%M%SZ).dump" # local copy, git-ignored

echo "== Prepare an empty Cloud SQL database"
cloud-sql-proxy --port="$PROXY_PORT" "$PROJECT_ID:$REGION:$SQL_INSTANCE" >"$WORK/proxy.log" 2>&1 &
PROXY_PID=$!
sleep 5
ADMIN_PW=$(secret db-admin-url | sed -E 's#^postgresql://postgres:([^@]+)@.*#\1#')
OWNER_PW=$(secret app-owner-password)
ADMIN_URL="postgresql://postgres:$ADMIN_PW@localhost:$PROXY_PORT/$DB_NAME"
TABLES=$(pg18 psql -X -At "$ADMIN_URL" -c \
  "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'")
[[ "$TABLES" == 0 ]] || { echo "The Cloud SQL database is not empty ($TABLES tables): refusing to restore."; exit 1; }
(cd "$ROOT" && DATABASE_ADMIN_URL="$ADMIN_URL" APP_OWNER_PASSWORD="$OWNER_PW" \
  APP_RUNTIME_PASSWORD="$(secret app-runtime-password)" \
  node apps/api/dist/database/cli/hosted-start.js --roles-only)

echo "== Restore as app_owner (one transaction)"
pg18 env PGPASSWORD="$OWNER_PW" pg_restore --no-owner --role=app_owner --exit-on-error \
  --single-transaction --use-list=/work/restore.list \
  -h localhost -p "$PROXY_PORT" -U app_owner -d "$DB_NAME" /work/railway.dump

echo "== Migrations (none should be pending) and row counts"
(cd "$ROOT" && NODE_ENV=production DATABASE_ADMIN_URL="$ADMIN_URL" APP_OWNER_PASSWORD="$OWNER_PW" \
  APP_RUNTIME_PASSWORD="$(secret app-runtime-password)" \
  MFA_ENCRYPTION_SECRET="$(secret mfa-encryption-secret)" PAYMENT_MOCK_ENABLED=false \
  node apps/api/dist/database/cli/hosted-start.js --migrate-only)
for t in merchants users memberships branches products sales payments refunds stock_movements audit_log; do
  SRC=$(pg18 psql -X -At "$RAILWAY_DATABASE_URL" -c "select count(*) from $t")
  DST=$(pg18 psql -X -At "$ADMIN_URL" -c "select count(*) from $t")
  printf '%-18s railway %8s  cloud sql %8s %s\n' "$t" "$SRC" "$DST" "$([[ $SRC == "$DST" ]] && echo ok || echo DIFFERENT)"
  [[ "$SRC" == "$DST" ]] || exit 1
done

echo "Restored. Next: bash infra/gcp/deploy.sh, check https://$DOMAIN, and keep Railway"
echo "stopped (not deleted) for two weeks."
