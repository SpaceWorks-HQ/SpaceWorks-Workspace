# Announcements and personal feeds

Workspace announcements are internal. Every page requires active membership.
Admins and owners create, edit, pin, schedule and delete; members and guests
read published announcements. Drafts and future announcements return 404 to
readers. Rich text is sanitised and notifications use `dispatch()` with the
announcement scoped destination rule.

`lib/scheduled/community.ts` publishes due announcements once per publication
time using transaction advisory locks and stored notification dedupe keys.
The home page uses `latestAnnouncements` for plain-text previews. Search and
activity include published announcements only; realtime refreshes carry ids.

`/w/[workspaceSlug]/calendar/subscribe` manages one PERSONAL feed link.
`/ics/[token]` returns only the subscriber's internal meetings, rota shifts and
assigned task due dates. Tokens are hashed, shown once, regenerated or revoked
by their owner, and checked against current membership, account and workspace
status on every fetch. Legacy non-personal scopes are rejected. Live source
and team visibility apply; guests receive no member-only tasks or shifts.
The feed covers 60 days back and 400 days ahead. Instants use UTC; task due
dates use the workspace day. Responses are private and never cached.

Shared date utilities remain in `lib/community/schedule.ts` for availability
and rota. The RFC 5545 writer escapes content and folds UTF-8 lines at 75 octets.

Tests: community-access, community-schedule and community-ics unit suites;
community-authz, community-scheduled and community-feeds database suites.
