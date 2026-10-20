#!/usr/bin/env bash
# Sourced by host entry points. The directory owner also owns setup and cron.
require_install_owner() {
  local entrypoint="$1"; shift
  local owner current name key
  local forwarded=()
  [[ "$(uname -s)" == Linux ]] || return 0
  owner="$(stat -c %u "$ROOT")"
  current="$(id -u)"
  [[ "$owner" != "$current" ]] || return 0
  if [[ "$owner" == 0 ]]; then
    command -v sudo >/dev/null 2>&1 || {
      printf 'ERROR: %s is root-owned. Run sudo bash %q' "$ROOT" "$entrypoint" >&2
      printf ' %q' "$@" >&2; printf '\n' >&2
      exit 1
    }
    # Preserve only the host configuration knobs, never the ambient DB pointer.
    for key in SWW_INSTALL_DIR SWW_STATIC_ENV_FILE SWW_REPOSITORY SWW_IMAGE_TAG \
      SWW_BACKEND_IMAGE SWW_FRONTEND_IMAGE SWW_ALLINONE_IMAGE SWW_RUNNER_DIR SWW_SKIP_PULL; do
      if [[ -n "${!key:-}" ]]; then forwarded+=("$key=${!key}"); fi
    done
    printf 'Root-owned install: continuing as root using sudo.\n'
    exec sudo --preserve-env=SWW_GITHUB_TOKEN env ${forwarded[@]+"${forwarded[@]}"} bash "$entrypoint" "$@"
  fi
  name="$(stat -c %U "$ROOT")"
  printf 'ERROR: %s belongs to %s (UID %s). Sign in as that user and run bash %q' \
    "$ROOT" "$name" "$owner" "$entrypoint" >&2
  printf ' %q' "$@" >&2; printf '\n' >&2
  exit 1
}
