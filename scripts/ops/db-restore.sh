#!/usr/bin/env bash
# Restores a backup made by db-backup.sh into an EMPTY database (never over a live one).
# The roles app_owner and app_runtime must already exist (docker/postgres/init or the
# provider's equivalent). See docs/OPERATIONS.md for the full recovery procedure.
#   TARGET_DATABASE_URL=postgres://app_owner:…@host:5432/arabat_restore scripts/ops/db-restore.sh var/backups/x.dump
set -euo pipefail
FILE="${1:?Usage: db-restore.sh <backup.dump>}"
: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL (empty database, connect as app_owner)}"
if [ -f "$FILE.sha256" ]; then sha256sum --check --quiet "$FILE.sha256"; fi
TABLES="$(psql "$TARGET_DATABASE_URL" -tAc "select count(*) from pg_tables where schemaname = 'public'")"
if [ "$TABLES" != "0" ]; then
  echo "Refusing to restore: the target database is not empty ($TABLES tables)." >&2
  exit 1
fi
pg_restore --exit-on-error --no-owner --role=app_owner --dbname="$TARGET_DATABASE_URL" "$FILE"
echo "Restore finished. Run 'pnpm db:migrate' against it to apply any newer migrations."
