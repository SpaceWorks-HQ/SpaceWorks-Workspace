#!/usr/bin/env bash
# Invoked by the confirmed VPS setup only: install and start Docker Engine with
# the Compose v2 plugin from the distribution family's supported source.
set -euo pipefail
[[ $(id -u) = 0 ]] || { echo 'Installing Docker requires root.' >&2; exit 1; }
[[ $(uname -s) = Linux && -r /etc/os-release ]] || { echo 'Automatic Docker installation needs Linux with /etc/os-release.' >&2; exit 1; }
# shellcheck disable=SC1091
. /etc/os-release
family=" ${ID:-} ${ID_LIKE:-} "
case "$family" in
  *" ubuntu "*|*" debian "*)
    # Docker publishes repositories for Debian and Ubuntu; derivatives use their base.
    repo_id=debian codename=${VERSION_CODENAME:-}
    if [[ "$family" = *" ubuntu "* ]]; then repo_id=ubuntu codename=${UBUNTU_CODENAME:-$codename}; fi
    [[ -n "$codename" ]] || { echo 'Cannot determine the release codename for the Docker repository.' >&2; exit 1; }
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y ca-certificates curl
    install -m 0755 -d /etc/apt/keyrings
    curl --fail --show-error --silent --location --proto '=https' "https://download.docker.com/linux/$repo_id/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
      "$(dpkg --print-architecture)" "$repo_id" "$codename" > /etc/apt/sources.list.d/docker.list
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    ;;
  *" fedora "*|*" rhel "*|*" centos "*|*" rocky "*|*" almalinux "*)
    repo_os=centos
    [[ "${ID:-}" = fedora ]] && repo_os=fedora
    [[ "${ID:-}" = rhel ]] && repo_os=rhel
    repo_url="https://download.docker.com/linux/$repo_os/docker-ce.repo"
    if command -v dnf >/dev/null; then
      dnf install -y dnf-plugins-core
      dnf config-manager --add-repo "$repo_url" 2>/dev/null || dnf config-manager addrepo --from-repofile="$repo_url"
      dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    else
      yum install -y yum-utils
      yum-config-manager --add-repo "$repo_url"
      yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    fi
    ;;
  *" arch "*|*" manjaro "*)
    # Arch supports only full upgrades, never a partial -Sy.
    pacman -Syu --noconfirm --needed docker docker-compose docker-buildx
    ;;
  *" suse "*|*" opensuse "*|*" sles "*)
    zypper --non-interactive install docker docker-compose docker-buildx
    ;;
  *)
    echo "Automatic Docker installation does not support '${ID:-unknown}'. Install Docker Engine with the Compose v2 plugin, then rerun." >&2
    exit 1
    ;;
esac
systemctl enable --now docker
docker compose version
