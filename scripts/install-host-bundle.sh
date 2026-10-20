#!/usr/bin/env bash
# Replace a closed runtime file list, preserving every overwritten path for rollback.
install_staged_host_bundle() {
  local source_root="$1" relative
  HOST_CONFIG_BACKUP_DIR="$ROOT/backups/host-config-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  while IFS= read -r relative; do
    [[ "$relative" != /* && "$relative" != *..* && -f "$source_root/$relative" && ! -L "$source_root/$relative" ]] || die 'Invalid runtime bundle manifest.'
    case "$relative" in config/*|.env|backups/*|.sww-*) die 'Private state cannot be in the runtime bundle.' ;; esac
  done < "$source_root/bundle-files.txt"
  while IFS= read -r relative; do
    mkdir -p "$(dirname "$ROOT/$relative")" "$(dirname "$HOST_CONFIG_BACKUP_DIR/$relative")"
    [[ ! -f "$ROOT/$relative" ]] || cp -p "$ROOT/$relative" "$HOST_CONFIG_BACKUP_DIR/$relative"
    cp -p "$source_root/$relative" "$ROOT/$relative.new"
    mv -f -- "$ROOT/$relative.new" "$ROOT/$relative"
  done < "$source_root/bundle-files.txt"
}
