# Kubernetes deployment

Use [the Helm chart](../charts/spaceworks-workspace/README.md). It runs the
backend image as the whole application, with a one-shot `migrate` Job and a
worker Deployment and single-replica beat Deployment. Supply external TLS PostgreSQL,
persistent no-eviction TLS Redis, private S3 and authenticated SMTP. Runtime secrets stay outside Helm.

```bash
helm upgrade --install sww charts/spaceworks-workspace \
  --set existingSecret=sww-runtime \
  --set image.tag=<immutable-release> \
  --set ingress.enabled=true
```

Keep action keys stable across replicas. The migration role uses its own secret
when configured; runtime roles need no DDL permissions. Ingress must preserve
Host, overwrite the trusted IP header and avoid buffering streams. Probes use
public liveness and bearer-protected readiness. Retain a database/object/config
backup before upgrades: Helm rollback does not reverse migrations.

The chart matches the single-runtime layout. A separately deployed frontend
uses a dedicated Deployment and Secret with the settings in
[Netlify + VPS](DEPLOYMENT_SPLIT.md); do not share backend credentials with it.

The default image tag is the rolling `0.1` series for evaluation. Pin a release
for production. The non-root runtime needs a writable image overlay to replace
its public-origin placeholders before serving; capabilities remain dropped and
privilege escalation is disabled.

The worker and beat use the runtime Secret and the same release as web. Their
private `/health` probes on port 3460 never get a Service or Ingress. Set
`worker.replicas` for capacity and `QUEUE_*_CONCURRENCY` in the runtime Secret.
Termination allows 600 seconds to drain. Disable both flags only if equivalent
processes run elsewhere; external HTTP cron replaces beat only, never worker.
See [background jobs](areas/jobs-queue.md) for failure recovery and Redis sizing.
