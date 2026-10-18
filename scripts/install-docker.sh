#!/usr/bin/env bash
# Installs Docker Engine and the Compose plugin from Docker's official apt
# repository on Ubuntu or Debian. Called by scripts/setup-vps.sh only after
# the operator agreed; other systems need Docker installed by hand.
set -euo pipefail
[[ $(id -u) = 0 ]] || { echo 'Installing Docker requires root. Run the installer with sudo.' >&2; exit 1; }
[[ $(uname -s) = Linux && -f /etc/os-release ]] || { echo 'Automatic Docker installation supports Ubuntu and Debian only.' >&2; exit 1; }
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) echo 'Install Docker Engine and Compose with your distribution instructions, then rerun setup.' >&2; exit 1 ;;
esac
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl --fail --show-error --silent --location --proto '=https' "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
architecture=$(dpkg --print-architecture)
codename=${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}
[[ -n "$codename" ]] || { echo 'Could not determine the distribution codename.' >&2; exit 1; }
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
  "$architecture" "$ID" "$codename" > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker compose version
