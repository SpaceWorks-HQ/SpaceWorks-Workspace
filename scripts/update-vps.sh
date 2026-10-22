#!/usr/bin/env bash
# Update an installation to this source release, keeping configuration, secrets
# and volumes. The curl installer runs it as root from the staged new release.
# It backs up the database and configuration first, downloads the release's
# images (or builds them for a source install) and migrates. If the new release does not come up healthy it returns to the
# previous release's images; database migrations are never reversed.
#   --yes  skip the confirmation (automation)
set -euo pipefail
set +x
source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=scripts/vps-lib.sh
. "$source_dir/scripts/vps-lib.sh"
assume_yes=0
case "${1:-}" in
  '') ;;
  --yes) assume_yes=1 ;;
  *) die 'Usage: update-vps.sh [--yes]' ;;
esac
require_root
load_config_dir
compose_env="$SWW_CONFIG_DIR/compose.env"
[[ -f "$compose_env" ]] || die "No installation configuration in $SWW_CONFIG_DIR."
revision=$(release_revision "$source_dir")
version=$(source_version "$source_dir" "$revision")
repository=${SWW_REPOSITORY:-$(conf_get "$(install_conf)" SWW_REPOSITORY)}
repository=${repository:-$SWW_DEFAULT_REPOSITORY}
is_repository "$repository" || die 'SWW_REPOSITORY must be a GitHub owner/name.'
previous_version=$(conf_get "$compose_env" SWW_VERSION)
previous_dir=$(readlink -f "$SWW_DIR/current" 2>/dev/null || true)
# An installation made by install.sh is always updated the managed way, from
# wherever this new release was unpacked.
managed=0
[[ ! -f "$(install_conf)" ]] || managed=1
[[ ${SWW_STAGED:-0} != 1 ]] || managed=1
[[ "$previous_version" != "$version" ]] || { say "Already running $version; nothing to update."; exit 0; }

if [[ $assume_yes = 0 ]]; then
  require_tty
  {
    printf '\nUpdate Space Works Workspace\n'
    printf '  From:           %s\n' "${previous_version:-unknown}"
    printf '  To:             %s (commit %s)\n' "$version" "$revision"
    printf '  Configuration:  %s (kept as it is)\n' "$SWW_CONFIG_DIR"
    if is_published_version "$version"; then fetch=download; else fetch=build; fi
    printf 'Steps: back up the database and configuration to %s/backups, %s the new\n' "$SWW_CONFIG_DIR" "$fetch"
    printf 'images while the site keeps running, apply database migrations, restart and check.\n'
    printf 'If the new release is unhealthy the previous images are restored automatically;\n'
    printf 'migrations that already ran are not reversed. The site restarts briefly.\n\n'
  } >/dev/tty
  confirm 'Proceed with the update?' Y || { say 'Cancelled. Nothing was changed.'; exit 2; }
fi

[[ $managed = 0 ]] || take_lock
# Reusing a release directory rewrites its .release-version; put it back if the
# update fails, so the directory keeps describing the version that runs.
marker="$SWW_DIR/releases/$revision/.release-version" saved_marker=untouched
if [[ $managed = 1 && -d "$SWW_DIR/releases/$revision" ]]; then
  saved_marker=$(cat "$marker" 2>/dev/null || echo none)
fi
phase=preparing
restore_previous() {
  local status=$?
  [[ $status != 0 ]] || return 0
  set +e
  case "$saved_marker" in
    untouched) ;;
    none) rm -f "$marker" ;;
    *) printf '%s\n' "$saved_marker" > "$marker" ;;
  esac
  [[ $phase = deploying ]] || exit "$status"
  warn "The update failed; returning to ${previous_version:-the previous release}."
  mv -f "$compose_env.previous" "$compose_env"
  if [[ -n "$previous_dir" && -f "$previous_dir/scripts/vps-compose.sh" ]]; then
    sh "$previous_dir/scripts/vps-compose.sh" up -d --wait --wait-timeout 300 --remove-orphans \
      || warn "The previous release did not start cleanly. Inspect it with: SWW_CONFIG_DIR=$SWW_CONFIG_DIR $previous_dir/scripts/vps-compose.sh ps"
  else
    warn 'Check out the previous source and run scripts/vps-compose.sh up -d from it.'
  fi
  warn "Migrations that already ran are not reversed. The pre-update backup is in $SWW_CONFIG_DIR/backups."
  exit "$status"
}
trap restore_previous EXIT
SWW_REPO_DIR=$source_dir
[[ $managed = 0 ]] || SWW_REPO_DIR=$(promote_release "$source_dir" "$revision")
cd "$SWW_REPO_DIR"
say 'Backing up the database and configuration.'
bash "$SWW_REPO_DIR/scripts/vps-backup.sh" --no-objects
phase=deploying
cp -p "$compose_env" "$compose_env.previous"
# Only the release label and image names change; hostnames, secrets and volumes stay.
conf_set "$compose_env" SWW_VERSION "$version"
set_image_settings "$compose_env" "$version" "$repository"
say 'Fetching the new images. The site keeps running meanwhile.'
# The app can read the non-secret backup status from here.
install -d -m 0755 "$(status_dir)"
compose config --quiet
fetch_images "$version" "$(conf_get "$compose_env" SWW_LAYOUT)"
compose run --rm --no-deps ops node docker/vps/check.mjs preflight
# Stop consumers before schema changes; Compose drains active work using its grace period.
compose stop worker beat
compose run --rm migrator
compose run --rm --no-deps ops node scripts/verify-production-schema.mjs
compose up -d --wait --wait-timeout 300 --remove-orphans
compose run --rm --no-deps ops node docker/vps/check.mjs
phase=finished
rm -f "$compose_env.previous"

if [[ $managed = 1 ]]; then
  activate_release "$SWW_REPO_DIR"
  conf_set "$(install_conf)" SWW_RELEASE "$revision"
  # Ensure the weekly certificate check is installed.
  if has_systemd && ! timer_enabled certificates; then
    install_certificate_timer
    say 'Added a weekly check that renews the internal certificates before they expire.'
  fi
  # Keep the three newest releases (and their images) for manual rollback.
  count=0
  while IFS= read -r dir; do
    count=$((count + 1))
    name=$(basename "$dir")
    [[ $count -gt 3 && "$name" =~ ^[a-f0-9]{40}$ && "$dir" != "$SWW_REPO_DIR" ]] || continue
    rm -rf -- "$dir"
    # A commit may have run both as a source build and as a release: remove both.
    docker image ls --format '{{.Repository}}:{{.Tag}}' \
      | grep -E "(/spaceworks-workspace[a-z-]*|^sww-[a-z]+):(vps-|[0-9]+\.[0-9]+\.[0-9]+-[a-z0-9-]+\.[0-9]+\.)${name:0:12}\$" \
      | xargs -r docker image rm >/dev/null 2>&1 || true
  done < <(find "$SWW_DIR/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
fi
say "Updated to $version. Verify sign-in, email, uploads and realtime updates."
# A legacy configuration without a layout may still describe a Netlify frontend.
layout=$(conf_get "$compose_env" SWW_LAYOUT)
if [[ $layout = netlify || ( -z $layout && -f "$SWW_CONFIG_DIR/frontend.env" ) ]]; then
  say "Deploy commit $revision to the Netlify website too."
fi
