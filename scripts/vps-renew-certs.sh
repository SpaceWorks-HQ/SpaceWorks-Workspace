#!/usr/bin/env bash
# Renew the one-year private TLS certificates of PostgreSQL, Redis and Silo,
# keeping the CA and every credential, then recreate the services and run the
# checks. A weekly timer (sww-certificates.timer) runs it with --if-due,
# which renews only within 60 days of expiry. Caddy renews public HTTPS
# certificates by itself.
#   vps-renew-certs.sh [--if-due]
set -euo pipefail
set +x
source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=scripts/vps-lib.sh
. "$source_dir/scripts/vps-lib.sh"
args=(renew-certificates)
case "${1:-}" in
  '') ;;
  --if-due) args+=(--if-due) ;;
  *) die 'Usage: vps-renew-certs.sh [--if-due]' ;;
esac
require_root
load_config_dir
[[ -f "$SWW_CONFIG_DIR/compose.env" ]] || die "No installation configuration in $SWW_CONFIG_DIR."
[[ ! -d "$SWW_DIR" ]] || take_lock
SWW_REPO_DIR=$source_dir
status=0
compose run --rm --no-deps --volume "$SWW_CONFIG_DIR:/config" ops node docker/vps/setup.mjs "${args[@]}" || status=$?
[[ $status != 10 ]] || exit 0
[[ $status = 0 ]] || die 'Certificate renewal failed; the current certificates stay in use.'
say 'Restarting the services with the renewed certificates (a short interruption).'
compose up -d --wait --wait-timeout 300 --force-recreate
compose run --rm --no-deps ops node docker/vps/check.mjs
say 'Internal certificates renewed for one year.'
