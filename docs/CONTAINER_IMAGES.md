# Container images

[Docker](DEPLOYMENT_DOCKER.md) · [Kubernetes](DEPLOYMENT_KUBERNETES.md)

The **Publish container images** workflow (`.github/workflows/publish-images.yml`)
builds two images for `linux/amd64` and `linux/arm64` and pushes them to the
GitHub Container Registry:

```text
ghcr.io/spaceworks-hq/spaceworks-workspace            Dockerfile target `runner`
ghcr.io/spaceworks-hq/spaceworks-workspace-migrator   Dockerfile target `migrator`
```

It runs after **CI** succeeds for a push to `main`, for version tags
(`v1.2.3`) and on manual dispatch. Pull requests and forks never publish. It
uses the built-in `GITHUB_TOKEN` (`packages: write`); no other secret is needed.

## Tags

| Event | Tags (both images) |
| --- | --- |
| Push to `main` (after CI) | `sha-<first 12 characters of the commit>` |
| Tag `v1.2.3` | `sha-<commit>` and `1.2.3` |

There is no `latest`. Deploy an immutable tag, or better the digest shown in
the workflow summary. The app and migrator of one release always share a tag.

## The runner image is generic

No hostname, key or credential is compiled in:

- `NEXT_PUBLIC_BASE_URL` is only used on the server, so when the build
  argument is absent the value is read from the runtime environment.
- Next.js reads `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` at runtime, and a
  production server refuses to start without it (`lib/env.ts`), so the random
  key Next.js writes into the build manifest is never used.

One image can therefore serve any number of instances. Keep packages private
while the repository is private (the default for a private repository); a
server pulls with a token that has only `read:packages`:

```bash
echo "$TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
```

The VPS stack builds its own images from the release source and does not
need the registry.

## Manual build

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t ghcr.io/spaceworks-hq/spaceworks-workspace:sha-<commit> --push .
docker buildx build --platform linux/amd64,linux/arm64 --target migrator -t ghcr.io/spaceworks-hq/spaceworks-workspace-migrator:sha-<commit> --push .
```

## Contents

| | runner | migrator |
| --- | --- | --- |
| Base | `node:22-alpine` | `node:22-alpine` |
| User | `nextjs` (1001) | `node` (1000) |
| Includes | `.next/standalone`, static assets, `prisma/`, pinned Prisma CLI for `MIGRATE_ON_START`, `scripts/scheduler.mjs` | full `node_modules`, `prisma/`, `scripts/prisma.mjs` |
| Entry | `docker-entrypoint.sh node server.js` | `node scripts/prisma.mjs migrate deploy` |
| Health | `HEALTHCHECK` on `/api/health` | none |

Changing anything under `.github/workflows/` needs a GitHub credential with
the `workflow` scope (`gh auth refresh -s workflow`); pushing over SSH works too.
