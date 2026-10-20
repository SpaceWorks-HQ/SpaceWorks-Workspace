#!/usr/bin/env bash
write_setup_environment() {
  [[ "${ANSWERS_CONFIRMED:-}" == yes ]] || die 'Confirm the deployment questions first.'
  [[ ! -e "$ROOT/.env" && ! -e "$ROOT/config/app.env" ]] || die 'Configuration exists; secrets will not be overwritten.'
  local key
  mkdir -p "$ROOT/config" "$ROOT/backups"
  chmod 700 "$ROOT/config" "$ROOT/backups"
  for key in "${SETUP_ANSWER_KEYS[@]}"; do export "${key?}"; done
  local arguments=()
  for key in "${SETUP_ANSWER_KEYS[@]}"; do arguments+=(-e "$key"); done
  for key in SWW_IMAGE_TAG SWW_BACKEND_IMAGE SWW_FRONTEND_IMAGE SWW_ALLINONE_IMAGE SWW_HTTP_PORT SWW_HTTPS_PORT SWW_EDGE_PORT SWW_BIND SWW_CADDY_TLS SWW_EDGE_SUBNET SWW_TRUSTED_PROXY_CIDR COMPOSE_PROJECT_NAME; do
    [[ -z "${!key:-}" ]] || arguments+=(-e "$key")
  done
  # No host Node/OpenSSL required. The published backend contains the configuration tool.
  docker run --rm --user "$(id -u):$(id -g)" --entrypoint node \
    "${arguments[@]}" -v "$ROOT:/installation" "$SWW_BACKEND_IMAGE:${SWW_IMAGE_TAG:-latest}" \
    /app/scripts/configure-installation.mjs /installation
}
