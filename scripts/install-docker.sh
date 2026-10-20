#!/usr/bin/env bash
# Dependency setup invoked only after the installer's confirmation boundary.
set -euo pipefail
[[ "$(id -u)" == 0 && "$(uname -s)" == Linux ]] || { echo 'Linux dependency installation requires root.' >&2; exit 1; }
# shellcheck disable=SC1091
source /etc/os-release
missing_docker=0; missing_compose=0
command -v docker >/dev/null 2>&1 || missing_docker=1
docker compose version >/dev/null 2>&1 || missing_compose=1
case " ${ID:-} ${ID_LIKE:-} " in
  *' debian '*|*' ubuntu '*|*' linuxmint '*)
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl tar python3 openssl
    if [[ "$missing_docker" == 1 ]]; then DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io; fi
    if [[ "$missing_compose" == 1 ]]; then
      DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-v2 \
        || DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin || true
    fi ;;
  *' fedora '*|*' rhel '*|*' centos '*|*' rocky '*|*' almalinux '*)
    manager=dnf; command -v dnf >/dev/null 2>&1 || manager=yum
    "$manager" install -y ca-certificates curl tar python3 openssl
    if [[ "$missing_docker" == 1 ]]; then
      repo_os=centos; [[ "${ID:-}" != fedora ]] || repo_os=fedora; [[ "${ID:-}" != rhel ]] || repo_os=rhel
      "$manager" install -y dnf-plugins-core
      dnf config-manager --add-repo "https://download.docker.com/linux/$repo_os/docker-ce.repo" \
        || dnf config-manager addrepo --from-repofile="https://download.docker.com/linux/$repo_os/docker-ce.repo"
      "$manager" install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    elif [[ "$missing_compose" == 1 ]]; then "$manager" install -y docker-compose-plugin || true; fi ;;
  *' arch '*|*' manjaro '*) pacman -S --noconfirm --needed curl tar docker docker-compose python openssl ;;
  *' suse '*|*' opensuse '*|*' sles '*) zypper --non-interactive install curl tar docker docker-compose python3 openssl ;;
  *) echo 'Unsupported Linux distribution.' >&2; exit 1 ;;
esac
if ! docker compose version >/dev/null 2>&1; then
  # Official standalone CLI plugin; verify the official release checksum before installing.
  case "$(uname -m)" in x86_64|amd64) arch=x86_64 ;; aarch64|arm64) arch=aarch64 ;; *) exit 64 ;; esac
  tag="$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Could not resolve Compose release.' >&2; exit 1; }
  work="$(mktemp -d)"; trap 'rm -rf -- "$work"' EXIT
  name="docker-compose-linux-$arch"
  curl -fsSL --proto '=https' --proto-redir '=https' "https://github.com/docker/compose/releases/download/$tag/$name" -o "$work/$name"
  curl -fsSL --proto '=https' --proto-redir '=https' "https://github.com/docker/compose/releases/download/$tag/checksums.txt" -o "$work/checksums.txt"
  (cd "$work"; awk -v name="$name" '$2==name || $2=="*"name {print}' checksums.txt > selected.sha256; test -s selected.sha256; sha256sum -c selected.sha256)
  install -D -m 755 "$work/$name" /usr/local/lib/docker/cli-plugins/docker-compose
fi
if command -v systemctl >/dev/null 2>&1; then systemctl enable --now docker; fi
docker compose version
