#!/usr/bin/env bash
# Self-contained bootstrap for curl | bash. Host changes follow one reviewable summary.
set -euo pipefail
set +x
show_guide() {
  cat <<'EOF'
Space Works Workspace installer

  curl -fsSL https://raw.githubusercontent.com/SpaceWorks-HQ/SpaceWorks-Workspace/main/install.sh | bash
  bash install.sh --repo Owner/Fork

Requirements
  64-bit x86_64 or arm64. Linux: Debian/Ubuntu, Fedora/RHEL/Alma/Rocky,
  Arch or openSUSE; root or sudo. macOS / Windows Git Bash / WSL: running
  Docker Desktop. At least 8 GiB free. curl or wget, and tar, must exist.
  Ports are checked after you choose hosting, HTTPS and application shape.

What happens
  Preflight changes nothing on the host. A pinned release bundle is downloaded
  into temporary storage. Answer all questions, review services and host actions,
  then confirm. Only then are dependencies installed and private settings written.
  Published images are pulled; the installer never builds on the host.
  The default installation directory is /opt/spaceworks-workspace.
  SPACEWORKS_WORKSPACE_DIR overrides it. Rerun to update or change services.
  Public repositories need no token. Private forks: export SWW_GITHUB_TOKEN
  with repository read and GHCR read:packages access before running.

Options
  --repo owner/name   fork to install (also SWW_REPOSITORY)
  --help              this guide
EOF
}
say() { printf '[Space Works Workspace installer] %s\n' "$*"; }
die() { say "ERROR: $*" >&2; exit 1; }
REPOSITORY="${SWW_REPOSITORY:-SpaceWorks-HQ/SpaceWorks-Workspace}"
while (($#)); do
  case "$1" in
    --help|-h) show_guide; exit 0 ;;
    --repo) shift; [[ $# -gt 0 ]] || die '--repo needs owner/name'; REPOSITORY="$1" ;;
    --repo=*) REPOSITORY="${1#*=}" ;;
    *) die 'Usage: install.sh [--repo owner/name] [--help]' ;;
  esac
  shift
done
[[ "$REPOSITORY" =~ ^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || die 'Use a GitHub owner/repo name.'
export SWW_REPOSITORY="$REPOSITORY" SWW_INSTALL_REPOSITORY_PINNED=1
INSTALL_DIR="${SPACEWORKS_WORKSPACE_DIR:-/opt/spaceworks-workspace}"
[[ "$INSTALL_DIR" == /* && "$INSTALL_DIR" != / && "$INSTALL_DIR" != *[\'\"\$\`]* && "$INSTALL_DIR" != *$'\n'* ]] || die 'Use a dedicated absolute installation directory without shell metacharacters.'
INSTALL_DIR="${INSTALL_DIR%/}"
[[ ! -L "$INSTALL_DIR" ]] || die 'The installation directory must not be a symlink.'
STAGE_DIR=''; ARCHIVE=''; ACTION=fresh; SUDO=(); RUN_ROOT=(); USE_DOCKER_GROUP=0
cleanup() {
  [[ -z "$STAGE_DIR" ]] || rm -rf -- "$STAGE_DIR"
  [[ -z "$ARCHIVE" ]] || rm -f -- "$ARCHIVE"
}
trap cleanup EXIT
prompt() {
  local reply
  printf '%s' "$1" > /dev/tty
  IFS= read -r reply < /dev/tty || reply=''
  printf '%s' "${reply%$'\r'}"
}
show_guide
say 'Read-only preflight: architecture, OS, privileges, bootstrap tools, disk and existing state.'
case "$(uname -m)" in x86_64|amd64) ARCH=x86_64 ;; aarch64|arm64) ARCH=aarch64 ;; *) die 'Release images support x86_64 and arm64.' ;; esac
say "Architecture: $ARCH"
PACKAGE_FAMILY=''; HOST_KIND=''
case "$(uname -s)" in
  Linux)
    HOST_KIND=linux
    [[ -r /etc/os-release ]] || die '/etc/os-release is missing.'
    # shellcheck disable=SC1091
    source /etc/os-release
    case " ${ID:-} ${ID_LIKE:-} " in
      *' debian '*|*' ubuntu '*|*' linuxmint '*) PACKAGE_FAMILY=apt ;;
      *' fedora '*|*' rhel '*|*' centos '*|*' rocky '*|*' almalinux '*) PACKAGE_FAMILY=dnf ;;
      *' arch '*|*' manjaro '*) PACKAGE_FAMILY=pacman ;;
      *' suse '*|*' opensuse '*|*' sles '*) PACKAGE_FAMILY=zypper ;;
      *) die 'Supported Linux families: apt, dnf, pacman and zypper.' ;;
    esac
    if [[ "$(id -u)" != 0 ]]; then
      command -v sudo >/dev/null 2>&1 || die 'Linux installation requires root or sudo.'
      SUDO=(sudo)
    fi ;;
  Darwin) HOST_KIND=desktop ;;
  MINGW*|MSYS*|CYGWIN*) HOST_KIND=desktop ;;
  *) die 'Use Linux or macOS/Windows with Docker Desktop.' ;;
esac
command -v tar >/dev/null 2>&1 || die 'Install tar, then rerun. Nothing was changed.'
command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || die 'Install curl or wget, then rerun.'
if [[ "$HOST_KIND" == desktop && "${SWW_INSTALL_TEST_MODE:-0}" != 1 ]]; then
  if ! docker info >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then die 'Start Docker Desktop with Compose V2, then rerun.'; fi
fi
path="$INSTALL_DIR"
while [[ ! -e "$path" ]]; do path="$(dirname "$path")"; done
free="$(df -Pk "$path" | awk 'NR==2 {print $4}')"
if [[ ! "$free" =~ ^[0-9]+$ ]] || ((free < 8 * 1024 * 1024)); then die 'At least 8 GiB free disk is required.'; fi
if [[ ! -w "$path" ]]; then
  [[ "$HOST_KIND" == linux ]] || die 'Set SPACEWORKS_WORKSPACE_DIR to a writable path.'
  RUN_ROOT=(${SUDO[@]+"${SUDO[@]}"} "--preserve-env=SWW_GITHUB_TOKEN,SWW_SKIP_PULL,SWW_BACKEND_IMAGE,SWW_FRONTEND_IMAGE,SWW_ALLINONE_IMAGE,SWW_HTTP_PORT,SWW_HTTPS_PORT,SWW_EDGE_PORT,SWW_BIND,SWW_CADDY_TLS,SWW_EDGE_SUBNET,COMPOSE_PROJECT_NAME")
fi
if [[ "$HOST_KIND" == linux && -d "$INSTALL_DIR" && "$(id -u)" != 0 && "$(stat -c %u "$INSTALL_DIR")" == 0 ]]; then
  RUN_ROOT=(sudo "--preserve-env=SWW_GITHUB_TOKEN,SWW_SKIP_PULL,SWW_BACKEND_IMAGE,SWW_FRONTEND_IMAGE,SWW_ALLINONE_IMAGE,SWW_HTTP_PORT,SWW_HTTPS_PORT,SWW_EDGE_PORT,SWW_BIND,SWW_CADDY_TLS,SWW_EDGE_SUBNET,COMPOSE_PROJECT_NAME")
fi
if ${RUN_ROOT[@]+"${RUN_ROOT[@]}"} test -f "$INSTALL_DIR/.spaceworks-workspace-version"; then
  ACTION="$(prompt 'Existing install: 1) update  2) review services  3) update then review services  4) cancel  5) deploy runner only [4]: ')"
  case "${ACTION:-4}" in
    1) ACTION=update ;; 2) ACTION=services ;; 3) ACTION=both ;;
    5) ${RUN_ROOT[@]+"${RUN_ROOT[@]}"} bash "$INSTALL_DIR/scripts/install-runner.sh"; exit 0 ;;
    *) say 'Cancelled; existing install unchanged.'; exit 0 ;;
  esac
elif [[ -d "$INSTALL_DIR" ]] && [[ -n "$(${RUN_ROOT[@]+"${RUN_ROOT[@]}"} find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  die 'Directory contains state without a version marker. Refusing to overwrite it.'
elif [[ -e "$INSTALL_DIR" && ! -d "$INSTALL_DIR" ]]; then die 'Installation path is not a directory.'
fi
fetch() {
  local url="$1" destination="${2:-}" token="${SWW_GITHUB_TOKEN:-}" accept="${3:-application/vnd.github+json}"
  [[ -z "$token" || "$token" =~ ^[A-Za-z0-9_]+$ ]] || die 'Invalid GitHub token format.'
  if command -v curl >/dev/null 2>&1; then
    local args=(--fail --silent --show-error --location --proto '=https' --proto-redir '=https' --retry 3 --connect-timeout 15 --max-time 600)
    [[ -z "$destination" ]] || args+=(-o "$destination")
    # Header config comes through stdin, never a token-bearing command argument.
    { printf 'header = "Accept: %s"\n' "$accept"; [[ -z "$token" ]] || printf 'header = "Authorization: Bearer %s"\n' "$token"; } | curl --config - "${args[@]}" "$url"
  else
    local output=-
    [[ -z "$destination" ]] || output="$destination"
    { printf 'header = Accept: %s\n' "$accept"; [[ -z "$token" ]] || printf 'header = Authorization: Bearer %s\n' "$token"; } | wget --config=/dev/stdin --https-only -qO "$output" "$url"
  fi
}
# The hidden dry-run flag uses local trusted questionnaire code and never mutates host state.
if [[ "${SWW_INSTALL_TEST_MODE:-0}" == 1 ]]; then
  [[ "$ACTION" == fresh ]] || die 'Dry run requires a fresh throwaway install path.'
  STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/.sww-install.XXXXXX")"
  source "${SWW_INSTALL_SOURCE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}/scripts/setup-questions.sh"
  SETUP_HOST_PLAN='dry run only; stop before dependencies, files, Docker or services change'
  ask_setup_questions || exit 0
  say 'Dry run confirmed. No host changes were made.'
  exit 0
fi
if [[ "$ACTION" == services ]]; then ${RUN_ROOT[@]+"${RUN_ROOT[@]}"} bash "$INSTALL_DIR/scripts/module-selection.sh"; exit 0; fi
if [[ -n "${SWW_INSTALL_LOCAL_BUNDLE:-}" ]]; then
  [[ "${SWW_ALLOW_LOCAL_IMAGES:-0}" == 1 ]] || die 'Local bundles require SWW_ALLOW_LOCAL_IMAGES=1.'
  STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/.sww-install.XXXXXX")"
  cp -a "$SWW_INSTALL_LOCAL_BUNDLE/." "$STAGE_DIR/"
  VERSION="$(tr -d '[:space:]' < "$STAGE_DIR/.bundle-version")"; TAG="v$VERSION"
else
say "Fetching pinned release metadata from $REPOSITORY."
release_json="$(fetch "https://api.github.com/repos/$REPOSITORY/releases/latest")" || die 'No published release. Run Continuous Release on main in your fork first.'
TAG="$(printf '%s\n' "$release_json" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
VERSION="${TAG#v}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+-main\.[0-9]+\.[0-9a-f]{12}$ ]] || die 'The release must have an immutable main version.'
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/.sww-install.XXXXXX")"
ARCHIVE="$(mktemp)"
# Runtime bundle only: no source checkout, dependency installation or build on the host.
asset="$(printf '%s\n' "$release_json" | sed -n 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"]*spaceworks-workspace-release.tar.gz\)".*/\1/p' | head -n 1)"
[[ "$asset" == "https://github.com/$REPOSITORY/releases/download/$TAG/spaceworks-workspace-release.tar.gz" ]] || die 'Pinned release bundle is missing.'
# GitHub's asset API supports private repositories; use the asset's id when authenticated.
if [[ -n "${SWW_GITHUB_TOKEN:-}" ]]; then
  asset_id="$(printf '%s\n' "$release_json" | awk '/"id":/ {id=$2; gsub(/,/,"",id)} /"name": "spaceworks-workspace-release.tar.gz"/ {print id; exit}')"
  [[ "$asset_id" =~ ^[0-9]+$ ]] || die 'Release asset id is missing.'
  fetch "https://api.github.com/repos/$REPOSITORY/releases/assets/$asset_id" "$ARCHIVE" application/octet-stream
else fetch "$asset" "$ARCHIVE"; fi
# Archive paths are checked before extraction, including symlinks and hardlinks.
tar -tzf "$ARCHIVE" | awk '/(^\/|(^|\/)\.\.($|\/))/ {bad=1} END {exit bad}' || die 'Unsafe bundle paths.'
if tar -tvzf "$ARCHIVE" | awk 'substr($0,1,1) ~ /[lh]/ {bad=1} END {exit !bad}'; then die 'Bundle cannot contain links.'; fi
tar -xzf "$ARCHIVE" -C "$STAGE_DIR" --no-same-owner
[[ -f "$STAGE_DIR/setup.sh" && -f "$STAGE_DIR/scripts/update.sh" && -f "$STAGE_DIR/bundle-files.txt" ]] || die 'Incomplete runtime bundle.'
fi
[[ -f "$STAGE_DIR/.bundle-version" && "$(tr -d '[:space:]' < "$STAGE_DIR/.bundle-version")" == "$VERSION" ]] || die 'Runtime bundle does not match the pinned image version.'
if [[ "$ACTION" == fresh ]]; then
  source "$STAGE_DIR/scripts/setup-questions.sh"
  SETUP_HOST_PLAN="ensure Docker/Compose ($PACKAGE_FAMILY), install $TAG into $INSTALL_DIR, private settings and internal TLS, pull images, migrations, health, optional runner and backup schedule"
  ask_setup_questions || exit 0
  ports=("${SWW_EDGE_PORT:-8080}")
  if [[ "$HTTPS_MODE" == 1 ]]; then ports=("${SWW_HTTP_PORT:-80}" "${SWW_HTTPS_PORT:-443}"); fi
  port_in_use() {
    local port="$1" hex file
    if [[ "$HOST_KIND" == linux ]]; then
      printf -v hex '%04X' "$port"
      for file in /proc/net/tcp /proc/net/tcp6; do
        [[ ! -r "$file" ]] || awk -v wanted="$hex" 'NR>1 {split($2,a,":"); if(toupper(a[2])==wanted && $4=="0A") exit 7}' "$file" || return 0
      done
      return 1
    fi
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  }
  for port in "${ports[@]}"; do port_in_use "$port" && die "TCP port $port is in use."; done
  persist_setup_answers "$STAGE_DIR/.sww-answers"
fi
if [[ "$HOST_KIND" == linux ]]; then
  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
    ${SUDO[@]+"${SUDO[@]}"} bash "$STAGE_DIR/scripts/install-docker.sh"
  elif ! docker info >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1; then
    ${SUDO[@]+"${SUDO[@]}"} systemctl enable --now docker
  fi
fi
if ! docker info >/dev/null 2>&1; then
  [[ "$HOST_KIND" == linux && ${#SUDO[@]} -gt 0 ]] || die 'Docker is inaccessible.'
  ${SUDO[@]+"${SUDO[@]}"} docker info >/dev/null 2>&1 || die 'Docker is inaccessible even with sudo.'
  ${SUDO[@]+"${SUDO[@]}"} usermod -aG docker "$(id -un)"
  command -v sg >/dev/null 2>&1 || die 'Sign out and back in to refresh Docker group access, then rerun.'
  sg docker -c 'docker info >/dev/null 2>&1' || die 'Docker group access is unavailable. Sign out and back in, then rerun.'
  USE_DOCKER_GROUP=1
fi
docker compose version >/dev/null 2>&1 || ${RUN_ROOT[@]+"${RUN_ROOT[@]}"} docker compose version >/dev/null 2>&1 || die 'Compose V2 is required.'
if [[ "$ACTION" != fresh ]]; then
  SWW_INSTALL_DIR="$INSTALL_DIR" SWW_REPOSITORY="$REPOSITORY" bash "$STAGE_DIR/scripts/update.sh" --version "$VERSION" --staged-bundle "$STAGE_DIR"
  [[ "$ACTION" != both ]] || ${RUN_ROOT[@]+"${RUN_ROOT[@]}"} bash "$INSTALL_DIR/scripts/module-selection.sh"
  exit 0
fi
${RUN_ROOT[@]+"${RUN_ROOT[@]}"} mkdir -p -- "$INSTALL_DIR"
${RUN_ROOT[@]+"${RUN_ROOT[@]}"} chmod 700 "$INSTALL_DIR"
${RUN_ROOT[@]+"${RUN_ROOT[@]}"} cp -a "$STAGE_DIR/." "$INSTALL_DIR/"
if [[ "$(id -u)" != 0 && ${#RUN_ROOT[@]} -gt 0 ]]; then
  ${RUN_ROOT[@]+"${RUN_ROOT[@]}"} chown -R "$(id -u):$(id -g)" "$INSTALL_DIR"
fi
export SWW_REPOSITORY="$REPOSITORY" SWW_IMAGE_TAG="$VERSION"
if [[ "$USE_DOCKER_GROUP" == 1 ]]; then
  sg docker -c "cd '$INSTALL_DIR' && bash setup.sh"
else
  bash "$INSTALL_DIR/setup.sh"
fi
say "Installed $VERSION in $INSTALL_DIR."
