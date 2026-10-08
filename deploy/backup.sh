#!/usr/bin/env bash
# Backup the database (and, optionally, the uploaded documents) - Phase 22 S-23.
#
#   ./deploy/backup.sh                       # dump -> ./backups/db-<UTC timestamp>.dump(.enc) + .sha256
#   BACKUP_PASSPHRASE=... ./deploy/backup.sh # also encrypts the dump (AES-256, PBKDF2) - recommended off-box
#   UPLOADS_VOLUME=alnajoum-erp_uploads_data ./deploy/backup.sh   # also archives the documents volume
#   BACKUP_REMOTE=remote:bucket/path ./deploy/backup.sh           # copies the result off the machine with rclone
#
# What it guarantees: the dump is verified readable (pg_restore --list) before it is kept, a SHA-256 is
# written next to it, files are created 0600, and backups older than KEEP_DAYS are pruned. What it does NOT
# do: run itself (schedule it - see docs/disaster-recovery.md) or copy off the machine unless BACKUP_REMOTE is
# set. A backup on the same disk as the database is not a backup of a disk failure.
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-alnajoum-postgres}"
DB_USER="${POSTGRES_USER:-alnajoum}"
DB_NAME="${POSTGRES_DB:-alnajoum_erp}"
OUT_DIR="${OUT_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

umask 077
mkdir -p "$OUT_DIR"
DUMP="$OUT_DIR/db-$STAMP.dump"

echo "==> Dumping $DB_NAME from container $PG_CONTAINER"
MSYS_NO_PATHCONV=1 docker exec "$PG_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$DUMP"

echo "==> Verifying the dump is readable"
if ! MSYS_NO_PATHCONV=1 docker exec -i "$PG_CONTAINER" pg_restore --list < "$DUMP" > /dev/null; then
  echo "!! The dump failed verification and has been deleted." >&2
  rm -f "$DUMP"
  exit 1
fi

FINAL="$DUMP"
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  echo "==> Encrypting"
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$DUMP" -out "$DUMP.enc" -pass env:BACKUP_PASSPHRASE
  rm -f "$DUMP"
  FINAL="$DUMP.enc"
fi
( cd "$OUT_DIR" && sha256sum "$(basename "$FINAL")" > "$(basename "$FINAL").sha256" )

if [ -n "${UPLOADS_VOLUME:-}" ]; then
  echo "==> Archiving uploads volume $UPLOADS_VOLUME"
  MSYS_NO_PATHCONV=1 docker run --rm -v "$UPLOADS_VOLUME":/data:ro alpine tar -C /data -cz . > "$OUT_DIR/uploads-$STAMP.tar.gz"
  ( cd "$OUT_DIR" && sha256sum "uploads-$STAMP.tar.gz" > "uploads-$STAMP.tar.gz.sha256" )
fi

if [ -n "${BACKUP_REMOTE:-}" ]; then
  echo "==> Copying off-machine to $BACKUP_REMOTE"
  rclone copy "$OUT_DIR" "$BACKUP_REMOTE" --include "*$STAMP*"
fi

echo "==> Pruning backups older than $KEEP_DAYS days"
find "$OUT_DIR" -maxdepth 1 -type f \( -name 'db-*' -o -name 'uploads-*' \) -mtime +"$KEEP_DAYS" -print -delete

echo "==> Done: $FINAL ($(du -h "$FINAL" | cut -f1))"
