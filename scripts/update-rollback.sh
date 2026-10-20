#!/usr/bin/env bash
# Forward migrations stay applied. Only application images and host tooling roll back.
rollback_application_images() {
  [[ -n "$previous_version" ]] || return 1
  warn "Deployment failed. Returning application images to $previous_version."
  if [[ -n "${HOST_CONFIG_BACKUP_DIR:-}" ]]; then cp -a "$HOST_CONFIG_BACKUP_DIR/." "$ROOT/"; fi
  export SWW_IMAGE_TAG="$previous_version"
  python3 "$ROOT/scripts/set-install-value.py" "$ROOT/.env" SWW_IMAGE_TAG "$previous_version" || return 1
  printf '%s\n' "$previous_version" > "$ROOT/.spaceworks-workspace-version" || return 1
  if ! "${COMPOSE[@]}" up -d --no-deps --force-recreate "${APP_SERVICES[@]}" || ! wait_for_backend; then
    warn 'Automatic image rollback failed. Keep the backup and inspect the offline recovery guide.'; return 1;
  fi
  say 'Previous images are healthy. Forward schema changes remain; the backup was not restored.'
}
