# Social media analytics and comments

## Routes and access

- `/w/[workspaceSlug]/social`: overview, 7/28/90-day periods, platform filter,
  follower snapshots and deltas, reported metrics, daily chart/table, top posts.
- `/w/[workspaceSlug]/social/accounts/[accountId]`: account status, daily metrics,
  posts with sortable metric columns and pagination.
- `/w/[workspaceSlug]/social/comments`: unified paginated inbox; platform,
  account, status, unanswered, assignee and text/author filters.
- `/w/[workspaceSlug]/social/comments/[commentId]`: original post, thread,
  public reply preview, assignment, seen status and permitted moderation.
- `/w/[workspaceSlug]/settings/social`: ADMIN account connections, OAuth asset
  selection, permissions, test/sync, webhook subscription, expiry and sync logs.
- `/api/social/oauth/[platform]/callback`: session-bound single-use OAuth.
- `/api/social/meta`: optional verified webhook handshake and signed event wakeup.

`canViewSocial` and `canManageSocial` require MEMBER; `canConnectSocial` requires
ADMIN. Every workspace page resolves membership itself. Queries filter by
workspaceId, and composite account/post relations reject foreign-workspace
rows in PostgreSQL. Public callback/webhook routes have their own authentication
or capability validation. No browser receives encrypted or plaintext account
tokens, OAuth selection credentials, refresh tokens or PKCE verifiers.

## Data and sync

One migration, `social`, appends `SocialAccount`, `SocialMetricDaily`,
`SocialPost`, `SocialComment`, `SocialSyncLog`, `SocialConnectionDraft`, enums
and workspace relations. Actor and assignee ids follow the existing plain-id
convention. Assignees are validated as current active members, excluding guests.

`lib/social/providers` contains the five official adapters. `lib/social/sync`
claims an account with a durable compare-and-set lease, collects partial
results, and transactionally upserts tenant-scoped records. Daily metrics have
one value per account/date/metric; posts and comments use provider ids. Local
triage survives a refresh. Our own comments and known reply ids do not generate
new inbox events. A disconnect invalidates in-flight sync claims and removes
credentials. Failed persistence never advances cursors.

`lib/scheduled/social.ts` runs through the shared scheduler. It refreshes due
accounts every 15 minutes, daily reports once a day, and expires transient
OAuth selections/state. Older post pages and comment/reply pages retain
cursors. Recent posts are checked alongside a rotating set of older stored
posts. Provider rate headers defer subsequent work; transient errors back off;
permission/token problems have clear account messages.

Replies have a durable single-flight claim. Confirmed provider success records
the response id, text, actor and time with an audit event. Unknown outcomes
remain blocked rather than being resent. An admin can open the original
discussion and reconcile a verified sent/not-sent outcome. Recently started
requests have a ten-minute protection window. Moderation locks can likewise be
released after checking the platform. All external writes require an explicit
UI review or confirmation; assistant tools remain read only.

`social.comment.received`, `social.reply.failed`, `social.token.expiring` route
through `dispatch()` and existing workspace notification rules. Payloads carry
ids only. Configure Social event rules in Settings → Notifications. There is
no new transport or direct Slack/Telegram send path.

## Assistant and demo

`sw_social_overview` and `sw_list_social_comments` are registered with MEMBER
minimum access and the `read:social` API scope. External text is labelled
untrusted. Both use safe account projections; neither writes or returns tokens.

`scripts/seed/social.mjs` automatically loads via the existing seed loader.
It adds five DEMO accounts, 91 days of sample metrics, posts and comments with
triage/reply examples. DEMO accounts contain no credentials and cannot send or
sync. The module is idempotent and refuses production use.

## Shared integration edits

The explicit area task authorises the schema/migration, role helpers,
Operations navigation, notification catalogue, scheduler registry and assistant
registry changes. Supporting edits add dedicated crypto purposes, the
`read:social` API token scope, and the settings navigation tab. No deployment,
README, calendar, meetings or community implementation was changed.

## Verification and limits

Unit tests cover official response-shaped fixtures, missing metrics, rate
headers, signature verification, reply limits, weighted X text and capabilities.
Integration tests replace fetch and cover state replay, token encryption,
selection ownership, PostgreSQL tenant constraints, sync claims/idempotence,
partial 429 outcomes, role/tenant isolation, replies, moderation, refresh-token
rotation, webhook backoff and disconnect races.

Fixtures use sanitised official response shapes with synthetic data; they are
not recordings from real accounts. No test calls a real platform API. Live
acceptance still needs each approved app and operator credentials. No browser
was run, as instructed; 375px layout and keyboard/screen-reader behavior use
existing primitives, semantic labels, stacking controls, scrollable tables and
a chart data-table fallback, but have not received visual browser QA.

See [SOCIAL.md](../SOCIAL.md) for app registration, scopes, redirects, pinned
versions, paid-access constraints, collection bounds and metric semantics.
Meta's documentation host rejected automated reads during implementation;
verify its current metric availability against the approved app. No unofficial
API or scraping fallback exists.

The brief's repository grep has an inherited false-positive conflict:
the existing private-note model name contains the substring matched by the unbounded prohibited
three-letter alternative. Those existing model references and the existing
notepad migration are outside this area's scope and are preserved.

## Verified handoff — 20 October 2026

- `npm run lint -- --max-warnings=0`: passed, no lint warnings.
- `NODE_OPTIONS=--max-old-space-size=4096 npm run typecheck`: passed.
- `npm run test:unit -- --maxWorkers=2`: 916 passed, one existing skipped test.
- `npm run test:integration`: 354 passed across 37 files, including all 17 Social tests.
- `NODE_OPTIONS=--max-old-space-size=4096 npm run build`: passed; generated `.next` removed afterward.
- App and disposable-test migrations: applied, no pending migrations.
- Demo seed run twice in a temporary workspace: five DEMO accounts, 2,730
  metrics, 20 posts and 20 comments; temporary workspace removed.
- Commit-message hard-rule scan: no matches. Repository scan: 31 matching
  tracked lines, all already present in HEAD; no matches introduced by this
  area. New Social files were separately scanned as well.

Earlier integration attempts encountered database shutdowns/timeouts; the final
complete integration rerun passed. No live platform APIs or browsers were used
for verification. Changes remain uncommitted, as requested.
