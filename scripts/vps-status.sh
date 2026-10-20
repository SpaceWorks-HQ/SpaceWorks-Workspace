#!/usr/bin/env bash
# Show the installation's release, services, disk and newest backup, then run
# the operator checks. Changes nothing.
set -euo pipefail
set +x
source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=scripts/vps-lib.sh
. "$source_dir/scripts/vps-lib.sh"
require_root
load_config_dir
[[ -f "$SWW_CONFIG_DIR/compose.env" ]] || die "No installation configuration in $SWW_CONFIG_DIR."
SWW_REPO_DIR=$source_dir
say "Release: $(conf_get "$SWW_CONFIG_DIR/compose.env" SWW_VERSION) at $(conf_get "$SWW_CONFIG_DIR/compose.env" PUBLIC_ORIGIN)"
say "Free disk: $(free_disk_mb /var/lib/docker) MB"
newest=$(find "$SWW_CONFIG_DIR/backups" -mindepth 1 -maxdepth 1 -type d -name '2*Z' 2>/dev/null | sort | tail -n 1)
say "Newest backup: ${newest:-none yet; run scripts/vps-backup.sh}"
compose ps
compose run --rm --no-deps ops node docker/vps/check.mjs
