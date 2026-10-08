#!/usr/bin/env bash
# Prove a backup can actually be restored - Phase 22 S-23.
#
#   ./deploy/restore-check.sh backups/db-20261008T120000Z.dump
#   BACKUP_PASSPHRASE=... ./deploy/restore-check.sh backups/db-....dump.enc
#
# Restores into a SCRATCH database (never the live one), compares row counts of the key tables with the live
# database, prints the result, and drops the scratch database. A backup that has never been restored is a
# hope, not a backup: run this after the first backup, after every schema change, and on a schedule.
#
# Restoring over the live database is a deliberate, manual operation described in docs/disaster-recovery.md.
set -euo pipefail

SRC="${1:?usage: restore-check.sh <dump file>}"
PG_CONTAINER="${PG_CONTAINER:-alnajoum-postgres}"
DB_USER="${POSTGRES_USER:-alnajoum}"
LIVE_DB="${POSTGRES_DB:-alnajoum_erp}"
SCRATCH_DB="restore_check_$(date -u +%s)"
TABLES="${CHECK_TABLES:-identities customers invoices payments journal_entries wallet_transactions audit_logs flight_bookings}"

psql_in() { MSYS_NO_PATHCONV=1 docker exec -i "$PG_CONTAINER" psql -U "$DB_USER" -v ON_ERROR_STOP=1 -At "$@"; }

WORK="$(mktemp)"
trap 'rm -f "$WORK"; psql_in -d postgres -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\"" >/dev/null 2>&1 || true' EXIT

if [ -f "$SRC.sha256" ]; then
  echo "==> Checking checksum"
  ( cd "$(dirname "$SRC")" && sha256sum -c "$(basename "$SRC").sha256" )
fi

case "$SRC" in
  *.enc)
    : "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE to restore an encrypted backup}"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$SRC" -out "$WORK" -pass env:BACKUP_PASSPHRASE ;;
  *) cp "$SRC" "$WORK" ;;
esac

echo "==> Creating scratch database $SCRATCH_DB"
psql_in -d postgres -c "CREATE DATABASE \"$SCRATCH_DB\"" >/dev/null

echo "==> Restoring"
MSYS_NO_PATHCONV=1 docker exec -i "$PG_CONTAINER" pg_restore -U "$DB_USER" -d "$SCRATCH_DB" --no-owner --exit-on-error < "$WORK"

echo "==> Comparing row counts (live vs restored)"
printf '%-24s %12s %12s  %s\n' table live restored result
status=0
for t in $TABLES; do
  live="$(psql_in -d "$LIVE_DB" -c "SELECT count(*) FROM \"$t\"" 2>/dev/null || echo '?')"
  rest="$(psql_in -d "$SCRATCH_DB" -c "SELECT count(*) FROM \"$t\"" 2>/dev/null || echo '?')"
  if [ "$rest" = "?" ]; then verdict="MISSING"; status=1
  elif [ "$live" = "?" ] || [ "$rest" -le "$live" ]; then verdict="ok"
  else verdict="ok (backup has MORE rows than live)"; fi
  printf '%-24s %12s %12s  %s\n' "$t" "$live" "$rest" "$verdict"
done

echo "==> Migration history in the restored copy"
psql_in -d "$SCRATCH_DB" -c "SELECT count(*) || ' migrations, latest: ' || max(migration_name) FROM _prisma_migrations"

if [ "$status" -eq 0 ]; then echo "RESTORE CHECK PASSED: the backup restores and contains the key tables."; else echo "RESTORE CHECK FAILED"; fi
exit "$status"
