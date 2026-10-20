#!/usr/bin/env bash
# Minimal hosts reuse the published backend's Python instead of installing host tooling.
if ! command -v python3 >/dev/null 2>&1; then
  python3() {
    local argument
    local mounts=(-v "$ROOT:$ROOT" -v /tmp:/tmp)
    if [[ "${TMPDIR:-/tmp}" != /tmp ]]; then mounts+=(-v "$TMPDIR:$TMPDIR"); fi
    for argument in "$@"; do
      if [[ "$argument" == /* && -f "$argument" && "$argument" != "$ROOT/"* && "$argument" != /tmp/* && "$argument" != "${TMPDIR:-/tmp}/"* ]]; then
        mounts+=(-v "$argument:$argument:ro")
      fi
    done
    docker run --rm -i --network none --read-only --user "$(id -u):$(id -g)" \
      --entrypoint python3 "${mounts[@]}" -w "$PWD" \
      "$SWW_BACKEND_IMAGE:${SWW_IMAGE_TAG:-$(repository_env_value SWW_IMAGE_TAG)}" "$@"
  }
fi
