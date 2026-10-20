#!/usr/bin/env bash
# Remove Space Works Workspace from this server, from the installer menu: the
# containers, timers, auto-deploy runner, images and the install directory.
# The data (database, uploads), the configuration with every secret and the
# backups stay unless DELETE DATA is typed. Docker, swap and any hardening stay.
# shellcheck disable=SC2154 # ask assigns answers by name
set -euo pipefail
set +x
source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=scripts/vps-lib.sh
. "$source_dir/scripts/vps-lib.sh"
require_root
require_tty
load_config_dir
[[ -f "$SWW_CONFIG_DIR/compose.env" ]] || die "No installation configuration in $SWW_CONFIG_DIR."
SWW_REPO_DIR=$source_dir
cat >/dev/tty <<EOF

Uninstall Space Works Workspace ($(conf_get "$SWW_CONFIG_DIR/compose.env" PUBLIC_ORIGIN))
  Removed: the containers, systemd timers, auto-deploy runner, images and $SWW_DIR
  Kept unless you choose otherwise next: the database and uploads (Docker volumes),
  and $SWW_CONFIG_DIR with every secret and the backups
EOF
ask answer 'Type UNINSTALL to continue' '' is_nonempty
[[ "$answer" = UNINSTALL ]] || { say 'Cancelled. Nothing was changed.'; exit 2; }
cat >/dev/tty <<EOF

Also delete all data? This permanently erases the database, the uploads in the
bundled storage, the configuration and every backup in $SWW_CONFIG_DIR/backups.
Copy any backup you need off this server first.
EOF
ask answer 'Type DELETE DATA to erase it, or press Enter to keep it' keep is_nonempty
delete_data=0
[[ "$answer" != 'DELETE DATA' ]] || delete_data=1
take_lock

if [[ -f "$SWW_REPO_DIR/scripts/install-runner.sh" ]] && [[ -d /opt/spaceworks-workspace-runner || -f /etc/sudoers.d/spaceworks-workspace-deploy ]]; then
  bash "$SWW_REPO_DIR/scripts/install-runner.sh" --remove || warn 'Remove the runner from GitHub (Settings -> Actions -> Runners) by hand.'
fi
remove_timer backup
remove_timer certificates
images=$(compose config --images 2>/dev/null | grep -E '(spaceworks-workspace|sww)-(backend|frontend)' | sort -u || true)
if [[ $delete_data = 1 ]]; then
  compose down --volumes --remove-orphans
else
  compose down --remove-orphans
fi
# shellcheck disable=SC2086 # one image name per word
[[ -z "$images" ]] || docker image rm $images >/dev/null 2>&1 || true
if [[ $delete_data = 1 ]]; then
  rm -rf -- "$SWW_CONFIG_DIR"
fi
if [[ "$SWW_DIR" = /?* && "$SWW_DIR" != / ]]; then rm -rf -- "$SWW_DIR"; fi
say 'Space Works Workspace is uninstalled. Docker, swap and any server hardening were left in place.'
if [[ $delete_data = 0 ]]; then
  say "The data volumes (sww_*) and $SWW_CONFIG_DIR (secrets and backups) were kept."
  say 'To reinstall with this data, follow "Restore on a new server" in docs/DEPLOYMENT_VPS.md.'
fi
