# Space Works Workspace Helm chart

Runs the application on Kubernetes: a Deployment (non-root, read-only root
filesystem), a Service, an optional Ingress, a pre-install/pre-upgrade
migration Job, a scheduler CronJob, a PodDisruptionBudget and an optional HPA.
PostgreSQL, Redis, object storage and SMTP are external managed services.

Full guide: [docs/DEPLOYMENT_KUBERNETES.md](../../docs/DEPLOYMENT_KUBERNETES.md).

```bash
kubectl create namespace sww
kubectl -n sww create secret generic sww-runtime --from-env-file=/secure/path/sww.env
helm upgrade --install sww charts/spaceworks-workspace --namespace sww \
  --set existingSecret=sww-runtime \
  --set image.tag=sha-<commit> --set migration.image.tag=sha-<commit> \
  --values /secure/path/values-production.yaml --wait --timeout 10m
```

| Value | Default | Purpose |
| --- | --- | --- |
| `existingSecret` | `""` | Secret with the runtime environment (required unless `secret.create`) |
| `secret.create` / `secret.data` | `false` / `{}` | Let the chart create that Secret (evaluation only) |
| `image.repository` / `image.tag` | GHCR app image / appVersion | Use immutable `sha-<commit>` tags |
| `migration.enabled` / `migration.image.*` | `true` / GHCR backend image | `prisma migrate deploy` hook before every rollout |
| `scheduler.enabled` / `scheduler.schedule` | `true` / `* * * * *` | CronJob calling `/api/internal/outbox` and `/api/internal/jobs` |
| `replicaCount`, `autoscaling.*`, `podDisruptionBudget.*` | 2, off, on | Scale. Several replicas need Redis for rate limits and realtime |
| `ingress.*` | off | Disable proxy buffering for `/api/realtime` (SSE) |
