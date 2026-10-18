#!/usr/bin/env bash
# Restore the Space Works Workspace VPS stack from scripts/vps-backup.sh archives.
# Destructive: the database is replaced; storage objects with the same key are
# overwritten. A safety backup is taken first.
#
#   scripts/vps-restore.sh --database $SWW_CONFIG_DIR/backups/database/sww-<stamp>-<purpose>.dump
#   scripts/vps-restore.sh --storage  $SWW_CONFIG_DIR/backups/storage/storage-<stamp>.tar.gz
#
# Both options may be given together. You are asked to type the public
# hostname to confirm (SWW_CONFIRM_HOST=<hostname> for unattended restore drills).
set -euo pipefail
set +x
repo_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=scripts/vps-lib.sh
. "$repo_dir/scripts/vps-lib.sh"
SWW_CONFIG_DIR=${SWW_CONFIG_DIR:-$SWW_DEFAULT_CONFIG_DIR}

database_file=
storage_file=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --database) database_file=${2:?Provide a .dump file}; shift 2 ;;
    --storage) storage_file=${2:?Provide a storage-*.tar.gz file}; shift 2 ;;
    --help) sed -n '2,12p' "$0"; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done
[[ -n "$database_file$storage_file" ]] || die 'Choose --database FILE and/or --storage FILE.'
require_config_dir
backups="$SWW_CONFIG_DIR/backups"

if [[ -n "$database_file" ]]; then
  [[ -f "$database_file" && ! -L "$database_file" ]] || die 'Database archive not found.'
  if [[ -f "$database_file.sha256" ]]; then
    expected=$(cut -d ' ' -f 1 < "$database_file.sha256")
    actual=$( (sha256sum "$database_file" 2>/dev/null || shasum -a 256 "$database_file") | cut -d ' ' -f 1)
    [[ "$expected" = "$actual" ]] || die 'Database archive checksum does not match its .sha256 file.'
  fi
  compose exec -T postgres pg_restore --list < "$database_file" > /dev/null || die 'Database archive is not a readable pg_dump archive.'
fi
if [[ -n "$storage_file" ]]; then
  [[ -f "$storage_file" && ! -L "$storage_file" ]] || die 'Storage archive not found.'
  tar -tzf "$storage_file" > /dev/null || die 'Storage archive is not a readable .tar.gz file.'
fi

host=$(setting PUBLIC_HOST)
echo "This replaces live data on $host:"
[[ -z "$database_file" ]] || echo "  database <- $database_file"
[[ -z "$storage_file" ]] || echo "  storage  <- $storage_file"
confirmation=${SWW_CONFIRM_HOST:-}
[[ -n "$confirmation" || "$noninteractive" = 1 ]] || read -r -p "Type the hostname ($host) to continue: " confirmation
[[ "$confirmation" = "$host" ]] || die 'Restore cancelled.'

echo 'Taking a safety backup first...'
if [[ -n "$storage_file" ]]; then
  bash "$repo_dir/scripts/vps-backup.sh" --purpose pre-restore
else
  bash "$repo_dir/scripts/vps-backup.sh" --purpose pre-restore --skip-storage
fi

echo 'Stopping the app, scheduler and proxy...'
compose stop proxy scheduler app

restart() {
  echo 'Starting services...'
  compose up -d --wait --wait-timeout 300
}
trap 'echo "Restore failed. The safety backup is in $backups; services are being restarted." >&2; restart || true' ERR

if [[ -n "$database_file" ]]; then
  echo 'Restoring the database...'
  # --clean drops and recreates objects; --single-transaction makes it all or nothing.
  # Grants for the runtime role are part of the archive.
  compose exec -T postgres pg_restore --username sww --dbname sww --clean --if-exists \
    --single-transaction --exit-on-error < "$database_file"
  # Bring an older archive up to this release's schema.
  compose run --rm migrator
fi

if [[ -n "$storage_file" ]]; then
  echo 'Restoring storage...'
  work="restore-$(date -u +%Y%m%dT%H%M%SZ)"
  umask 077
  mkdir -p "$backups/$work"
  tar -xzf "$storage_file" -C "$backups/$work"
  compose run --rm --no-deps storage-backup restore "$work"
  rm -rf "${backups:?}/$work"
fi

trap - ERR
restart
compose run --rm --no-deps ops node docker/vps/check.mjs
echo 'Restore complete. Sign in and spot-check recent work, files and email.'
