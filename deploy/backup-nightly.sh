#!/usr/bin/env bash
# Nightly backup for the production server. Run as root from cron (see docs/disaster-recovery.md, section 3):
#
#   15 2 * * *  /home/ubuntu/alnajoum-erp/deploy/backup-nightly.sh >> /var/log/alnajoum-backup.log 2>&1
#
# What it does, in order:
#   1. database dump (verified readable, SHA-256, AES-256 encrypted) and the uploaded-documents archive (also encrypted), via deploy/backup.sh
#   2. an encrypted copy of .env.prod, because DATA_ENCRYPTION_KEYS lives there and the database is unreadable without it
#   3. makes the files readable by the `ubuntu` user (every file is encrypted) so they can
#      be copied off the server with scp, and prunes copies older than KEEP_DAYS
# What it does NOT do: leave the machine by itself. Copy /var/backups/alnajoum off the server (see the guide) or set
# BACKUP_REMOTE to an rclone remote. A backup on the same disk is not protection against losing the disk.
#
# The passphrase is read from BACKUP_PASS_FILE (default /root/.backup-pass, mode 600). Keep a copy of it somewhere that is
# NOT this server: without it the encrypted backups cannot be opened.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS_FILE="${BACKUP_PASS_FILE:-/root/.backup-pass}"
[ -r "$PASS_FILE" ] || { echo "!! $PASS_FILE is missing: no backup was made" >&2; exit 1; }

export BACKUP_PASSPHRASE
BACKUP_PASSPHRASE="$(cat "$PASS_FILE")"
export OUT_DIR="${OUT_DIR:-/var/backups/alnajoum}"
export KEEP_DAYS="${KEEP_DAYS:-14}"
export UPLOADS_VOLUME="${UPLOADS_VOLUME:-alnajoum-erp_uploads_data}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

echo "=== $(date -u +%FT%TZ) nightly backup starting"
cd "$APP_DIR"
bash deploy/backup.sh

# The documents archive holds passports and receipts: encrypt it too, then drop the plain copy.
umask 077
for f in "$OUT_DIR"/uploads-*.tar.gz; do
  [ -e "$f" ] || continue
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$f" -out "$f.enc" -pass env:BACKUP_PASSPHRASE
  ( cd "$OUT_DIR" && sha256sum "$(basename "$f").enc" > "$(basename "$f").enc.sha256" )
  rm -f "$f" "$f.sha256"
done

if [ -f "$APP_DIR/.env.prod" ]; then
  umask 077
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$APP_DIR/.env.prod" -out "$OUT_DIR/env-$STAMP.enc" -pass env:BACKUP_PASSPHRASE
  ( cd "$OUT_DIR" && sha256sum "env-$STAMP.enc" > "env-$STAMP.enc.sha256" )
  find "$OUT_DIR" -maxdepth 1 -type f -name 'env-*' -mtime +"$KEEP_DAYS" -delete
fi

if id ubuntu >/dev/null 2>&1; then
  chown -R ubuntu:ubuntu "$OUT_DIR"
fi
echo "=== $(date -u +%FT%TZ) nightly backup finished: $(ls "$OUT_DIR" | grep -c -E '^(db|uploads|env)-.*\.enc$') files kept, $(du -sh "$OUT_DIR" | cut -f1) used"
