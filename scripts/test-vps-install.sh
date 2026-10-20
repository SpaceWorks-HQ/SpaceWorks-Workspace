#!/usr/bin/env bash
# CI-only real two-image smoke. No browser or production credentials.
set -euo pipefail
set +x
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
[[ ${CI:-} = true ]] || { echo 'Run this image/installer smoke only on an isolated CI runner.' >&2; exit 1; }
work=$(mktemp -d)
SWW_CONFIG_DIR="$work/config"
SWW_PROJECT_NAME="sww-smoke-$(date +%s)"
export SWW_CONFIG_DIR SWW_PROJECT_NAME
cleanup() {
  status=$?
  if [[ $status != 0 && -f "$SWW_CONFIG_DIR/compose.env" ]]; then
    # Only this disposable deployment; never dump interpolated configuration.
    as_root sh scripts/vps-compose.sh ps || true
    as_root sh scripts/vps-compose.sh logs --tail 30 app frontend || true
  fi
  [[ ! -f "$SWW_CONFIG_DIR/compose.env" ]] || as_root sh scripts/vps-compose.sh down --volumes --remove-orphans >/dev/null 2>&1 || true
  as_root rm -rf -- "$work"
}
trap cleanup EXIT
# The real installer runs as root; config files are root-owned with mode 600.
as_root() { if [[ $(id -u) = 0 ]]; then "$@"; else sudo -E "$@"; fi; }
mkdir -m 700 "$SWW_CONFIG_DIR"
export SWW_BUILD_KEY
SWW_BUILD_KEY=$(openssl rand -base64 32)
docker build --target runner --secret id=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,env=SWW_BUILD_KEY \
  --build-arg NEXT_PUBLIC_BASE_URL=https://spaceworks-workspace-origin.invalid -t sww-backend:smoke .
docker build --target frontend --secret id=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,env=SWW_BUILD_KEY \
  --build-arg NEXT_PUBLIC_BASE_URL=https://spaceworks-workspace-origin.invalid \
  --build-arg NEXT_PUBLIC_BACKEND_ORIGIN=https://spaceworks-workspace-backend.invalid -t sww-frontend:smoke .
# Exercise the exact configuration writer the confirmed installer runs.
docker run --rm --user 0:0 -v "$SWW_CONFIG_DIR:/config" sww-backend:smoke \
  node docker/vps/setup.mjs api.workspace.example.test owner@example.test smoke workspace.example.test split
export EMAIL_FROM='Space Works Workspace <noreply@example.test>' SMTP_HOST=smtp.example.test SMTP_PORT=587 SMTP_SECURE=false SMTP_USER=smoke SMTP_PASSWORD=disposable-ci-smtp
# Credentials travel in environment, never arguments.
docker run --rm --user 0:0 -v "$SWW_CONFIG_DIR:/config" \
  -e EMAIL_FROM -e SMTP_HOST -e SMTP_PORT -e SMTP_SECURE -e SMTP_USER -e SMTP_PASSWORD \
  sww-backend:smoke node docker/vps/configure-smtp.mjs
printf "SWW_CADDY_TLS='internal'\n" | as_root tee -a "$SWW_CONFIG_DIR/compose.env" >/dev/null
as_root mkdir -m 755 "$SWW_CONFIG_DIR/status"
as_root sh scripts/vps-compose.sh config --quiet
as_root sh scripts/vps-compose.sh up -d --wait --wait-timeout 300
as_root sh scripts/vps-compose.sh run --rm --no-deps -T ops node docker/vps/check.mjs
as_root sh scripts/vps-compose.sh run --rm --no-deps -T ops node docker/vps/smoke.mjs
# Exercise the same image with the single-hostname layout too, preserving data.
# shellcheck disable=SC2016 # expanded by the inner shell
as_root bash -c '. scripts/vps-lib.sh
conf_set "$1/compose.env" SWW_LAYOUT single
conf_set "$1/compose.env" SWW_CADDYFILE Caddyfile
conf_set "$1/app.env" DEPLOYMENT_MODE ""' _ "$SWW_CONFIG_DIR"
as_root sh scripts/vps-compose.sh up -d --wait --wait-timeout 300 --remove-orphans
as_root sh scripts/vps-compose.sh run --rm --no-deps -T ops node docker/vps/smoke.mjs
printf 'Two-image installer smoke passed in split and single layouts.\n'
