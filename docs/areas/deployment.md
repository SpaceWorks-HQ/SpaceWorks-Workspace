# Deployment, packages and README

The supported VPS topology is the root production Compose stack: a backend
runner image and a separate Next.js rendering frontend, with TLS PostgreSQL,
TLS Redis, private Silo, Caddy and independent outbox/jobs recovery ticks.
Single-runtime and Netlify frontend layouts share the same operator tooling.

The curl installer collects/validates choices before its confirmation summary.
The existing-install menu covers updates with image rollback, backups and age/
S3 copies, status, settings rollback, host hardening, the restricted Actions
runner, super-admin recovery, redacted support and deliberate uninstall.
Root-only recovery writes a hashed, one-hour, single-use PasswordResetToken,
clears MFA/recovery codes and increments the account session version atomically.
No schema change is required.

`VERSION` controls releases. CI publishes amd64/arm64 backend/frontend packages
and releases only tested source. Docker image builds, real installer smoke and
browser tests run in CI. Developer verification avoids those workloads locally.

The frontend is generated from shared UI, with a checked-in fixed route/action
catalog and structural DTO types. View loaders retain page auth/tenant/MFA
checks on the backend. Pure renderers, thin actions and resource/API proxies
hold no persistence credentials. Private operational routes stay blocked;
resource handlers outside `/api` have an exact allowlist. Direct SSE consumes
a hashed, one-use Redis ticket bound to user, tenant and session version.

`npm run frontend:catalog` regenerates contracts after source changes. Generated
frontend source trees are ignored and build traces reject persistence clients.
The README includes generated brand artwork and screenshot paths; the operator
capture script signs in to an already seeded demo instance. Screenshots must
be captured outside constrained development machines.

See [VPS](../DEPLOYMENT_VPS.md), [Split](../DEPLOYMENT_SPLIT.md),
[Images](../CONTAINER_IMAGES.md) and [Configuration](../CONFIGURATION.md).

## Shared application changes

These files are outside deployment/release/README ownership and are needed by
the separately hosted rendering workspace:

- Action revalidation forwarding: `app/actions/account.ts`, `app/actions/admin.ts`, `app/actions/apiTokens.ts`, `app/actions/appReviews.ts`, `app/actions/assistant.ts`, `app/actions/blog.ts`, `app/actions/boardroom.ts`, `app/actions/chat.ts`, `app/actions/community.ts`, `app/actions/docs.ts`, `app/actions/exports.ts`, `app/actions/files.ts`, `app/actions/finance.ts`, `app/actions/integrations.ts`, `app/actions/links.ts`, `app/actions/messaging.ts`, `app/actions/notificationPreferences.ts`, `app/actions/notificationRouting.ts`, `app/actions/notifications.ts`, `app/actions/platformShell.ts`, `app/actions/projects.ts`, `app/actions/seo.ts`, `app/actions/services.ts`, `app/actions/views.ts`, `app/actions/workspace-settings.ts`. The wrapper preserves backend invalidation and returns the same paths to the frontend.
- Shared action contexts: `lib/approvals/action.ts`, `lib/meetings/action.ts`, and `lib/people/actionContext.ts` use the same revalidation wrapper.
- Safe view inputs and outputs: `app/account/page.tsx`, `app/admin/page.tsx`, `app/invite/[token]/page.tsx`, `app/page.tsx`, `app/w/[workspaceSlug]/app-reviews/settings/page.tsx`, `app/w/[workspaceSlug]/assistant/c/[conversationId]/page.tsx`, `app/w/[workspaceSlug]/assistant/jobs/page.tsx`, `app/w/[workspaceSlug]/boardroom/page.tsx`, `app/w/[workspaceSlug]/cycles/[cycleId]/page.tsx`, `app/w/[workspaceSlug]/files/page.tsx`, `app/w/[workspaceSlug]/requests/approvals/page.tsx`, `app/w/[workspaceSlug]/requests/page.tsx`, and `app/w/[workspaceSlug]/subscriptions/page.tsx` resolve server-only configuration, async data and safe flags before rendering. No secret-bearing settings object crosses hosts.
- Nested guarded readers: `components/integrations/GithubPullRequests.tsx`, `components/requests/ApprovalInbox.tsx`, and new `lib/views/**` retain tenant checks on backend reads.
- Direct realtime authentication: `app/api/realtime/[workspaceSlug]/route.ts`, new `app/api/realtime/[workspaceSlug]/ticket/route.ts`, and `components/realtime/useRealtime.ts` implement the one-use ticket flow.
- Gateway platform integration: `proxy.ts`, `next.config.ts`, `lib/env.ts`, `lib/pageSecurity.ts`, `lib/rateLimit.ts`, and new `lib/frontend/**` enforce the backend deployment mode, peer identity, original IP, body bounds and direct-stream CSP origin.
- `components/brand/Patch.tsx` changes only a comment caught by the required brand check.

## Reviewable change groups

The work is deliberately uncommitted, as requested. Suggested logical commits:

1. `feat(deploy): replace release images and VPS operations` — Docker, Compose, installer/menu, operator scripts, recovery, provider manifests, release/quality workflows and deployment tests; remove obsolete release files.
2. `feat(frontend): add isolated rendering workspace and private gateway` — generated catalogs/contracts, guarded readers, thin actions, proxies, realtime tickets, shared application adaptations and hosting tests.
3. `docs(workspace): rewrite deployment guides and illustrated README` — documentation, generated banners/swatches and the operator screenshot capture script.

Screenshot captures and real container/browser smoke are operator/CI steps;
there are no placeholder screenshot images. The exact required tracked-source
brand grep matches the pre-existing notepad model identifier and applied
notepad migration (the expression matches a substring inside the name). This
change does not rename that model or rewrite an applied migration.

## Local verification

- Database deploy and disposable test preparation passed; schema verification checked 175 models.
- Lint and root/frontend typechecks passed.
- Unit tests: 65 files passed, 878 tests passed, 1 skipped.
- PostgreSQL integration tests: 37 files and 329 tests passed; the final guarded-view fixture was rerun separately (4 passed).
- Root production build and standalone frontend production build passed. The frontend trace check found no database engine, Redis, mail or storage client. Generated build directories were removed afterward.
- Deployment syntax: 78 scripts/manifests passed, including shell syntax, ShellCheck, Node module syntax and YAML. Both artwork generators ran successfully; existing application brand assets reproduced without changes.
- Helm lint/template passed. Compose config passed for automatic TLS/Silo, internal TLS/Silo and external proxy/storage, without starting containers.
- Installer help, validation, configuration generation, recovery, redaction and transport checks are covered by the passing unit/integration suites.
- Container builds, real installer smoke and browser suites were not run locally, as required; the quality workflow runs them on GitHub. Screenshots await the orchestrator's capture.
- Commit-message brand grep: empty. Exact tracked-source brand grep: 26 baseline substring matches in five unchanged notepad/search/schema/migration/test files. New-file brand scan: empty.
