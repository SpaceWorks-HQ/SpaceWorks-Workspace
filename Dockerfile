# syntax=docker/dockerfile:1.7
# Default: generic backend. Release wrappers reuse this exact build and its assets.
ARG SWW_BACKEND_BUILD=ghcr.io/spaceworks-hq/spaceworks-workspace-backend:latest
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npm ci --no-audit --no-fund

FROM deps AS prisma-cli
RUN mkdir -p /opt/prisma-cli && cd /opt/prisma-cli && npm install --omit=dev --no-save --no-audit --no-fund prisma@6.19.3

FROM deps AS builder
ENV NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=6144
COPY . .
# No deployment origin or secret is accepted as a build argument.
RUN npm run build && node scripts/prepare-frontend-assets.mjs

# The release matrix retags the already-built backend without rebuilding Next.js.
FROM ${SWW_BACKEND_BUILD} AS release

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN apk add --no-cache bash tini openssl postgresql16-client curl python3 \
 && addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs
COPY --from=builder --chown=1001:1001 /app/.next/standalone ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/frontend-public ./frontend-public
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=prisma-cli /opt/prisma-cli /opt/prisma-cli
COPY scripts ./scripts
COPY docker/services ./docker/services
COPY --chmod=755 scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN rm -f .env .env.local .env.production .env.development
USER 1001:1001
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=8 CMD ["node", "/app/scripts/container-health.mjs"]
ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]
CMD ["web"]
