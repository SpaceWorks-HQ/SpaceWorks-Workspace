# Production operations

[VPS](DEPLOYMENT_VPS.md) · [Configuration](CONFIGURATION.md) · [Cloud](DEPLOYMENT_CLOUD.md) · [Kubernetes](DEPLOYMENT_KUBERNETES.md)

How to keep a Space Works Workspace instance healthy: endpoints, backups,
restore drills, upgrades, monitoring and secret rotation.

## Operational endpoints

| Endpoint | Auth | Use |
| --- | --- | --- |
| `GET /api/health` | none | Liveness. No dependencies; `{ ok, uptimeMs, time }` |
| `GET /api/health/db` | `Bearer $HEALTHCHECK_SECRET` | Readiness: runs `SELECT 1`. `503` when the database is down |
| `POST /api/internal/outbox` | `Bearer $CRON_SECRET` | Delivers queued email and purges expired operational data; `200 { ok, ... }` |
| `POST /api/internal/jobs` | `Bearer $CRON_SECRET` | Periodic jobs (assistant schedules and digests, service monitor checks). `204` when nothing ran, `200 { ok, ... }` when jobs report counts, `500 { ok: false }` on failure |

Every protected endpoint answers `404` to a missing or wrong bearer, so
probing reveals nothing.

**Jobs contract** (for anyone adding a periodic job): callers hit the
endpoint about once a minute, possibly overlapping, repeating or skipping
runs. Each job decides whether it is due, claims its work atomically (row
claims or Redis locks), is idempotent, and finishes well within 55 seconds,
handing longer work to the outbox or a queue. Errors are logged server-side
only and the response stays `{ ok: false }`.

**Schedulers**: every app process runs the outbox in-process each minute
(`OUTBOX_WORKER=0` turns it off). Independent schedulers call both endpoints:
the VPS `scheduler` container, the Helm CronJob, the Cloudflare Worker
(`deploy/cloudflare-cron`), or any cron running
`node /app/scripts/scheduler.mjs --once` with `APP_URL` and `CRON_SECRET`.

## Monitoring

Set up, at minimum:

- an uptime check on `https://<host>/api/health` (1 minute);
- a readiness check on `/api/health/db` with the bearer in a header (never in the URL);
- **/admin → Outbox**: the scheduler heartbeat must be fresh (under 2 minutes)
  and failed messages near zero;
- disk space on the VPS (database, storage and backups share it), alert at 80 %;
- certificate expiry: public (Caddy renews) and internal (one year, see the VPS guide);
- backup freshness: the newest file in `backups/database` is less than 26 hours old
  (`systemctl status spaceworks-workspace-backup.service` shows the last run);
- container restarts and health: `scripts/vps-compose.sh ps` (restart policies
  do not restart an unhealthy container by themselves).

Logs: `scripts/vps-compose.sh logs --since 1h app scheduler proxy`. Logs are
rotated (5 × 10 MB per container). Caddy's access log is off because
invitation and reset links are bearer capabilities.

## Backups

What must be backed up, on every platform:

| Data | VPS stack | Managed platforms |
| --- | --- | --- |
| Database | `scripts/vps-backup.sh` daily (`pg_dump -Fc`, verified) | Provider PITR + `npm run db:backup` copies |
| Files | Bucket mirror archive + 30-day object versioning | Bucket versioning or replication; `mc mirror` copies |
| Configuration and keys | `config-*.tar.gz` (secrets) | Your secret store |

Keep at least one copy **off the server**, encrypted, in another account or
provider. On the VPS, `backup-remote.env` makes every backup copy the database
and storage archives to an S3 bucket (see the [VPS guide](DEPLOYMENT_VPS.md#backups-and-restore)).
The configuration archive is never uploaded: store it in a password manager or
encrypted vault, because it can decrypt everything.

Managed databases: the repository's backup tool works against any TLS PostgreSQL
(PostgreSQL 16 client tools required):

```bash
DATABASE_URL="$DIRECT_URL" npm run db:backup
DATABASE_URL="$DIRECT_URL" npm run db:backup -- --s3-bucket sww-backups --s3-region auto \
  --s3-endpoint https://ACCOUNT.r2.cloudflarestorage.com --s3-access-key-id ... --s3-secret-access-key ...
```

It writes a checksummed archive to `backups/`, keeps the newest seven, and
optionally uploads it. Bucket copies for R2/Spaces/S3:
`mc mirror --overwrite src/sww-bucket dst/sww-bucket-backup` with the Silo
client (`pgsty/mc`).

## Restore drill (quarterly)

1. Take the latest off-site database and storage archives and the
   configuration archive.
2. On a spare server, extract the configuration to `/etc/spaceworks-workspace`,
   change `PUBLIC_HOST`, `PUBLIC_ORIGIN`, `AUTH_URL` and `NEXT_PUBLIC_BASE_URL`
   to a test hostname, and start the stack from the same release
   (`scripts/vps-compose.sh up -d --wait`).
3. `scripts/vps-restore.sh --database <dump> --storage <archive>`.
4. Sign in (two-step codes still work only if `MFA_ENCRYPTION_KEY` was
   restored), open recent docs and files, and check the outbox heartbeat.
5. Record the time it took and the age of the newest restored data, then
   destroy the drill server.

Managed platforms: restore the provider's point-in-time backup into a new
database, point a staging deployment at it, and run steps 4 and 5.
`npm run db:restore` restores repository archives; it always refuses local and
`dev`/`test` databases and requires `--production --confirm-database <name>`.

## Upgrades

- **VPS**: `sudo bash install.sh --ref <new-ref> --update` (backup, build,
  migrate, swap, verify, roll back on failure). Details in the
  [VPS guide](DEPLOYMENT_VPS.md#upgrades).
- **Images** (Docker, Kubernetes, ECS): run the new migrator once, then roll
  the app; see [Docker](DEPLOYMENT_DOCKER.md#upgrade) and
  [Kubernetes](DEPLOYMENT_KUBERNETES.md#4-install-and-upgrade).
- **Render / DigitalOcean**: merging to the deployed branch builds, runs the
  pre-deploy migration and swaps when healthy.

Before any upgrade read the new migrations in `prisma/migrations/`. Rolling
back the application never rolls back the schema; destructive migrations need
a restore plan. Keep the previous images until the new release has run for a day.

## Secret rotation

| Secret | How | Effect |
| --- | --- | --- |
| `CRON_SECRET` | Change in the app and in every scheduler (VPS: `app.env` and `scheduler.env`; Worker: `wrangler secret put`) at the same time | Schedulers get `404` until both match |
| `HEALTHCHECK_SECRET` | Change in the app and in the monitor | Readiness probes fail until updated |
| `AUTH_SECRET` | Replace and restart | Every session ends; members sign in again |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Replace on every instance, restart | Open forms must be reloaded |
| Database passwords | VPS: `ALTER ROLE sww_app PASSWORD '...'` in the postgres container, update `app.env`, restart the app (same for `sww` and `migrator.env`) | Brief restart |
| Redis password | Update `redis.conf` and `REDIS_URL`, recreate `redis` and `app` | Brief restart |
| Storage app key | Rerun `storage-init` with a new `S3_APP_PASSWORD` and update `S3_SECRET_ACCESS_KEY` | Brief restart |
| SMTP, Google, AI keys | **/admin → Settings** (encrypted at rest) | Immediate |
| `MFA_ENCRYPTION_KEY`, `INTEGRATION_ENCRYPTION_KEY`, `VAULT_MASTER_KEY` | Not rotated by replacement: data encrypted with them would become unreadable. Rotation needs a re-encryption step | Plan it; keep the old key until data is re-encrypted |

After any change on the VPS: `scripts/vps-compose.sh up -d --wait` and
`scripts/vps-compose.sh run --rm --no-deps ops node docker/vps/check.mjs`.
If a key or the configuration directory may have leaked, rotate every bearer
and password above, review the audit log in each workspace, and revoke API tokens.

## Incident basics

- Keep `/admin` limited to the `SUPER_ADMIN_EMAIL` account with two-step
  verification; review the audit log after incidents.
- Database full or down: the app returns errors and `/api/health/db` returns
  `503`; free disk space or scale the database, then `up -d --wait`.
- Redis down: rate-limited actions fail closed (members see "Too many
  requests"); realtime pauses. Restart Redis.
- Email not arriving: **/admin → Outbox** shows failures; send a test email
  from **/admin → Settings**; check SPF/DKIM/DMARC and the relay's dashboard.
