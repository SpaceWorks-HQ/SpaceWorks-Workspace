#!/usr/bin/env bash
# Renew data-service certificates under the same CA; keep credentials unchanged.
set -euo pipefail
# shellcheck source=scripts/release-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/release-lib.sh"
"${COMPOSE[@]}" run --rm --no-deps -T --user "$(id -u):$(id -g)" \
  -v "$ROOT/config:/config" ops ops node /app/scripts/renew-certificates.mjs /config
services=()
[[ "$(repository_env_value SWW_DATABASE)" != bundled ]] || services+=(postgres)
[[ "$(repository_env_value SWW_REDIS)" != bundled ]] || services+=(redis)
[[ "$(repository_env_value SWW_STORAGE)" != bundled ]] || services+=(silo)
"${COMPOSE[@]}" stop "${APP_SERVICES[@]}"
[[ ${#services[@]} == 0 ]] || "${COMPOSE[@]}" up -d --no-deps --force-recreate --wait "${services[@]}"
"${COMPOSE[@]}" up -d --no-deps --force-recreate "${APP_SERVICES[@]}"
wait_for_backend || die 'Readiness failed after certificate renewal.'
