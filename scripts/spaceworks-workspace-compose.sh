#!/usr/bin/env bash
# Saved topology is authoritative for setup, update, backup and restore.
set -euo pipefail
ROOT="${SWW_INSTALL_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
export SWW_INSTALL_DIR="$ROOT"
source "$ROOT/scripts/spaceworks-workspace-repository.sh"
[[ -f "$ROOT/.env" && ! -L "$ROOT/.env" ]] || { echo 'Run setup.sh first.' >&2; exit 64; }
configure_release_repository
for argument in "$@"; do
  case "$argument" in -f*|--file*|--env-file*|--project-directory*) echo 'Use the saved deployment configuration.' >&2; exit 64 ;; esac
done
# Optional compatibility selector; each service choice is otherwise persisted.
case "${1:-}" in bundled|cloud) shift ;; esac
shape="$(repository_env_value SWW_SHAPE)"
role="$(repository_env_value SWW_HOST_ROLE)"
https="$(repository_env_value SWW_HTTPS)"
[[ "$shape" == separate || "$shape" == single ]] || { echo 'Invalid deployment shape.' >&2; exit 64; }
[[ "$role" == backend || "$role" == frontend ]] || { echo 'Invalid host role.' >&2; exit 64; }
[[ "$https" == auto || "$https" == proxy ]] || { echo 'Invalid HTTPS configuration.' >&2; exit 64; }
files=()
if [[ "$role" == frontend ]]; then
  files=(-f "$ROOT/docker/compose.frontend-only.yml")
else
  files=(-f "$ROOT/docker-compose.prod.yml")
  if [[ "$shape" == single ]]; then files+=(-f "$ROOT/docker/compose.single.yml"); fi
  for service in DATABASE REDIS STORAGE; do
    value="$(repository_env_value "SWW_$service")"
    [[ "$value" == bundled || "$value" == external ]] || { echo "Invalid $service selector." >&2; exit 64; }
    if [[ "$value" == external ]]; then
      case "$service" in DATABASE) overlay=database ;; REDIS) overlay=redis ;; STORAGE) overlay=storage ;; esac
      files+=(-f "$ROOT/docker/compose.external-$overlay.yml")
    fi
  done
  if [[ "$(repository_env_value SWW_HOSTING_MODEL)" == 2 ]]; then
    files+=(-f "$ROOT/docker/compose.api-only.yml")
  fi
fi
if [[ "${SWW_COMPOSE_BUILD:-0}" == 1 ]]; then
  if [[ "$role" == frontend ]]; then files+=(-f "$ROOT/docker/compose.frontend-build.yml")
  else files+=(-f "$ROOT/docker/compose.build.yml"); fi
fi
if [[ "$https" == auto ]]; then
  if [[ "$role" == frontend ]]; then files+=(-f "$ROOT/docker/compose.frontend-tls.yml")
  else files+=(-f "$ROOT/docker/compose.tls.yml"); fi
  if [[ "$role" == backend && "$(repository_env_value SWW_HOSTING_MODEL)" == 2 ]]; then files+=(-f "$ROOT/docker/compose.api-only-edge.yml"); fi
fi
# Resolve relative binds from install root even when the first file is in docker/.
exec docker compose --project-directory "$ROOT" --env-file "$ROOT/.env" "${files[@]}" "$@"
