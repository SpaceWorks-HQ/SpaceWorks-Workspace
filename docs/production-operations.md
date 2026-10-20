# Production operations

Run host commands as the installation owner from `/opt/spaceworks-workspace` (or your chosen directory). Private configuration is never executed as shell code. The shared lock serializes updates, backups, restore and certificate renewal; do not delete a lock owned by a live process.

## Check and update

```bash
bash scripts/spaceworks-workspace-compose.sh ps -a
bash scripts/spaceworks-workspace-compose.sh logs --tail 100 migrate backend scheduler
bash scripts/update.sh --force
bash scripts/update.sh --version X.Y.Z-main.RUN.SHA12
```

The updater verifies a published, non-draft, non-prerelease immutable release, downloads its runtime bundle, creates a coordinated database/object/config backup, pulls pinned images, preserves replaced host files under `backups/host-config-*`, stops writers, applies migrations and checks authenticated readiness. It commits the image tag and version marker only after success. Failed migration containers remain for inspection.

If deployment fails it attempts to restart the prior application images and restore prior host tooling. Forward migrations remain applied. It never automatically rewinds the database. Keep migrations compatible with the previous release; use an offline restore when schema rollback is unavoidable. If image rollback fails, stop the edge and inspect migration/backend logs before recovery. Never use a blanket Docker prune during an incident.

## Back up

```bash
bash scripts/backup.sh
```

The backup stops writers, makes a PostgreSQL custom dump, copies current private object bytes, includes config/TLS/continuity keys, writes a SHA-256 file manifest and atomically publishes a mode-600 archive in `backups/`. It restarts writers on failure. The default retention is 14 days (`SWW_BACKUP_KEEP_DAYS`). Backups contain credentials and private data; encrypt them and keep an off-server copy with independent access controls. Checksums detect corruption; they do not authenticate an archive from an untrusted person. Accept archives only from your trusted backup store. Bucket version history is outside this current-state snapshot; retain provider-native versioning/PITR separately.

PostgreSQL client 16 is bundled. External servers newer than 16 need a matching/newer dump client; provision a provider-native backup before using such a database. A dump/version mismatch aborts updates rather than proceeding without a backup. Remote S3 backup requires list/get and restore requires put/delete for the selected private bucket. Keep enough host disk for an extracted snapshot plus its archive and a pre-restore snapshot.

Install an optional daily timer/cron with `bash scripts/setup-host-orchestration.sh`. The timer runs as the install owner around 03:15, with jitter and missed-run recovery on systemd. Monitor `systemctl status spaceworks-workspace-backup.timer` and the service journal, or `backups/schedule.log` for cron. macOS cron is supported; Windows backup/recovery runs in WSL2.

## Restore and import

This replaces current rows and object bytes. Pause deploys and verify the selected archive and target host first. Keep the original continuity keys safe. Use the same storage topology (bundled Silo versus external S3) and a compatible app/schema version as the archive; change endpoints only through a separately reviewed migration.

```bash
bash scripts/restore.sh backups/spaceworks-workspace-TIMESTAMP.tar.gz --confirm-replace
# On a replacement backend host configured with target data credentials:
bash scripts/import-backup.sh /secure/archive.tar.gz --confirm-replace
```

The verifier rejects traversal, links, incomplete manifests and checksum mismatches before stopping writers. Restore takes a mandatory current-state backup, stops all writers, restores through the target maintenance connection, restores object bytes and copies only continuity keys from the archive. Target DB/storage credentials remain in place. Do not discard the archive's configuration: it is needed if rebuilding the original endpoints. A failed restore keeps writers offline; inspect logs and restore the safety snapshot before reopening the edge. A successful readiness check is followed by manual sign-in, MFA, encrypted settings and private-download checks. Schedule a restore drill against an isolated project.

## Certificates and secrets

`bash scripts/renew-certificates.sh` renews internal service certificates under the existing CA and restarts selected services. Run it before the one-year expiry. The CA expires after ten years; plan a separate trust-anchor replacement before then. Caddy renews public certificates automatically. For an existing reverse proxy, its operator owns public renewal.

Keep `MFA_ENCRYPTION_KEY`, `INTEGRATION_ENCRYPTION_KEY` and `VAULT_MASTER_KEY` backed up. Losing them loses encrypted data. Rotating them without re-encryption makes existing data unreadable. Changing AUTH_SECRET invalidates sessions. Keep NEXT_SERVER_ACTIONS_ENCRYPTION_KEY consistent across replicas and updates.

## Optional GitHub Actions runner

```bash
bash scripts/install-runner.sh
# Remove its registration and service, retaining files:
bash scripts/install-runner.sh --remove
```

Linux/systemd only. The helper downloads the official x64/arm64 Actions runner and verifies its published SHA-256 before extraction. Registration/removal tokens use hidden input and the supported token environment input, never command arguments. The default directory is `/opt/spaceworks-workspace-runner` (`SWW_RUNNER_DIR` overrides it). The service runs as the install owner and uses the deployment path in `SPACEWORKS_WORKSPACE_DIR`.

Set `SWW_DEPLOY=true` in repository Actions variables, use the `production` environment's protection rules, and require approval for all external contributors. Restrict the runner/group to this repository and release.yml on main wherever available. Keep pull-request workflows on hosted runners. A runner with Docker access controls the host; [GitHub's guidance](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners) recommends against production self-hosted runners for public repositories. Keep runner auto-updates enabled.
