# Kubernetes

The Helm chart uses the published backend image for web, migrations and scheduled jobs, at the chart appVersion or your immutable tag. The optional frontend sidecar uses the matching frontend tag. Data services are managed externally; do not publish PostgreSQL, Redis or S3.

```bash
helm lint charts/spaceworks-workspace --set existingSecret=sww-runtime
helm upgrade --install sww charts/spaceworks-workspace \
  --set existingSecret=sww-runtime \
  --set image.tag=X.Y.Z-main.RUN.SHA12 \
  --set migration.image.tag=X.Y.Z-main.RUN.SHA12 \
  --set frontend.enabled=true
```

Create an external runtime Secret containing the app configuration from [CONFIGURATION.md](CONFIGURATION.md). Use `migration.existingSecret` for a separate maintenance secret with DIRECT_URL and DATABASE_URL; otherwise the hook uses existingSecret. Never grant the web identity schema ownership merely to make the hook work. The pre-install/pre-upgrade hook runs the backend `migrate` role. Hook failure blocks deployment.

The scheduler CronJob runs `scheduler --once` with only APP_URL, CRON_SECRET and endpoint selection. It forbids overlapping jobs. The web process can disable its outbox worker when external scheduling handles delivery. Readiness uses the bearer-protected DB check; liveness uses `/api/health`. Non-root containers, dropped capabilities, read-only roots and writable temporary caches are configured. Configure ingress TLS, a trusted forwarding header/hop count, streaming-safe timeouts and upload limits. Review network policies for your provider's DB/Redis/S3 endpoints and SMTP/assistant integrations.

When frontend.enabled is true, the service routes to nginx on 8080; nginx forwards all dynamic paths to localhost:3000. All static assets come from the same backend build. Ingress must replace untrusted forwarding headers and preserve Host. Set frontend.trustedProxyCidr to the ingress source CIDR and use TRUSTED_PROXY_IP_HEADER=x-real-ip with the frontend sidecar. The default series tag is a convenience; pin an immutable release for production. Tune pod resources, replica count, PDB and autoscaling to the cluster. Before updates, snapshot database and object storage; Helm rollback changes application images and does not undo migrations.
