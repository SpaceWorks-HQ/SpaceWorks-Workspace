#!/usr/bin/env bash
# Any essential child exiting stops the unit; tini reaps descendants.
set -euo pipefail
export BACKEND_UPSTREAM=http://127.0.0.1:3000
export APP_URL=http://127.0.0.1:3000
/bin/sh /docker-entrypoint.d/30-configure-upstream.sh
pids=()
stop() {
  trap - TERM INT
  kill -TERM "${pids[@]}" 2>/dev/null || true
  wait "${pids[@]}" 2>/dev/null || true
}
trap 'stop; exit 143' TERM
trap 'stop; exit 130' INT
HOSTNAME=127.0.0.1 docker-entrypoint.sh web &
pids+=("$!")
if [[ "${SWW_SCHEDULER_ENABLED:-1}" == 1 ]]; then
  docker-entrypoint.sh scheduler &
  pids+=("$!")
fi
nginx -g 'daemon off;' &
pids+=("$!")
status=0
wait -n "${pids[@]}" || status=$?
stop
# A clean early exit is also unhealthy: restart the complete unit.
[[ "$status" != 0 ]] || status=1
exit "$status"
