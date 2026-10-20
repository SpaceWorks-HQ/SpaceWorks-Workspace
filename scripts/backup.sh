#!/usr/bin/env bash
# Database, current object bytes and continuity keys in one offline bundle.
set -euo pipefail
# shellcheck source=scripts/release-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/release-lib.sh"
[[ "$(repository_env_value SWW_HOST_ROLE)" != frontend ]] || die 'Run backups on the backend host.'
stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
work="$ROOT/backups/.backup-$stamp"
archive="$ROOT/backups/spaceworks-workspace-$stamp.tar.gz"
mkdir -m 700 "$work"
cleanup_backup() { rm -rf -- "$work"; release_update_lock; }
trap cleanup_backup EXIT
# Stop every writer for a database/object-consistent snapshot. On failure restore service.
"${COMPOSE[@]}" stop "${APP_SERVICES[@]}" >/dev/null
restart_writers() { "${COMPOSE[@]}" up -d --no-deps "${APP_SERVICES[@]}" >/dev/null; }
backup_failed() { local code=$?; restart_writers || true; cleanup_backup; exit "$code"; }
trap backup_failed EXIT
"${COMPOSE[@]}" run --rm --no-deps -T --user "$(id -u):$(id -g)" \
  -v "$work:/backup" ops ops node /app/scripts/release-database.mjs backup /backup/database.dump
if [[ "$(repository_env_value SWW_STORAGE)" == bundled ]]; then
  "${COMPOSE[@]}" run --rm --no-deps -T storage-backup backup "${stamp%-*}" >/dev/null
  cp -a "$ROOT/backups/storage/mirror" "$work/objects"
else
  "${COMPOSE[@]}" run --rm --no-deps -T --user "$(id -u):$(id -g)" \
    -v "$work:/backup" ops ops node /app/scripts/release-storage.mjs backup /backup/objects
fi
cp -a "$ROOT/config" "$work/config"
cp -p "$ROOT/.env" "$work/deployment.env"
cp -p "$ROOT/.spaceworks-workspace-version" "$work/version"
# Manifest hashes every regular file; restore verifies all before touching writers.
python3 "$ROOT/scripts/backup-manifest.py" create "$work"
tar -czf "$archive.partial" -C "$work" .
chmod 600 "$archive.partial"
mv "$archive.partial" "$archive"
restart_writers
trap cleanup_backup EXIT
keep="${SWW_BACKUP_KEEP_DAYS:-$(repository_env_value SWW_BACKUP_KEEP_DAYS)}"
[[ "$keep" =~ ^[0-9]+$ && "$keep" -ge 1 ]] || die 'Backup retention must be at least one day.'
find "$ROOT/backups" -maxdepth 1 -type f -name 'spaceworks-workspace-*.tar.gz' -mtime +"$keep" -delete
say "Backup complete: $archive. It contains secrets; encrypt it before copying off-server."
