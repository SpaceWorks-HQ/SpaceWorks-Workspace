# Product and engineering operations

Manual tools for an internal operating team at `/w/[workspaceSlug]/product-ops`.
The single sidebar entry opens Roadmap, Release planning, Issues and QA, BOM
estimates, Prototypes and tests, Deployment and changes, and Technical ownership.
No external connections, procurement, inventory or member-facing tools are added.

## Tools and behaviour

Roadmap items carry Now / Next / Later, a calendar quarter, outcome, owner, due
date, project and optional existing idea/release links. The board switches between horizon and quarter grouping;
quarter, project, person and status filters work on the saved records.

Releases record version, target date, technical owner, scope tasks and roadmap
items, checklist and internal release notes, with optional links to existing GitHub repository/events. No connector is installed or called. QA runs belong to a release, with
environment, checks, evidence notes and findings. All checks must pass; all scope
tasks and roadmap items must be complete; no unresolved critical issue can remain
before requesting approval or shipping. Approvals use the existing engine, distinct
reviewers and no self-approval. Product release/change subjects can use policies
configured in the existing approval policy builder; without a policy the engine
requires one admin/owner. Pending and approved plans freeze their content, QA and
roadmap scope. Open approvals can be withdrawn by their requester; rejected or
returned plans can be edited and resubmitted. Shipping is idempotent and can publish
one INTERNAL ChangelogEntry when an admin ships it. Team members can ship approved releases without publishing; changelog publishing keeps its existing admin-only gate. Private-team releases ship without publishing into
the workspace-wide changelog. Existing tasks and ideas are linked, not duplicated.

Issues distinguish bugs, feature requests and QA checks, with severity, reproduction
steps, expected result, environment, owner, status, idea and release links. Critical
unresolved issues block shipping. Issues and changes can link a shipped release for
follow-up work; release QA and roadmap scope remain locked after shipping.

BOM estimates are admin-only funding proposal records. Each links a project and/or
existing FundingRecord application/grant, with optional existing Budget and
FinanceFund links. Currency must match linked funding/budget/fund records. Each
line records item, specification, category, quantity, unit, unit cost, supplier,
quote URL/upload and GST/tax rate. INR is the default; other three-letter currencies
use their standard minor digits. Quantities are integer thousandths, money is
integer minor units and percentages are basis points. Integer arithmetic rounds
half up per line subtotal and tax. Contingency applies to subtotal plus tax, rounded
once. The screen and CSV expose category subtotals, tax, contingency and grand total.
There is no automatic ledger posting, purchase order, inventory or exchange rate.

Every estimate save and quote upload creates an immutable ProductEstimateRevision.
The snapshot keeps title, notes, currency, links, line items and quote file ids.
The editor detects stale revisions and refuses to overwrite concurrent changes.
Quote files remain with historical revisions and cannot be detached. The latest
100 revisions appear in the editor; all revisions remain stored and authorised
version-specific CSV/PDF exports are available by revision number. A generated
budget PDF uses the existing Gilroy PDF helper, pagination and private storage;
concurrent requests reuse one generated file per revision. CSV amounts are major
currency values without locale grouping, quoted and formula-neutralised.

Prototype versions record design revision notes and multiple photos/PDFs. Test
logs link the prototype and record date, plan, pass/fail, results, findings and
revision notes. Record date supports tests that happened earlier.

Manual changes record what changed, where, who, risk, rollback note, date, release
and optional monitoring Incident. High-risk changes require approval; lower-risk
changes can opt in. Apply change records completion, never executes a deployment.
Completed changes are immutable; Record rollback logs that the documented rollback
was carried out. A further change uses a new record.

Technical ownership reads and edits owner/backupOwnerId on existing
ServiceCatalogItem rows, including repositories and devices. Current admins assign
different active team members as owner and backup. All team members can inspect
visible systems; private-team catalogue visibility is preserved. Add systems
through the existing catalogue. There is no second system registry.

## Access, data and files

Every page resolves its workspace itself. Services independently recheck active
membership, actual current role, enabled user and non-archived workspace. Guests
cannot use product tools; funding estimates require ADMIN/OWNER. Non-estimate
records are visible to members who can see their project. Links are validated in
the same workspace and project; records with linked children cannot change projects.
All mutations are serialised with a workspace row lock and use audit/activity.

The single migration `20261021012000_product_ops` appends ProductKind,
ProductRecord, ProductEstimateRevision and ProductAttachment, plus the two
approval subject values. Workspace deletion cascades; self-links and attachment
relations use compound tenant keys; indexes lead with workspaceId. Actor/project,
funding/budget/fund references are revalidated by the service. No historical
migration or existing model is renamed. The new unique index names were checked
against all earlier migrations before creation.

Records accept images and PDFs through uploadWorkspaceFile, including multiple
selection, drag/drop, phone camera capture and authorised image/PDF previews.
Storage type/size and image decoding checks apply. Files use the existing private
Silo/S3/R2 layer and `/api/files/[id]` only. Downloads recheck current source-record
permissions, including after project visibility or member role changes. Unlinked
uploads and archived-record attachments fail closed. Record files are excluded from
the general file library, alternate library mutations and library purge. Generated
PDFs follow the same attachment ancestry. No uploaded/generated bytes are stored in
the database, client data URLs or feature-owned disk storage.

Search indexes titles, with PRIVATE owner scope for estimates and a live source
check that still requires admin rights. Project visibility is rechecked for search
and activity. Assistant user searches use the same live gate; machine principals
cannot read these records. Audit and notification payloads contain ids and generic
facts, not quote contents or funding amounts.

## Reminders and interface

`lib/scheduled/productOps.ts` is registered with the existing BullMQ worker/beat.
Due/overdue events go through dispatch to current owners, or admins for unassigned
work, after current project/role checks. Estimates notify admins only. Workspace
locks and durable event keys deduplicate each deadline's due and overdue phases
across concurrent workers. Terminal statuses stop reminders. Dates use the workspace
time zone; date-only records render without UTC date shifts.

All screens include filters, statuses, owners, notes, CSV, loading/error handling
and Patch empty states. Forms use labelled native controls, inline announced errors,
keyboard-accessible checklists and confirmation dialogs. Controls wrap and tables
scroll inside their container at narrow widths. Interactive browser, mobile and
screen-reader testing were not run because this task prohibits browsers.

## Shared files changed

- `prisma/schema.prisma` and the named migration: new tenant data, attachments and approval subjects.
- `lib/nav.ts`, `lib/roles.ts`: one navigation entry and tested capability helpers.
- `lib/notify/events.ts`, `lib/scheduled/index.ts`: two private reminder events and worker registration.
- `lib/files.ts`, `lib/files/service.ts`, `lib/files/versions.ts`: record download checks and file library/purge guards.
- `lib/search/query.ts`, `lib/assistant/tools/workspace.ts`: live source visibility for search, activity and assistant reads.
- `lib/approvals/types.ts`, `lib/approvals/registry.ts`, `lib/approvals/engine.ts`: product approval links and optional live source gates for inbox, decisions, comments and notifications.
- `lib/requests/service.ts`, `components/requests/PolicyBuilder.tsx`: existing approval policy support for product release/change subjects.
- `frontend/catalog.json`, `frontend/pages.json`, `lib/frontend/*`, `lib/views/generated/*`: required split-frontend contracts and generated guarded readers.

No README, deployment, seed runner or other worktree changes. No dependencies added.

## Verification and logical commits

- Both named databases migrated successfully; the private Silo bucket was available.
- Demo seed ran twice in a temporary workspace: 10 product records and one estimate revision after either run. The fixture and its stored PDFs were removed afterwards.
- The generated two-page solar budget PDF was rendered and visually inspected. Currency codes avoid unsupported currency glyphs in the existing font; all values and page boundaries are legible.
- Unit suite: 1,086 passed, one inherited skipped test across 78 files. Product-specific pure tests: 16.
- Full PostgreSQL integration suite with Silo: 496 passed across 48 files. Product-specific integration tests: 18, including live role/tenant/private-project access, configurable approval source checks, self-approval, readiness gates, private evidence, funding links, immutable revisions/PDFs, manual change dates, ownership, optional GitHub links and reminder races.
- Frontend catalogue: 204 guarded views, 305 actions; 509 transport types and 37 shared UI types. No unreferenced generated readers remain. Backend/frontend typechecks and the boundary check pass with the requested 4 GB Node heap.
- Final lint passes with zero warnings. The standard production build passes, including Next.js TypeScript validation and all 26 static pages. Cold type checking required warming the normal compiler cache; the final build uses the original Next.js configuration. The worktree's `.next` build artifacts were removed after verification.
- Commit-message branding scan: clear. Repository scan: 31 inherited substring matches in the existing notepad model, its migration and callers. The product operations files and additions introduce no matches. Historical migrations and unrelated models were preserved; this repository-wide gate remains unclean.
- Git metadata writes are denied by the sandbox. The work remains on `feat/productops`, behind the advancing local `dev`; the requested rename/base update could not be applied. No commits, pushes or merges were made.
- No feature stubs. Browser/mobile/screen-reader interaction was not exercised because browsers are prohibited for this task.
Changes remain uncommitted, as requested by the area instructions. Suggested logical
commits (each with the task's exact co-author trailers when a human commits):

1. `feat(product-ops): add tenant data and shared permission hooks`
2. `feat(product-ops): add manual engineering and funding estimate tools`
3. `test(product-ops): cover approvals, private evidence and estimate revisions`
