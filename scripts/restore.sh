#!/usr/bin/env bash
# Offline recovery: verifies first, takes a safety backup, keeps writers stopped on failure.
set -euo pipefail
archive="${1:-}"
[[ $# == 2 && "$2" == --confirm-replace && -f "$archive" ]] || {
  echo 'Usage: scripts/restore.sh archive.tar.gz --confirm-replace' >&2; exit 64;
}
# shellcheck source=scripts/release-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/release-lib.sh"
[[ "$(repository_env_value SWW_HOST_ROLE)" != frontend ]] || die 'Restore on the backend host.'
work="$(mktemp -d "$ROOT/backups/.restore.XXXXXX")"
trap 'rm -rf -- "$work"; release_update_lock' EXIT
python3 "$ROOT/scripts/backup-manifest.py" extract "$archive" "$work"
archive_storage="$(sed -n 's/^SWW_STORAGE=//p' "$work/deployment.env" | tr -d "\047\042\r")"
[[ "$archive_storage" == "$(repository_env_value SWW_STORAGE)" ]] || die 'Archive storage topology differs from this host. Plan a storage migration first.'
[[ "$(tr -d '[:space:]' < "$work/version")" == "$(tr -d '[:space:]' < "$ROOT/.spaceworks-workspace-version")" ]] || die 'Restore requires the archive application version. Deploy that version before importing.' 
# Mandatory current-state snapshot. A failure aborts before changing data.
SWW_OPERATION_PARENT_PID="$$" bash "$ROOT/scripts/backup.sh"
"${COMPOSE[@]}" stop "${APP_SERVICES[@]}"
say 'Writers stopped. Restoring database and current object bytes.'
# Always restore with the target deployment's maintenance credentials.
"${COMPOSE[@]}" run --rm --no-deps -T --user "$(id -u):$(id -g)" \
  -v "$work:/restore:ro" ops ops node /app/scripts/release-database.mjs restore /restore/database.dump
if [[ "$(repository_env_value SWW_STORAGE)" == bundled ]]; then
  relative="${work#"$ROOT/backups/"}"
  "${COMPOSE[@]}" run --rm --no-deps -T storage-backup restore "$relative/objects"
else
  "${COMPOSE[@]}" run --rm --no-deps -T --user "$(id -u):$(id -g)" \
    -v "$work:/restore:ro" ops ops node /app/scripts/release-storage.mjs restore /restore/objects
fi
# Restore only continuity keys; target endpoints and credentials stay authoritative.
python3 "$ROOT/scripts/restore-keys.py" "$work/config/app.env" "$ROOT/config/app.env"
"${COMPOSE[@]}" up -d --no-deps --force-recreate "${APP_SERVICES[@]}"
if ! wait_for_backend; then
  "${COMPOSE[@]}" stop "${APP_SERVICES[@]}"
  die 'Restored app is not ready. Writers and edge remain offline; inspect logs.'
fi
say 'Restore complete. Test sign-in, encrypted settings and private downloads before reopening access.'
