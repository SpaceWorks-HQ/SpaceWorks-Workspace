# People and service tools

Space Works Workspace is an internal operating tool for staff, volunteers and contractors. This area adds manual leave, hours, hiring, help-desk, safety, inspection and lease records. It has no external connectors or public intake, bookings, stock management, payroll or member billing.

## Using the tools

- **Leave** (`/w/[workspaceSlug]/leave`): admins add leave types and integer calendar-day allowances per person/year. Contributors request leave and follow its approval; a different admin approves or declines. Approval extends the existing `Availability` calendar. Cancellation from Leave or the existing availability screen restores the entitlement. Pending requests are shown separately from approved usage. Weekends count; cross-year requests must be split. General availability requests remain available through the existing screen without consuming a named leave balance. Engagement type and start/end dates extend `MemberProfile`, appear on profiles and are managed from Leave. Admins cannot change another admin or owner’s engagement details; owners can.
- **Hours** (`/volunteering`): staff and volunteers log completed work, start/end and breaks. Whole-minute, positive work of at most 16 hours is required. Active pending/approved logs cannot overlap. Only the contributor withdraws pending work; another admin makes a final approval/rejection with a review note. All-time totals and monthly totals per person include approved and pending work separately. Cross-month work and breaks are allocated proportionally using cumulative rounding so minutes are preserved.
- **Hiring** (`/hiring`): admins record openings, candidates, contact details, source, owner, follow-up date, stage, notes, offer and decision. Candidate detail has CV/supporting uploads and append-only interview notes attributed to the signed-in interviewer. Record a hiring decision, invite the person using existing workspace invitations, then choose the matching email/account and an existing onboarding template. Conversion starts that existing checklist once; it never creates an account or grants a workspace role. Openings can be paused or closed. Only admins see candidate records or files.
- **Help desk** (`/helpdesk`): contributors submit IT, facilities, admin, finance, HR or confidential requests. Each request has priority, status, responsible admin, manual due date and replies. Initial elapsed-hour targets are 4/24/72/168 for urgent/high/normal/low; they can be replaced with a manual due time. Contributors see their own requests; admins see ordinary requests. A confidential request is visible only to its requester and its explicitly designated active admin handler. Other admins are denied on detail, triage, comments, search, exports and files. Internal handling notes are excluded from requester payloads. Closed requests must reopen before replies resume.
- **Safety** (`/safety`): contributors report injury, near miss, damage or hazard with occurrence time, location, details and immediate action, plus images/PDFs. The reporter and admins see the report. Follow-up details and assignment are admin-only. Closing requires a note and completed corrective actions. Sensitive details never enter notifications or shared activity.
- **Inspections** (`/safety/inspections`): admins add simple checklist templates, choose an inspector and date, record signed findings and add corrective actions with an owner/due date. These extend the existing `ChecklistTemplate`, `ChecklistRun` and `ChecklistRunItem` models. Every finding/action needs completion evidence before closure. Completed findings cannot be overwritten. There is no recurring workflow engine.
- **Facilities** (`/safety/facilities`): admins manually record premises, landlord contact, monthly rent in integer minor units with currency (INR default), lease start, renewal, owner, status, notes and contract files. Facilities contacts use existing CRM `Contact` records with a facilities kind and private visibility. The linked CRM editor handles later contact corrections; there is no duplicate address book.

Each main empty state uses Patch. Forms use labelled shared controls, pending state and live error/success feedback. Layouts wrap and stack for narrow screens; detail tables use definition lists. Browser/375px visual review was explicitly excluded by the task and is not claimed.

## Access and storage

Every page resolves membership itself. Actions resolve the workspace from its slug, check the capability, rate-limit, validate with Zod and call services that recheck live membership (including disabled users and archived workspaces) inside writes. Tenant queries filter on workspace id. New tenant roots cascade with the workspace; child records use composite tenant relations where possible. New indexes start with workspace id. Mutations use advisory locks and transactions; audit events contain ids and verbs, never notes or file bodies.

All record types support multiple evidence files, including leave, hours, candidate CVs, confidential requests, incident photos, inspections and lease contracts. Uploads call `uploadWorkspaceFile`; downloads and previews use the authorised `/api/files/[id]` route. `findDownloadableFile` checks the current source record’s permissions. Unknown/deleted records and reserved-folder files without a record link fail closed. Uploads accept the storage policy’s raster images and PDFs; image decode checks and configured per-file limits apply. There are at most ten files per upload, 25 MB total and thirty per record. Drag/drop, keyboard file selection, native phone camera capture and image/PDF preview are provided. Files under `/people-service` and attachment relations are excluded from the general file library, trash, movement/version operations and bulk library exports.

Search indexes titles only, with PRIVATE owner-scoped records and a live source check for each tool; admins can search the tools they may handle. Confidential-ticket checks also require the designated handler. Descriptions, interview notes, leave notes, incident details, evidence and lease contracts are not indexed. Search links to the existing one-screen tools use record anchors.

## Reminders and exports

`lib/scheduled/opsGaps.ts` is registered in the shared scheduler. It sends personal `dispatch()` reminders for overdue help-desk targets, candidate follow-up, lease renewals within thirty days, outstanding safety/inspection actions, pending leave and hours. Notifications contain only a generic title, record id and authorised link. Workspace routing rules are disabled. Persisted daily dedupe keys prevent duplicate reminders. No external connector or accounting/payroll integration is used.

Each tool exposes CSV through `/people-tools/export/[kind]`. Exports enforce the same row permissions, read in batches of 200, recheck active membership while streaming, use private/no-store responses and neutralise spreadsheet-formula cells. Exports use stable person/contact ids rather than inferring identities. They do not export file bytes or confidential internal replies.

## Data, seed and migration

One new migration: `20261020210000_people_service_tools`. It adds the manual tool records, yearly entitlements, record/file links and engagement fields. The earlier local database history contains an unrelated prior area migration id; it was preserved. No database reset or push was used.

`scripts/seed/ops-gaps.mjs` exports the standard async area function. It seeds a Kochi community office with an annual leave allowance, volunteer profile, staff opening, candidate, landlord CRM contact, INR lease, safety checklist, internal help request, near miss and hours entry. Examples are idempotent and contain demonstration-only contact details. It does not upload invented receipts or call external providers. The main demo loader is untouched.

## Ownership and review

Area code is in `app/actions/opsGaps.ts`, workspace `leave`, `volunteering`, `hiring`, `helpdesk`, `safety` and `people-tools` routes, `components/ops-gaps`, `lib/opsGaps`, `lib/scheduled/opsGaps.ts`, the migration, seed and area tests.

Shared changes needed by the area:

- `prisma/schema.prisma`: new models and tenant/file relations, plus engagement fields.
- `lib/nav.ts`, `lib/roles.ts`, `lib/notify/events.ts`, `lib/scheduled/index.ts`: role-aware entries, tested capabilities, personal event types and scheduler registration.
- `lib/search/query.ts`: current-source access checks for each tool.
- `lib/files.ts`, `lib/files/service.ts`, `lib/files/versions.ts`: record-level downloads and exclusion of private evidence from generic library operations.
- `lib/people/timeOff.ts`, `lib/people/away.ts`, `lib/people/actionContext.ts`: entitlement checks, cancellation and existing availability integration.
- `lib/people/profiles.ts` and the existing member profile page: engagement display.
- `frontend/catalog.json`, `frontend/contracts.d.ts`, `frontend/pages.json`, `lib/frontend` and `lib/views/generated`: regenerated gateway contracts. Stale readers are removed.

The starting branch predates the frontend workspace and newer database schema. Git metadata writes were denied, so an actual branch rebase was unavailable. Application sources from local `dev` were reconciled into this working tree, retaining the area edits; deployment, release and README files were left untouched. The exact inherited application file list is in [ops-gaps-baseline.json](ops-gaps-baseline.json). These baseline changes should disappear when the work is reapplied to current `dev`; they are not additional feature scope. The area remains uncommitted as requested.

Suggested logical changes for the eventual commit review:

1. Schema migration and services for leave/hours, hiring, help desk and safety/facilities; shared access, search, notification and file integration.
2. Accessible forms, lists, detail screens, CSV and frontend contract regeneration.
3. Seed, unit/integration coverage and these operating notes.

## Limits

This is manual internal record keeping. There is no payroll, bank detail storage, payment processing, applicant portal, automated email/invitation, public events/memberships, bookings or consumables feature here. Hiring onboarding needs an already invited active account with the candidate’s email and an existing template. Leave balances use whole calendar days, without holiday calendars, carry-forward or accrual rules. Inspection and confidential handling owners are admins. File correction is an additional upload; this area has no evidence deletion UI. The main forms intentionally avoid heavy configuration.

Verification results and any outstanding blockers are recorded in the final handoff.


## Verification recorded

- `npm run lint -- --max-warnings=0`: passed, zero warnings.
- `npm run typecheck` and `npm run typecheck:frontend`: passed with the required 4096 MB Node heap limit.
- `npm run test:unit`: 68 files passed; 953 tests passed and one existing test skipped.
- `npm run db:deploy` and `npm run db:test:prepare`: passed on the two named local databases. The completed current-area migration was applied under its new name; prior database history was preserved.
- `npm run test:integration`: 38 files and all 365 tests passed. The area has 24 integration tests, including live Silo upload/download and file authorisation, concurrent leave approvals, hiring/onboarding, confidential handlers, inspection closure and repeatable seed data.
- `npm run build`: passed with the required 4096 MB Node heap limit. Root and frontend `.next` artifacts were removed afterwards.
- Frontend catalog regenerated: 179 guarded views, 265 actions, 444 transport types and 17 shared UI types; no stale generated readers remain.
- History terminology scan: no matches. The required tracked-file scan still has 28 pre-existing matches in personal-notes model/service identifiers and their original migration/tests. The new area source scan has no matches. Renaming that existing persistence model and rewriting historical migrations is outside this area's changes.
- No Docker or browser was run. Mobile visual and live keyboard/screen-reader interaction remain unverified; no such pass is claimed.
- No new connector is stubbed or simulated. No commit, push or branch merge was performed. Changes are left uncommitted as requested; Git metadata writes were also denied by this sandbox.
