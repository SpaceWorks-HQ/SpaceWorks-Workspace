# Host Space Works Workspace on a VPS

[Configuration](CONFIGURATION.md) · [Operations](production-operations.md) · [Docker image](DEPLOYMENT_DOCKER.md) · [Cloud](DEPLOYMENT_CLOUD.md) · [AWS](DEPLOYMENT_AWS.md) · [Kubernetes](DEPLOYMENT_KUBERNETES.md)

This is the recommended way to run Space Works Workspace for one community:
one Linux server with Docker, installed by a guided script. The production
stack (`compose.production.yml`) contains:

| Service | Image | Role |
| --- | --- | --- |
| `proxy` | `caddy:2-alpine` | Public HTTPS with automatic certificates, HTTP/2 and HTTP/3. The only service that publishes ports (80, 443/tcp, 443/udp) |
| `app` | built from this release (`runner` target) | Next.js server, non-root, read-only filesystem |
| `migrator` | built from this release (`migrator` target) | One-shot `prisma migrate deploy` before the app starts |
| `scheduler` | the app image | Calls `/api/internal/outbox` and `/api/internal/jobs` every minute with `CRON_SECRET` |
| `postgres` | `postgres:16-alpine` | Database, TLS only, separate migration and runtime roles |
| `redis` | `redis:7-alpine` | Rate limits and realtime fan-out, TLS and password only |
| `storage` | `pgsty/silo:RELEASE.2026-09-16T00-00-00Z` | Private S3-compatible file storage, TLS only, versioned bucket |
| `storage-init` | `pgsty/mc:RELEASE.2026-09-16T00-00-00Z` | Creates the private bucket and a bucket-scoped app identity |
| `ops`, `storage-backup`, `offsite` | tools profile | Checks, backups and restores, run on demand |

Networks are segmented: `edge` (proxy and app, plus the app's outbound
internet for email, AI and OAuth), `jobs` (internal: scheduler to app) and
`data` (internal: app, migrator and tools to PostgreSQL, Redis and Silo). The
data services trust a private certificate authority generated at install time;
the CA key never enters a container. The app's database role cannot create
databases, roles or schemas. Secrets live outside the source tree, in an
owner-only configuration directory (default `/etc/spaceworks-workspace`).

## What you need

- A Linux server: Ubuntu 22.04/24.04 or Debian 12 for the automatic Docker
  install (any distribution works with Docker Engine and Compose v2.24+ already
  installed). Start with **2 vCPU, 4 GB RAM, 40 GB SSD**; building the image
  on a 2 GB server needs swap.
- A hostname such as `work.example.org` with an **A** record (and **AAAA**
  if the server has IPv6) pointing at the server. Use DNS-only records: Caddy
  must receive the client connection directly.
- Inbound TCP 80 and 443 and UDP 443 open; SSH restricted to administrators.
  Close everything else. Never publish the database, Redis or storage ports.
- Optional: an authenticated SMTP relay (Brevo, Postmark, SES, Mailgun) with
  SPF, DKIM and DMARC on your sending domain. You can add it later in `/admin`.
- Optional: an Anthropic API key for the assistant (also settable in `/admin`).

## Install with one command

On the server, as a user with `sudo`:

```bash
SWW_REF=main   # better: a reviewed commit or release tag
curl -fsSL "https://raw.githubusercontent.com/SpaceWorks-HQ/SpaceWorks-Workspace/$SWW_REF/install.sh" -o install.sh
less install.sh                      # read what you are about to run
sudo bash install.sh --ref "$SWW_REF"
```

While the repository is private, give the installer a read-only token (a
fine-grained token with **Contents: read** on this repository). It is sent
only to `api.github.com` and never written to disk:

```bash
curl -fsSL -H "Authorization: Bearer $TOKEN" \
  "https://raw.githubusercontent.com/SpaceWorks-HQ/SpaceWorks-Workspace/$SWW_REF/install.sh" -o install.sh
sudo SWW_GITHUB_TOKEN="$TOKEN" bash install.sh --ref "$SWW_REF"
```

The installer:

1. resolves `--ref` to one commit and downloads exactly that tarball into
   `/opt/spaceworks-workspace/releases/<commit>`;
2. runs the release's guided setup (`scripts/setup-vps.sh`), which asks for
   the hostname, the instance admin email, the configuration directory, SMTP
   (optional, password hidden) and an Anthropic API key (optional, hidden);
3. shows a summary and asks before changing anything;
4. installs Docker Engine and Compose from Docker's apt repository when they
   are missing (Ubuntu/Debian, after asking);
5. generates every secret (`AUTH_SECRET`, `MFA_ENCRYPTION_KEY`,
   `INTEGRATION_ENCRYPTION_KEY`, `VAULT_MASTER_KEY`, `CRON_SECRET`,
   `HEALTHCHECK_SECRET`, `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, database,
   Redis and storage credentials) and the internal CA, without printing them;
6. builds the images, applies migrations, starts the stack and waits until
   every service is healthy;
7. runs the operator checks (database TLS, least-privileged role, migrations,
   Redis TLS and auth, private bucket, readiness, outbox and jobs endpoints);
8. offers to install the daily backup timer;
9. points `/opt/spaceworks-workspace/current` at the release and prints the
   **`https://<host>/setup`** link.

Open that link right away: `/setup` creates the owner account and the first
workspace (with #general, #announcements and #random) and closes for good once
any account exists. Then:

- sign in with the admin email you gave the installer and enable two-step
  verification; `/admin` asks for a fresh code each time;
- in **/admin → Settings**, check email (send a test) and the assistant key;
- invite members from **Settings → Invitations** in the workspace;
- copy `/etc/spaceworks-workspace` to your password manager or encrypted
  off-server storage. Losing `MFA_ENCRYPTION_KEY` makes every authenticator
  and encrypted setting unreadable.

### Installer options

| Option | Default | Meaning |
| --- | --- | --- |
| `--ref REF` | `main` | Commit, tag or branch to install |
| `--directory DIR` | `/opt/spaceworks-workspace` | Where releases and `current` live |
| `--update` | off | Upgrade an existing installation (see below) |
| `--repository OWNER/REPO` | `SpaceWorks-HQ/SpaceWorks-Workspace` | Install from a fork |

### Unattended install (cloud-init, Terraform)

Every prompt can be answered with an environment variable. With
`SWW_NONINTERACTIVE=1` nothing is asked:

```bash
sudo SWW_NONINTERACTIVE=1 SWW_GITHUB_TOKEN="$TOKEN" \
  SWW_DOMAIN=work.example.org SWW_ADMIN_EMAIL=you@example.org \
  SWW_CONFIGURE_SMTP=y SWW_EMAIL_FROM='Space Works <workspace@example.org>' \
  SWW_SMTP_HOST=smtp-relay.brevo.com SWW_SMTP_PORT=587 SWW_SMTP_USER=login@smtp-brevo.com \
  SWW_SMTP_PASSWORD="$SMTP_KEY" SWW_INSTALL_DOCKER=y SWW_BACKUP_TIMER=y \
  bash install.sh --ref "$SWW_REF"
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `SWW_DOMAIN`, `SWW_ADMIN_EMAIL` | required | Public hostname and instance admin |
| `SWW_CONFIG_DIR` | `/etc/spaceworks-workspace` | External configuration directory |
| `SWW_CONFIGURE_SMTP` | `y` (asks) | `n` to set email later in `/admin` |
| `SWW_EMAIL_FROM`, `SWW_SMTP_HOST`, `SWW_SMTP_PORT`, `SWW_SMTP_USER`, `SWW_SMTP_PASSWORD` | | SMTP relay; `SWW_SMTP_TLS=y` for implicit TLS (465) |
| `SWW_ANTHROPIC_API_KEY` | empty | Assistant key |
| `SWW_INSTALL_DOCKER`, `SWW_BACKUP_TIMER` | `y` | Install Docker / the backup timer when needed |
| `SWW_CADDY_TLS` | `acme` | `internal` uses Caddy's own CA (test servers without public DNS) |
| `SWW_HTTP_PORT`, `SWW_HTTPS_PORT`, `SWW_BIND_PREFIX`, `SWW_PROJECT` | 80, 443, all addresses, `spaceworks-workspace` | Run beside other services or for local trials |

Pass secrets through your provider's secret mechanism rather than plain
user-data where possible, and delete them from the instance metadata afterwards.

### From a git checkout instead

```bash
git clone git@github.com:SpaceWorks-HQ/SpaceWorks-Workspace.git && cd SpaceWorks-Workspace
git checkout <reviewed-commit>
sudo bash scripts/setup-vps.sh
```

Setup refuses to run when the configuration directory already holds a
configuration: it never replaces secrets. If setup failed after generating
configuration, fix the reported problem and continue with the manual commands
below rather than running setup again.

## Day-to-day commands

Run from `/opt/spaceworks-workspace/current` (or your checkout).
`scripts/vps-compose.sh` is Docker Compose with the production file and the
external configuration (`SWW_CONFIG_DIR`, default `/etc/spaceworks-workspace`):

```bash
cd /opt/spaceworks-workspace/current
sudo scripts/vps-compose.sh ps
sudo scripts/vps-compose.sh logs -f app scheduler
sudo scripts/vps-compose.sh run --rm --no-deps ops node docker/vps/check.mjs     # operator checks
sudo scripts/vps-compose.sh restart app
sudo scripts/vps-compose.sh up -d --wait                                         # start everything
```

Never run `docker compose down --volumes` or `vps-compose.sh down -v` on an
installation you want to keep: that deletes the database and files.

## Upgrades

```bash
curl -fsSL "https://raw.githubusercontent.com/SpaceWorks-HQ/SpaceWorks-Workspace/<new-ref>/install.sh" -o install.sh
sudo bash install.sh --ref <new-ref> --update
```

`--update` downloads the new release next to the old one and runs its
`scripts/update-vps.sh`:

1. **Backup**: database dump (verified with `pg_restore --list`), storage
   archive and configuration archive (`SWW_UPDATE_SKIP_STORAGE_BACKUP=1` skips
   storage on large installations with their own storage backups).
2. **New release**: only `SWW_VERSION` changes in `compose.env`; secrets,
   hostname and volumes stay. Images are built under the new version label,
   so the previous images remain for rollback.
3. **Preflight**: the production configuration check.
4. **Migrate**: the new `migrator` runs once while the old app keeps serving.
5. **Swap**: services are recreated and must become healthy; the operator
   checks run again.
6. **Rollback on failure**: the previous `compose.env` is restored and the
   previous release is started from its retained images. The `current`
   symlink only moves after success.

Rollback restores the application, not the database: migrations are not
reversed. If a failed upgrade applied a migration that the old release cannot
work with, restore the pre-upgrade dump the updater names (see below).

Remove old images once a release has proved itself:
`docker image ls 'sww-*'` then `docker image rm sww-app:<old>`.

## Backups and restore

Install the daily timer during setup, or later:

```bash
sudo scripts/vps-backup.sh --install-timer /opt/spaceworks-workspace/current
systemctl list-timers spaceworks-workspace-backup.timer
```

Without systemd, use cron (as root):

```cron
15 3 * * * SWW_CONFIG_DIR=/etc/spaceworks-workspace /opt/spaceworks-workspace/current/scripts/vps-backup.sh --purpose scheduled >> /var/log/spaceworks-workspace-backup.log 2>&1
```

Each run writes to `/etc/spaceworks-workspace/backups`:
`database/sww-<stamp>-<purpose>.dump` (+ `.sha256`), `storage/storage-<stamp>.tar.gz`
(from an incremental `mc mirror` of the bucket) and `config/config-<stamp>.tar.gz`
(every secret, never uploaded anywhere). Archives older than
`SWW_BACKUP_KEEP_DAYS` (in `compose.env`, default 14) are pruned. The bucket
itself is versioned: overwritten or deleted files stay recoverable for 30 days.

Off-site copies: create `/etc/spaceworks-workspace/backup-remote.env`
(mode 600) and every backup also mirrors the database and storage archives to
that bucket:

```bash
MC_HOST_remote='https://ACCESS_KEY:SECRET_KEY@s3.eu-central-003.backblazeb2.com'
REMOTE_BUCKET='my-sww-backups'
REMOTE_PREFIX='work.example.org'
```

Restore (asks you to type the hostname; takes a safety backup first):

```bash
sudo scripts/vps-restore.sh --database /etc/spaceworks-workspace/backups/database/sww-20261019T031500Z-scheduled.dump
sudo scripts/vps-restore.sh --storage  /etc/spaceworks-workspace/backups/storage/storage-20261019T031500Z.tar.gz
```

Rehearse a restore every quarter on a spare server: install with the same
configuration directory copy, restore both archives, sign in and open a few
files. See [production operations](production-operations.md).

## Internal certificates

Caddy renews the public certificate on its own. The internal certificates for
PostgreSQL, Redis and Silo last one year (the private CA ten years). Check and renew:

```bash
sudo openssl x509 -enddate -noout -in /etc/spaceworks-workspace/tls/postgres/public.crt
sudo scripts/vps-renew-certs.sh      # about a minute of downtime
```

## Changing the hostname

1. Point DNS for the new name at the server.
2. In `/etc/spaceworks-workspace/compose.env` set `PUBLIC_HOST` and
   `PUBLIC_ORIGIN`; in `app.env` set `AUTH_URL` and `NEXT_PUBLIC_BASE_URL` to
   the same `https://` origin.
3. Rebuild and restart: `sudo SWW_NONINTERACTIVE=1 bash scripts/update-vps.sh`
   (a new version label is created automatically).
4. Update Google OAuth redirect URIs, the GitHub App and the Telegram webhook.

## Provider notes

- **DigitalOcean Droplet**: Ubuntu 24.04, Basic 2 vCPU / 4 GB. Add a Cloud
  Firewall allowing 22 (your IP), 80, 443/tcp and 443/udp. Paste the
  unattended command into *User data* or run the installer over SSH. Enable
  Droplet backups as a second line of defence.
- **Hetzner Cloud**: CX22/CPX21 or CAX21 (ARM works: every image is
  multi-arch), Ubuntu 24.04, a Hetzner Firewall with the same rules, and
  Hetzner Backups or snapshots.
- **AWS EC2**: see [DEPLOYMENT_AWS.md](DEPLOYMENT_AWS.md).
- **Any VPS**: the installer needs only `curl`, `tar`, `sed` and root once.

## Trying the stack locally

The same scripts run on a laptop with Docker, using Caddy's internal CA and
high ports so nothing clashes with your other services:

```bash
SWW_NONINTERACTIVE=1 SWW_DOMAIN=sww.localhost SWW_ADMIN_EMAIL=you@example.org \
SWW_CONFIG_DIR="$HOME/.sww-trial" SWW_CONFIGURE_SMTP=n SWW_CADDY_TLS=internal \
SWW_HTTP_PORT=18080 SWW_HTTPS_PORT=18443 SWW_BIND_PREFIX=127.0.0.1: SWW_PROJECT=sww-trial \
SWW_BACKUP_TIMER=n bash scripts/setup-vps.sh
curl -k https://sww.localhost:18443/api/health
SWW_CONFIG_DIR="$HOME/.sww-trial" scripts/vps-compose.sh down --volumes && rm -rf "$HOME/.sww-trial"
```

The configuration directory must live outside the source tree (setup refuses
otherwise) because it holds every secret.
