#!/usr/bin/env bash
# Renew the internal TLS certificates (PostgreSQL, Redis, Silo) for another
# year with the existing private CA, then restart the services that use them.
# Public HTTPS certificates are renewed by Caddy automatically.
#
#   scripts/vps-renew-certs.sh        (check expiry: openssl x509 -enddate -noout -in $SWW_CONFIG_DIR/tls/postgres/public.crt)
set -euo pipefail
set +x
repo_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=scripts/vps-lib.sh
. "$repo_dir/scripts/vps-lib.sh"
SWW_CONFIG_DIR=${SWW_CONFIG_DIR:-$SWW_DEFAULT_CONFIG_DIR}
require_config_dir
confirm 'Renew internal certificates and restart the stack (about a minute of downtime)?'
version=$(setting SWW_VERSION)
docker run --rm --user "$(id -u):$(id -g)" --volume "$SWW_CONFIG_DIR:/config" \
  "sww-ops:$version" node docker/vps/setup.mjs renew-certificates
compose up -d --wait --wait-timeout 300 --force-recreate postgres redis storage app scheduler proxy
compose run --rm --no-deps ops node docker/vps/check.mjs
