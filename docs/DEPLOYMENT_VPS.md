# Install Space Works Workspace

Use a 64-bit Linux server (x86_64 or arm64) with at least 8 GiB free disk, a hostname pointing to it and root or sudo access. Ubuntu/Debian, Fedora/RHEL/Alma/Rocky, Arch and openSUSE families are supported. curl or wget and tar must exist before installation. macOS and Windows need Docker Desktop; run Windows host operations inside WSL2.

```bash
curl -fsSL https://raw.githubusercontent.com/SpaceWorks-HQ/SpaceWorks-Workspace/main/install.sh | bash
```

The installer downloads a pinned runtime bundle from the latest published GitHub release. It never clones the source or builds on your server. The three images support linux/amd64 and linux/arm64. The default directory is `/opt/spaceworks-workspace`. To use another path, set `SPACEWORKS_WORKSPACE_DIR` on the bash process:

```bash
curl -fsSL https://raw.githubusercontent.com/SpaceWorks-HQ/SpaceWorks-Workspace/main/install.sh | SPACEWORKS_WORKSPACE_DIR="$HOME/spaceworks-workspace" bash
```

## Questions and confirmation

Nothing is installed, pulled or configured before the summary is confirmed. The temporary bundle contains the shared questionnaire. Enter accepts each displayed default; secrets use hidden input.

1. **Hosting model:** this server, split hosts, or cloud services. Cloud defaults to external data services, which you provision first.
2. **Split role:** backend or frontend. On a frontend host, enter the remote backend HTTPS origin. nginx forwards every dynamic route to it; Next.js rendering and Server Actions continue running on the backend. Both hosts use matching image versions. The backend questionnaire also asks for a distinct backend origin hostname and the frontend host’s outbound IP/CIDR. Point that backend hostname to the backend server. Only that frontend CIDR may forward the website Host and client identity; the remote connection verifies the backend TLS certificate. The backend origin must be reachable from the frontend host. Preserve the website Host header through both proxies.
3. **Website hostname or IP:** no scheme, port or path. The public origin is HTTPS. For an IP/LAN install, provide a trusted certificate through your existing proxy; public ACME certificates normally require DNS.
4. **HTTPS:** automatic Caddy certificates, existing proxy, or HTTP only. The app's production guard requires HTTPS, so selecting HTTP explains the requirement and returns to this question. Local HTTP development uses `scripts/dev.sh`. No production security guard is bypassed.
5. **Certificate email:** used for automatic Caddy TLS. Point DNS to the host before starting.
6. **Shape:** separate frontend/backend, or one application container containing nginx, Next.js and its scheduler. The latter still uses separate PostgreSQL, Redis and storage services. Split hosts use separate images.
7. **Database:** bundled PostgreSQL 16, or external. Supply separate TLS runtime and direct/session migration URLs for managed services. The runtime identity should have DML rights only. Supabase transaction pooling needs `pgbouncer=true`; migrations must use port 5432, not the 6543 transaction pooler.
8. **Redis:** bundled TLS Redis, or an external `rediss://` URL (Upstash, ElastiCache or DigitalOcean Valkey).
9. **Storage:** bundled private Silo, or external S3. For external storage, enter the HTTPS endpoint, region, private bucket, key pair and addressing mode. R2 uses region `auto`. The installer never changes external bucket policies. Enable versioning in the provider dashboard. Workspace files are served only through the app's authenticated `/api/files/[id]` route; there is no public Silo route or console port.
10. **Email:** SMTP or skip. SMTP asks for host, port, implicit TLS mode, username, password and sender. Set these later under `/admin` if skipped.
11. **First owner:** instance owner email. Open `/setup` after installation to create the account; no password or demo account is inserted by scripts.
12. **Assistant:** optional Anthropic API key; configure it later in instance settings if skipped.
13. **Google OAuth:** optional client ID and secret. Register `https://<website>/api/auth/callback/google` with Google.
14. **Update repository:** default `SpaceWorks-HQ/SpaceWorks-Workspace`, or your fork. curl installs pin this before fetching code with `--repo` or `SWW_REPOSITORY`.
15. **Deploy runner:** optional, default No. Linux/systemd only. A short-lived runner registration token is requested after confirmation; it is neither printed nor saved.
16. **Backup schedule:** optional daily systemd timer or cron. Backups run as the install owner and serialize with updates/restores.

The summary lists answers with secrets hidden, services, DNS/proxy requirements and host actions. `Proceed?` defaults to No. After yes, the installer checks the selected edge ports, ensures Docker and Compose, copies the release, generates private settings and internal certificates, pulls images, migrates and waits for authenticated readiness.

## Ports and private state

Automatic HTTPS publishes TCP 80/443 and UDP 443 for HTTP/3. An existing proxy forwards to `127.0.0.1:8080` by default; it must preserve Host and set `X-Forwarded-Proto: https`. Configure `SWW_TRUSTED_PROXY_CIDR` to the proxy's actual source CIDR. Never expose that HTTP listener to untrusted clients.

Data services publish no ports. Separate `edge`, internal `jobs` and internal `data` networks limit connectivity. Internal PostgreSQL/Redis/Silo use a generated private CA; its key never enters the app. Runtime DB access uses a separate `sww_app` role with no schema ownership or role/database creation privileges. The scheduler has only its bearer token, with no database/storage credentials.

`config/` and `.env` are private. `.env` records deployment choices; `config/app.env`, `migrate.env`, `postgres.env`, `storage.env`, `storage-init.env`, `scheduler.env` and TLS keys hold secrets. Files are mode 600, directories 700. Keep an encrypted copy off-server. Never change encryption keys casually. Renew internal service certificates before their one-year expiry with `bash scripts/renew-certificates.sh`.

## Forks and private repositories

```bash
curl -fsSL https://raw.githubusercontent.com/SpaceWorks-HQ/SpaceWorks-Workspace/main/install.sh | bash -s -- --repo YourOwner/YourFork
```

A fork must run Continuous Release on `main` once before installation. Images default to its lowercased owner and the same three package names. Public repositories and public GHCR packages need no login. For a private repository export `SWW_GITHUB_TOKEN` with repository read and package read access. The installer uses it for release downloads and `docker login ghcr.io --password-stdin`. Do not put the token in a command URL or commit it. Configure the same token in the update service environment if future automatic downloads require it.

## Existing installations

Rerunning the installer offers update, service review, both, cancel or runner registration. A nonempty directory without a version marker is refused. The service review links to `scripts/reconfigure.sh`, which changes edge/container shape while preserving secrets. Data endpoint changes require a planned migration and edits to private configuration; the questionnaire never silently replaces an existing database.

A clone uses the same questions through `bash setup.sh`. `bash setup.sh --build` is explicit source-build opt-in. PowerShell runs `setup.ps1` through Docker Desktop's WSL2 integration. See [operations](production-operations.md) for updates, rollback and recovery.
