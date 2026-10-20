# Internal team calendar

`/w/[workspaceSlug]/calendar` combines internal work dates. Work → Calendar is shown to MEMBER and above. Guests can open the route or their personal feed, but see only meetings they attend, tasks they created or were assigned, and their own reminders. Every page and action resolves workspace membership again. No public events, lending, bookings, membership billing or new finance system is introduced.

The desktop calendar offers day, week, month and agenda views. Small screens show an agenda in every view. Date headings accept arrow keys and Enter; task buttons open the existing task drawer. Dragging a task to a date delegates the change to the existing task service, retaining task activity, indexing, private-team checks and realtime updates. The drawer provides the keyboard and touch alternative. Due dates are stored in the workspace time zone; the view can use the workspace, profile or UTC zone. Layer controls have word labels and brand token colours. Search, person, team, project and only-mine filters apply to the current range. The sidebar shows unfinished tasks assigned to the viewer in the current workspace week. CSV export includes the filtered period and protects spreadsheet formula cells.

Layers read existing Meeting, Task, Availability, Shift, Cycle, Subscription, VaultItem and MaintenanceWindow models. Maintenance uses the monitor area's recurrence calculator. Rotation reminders use only the viewer's owned vault metadata; secret values are never queried. Task and cycle projects respect private teams and archived projects. Availability titles omit absence notes; find-a-time returns busy intervals without source titles, reasons, notes or locations. CalendarEntry adds manually maintained statutory/filing deadlines and personal reminders. Only admins create deadlines; personal reminders stay owner-only, including for admins. Deadlines may be private, team-visible or workspace-visible. CalendarEntry search and activity authorise the live source; the assistant also checks live calendar access.

## Meetings

The calendar extends the existing Meeting model with project, video URL, time zone, external email recipients, invitation sequence and reminder state. MeetingAttendee remains the internal RSVP source (YES / MAYBE / NO). Existing meeting pages continue to own agendas, notes, decisions, attendance and action items. Their create/update path also emits calendar invitations. The calendar form supports a visible agenda template, members and guests, pasted HTTPS video links, location, team/project and a finite daily/weekly/biweekly/monthly series ending on a selected date. A series contains at most 100 meetings over at most one year. Recurrence keeps wall-clock time in the selected zone, skips nonexistent DST times and invalid month dates, and materialises each occurrence in one transaction. Editing or cancellation affects the selected occurrence. Cancellation is idempotent; removing an invitee sends that invitee a cancellation.

`meeting.scheduled`, `meeting.updated`, `meeting.cancelled`, `meeting.reminder` and `calendar.reminder` pass through dispatch. Meeting recipients are filtered by current membership and meeting visibility. Restricted meetings disable workspace broadcast rules. Personal notification preferences determine in-app, email and linked messaging delivery. Meeting invitations also enqueue transactional email with a Nodemailer iCalendar attachment: METHOD:REQUEST or METHOD:CANCEL, stable meeting UID, increasing SEQUENCE, UTC instants, RFC text escaping and UTF-8 line folding. Invitations and notification records commit with the meeting. The outbox retains its existing delivery retries and validation.

`lib/scheduled/calendar.ts` claims reminders conditionally and dispatches in the same transaction; replicas cannot duplicate a claimed reminder. A meeting edit resets its reminder. Calendar entry reminders notify their owner. Existing notification preferences still apply. The shared scheduler registers the new area.

## Optional Google Calendar

Members can connect their own Google account from the calendar using existing encrypted OAuth state, token encryption/refresh and the callback. Google state consumption accepts members only for Google; other integration role checks are unchanged. Calendar free/busy scope is requested, so previously connected accounts may need reconnection. The calendar never borrows another user's workspace integration as the current member's account. Calendar-only consent requests calendar scopes, marks the connection as personal, and excludes it from workspace-wide Google tool selection.

Sync is explicitly started with “Sync my Google Calendar”. This pushes visible attended workspace meetings into the member's primary calendar. Existing bindings are revisited by the scheduler about every five minutes; later meetings are then included too. Each member gets an independent copy and deterministic provider id. Provider ETags protect writes. Local sequence changes take precedence over remote edits; when the sequence is unchanged, an organiser's remote title/time/location/cancellation updates the source meeting and sends updated invitations. Other attendees can import their own RSVP but cannot edit the source. The calendar shows the viewer's Google busy blocks; scheduling checks each selected member's connected account and suppresses suggestions if a provider check fails. Provider payloads and tokens never enter logs. A Google Meet link can be requested while saving when connected; asynchronous provider creation may become visible on the next sync. All provider tests mock fetch.

Google API references: [event insertion](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [free/busy](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query), [synchronisation](https://developers.google.com/workspace/calendar/api/guides/sync). This implementation polls bound individual events with ETags, rather than maintaining a calendar-wide sync token or webhook.

The existing hashed personal ICS capability route is preserved. Feeds now additionally include visible subscription renewals and calendar deadlines/reminders; meeting SEQUENCE is included. Current workspace membership and record visibility are checked on every request. Feed tokens are returned once, never stored raw or indexed.

## Proof files

Calendar entries support up to 20 image/PDF attachments, drag-and-drop, a mobile camera input and authorised preview/download links. Uploads use uploadWorkspaceFile, the instance storage size policy and image validation. Downloads use the existing private file route, which checks the current parent calendar entry audience. Calendar files are excluded from the general file library and library retention purge; orphan uploads cannot be downloaded. No separate public bucket is used. Attachments on a recurring entry belong to its first occurrence. An entry owner edits files; readers can preview authorised attachments. Calendar records do not generate PDFs or contain money amounts.

## Cross-area edits

Required shared hooks: Prisma schema and one team_calendar migration; Work navigation; role helpers and tests; notification catalogue; outbox/email iCalendar support; scheduler registry; live global search and assistant authorisation; private file/library checks; Google OAuth scope/member callback access; personal ICS feed extension; existing meeting create/update invitation hooks. No README, deployment files, dependencies, seed runner, Docker, browser, push or merge changes.

The seed module adds Indian community-office planning, a TDS review date, grant report review and a private volunteer handover reminder. It is repeatable and sends no invitations.

## Operational limits and verification notes

- This is a manual scheduling tool. Working hours in find-a-time default to 09:00–18:00, Monday to Friday, and can be changed per search. It does not infer holidays, payroll or statutory filing dates.
- Each calendar source is bounded to 1,000 records per period, with a visible warning; use a shorter range for dense calendars. Personal feeds retain their existing 500-row source bounds. Busy Google events may duplicate a workspace meeting's busy interval; merging prevents duplicate conflicts.
- Google sync covers bound personal copies, not arbitrary external events as new workspace meetings. Busy blocks represent other Google events. A removed/suspended member cannot perform subsequent sync. Already exported personal copies are not remotely erased when workspace access ends.
- Both calendar-created series and the older meeting form use the shared wall-clock recurrence expansion.
- Browser visual and assistive-technology testing was not run, as instructed. Responsive layout and accessible controls were inspected in code.
- The required repository brand scan has inherited substring matches in the existing notepad model identifiers. These are unrelated to the calendar; no unrelated model was renamed to silence that scan.
- During local setup an unfiltered diff against the reused databases dropped unrelated pre-existing tables absent from this checkout. The deliverable migration was corrected to contain only calendar additions, and the local migration checksums were reconciled. Any data previously held in those unrelated local tables was not recovered. The corrected migration does not contain those drops. Affected local tables in `sww_workcollab` and `sww_workcollab_test`: `HelpTicket`, `HelpTicketComment`, `OpsAccessEntry`, `OpsAccessReview`, `SafetyFollowUp`, `SafetyReport`, `SpaceChecklist`, `SpaceChecklistRun`, `SpaceChecklistSignOff` and `VolunteerLog`, plus their seven associated enums.

## Changes outside the route/component/service ownership folders

- `app/actions/calendar.ts`: authenticated, rate-limited calendar mutations and availability/Google actions.
- `prisma/schema.prisma`: required Meeting extensions, CalendarEntry and CalendarMeetingSync relations. The single area-owned migration adds only those fields and tables.
- `lib/nav.ts`, `lib/roles.ts`: Work navigation and scheduling/deadline capability gates.
- `lib/notify/events.ts`, `lib/scheduled/index.ts`, `lib/scheduled/calendar.ts`: event catalogue and reminder/sync jobs.
- `lib/outbox.ts`, `lib/email/templates.ts`, `lib/email/send.ts`: validated iCalendar attachments using the existing email outbox and transport.
- `lib/meetings/service.ts`: invitations and sequence updates from existing meeting forms, RSVP sync state, shared recurrence and agenda-template audience validation.
- `lib/integrations/google/oauth.ts`, `lib/integrations/google/tokens.ts`: calendar-only member consent, free/busy scope and separation from shared workspace accounts.
- `lib/community/feeds.ts`, `lib/community/ics.ts`: renewals/reminders and meeting revisions in existing personal feeds.
- `lib/files.ts`, `lib/files/service.ts`, `lib/files/versions.ts`: parent-record download permissions and exclusion of calendar proofs from the library.
- `lib/search/query.ts`, `lib/assistant/tools/workspace.ts`: live calendar source permissions, including owner-only reminders.
- `docs/areas/work-collaboration.md`: correct the recurrence contract after sharing the calendar algorithm.
- `scripts/seed/team-calendar.mjs`, `tests/unit/team-calendar-algorithms.test.ts`, `tests/integration/team-calendar-flow.db.test.ts`, this document: the requested seed, regression tests and area documentation.

## Logical commits prepared, left uncommitted

1. `feat(calendar): add internal calendar layers and accessible views` — route, aggregation, filters, task drawer/drag, entry editing, private proofs, navigation and read permissions.
2. `feat(calendar): schedule recurring meetings with invitations and Google sync` — model migration, recurrence, availability, RSVP, dispatch, outbox attachments, Google ownership boundaries and scheduler/feed hooks.
3. `test(calendar): cover scheduling isolation and add office demo dates` — unit/integration regressions, seed and area contracts.

No commit, push or merge was performed, following the final sandbox instruction.

## Verification results

- Lint: pass with zero ESLint warnings; additional OAuth/assistant/UI checks also pass.
- Typecheck: pass with the required 4 GB Node heap setting.
- Unit tests: 844 passed, one pre-existing skipped test, 62 files.
- Full PostgreSQL integration suite: 326 passed, 35 files.
- Calendar, meetings and integration regression suites with Silo enabled: 63 passed, including all 19 new calendar flows. Every Google request is mocked.
- Both databases migrated; the corrected migration exactly matches a schema diff against this worktree's original base.
- Demo seed: two runs preserve one meeting and three dates.
- Commit-message brand scan: no output. Repository scan: 31 inherited substring matches, the same count as the baseline; this gate is not clean.
- Production build: pass, including a final cached build after the last source edits; generated `.next` output removed.
- The final full lint, typecheck, unit and integration commands were repeated after the last source edits and passed with the counts above.
- Additional date coverage includes long maintenance spans; week boundaries use local midnight on each side of a daylight saving change.
