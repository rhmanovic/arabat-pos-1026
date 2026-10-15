#!/usr/bin/env bash
# Rehearses the Google Cloud SQL setup (ADR-0105, OPERATIONS.md §9) on a throw-away
# PostgreSQL 18 container whose admin user has what Cloud SQL's `postgres` user has:
# CREATEROLE and CREATEDB, but no SUPERUSER and no BYPASSRLS.
#
#   1. hosted-start --migrate-only on an empty database (twice in parallel: one migrates,
#      the other waits for the advisory lock), then once more (idempotent);
#   2. the API starts as app_runtime and reports ready;
#   3. a dump of the local development database (the Railway → Cloud SQL move) restores
#      into a second database prepared with --roles-only, and needs no further migration;
#   4. app_runtime sees no merchant rows without a merchant context; app_owner sees all.
#
# Needs: Docker, `pnpm build`, the local development database (`pnpm db:up`, seeded).
# Usage: bash scripts/verify-managed-postgres.sh
set -euo pipefail

cd "$(dirname "$0")/.."
NAME=arabat-managed-pg-check
PORT=${CHECK_PG_PORT:-55432}
ADMIN=cloudsql_admin_sim
ADMIN_PW=admin_sim_password_0123456789
OWNER_PW=owner_sim_password_0123456789
RUNTIME_PW=runtime_sim_password_012345678
LOCAL_DEV_URL=${LOCAL_DEV_SUPERUSER_URL:-postgres://postgres:postgres_dev_only@localhost:5432/arabat_dev}
WORK=$(mktemp -d)

cleanup() {
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }
psql_c() { docker exec -i "$NAME" psql -v ON_ERROR_STOP=1 -X -At "$@"; }

step "Start a fresh PostgreSQL 18 and a Cloud SQL-like admin user"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=superuser_sim -p "$PORT:5432" postgres:18 >/dev/null
for _ in $(seq 1 60); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2
psql_c -U postgres <<SQL
CREATE ROLE $ADMIN LOGIN PASSWORD '$ADMIN_PW' CREATEROLE CREATEDB NOSUPERUSER NOBYPASSRLS;
CREATE DATABASE arabat OWNER $ADMIN;
CREATE DATABASE arabat_restore OWNER $ADMIN;
SQL
psql_c -U postgres -c "select rolsuper, rolbypassrls from pg_roles where rolname = '$ADMIN'"

export NODE_ENV=production
export DATABASE_ADMIN_URL="postgres://$ADMIN:$ADMIN_PW@localhost:$PORT/arabat"
export APP_OWNER_PASSWORD=$OWNER_PW
export APP_RUNTIME_PASSWORD=$RUNTIME_PW
export MFA_ENCRYPTION_SECRET=sim-only-secret-0123456789-0123456789-0123
export PAYMENT_MOCK_ENABLED=false
export SMTP_URL=smtp://localhost:1025
START=apps/api/dist/database/cli/hosted-start.js

step "Migrate an empty database twice in parallel (advisory lock), then again"
node "$START" --migrate-only >"$WORK/m1.log" 2>&1 &
P1=$!
node "$START" --migrate-only >"$WORK/m2.log" 2>&1 &
P2=$!
wait $P1 || { cat "$WORK/m1.log"; exit 1; }
wait $P2 || { cat "$WORK/m2.log"; exit 1; }
tail -n 3 "$WORK/m1.log" "$WORK/m2.log"
node "$START" --migrate-only | tail -n 2
psql_c -U postgres -d arabat -c "select rolname, rolsuper, rolbypassrls from pg_roles where rolname like 'app_%' order by 1"
FORCED=$(psql_c -U postgres -d arabat -c "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relforcerowsecurity")
[[ "$FORCED" == 0 ]] || { echo "tables still force RLS: $FORCED"; exit 1; }

step "Start the API as app_runtime and check readiness"
PORT=3999 SERVE_WEB=false node "$START" >"$WORK/api.log" 2>&1 &
API_PID=$!
READY=""
for _ in $(seq 1 60); do
  if READY=$(curl -fsS http://localhost:3999/api/v1/health/ready 2>/dev/null); then break; fi
  sleep 1
done
[[ -n "$READY" ]] || { tail -n 40 "$WORK/api.log"; exit 1; }
echo "$READY"
kill "$API_PID"; wait "$API_PID" 2>/dev/null || true; API_PID=""

step "Restore a dump of the local development database (Railway → Cloud SQL rehearsal)"
DATABASE_ADMIN_URL="postgres://$ADMIN:$ADMIN_PW@localhost:$PORT/arabat_restore" node "$START" --roles-only | tail -n 1
# Same commands as OPERATIONS.md §9.6: grants are kept (they name app_owner / app_runtime,
# which --roles-only created); extensions are skipped (--roles-only created them).
docker run --rm --network host -e PGPASSWORD=postgres_dev_only postgres:18 \
  pg_dump --format=custom --no-owner "$LOCAL_DEV_URL" >"$WORK/dev.dump"
docker run --rm -i postgres:18 pg_restore --list <"$WORK/dev.dump" | grep -v ' EXTENSION ' >"$WORK/dev.list"
docker run --rm --network host -i -v "$WORK:/work:ro" -e PGPASSWORD=$OWNER_PW postgres:18 \
  pg_restore --no-owner --role=app_owner --exit-on-error --single-transaction \
  --use-list=/work/dev.list -h localhost -p "$PORT" -U app_owner -d arabat_restore /work/dev.dump
DATABASE_ADMIN_URL="postgres://$ADMIN:$ADMIN_PW@localhost:$PORT/arabat_restore" node "$START" --migrate-only | tail -n 2
for t in merchants users memberships branches roles products sales audit_log; do
  SRC=$(docker run --rm --network host -e PGPASSWORD=postgres_dev_only postgres:18 \
    psql -X -At "$LOCAL_DEV_URL" -c "select count(*) from $t")
  DST=$(psql_c -U postgres -d arabat_restore -c "select count(*) from $t")
  echo "$t: source $SRC, restored $DST"
  [[ "$SRC" == "$DST" ]] || { echo "row count differs for $t"; exit 1; }
done

step "Tenant isolation after the restore"
RUNTIME_SEES=$(docker exec -e PGPASSWORD=$RUNTIME_PW "$NAME" psql -X -At -h localhost -U app_runtime -d arabat_restore -c "select count(*) from branches")
OWNER_SEES=$(docker exec -e PGPASSWORD=$OWNER_PW "$NAME" psql -X -At -h localhost -U app_owner -d arabat_restore -c "select count(*) from branches")
echo "branches visible to app_runtime without merchant: $RUNTIME_SEES; to app_owner: $OWNER_SEES"
[[ "$RUNTIME_SEES" == 0 ]] || { echo "app_runtime must not see rows without a merchant"; exit 1; }
[[ "$OWNER_SEES" -gt 0 ]] || { echo "app_owner should see every merchant's rows"; exit 1; }

step "OK: the hosted start and the restore work without SUPERUSER or BYPASSRLS"
