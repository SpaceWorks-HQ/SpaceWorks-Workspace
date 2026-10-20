# Background jobs

Production runs three backend roles from the same immutable image: web
(`node server.js`), worker (`node dist/worker.js`) and beat
(`node dist/beat.js`). BullMQ is pinned to 5.81.5; esbuild 0.28.2 bundles both
processes during the Docker build. Worker-only dependencies are bundled;
Prisma's generated client/native engine, Next and Sharp use standalone's
existing modules. No database model or migration is needed.

## Registry and queues

`lib/scheduled/index.ts` remains the sole registration/cadence source. Existing
`{ area, run }` registrations continue to work at 60 seconds. Optional `queue`
and `schedule: { every } | { pattern, tz }` support dedicated queues and cron.
Beat maps these to BullMQ Job Schedulers, atomically upserts stable ids and
removes stale `registry-*` schedules across all five queues at deployment.
Keep beat at one replica; concurrent starts still upsert identical schedules.
An old beat process does not periodically overwrite a newer release's registry.
BullMQ produces the next repeat when the previous job starts; a busy queue can
reduce cadence. Existing handlers still claim their own due tenant records.

| Queue | Work | Default concurrency per worker |
| --- | --- | --- |
| outbox | Durable SQL outbox relay every five seconds; email and notify deliveries | 5 |
| scheduled | Area maintenance, reminders; daily operational retention in UTC | 2 |
| sync | Social, app reviews and integration/SEO syncs | 2 |
| monitor | Due checks every five seconds and minute monitor maintenance | 1 |
| documents | Existing docs/files scheduled handler | 1 |

`QUEUE_<NAME>_CONCURRENCY` accepts 1–64. Documents is an execution lane for the
existing registry, not a new PDF generator. No new tenant tools, sample jobs,
search documents, file types or notification event types are created. Existing
handlers retain tenancy, current membership/visibility and dispatch/storage
rules. Jobs carry an area or outbox id only, never rendered mail, credentials,
capability links or private document bodies.

## Delivery, retries and failure recovery

Postgres remains the transactional outbox: request transactions write rows;
the relay recovers any committed row even if Redis was temporarily unavailable.
It enqueues 100 oldest due/stale rows per pass. One stable hashed BullMQ id per
outbox row deduplicates enqueues; conditional SQL claims prevent competing
worker instances from sending the same claimed row. A sent row or deleted
capability job is a no-op if replayed. Stale PROCESSING claims recover after
15 minutes, using the existing outbox behavior.

SQL retains provider delivery timing and retry limits. A pending row moves its
BullMQ job to delayed until availableAt; it never gets marked complete while
pending. Other failures use eight attempts with exponential backoff from five
seconds. Completed jobs retain at most 2,000 entries for one day; failed jobs
form the dead-letter set, at most 5,000 per queue for 30 days. Cleanup happens
as jobs finish, so these are lazy retention limits. Exceptions are reduced to
safe type/code summaries before BullMQ stores them; stack traces are disabled.

Delivery is at least once. SMTP/provider acceptance cannot atomically commit
with SQL; a crash after acceptance and before the sent-state write may deliver
again. The existing stable email Message-ID helps downstream deduplication but
does not promise exactly-once delivery. Scheduled handlers remain responsible
for idempotent database claims and external side effects.

`/admin/jobs` requires the configured super-admin plus fresh MFA on every page
load and action. It shows queue state/counts and up to ten recent failures per
queue. Retry resets a FAILED outbox row's attempts before retrying its queue
job; sent rows never reset. Remove deletes only a failed queue job, retaining
SQL failure evidence. Pause stops new claims across workers; active handlers
finish. All mutations validate inputs, rate-limit and audit queue/job ids only.
No workspace member or owner gains instance queue access.

After Redis loss, restart beat to restore schedules. The SQL relay recovers
pending deliveries. Terminal SQL rows whose Redis failure entry was lost need
operator review before a deliberate SQL retry; do not blindly replay accepted
mail. To recover from exhausted worker/stall retries with a pending SQL row,
retry its failed queue job in Jobs. Monitor SQL outbox health too: queue counts
are retained job counts, not lifetime delivery totals.

## Processes and health

Use native Redis with persistence and `maxmemory-policy noeviction`, including
TLS/auth in production. All roles share REDIS_URL and the `sww:jobs` prefix.
`JOBS_QUEUE_PREFIX` can isolate tests/installations; changing it leaves old work
under the old prefix. Request producers fail promptly if Redis is unavailable and reconnect on the
next request; background producer and worker connections reconnect indefinitely. Budget connections/commands for five
queues, blocking worker connections and application rate limits/realtime.

Each process serves private `GET /health` on `JOBS_HEALTH_PORT` (3460 default),
checks Redis connectivity and publishes an expiring 45-second heartbeat under
`sww:jobs:heartbeat:<role>:<host>:<pid>`. Worker health also checks its consumers.
Neither port is published in Compose or exposed through Helm ingress. SIGTERM
and SIGINT stop new claims, await active handlers and final SQL writes, close
Redis connections and disconnect Prisma. Compose/Helm allow 600 seconds;
Render allows 300. A forced termination relies on BullMQ stalled-job recovery
and SQL stale-claim recovery. In-flight external calls still have their own
provider timeouts.

## Local development and HTTP cron

With Redis: `npm run build:jobs`, then run `npm run worker` and `npm run beat`
in separate terminals. They load local configuration without printing it.
Use different JOBS_HEALTH_PORT values on one host. For Redis-free local dev
only, unset REDIS_URL and opt in with `JOBS_INPROCESS=true` before `npm run dev`.
The existing in-process minute timer then handles outbox and area maintenance.
Production never starts this timer; OUTBOX_WORKER and MONITOR_WORKER_INPROCESS
are obsolete. Monitor precision in this local fallback is one minute.

`POST /api/internal/outbox` and `/api/internal/jobs` retain bearer auth, private
cache headers and 404 for invalid credentials. They enqueue and return 503 on
Redis failure. The jobs trigger deduplicates interval time buckets and supports
cron occurrences in the preceding minute. External cron replaces beat only:
a persistent worker is always required. Do not run both mechanisms together.
`scripts/scheduler.mjs --once` and `deploy/cloudflare-cron` remain HTTP clients.
Render free web services cannot run background workers; host worker separately
or use the paid Blueprint. See the provider deployment guides.

## Shared files and validation

Required shared edits: registry/cadence, monitor execution split, opt-in
instrumentation/local worker, runtime environment validation, authenticated
internal enqueue routes, admin tabs/outbox copy, frontend generated catalogs,
package metadata, backend build, deployments/operator scripts and their docs.
Schema, role hierarchy, tenant navigation, storage and dispatch contracts stay
unchanged. Frontend catalogs are regenerated; generated view modules keep MFA
checks on the backend and expose only safe queue projections.

Tests exercise mapping, ids, retention/backoff/concurrency, bearer auth, real
Redis DB 0 with unique prefixes, two-worker delivery, repeat reconciliation,
failed retry, stale claims, graceful drain and super-admin/MFA denial. No
Docker or browser was run. Production provider and container rollout smoke
remain CI/operator checks.

References: [BullMQ schedulers](https://docs.bullmq.io/guide/job-schedulers),
[connections](https://docs.bullmq.io/guide/connections),
[graceful shutdown](https://docs.bullmq.io/guide/workers/graceful-shutdown),
[Render Blueprint](https://render.com/docs/blueprint-spec).

## Review groups (left uncommitted)

1. `feat(jobs): add BullMQ queues, worker and beat` — queue services, registry,
   outbox bridge, process bundles, runtime settings and Redis/process tests.
2. `feat(admin): add guarded queue operations` — Jobs UI/actions, admin
   navigation, safe projections, generated frontend contracts and MFA tests.
3. `feat(deploy): replace scheduler with worker and beat` — backend image,
   Compose/provider/Helm roles, installer operations, CI Redis and documentation.

Shared paths outside the area's new queue/process/admin files:

| Paths | Reason |
| --- | --- |
| `lib/scheduled/index.ts`, `lib/scheduled/monitor.ts` | Central repeat cadence and monitor queue separation; no other area's registration module changes. |
| `instrumentation.ts`, `lib/outboxWorker.ts` | Remove production timers and guard opt-in Redis-free local execution. |
| `lib/env.ts`, `.env.example`, `scripts/check-production-env.mjs`, `tests/unit/env.test.ts`, `tests/unit/production-check.test.ts` | Validate and document job process settings consistently. |
| `app/api/internal/jobs/route.ts`, `app/api/internal/outbox/route.ts`, `tests/unit/internal-jobs.test.ts`, `tests/unit/monitor-jobs.test.ts` | Preserve authenticated cron endpoints while enqueuing work. |
| `components/admin/AdminTabs.tsx`, `app/admin/outbox/page.tsx` | Discover Jobs and correct delivery status copy. |
| `frontend/catalog.json`, `frontend/contracts.d.ts`, `frontend/model-types.d.ts`, `frontend/model-types.json`, `frontend/pages.json`, `lib/frontend/registry.ts`, `lib/views/generated/admin-jobs-page-loadAdminJobsPage.ts` | Regenerate guarded split-frontend contracts/readers after the new page/action. |
| `package.json`, `package-lock.json`, `.gitignore`, `.dockerignore`, `eslint.config.mjs`, `tsconfig.json` | Pin BullMQ/esbuild, add commands and exclude generated process bundles from source tooling. |
| `.github/workflows/ci.yml` | Provision Redis for the new integration/process tests. No release workflow changes. |
| `Dockerfile`, `compose.production.yml`, `compose.staging.yml`, `.do/app.yaml`, `render.yaml` | Ship and run both roles from the backend release. |
| `charts/spaceworks-workspace/{values.yaml,README.md,templates/NOTES.txt,templates/jobs-deployments.yaml,templates/scheduler-cronjob.yaml}` | Replace the scheduled CronJob with private worker/beat Deployments; remove the old template. |
| `docker/vps/{check.mjs,setup.mjs,scheduler.mjs}`, `scripts/{docker-entrypoint.sh,setup-vps.sh,update-vps.sh,vps-restore.sh,vps-support.sh}`, `install.sh`, `tests/unit/vps-installer.test.ts` | Private health, role startup/drain, support/restore coverage; remove the obsolete VPS scheduler. |
| `README.md` (hosting sections only), `docs/{ARCHITECTURE.md,CONFIGURATION.md,CONTAINER_IMAGES.md,DEPLOYMENT_AWS.md,DEPLOYMENT_CLOUD.md,DEPLOYMENT_DOCKER.md,DEPLOYMENT_KUBERNETES.md,DEPLOYMENT_SPLIT.md,DEPLOYMENT_VPS.md,MONITORING.md,production-operations.md}` | Replace stale deployment/timer guidance and explain the external-worker cron option. |

## Verified handoff

- Database deploy and disposable-test migration preparation passed.
- Lint passed with zero warnings; root and frontend typechecks passed.
- Unit suite: 68 files, 898 passed, one existing skip.
- Integration suite: 40 files, 343 passed, including real Redis/Postgres and
  bundled worker/beat SIGTERM checks.
- Production build passed. Both process bundles build successfully.
- Deployment syntax: 79 scripts/manifests; Helm lint/template passed with a
  named runtime Secret. No Docker or browser execution was performed.
- Commit-message brand scan is empty. The exact tracked-source scan reports
  31 inherited substring matches in unchanged notepad identifiers, identical
  to HEAD; the scan of new files is empty.

The worktree has no feature commits and all changes remain uncommitted.
At handoff, dev is ten commits ahead of this branch's base. An attempted
`git rebase --autostash dev` could not create the protected worktree index lock
in this sandbox; it changed no branch state. The verified results above are
for this worktree's existing base. Rebase onto current dev, retain all newly
registered area handlers, regenerate the frontend catalog and rerun checks
before integration. The task's current-dev condition therefore remains open.
