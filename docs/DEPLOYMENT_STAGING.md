# Isolated staging deployment

[Documentation index](README.md)

Use a dedicated host, database, bucket and credentials. Staging must never use
production tenant data or secrets. The root development Compose file is a
separate local environment; `compose.production.yml` is the supported VPS stack.

Copy `.env.staging.example` to `.env.staging`, mode 600. Match the PostgreSQL and
Redis passwords to their connection URLs. Staging exposes HTTP only at
`127.0.0.1:3001`; terminate HTTPS with your host proxy. Mailpit stays private at
`127.0.0.1:8025`. The explicit CI-only TLS exception is for disposable tests.

```bash
docker compose --env-file .env.staging -f compose.staging.yml up -d postgres redis silo mailpit
docker compose --env-file .env.staging -f compose.staging.yml run --rm silo-init
docker compose --env-file .env.staging -f compose.staging.yml build app migrate
docker compose --env-file .env.staging -f compose.staging.yml run --rm migrate
docker compose --env-file .env.staging -f compose.staging.yml up -d app
curl --fail http://127.0.0.1:3001/api/health
```

Exercise tenant denial, member roles, MFA, upload rejection, invitation/reset
email, job recovery, streaming and a restore before promoting a release. Behind
Nginx preserve Host, overwrite `X-Real-IP`, set `X-Forwarded-Proto` and disable
proxy buffering. Do not expose PostgreSQL, Redis or Silo ports publicly.
