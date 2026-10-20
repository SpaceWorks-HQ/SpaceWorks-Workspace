# syntax=docker/dockerfile:1.7
ARG SWW_BACKEND_BUILD=ghcr.io/spaceworks-hq/spaceworks-workspace-backend:latest
FROM ${SWW_BACKEND_BUILD} AS backend-build
FROM nginx:stable-alpine
RUN apk add --no-cache gettext && mkdir -p /srv/www/_next/static
COPY --from=backend-build /app/.next/static /srv/www/_next/static
COPY --from=backend-build /app/frontend-public /srv/www
COPY docker/frontend/nginx.conf /etc/nginx/templates/workspace.conf.template
COPY docker/frontend/nginx-main.conf /etc/nginx/nginx.conf
COPY --chmod=755 docker/frontend/docker-entrypoint.d/30-configure-upstream.sh /docker-entrypoint.d/30-configure-upstream.sh
COPY --chmod=755 docker/frontend/run.sh /usr/local/bin/workspace-frontend
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=8 CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
ENTRYPOINT ["workspace-frontend"]
