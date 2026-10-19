#!/bin/sh
# Docker Compose for the production VPS stack with the external configuration.
#
#   SWW_CONFIG_DIR=/etc/spaceworks-workspace scripts/vps-compose.sh ps
#
# Loads $SWW_CONFIG_DIR/compose.env (project name, hostname, release version)
# and compose.production.yml from this release. Never reads the development .env.
set -eu
SWW_CONFIG_DIR=${SWW_CONFIG_DIR:-/etc/spaceworks-workspace}
case "$SWW_CONFIG_DIR" in /*) ;; *) echo 'SWW_CONFIG_DIR must be an absolute path.' >&2; exit 1 ;; esac
[ -f "$SWW_CONFIG_DIR/compose.env" ] || { echo "No configuration at $SWW_CONFIG_DIR (run scripts/setup-vps.sh first)." >&2; exit 1; }
export SWW_CONFIG_DIR
# The saved configuration is authoritative, even in an old operator shell.
unset PUBLIC_HOST PUBLIC_ORIGIN SWW_VERSION ACME_EMAIL CADDY_TLS SWW_HTTP_PORT SWW_HTTPS_PORT SWW_BIND_PREFIX \
  COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES
repo_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
exec docker compose \
  --env-file "$SWW_CONFIG_DIR/compose.env" \
  --file "$repo_dir/compose.production.yml" \
  --project-directory "$repo_dir" \
  "$@"
