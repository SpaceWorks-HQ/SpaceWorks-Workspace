# syntax=docker/dockerfile:1
#
# Space Works Workspace container images. Targets:
#
#   runner    (default, last stage) the Next.js standalone server, non-root
#   migrator  one-shot `prisma migrate deploy` for release jobs / Helm hooks
#   ops       operator tools for the VPS stack (setup, checks, backups);
#             never serves requests and is never published
#
# The runner image is generic: no hostname or secret is compiled in unless you
# pass NEXT_PUBLIC_BASE_URL as a build argument. Next.js reads the Server
# Actions key from NEXT_SERVER_ACTIONS_ENCRYPTION_KEY at runtime, and a
# production server refuses to start without it (lib/env.ts), so the random
# key Next.js writes into the build manifest is never used in production.
# See docs/CONTAINER_IMAGES.md.

# ── Dependencies ────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# `npm ci` runs the Prisma postinstall hook, which needs the schema.
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npm ci --no-audit --no-fund

# ── Migrations (release job, Helm pre-upgrade hook, VPS `migrator`) ─────────
# scripts/prisma.mjs defaults DIRECT_URL to DATABASE_URL when it is unset.
FROM deps AS migrator
WORKDIR /app
COPY prisma ./prisma
COPY scripts/prisma.mjs ./scripts/prisma.mjs
USER node
CMD ["node", "scripts/prisma.mjs", "migrate", "deploy"]

# ── Operator tools for the VPS stack ────────────────────────────────────────
FROM deps AS ops
RUN apk add --no-cache openssl postgresql16-client
WORKDIR /app
COPY prisma ./prisma
COPY scripts ./scripts
COPY docker/vps ./docker/vps
CMD ["node", "scripts/check-production-env.mjs"]

# ── Pinned Prisma CLI for MIGRATE_ON_START=1 in the runner ──────────────────
# Kept apart from the app's traced node_modules, version from the lockfile.
FROM node:22-alpine AS prisma-cli
WORKDIR /opt/prisma-cli
COPY --from=deps /app/node_modules/prisma/package.json /tmp/prisma-package.json
RUN npm install --omit=dev --no-save --no-audit --no-fund \
      "prisma@$(node -p "require('/tmp/prisma-package.json').version")" \
    && npm cache clean --force

# ── Build ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
# Optional. Only set it to compile a fixed public origin into the image (the
# VPS stack does); leave it empty for a generic image configured at runtime.
ARG NEXT_PUBLIC_BASE_URL=""
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# An empty NEXT_PUBLIC_* variable would be inlined as "" and shadow the
# runtime value, so unset it unless a real origin was given.
RUN if [ -z "$NEXT_PUBLIC_BASE_URL" ]; then unset NEXT_PUBLIC_BASE_URL; fi; \
    npm run build

# ── Runtime (keep LAST: platforms without target selection build it) ─────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
# The scheduler (VPS container, Helm CronJob, Render cron) runs from this image.
COPY scripts/scheduler.mjs ./scripts/scheduler.mjs
# Pinned Prisma CLI for the optional MIGRATE_ON_START=1 path (root-owned).
COPY --from=prisma-cli /opt/prisma-cli/node_modules /opt/prisma-cli/node_modules
COPY --chmod=755 scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Standalone tracing can pick up dotenv files from a developer checkout.
# Secrets belong only in the runtime environment.
RUN rm -f .env .env.local .env.production .env.development

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
