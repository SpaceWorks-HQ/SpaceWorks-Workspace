#!/bin/sh
# One published backend, explicit process roles. Unknown roles fail closed.
set -eu
# Some cloud providers prepend this script when overriding the container command.
case "${1:-}" in docker-entrypoint.sh|/usr/local/bin/docker-entrypoint.sh) shift ;; esac
role=${1:-web}
[ "$#" -eq 0 ] || shift
case "$role" in
  web) exec node /app/server.js "$@" ;;
  migrate)
    export DIRECT_URL="${DIRECT_URL:-${DATABASE_URL:?DATABASE_URL is required}}" CHECKPOINT_DISABLE=1
    exec node /opt/prisma-cli/node_modules/prisma/build/index.js migrate deploy --schema /app/prisma/schema.prisma "$@" ;;
  scheduler) exec node /app/scripts/scheduler.mjs "$@" ;;
  ops) exec "$@" ;;
  *) echo 'Use web, migrate, scheduler, or ops followed by an explicit command.' >&2; exit 64 ;;
esac
