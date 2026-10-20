#!/usr/bin/env bash
# Opt-in daily backup, as the installation owner, serialized with update/restore.
set -euo pipefail
ROOT="${SWW_INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source "$ROOT/scripts/install-owner.sh"
require_install_owner "$ROOT/scripts/setup-host-orchestration.sh" "$@"
[[ "$ROOT" != *[\'\"\$\`%]* && "$ROOT" != *$'\n'* && "$ROOT" != *' '* ]] || { echo 'Timer paths cannot contain spaces or shell metacharacters.' >&2; exit 64; }
source "$ROOT/scripts/spaceworks-workspace-repository.sh"
configure_release_repository
source "$ROOT/scripts/python-runtime.sh"
if [[ "$(uname -s)" == Linux && -d /run/systemd/system ]]; then
  privileged=(); [[ "$(id -u)" == 0 ]] || privileged=(sudo)
  user="$(id -un)"; temporary="$(mktemp -d)"
  trap 'rm -rf -- "$temporary"' EXIT
  cat > "$temporary/spaceworks-workspace-backup.service" <<EOF
[Unit]
Description=Space Works Workspace private backup
After=docker.service
[Service]
Type=oneshot
User=$user
WorkingDirectory=$ROOT
ExecStart=/bin/bash $ROOT/scripts/backup.sh
UMask=0077
EOF
  cat > "$temporary/spaceworks-workspace-backup.timer" <<'EOF'
[Unit]
Description=Daily Space Works Workspace backup
[Timer]
OnCalendar=*-*-* 03:15:00
RandomizedDelaySec=20m
Persistent=true
[Install]
WantedBy=timers.target
EOF
  ${privileged[@]+"${privileged[@]}"} install -m 644 "$temporary/spaceworks-workspace-backup.service" "$temporary/spaceworks-workspace-backup.timer" /etc/systemd/system/
  ${privileged[@]+"${privileged[@]}"} systemctl daemon-reload
  ${privileged[@]+"${privileged[@]}"} systemctl enable --now spaceworks-workspace-backup.timer
elif command -v crontab >/dev/null 2>&1; then
  { crontab -l 2>/dev/null | sed '\|# Space Works Workspace backup$|d' || true; printf '15 3 * * * /bin/bash %s/scripts/backup.sh >> %s/backups/schedule.log 2>&1 # Space Works Workspace backup\n' "$ROOT" "$ROOT"; } | crontab -
else
  echo 'No systemd/cron found. Schedule bash scripts/backup.sh in your host scheduler.'
fi
