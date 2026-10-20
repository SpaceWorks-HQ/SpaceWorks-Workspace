#!/usr/bin/env bash
# Closed runtime bundle: no application source, .env, dependencies or private state.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="${1:?Supply an immutable version}"
output="${2:?Supply an absolute output archive path}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-main\.[0-9]+\.[0-9a-f]{12}$ && "$output" == /* ]] || exit 64
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
cd "$ROOT"
files=(install.sh setup.sh setup.ps1 VERSION docker-compose.prod.yml docker-compose.cloud.yml)
for file in scripts/{install-docker.sh,python-runtime.sh,setup-questions.sh,setup-question-input.sh,setup-write-environment.sh,setup-first-run.sh,spaceworks-workspace-compose.sh,spaceworks-workspace-repository.sh,compose-deployment.sh,install-owner.sh,install-host-bundle.sh,update.sh,update.ps1,update-lock.sh,update-rollback.sh,release-lib.sh,release-download.sh,backup.sh,backup-manifest.py,restore.sh,restore-keys.py,import-backup.sh,set-install-value.py,reconfigure.sh,module-selection.sh,init-host-orchestration.sh,setup-host-orchestration.sh,configure-compose-wrapper.py,validate-compose-wrapper.py,host-capability.py,install-runner.sh,runner-release.py,select-main-release.py,verify-release-images.sh,renew-certificates.sh}; do files+=("$file"); done
for file in docker/compose.*.yml docker/services/* deploy/Caddyfile deploy/nginx.api-only.conf deploy/storage*.caddy docs/DEPLOYMENT_*.md docs/CONTAINER_IMAGES.md docs/CONFIGURATION.md docs/production-operations.md docs/areas/release.md; do files+=("$file"); done
for file in "${files[@]}"; do
  [[ -f "$file" && ! -L "$file" ]] || { echo "Missing runtime file: $file" >&2; exit 1; }
  mkdir -p "$work/$(dirname "$file")"
  cp -p "$file" "$work/$file"
done
printf '%s\n' "${files[@]}" > "$work/bundle-files.txt"
printf '%s\n' "$version" > "$work/.bundle-version"
printf '%s\n' bundle-files.txt .bundle-version >> "$work/bundle-files.txt"
tar -czf "$output" -C "$work" .
echo "Runtime release bundle ready: $output"
