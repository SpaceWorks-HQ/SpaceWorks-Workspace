# Container images and releases

All three GHCR packages support `linux/amd64` and `linux/arm64`:

- `ghcr.io/spaceworks-hq/spaceworks-workspace-backend`
- `ghcr.io/spaceworks-hq/spaceworks-workspace-frontend`
- `ghcr.io/spaceworks-hq/spaceworks-workspace-allinone`

`VERSION` starts at `0.1.0`. Continuous Release builds `X.Y.Z-main.<run>.<sha12>` for each push to main. That immutable tag and `sha-<sha12>` identify the build. Only a changed VERSION or manual main dispatch creates a GitHub Release with the runtime installer bundle. After publication, a run still at main HEAD promotes all three images to `X.Y`, `main` and `latest`. Superseded workflow runs cannot promote rolling tags. Use immutable versions for deployments; image-name overrides and forks keep this same tagging contract.

The workflow first builds the backend for both architectures, then publishes a three-image matrix using that backend as the source. Static assets cannot diverge by an independent Next.js rebuild. Metadata labels identify the source and version. Build caches are scoped per image; QEMU enables the second architecture. No build-time application secret is needed.

The optional deployment job uses the `spaceworks-workspace-prod` self-hosted label, the `production` environment and repository variable `SWW_DEPLOY=true`. It never checks out source or runs third-party actions on the production runner. It invokes the installed updater with an exact version. See the runner instructions in [operations](production-operations.md).

## Retention

Release rows and Git tags are kept. GHCR retains the current build, its SHA tag, the release series, main/latest, and the previous published release. The retention helper discovers child manifests before deleting stale versions so architecture and attestation manifests belonging to retained indexes remain reachable. If discovery fails, it skips deletion for that package. A local deployment also retains its cached previous application images for image rollback. Do not prune those until the replacement is healthy and its backup verified.

Old release rows may outlive their container images. To reinstall an older version whose images were pruned, republish that commit under a new immutable release. The installer follows the newest published release, which can lag continuous main image builds between VERSION changes.

Set GHCR packages to Public for unauthenticated installs. Private forks require `SWW_GITHUB_TOKEN` with repository/package read access. Maintainers can verify publication with:

```bash
GHCR_OWNER=spaceworks-hq bash scripts/verify-release-images.sh X.Y.Z-main.RUN.SHA12
```
