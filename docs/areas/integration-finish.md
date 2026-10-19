# Integration finish

Connects the completed feature areas to the shared shell and services. No schema change is needed.

## Sign-in

Enabled instance providers are loaded on each Auth.js configuration request and shown by name on `/login`. Only an existing enabled user with an active membership in an unarchived workspace can sign in through OIDC. Provider email verification, exact domain restrictions and stable subject linking remain mandatory. The adapter refuses user creation and stores identity identifiers without reusable provider tokens.

MFA remains local: SSO creates a five-minute signed challenge, with no authenticated session user. TOTP or a recovery code completes it through the rate-limited `sso-mfa` credential provider. Disabled users, changed session versions, expired proof and invalid codes fail closed. Google sign-in follows the same MFA completion path. The session cookie advances to v2 so sessions issued before this second-factor contract must sign in again.

Provider setup follows the [Auth.js OIDC configuration contract](https://authjs.dev/guides/configuring-oauth-providers). Configure the callback URL shown in instance admin. Secrets remain encrypted and write-only.

## Navigation and cross-area UI

Pinned links appear as text-only sidebar items, including the mobile navigation sheet; the toolbar retains search and notifications. All areas, personal preferences and administrative settings have role-gated links. Webhooks use notification destinations, rules and delivery logs. Cycles can be enabled in project settings. Linked GitHub repositories render the exported PR/issue panel on project overviews. My day includes services status and counts of unreplied one- and two-star reviews for members and above.

## Retention

`lib/shell/retentionWriters.ts` registers chat content, activity, notifications/deliveries, raw monitor results, assistant conversations, audit, inbound events and outbox writers. Every writer runs under the framework's workspace row lock, serialised with legal-hold changes. Audit records are kept without an explicit DELETE policy. Other non-DELETE policies do not purge content.

Chat removes old text, reactions and global search entries while retaining message envelopes and attachment ownership, so newer replies and file permissions survive. Chat-only uploads with no retained message are soft-deleted and enter the existing file cleanup lifecycle; files still used by newer messages are kept. Assistant retention uses conversation last-update time. Notification retention preserves pending deliveries/digests and their event envelopes. Inbound retention deletes only terminal events (14-day default); outbox retention deletes only terminal jobs (30-day default, configurable per instance). New jobs carry workspace ownership; legacy notification jobs resolve ownership through their delivery rows. Unscoped legacy email jobs are kept while any workspace is held.

Raw monitor results keep at least the services setting, or the longer explicit period. The monitor worker honours the same policy and legal-hold lock for raw data; hourly/daily summaries, metrics and heartbeat cleanup also acquire that lock.

## Search and notification rules

Search writers cover tasks/projects, docs/files, public chat, community records, owner-private CRM names/tags, catalogue, meetings/decisions, ideas and other collaboration records, app reviews, blog and monitor records. The live search registry gates app reviews and incidents to members, checks decision parent meetings, and refuses missing/deleted/foreign records. Vault values and private conversations are excluded.

Workspace rules save rating selections (1–5) with minimum severity. Empty ratings mean any rating; a nonempty rating filter requires a matching event rating. Integration tests exercise the editor action, persisted rule and dispatch planner together.

## Verification and limits

Regression tests cover OIDC callback and MFA completion, legal hold and tenant boundaries, audit preservation, longer monitor retention, rating/severity routing and live search permissions. Outbox retry tests claim explicit job ids and shared integration cleanup removes jobs before cascading tenant rows.

External identity providers and GitHub APIs need operator credentials for live verification. Provider responses are mocked in automated tests. Existing area-specific operational limits remain documented in their area guides.

## Proposed logical commits and cross-area file manifest

Changes remain uncommitted as requested. This integration area has no exclusive ownership row; the following shared and area files are changed for the explicitly authorised finish work.

1. `feat(auth): connect instance OIDC and enforce SSO second factors`
   - `lib/auth.ts`, `lib/authAdapter.ts`, `app/login/page.tsx`, `components/auth/LoginForm.tsx`, `tests/unit/finish-auth.test.ts`: provider wiring, verified identity gating and MFA challenges.
2. `feat(shell): connect completed areas and project summaries`
   - `lib/nav.ts`, `lib/appShell.ts`, `components/chrome/AppShell.tsx`, `components/command-palette/WorkspaceTools.tsx`, `components/settings/SettingsTabs.tsx`, `components/admin/AdminTabs.tsx`, `tests/unit/finish-navigation.test.ts`: reachable role-aware areas and sidebar pins.
   - `lib/dashboard.ts`, `app/w/[workspaceSlug]/page.tsx`: services and app-review summaries.
   - `lib/tasks/{types,schemas,queries}.ts`, `lib/projects/service.ts`, `components/projects/ProjectSettingsForm.tsx`, `components/integrations/GithubPullRequests.tsx`, `app/w/[workspaceSlug]/projects/[key]/(project)/overview/page.tsx`: cycles settings and the linked GitHub panel.
3. `feat(retention): register workspace writers and preserve legal hold`
   - `lib/shell/retention.ts`, `lib/shell/retentionWriters.ts`, `lib/retention.ts`, `lib/scheduled/{shell,integrations}.ts`, `lib/monitor/rollups.ts`, `app/w/[workspaceSlug]/settings/retention/page.tsx`, `components/importer/SettingsForms.tsx`, `tests/integration/finish-retention.db.test.ts`: policy writers, locked purges and accurate settings copy.
   - `lib/outbox.ts`, `lib/notify/dispatch.ts`, `lib/notify/adapters/email.ts`, `lib/invitations.ts`, `lib/finance/service.ts`: explicit tenant ownership on new jobs, and optional claim scope.
4. `fix(integrations): preserve routing filters and isolate outbox tests`
   - `components/notify/RoutingSettings.tsx`, `lib/integrations/routing/service.ts`, `tests/integration/integrations-messaging.db.test.ts`: rating inputs, validation and dispatch regression.
   - `tests/helpers/fixtures.ts`, `tests/integration/{notify-dispatch,community-scheduled}.db.test.ts`, `vitest.integration.config.mts`: job cleanup, scoped worker claims and storage isolation after Prisma generation.
   - `components/people/TemplateEditor.tsx`, `lib/people/onboarding.ts`: the two requested unused-variable warnings.
5. `fix(search): authorise completed areas against live records`
   - `lib/search/query.ts`, `lib/appReviews/ingest.ts`, `tests/integration/finish-search.db.test.ts`: review and incident gates, private CRM and parent-meeting restrictions, plus dashboard/project regression coverage.
6. `docs(workspace): document all completed feature areas`
   - `README.md`, `CHANGELOG.md`, `docs/ARCHITECTURE.md`, `AGENTS.md`, `docs/areas/{integration-finish,platform-shell,monitor}.md`: features, operator contracts and handoff.
   - the unused component in `components/workspace/` (deleted), `docs/DESIGN.md`, `docs/ROADMAP-BUILD.md`: remove the unused placeholder and obsolete references. No route still used it.

Each eventual commit should end with the two co-author trailers specified in the task. No dependencies, schema, migrations, deployment files, Docker configuration or seed registry were changed. Existing per-area demo modules already supply the records used by these integrations.

## Handoff verification

- Lint: passed with zero warnings.
- Typecheck: passed with the requested 4 GB heap.
- Unit suite: 820 passed, one optional Redis pub/sub test skipped because `TEST_REDIS_URL` was unset (58 files).
- Focused integration regressions: 28 passed across retention, search/dashboard/projects and integrations-messaging (three files), including the final attachment-retention change.
- Production build: passed with the requested 4 GB heap; generated build output was removed afterward.
- Required wording scans and the feature-placeholder scan: no matches. `git diff --check` passed.

The final full integration gate remains open. An earlier full run passed all 305 then-existing tests. Later full runs hit local PostgreSQL query/transaction timeouts in existing tasks and first-run setup tests. A clean reset of only the disposable `sww_platform_test` database also timed out; a subsequent attempt to connect and clear stale test connections timed out during connection. No Docker or other-worktree changes were made. Restore responsive local PostgreSQL, reset disposable test records while preserving migrations, and rerun the full integration suite before accepting this phase.

A browser surface and installed Playwright browser were unavailable, so 375px visual/keyboard smoke verification remains outstanding. The temporary application-database browser fixture was removed. Live identity-provider and GitHub credentials were not used; automated provider tests use fixtures/mocks. No feature stubs remain. The v2 session cookie requires users to sign in again after upgrading.
