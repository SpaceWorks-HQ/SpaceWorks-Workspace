# Internal operations scope

Workspace keeps internal coordination: tasks, announcements, meetings, rota,
finance, asset records and physical access holders. Member-facing events,
equipment lending and reservations, recognition walls and publishing belong
in the other Space Works products.

The `remove_member_facing` migration removes the retired tables, types and
columns. Meetings and shifts retain their rows and lose only their former
community links. Asset inventory is retained; retired lending/reservation
statuses become AVAILABLE. Maintenance history and physical access holders
remain. Personal feed tokens remain usable; non-personal tokens are removed.
Associated search/activity/link records and queued notifications are cleaned
up so removed content cannot be resurfaced or delivered. Former publication
covers are marked deleted through the existing private-file lifecycle.

No replacement routes, compatibility tools or feature stubs remain. Existing
URLs resolve to the normal missing-page response. The personal feed settings
remain under `calendar/subscribe`, linked from Personal navigation.

README hand-off: remove equipment lending/reservations, the community calendar
and responses/waitlists, shoutouts, and the publishing CMS/public site/RSS/
sitemap. Keep the internal asset and access registers, personal subscriptions,
meetings and rota. Google account calendar integration is retained for internal
work; it does not create community calendar records.

Verification constraints: the exact required repository brand grep matches
pre-existing private-notepad model identifiers because of a substring in that name.
The matches include migration history, which this task explicitly preserves.
The exact repository grep has 26 matches on both the starting branch and
the result, with zero new matching lines. The commit-message grep has no matches. Browser checks are excluded by the
area task; mobile and accessibility review is static.

Shared and neighbouring files changed outside the direct feature folders:

- `app/account/page.tsx`
- `app/actions/workspace-settings.ts`
- `app/globals.css`
- `app/robots.ts`
- `app/w/[workspaceSlug]/activity/page.tsx`
- `app/w/[workspaceSlug]/changelog/page.tsx`
- `app/w/[workspaceSlug]/meetings/[meetingId]/page.tsx`
- `app/w/[workspaceSlug]/meetings/page.tsx`
- `app/w/[workspaceSlug]/members/[userId]/page.tsx`
- `app/w/[workspaceSlug]/page.tsx`
- `app/w/[workspaceSlug]/search/page.tsx`
- `app/w/[workspaceSlug]/settings/page.tsx`
- `components/chrome/AuthFrame.tsx`
- `components/command-palette/QuickCreate.tsx`
- `components/contacts/RelationshipViews.tsx`
- `components/settings/GeneralSettingsForm.tsx`
- `docs/MCP.md`
- `lib/accountExport.ts`
- `lib/apiTokens/scopes.ts`
- `lib/assistant/cron.ts`
- `lib/assistant/prompt.ts`
- `lib/assistant/skills.ts`
- `lib/assistant/tools/workspace.ts`
- `lib/changelog/service.ts`
- `lib/contacts/contacts.ts`
- `lib/dashboard.ts`
- `lib/files/service.ts`
- `lib/finance/service.ts`
- `lib/meetings/service.ts`
- `lib/nav.ts`
- `lib/notifications.ts`
- `lib/notify/events.ts`
- `lib/notify/types.ts`
- `lib/people/checklistItems.ts`
- `lib/people/onboarding.ts`
- `lib/people/profiles.ts`
- `lib/roles.ts`
- `lib/scheduled/community.ts`
- `lib/scheduled/finance.ts`
- `lib/scheduled/financeBlog.ts`
- `lib/scheduled/index.ts`
- `lib/scheduled/opsMoney.ts`
- `lib/search/query.ts`
- `lib/shell/export.ts`
- `lib/shell/messages.ts`
- `lib/shell/tools.ts`
- `lib/storage/index.ts`
- `lib/validation.ts`
- `scripts/seed-demo.mjs`

Additional shared docs, neighbouring seeds and tests:

- `AGENTS.md`
- `CHANGELOG.md`
- `docs/ARCHITECTURE.md`
- `docs/DESIGN.md`
- `docs/ROADMAP-BUILD.md`
- `scripts/seed/assistant.mjs`
- `scripts/seed/chat.mjs`
- `tests/integration/chat-access.db.test.ts`
- `tests/integration/notify-dispatch.db.test.ts`
- `tests/integration/people-relationships.db.test.ts`
- `tests/integration/work-collaboration-flow.db.test.ts`
- `tests/unit/finish-navigation.test.ts`
- `tests/unit/nav.test.ts`
- `tests/unit/notify-routing.test.ts`
- `tests/unit/people-relationships.test.ts`
- `tests/unit/roles.test.ts`

These changes remove shared navigation and shortcuts, notification/search/tool
exposure, profile/dashboard panels, exports, settings and cross-area links.
`prisma/schema.prisma` plus the single new migration are required to remove
the retired data model. The neighbouring area docs and root architecture,
roadmap, design, agent guide and changelog describe the resulting contract.
Tests retain finance, announcements, internal records and personal-feed
coverage while deleting cases for the retired features.

`scripts/seed-demo.mjs` required a narrow exception to the usual seed-registry
rule: it directly wrote the removed models before invoking any area module.
Only those obsolete writes and the removed workspace setting were deleted;
the registry itself is unchanged. README, deployment and release files remain
untouched.

Suggested logical commits (all changes intentionally remain uncommitted):

1. `refactor(workspace): remove member-facing feature surfaces` — retired
   routes, actions, services, components, assistant tool and feature tests.
2. `refactor(operations): retain internal records and personal feeds` — asset
   register, physical access, maintenance, meeting/shift detachment, source
   visibility and regression tests; the `remove_member_facing` migration.
3. `refactor(platform): remove retired feature integrations` — shared nav,
   palette, notifications, search, dashboards, profiles, exports, settings,
   seeds and their tests. Finance scheduling and tests are renamed to finance.
4. `docs(workspace): describe the internal operations scope` — agent guide,
   architecture, roadmap, design, changelog, area contracts and README hand-off.

Local `.env` was created from `.env.example` for the assigned services and
port; it remains ignored and uncommitted. The runtime checks use Node 22
to match the repository CI and Docker configuration.

Verification result:

- Lint: pass, zero warnings.
- Typecheck: pass (next typegen and tsc --noEmit).
- Unit: 820 passed, one pre-existing skip across 60 files.
- Production build: pass on Node 22; generated output removed afterwards.
- Migration: deployed to both assigned databases; no Prisma schema drift.
  Five preservation assertions passed for meetings, shifts, assets,
  maintenance and physical keys.
- Demo registry: complete seed passed, including the retained internal data.
- Integration sign-off is blocked: the complete pre-outage run had 289 passes
  and four timing failures in existing docs/vault workflows. The new asset
  register and all six personal-feed checks passed. Reruns hit different
  timing failures, then Postgres, Redis and Silo all became unreachable.
  The Node 22 rerun could not complete while Postgres refused connections.
- No browser checks were run, as required by the area task.
