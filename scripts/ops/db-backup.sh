#!/usr/bin/env bash
# Logical backup of the application database (custom format, compressed, includes RLS
# policies, functions and grants). Run as the schema owner (app_owner), which bypasses RLS
# so every merchant's rows are included. See docs/OPERATIONS.md.
#   DATABASE_OWNER_URL=postgres://app_owner:…@host:5432/arabat_prod scripts/ops/db-backup.sh [out-dir]
# Production should additionally use the provider's point-in-time recovery (WAL archiving).
set -euo pipefail
: "${DATABASE_OWNER_URL:?Set DATABASE_OWNER_URL (schema owner connection string)}"
OUT_DIR="${1:-var/backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB_NAME="$(basename "${DATABASE_OWNER_URL%%\?*}")"
FILE="$OUT_DIR/${DB_NAME}-${STAMP}.dump"
pg_dump --format=custom --compress=6 --no-owner --file="$FILE" "$DATABASE_OWNER_URL"
# Verify the archive is readable before reporting success.
pg_restore --list "$FILE" > /dev/null
sha256sum "$FILE" > "$FILE.sha256"
echo "Backup written: $FILE ($(du -h "$FILE" | cut -f1))"
