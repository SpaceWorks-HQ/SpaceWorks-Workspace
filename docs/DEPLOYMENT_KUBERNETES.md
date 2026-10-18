# Deploy on Kubernetes (Helm)

[Container images](CONTAINER_IMAGES.md) · [Configuration](CONFIGURATION.md) · [Operations](production-operations.md)

The chart in [`charts/spaceworks-workspace`](../charts/spaceworks-workspace)
runs the application; PostgreSQL 16, Redis, S3-compatible storage and SMTP are
external (managed services or operators such as CloudNativePG). It renders:

| Resource | Notes |
| --- | --- |
| Deployment `web` | 2 replicas, non-root uid 1001, read-only root filesystem, `/tmp` and `/app/.next/cache` as `emptyDir`, startup/liveness on `/api/health`, readiness on bearer-protected `/api/health/db` |
| Service, optional Ingress | ClusterIP on port 80 |
| Job `migrate` | Helm `pre-install,pre-upgrade` hook running the migrator image; a failure blocks the rollout |
| CronJob `scheduler` | Every minute, `scheduler.mjs --once` from the app image; gets only `CRON_SECRET` |
| PodDisruptionBudget, optional HPA, ServiceAccount | Token automount off |
| Optional Secret | Only with `secret.create=true` (evaluation) |

## 1. Images

Use the GHCR images published by CI with an immutable tag (`sha-<12 chars>` or
a release version), or build and push your own: see
[Container images](CONTAINER_IMAGES.md). Private registries need an
`imagePullSecrets` entry.

## 2. Runtime Secret

Create one Secret with every production variable ([Configuration](CONFIGURATION.md));
`CRON_SECRET` and `HEALTHCHECK_SECRET` must be keys in it. Validate the file
first, then create the Secret (or manage it with External Secrets / Sealed Secrets):

```bash
node --env-file=/secure/sww.env scripts/check-production-env.mjs
kubectl create namespace sww
kubectl -n sww create secret generic sww-runtime --from-env-file=/secure/sww.env
```

Behind a transaction pooler include `DIRECT_URL` (the migration Job uses it).
For client IPs behind ingress-nginx use `TRUSTED_PROXY_IP_HEADER=x-forwarded-for`
with `TRUSTED_PROXY_HOPS=1` (or `x-real-ip` when the controller overwrites it).

## 3. Values

`/secure/values-production.yaml` (outside git):

```yaml
existingSecret: sww-runtime
image:
  tag: sha-0123456789ab
migration:
  image:
    tag: sha-0123456789ab
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
    nginx.ingress.kubernetes.io/proxy-buffering: "off"      # Server-Sent Events
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-body-size: 30m       # uploads
  hosts:
    - host: work.example.org
      paths: [{ path: /, pathType: Prefix }]
  tls:
    - secretName: work-example-org-tls
      hosts: [work.example.org]
```

## 4. Install and upgrade

```bash
helm lint charts/spaceworks-workspace --values /secure/values-production.yaml
helm upgrade --install sww charts/spaceworks-workspace --namespace sww \
  --values /secure/values-production.yaml --wait --timeout 10m
kubectl -n sww rollout status deployment/sww-spaceworks-workspace
```

Upgrades use the same command with new tags: the migration hook runs first,
then pods roll one at a time (`maxUnavailable: 0`). `helm rollback` restores
the previous application, not the database schema; restore a backup if an
older release cannot work with a newer schema.

Then open `https://work.example.org/setup`.

## Operating notes

- Several replicas need `REDIS_URL`: rate limits and realtime events fan out
  through Redis. Production refuses to start without it.
- The in-process outbox worker runs in every pod; rows are claimed atomically,
  so replicas and the CronJob never send an email twice. Set
  `scheduler.enabled=false` only if another scheduler calls the endpoints.
- Restrict traffic with NetworkPolicies: web pods need egress to PostgreSQL,
  Redis, S3, SMTP and the AI provider; the scheduler only to the web Service.
- Back up with your database provider's PITR and bucket versioning; see
  [production operations](production-operations.md).
