# Community area

Announcements, shoutouts and the community calendar (build nights, meetups,
workshops) with RSVPs, reminders and private calendar feeds.

## Routes

| Route | Min role | Notes |
| --- | --- | --- |
| `announcements` | GUEST | Pinned first, then newest. Admins also see drafts and scheduled ones. |
| `announcements/new`, `announcements/[id]/edit` | ADMIN | Rich text, pin, publish now / schedule / draft, "Send to" picker. |
| `announcements/[id]` | GUEST | Drafts and scheduled ones are 404 for non-admins. |
| `shoutouts` | GUEST | Wall, `?person=<userId>&dir=received\|given`, `?to=<userId>` preselects the composer. |
| `calendar` | GUEST | `?view=month\|week\|list&date=YYYY-MM-DD`, days in the workspace time zone. |
| `calendar/new` | MEMBER | `?date=` preselects the day. |
| `calendar/[eventId]` | GUEST | Details, RSVP, who's coming, waitlist. |
| `calendar/[eventId]/edit` | MEMBER + organiser or admin | |
| `calendar/[eventId]/ics` | member (route handler) | One event as `.ics`. |
| `calendar/subscribe` | GUEST | Create, regenerate and turn off private feed links. |
| `/ics/[token]` (public) | bearer token | `text/calendar`, rate-limited (`apiRead`), 404 for unknown/revoked tokens or ended membership. |

## Roles

- Announcements: ADMIN and OWNER write, pin, schedule and delete. The schema
  has no workspace switch for member-written announcements, so members and
  guests read only (see gaps).
- Events: MEMBER+ create; the organiser or an ADMIN edits and cancels.
- RSVP: everyone including GUEST (a visiting mentor can come to a build
  night). Guests never create or edit events.
- Shoutouts: MEMBER+ give (never to themselves, only to active members);
  the giver or an ADMIN removes. Guests read the wall.
- Calendar feeds: any active member, guests included.

Rules live in `lib/community/access.ts` and are checked inside the services,
so actions, route handlers and tests share them.

## Services (`lib/community/`)

| File | What |
| --- | --- |
| `access.ts` | Capability rules (pure, client-safe). |
| `rsvp.ts` | `resolveRsvp`, `promotionsFor`, `waitlistPosition`, counts (pure). |
| `schedule.ts` | Announcement status, reminder windows, dedupe keys, workspace-zone day keys, month/week grids (pure). |
| `ics.ts` | RFC 5545 writer: UTC instants, all-day dates, escaping, 75-octet folding (pure). |
| `richText.ts` | sanitize-html allowlist for announcement bodies, plain-text previews. |
| `announcements.ts`, `events.ts`, `shoutouts.ts`, `feeds.ts` | Data services taking a `CommunityActor`. |
| `summary.ts` | Read-only helpers for other areas (below). |

### For other areas (`lib/community/summary.ts`)

- `upcomingCommunityEvents(workspaceId, { take, now, userId })` — next
  non-cancelled events with going counts and the viewer's reply.
- `latestAnnouncements(workspaceId, { take, now })` — published only, with a
  plain-text `preview`. **The home dashboard should use this**: it currently
  renders `Announcement.body`, which is now sanitised HTML.
- `shoutoutTotals(workspaceId, userId)` — `{ received, given }` for profiles.
- `recentShoutouts(workspaceId, take)`.

## Notifications

| Event | When | Recipients |
| --- | --- | --- |
| `announcement.published` | Publish now, or the scheduler when a scheduled time passes | All active members in-app, workspace rules, and the announcement's scoped rule (`scope.announcementId`, "Send to" picker via `setScopedDestinations`, event type `announcement.published`). |
| `shoutout.received` | Shoutout given | The person thanked. |
| `event.created` | Event created | Broadcast (workspace rules) only. |
| `event.changed` | Title, time or place changed, or cancelled | Everyone going, maybe or waitlisted. |
| `rsvp.changed` | Waitlisted person promoted | That person. |
| `event.reminder` | 24 h and 1 h before | People going or maybe. |

Idempotency: each publish and reminder has a dedupe key (announcement id +
publish time; event id + reminder + start time). Senders take
`pg_try_advisory_xact_lock(hashtext(key))` and skip when a
`NotificationEventRecord` with that key exists, so every replica can run
`lib/scheduled/community.ts` each minute. Editing an announcement after it
went out never re-sends it; rescheduling a not-yet-sent one sends once at the
new time. A reminder that was already due when the event was created is
skipped (people just got `event.created`).

## RSVP and capacity

`respondToEvent` locks the event row (`SELECT … FOR UPDATE`) so the last
spot cannot be oversold. "Going" on a full event joins the WAITLIST; nobody
jumps the queue; freed spots (someone leaves, the cap rises or is removed)
promote the longest-waiting first. Lowering the cap never bumps anyone.
Replies close when the event starts or is cancelled.

## Time zones

Event and schedule inputs are `datetime-local` values in the workspace zone
(`zonedInputToIso`); nonexistent local times (DST gaps) are rejected with a
message. Calendar days are computed in the workspace zone, including DST
days. ICS files carry UTC instants plus `X-WR-TIMEZONE`; task due dates are
all-day entries on the workspace-zone date. Events without an end are two
hours long.

## ICS feeds

`CalendarFeedToken` scopes: `CALENDAR` (every community event) and
`PERSONAL` (events you replied going/maybe/waitlist, meetings you attend,
your rota shifts, due dates of tasks assigned to you). One active token per
member, workspace and scope; only `sha256(token)` is stored, the URL is
shown once, regenerating revokes the old one. Window: 60 days back, 400
days ahead.

## Realtime, search, activity, audit

- Realtime on `workspace`: `community.announcement.changed`,
  `community.event.changed`, `community.shoutout.changed` (ids only); pages
  refresh through `LiveRefresh`.
- Search: published announcements (`announcement`) and events
  (`community_event`, removed when cancelled).
- Activity: announcement published, event created/cancelled, shoutout given.
- Audit: `announcement.created|updated|pinned|unpinned|deleted`,
  `community_event.created|updated|cancelled`, `shoutout.created|deleted`,
  `calendar_feed.created|regenerated|revoked` (never the token).

## Known gaps

- No workspace setting lets members write announcements (needs a
  `Workspace` column); ADMIN-only until then.
- No read-receipt model, so announcement read receipts are not built.
- Organisers are not notified of each RSVP (kept calm on purpose).
- The home dashboard (`lib/dashboard.ts`, platform-shell) should switch to
  `latestAnnouncements` for HTML-free previews.
