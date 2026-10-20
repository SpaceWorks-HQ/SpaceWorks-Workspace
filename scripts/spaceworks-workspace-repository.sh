#!/usr/bin/env bash
# Read a non-secret selector, never execute dotenv as shell code.
repository_env_value() {
  local value file="${SWW_STATIC_ENV_FILE:-$ROOT/.env}"
  [[ -f "$file" ]] || return 0
  value="$(sed -n "s/^$1=//p" "$file" | tail -n 1 | tr -d '\r')"
  if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then value="${value:1:${#value}-2}"; fi
  printf '%s' "$value"
}
configure_release_repository() {
  SWW_REPOSITORY="${SWW_REPOSITORY:-$(repository_env_value SWW_REPOSITORY)}"
  SWW_REPOSITORY="${SWW_REPOSITORY:-SpaceWorks-HQ/SpaceWorks-Workspace}"
  [[ "$SWW_REPOSITORY" =~ ^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || { echo 'Invalid GitHub owner/repo.' >&2; return 64; }
  local owner key value suffix
  owner="$(printf '%s' "${SWW_REPOSITORY%%/*}" | tr '[:upper:]' '[:lower:]')"
  for suffix in BACKEND FRONTEND ALLINONE; do
    key="SWW_${suffix}_IMAGE"; value="${!key:-$(repository_env_value "$key")}"
    export "$key=${value:-ghcr.io/$owner/spaceworks-workspace-$(printf '%s' "$suffix" | tr '[:upper:]' '[:lower:]')}"
  done
  export SWW_REPOSITORY
}
