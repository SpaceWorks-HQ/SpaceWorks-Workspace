# Deploy on a cloud platform

[VPS](DEPLOYMENT_VPS.md) · [AWS](DEPLOYMENT_AWS.md) · [Kubernetes](DEPLOYMENT_KUBERNETES.md) · [Configuration](CONFIGURATION.md) · [Operations](production-operations.md)

Platform-as-a-service options, all running the same Docker image with managed
data services. Every connection must use TLS: `sslmode=require` for
PostgreSQL, `rediss://` for Redis, HTTPS for object storage, STARTTLS or TLS
for SMTP. Pick one region for everything.

| Piece | Render (`render.yaml`) | DigitalOcean App Platform (`.do/app.yaml`) | Fly.io |
| --- | --- | --- | --- |
| App | Docker web service | Docker service + pre-deploy job | Fly Machine |
| PostgreSQL 16 | Supabase (or Render Postgres) | Managed PostgreSQL | Fly Managed Postgres or Supabase |
| Redis | Upstash | Managed Valkey | Upstash (Fly integration) |
| Files | Cloudflare R2 | Spaces | Tigris or R2 |
| Email | Brevo (port 2525 on Render free) | Any SMTP relay | Any SMTP relay |
| Scheduler | In-process + Cloudflare Worker | In-process (+ Worker) | In-process (+ Worker) |

## Shared preparation

### Secrets

```bash
openssl rand -base64 33   # AUTH_SECRET, CRON_SECRET, HEALTHCHECK_SECRET (one each)
openssl rand -base64 32   # NEXT_SERVER_ACTIONS_ENCRYPTION_KEY, MFA_ENCRYPTION_KEY,
                          # INTEGRATION_ENCRYPTION_KEY, VAULT_MASTER_KEY (one each)
```

Save every value in a password manager. `MFA_ENCRYPTION_KEY`,
`INTEGRATION_ENCRYPTION_KEY` and `VAULT_MASTER_KEY` encrypt data at rest:
losing one makes that data unreadable. Check a finished configuration with
`node --env-file=/secure/sww.env scripts/check-production-env.mjs`.

### Supabase PostgreSQL

Create a project, open **Connect → Connection string**:

```text
DATABASE_URL=postgresql://postgres.REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5&sslmode=require
DIRECT_URL=postgresql://postgres.REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres?sslmode=require
```

The transaction pooler (6543) needs `pgbouncer=true`; migrations use the
session pooler (`DIRECT_URL`). URL-encode special characters in the password.

### Upstash Redis

Create a Redis database in your region and copy the TLS URL:
`REDIS_URL=rediss://default:PASSWORD@NAME.upstash.io:6379`. Leave eviction off.

### Cloudflare R2

Create a bucket (public access off, no custom domain: files are served only
through the app's authorised route) and an API token with **Object Read &
Write** on that bucket:

```text
S3_BUCKET=spaceworks-workspace
S3_REGION=auto
S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=1
```

### Email (Brevo)

Authenticate your sending domain (SPF, DKIM, DMARC), then create an SMTP key:
`EMAIL_FROM='Space Works <workspace@your-domain>'`, `SMTP_HOST=smtp-relay.brevo.com`,
`SMTP_PORT=587` (2525 on Render free, which blocks 25/465/587), `SMTP_SECURE=false`,
`SMTP_USER`, `SMTP_PASSWORD`. These are the bootstrap fallback; SMTP can also
be set in `/admin → Settings`, where it is stored encrypted.

## Render

[`render.yaml`](../render.yaml) defines a Docker web service on the Starter
plan: always on (so the in-process outbox worker runs), health check
`/api/health`, and a pre-deploy command that applies migrations once per
deploy. Deploys wait for GitHub checks (`autoDeployTrigger: checksPass`) and
skip documentation-only commits.

1. Render → **New → Blueprint**, connect `SpaceWorks-HQ/SpaceWorks-Workspace`,
   choose the branch.
2. Fill in the prompted values. `AUTH_URL` and `NEXT_PUBLIC_BASE_URL` are both
   `https://spaceworks-workspace.onrender.com` (or your domain), no trailing slash.
   Render generates `AUTH_SECRET`, `CRON_SECRET` and `HEALTHCHECK_SECRET`.
3. Apply. The first build takes about 10 minutes.
4. Custom domain: add it under **Settings → Custom Domains**, create the DNS
   record Render shows (DNS-only if Cloudflare manages the zone), then set
   both URL variables to the new origin and redeploy.
5. Open `https://<host>/setup`.

Client IPs: Render appends to `X-Forwarded-For`, so the Blueprint sets
`TRUSTED_PROXY_IP_HEADER=x-forwarded-for` and `TRUSTED_PROXY_HOPS=1`. If your
own Cloudflare zone proxies the domain (orange cloud), switch to
`cf-connecting-ip`, remove the hops, and turn off Email Address Obfuscation.

**Free plan**: change `plan` to `free`, delete `preDeployCommand`, add
`MIGRATE_ON_START=1`, and use Brevo on port 2525. Free instances sleep after
15 idle minutes, which stops the in-process outbox, so deploy the Cloudflare
Worker below. The 512 MB instance is tight for the assistant; use Starter for
a real community.

### Cloudflare cron Worker

[`deploy/cloudflare-cron`](../deploy/cloudflare-cron/README.md) wakes the app
every minute and calls `/api/internal/outbox` and `/api/internal/jobs` with
`CRON_SECRET`:

```bash
cd deploy/cloudflare-cron && npm ci && npx wrangler login
npx wrangler secret put APP_URL       # https://work.example.org
npx wrangler secret put CRON_SECRET   # copy from Render → Environment
npx wrangler deploy && npx wrangler tail
```

An optional paid Render cron service (commented in `render.yaml`) does the
same with `node /app/scripts/scheduler.mjs --once`.

## DigitalOcean App Platform

[`.do/app.yaml`](../.do/app.yaml) builds the Dockerfile, runs a **PRE_DEPLOY**
migration job, binds a Managed PostgreSQL cluster as `${db.DATABASE_URL}`
(already `sslmode=require`) and checks `/api/health`.

1. Create, in one region (the spec uses `blr`, Bangalore):
   - a **Managed PostgreSQL 16** cluster named `sww-db` with database `sww` and user `sww`;
   - a **Managed Valkey** cluster; copy its `rediss://` connection string;
   - a **Spaces** bucket (private, file listing off) and a Spaces key scoped to it.
2. Edit `.do/app.yaml`: replace every `CHANGE_ME`, adjust the region slug,
   `S3_REGION` and `S3_ENDPOINT` (`https://<region>.digitaloceanspaces.com`).
3. `doctl apps create --spec .do/app.yaml`, then set each `SECRET` value in
   the control panel (**Settings → App-Level Environment Variables**) and redeploy.
4. Add your domain under **Settings → Domains**; keep `AUTH_URL` and
   `NEXT_PUBLIC_BASE_URL` equal to it (changing the base URL needs a rebuild).
5. Restrict the database and Valkey **trusted sources** to the app.
6. Open `https://<host>/setup`.

App Platform's edge appends to `X-Forwarded-For` (`TRUSTED_PROXY_HOPS=1`).
The in-process worker covers the outbox; deploy the Cloudflare Worker for an
independent scheduler. Managed PostgreSQL includes daily backups and
point-in-time recovery; Spaces has no versioning, so also run the
storage backup described in [operations](production-operations.md).

Prefer a single server instead? A Droplet with the curl installer is the
cheapest complete setup: see the [VPS guide](DEPLOYMENT_VPS.md#provider-notes).

## Fly.io (optional)

Fly runs the image as a Machine close to your members. A minimal `fly.toml`:

```toml
app = "spaceworks-workspace"
primary_region = "sin"

[build]
  dockerfile = "Dockerfile"

[deploy]
  # The image's entrypoint migrates when MIGRATE_ON_START=1.
  release_command = "sh -c 'MIGRATE_ON_START=1 docker-entrypoint.sh true'"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "off"   # keep the in-process outbox running
  min_machines_running = 1

  [[http_service.checks]]
    method = "GET"
    path = "/api/health"
    interval = "30s"
    timeout = "5s"

[[vm]]
  memory = "1gb"
```

```bash
fly launch --no-deploy --copy-config
fly secrets set DATABASE_URL=... DIRECT_URL=... REDIS_URL=... AUTH_URL=https://work.example.org \
  NEXT_PUBLIC_BASE_URL=https://work.example.org AUTH_SECRET=... CRON_SECRET=... HEALTHCHECK_SECRET=... \
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=... MFA_ENCRYPTION_KEY=... INTEGRATION_ENCRYPTION_KEY=... \
  VAULT_MASTER_KEY=... TRUSTED_PROXY_IP_HEADER=x-forwarded-for TRUSTED_PROXY_HOPS=1 \
  S3_BUCKET=... S3_REGION=auto S3_ENDPOINT=https://fly.storage.tigris.dev S3_ACCESS_KEY_ID=... \
  S3_SECRET_ACCESS_KEY=... SUPER_ADMIN_EMAIL=you@example.org
fly deploy
```

Use Fly Managed Postgres (or Supabase) with `sslmode=require`, Upstash Redis
(`fly redis create`) and Tigris (`fly storage create`) or R2. Fly's proxy sets
`Fly-Client-IP`, which the app does not read; use `x-forwarded-for` with one hop.

## After any cloud deploy

```bash
curl -fsS https://work.example.org/api/health
curl -fsS -H "Authorization: Bearer $HEALTHCHECK_SECRET" https://work.example.org/api/health/db
```

Then create the owner account at `/setup`, enable two-step verification for
the admin email, send a test email from `/admin`, upload a file, and check
that live updates (notifications, chat) reach a second browser.
