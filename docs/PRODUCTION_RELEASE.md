# Production release

[Documentation index](README.md) · [Container images](CONTAINER_IMAGES.md)

A reviewed feature lands in `dev`; only a maintainer merges to production
`main`. Bump `VERSION` for a new release series. The first successful main build
of that VERSION publishes a GitHub Release after both multi-platform images
are tagged. Later main builds publish images without another release. A manual
non-main build is a pre-release and never deploys automatically.

## Validate the release

Run lint, root/frontend typecheck and builds, unit tests, migrated PostgreSQL
integration tests and installer tests. CI additionally builds both images and
smoke-tests the real Compose topology, gateway, private storage and migrations.
Keep Docker builds and browsers off memory-constrained developer machines.
Review schema compatibility and take a verified backup before rollout.

Confirm canonical HTTPS, trusted proxy behavior, TLS data connections,
least-privileged runtime roles, private storage, SMTP and independent recovery
jobs. Preserve action, MFA, integration and vault keys. Review provider access,
retention/legal hold, capacity and off-server recovery arrangements.

## Deploy and accept

The VPS updater backs up first, fetches images while the old release runs,
migrates, starts and checks services, then advances `current`. It restores old
images/settings if checks fail. Migrations are not reversed. Record the source
revision, image tag/digest, backup point and person responsible for recovery.
For Netlify deploy the identical revision after the backend update.

Verify setup/invites, login/logout, password reset, TOTP step-up, task changes,
chat reconnect, private file and document export, finance restrictions, public
blog/status, webhooks and assistant streaming. Exercise denial across tenants
and after suspension/session revocation. Verify real mail delivery and job
heartbeats. Test off-server restore in isolation and record recovery time and
possible data loss. Do not use the production database for automated test suites.
