#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
compose=(docker compose -f docker-compose.yml -f docker-compose.dev.yml)
case "${1:-help}" in
  up) shift; "${compose[@]}" up -d "$@" ;;
  down) shift; "${compose[@]}" down "$@" ;;
  test) shift; "${compose[@]}" exec -T dev npm run test:unit -- "$@" ;;
  logs|ps|exec|run|restart) "${compose[@]}" "$@" ;;
  *) echo 'Usage: scripts/dev.sh up|down|test|logs|ps|exec|run|restart [arguments]' ;;
esac
