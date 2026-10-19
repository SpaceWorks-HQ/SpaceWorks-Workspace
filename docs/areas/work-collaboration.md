# Work collaboration

Cycles, meetings, objectives, polls, ideas, reusable templates, changelog entries and document acknowledgements live under `/w/[workspaceSlug]`. Each page resolves membership on every request; actions resolve the workspace from the slug, check the capability, rate-limit, validate with Zod, then call an area service. Services also check current membership so a stale actor cannot bypass suspension.

## Routes and workflows

- `/cycles` and `/cycles/[cycleId]`: projects with `cyclesEnabled` can plan numbered cycles, assign existing tasks, start a cycle and complete it with optional carry-over. Only unfinished, unarchived tasks move, within the same project. Completion captures the task set before moving it. Reviews can be added after scheduled completion. The burn-up has a text caption and an exact-value data table. During an open cycle its history represents the current task set; completed cycles use the saved snapshot.
- `/meetings` and `/meetings/[meetingId]`: start/end time, location, community event link, facilitator, attendees, RSVP and attendance. Agenda topics have owners, time boxes, notes, status and keyboard-accessible ordering. Notes link a readable workspace Doc. Decisions record context, outcome and accountable member. `/meetings/decisions` searches titles, context and outcomes with workspace and meeting visibility applied before returning results. Facilitators and admins record decisions. Action items create numbered Tasks with `sourceMeetingId`, assignment, due time and a `MeetingActionItem` in one transaction. A request id prevents repeat creation.
- Meeting series support weekly, fortnightly and monthly recurrence, materialised for a chosen 1–24 meetings at creation. The root stores the recurrence rule and all occurrences share its series id. Editing an occurrence affects that occurrence. Recurrence preserves UTC time; the form calls out daylight saving changes. Meeting templates supply ordered agenda topics.
- `/goals` and `/goals/[goalId]`: objectives, owners, periods, parent objectives, numeric/percent/boolean key results, confidence-bearing check-ins, status and links to visible projects/tasks. `YYYY-Qn` filters objectives overlapping a quarter. Normalised progress supports increasing and decreasing targets, clamps to 0–100%, and weights each direct key result and child objective equally. Objective owners and admins make changes.
- `/polls` and `/polls/[pollId]`: single, multiple and ranked choice; anonymous ballots; closing time; live or after-close results; count or percentage quorum in the service contract (the form exposes count); eligibility for contributors, a minimum role or a team. Voting is final. A serializable transaction inserts a unique `(pollId,userId)` receipt and a ballot; anonymous ballot rows have `voterId = null`. All browser results are aggregates, for admins too: no receipts, identities, individual choices or vote timestamps. Ranked choice uses instant runoff, transfers to the next remaining preference, excludes exhausted ballots from a round’s majority, and eliminates the first displayed candidate among tied lowest candidates. A complete tie is reported as a tie.
- `/ideas` and `/ideas/[ideaId]`: submission, tags, upvote toggle, discussion, status, duplicate merging and conversion through the existing task/project services. Merging unions voters, keeps the source and its discussion, and points it at the destination. Converted work uses its owning service’s validation and permissions.
- `/templates`: workspace document, project and task starters, plus meeting agendas. Variables are `{{date}}`, `{{author}}` and `{{workspace}}`. Content is validated and HTML sanitised. Applying uses the existing document/project/task service and returns a link to the created work. Repeating the same request id returns the first result. Team/private templates remain visible according to their scope; creation from these restricted starters is intentionally blocked because the shared Doc model cannot preserve their audience. The UI makes this limit explicit.
- `/changelog`: version, release date, tags, audience, draft editing and publication. Admins deliberately select Send-to destinations. Delivery uses `dispatch` as a custom `digest.ready` event because the shared catalogue has no release event. The chosen destinations are recorded as links. Public entries may create a BlogPost in DRAFT for the blog team to review; this never publishes the blog. Published entries are immutable; corrections use a new entry.
- `/sign` and `/sign/[requestId]`: creators/admins request acknowledgement from a member who can read a Doc. Requests bind the title and HTML to SHA-256 and retain an immutable snapshot, with an existing revision id when available. Only the designated signer can record a typed name, timestamp and workspace-scoped IP hash. No raw IP is stored. A changed document cannot be signed under an old request. Signing/declining is conditional on pending state. Personal reminders go through `dispatch`. This is an internal acknowledgement record, not a qualified electronic signature.

## Permissions and data conventions

Cycles, goals, polls, ideas and templates require MEMBER. Meetings, published changelog entries and acknowledgement pages allow GUEST. Guests can RSVP to meetings they can open and sign their own requests; they cannot create or edit collaboration content.

Workspace/private-team checks apply to projects, cycles, goals and related work. Meeting/decision visibility additionally enforces WORKSPACE, TEAM and PRIVATE; a private meeting is available to its creator and admins. Attendees and facilitators must be able to open the meeting. Restricted meeting summaries go only to currently authorised attendees; broad Send-to choices are available only for workspace meetings without a team restriction. Destination ids are validated with `listPickableDestinations`, and private channels require the actor’s channel membership.

A task cannot inherit a private meeting’s owner-only visibility in the existing Task schema. Private meeting actions therefore stay in notes. Team meeting action tasks require a private project in the same team, so creating a task cannot widen the meeting audience. Other meeting tasks may be projectless and use the canonical `/t/[ref]` route.

The immutable schema’s idea statuses map to product language: NEW → Open, UNDER_REVIEW → In progress, PLANNED → Planned, DONE → Done, DECLINED → Declined. No migration or shared schema edit is needed.

Area-owned metadata uses the existing shared contracts:

- `ActivityEvent` `cycle_review` saves review and task snapshots; later reviews append a new snapshot.
- `ActivityEvent` `idea_comment` holds discussion, scoped to an idea.
- PRIVATE `ActivityEvent` `signature_snapshot` holds the saved document version; reads first authorise the signature request and current Doc access.
- `RecordLink` `goal` links work; `idea` preserves merges; `meeting_action` and `template_application` identify retry results; `collaboration_reminder` claims one periodic reminder per resource/period.
- Search indexes use the source visibility and team/project restrictions. Poll indexes are team-bound for team eligibility and creator-private otherwise, with no ballot content. Audit metadata never contains ballots or signing IPs.

Cross-area creation from templates and ideas delegates to existing services. Those services commit their own transaction; an advisory lock serialises concurrent application/conversion requests. A process failure between the owning service’s commit and recording the result can leave created work without the source link; fully atomic cross-area orchestration needs transaction-aware creation contracts from those owners.

## Scheduled work

`lib/scheduled/collaboration.ts` is already registered by the shared scheduler. Each run scans active workspaces in bounded batches, advances project cycles, captures completion snapshots and carries unfinished work to the next open cycle, closes due polls, reminds nonvoters about closing polls, reminds meeting attendees to add agenda topics, prompts overdue objective check-ins and reminds pending signers. State transitions and event creation share a transaction; serializable retries and unique reminder claims make concurrent replicas safe. Recurring meetings need no background materialisation because their finite series is created atomically.

## Demo and verification

`scripts/seed/work-collaboration.mjs` exports one async seed function with the standard area context. It adds a meeting, agenda, decision, ranked anonymous poll, ideas, objective/key results, all four starter kinds, changelog and an acknowledgement when a workspace Doc exists. A cycle is seeded only when another area has enabled cycles on a project; this seed does not change Project configuration.

Unit tests: `tests/unit/work-collaboration-algorithms.test.ts`. PostgreSQL tests: `tests/integration/work-collaboration-flow.db.test.ts`, covering action tasks, decisions, private visibility, RSVP, agenda ordering, recurrence, vote/close races, anonymous DTOs, eligibility, carry-over, check-ins, merging, template creation, acknowledgement, changelog and suspension. The integration configuration uses only the disposable `sww_workcollab_test` database.

No dependencies, migrations, shared navigation, shared UI primitives or other ownership folders are changed. Project cycle enablement remains the tasks area’s `Project.cyclesEnabled` setting; its current editor does not expose a toggle, so the coordinator must connect that existing field before members can enable cycles themselves.

## Verification recorded for this build

- `npm run lint` and `npm run typecheck`: pass.
- `npm run test:unit`: 410 passed, one pre-existing skipped test.
- `npm run test:integration`: 177 passed across 23 files. `TEST_S3_BUCKET=''` selects the existing development disk fallback; Silo on port 9010 was unavailable, so this run does not verify the S3 transport. The collaboration area itself does not upload files.
- Both existing migrations deployed to `sww_workcollab` and `sww_workcollab_test`. A longer connection timeout was needed while the shared local database was starting.
- Authenticated HTTP smoke checks: all 15 list/detail/index pages rendered successfully. The area demo seed ran repeatedly without duplicate records.
- Production build: pass. Generated `.next` output is removed before hand-off.
- Browser visual/keyboard review at 375px remains unverified: this session has no available browser surface. Layouts use a single responsive column, wrapping controls/navigation, chart data tables and the shared accessible primitives.
