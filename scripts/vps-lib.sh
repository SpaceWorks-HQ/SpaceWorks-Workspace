#!/usr/bin/env bash
# Shared helpers for the VPS scripts (sourced, never run directly). Callers
# set `repo_dir` to the release directory before sourcing.
# shellcheck disable=SC2154
#
# Non-interactive use: export SWW_NONINTERACTIVE=1 and provide every answer as
# an environment variable (see docs/DEPLOYMENT_VPS.md, "Unattended install").

# shellcheck disable=SC2034
SWW_DEFAULT_CONFIG_DIR=/etc/spaceworks-workspace
noninteractive=${SWW_NONINTERACTIVE:-0}

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

# ask VAR "Prompt" [default] [secret]: keeps an existing value of VAR, asks
# otherwise (hidden input when secret is set), falls back to the default.
ask() {
  local var=$1 prompt=$2 default=${3-} secret=${4-} value
  value=${!var-}
  if [[ -z "$value" && "$noninteractive" != 1 ]]; then
    if [[ -n "$secret" ]]; then
      read -r -s -p "$prompt: " value
      printf '\n'
    else
      read -r -p "$prompt${default:+ [$default]}: " value
    fi
  fi
  printf -v "$var" '%s' "${value:-$default}"
}

# yes_no VAR "Question" default(y|n): normalises the answer to y or n.
yes_no() {
  local var=$1 prompt=$2 default=$3 hint
  [[ "$default" = y ]] && hint='Y/n' || hint='y/N'
  ask "$var" "$prompt [$hint]" "$default"
  case "${!var}" in
    y|Y|yes|YES|1|true) printf -v "$var" y ;;
    *) printf -v "$var" n ;;
  esac
}

# confirm "Question": exits with status 2 unless answered yes (automatic when non-interactive).
confirm() {
  local answer
  [[ "$noninteractive" = 1 ]] && return 0
  read -r -p "$1 [y/N]: " answer
  [[ "$answer" = y || "$answer" = Y ]] || exit 2
}

# setting KEY: a value from the saved compose.env (single-quoted assignments).
setting() {
  sed -n "s/^$1='\\(.*\\)'\$/\\1/p" "$SWW_CONFIG_DIR/compose.env" | tail -n 1
}

# release_revision: the commit this source tree came from.
release_revision() {
  if [[ -f "$repo_dir/.release" ]]; then
    cat "$repo_dir/.release"
  elif git -C "$repo_dir" rev-parse HEAD >/dev/null 2>&1; then
    git -C "$repo_dir" rev-parse HEAD
  else
    date -u +%Y%m%d%H%M%S
  fi
}

require_config_dir() {
  [[ "$SWW_CONFIG_DIR" = /* && "$SWW_CONFIG_DIR" != *[[:space:]:]* ]] || die 'Use an absolute configuration path without spaces or colons.'
  [[ -f "$SWW_CONFIG_DIR/compose.env" ]] || die "No configuration at $SWW_CONFIG_DIR. Run scripts/setup-vps.sh for a first installation."
  export SWW_CONFIG_DIR
}

compose() {
  "$repo_dir/scripts/vps-compose.sh" "$@"
}
