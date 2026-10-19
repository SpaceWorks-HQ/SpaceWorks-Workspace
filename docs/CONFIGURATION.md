# Configuration

[VPS](DEPLOYMENT_VPS.md) · [Docker](DEPLOYMENT_DOCKER.md) · [Cloud](DEPLOYMENT_CLOUD.md) · [Operations](production-operations.md)

Space Works Workspace is configured with environment variables. For local
development copy `.env.example` to `.env` (or run `./local.sh start`, which
does it with fresh secrets). In production, values come from the platform's
secret store or the VPS configuration directory; never from a committed file.

Two checks enforce the rules below:

- **At boot** (`instrumentation.ts` → `lib/env.ts`): a production server
  (`NODE_ENV=production`) refuses to start with a missing required variable,
  a malformed key, a non-HTTPS origin, a database URL without TLS, plain
  `redis://`, or a plain-HTTP S3 endpoint.
- **Before deploying** (`npm run production:check`, or
  `node --env-file=/secure/sww.env scripts/check-production-env.mjs`): the same
  rules plus deployment extras (SMTP completeness, proxy hops, optional keys),
  printing variable names only, never values. Exit code 1 means fix first.

"Required" below means required in production.

## Core

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV` | set by the image | `production` in containers; turns on the boot check, HSTS and secure cookies |
| `DATABASE_URL` | yes | Runtime PostgreSQL 16 URL. Must include `sslmode=require`, `verify-ca` or `verify-full`. Through a transaction pooler (port 6543) add `pgbouncer=true` (and `connection_limit=5` on small instances) |
| `DIRECT_URL` | with a pooler | Direct or session-mode URL used only by migrations (`prisma migrate`). Scripts, the migrator image and the entrypoint fall back to `DATABASE_URL` when it is empty |
| `AUTH_SECRET` | yes | Auth.js session encryption, 32+ characters (`openssl rand -base64 33`) |
| `AUTH_URL` | yes | Canonical public origin, `https://work.example.org` |
| `NEXT_PUBLIC_BASE_URL` | yes | Same origin as `AUTH_URL`; used for links in emails and metadata. Read at runtime unless compiled in with the image build argument of the same name |
| `SUPER_ADMIN_EMAIL` | recommended | The one account that may open `/admin` (after a fresh two-step code) |
| `REDIS_URL` | yes | `rediss://` URL. Rate limits (fail closed in production) and realtime fan-out across instances |
| `TRUSTED_PROXY_IP_HEADER` | yes | Which header carries the client IP: `x-real-ip` (VPS Caddy), `x-forwarded-for` (Render, DO, ALB, ingress-nginx), `cf-connecting-ip` (behind your Cloudflare zone). The edge must overwrite it |
| `TRUSTED_PROXY_HOPS` | with `x-forwarded-for` | Number of trusted proxies appending to `X-Forwarded-For` (1 on Render, DO App Platform, AWS ALB, Fly) |
| `ALLOWED_ACTION_ORIGINS` | no | Extra hosts allowed to post Server Actions, comma-separated, when a trusted proxy rewrites the host |

## Keys and bearer secrets

Generate each independently: `openssl rand -base64 32` for keys,
`openssl rand -base64 33` for secrets. The VPS installer generates them all.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | yes | Base64 16/24/32-byte AES key for Server Action payloads. Identical on every instance; changing it invalidates open forms |
| `MFA_ENCRYPTION_KEY` | yes | Base64 32-byte key for TOTP seeds; a domain-separated subkey encrypts instance settings (SMTP password, Google secret, AI key). **Never lose or casually rotate it** |
| `INTEGRATION_ENCRYPTION_KEY` | recommended | Base64 32-byte key for integration OAuth tokens (Google, GitHub). Falls back to a subkey of `MFA_ENCRYPTION_KEY` |
| `VAULT_MASTER_KEY` | recommended | Base64 32-byte key reserved for the team credentials vault; set it at install so the vault can be enabled without a configuration change |
| `CRON_SECRET` | yes | Bearer for `POST /api/internal/outbox` and `POST /api/internal/jobs` (schedulers) |
| `HEALTHCHECK_SECRET` | yes | Bearer for `GET /api/health/db` (readiness monitors) |

Wrong or missing bearers get a plain `404`. Never put a bearer in a URL.

## Object storage

| Variable | Required | Purpose |
| --- | --- | --- |
| `S3_BUCKET` | yes | Private bucket (Silo, R2, Spaces, S3, Tigris) |
| `S3_REGION` | yes | `auto` for R2, the bucket region elsewhere, `us-east-1` for Silo |
| `S3_ENDPOINT` | provider | HTTPS endpoint for non-AWS providers; empty for AWS S3 |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | provider | Both, or neither to use an IAM role |
| `S3_FORCE_PATH_STYLE` | provider | `1` for Silo/MinIO, R2 and Spaces |
| `UPLOAD_MAX_BYTES` | no | Largest upload in bytes (default 25 MB, maximum 500 MB). Proxies must allow a little more |

Without `S3_BUCKET`, development stores files in `.data/storage`;
production refuses to run without object storage.

## Email

The environment values are the bootstrap fallback; **/admin → Settings**
overrides them (stored encrypted) and is the preferred place.

| Variable | Purpose |
| --- | --- |
| `EMAIL_FROM` | Sender on a domain with SPF, DKIM and DMARC, e.g. `Space Works <workspace@example.org>` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | Relay; `SMTP_SECURE=true` for implicit TLS (465), `false` for STARTTLS (587, 2525) |
| `SMTP_SERVICE` | A Nodemailer well-known service name instead of host/port |
| `SMTP_USER`, `SMTP_PASSWORD` | Required whenever SMTP is configured in production |
| `SMTP_ALLOW_UNAUTHENTICATED` | `1` only for local Mailpit |
| `OUTBOX_RETENTION_DAYS` | Days to keep sent/failed outbox rows (default 30, maximum 365) |
| `OUTBOX_WORKER` | `0` disables the in-process outbox worker (then a scheduler must call `/api/internal/outbox`) |

## Assistant and integrations

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Assistant model access (fallback for `/admin` settings) |
| `ASSISTANT_MODEL` | Model id, default `claude-opus-5-5` (fallback for `/admin`) |
| `SEARXNG_URL` | Optional self-hosted SearXNG for the assistant's web search |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google sign-in for invited members (fallback for `/admin`). Redirect URI `https://<host>/api/auth/callback/google` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Calendar, Gmail, Drive and Search Console integrations (may reuse the sign-in client) |
| `GITHUB_APP_ID`, `GITHUB_APP_NAME`, `GITHUB_APP_PRIVATE_KEY` or `GITHUB_APP_PRIVATE_KEY_FILE`, `GITHUB_WEBHOOK_SECRET` | GitHub App integration; webhook secret 16+ characters |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | Telegram bot; webhook secret 16+ characters |

## Container and runtime

| Variable | Purpose |
| --- | --- |
| `PORT`, `HOSTNAME` | Listen address, `3000` and `0.0.0.0` in the image |
| `MIGRATE_ON_START` | `1`: the image entrypoint runs `prisma migrate deploy` before starting. Only for a single instance without a release step |
| `NODE_OPTIONS` | e.g. `--max-old-space-size=384` on a 512 MB instance |
| `NODE_EXTRA_CA_CERTS` | Extra CA bundle; the VPS stack points it at its private CA (`/tls/ca.crt`) |
| `PRISMA_LOG_QUERIES` | `1` logs SQL (debugging only) |

## Scheduler (`scripts/scheduler.mjs`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_URL` | required | Origin of the app (`http://app:3000` in the VPS stack) |
| `CRON_SECRET` | required | The app's `CRON_SECRET` |
| `SCHEDULER_ENDPOINTS` | `outbox,jobs` | Which internal endpoints to call |
| `SCHEDULER_INTERVAL_SECONDS` | `60` | Interval between passes (ignored with `--once`) |

## VPS stack (`compose.env` in the configuration directory)

Written by `scripts/setup-vps.sh`; the installer's own answers are listed in
[DEPLOYMENT_VPS.md](DEPLOYMENT_VPS.md#unattended-install-cloud-init-terraform).

| Variable | Purpose |
| --- | --- |
| `COMPOSE_PROJECT_NAME` | Compose project (`spaceworks-workspace`) |
| `PUBLIC_HOST`, `PUBLIC_ORIGIN` | Hostname Caddy serves and the origin compiled into the image |
| `SWW_VERSION` | Release label of the running images (changed only by the updater) |
| `ACME_EMAIL`, `CADDY_TLS` | Certificate contact; `acme` (public) or `internal` (test) |
| `SWW_HTTP_PORT`, `SWW_HTTPS_PORT`, `SWW_BIND_PREFIX` | Published ports (80/443) and optional bind address |
| `SWW_BACKUP_KEEP_DAYS` | Backup retention in days (14) |

Other files there: `app.env` (the app's variables above), `postgres.env`,
`migrator.env`, `storage.env`, `storage-init.env`, `scheduler.env`,
`redis.conf`, `tls/` (private CA and service certificates),
optional `backup-remote.env`, and `backups/`.

## Development and tests only

| Variable | Purpose |
| --- | --- |
| `TEST_DATABASE_URL` | Disposable database for `npm run test:integration` (wiped) |
| `TEST_S3_BUCKET` | Run the storage integration tests against a real bucket |
| `DEMO_PASSWORD` | Password for `npm run db:seed:demo` members (12+ characters) |
| `NEXT_DEV_ALLOWED_ORIGINS` | Extra hosts allowed to load dev assets |
| `CI` + `ALLOW_INSECURE_PRODUCTION_TESTS=1` | Together they relax the transport rules for production builds in CI. Never in a deployment |
