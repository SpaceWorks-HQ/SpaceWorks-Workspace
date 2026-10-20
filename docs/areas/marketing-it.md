# Marketing operations and IT administration

These are manual internal tools for a small NGO or community office. Nothing publishes posts, contacts funders, revokes accounts or restores production automatically. The area uses the existing private storage, file library, CRM, Assets, Subscriptions, social analytics, Docs, Services incidents, vault-grant metadata, manual access decisions, search, activity, audit and notification dispatcher. No connector or dependency was added.

## Screens

- `/w/[workspaceSlug]/marketing?tool=CONTENT`: ideas, drafts, review, scheduled and published pieces; channel, owner, caption, notes, publish date/time and linked published social post. List, Monday-based week and month views use the workspace time zone. A date is a reminder to publish manually. Linked posts must belong to the same workspace and channel. Social analytics and SEO remain in their existing tools.
- `marketing?tool=BRAND`: curated logos, colour/type references, templates and photos, with tags, usage guidance, approval status and authorised downloads. Logos/templates/photos are saved as drafts, attached, then approved. Members read approved references; admins curate them. Existing library assets keep their original audience and version behaviour. Uploaded dedicated assets follow the parent record's current approval/access.
- `marketing?tool=PROPOSAL`: pitches and outreach, existing CRM organisation/contact, optional Deal and FundingRecord, INR/international currency value, sent/follow-up dates, status, outcome, notes and private document proofs. Values are integer minor units. It is an admin register; it does not duplicate a CRM pipeline or finance ledger.
- `/w/[workspaceSlug]/it?tool=DEVICE`: extend an existing inventory Asset with device type, serial, purchase/warranty dates, condition, assignee and append-only handover/return history. The Asset remains authoritative for assignee, serial, purchase date, condition and lifecycle, including changes recorded in Money controls; reads and proof downloads recheck that live source. Changes update that same Asset's owner and lifecycle state; accounting disposal safeguards still apply. Start inventory in Assets, then select it here. Return a device by clearing its assignee and recording Returned.
- `it?tool=LICENCE`: extend an existing LICENSE Subscription with purchased seats and assigned people. Seat assignments must be distinct, active tenant members and fit capacity. Renewal amount, date and reminders remain in Subscriptions. Offboarding includes required device-return and licence-seat-release items, without performing those actions automatically.
- `it?tool=INCIDENT`: phishing, lost devices, compromised accounts, data exposure and other security incidents; severity, detection/containment/resolution times, actions, lessons, device/social-account/integration/service-incident links and images/PDFs. Confidential is the default; admins may explicitly share an incident with members. Resolution requires ordered times, actions and lessons. The Services outage log remains the source for service incidents.
- `it?tool=REVIEW`: a manually started monthly/quarterly, dated inventory of every member's workspace role, team memberships, inherited/direct vault grants, connected integrations/social accounts, API tokens and licence seats. Selectors never load secret/token material. Each resource has a source-screen link, Keep/Revoke manually decision, note and reviewer/timestamp. Completion requires every item, records the reviewer and locks the snapshot, including files. There is no automatic revocation. A later period starts a new review rather than mutating evidence.
- `it?tool=RESTORE`: a short recovery runbook, linked team Doc, recent BackupRun health, and manual restore tests with date, result, notes, proofs and next due date. Workspace-attributed backup runs are tenant-filtered. Existing unscoped BackupRun rows are instance infrastructure health: only kind, status and times are projected for workspace admins, without ids, sizes, locations, checksums or raw errors. Foreign workspace-attributed runs are never shown. A planned drill does not replace completed recovery evidence. This page never executes a restore or claims that reported success proves recovery.

Both screens provide title/status/owner/overdue/current-or-archived filters and CSV export. Content adds channel, date and view; brand adds tag. Lists paginate at 30. Calendars cap at 1,000 matching records with a visible notice. Exports cap at 10,000 records and neutralise spreadsheet formula cells. Review exports include decisions, notes and reviewer evidence. Post pickers show the most recent 500 social posts; library pickers show 300 recent assets. References are selected from the tenant, never trusted from the browser.

## Access and files

Every page resolves `requireWorkspace` before loading data. Actions resolve the slug, rate-limit and validate input; services re-read current membership, enabled user and active workspace, including on exports. Mutations lock the workspace and device updates lock the underlying Asset. Guests have no access. Members plan and edit their own content, read approved brand assets, see their assigned devices/licences and explicitly shared incidents. Admins manage the registers, proposals, incidents, reviews and recovery evidence. A forged role in a service argument does not confer permissions.

Every record accepts up to 20 private image/PDF uploads via `uploadWorkspaceFile`, the shared instance type/size policy and image validation. The UI includes multiple selection, drag-and-drop, camera capture, authorised image/PDF preview and downloads. Stored bytes stay in Silo/S3/R2. The file route rechecks parent tenant, membership, approval/confidentiality and archive state. Dedicated uploads and orphan uploads are excluded from the general file library and library retention. CONTENT/BRAND can also link a standalone workspace library file (files attached to docs/tasks remain with their source tool); unlinking never deletes that shared source. Proposals and IT records require dedicated proof uploads. Removing a dedicated proof soft-deletes it; completed reviews cannot lose evidence through this tool. No generated PDF is required by this area; CSVs are immediate authorised downloads.

Search and activity index source records through shared writers. Sensitive titles are PRIVATE/owner-scoped; descriptions, captions, incident actions/lessons, review grant inventories and proof contents are not indexed. The search registry applies live tenant, role, assignee, current brand approval and incident-confidentiality checks, so changing the source or archiving it removes access even if an older index row exists.

## Reminders and data

`lib/scheduled/marketingIt.ts` is registered with the existing BullMQ worker/beat registry. It dispatches personal `marketing.publish_due`, `marketing.follow_up_due`, `it.review_due` and `it.restore_due` events to currently permitted recipients. Confidential notifications contain generic text and ids only; workspace routing rules are disabled. Workspace locks and durable per-date/per-phase event keys prevent duplicate concurrent ticks. A restore test is first due 90 days after workspace creation when no test exists; completed tests set their next due date, and planned tests also remind on their planned test date. Subscription renewals keep the existing subscription reminder path.

The one additive migration is `20261021013000_marketing_it`. New models are appended to the schema, cascade with Workspace and use tenant-leading indexes. Record/file joins have composite tenant foreign keys. Asset, Subscription and other plain-id references are checked in the service transaction; device and licence links stay fixed once created. BackupRun gains an optional workspace attribution while retaining unscoped operator history. All new index names were checked against earlier migrations: no collisions.

`scripts/seed/marketing-it.mjs` exports the standard async area function. It creates eight repeatable demonstration records for a Kochi community office: newsletter planning, approved typography, INR CSR pitch, office laptop/handover, design software seats, phishing incident, quarterly review and explicitly labelled recovery drill. It creates no provider connection or invented receipt/file bytes; add actual approved logo/photo files through the private upload or standalone library picker. The seed runner is unchanged.

The UI uses token colours, shared fields/buttons/dialogs, worded status pills, responsive stacked forms/calendar days and Patch in every tool's main empty state. Form labels, error focus, pending states, live status messages, confirmation dialogs and source links use existing keyboard/screen-reader primitives. No browser, Docker or live assistive-technology session was run; visual 375px QA is not claimed.

## Shared changes and handoff

Outside area-owned route/action/component/service/scheduled/test/seed/docs files:

- `prisma/schema.prisma` and the one migration: tenant records, file relations and backup attribution.
- `lib/roles.ts`, `lib/nav.ts`: tested planning/admin capabilities and two grouped sidebar entries.
- `lib/notify/events.ts`, `lib/scheduled/index.ts`: typed personal events and worker/beat registration.
- `lib/files.ts`, `lib/files/service.ts`, `lib/files/versions.ts`: current parent authorisation, reserved folders, private library/retention exclusions.
- `lib/search/query.ts`: live source permissions for the new search/activity entity.
- `lib/people/onboarding.ts`, `lib/people/checklistItems.ts`: required returns and seat releases in the existing offboarding checklist.
- `frontend/catalog.json`, `frontend/contracts.d.ts`, `frontend/model-types.d.ts`, `frontend/model-types.json`, `frontend/pages.json`, `lib/frontend/registry.ts`, `lib/frontend/resources.ts`, and two generated view readers: regenerated private-gateway contracts. No stale view modules remain.

No README, deployment/release file, other worktree, seed loader, dependency or package-lock change was made. Git metadata writes rejected a rename to `feat/marketing-it`; the worktree remains on `feat/marketingit`. All changes are intentionally uncommitted under the final sandbox instruction, with no push or merge.

Suggested logical commits for review:

1. `feat(marketing-it): add manual records and tenant-safe services` — schema/migration, capabilities, files, source access, history, search/activity/audit, reminders and offboarding.
2. `feat(marketing-it): add planning and security administration screens` — calendar/list/filter forms, private proof UX, reviews/recovery, CSV routes and generated frontend contracts.
3. `test(marketing-it): cover permissions and seed community office examples` — pure-rule and database/storage/seed tests plus these operating notes.

Content review is a manual status; the optional formal content approval engine is not wired. Review completion does not verify external revocation. No external publishing, connectors or automatic restores are stubbed.

The root and frontend typechecks and explicit frontend boundary check passed. Catalog generation produced 204 guarded views, 307 actions, 511 transport types and 37 shared UI types, with zero stale reader modules. All verification results below apply to this worktree snapshot. The mandatory repository terminology scan has inherited matches in existing private-note identifiers/historical files; the same 31 matching lines exist in HEAD, and this area introduces none. Historical persistence migrations were preserved instead of rewriting unrelated schema history to alter that inherited scan.


## Final verification

- `npm run db:deploy` and `npm run db:test:prepare`: passed on `sww_marketingit` and `sww_marketingit_test` with the additive area migration. No application database reset or schema push was used; integration fixtures used the disposable test database.
- `npm run lint -- --max-warnings=0`: passed with zero warnings.
- `NODE_OPTIONS=--max-old-space-size=4096 npm run typecheck`: passed. The production build also completed its TypeScript check against the final source.
- `NODE_OPTIONS=--max-old-space-size=4096 npm run typecheck:frontend`: passed; explicit frontend boundary check passed; no stale generated readers.
- `npm run test:unit -- --maxWorkers=2`: 78 files passed, 1,081 tests passed and one existing test skipped.
- `npm run test:integration` with local Silo enabled: all 48 files and 501 tests passed, including all 23 area tests. Coverage includes cross-tenant references, forged/stale roles, confidential incidents, proof permissions, live Asset returns from other tools, seat capacity, snapshot completion, generic deduplicated reminders, backup projections and repeatable seed data.
- `NODE_OPTIONS=--max-old-space-size=4096 npm run build`: passed on Next.js 16.4.2. Root and frontend `.next` output was removed afterward.
- `git diff --check`: passed. Required commit-history terminology scan: no matches. Required tracked-file terminology scan: 31 inherited matching lines, unchanged from HEAD; separate tracked/untracked comparison found no new matching content.

The worktree HEAD is `bdca118`. Local `dev` advanced to `e3ca193` through five parallel commits (Documents, an e2e fix and README release-capture notes) during this run. Those changes were not merged into this feature worktree, following the instruction not to merge. Verification covers this worktree rather than that later integrated state. At integration, preserve both areas' schema/file/search hooks and regenerate the frontend catalog alongside Documents; the feature's migration remains independent. README and deployment/release sources were left untouched.
