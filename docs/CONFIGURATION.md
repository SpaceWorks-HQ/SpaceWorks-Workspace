# Installation configuration

The guided installer writes `.env` for non-secret deployment selectors and `config/*.env` for runtime secrets. Never source dotenv files in a shell. Use the wrapper to preserve topology across upgrades. App settings follow below.

| Variable | Default / meaning |
| --- | --- |
| `SPACEWORKS_WORKSPACE_DIR` | `/opt/spaceworks-workspace`, bootstrap directory |
| `SWW_INSTALL_DIR` | Installed directory for operator tools; normally derived automatically |
| `SWW_REPOSITORY` | `SpaceWorks-HQ/SpaceWorks-Workspace`; `--repo` overrides at bootstrap |
| `SWW_GITHUB_TOKEN` | Optional private-repository/package read token; never saved by setup |
| `SWW_BACKEND_IMAGE` | `ghcr.io/<lowercase-owner>/spaceworks-workspace-backend` |
| `SWW_FRONTEND_IMAGE` | Matching frontend package |
| `SWW_ALLINONE_IMAGE` | Matching all-in-one package |
| `SWW_IMAGE_TAG` | Immutable installed main version; latest for a clone unless supplied |
| `COMPOSE_PROJECT_NAME` | `spaceworks-workspace`; use a unique value for isolated stacks |
| `SWW_HOSTING_MODEL` | `1` this server, `2` split, `3` cloud defaults |
| `SWW_HOST_ROLE` | `backend` or `frontend` |
| `SWW_SHAPE` | `separate` or `single` |
| `SWW_DATABASE`, `SWW_REDIS`, `SWW_STORAGE` | Each `bundled` or `external` |
| `SWW_HTTPS` | `auto` Caddy or `proxy` existing HTTPS edge |
| `SWW_TLS_HOST` | TLS listener hostname; split backend uses its distinct backend origin |
| `SWW_FRONTEND_CIDR` | Trusted split frontend outbound IP/CIDR; defaults to local-only |
| `SWW_PUBLIC_HOST` | Website hostname/IP, no scheme/path |
| `SWW_TLS_EMAIL` | ACME account contact |
| `SWW_BIND` | `0.0.0.0` for Caddy, `127.0.0.1` for an existing proxy |
| `SWW_EDGE_PORT` | Existing-proxy HTTP upstream port, 8080 |
| `SWW_HTTP_PORT`, `SWW_HTTPS_PORT` | Caddy ports, 80 / 443 |
| `SWW_CADDY_TLS` | `acme`; `internal` for isolated test installations |
| `SWW_EDGE_UPSTREAM` | Selected internal nginx service: frontend/app/api-edge on 8080 |
| `SWW_EDGE_SUBNET` | `172.30.80.0/24`; change for conflicting private networks |
| `SWW_TRUSTED_PROXY_CIDR` | Source CIDR whose forwarding headers nginx trusts; default edge subnet |
| `SWW_TRUST_FORWARDED_PROTO` | nginx entrypoint: 1 only behind a trusted TLS boundary |
| `BACKEND_UPSTREAM` | nginx backend origin, default `http://backend:3000`; HTTPS for split hosts |
| `SWW_SCHEDULER_ENABLED` | All-in-one scheduler: 1; set 0 only with another scheduler |
| `SWW_HEALTH_ORIGIN` | Internal container health URL; all-in-one sets localhost:8080 |
| `SWW_BACKUP_KEEP_DAYS` | 14, positive retention days |
| `SWW_RUNNER_DIR` | `/opt/spaceworks-workspace-runner` |
| `SWW_DEPLOY` | Repository Actions variable; `true` opts into the deploy runner job |
| `SWW_STATIC_ENV_FILE` | Helper read path; wrapper uses the installed .env |
| `SWW_COMPOSE_BUILD` | 1 enables explicit source-build overlay |
| `SWW_SKIP_PULL` | 1 keeps already-loaded local images; intended for the local smoke harness |
| `SWW_INSTALL_TEST_MODE` | Hidden dry-run flag: 1 reads answers and stops before host changes |
| `SWW_INSTALL_INPUT_FILE` | Dry-run/local-smoke prompt input file, private when it holds credentials |
| `SWW_INSTALL_SOURCE_DIR` | Dry-run questionnaire source directory |
| `SWW_INSTALL_LOCAL_BUNDLE` | Local smoke runtime bundle path |
| `SWW_ALLOW_LOCAL_IMAGES` | Must be 1 to opt into a local bundle |
| `SWW_OPERATION_PARENT_PID` | Internal lock inheritance for a child safety backup; not an operator setting |
| `SWW_DEV_DB_PORT`, `SWW_DEV_REDIS_PORT` | Local services 5440 / 6395 |
| `SWW_DEV_STORAGE_PORT`, `SWW_DEV_STORAGE_CONSOLE_PORT` | Local Silo 9010 / 9011 |
| `SWW_DEV_APP_PORT` | Containerised development HTTP port, 3000 |

## Generated private settings

`config/app.env` holds runtime app variables. `config/migrate.env` holds only migration/database-owner URLs and CA trust. `config/postgres.env` holds POSTGRES_USER/DB/PASSWORD and the separate POSTGRES_APP_PASSWORD; `config/storage.env` holds the Silo root credentials. `config/storage-init.env` holds the private initializer identity and bucket-scoped app password. `config/scheduler.env` holds APP_URL and CRON_SECRET only. TLS files live under config/tls and are never part of an image or release bundle.

Set externally managed connection credentials in these private files. Supply DATABASE_URL/DIRECT_URL with required TLS, REDIS_URL with rediss, and S3_ENDPOINT with HTTPS. The production public origin must be HTTPS. The installer generates AUTH_SECRET, MFA_ENCRYPTION_KEY, INTEGRATION_ENCRYPTION_KEY, VAULT_MASTER_KEY, CRON_SECRET, HEALTHCHECK_SECRET and NEXT_SERVER_ACTIONS_ENCRYPTION_KEY independently. Public origin is read at runtime; no secret/public origin is required to build an image.

## Application environment reference

The app reads these runtime variables from .env.example. Optional integration settings can also be stored in the instance settings screens. Production validation is defined in lib/env.ts and scripts/check-production-env.mjs. Do not relax it to make an incomplete deployment start.

| Variable | Example/default (non-secret) |
| --- | --- |
| `DATABASE_URL` | `postgresql://sww:sww_dev_password@127.0.0.1:5440/sww_dev` |
| `DIRECT_URL` | `` |
| `TEST_DATABASE_URL` | `postgresql://sww:sww_dev_password@127.0.0.1:5440/sww_dev_test` |
| `AUTH_SECRET` | generated/private |
| `AUTH_URL` | `http://localhost:3000` |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:3000` |
| `AUTH_GOOGLE_ID` | `` |
| `AUTH_GOOGLE_SECRET` | generated/private |
| `SUPER_ADMIN_EMAIL` | `owner@example.org` |
| `MFA_ENCRYPTION_KEY` | generated/private |
| `INTEGRATION_ENCRYPTION_KEY` | generated/private |
| `VAULT_MASTER_KEY` | generated/private |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | generated/private |
| `CRON_SECRET` | generated/private |
| `HEALTHCHECK_SECRET` | generated/private |
| `REDIS_URL` | `redis://127.0.0.1:6395/0` |
| `S3_BUCKET` | `sww-dev` |
| `S3_REGION` | `us-east-1` |
| `S3_ENDPOINT` | `http://127.0.0.1:9010` |
| `S3_ACCESS_KEY_ID` | generated/private |
| `S3_SECRET_ACCESS_KEY` | generated/private |
| `S3_FORCE_PATH_STYLE` | `1` |
| `UPLOAD_MAX_BYTES` | `` |
| `EMAIL_FROM` | `Space Works <workspace@localhost>` |
| `SMTP_HOST` | `127.0.0.1` |
| `SMTP_PORT` | `1025` |
| `SMTP_SECURE` | `false` |
| `SMTP_SERVICE` | `` |
| `SMTP_USER` | `` |
| `SMTP_PASSWORD` | generated/private |
| `SMTP_ALLOW_UNAUTHENTICATED` | `1` |
| `OUTBOX_RETENTION_DAYS` | `` |
| `ANTHROPIC_API_KEY` | generated/private |
| `ASSISTANT_MODEL` | `claude-opus-5-5` |
| `SEARXNG_URL` | `` |
| `GOOGLE_CLIENT_ID` | `` |
| `GOOGLE_CLIENT_SECRET` | generated/private |
| `GITHUB_APP_ID` | `` |
| `GITHUB_APP_NAME` | `` |
| `GITHUB_APP_PRIVATE_KEY` | generated/private |
| `GITHUB_APP_PRIVATE_KEY_FILE` | generated/private |
| `GITHUB_WEBHOOK_SECRET` | generated/private |
| `TELEGRAM_BOT_TOKEN` | generated/private |
| `TELEGRAM_WEBHOOK_SECRET` | generated/private |
| `ALLOW_PRIVATE_WEBHOOK_TARGETS` | `` |
| `NOTIFY_WORKER_CONCURRENCY` | `` |
| `MONITOR_WORKER_INPROCESS` | `` |
| `MONITOR_ALLOW_PRIVATE_TARGETS` | `` |
| `MONITOR_MAX_PER_WORKSPACE` | `` |
| `TRUSTED_PROXY_IP_HEADER` | `` |
| `TRUSTED_PROXY_HOPS` | `` |
| `ALLOWED_ACTION_ORIGINS` | `` |
| `OUTBOX_WORKER` | `` |
| `DEMO_PASSWORD` | generated/private |

The production server requires matching HTTPS AUTH_URL/NEXT_PUBLIC_BASE_URL, database TLS, rediss Redis, HTTPS object storage, stable encryption keys, the health/job bearers and an explicitly trusted proxy IP header. Pair S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY or omit both for an IAM role. SMTP, assistant and OAuth can be configured after setup. Runtime replicas must share encryption keys and a release version. ALLOWED_ACTION_ORIGINS is evaluated while Next config loads; rebuild only when deliberately changing build-time Next configuration.

Scheduler settings: APP_URL is the private application origin, SCHEDULER_ENDPOINTS defaults to outbox,jobs, SCHEDULER_INTERVAL_SECONDS defaults to 60 (minimum 15), and OUTBOX_WORKER=0 disables duplicate in-process outbox polling. CI=true plus ALLOW_INSECURE_PRODUCTION_TESTS=1 is exclusively for isolated CI tests; the installer never sets these flags.
