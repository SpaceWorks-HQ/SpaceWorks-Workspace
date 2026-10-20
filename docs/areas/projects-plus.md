# Project milestones, timeline and reports

Simple manual planning extends the existing Project and Task records. No connectors,
new workflow engine or member-facing bookings are added.

Project Overview includes milestones with a target date, notes, manual status and
links to tasks in the same project. A milestone is Done when marked manually or when
all linked tasks are complete. An empty milestone stays at its manual status.
Reopening a linked task reopens an automatically completed milestone. Archived linked
tasks remain visible and count according to their actual completion; archiving is
not completion. Newly linking an archived task is rejected.

Timeline shows task start/due dates and milestone targets on one horizontal schedule.
Below the `sm` breakpoint it becomes a list with the same dates, statuses, owners and
explicit “Blocked by” links. Hidden dependencies disclose only that a restricted
task exists. Tasks may have one endpoint or no dates; undated tasks remain listed.
Start dates are calendar days; due dates retain the existing workspace-time-zone
semantics. Editing either endpoint rejects a reversed span. Existing subtasks,
dependencies, recurrence, cycles and meeting action links remain in their existing
flows; progress counts unarchived top-level tasks once, avoiding double counting
subtasks. Recurrence occurrences keep their existing due-date scheduling and do not
inherit manual blockers or start dates.

Weekly Updates records On track / At risk / Off track, one short note, a blockers
list and next steps. History is immutable and paginated 20 at a time. The due date
is 09:00 in the workspace time zone seven calendar days after the latest update
(or project creation). The scheduled registry runs `projectsPlus` through the existing
worker/beat. Active projects prompt only an active, enabled project lead with read
access. A project row lock and event dedupe key prevent duplicate dispatches from
concurrent workers. While the event record is retained, no repeated prompts are sent for that due
update; posting a new update establishes a new due date. Notification retention
can eventually permit a fresh prompt for a long-neglected update. Projects without a lead show the due date but
send no prompt. Paused, done and archived projects do not send reminders.

Project Blockers is under Work and linked from Projects. It lists unresolved tasks
in active/paused visible projects with a manual blocked reason or an incomplete,
unarchived dependency. Filters select a project or the displayed follow-up owner.
Manual blockers require an active contributor who can see the task. Clearing the
reason clears that owner; task assignees are used as the fallback owner. Completion
or task archiving removes it from this inbox. Completing a dependency does not
announce a task as unblocked while a manual blocked reason remains.

Report provides progress, milestones, overdue tasks and the latest eight updates,
with a print action and CSV download. CSV includes all current project tasks and
protects formula-like cells. Downloads recheck session, active workspace membership,
project/team visibility and rate limits, and return private/no-store responses.
Print output is produced by the user's print dialog; no PDF document or proof record
is generated or stored. This area adds no money records or new file ownership types.
Task evidence continues through existing private task attachments and the authorised
file route; grant agreements, receipts and compliance proofs remain in their existing
tools. No file bytes, data URLs or disk storage are introduced.

## Authority and integrity

Guests read visible projects. Members edit task plans. Only the project lead or a
workspace administrator manages milestones and posts updates. Archived projects are
read-only. Services re-resolve the current actor membership and reject suspended,
disabled or archived-workspace access even when called with a stale actor. Every
query filters the workspace. Composite milestone/project/task foreign keys enforce
same-project and tenant links in the database. Workspace deletion cascades.

Milestones and updates write audit, activity and global search records. Search and
activity use live project/team permissions, hide archived projects and deleted
milestones, and refresh metadata/URLs when the project key or team changes. Task
blocked reasons also enter the existing task search index. Weekly prompts use a
personal `project.update_due` notification event, with ids/dates only in data.

Migration: `20261021010000_projects_plus`. Its new unique index names were checked
against earlier migrations. No earlier migration defines either project/task composite
index. Models are appended to the schema; existing models gain only the required
back relations, task planning fields and composite keys.

The `projects-plus.mjs` seed exports the standard async seed function and creates
two internal Kochi office projects (handover and annual community report), each with
milestones, schedules, completed work, blockers and a weekly update. It is transactional
and repeatable without replacing existing projects.

## Shared paths

- `prisma/schema.prisma` and the single migration: planning persistence and tenant keys.
- `lib/nav.ts`, `lib/roles.ts`: Work discovery and explicit capability helpers.
- `lib/notify/events.ts`, `lib/scheduled/index.ts`: personal due event and worker registration.
- `lib/search/query.ts`: live authorisation for the two new search/activity types.
- `lib/tasks/{queries,types,service,search,activityText}.ts` and
  `components/tasks/{TaskDetail,TaskAttachments}.tsx`: existing task start/blocker UI, date guard,
  blocked indicators, search and activity text. Task attachments also gain drag-and-drop,
  phone camera capture and explicit private image/PDF preview links; uploads still use
  the existing storage policy and action.
- `app/actions/projectsPlus.ts`: authenticated/rate-limited action boundary.
- `frontend/catalog.json`, frontend contracts/model types/pages, frontend registry
  and generated view readers: required split-frontend regeneration.
  `lib/frontend/resources.ts` includes the guarded CSV resource route.
- `scripts/seed/projects-plus.mjs`, tests and this document: requested seed and coverage.

No README, deployment/release files, dependencies or seed runner are changed.
Browser execution is prohibited for this job. Responsive/keyboard/label/print styles
were inspected in source; no visual or assistive-technology run is claimed.

## Review groups (left uncommitted)

1. `feat(projects): add milestones and weekly project updates` — data model,
   service/actions, overview/history, audit/search and personal reminders.
2. `feat(projects): add timeline blockers and printable reports` — task starts,
   manual blockers, dependency schedule, filtered inbox, print/CSV and frontend views.
3. `test(projects): cover planning permissions and seed office projects` — unit,
   integration, seed and area contract.

The sandbox rejects creation of `.git/worktrees/codex-projectsplus/index.lock`,
so the attempted stash/rebase made no branch changes. The current worktree remains
on `feat/projectsplus`, 12 commits behind local `dev` at the handoff check. Integrate
onto current `dev` and regenerate the frontend catalog before merging. The task's
latest-dev and requested branch-spelling conditions remain open. No commits were made,
following the final instruction to leave the work uncommitted.

## Verification notes

- Both area databases passed migration deploy/preparation; the private Silo bucket
  is available for the full file-storage suite.
- The two-project seed ran twice and retained exactly two projects, six tasks,
  four milestones and two updates; the temporary verification workspace was removed.
- The exact commit-message brand scan is empty. The exact tracked-source scan
  reports 31 inherited notepad identifier matches, equal to HEAD. The scan of
  changes and new files adds zero matches; the repository-wide gate remains open.
- No stubbed feature code or external connectors were added.

Final validation:

- Lint: pass, zero warnings.
- Root typecheck: pass with the required 4 GB Node heap.
- Frontend boundary check and frontend typecheck: pass.
- Unit suite: 78 files, 1,096 passed, one existing skip.
- PostgreSQL integration suite with Silo enabled: 48 files, 492 passed, including
  all 14 project planning flows. The final `npm run test:integration` used the
  repository's default test and hook timeouts. Earlier shared-host timing failures
  cleared on rerun. The new unit file contains 24 passing cases.
- Production build: pass with the required 4 GB Node heap; root `.next` removed
  and verified absent after the final standard integration run.
- No stale generated view readers; `git diff --check` is clean.

