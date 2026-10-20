#!/usr/bin/env bash
# Read-only checks plus isolated, temporary Compose configurations.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
for file in install.sh setup.sh local.sh scripts/*.sh docker/services/*.sh docker/frontend/*.sh docker/frontend/docker-entrypoint.d/*.sh docker/allinone/*.sh; do bash -n "$file"; done
shellcheck -x install.sh setup.sh local.sh scripts/*.sh docker/services/*.sh docker/frontend/*.sh docker/frontend/docker-entrypoint.d/*.sh docker/allinone/*.sh
for file in scripts/*.mjs scripts/seed/*.mjs; do node --check "$file"; done
python3 - "$ROOT" <<'PY'
from pathlib import Path
import ast,sys
for file in (Path(sys.argv[1])/'scripts').glob('*.py'):
    ast.parse(file.read_text(),filename=str(file))
PY
ruby -ryaml -e 'ARGV.each { |f| YAML.load_file(f, aliases: true) }' .github/workflows/*.yml render.yaml .do/app.yaml
# All combinations: two shapes, each independent managed dependency and TLS mode.
cp docker-compose.prod.yml docker-compose.cloud.yml "$work/"
cp -R docker deploy "$work/"
cp -R scripts "$work/"
mkdir -p "$work/config/tls"
for name in app migrate postgres storage storage-init scheduler; do touch "$work/config/$name.env"; done
touch "$work/config/tls/ca.crt" "$work/config/redis.conf"
for shape in separate single; do
  for db in bundled external; do for redis in bundled external; do for storage in bundled external; do for https in auto proxy; do
    cat > "$work/.env" <<EOF
SWW_SHAPE=$shape
SWW_HOST_ROLE=backend
SWW_HOSTING_MODEL=1
SWW_DATABASE=$db
SWW_REDIS=$redis
SWW_STORAGE=$storage
SWW_HTTPS=$https
SWW_PUBLIC_HOST=work.example.org
SWW_EDGE_UPSTREAM=$([[ "$shape" == single ]] && echo app:8080 || echo frontend:8080)
EOF
    SWW_INSTALL_DIR="$work" bash "$ROOT/scripts/spaceworks-workspace-compose.sh" config --quiet
  done; done; done; done
done
# Split/backend, split/frontend, cloud and source-build render too.
for https in auto proxy; do
  for role in backend frontend; do
    cat >> "$work/.env" <<EOF
SWW_SHAPE=separate
SWW_HOST_ROLE=$role
SWW_HOSTING_MODEL=2
SWW_HTTPS=$https
BACKEND_UPSTREAM=https://backend.example.org
SWW_EDGE_UPSTREAM=$([[ "$role" == backend ]] && echo api-edge:8080 || echo frontend:8080)
EOF
    SWW_INSTALL_DIR="$work" bash "$ROOT/scripts/spaceworks-workspace-compose.sh" config --quiet
  done
done
docker compose --project-directory "$work" --env-file "$work/.env" -f "$work/docker-compose.cloud.yml" config --quiet
# Clone-only build contexts are syntax-checked without starting containers.
SWW_INSTALL_DIR="$work" SWW_COMPOSE_BUILD=1 bash "$ROOT/scripts/spaceworks-workspace-compose.sh" config --quiet
# Default backend, automatic TLS, separate, bundled dependencies, no optional credentials.
printf '1\nwork.example.org\n1\nowner@example.org\n1\n1\n1\n1\nskip\nowner@example.org\n\n\nN\nN\nY\n' > "$work/prompts"
SWW_INSTALL_TEST_MODE=1 SWW_INSTALL_INPUT_FILE="$work/prompts" SWW_REPOSITORY=SpaceWorks-HQ/SpaceWorks-Workspace SPACEWORKS_WORKSPACE_DIR="$work/install" bash install.sh > "$work/dry-run.log"
grep -q 'Dry run confirmed' "$work/dry-run.log"
test ! -e "$work/install"
if command -v helm >/dev/null 2>&1; then
  helm lint charts/spaceworks-workspace --set existingSecret=sww-runtime
  helm template sww charts/spaceworks-workspace --set existingSecret=sww-runtime --set frontend.enabled=true --set ingress.enabled=true --set autoscaling.enabled=true > /dev/null
fi
printf 'Release verification passed: shell, JS, Python, YAML, 38 Compose configurations and confirmed dry installer.\n'
