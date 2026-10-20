#!/usr/bin/env bash
# Real installer smoke with local images. No existing project/data is touched.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
run="sww-release-$$"
version="0.1.0-main.0.000000000000"
work="$(mktemp -d "${TMPDIR:-/tmp}/.sww-smoke.XXXXXX")"
projects=()
export BUILDX_CONFIG="${BUILDX_CONFIG:-$work/buildx}"
mkdir -p "$BUILDX_CONFIG"
cleanup() {
  local code=$? folder
  trap - EXIT
  set +e
  for folder in ${projects[@]+"${projects[@]}"}; do
    if [[ -f "$folder/.env" ]]; then SWW_INSTALL_DIR="$folder" bash "$folder/scripts/spaceworks-workspace-compose.sh" down --volumes --remove-orphans; fi
  done
  if [[ "$code" == 0 ]]; then rm -rf -- "$work"
  else echo "Smoke failed; private diagnostics retained in $work (do not publish config/)." >&2; fi
  exit "$code"
}
trap cleanup EXIT
backend="spaceworks-workspace-backend-local"
frontend="spaceworks-workspace-frontend-local"
allinone="spaceworks-workspace-allinone-local"
# Optional skip is for repeating only install checks after images already built.
if [[ "${SWW_TEST_SKIP_BUILD:-0}" != 1 ]]; then
  docker build -t "$backend:$version" .
  docker build -f docker/frontend/Dockerfile --build-arg "SWW_BACKEND_BUILD=$backend:$version" -t "$frontend:$version" .
  docker build -f Dockerfile.allinone --build-arg "SWW_BACKEND_BUILD=$backend:$version" -t "$allinone:$version" .
fi
bash scripts/create-release-bundle.sh "$version" "$work/runtime.tar.gz"
mkdir "$work/bundle"
tar -xzf "$work/runtime.tar.gz" -C "$work/bundle"
for shape in 1 2; do
  install="$work/install-$shape"
  projects+=("$install")
  # Reserve independently selected currently-free host ports; bind fails if raced.
  ports="$(python3 - <<'PY'
import socket
s=[socket.socket() for _ in range(3)]
for x in s: x.bind(('127.0.0.1',0))
print(' '.join(str(x.getsockname()[1]) for x in s))
for x in s: x.close()
PY
)"
  read -r http https edge <<< "$ports"
  printf '1\nlocalhost\n1\nowner@example.org\n%s\n1\n1\n1\nskip\nowner@example.org\n\n\nN\nN\nY\n' "$shape" > "$work/prompts-$shape"
  SPACEWORKS_WORKSPACE_DIR="$install" COMPOSE_PROJECT_NAME="$run-$shape" \
    SWW_INSTALL_LOCAL_BUNDLE="$work/bundle" SWW_ALLOW_LOCAL_IMAGES=1 SWW_INSTALL_INPUT_FILE="$work/prompts-$shape" \
    SWW_SKIP_PULL=1 SWW_BACKEND_IMAGE="$backend" SWW_FRONTEND_IMAGE="$frontend" SWW_ALLINONE_IMAGE="$allinone" \
    SWW_HTTP_PORT="$http" SWW_HTTPS_PORT="$https" SWW_EDGE_PORT="$edge" SWW_CADDY_TLS=internal SWW_BIND=127.0.0.1 \
    SWW_EDGE_SUBNET="172.29.$((110 + shape)).0/24" \
    bash "$ROOT/install.sh" > "$work/install-$shape.log" 2>&1 || { tail -n 40 "$work/install-$shape.log"; exit 1; }
  origin="https://localhost:$https"
  curl -kfsS --retry 20 --retry-delay 2 --retry-all-errors "$origin/api/health" >/dev/null
  test "$(curl -ksS -o /dev/null -w '%{http_code}' "$origin/setup")" == 200
  test "$(curl -ksS -o /dev/null -w '%{http_code}' "$origin/api/health/db")" == 404
  test "$(curl -ksS -o /dev/null -w '%{http_code}' -X POST "$origin/api/internal/jobs")" == 404
  SWW_INSTALL_DIR="$install" bash "$install/scripts/spaceworks-workspace-compose.sh" exec -T "$([[ "$shape" == 1 ]] && echo backend || echo app)" \
    node /app/scripts/container-health.mjs
  echo "Installed shape $shape passed edge health, private readiness guard and first-run setup."
done
echo 'All three images and both real installer shapes passed.'
