#!/usr/bin/env bash
# Shared terminal input. Test input is accepted only with explicit test mode.
rand_key() { openssl rand -hex 32; }
question() {
  local key="$1" label="$2" default="$3" rule="${4:-text}" value hint
  while true; do
    hint="${default:-required}"
    [[ "$rule" != optional && "$rule" != secret ]] || hint=skip
    printf '%s [%s]: ' "$label" "$hint"
    if [[ "$rule" == secret && "${SWW_INSTALL_TEST_MODE:-0}" != 1 ]]; then
      IFS= read -r -s -u 3 value || return 1
      printf '\n'
    else
      IFS= read -r -u 3 value || return 1
    fi
    value="${value%$'\r'}"; value="${value:-$default}"
    [[ "$value" != *$'\r'* && "$value" != *$'\n'* ]] || { echo 'Use one line.'; continue; }
    case "$rule" in
      choices:*) [[ ",${rule#choices:}," == *",$value,"* ]] || { echo 'Choose a listed option.'; continue; } ;;
      host) [[ "$value" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$ && "$value" != *..* ]] || { echo 'Use a hostname or IPv4 address without a scheme, port or path.'; continue; } ;;
      cidr) [[ "$value" =~ ^[0-9a-fA-F.:]+/[0-9]{1,3}$ ]] || { echo 'Use the frontend host address as a CIDR, for example 203.0.113.20/32.'; continue; } ;;
      email) [[ "$value" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || { echo 'Enter an email address.'; continue; } ;;
      repository) [[ "$value" =~ ^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] || { echo 'Enter a GitHub owner/repo name.'; continue; } ;;
      https) [[ "$value" =~ ^https://[^[:space:]\'\"\`\$]+$ ]] || { echo 'Use an HTTPS URL.'; continue; } ;;
      postgres) [[ "$value" == postgres://* || "$value" == postgresql://* ]] && [[ "$value" == *sslmode=* ]] || { echo 'Use a PostgreSQL URL with sslmode=require or stronger.'; continue; } ;;
      redis) [[ "$value" == rediss://* ]] || { echo 'Use a rediss:// URL.'; continue; } ;;
      port) if [[ ! "$value" =~ ^[0-9]{1,5}$ ]] || ((10#$value < 1 || 10#$value > 65535)); then echo 'Use a port from 1 to 65535.'; continue; fi ;;
      bucket) [[ "$value" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ && "$value" != *..* ]] || { echo 'Use a valid S3 bucket name.'; continue; } ;;
      text) [[ -n "$value" ]] || { echo 'A value is required.'; continue; } ;;
    esac
    printf -v "$key" '%s' "$value"
    return 0
  done
}
SETUP_ANSWER_KEYS=(HOSTING_MODEL SPLIT_ROLE BACKEND_UPSTREAM WEBHOST HTTPS_MODE TLS_EMAIL TLS_HOST FRONTEND_CIDR SHAPE
  DATABASE DIRECT_DATABASE RUNTIME_DATABASE REDIS EXTERNAL_REDIS STORAGE S3_ENDPOINT S3_REGION S3_BUCKET
  S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_FORCE_PATH_STYLE SMTP SMTP_HOST SMTP_PORT SMTP_SECURE
  SMTP_USER SMTP_PASSWORD EMAIL_FROM ADMINEMAIL ANTHROPIC_API_KEY AUTH_GOOGLE_ID AUTH_GOOGLE_SECRET
  SWW_REPOSITORY INSTALL_RUNNER INSTALL_BACKUP_TIMER ANSWERS_CONFIRMED)
persist_setup_answers() {
  local key
  (umask 077; set -o noclobber; : > "$1") || return 1
  for key in "${SETUP_ANSWER_KEYS[@]}"; do printf '%s=%q\n' "$key" "${!key:-}" >> "$1"; done
  chmod 600 "$1"
}
load_setup_answers() {
  [[ -f "$1" && ! -L "$1" && -O "$1" ]] || { echo 'Answers must belong to the install owner.' >&2; return 1; }
  local mode
  mode="$(stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1")"
  [[ "$mode" == 600 ]] || { echo 'Answers must have mode 600.' >&2; return 1; }
  # This is the owner-only, %q-encoded transport created by the questionnaire.
  # shellcheck disable=SC1090
  source "$1"
  [[ "${ANSWERS_CONFIRMED:-}" == yes ]]
}
