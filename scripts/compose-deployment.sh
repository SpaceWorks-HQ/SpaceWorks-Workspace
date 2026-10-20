#!/usr/bin/env bash
# Service sets omit disabled profiles during pull, restart and rollback.
deployment_services() {
  APP_SERVICE=backend
  APP_SERVICES=(backend scheduler frontend)
  if [[ "$(repository_env_value SWW_SHAPE)" == single ]]; then APP_SERVICE=app; APP_SERVICES=(app); fi
  if [[ "$(repository_env_value SWW_HOST_ROLE)" == frontend ]]; then
    APP_SERVICE=frontend; APP_SERVICES=(frontend)
  elif [[ "$(repository_env_value SWW_HOSTING_MODEL)" == 2 ]]; then APP_SERVICES=(backend scheduler api-edge); fi
  [[ "$(repository_env_value SWW_HTTPS)" != auto ]] || APP_SERVICES+=(caddy)
}
wait_for_backend() {
  local _
  for _ in $(seq 1 60); do
    if [[ "$APP_SERVICE" == frontend ]]; then
      "${COMPOSE[@]}" exec -T frontend wget -qO- http://127.0.0.1:8080/api/health >/dev/null 2>&1 && return 0
    else
      "${COMPOSE[@]}" exec -T "$APP_SERVICE" node /app/scripts/container-health.mjs >/dev/null 2>&1 && return 0
    fi
    sleep 3
  done
  return 1
}
