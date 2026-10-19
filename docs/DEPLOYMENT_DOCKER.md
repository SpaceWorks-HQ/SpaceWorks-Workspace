# Run the container image

[VPS stack](DEPLOYMENT_VPS.md) · [Configuration](CONFIGURATION.md) · [Container images](CONTAINER_IMAGES.md)

This page covers the application container on its own, with PostgreSQL,
Redis, object storage and SMTP supplied separately (managed services or your
own). For a complete single-server stack use the [VPS guide](DEPLOYMENT_VPS.md);
for Kubernetes use the [Helm chart](DEPLOYMENT_KUBERNETES.md). The root
`docker-compose.yml` starts development services only.

## Images

| Target | Published as | Purpose |
| --- | --- | --- |
| `runner` (default) | `ghcr.io/spaceworks-hq/spaceworks-workspace` | Next.js standalone server on Node 22 Alpine, user `nextjs` (uid 1001), port 3000, `HEALTHCHECK` on `/api/health` |
| `migrator` | `ghcr.io/spaceworks-hq/spaceworks-workspace-migrator` | `prisma migrate deploy`, then exits |
| `ops` | never published | VPS setup, checks and backup tools |

The runner is generic: it holds no hostname or secret. Build it yourself with

```bash
docker build --tag spaceworks-workspace:local .                        # or: npm run docker:build
docker build --target migrator --tag spaceworks-workspace-migrator:local .
```

Optional build argument: `--build-arg NEXT_PUBLIC_BASE_URL=https://work.example.org`
compiles the origin into the image (the VPS stack does this). Without it the
value is read at runtime.

## Configure

Put the production variables from [Configuration](CONFIGURATION.md) in an
owner-only file outside the repository (or your platform's secret store) and
check it:

```bash
umask 077 && $EDITOR /secure/sww.env
node --env-file=/secure/sww.env scripts/check-production-env.mjs
```

The server refuses to start in production unless `AUTH_URL` and
`NEXT_PUBLIC_BASE_URL` are the same HTTPS origin, the database URL requires
TLS, Redis uses `rediss://`, a custom S3 endpoint uses HTTPS, and all required
secrets are present.

## First start

```bash
docker run --rm --env-file /secure/sww.env ghcr.io/spaceworks-hq/spaceworks-workspace-migrator:sha-<commit>
docker run -d --name sww --restart unless-stopped --env-file /secure/sww.env \
  --read-only --tmpfs /tmp --tmpfs /app/.next/cache:uid=1001,gid=1001 \
  --cap-drop ALL --security-opt no-new-privileges \
  --publish 127.0.0.1:3000:3000 ghcr.io/spaceworks-hq/spaceworks-workspace:sha-<commit>
curl --fail http://127.0.0.1:3000/api/health
```

Then open `https://<host>/setup` to create the owner account and first
workspace. Expose port 3000 only to your reverse proxy. The proxy must:

- terminate TLS and overwrite the client-IP header named in
  `TRUSTED_PROXY_IP_HEADER` (`x-real-ip`, `x-forwarded-for` with
  `TRUSTED_PROXY_HOPS`, or `cf-connecting-ip` behind Cloudflare);
- stream `text/event-stream` responses (`/api/realtime/...`) without buffering
  and allow idle reads of at least 60 seconds (nginx: `proxy_buffering off;
  proxy_read_timeout 3600s;`);
- accept request bodies up to 30 MB (uploads).

### Single container without a release step

Where nothing can run the migrator first (one container on a PaaS), set
`MIGRATE_ON_START=1`: the entrypoint runs `prisma migrate deploy` (through
`DIRECT_URL`, else `DATABASE_URL`) before `node server.js` and exits if it
fails, so a bad release never becomes healthy. Do not use it with several
replicas.

## Scheduler

Every app process runs the email outbox once a minute. Add an independent
scheduler for recovery and for periodic jobs (`/api/internal/jobs`). The image
contains one:

```bash
docker run -d --name sww-scheduler --restart unless-stopped \
  -e APP_URL=http://sww:3000 -e CRON_SECRET=... --network <app network> \
  --entrypoint node ghcr.io/spaceworks-hq/spaceworks-workspace:sha-<commit> /app/scripts/scheduler.mjs
```

`--once` makes one pass for cron-style runners. Any other scheduler works too:
`POST /api/internal/outbox` and `POST /api/internal/jobs` with
`Authorization: Bearer $CRON_SECRET`, about once a minute (204 or 200 is success).

## Upgrade

1. Back up the database (`npm run db:backup` or your provider's snapshot).
2. Pull both new images (same `sha-<commit>` tag).
3. Run the new migrator once.
4. Replace the app container; keep the old one stopped until the new one is healthy.
5. Verify `/api/health`, `GET /api/health/db` with `Authorization: Bearer $HEALTHCHECK_SECRET`, sign-in and email.

Reverting the image does not revert migrations. Restore a backup if an older
release cannot work with the newer schema.

## Local production-like run

`npm run docker:build` builds the image; to try it against the development
services from `docker-compose.yml`, see the "Trying the stack locally" section
of the [VPS guide](DEPLOYMENT_VPS.md#trying-the-stack-locally), which runs the
complete production stack with Caddy's internal CA on high ports.
