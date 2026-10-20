#!/usr/bin/env bash
# Gather the complete deployment before pulling images or changing the host.
# Answers are exported dynamically by setup-write-environment.sh.
# shellcheck disable=SC2034
# shellcheck source=scripts/setup-question-input.sh
source "$(dirname "${BASH_SOURCE[0]}")/setup-question-input.sh"
ask_setup_questions() {
  if [[ "${SWW_INSTALL_TEST_MODE:-0}" == 1 || -n "${SWW_INSTALL_LOCAL_BUNDLE:-}" ]]; then
    exec 3<"${SWW_INSTALL_INPUT_FILE:?Set SWW_INSTALL_INPUT_FILE for the dry run}"
  else
    exec 3</dev/tty
  fi
  echo 'Space Works Workspace deployment. Enter accepts the displayed default.'
  echo 'Hosting: 1) this server  2) frontend and backend on different hosts  3) cloud services'
  question HOSTING_MODEL 'Hosting model' 1 choices:1,2,3 || return 1
  SPLIT_ROLE=backend; BACKEND_UPSTREAM=http://backend:3000
  if [[ "$HOSTING_MODEL" == 2 ]]; then
    echo 'This host: 1) backend  2) frontend'
    question SPLIT_ROLE 'Host role' 1 choices:1,2 || return 1
    [[ "$SPLIT_ROLE" != 1 ]] && SPLIT_ROLE=frontend || SPLIT_ROLE=backend
    if [[ "$SPLIT_ROLE" == frontend ]]; then
      question BACKEND_UPSTREAM 'Backend HTTPS origin (all pages and actions are proxied)' '' https || return 1
    fi
  fi
  question WEBHOST 'Website hostname or IP (no scheme, port or path)' localhost host || return 1
  TLS_HOST="$WEBHOST"; FRONTEND_CIDR=127.0.0.1/32
  if [[ "$HOSTING_MODEL" == 2 && "$SPLIT_ROLE" == backend ]]; then
    question TLS_HOST 'Backend origin hostname (separate DNS name for the frontend-to-backend TLS connection)' '' host || return 1
    question FRONTEND_CIDR 'Trusted frontend outbound IP/CIDR (only this host may forward website identity/client headers)' '' cidr || return 1
  fi
  echo 'HTTPS: 1) automatic Caddy TLS  2) existing reverse proxy  3) HTTP only'
  while true; do
    question HTTPS_MODE 'HTTPS' 1 choices:1,2,3 || return 1
    [[ "$HTTPS_MODE" != 3 ]] && break
    echo 'The production app requires HTTPS for sessions. Use automatic TLS or an existing HTTPS proxy.'
  done
  TLS_EMAIL=''
  [[ "$HTTPS_MODE" != 1 ]] || question TLS_EMAIL 'Certificate email' '' email || return 1
  echo 'Shape: 1) separate frontend and backend  2) all-in-one application container'
  while true; do
    question SHAPE 'Shape' 1 choices:1,2 || return 1
    [[ "$HOSTING_MODEL" != 2 || "$SHAPE" == 1 ]] && break
    echo 'Split hosts use separate containers.'
  done
  DATABASE=bundled; REDIS=bundled; STORAGE=bundled; DIRECT_DATABASE=''; RUNTIME_DATABASE=''; EXTERNAL_REDIS=''
  S3_ENDPOINT=''; S3_REGION=us-east-1; S3_BUCKET=spaceworks-workspace
  S3_ACCESS_KEY_ID=''; S3_SECRET_ACCESS_KEY=''; S3_FORCE_PATH_STYLE=1
  SMTP=skip; SMTP_HOST=''; SMTP_PORT=587; SMTP_SECURE=false; SMTP_USER=''; SMTP_PASSWORD=''; EMAIL_FROM=''
  ADMINEMAIL=''; ANTHROPIC_API_KEY=''; AUTH_GOOGLE_ID=''; AUTH_GOOGLE_SECRET=''
  if [[ "$SPLIT_ROLE" != frontend ]]; then
    echo 'Database: 1) bundled PostgreSQL  2) external (DigitalOcean, RDS, Supabase)'
    question DATABASE 'Database' "$([[ "$HOSTING_MODEL" == 3 ]] && echo 2 || echo 1)" choices:1,2 || return 1
    [[ "$DATABASE" != 1 ]] && DATABASE=external || DATABASE=bundled
    if [[ "$DATABASE" == external ]]; then
      question RUNTIME_DATABASE 'Runtime URL (a restricted app role; TLS required)' '' postgres || return 1
      question DIRECT_DATABASE 'Migration URL (database owner; direct or session pooler)' '' postgres || return 1
    fi
    echo 'Redis: 1) bundled  2) external (Upstash, ElastiCache, DigitalOcean Valkey)'
    question REDIS 'Redis' "$([[ "$HOSTING_MODEL" == 3 ]] && echo 2 || echo 1)" choices:1,2 || return 1
    [[ "$REDIS" != 1 ]] && REDIS=external || REDIS=bundled
    [[ "$REDIS" != external ]] || question EXTERNAL_REDIS 'Redis TLS URL' '' redis || return 1
    echo 'Storage: 1) bundled private Silo  2) external S3 (R2, Spaces, AWS S3)'
    question STORAGE 'Storage' "$([[ "$HOSTING_MODEL" == 3 ]] && echo 2 || echo 1)" choices:1,2 || return 1
    [[ "$STORAGE" != 1 ]] && STORAGE=external || STORAGE=bundled
    if [[ "$STORAGE" == external ]]; then
      question S3_ENDPOINT 'S3 HTTPS endpoint' '' https || return 1
      question S3_REGION 'S3 region (auto for R2)' auto text || return 1
      question S3_BUCKET 'Private bucket' spaceworks-workspace bucket || return 1
      question S3_ACCESS_KEY_ID 'S3 access key' '' text || return 1
      while [[ -z "$S3_SECRET_ACCESS_KEY" ]]; do question S3_SECRET_ACCESS_KEY 'S3 secret key' '' secret || return 1; done
      question S3_FORCE_PATH_STYLE 'Path-style S3 addressing (1=yes, 0=no)' 1 choices:0,1 || return 1
    fi
    question SMTP 'Email: SMTP or skip (configure in /admin later)' skip choices:smtp,skip || return 1
    if [[ "$SMTP" == smtp ]]; then
      question SMTP_HOST 'SMTP host' '' host || return 1
      question SMTP_PORT 'SMTP port' 587 port || return 1
      question SMTP_SECURE 'Implicit TLS (true for port 465)' false choices:true,false || return 1
      question SMTP_USER 'SMTP username' '' text || return 1
      while [[ -z "$SMTP_PASSWORD" ]]; do question SMTP_PASSWORD 'SMTP password' '' secret || return 1; done
      question EMAIL_FROM 'Sender (for example Space Works <workspace@example.org>)' '' text || return 1
    fi
    question ADMINEMAIL 'Instance owner email (/setup finishes account creation)' '' email || return 1
    question ANTHROPIC_API_KEY 'Optional assistant API key' '' secret || return 1
    question AUTH_GOOGLE_ID 'Optional Google OAuth client ID' '' optional || return 1
    if [[ -n "$AUTH_GOOGLE_ID" ]]; then
      while [[ -z "$AUTH_GOOGLE_SECRET" ]]; do question AUTH_GOOGLE_SECRET 'Google OAuth client secret' '' secret || return 1; done
    fi
  fi
  if [[ "${SWW_INSTALL_REPOSITORY_PINNED:-0}" != 1 ]]; then
    question SWW_REPOSITORY 'GitHub repository for updates' "${SWW_REPOSITORY:-SpaceWorks-HQ/SpaceWorks-Workspace}" repository || return 1
  fi
  INSTALL_RUNNER=N; INSTALL_BACKUP_TIMER=N
  question INSTALL_RUNNER 'Install optional GitHub Actions deploy runner (Linux/systemd only)?' N choices:Y,y,N,n || return 1
  if [[ "$SPLIT_ROLE" != frontend ]]; then
    question INSTALL_BACKUP_TIMER 'Install daily backup timer/cron?' Y choices:Y,y,N,n || return 1
  fi
  setup_summary
  local proceed
  question proceed 'Proceed?' N choices:Y,y,N,n || return 1
  exec 3<&-
  [[ "$proceed" =~ ^[Yy] ]] || { echo 'Cancelled. Nothing was installed or configured.'; return 1; }
  ANSWERS_CONFIRMED=yes
}
setup_summary() {
  echo
  echo 'Deployment summary'
  printf '  Host: %s; hosting model: %s; role: %s; HTTPS: %s; shape: %s\n' "$WEBHOST" "$HOSTING_MODEL" "$SPLIT_ROLE" "$HTTPS_MODE" "$SHAPE"
  printf '  Database: %s; Redis: %s; private storage: %s; email: %s\n' "$DATABASE" "$REDIS" "$STORAGE" "$SMTP"
  printf '  Owner: %s; repository: %s; runner: %s; backup timer: %s\n' "${ADMINEMAIL:-on backend host}" "$SWW_REPOSITORY" "$INSTALL_RUNNER" "$INSTALL_BACKUP_TIMER"
  echo '  Credentials and optional keys: hidden. No demo data is created.'
  echo '  migrate applies the database schema once. It must succeed before the app starts.'
  local services='frontend'
  if [[ "$SPLIT_ROLE" != frontend ]]; then
    services='migrate'
    [[ "$DATABASE" != bundled ]] || services+=', postgres'
    [[ "$REDIS" != bundled ]] || services+=', redis'
    [[ "$STORAGE" != bundled ]] || services+=', silo, silo-init'
    if [[ "$SHAPE" == 2 ]]; then services+=', app (nginx, Next.js, scheduler)'
    elif [[ "$HOSTING_MODEL" == 2 ]]; then services+=', backend, scheduler, api-edge'
    else services+=', backend, scheduler, frontend'; fi
  fi
  [[ "$HTTPS_MODE" != 1 ]] || services+=', caddy'
  echo "  Services: $services."
  echo "  TLS listener: $TLS_HOST; trusted split frontend: $FRONTEND_CIDR."
  echo '  Only the edge publishes ports. All workspace files remain private.'
  echo "  Host actions: ${SETUP_HOST_PLAN:-write private settings, pull pinned images, generate internal TLS, migrate, start, check readiness, optional backup timer and runner}."
  echo "  Finish owner creation at https://$WEBHOST/setup after startup."
}
