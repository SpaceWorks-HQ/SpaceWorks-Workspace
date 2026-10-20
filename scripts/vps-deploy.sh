#!/usr/bin/env bash
# Deploy a published release without questions. The Release workflow's deploy
# job runs it on this server through the runner from install-runner.sh:
#   vps-deploy.sh v0.1.0-main.42.a1b2c3d4e5f6
# It downloads that release's source like install.sh, then runs its updater:
# backup, new images, migrations, health checks, and the previous release
# restored automatically if the new one is unhealthy.
set -euo pipefail
set +x
source_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
# shellcheck source=scripts/vps-lib.sh
. "$source_dir/scripts/vps-lib.sh"
tag=${1:-}
[[ $# = 1 && "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-[a-z0-9-]+\.[0-9]+\.[0-9a-f]{12}$ ]] \
  || die 'Usage: vps-deploy.sh v<release version>'
require_root
load_config_dir
if [[ -f "$SWW_CONFIG_DIR/github-token" ]]; then
  [[ $(stat -c %u "$SWW_CONFIG_DIR/github-token") = 0 && $(stat -c %a "$SWW_CONFIG_DIR/github-token") = 600 ]] || die 'The private repository credential must be root-owned, mode 600.'
  SWW_GITHUB_TOKEN=$(cat "$SWW_CONFIG_DIR/github-token")
  export SWW_GITHUB_TOKEN
fi
[[ -f "$(install_conf)" ]] || die "No installation in $SWW_DIR."
repository=${SWW_REPOSITORY:-$(conf_get "$(install_conf)" SWW_REPOSITORY)}
repository=${repository:-$SWW_DEFAULT_REPOSITORY}
is_repository "$repository" || die 'SWW_REPOSITORY must be a GitHub owner/name.'
version=${tag#v}
revision=$(github --header 'Accept: application/vnd.github.sha' "https://api.github.com/repos/$repository/commits/$tag") \
  || die "Could not find release $tag in $repository."
[[ "$revision" =~ ^[a-f0-9]{40}$ && "${revision:0:12}" = "${version: -12}" ]] || die "Release $tag does not point at its own commit."
# Only published releases of main deploy: never a pre-release, a bare tag or a
# commit that is not on main, whatever the workflow that asked.
release_json=$(github "https://api.github.com/repos/$repository/releases/tags/$tag") \
  || die "$tag is not a published GitHub Release of $repository."
grep -Eq '"prerelease"[[:space:]]*:[[:space:]]*false' <<< "$release_json" || die "$tag is a pre-release; it is never deployed automatically."
grep -Eq '"draft"[[:space:]]*:[[:space:]]*false' <<< "$release_json" || die "$tag is a draft release."
status=$(github "https://api.github.com/repos/$repository/compare/main...$revision?per_page=1" \
  | sed -n 's/^[[:space:]]*"status"[[:space:]]*:[[:space:]]*"\([a-z]*\)".*/\1/p' | head -n 1)
[[ $status = identical || $status = behind ]] || die "The commit of $tag is not on main."
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
say "Downloading $version (commit ${revision:0:12})."
mkdir "$stage/source"
github "https://api.github.com/repos/$repository/tarball/$revision" | tar -xz -C "$stage/source" --strip-components=1 --no-same-owner
printf '%s\n' "$revision" > "$stage/source/.release"
printf '%s\n' "$version" > "$stage/source/.release-version"
[[ -f "$stage/source/scripts/update-vps.sh" ]] || die "Release $tag has no updater."
SWW_STAGED=1 SWW_REPOSITORY="$repository" bash "$stage/source/scripts/update-vps.sh" --yes </dev/null
