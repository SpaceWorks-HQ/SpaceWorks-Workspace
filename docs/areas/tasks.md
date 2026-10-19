# Tasks and projects

Projects, kanban boards, task detail, My tasks, recurring tasks and
dependencies. Ownership row "1. tasks" in [ROADMAP-BUILD.md](../ROADMAP-BUILD.md).

## Routes

| Route | Who | What |
| --- | --- | --- |
| `/w/[slug]/projects` | GUEST+ | Project cards with progress, owner, team; status tabs (`?status=open\|ACTIVE\|PAUSED\|DONE\|ARCHIVED\|all`); "New project" for members |
| `/w/[slug]/projects/[key]` | GUEST+ | Board (default) or list (`?view=list`), filters in the URL, side panel (`?task=12`) |
| `/w/[slug]/projects/[key]/overview` | GUEST+ | Stats, columns, upcoming due, workload, recent activity |
| `/w/[slug]/projects/[key]/settings` | ADMIN or project owner | Details, owner, team, status, dates; archive / restore |
| `/w/[slug]/projects/[key]/[number]` | GUEST+ | Full task page (old project keys redirect to the current one) |
| `/w/[slug]/projects/[key]/tasks/[number]` | GUEST+ | Alias → canonical task page |
| `/w/[slug]/t/[ref]` | GUEST+ | Short link (`BOT-12`, `12`); tasks without a project live here |
| `/w/[slug]/my-tasks` | MEMBER+ | Assigned to me, grouped overdue / today / this week / later / no date, quick complete with undo |

Board URL state: `assignee=me,none,<userId>`, `label=<id>`, `priority=URGENT,HIGH`,
`due=overdue|today|week|scheduled|none`, `q=`, `view=list`, `sort=manual|due|priority|number|updated|title`,
`group=column|assignee|priority|label|due|none`, `task=<number>`.

## Code

- `lib/tasks/` — pure, client-safe: `position.ts` (fractional ordering, rebalance), `recurrence.ts`
  (RRULE subset, next occurrence in the workspace zone, presets, assignee rotation), `dependencies.ts`
  (cycle check), `filters.ts`, `due.ts` (buckets, 9 AM reminders), `mentions.ts` (`<@userId>` tokens),
  `links.ts`, `localDate.ts`, `activityText.ts`, `schemas.ts` (Zod), `types.ts` (DTOs).
  Server-only: `access.ts` (visibility, roles, realtime audience), `service.ts` (task mutations),
  `recurrenceService.ts` (repeat control + generator), `reminders.ts`, `queries.ts`, `search.ts`,
  `sanitize.ts`, `realtime.ts`.
- `lib/projects/` — `keys.ts` (key rules, column templates), `service.ts` (projects and columns),
  `queries.ts` (list, overview, teams).
- `app/actions/projects.ts`, `app/actions/tasks.ts` — Server Actions plus loaders the board, task
  panel and My tasks use to refetch.
- `components/tasks/`, `components/projects/` — board, cards (drag and drop + Move menu), list,
  filter bar, task detail (tiptap description, subtasks, dependencies, attachments, comments with
  mentions, repeat control, history), drawer, My tasks; project dialogs, tabs and settings.
- `lib/scheduled/tasks.ts` — recurring instances and due/overdue reminders, once a minute.

## Rules

- Visibility: workspace projects are visible to all members; projects of a PRIVATE team only to its
  members and admins (`lib/teamAccess`). Tasks follow their project. Tasks without a project are
  visible to members, and to guests only when they created or were assigned them.
- GUEST reads and comments. MEMBER creates and edits tasks and projects (becoming the owner).
  ADMIN or the project owner edits the project and its columns and archives it. Archived projects
  are read-only (comments stay open). Only members (not guests) can be assigned.
- Task numbers: `nextWorkspaceSequence(tx, workspaceId, "task")`, shown as `KEY-12` (`#12` without
  a project).
- Ordering: float `position` per column; moves send the task above (`afterTaskId`), the server
  places between neighbours and renumbers the column when a gap runs out.
- Done columns (`ColumnCategory.DONE`) set `completedAt`; moving out clears it. Completing a task
  notifies (`task.status_changed`) and unblocks dependants whose last open blocker closed
  (`task.unblocked`, once per pair).
- Dependencies (`BLOCKS`) are acyclic: inserts take a per-workspace advisory lock and run a DFS.
- Recurrence: the task where "Repeat" is set is the template. ON_SCHEDULE creates a copy at 09:00
  local on each matching day (due `dueOffsetDays` later); after downtime it creates one and skips
  ahead. ON_COMPLETION creates the next copy (due the next matching day after the finished one's due
  day) once the current one is done. Exactly once across replicas: conditional claim on `nextRunAt`
  plus `TaskOccurrence` unique key. Archiving the template stops the repeat.
- Reminders: `task.due` at 09:00 on the due day, `task.overdue` at 09:00 the day after (for a week),
  to assignees, once per task and due date (advisory lock + dedupe key).
- Notifications (all through `dispatch`): `task.assigned`, `task.status_changed`, `task.commented`
  (assignees + creator), `mention` (comments; edits notify newly mentioned people only),
  `task.unblocked`, `task.due`, `task.overdue`. Recipients are filtered to people who can see the task.
- Realtime: `task.created|task.changed|task.removed|board.changed` on `project:<id>`,
  `task.changed|comment.changed` on `task:<id>`; ids only, private-team projects use `audience`.
- Search: `SearchDocument` rows for tasks (`KEY-12 title` + plain-text description) and projects;
  removed on archive.
- Descriptions are sanitised server-side (`sanitize-html` allow-list matching the editor).
- Audit: `project.*`, `task.created|archived|restored|comment_deleted|dependency_added|dependency_removed|recurrence_set|recurrence_stopped|attachment_removed`.

## Demo data

`node --env-file-if-exists=.env scripts/seed/tasks.mjs` (after `npm run db:seed:demo`) adds the OPS
"Space upkeep" project with a weekly rotating repeat, subtasks, a dependency and a mention.

## Known gaps

- Attachments are downloadable by any active member through `/api/files/[id]` (shared core), even
  for tasks in a private team's project.
- Drag and drop uses native HTML5 events (mouse); on touch screens use the card's Move menu.
- The home dashboard (platform-shell) lists tasks without private-team filtering.
