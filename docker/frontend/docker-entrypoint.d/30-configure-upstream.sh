#!/bin/sh
# Nginx variables must remain literal through envsubst.
# shellcheck disable=SC2016
set -eu
: "${BACKEND_UPSTREAM:=http://backend:3000}"
BACKEND_UPSTREAM="${BACKEND_UPSTREAM%/}"
# Interpolation is restricted to named variables. Nginx variables stay literal.
case "$BACKEND_UPSTREAM" in http://*|https://*) ;; *) echo 'BACKEND_UPSTREAM must use HTTP or HTTPS.' >&2; exit 64 ;; esac
if printf '%s' "$BACKEND_UPSTREAM" | grep -q '[^a-zA-Z0-9.:/_-]'; then
  echo 'BACKEND_UPSTREAM must be an origin without credentials, query or fragment.' >&2; exit 64
fi
case "${SWW_TRUSTED_PROXY_CIDR:-127.0.0.1/32}" in
  *[!0-9a-fA-F.:/]*) echo 'Invalid trusted proxy CIDR.' >&2; exit 64 ;;
esac
export BACKEND_UPSTREAM SWW_TRUSTED_PROXY_CIDR="${SWW_TRUSTED_PROXY_CIDR:-127.0.0.1/32}"
SWW_FORWARDED_SCHEME='$scheme'
[ "${SWW_TRUST_FORWARDED_PROTO:-0}" != 1 ] || SWW_FORWARDED_SCHEME='$external_scheme'
SWW_BACKEND_HOST_HEADER='$http_host'
case "$BACKEND_UPSTREAM" in https://*) SWW_BACKEND_HOST_HEADER="${BACKEND_UPSTREAM#https://}" ;; esac
export SWW_BACKEND_HOST_HEADER
export SWW_FORWARDED_SCHEME
envsubst '${BACKEND_UPSTREAM} ${SWW_TRUSTED_PROXY_CIDR} ${SWW_FORWARDED_SCHEME} ${SWW_BACKEND_HOST_HEADER}' \
  < /etc/nginx/templates/workspace.conf.template > /tmp/workspace.conf
