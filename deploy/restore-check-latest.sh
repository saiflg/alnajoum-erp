#!/usr/bin/env bash
# Weekly proof that the newest nightly backup restores (run as root from cron, see /etc/cron.d/alnajoum-backup).
# Restores into a scratch database, compares row counts, drops it. Exits non-zero (and logs it) if the backup is unusable.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${OUT_DIR:-/var/backups/alnajoum}"
export BACKUP_PASSPHRASE
BACKUP_PASSPHRASE="$(cat "${BACKUP_PASS_FILE:-/root/.backup-pass}")"
LATEST="$(ls -t "$OUT_DIR"/db-*.dump.enc 2>/dev/null | head -1)"
[ -n "$LATEST" ] || { echo "!! $(date -u +%FT%TZ) no backup found in $OUT_DIR" >&2; exit 1; }
echo "=== $(date -u +%FT%TZ) restore check of $LATEST"
cd "$APP_DIR" && bash deploy/restore-check.sh "$LATEST"
