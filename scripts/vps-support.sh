#!/usr/bin/env bash
# Collect a support bundle for troubleshooting: versions, settings without
# secrets, service state, the operator checks, disk and memory, and the last
# 500 log lines of each service, with credentials, tokens and keys redacted.
# Logs can still hold email and IP addresses: read the bundle before sharing it.
set -euo pipefail
set +x
source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=scripts/vps-lib.sh
. "$source_dir/scripts/vps-lib.sh"
require_root
load_config_dir
[[ -f "$SWW_CONFIG_DIR/compose.env" ]] || die "No installation configuration in $SWW_CONFIG_DIR."
SWW_REPO_DIR=$source_dir
umask 077
name="sww-support-$(date -u +%Y%m%dT%H%M%SZ)"
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
mkdir "$work/$name" "$work/$name/logs"
out="$work/$name"

redact() {
  sed -E \
    -e 's#(Bearer )[A-Za-z0-9._~+/=-]+#\1REDACTED#g' \
    -e 's#(://)[^/@[:space:]]+@#\1REDACTED@#g' \
    -e 's#((password|passwd|secret|token|key|authorization|cookie)[^=:[:space:]]*[=:][[:space:]]*)[^[:space:],"&]+#\1REDACTED#Ig' \
    -e 's#((password|passwd|secret|token|key|authorization|cookie)[^"]*"[[:space:]]*:[[:space:]]*")[^"]*#\1REDACTED#Ig' \
    -e 's#(/(invite|reset-password|ics)/|/api/hb/)[A-Za-z0-9_-]+#\1REDACTED#g' \
    -e 's#([?&]ticket=)[A-Za-z0-9_-]+#\1REDACTED#g' \
    -e 's#AGE-SECRET-KEY-[A-Z0-9]+#REDACTED#g' \
    -e 's#[A-Za-z0-9+/]{43}=|[a-f0-9]{64,}#REDACTED#g'
}
section() { printf '\n== %s\n' "$1"; }

say 'Collecting the support bundle.'
{
  section 'Installer'; cat "$(install_conf)" 2>/dev/null || echo 'not installer-managed'
  section 'Release'; readlink -f "$SWW_DIR/current" 2>/dev/null || true
  section 'compose.env (no secrets)'; cat "$SWW_CONFIG_DIR/compose.env"
  section 'Backup settings'
  sed -n -e 's/^\(BACKUP_[A-Z_]*\)=.*/\1 is set/p' -e 's/^\(OFFSITE_BUCKET\|OFFSITE_ENDPOINT\|OFFSITE_KEEP_DAYS\)=\(.*\)/\1=\2/p' "$(backup_env)" 2>/dev/null || true
  section 'Backup status'; cat "$(status_dir)/backup.json" 2>/dev/null || echo 'none'
  section 'Timers'; systemctl list-timers 'sww-*' --all --no-pager 2>/dev/null || true
  section 'System'; cat /etc/os-release; uname -a; uptime
  section 'Memory'; free -m
  section 'Disk'; df -h / /var/lib/docker "$SWW_CONFIG_DIR" 2>/dev/null || df -h
  section 'Docker'; docker version 2>&1; docker compose version 2>&1
  section 'Services'; compose ps 2>&1
  section 'Checks'; compose run --rm --no-deps ops node docker/vps/check.mjs 2>&1 || true
} 2>&1 | redact > "$out/report.txt"
for service in app frontend proxy worker beat migrator postgres redis storage storage-init; do
  compose logs --no-color --tail 500 "$service" 2>&1 | redact > "$out/logs/$service.log" || true
  [[ -s "$out/logs/$service.log" ]] || rm -f "$out/logs/$service.log"
done
dest=$SWW_DIR/support
[[ -d "$SWW_DIR" ]] || dest=/root
mkdir -p "$dest"
tar -czf "$dest/$name.tar.gz" -C "$work" "$name"
say "Support bundle: $dest/$name.tar.gz"
say 'Credentials, tokens and keys are redacted, but logs can hold email and IP addresses. Read it before sharing.'
