# Docker deployment

Space Works Workspace publishes three matching images:

| Image | Purpose | Container port |
| --- | --- | --- |
| `ghcr.io/spaceworks-hq/spaceworks-workspace-backend` | Next.js standalone server and operator roles | 3000 |
| `ghcr.io/spaceworks-hq/spaceworks-workspace-frontend` | nginx, Next static files, reverse proxy | 8080 |
| `ghcr.io/spaceworks-hq/spaceworks-workspace-allinone` | backend and nginx supervised together, optional scheduler | 8080 |

The backend is built once for each architecture. Both other images copy its exact assets. The frontend serves `/_next/static/` with immutable caching; unversioned public files revalidate. gzip is available, including precompressed assets when present. All pages, API, Server Actions, SSE, MCP, image optimisation and downloads are forwarded with buffering disabled. Upstream CSP/nonces and private caching remain intact. The nginx configs do not add a second CSP. Access logs are disabled to protect bearer URLs.

Every image runs without root. The all-in-one supervisor forwards shutdown and exits if any essential child exits. `SWW_SCHEDULER_ENABLED=0` disables its scheduler when a separate scheduler is configured. `BACKEND_UPSTREAM` defaults to `http://backend:3000`; the all-in-one uses `127.0.0.1:3000`.

## Backend roles

```bash
docker run --env-file runtime.env IMAGE:VERSION web
docker run --rm --env-file maintenance.env IMAGE:VERSION migrate
docker run --rm --env-file scheduler.env IMAGE:VERSION scheduler --once
docker run --rm --env-file runtime.env IMAGE:VERSION ops node /app/scripts/check-production-env.mjs
```

`web` is the default. `migrate` uses the bundled Prisma CLI pinned to 6.19.3 and `DIRECT_URL` (fallback `DATABASE_URL`). Migrations never run inside `web`. `scheduler` triggers the two internal bearer-protected job endpoints. `ops` requires an explicit command and is intended for trusted operator use. Unknown roles fail. Image builds accept no application secrets or public origin. Set `NEXT_PUBLIC_BASE_URL` and `AUTH_URL` to the same HTTPS origin at runtime.

## Compose files

| File | Use |
| --- | --- |
| `docker-compose.yml` | Development PostgreSQL, Redis, Silo and Mailpit |
| `docker-compose.dev.yml` | Containerised Next.js development and tests |
| `docker-compose.prod.yml` | Published images with bundled data services |
| `docker-compose.cloud.yml` | Published app images with all managed data services |
| `docker/compose.single.yml` | Supervised all-in-one application |
| `docker/compose.tls.yml` | Caddy automatic HTTPS and HTTP/3 |
| `docker/compose.api-only.yml` | Backend-host edge for split hosting |
| `docker/compose.api-only-edge.yml` | Caddy is the only split-backend listener |
| `docker/compose.frontend-only.yml` | Remote nginx host with no app credentials |
| `docker/compose.external-{database,redis,storage}.yml` | Independently disable bundled dependencies |
| `docker/compose.build.yml` | Build from a complete source checkout |

Compose 2.24.4+ is required for merge replacement tags. The wrapper reads saved choices and applies the right overlays:

```bash
bash setup.sh
bash scripts/spaceworks-workspace-compose.sh ps
bash scripts/spaceworks-workspace-compose.sh logs --tail 100 backend
```

It rejects arbitrary Compose file/env overrides. Do not manually activate `*-disabled` profiles. Only edges publish ports. External managed services require egress from app/migration containers; the bundled data network stays internal. There is no SaaS overlay because tenancy is application-level `/w/<slug>` and has no deployment-specific subdomain mode.

## Local build and smoke

```bash
bash scripts/test-release-local.sh
```

This builds the backend once, derives the matching frontend/all-in-one, creates a throwaway runtime bundle, runs the real installer with file-driven answers, verifies both shapes over an internal test TLS edge, and tears down only its own Compose projects and volumes. It uses non-conflicting ports and unique network subnets. It does not modify an existing installation.
