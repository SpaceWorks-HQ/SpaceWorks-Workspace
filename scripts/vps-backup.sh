#!/usr/bin/env bash
# Backups for the Space Works Workspace VPS stack. Run as the installation
# owner (or root) on the VPS; services keep running.
#
#   scripts/vps-backup.sh                    database + storage + configuration
#   scripts/vps-backup.sh --skip-storage     database + configuration only
#   scripts/vps-backup.sh --purpose pre-upgrade
#   scripts/vps-backup.sh --install-timer [/opt/spaceworks-workspace/current]
#                                            daily systemd timer (root)
#
# Writes to $SWW_CONFIG_DIR/backups (owner-only):
#   database/sww-<stamp>.dump(.sha256)  pg_dump custom format, verified with pg_restore --list
#   storage/storage-<stamp>.tar.gz      Silo bucket archive (incremental mirror in storage/mirror)
#   config/config-<stamp>.tar.gz        every secret and certificate; keep it off-server, encrypted
# Archives older than SWW_BACKUP_KEEP_DAYS (compose.env, default 14) are pruned.
# With $SWW_CONFIG_DIR/backup-remote.env present, database and storage
# archives are also copied off-site (docker/vps/offsite-backup.sh).
set -euo pipefail
set +x
repo_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=scripts/vps-lib.sh
. "$repo_dir/scripts/vps-lib.sh"
SWW_CONFIG_DIR=${SWW_CONFIG_DIR:-$SWW_DEFAULT_CONFIG_DIR}

install_timer() {
  local release=${1:-$repo_dir}
  [[ $(id -u) = 0 ]] || die 'Installing the timer requires root.'
  [[ -d /run/systemd/system ]] || die 'systemd is not running; use the cron line in docs/production-operations.md instead.'
  cat > /etc/systemd/system/spaceworks-workspace-backup.service <<UNIT
[Unit]
Description=Space Works Workspace backup (database, storage, configuration)
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
Environment=SWW_CONFIG_DIR=$SWW_CONFIG_DIR
ExecStart=/usr/bin/env bash $release/scripts/vps-backup.sh --purpose scheduled
Nice=10
IOSchedulingClass=idle
UNIT
  cat > /etc/systemd/system/spaceworks-workspace-backup.timer <<'UNIT'
[Unit]
Description=Daily Space Works Workspace backup

[Timer]
OnCalendar=*-*-* 03:15:00
RandomizedDelaySec=30m
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now spaceworks-workspace-backup.timer
  echo 'Daily backup timer installed: systemctl list-timers spaceworks-workspace-backup.timer'
}

skip_storage=0
purpose=manual
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-storage) skip_storage=1; shift ;;
    --purpose) purpose=${2:?Provide a purpose}; shift 2 ;;
    --install-timer) require_config_dir; install_timer "${2:-}"; exit 0 ;;
    --help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done
[[ "$purpose" =~ ^[a-z0-9-]{1,40}$ ]] || die 'Purpose must be lowercase letters, digits and dashes.'
require_config_dir

backups="$SWW_CONFIG_DIR/backups"
umask 077
mkdir -p "$backups/database" "$backups/storage" "$backups/config"
# One backup at a time (mkdir is atomic and portable).
lock="$backups/.lock"
mkdir "$lock" 2>/dev/null || die "Another backup is running (remove $lock if it is stale)."
cleanup() {
  rm -f "$backups/database/"*.partial
  rmdir "$lock" 2>/dev/null || true
}
trap cleanup EXIT

stamp=$(date -u +%Y%m%dT%H%M%SZ)
dump="$backups/database/sww-$stamp-$purpose.dump"

echo 'Backing up the database...'
compose exec -T postgres pg_dump --username sww --dbname sww --format custom --compress 9 > "$dump.partial"
compose exec -T postgres pg_restore --list < "$dump.partial" > /dev/null
mv "$dump.partial" "$dump"
checksum=sha256sum
command -v sha256sum >/dev/null || checksum='shasum -a 256'
(cd "$backups/database" && $checksum "$(basename "$dump")" > "$(basename "$dump").sha256")
echo "Database: $dump"

if [[ "$skip_storage" = 0 ]]; then
  echo 'Backing up storage...'
  compose run --rm --no-deps storage-backup backup "$stamp"
fi

# The configuration archive excludes backups to avoid recursion. It contains
# every secret: copy it to your password manager or encrypted storage.
tar --exclude=./backups -czf "$backups/config/config-$stamp.tar.gz" -C "$SWW_CONFIG_DIR" .
echo "Configuration: $backups/config/config-$stamp.tar.gz"

keep_days=$(setting SWW_BACKUP_KEEP_DAYS)
keep_days=${SWW_BACKUP_KEEP_DAYS:-${keep_days:-14}}
[[ "$keep_days" =~ ^[0-9]{1,4}$ && "$keep_days" -ge 1 ]] || die 'SWW_BACKUP_KEEP_DAYS must be a positive number of days.'
find "$backups/database" -maxdepth 1 -type f \( -name 'sww-*.dump' -o -name 'sww-*.dump.sha256' \) -mtime +"$keep_days" -delete
find "$backups/storage" -maxdepth 1 -type f -name 'storage-*.tar.gz' -mtime +"$keep_days" -delete
find "$backups/config" -maxdepth 1 -type f -name 'config-*.tar.gz' -mtime +"$keep_days" -delete

if [[ -f "$SWW_CONFIG_DIR/backup-remote.env" ]]; then
  echo 'Copying archives off-site...'
  compose run --rm --no-deps offsite
fi
echo "Backup complete ($stamp). Keep copies off this server and test restores regularly."
