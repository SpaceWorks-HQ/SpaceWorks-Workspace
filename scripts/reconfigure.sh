#!/usr/bin/env bash
# Edge/container changes preserve endpoints, keys, data and runtime credentials.
set -euo pipefail
# shellcheck source=scripts/release-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/release-lib.sh"
source "$ROOT/scripts/setup-question-input.sh"
shape=''; https=''; confirm=''
exec 3</dev/tty
echo 'This changes application shape and HTTPS edge only. Endpoint changes require a planned migration.'
question shape 'Application shape' "$(repository_env_value SWW_SHAPE)" choices:single,separate
question https 'HTTPS edge' "$(repository_env_value SWW_HTTPS)" choices:auto,proxy
[[ "$(repository_env_value SWW_HOSTING_MODEL)" != 2 || "$shape" == separate ]] || die 'Split hosting requires separate containers.'
printf 'Apply shape=%s, HTTPS=%s? Data and keys are retained.\n' "$shape" "$https"
question confirm 'Proceed?' N choices:Y,y,N,n
[[ "$confirm" =~ ^[Yy] ]] || exit 0
SWW_OPERATION_PARENT_PID="$$" bash "$ROOT/scripts/backup.sh"
"${COMPOSE[@]}" stop "${APP_SERVICES[@]}"
cp -p "$ROOT/.env" "$ROOT/backups/deployment-before-reconfigure.env"
python3 "$ROOT/scripts/set-install-value.py" "$ROOT/.env" SWW_SHAPE "$shape"
python3 "$ROOT/scripts/set-install-value.py" "$ROOT/.env" SWW_HTTPS "$https"
upstream=frontend:8080
[[ "$shape" != single ]] || upstream=app:8080
[[ "$(repository_env_value SWW_HOSTING_MODEL)" != 2 ]] || upstream=api-edge:8080
python3 "$ROOT/scripts/set-install-value.py" "$ROOT/.env" SWW_EDGE_UPSTREAM "$upstream"
deployment_services
"${COMPOSE[@]}" up -d --remove-orphans
wait_for_backend || die 'Readiness failed. Restore backups/deployment-before-reconfigure.env and restart.'
