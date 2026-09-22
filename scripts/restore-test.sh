#!/bin/sh
# Private Manager — disaster recovery test.
# Restores the latest (or a named) backup into a temporary database,
# verifies core tables and row counts, then drops the temporary database.
# Environment (injected by compose): PGHOST, PGDATABASE, PGUSER, PGPASSWORD.
# Optional: BACKUP_DIR. Usage: restore-test.sh [path/to/backup.dump]

set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
TEST_DB="private_manager_restore_test"
BACKUP_FILE="${1:-}"

if [ -z "$BACKUP_FILE" ]; then
  BACKUP_FILE="$(ls -1t "$BACKUP_DIR"/private-manager-*.dump 2>/dev/null | head -n 1 || true)"
fi

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "[restore-test] No backup found in $BACKUP_DIR" >&2
  exit 1
fi

echo "[restore-test] Restoring: $BACKUP_FILE"

cleanup() {
  psql -d "$PGDATABASE" -c "DROP DATABASE IF EXISTS $TEST_DB;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Start from a clean temporary database, then restore into it.
cleanup
psql -d "$PGDATABASE" -v ON_ERROR_STOP=1 -c "CREATE DATABASE $TEST_DB;" >/dev/null
pg_restore --no-owner --no-acl -d "$TEST_DB" "$BACKUP_FILE"

objects_count="$(psql -d "$TEST_DB" -tAc 'SELECT count(*) FROM objects;')"
checklist_count="$(psql -d "$TEST_DB" -tAc 'SELECT count(*) FROM checklist_items;')"
updates_count="$(psql -d "$TEST_DB" -tAc 'SELECT count(*) FROM object_updates;')"
categories_count="$(psql -d "$TEST_DB" -tAc 'SELECT count(*) FROM categories;')"

echo "[restore-test] OK objects=$objects_count checklist_items=$checklist_count object_updates=$updates_count categories=$categories_count"
