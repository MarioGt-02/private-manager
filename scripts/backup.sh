#!/bin/sh
# Private Manager — automated PostgreSQL logical backup.
# Runs pg_dump on a loop and keeps a rolling retention window.
# Environment (injected by compose): PGHOST, PGDATABASE, PGUSER, PGPASSWORD.
# Optional: BACKUP_DIR, BACKUP_INTERVAL_SECONDS, BACKUP_RETENTION_DAYS.

set -u

BACKUP_DIR="${BACKUP_DIR:-/backups}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

backup_once() {
  timestamp="$(date +%Y%m%d-%H%M%S)"
  file="$BACKUP_DIR/private-manager-$timestamp.dump"
  tmp="$file.tmp"

  if pg_dump -Fc --no-owner --no-acl -f "$tmp" "$PGDATABASE"; then
    mv "$tmp" "$file"
    echo "[backup] wrote $file"
    # Remove backups older than the retention window.
    find "$BACKUP_DIR" -name 'private-manager-*.dump' -type f -mtime "+${RETENTION_DAYS}" -delete 2>/dev/null || true
  else
    rm -f "$tmp"
    echo "[backup] FAILED at $(date +%F\ %T)" >&2
  fi
}

echo "[backup] started: interval=${INTERVAL}s retention=${RETENTION_DAYS}d db=${PGDATABASE}"
while true; do
  backup_once
  sleep "$INTERVAL"
done
