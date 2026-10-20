#!/usr/bin/env bash
# Pinned deployment: verified release, backup, host bundle, migration, health, image rollback.
set -euo pipefail
REQUESTED_VERSION=''; STAGED_BUNDLE=''
while (($#)); do
  case "$1" in
    --version) shift; REQUESTED_VERSION="${1:?Supply a version}" ;;
    --staged-bundle) shift; STAGED_BUNDLE="${1:?Supply a bundle path}" ;;
    --force|--no-module-changes) ;;
    --modules-only) exec bash "$(dirname "${BASH_SOURCE[0]}")/module-selection.sh" ;;
    --help|-h) echo 'Usage: update.sh [--version X.Y.Z-main.RUN.SHA12] [--force]'; exit 0 ;;
    *) echo 'Unknown update option.' >&2; exit 64 ;;
  esac
  shift
done
# shellcheck source=scripts/release-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/release-lib.sh"
source "$ROOT/scripts/update-rollback.sh"
previous_version="$(tr -d '[:space:]' < "$ROOT/.spaceworks-workspace-version")"
version="$REQUESTED_VERSION"
stage=''; deployment_started=0; host_configuration_started=0; update_complete=0
cleanup_update() {
  local code=$?
  trap - EXIT
  set +e
  if [[ "$update_complete" != 1 && ( "$deployment_started" == 1 || "$host_configuration_started" == 1 ) ]]; then rollback_application_images; fi
  [[ -z "$stage" ]] || rm -rf -- "$stage"
  release_update_lock
  exit "$code"
}
trap cleanup_update EXIT
if [[ -z "$version" ]]; then
  version="$(SWW_REPOSITORY="$SWW_REPOSITORY" bash "$ROOT/scripts/release-download.sh" --version-only)"
fi
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-main\.[0-9]+\.[0-9a-f]{12}$ ]] || die 'Use an immutable published main version.'
[[ "$version" != "$previous_version" ]] || { say 'Already at the requested release.'; exit 0; }
if [[ -z "$STAGED_BUNDLE" ]]; then
  stage="$(mktemp -d "${TMPDIR:-/tmp}/.sww-update.XXXXXX")"
  bash "$ROOT/scripts/release-download.sh" "$version" "$stage"
  STAGED_BUNDLE="$stage"
fi
[[ "$(tr -d '[:space:]' < "$STAGED_BUNDLE/.bundle-version")" == "$version" ]] || die 'Bundle version does not match images.'
# Backup current state before replacing any host file or starting migrations.
if [[ "$(repository_env_value SWW_HOST_ROLE)" != frontend ]]; then
  SWW_OPERATION_PARENT_PID="$$" bash "$ROOT/scripts/backup.sh"
fi
export SWW_IMAGE_TAG="$version"
[[ -z "${SWW_GITHUB_TOKEN:-}" ]] || printf '%s' "$SWW_GITHUB_TOKEN" | docker login ghcr.io --username "${SWW_REPOSITORY%%/*}" --password-stdin >/dev/null
for image in "$SWW_BACKEND_IMAGE" "$SWW_FRONTEND_IMAGE" "$SWW_ALLINONE_IMAGE"; do docker pull "$image:$version"; done
source "$ROOT/scripts/install-host-bundle.sh"
host_configuration_started=1
install_staged_host_bundle "$STAGED_BUNDLE"
deployment_started=1
"${COMPOSE[@]}" stop "${APP_SERVICES[@]}"
if [[ "$(repository_env_value SWW_HOST_ROLE)" != frontend ]]; then
  "${COMPOSE[@]}" up --force-recreate --no-deps --exit-code-from migrate migrate
fi
"${COMPOSE[@]}" up -d --remove-orphans --force-recreate
wait_for_backend || die 'New release failed readiness.'
# Both the metadata and marker are pinned only after health succeeds.
python3 "$ROOT/scripts/set-install-value.py" "$ROOT/.env" SWW_IMAGE_TAG "$version"
printf '%s\n' "$version" > "$ROOT/.spaceworks-workspace-version"
update_complete=1
say "Updated to $version. Backup retained in backups/."
