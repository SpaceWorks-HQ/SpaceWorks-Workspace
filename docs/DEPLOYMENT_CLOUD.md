# Free-tier cloud deployment

[Documentation index](README.md) · [Configuration](CONFIGURATION.md)

The optional cloud layout is one backend container serving the whole app, with
managed data services. Free plans are useful for a small trial; review current
quotas and upgrade for the community's availability and recovery requirements.
A VPS can instead run the complete stack through the [installer](DEPLOYMENT_VPS.md).

| Piece | Provider | File |
| --- | --- | --- |
| Application | Render | `render.yaml`, root Dockerfile |
| PostgreSQL 16 | Supabase | `DATABASE_URL`, `DIRECT_URL` |
| Native TLS Redis | Upstash | `REDIS_URL` |
| Private object storage | Cloudflare R2 | `S3_*` |
| Verified transactional email | Brevo or another SMTP relay | `SMTP_*`, `EMAIL_FROM` |
| Independent scheduler | Cloudflare Worker | `deploy/cloudflare-cron/` |

## 1. Database and Redis

Create Supabase and Upstash resources near the application region. Use the
provider's displayed connection settings. Runtime PostgreSQL through the
transaction pooler (port 6543) needs `pgbouncer=true&connection_limit=5&sslmode=require`.
Use a session/direct TLS URL for `DIRECT_URL` and migrations. URL-encode special
characters in credentials. Keep the runtime identity least-privileged.

Upstash must provide its native `rediss://` URL, not the REST endpoint. Keep
TLS and authentication enabled; plan capacity for rate-limit commands, jobs
and realtime fan-out. Configure no-eviction behavior for operational keys.

## 2. Private storage and email

Create a private R2 bucket. Disable public access and scope an Object Read &
Write credential to that bucket. Use its S3 endpoint origin without a bucket
path, `S3_REGION=auto` and `S3_FORCE_PATH_STYLE=1`. Files pass through the app's
access checks; browsers need no public bucket or bucket CORS.

Authenticate your email sending domain with the relay's current DNS records.
Set its SMTP host, login, password and verified `EMAIL_FROM`. Brevo can use
port 2525 with `SMTP_SECURE=false` for STARTTLS. Render free blocks outbound
ports 25, 465 and 587; see [Render's free-service limits](https://render.com/docs/free).
Retain bootstrap SMTP settings for recovery even if `/admin` later overrides them.

## 3. Independent secrets

The Blueprint generates session, scheduler and readiness bearers. Generate
four independent keys with `openssl rand -base64 32`: action encryption, MFA,
integration encryption and the vault master key. Keep encrypted off-server
copies. Changing an action key invalidates outstanding forms; losing encryption
keys makes stored secrets unreadable. Never share secrets with preview deploys.

## 4. Render

Connect this repository through **New → Blueprint** and select `render.yaml`.
It builds the final backend target, serves port 3000 and probes `/api/health`.
Set `AUTH_URL` and `NEXT_PUBLIC_BASE_URL` to the identical HTTPS service/custom
origin. Set the super-admin email, managed service URLs, storage and mail
settings and generated keys in the prompted secure environment fields.

Free web services have no separate pre-deploy command, so the Blueprint sets
`MIGRATE_ON_START=1`. Startup applies committed migrations using `DIRECT_URL`,
then starts the server; a failed migration prevents startup. On paid plans,
prefer a separate migration release operation. The runtime memory option is
separate from the larger build heap. Watch memory and upgrade if necessary.

Render exposes environment variables as Docker build arguments; only the
public URL and action encryption key are declared by the builder. Prefer a
BuildKit secret mount or a secret file with that name when available. Runtime
credentials never belong in image layers. Redeploy a custom build when its
public origin changes. See [Render Docker docs](https://render.com/docs/docker).

Keep `TRUSTED_PROXY_IP_HEADER=x-forwarded-for` and `TRUSTED_PROXY_HOPS=1` for
Render's appending edge. Only use a different trusted header when that header
is overwritten on every reachable ingress. Do not assume a CDN makes the
provider's direct hostname unreachable.

## 5. DNS and independent scheduler

Add the custom domain in Render, follow its DNS instructions, and wait for
HTTPS issuance. Keep both canonical URLs aligned. Disable CDN HTML rewriting
or injected scripts that conflict with the nonce CSP. Never buffer realtime
or assistant streams. Check the provider's current connection-duration limits.

Deploy `deploy/cloudflare-cron` with `APP_URL` set to the canonical HTTPS origin
and the same `CRON_SECRET` as the backend. The Worker wakes `/api/health`, then
calls **both** `/api/internal/outbox` and `/api/internal/jobs` every minute.
Watch HTTP statuses without logging secrets or response bodies. A paid
scheduler can instead run `node scripts/scheduler.mjs --once` with only
`APP_URL` and `CRON_SECRET`.

## 6. First setup and acceptance

Open `/setup`, create the first account with `SUPER_ADMIN_EMAIL`, create a
workspace, enrol MFA from Account and enter `/admin` with fresh TOTP proof.
Invite a test member; there is no public registration. Verify real mail,
password reset, task writes, private file upload/download, chat reconnect,
finance restrictions and cross-tenant denial. Check authenticated readiness
with `HEALTHCHECK_SECRET` in an Authorization header, never in the URL.

Free plans do not replace backups or point-in-time recovery. Schedule a
verified direct-connection database archive, copy objects and encryption keys
off-server, and test isolated restores. See [Operations](production-operations.md).

## Other clouds

[DigitalOcean App Platform](../.do/app.yaml) pulls an immutable backend release,
runs `migrate` as PRE_DEPLOY and a Node scheduler worker. Provide managed
PostgreSQL, TLS Redis/Valkey, private Spaces and SMTP, then replace every
placeholder securely. The service, migration job and scheduler use one release.
For AWS use [AWS deployment](DEPLOYMENT_AWS.md); for Kubernetes use
[the Helm guide](DEPLOYMENT_KUBERNETES.md). A separately hosted frontend follows
[Split hosting](DEPLOYMENT_SPLIT.md) and Netlify's
[monorepo settings](https://docs.netlify.com/build/configure-builds/monorepos/).
