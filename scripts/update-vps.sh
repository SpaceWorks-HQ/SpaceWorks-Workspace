#!/usr/bin/env bash
# Upgrade an existing Space Works Workspace VPS installation to this release.
# Keeps configuration, secrets and volumes. Normally run by `install.sh --update`.
#
#   backup → build the new release → preflight → migrate → swap → verify
#   on failure: restore the previous release settings and restart its images
#
# Environment: SWW_CONFIG_DIR, SWW_PREVIOUS_RELEASE (source directory of the
# running release; install.sh sets it), SWW_UPDATE_SKIP_STORAGE_BACKUP=1,
# SWW_NONINTERACTIVE=1.
set -euo pipefail
set +x
repo_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_dir"
# shellcheck source=scripts/vps-lib.sh
. "$repo_dir/scripts/vps-lib.sh"
[[ "$noninteractive" = 1 || -t 0 ]] || die 'Run the updater in an interactive terminal, or set SWW_NONINTERACTIVE=1.'
ask SWW_CONFIG_DIR 'Existing configuration directory' "$SWW_DEFAULT_CONFIG_DIR"
require_config_dir

revision=$(release_revision)
version="vps-${revision:0:12}"
previous_version=$(setting SWW_VERSION)
previous_release=${SWW_PREVIOUS_RELEASE:-$repo_dir}
[[ -x "$previous_release/scripts/vps-compose.sh" ]] || previous_release=$repo_dir
if [[ "$version" = "$previous_version" ]]; then
  # Rebuilding under the same tag would overwrite the images rollback needs.
  version="$version-r$(date -u +%Y%m%d%H%M%S)"
fi

printf 'Upgrade %s -> %s (commit %s)\nConfiguration: %s\n' "$previous_version" "$version" "$revision" "$SWW_CONFIG_DIR"
echo 'Review the release notes and new migrations first. A backup is taken before anything changes.'
echo 'Rollback restores the previous application; it does not undo database migrations.'
confirm 'Proceed with the upgrade?'

# 1. Backup
if [[ "${SWW_UPDATE_SKIP_STORAGE_BACKUP:-0}" = 1 ]]; then
  bash "$repo_dir/scripts/vps-backup.sh" --purpose pre-upgrade --skip-storage
else
  bash "$repo_dir/scripts/vps-backup.sh" --purpose pre-upgrade
fi
latest_dump=$(find "$SWW_CONFIG_DIR/backups/database" -maxdepth 1 -name 'sww-*-pre-upgrade.dump' -type f | sort | tail -n 1)

# 2. Point the settings at the new release (only the version label changes).
stamp=$(date -u +%Y%m%dT%H%M%SZ)
saved="$SWW_CONFIG_DIR/backups/compose-$stamp.env"
cp "$SWW_CONFIG_DIR/compose.env" "$saved"
sed "s/^SWW_VERSION=.*/SWW_VERSION='$version'/" "$saved" > "$SWW_CONFIG_DIR/compose.env.new"
mv "$SWW_CONFIG_DIR/compose.env.new" "$SWW_CONFIG_DIR/compose.env"

rollback() {
  echo "Upgrade failed. Restoring release $previous_version..." >&2
  cp "$saved" "$SWW_CONFIG_DIR/compose.env"
  if "$previous_release/scripts/vps-compose.sh" up -d --wait --wait-timeout 300; then
    echo "Previous release $previous_version is running again." >&2
  else
    echo "The previous release did not become healthy. Inspect: scripts/vps-compose.sh ps / logs." >&2
  fi
  echo "If a migration was applied and the previous release misbehaves, restore the pre-upgrade dump:" >&2
  echo "  scripts/vps-restore.sh --database $latest_dump" >&2
}

# 3-5. Build, preflight, migrate, swap and verify; any failure rolls back.
set +e
(
  set -e
  compose config --quiet
  compose build ops migrator app
  compose run --rm --no-deps ops node docker/vps/check.mjs preflight
  compose run --rm migrator
  compose up -d --wait --wait-timeout 300 --remove-orphans
  compose run --rm --no-deps ops node docker/vps/check.mjs
)
status=$?
set -e
if [[ $status -ne 0 ]]; then
  rollback
  exit 1
fi

printf '\nUpgraded to %s. Previous settings: %s\n' "$version" "$saved"
echo "Images of $previous_version are kept for rollback; remove old ones later with: docker image ls 'sww-*'"
echo 'Verify sign-in, email delivery, uploads and live chat updates.'
