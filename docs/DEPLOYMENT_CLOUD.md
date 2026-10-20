# Cloud deployment

A DigitalOcean Droplet, Hetzner Cloud server or AWS EC2 instance can run the [curl installer](DEPLOYMENT_VPS.md) unchanged. Choose cloud services to default PostgreSQL, Redis and S3 to external providers, or keep any service bundled. Keep services in the same region, use provider firewalls, and publish only the HTTPS edge. A hostname and SSH access are enough for the guided install.

## DigitalOcean App Platform

`.do/app.yaml` builds the root Dockerfile's generic backend, runs the migration role as PRE_DEPLOY and serves all Next.js pages/API on port 3000. Provision a PostgreSQL 16 cluster, a TLS Valkey/Redis endpoint and a private Spaces bucket. Replace CHANGE_ME values and enter secrets in the dashboard. Use a restricted runtime DB user and a separate migration owner DIRECT_URL. Bindings may use the provider URL; ensure TLS is required. Set AUTH_URL and NEXT_PUBLIC_BASE_URL to the same HTTPS origin at runtime. Configure one trusted forwarding hop for the provider edge.

Run a scheduler with the same backend version and `scheduler` role (APP_URL points to the web service, CRON_SECRET matches). Alternatively use [the existing cron worker](../deploy/cloudflare-cron/README.md), with both outbox/jobs endpoints enabled. If an in-process outbox worker remains enabled it does not replace the periodic jobs endpoint. Do not omit the scheduler.

## Render

`render.yaml` builds the same backend Dockerfile, applies `docker-entrypoint.sh migrate` as a pre-deploy command and starts the explicit web role. Supply managed PostgreSQL, `rediss://` Redis and private S3-compatible storage. The environment prompts include bearer/session secrets, encryption keys and public origins. Paid always-on hosting is the supported baseline. To deploy a published image instead, create an image-backed service using `ghcr.io/spaceworks-hq/spaceworks-workspace-backend:<immutable-version>` and the same runtime settings, then run migrate as a separate release operation.

Use the backend image with `scheduler --once` in a once-per-minute provider scheduler or a dedicated scheduler service. Keep its environment limited to APP_URL and CRON_SECRET. Provider edge TLS and timeouts must support SSE/streaming. Check the private readiness endpoint with the bearer after migrations; public `/api/health` proves process liveness only.

## Managed service settings

- **Database:** PostgreSQL TLS, runtime DML user, maintenance DIRECT_URL. Supabase pooler port 6543 needs `pgbouncer=true`; use direct/session port 5432 for migrations. Configure provider-native PITR and backups.
- **Redis:** native Redis-compatible TLS (`rediss://`), no REST API endpoint. Use no-eviction capacity planning for distributed rate limits and fan-out.
- **Storage:** private S3/R2/Spaces bucket; HTTPS endpoint, least-privilege credentials, versioning. The server reads/writes files; browsers never need public bucket access.
- **Email:** authenticated SMTP supported by the provider; set host, port, TLS mode, user/password and sender, or configure it in /admin.
- **Secrets:** use the provider's secret manager. No deployment secret is a Docker build argument. Keep continuity keys separate from routine app redeploys.

Kubernetes instructions are in [DEPLOYMENT_KUBERNETES.md](DEPLOYMENT_KUBERNETES.md), AWS container details in [DEPLOYMENT_AWS.md](DEPLOYMENT_AWS.md), and recovery in [production-operations.md](production-operations.md).
