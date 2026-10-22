# Governance tools

Manual internal tools for an NGO, non-profit or small operating team. One Governance sidebar link opens three screens: `/w/[workspaceSlug]/governance` (compliance), `/governance/board`, and `/governance/vendors`. Every page, action, export, search result and file download requires a current active ADMIN or OWNER. Owners of individual records are responsible admins; an unassigned reminder goes to active admins. These records are deliberately private from ordinary members and guests, independently of finance-summary visibility.

## Tools

Compliance keeps one legal entity profile: Section 8 company, society, trust or other/international entity, registration, PAN, TAN, GSTIN, address, 12A/12AB, 80G, FCRA, CSR-1 and other identifiers. Obligations have a deadline, owner, recurrence, To do / Filed / Done status, acknowledgement number, reporting-period/applicability notes and multiple proof files. Filters include overdue obligations in the workspace's calendar day. Date-only fields preserve the calendar date internationally.

Fourteen editable Indian NGO planning prompts cover 12A/12AB and 80G renewal, donation reporting/certificates, income-tax return and audit, TDS, GST, FCRA, CSR-1, company annual filings and state society/trust filings. They never infer statutory deadlines or applicability. Every prompt is optional; custom obligations work for other jurisdictions. The screen says **Verify with your CA** because tax-year form names, approval conditions and state requirements can change. Completing a recurring obligation exposes **Add next occurrence**; this creates one new To do record per source, preserves the original date, acknowledgement and proof, and clamps month-end/leap-day recurrence. It does not file anything or automatically claim compliance.

Boards and committees hold a mandate and members' roles/terms, optionally linked to existing CRM contacts. Meetings remain in the existing Meetings tool; minutes and resolutions point to a tenant-checked meeting. Minutes start as drafts. Explicit approval records the approver and time and locks the saved text, links and attachments. Corrections use a new minutes record. Resolutions have unique sequential workspace numbers, draft/passed/rejected status, text and voting outcome. Conflict declarations record a person's interests or explicit absence of conflicts, date and management/recusal notes. AGM starters add six editable checklist items for a chosen committee, year and date; retries do not duplicate or overwrite existing items.

Vendors extend **existing CRM organisations**, rather than making another address book. Their profile adds GSTIN, PAN, international tax ID, email and phone. Bank changes require a complete replacement and a reason. An append-only revision stores account holder, bank, account number/IBAN and IFSC/routing/SWIFT code encrypted with the `governance-vendor-bank` purpose under the instance encryption root. Forms are write-only; deliberate reveal of the current revision is audited in the same transaction. Pages receive only revision metadata, never ciphertext or old banking values. Banking values do not enter search, activity, notifications or CSV. Contracts link a vendor, owner, value in integer minor units/currency, start/end dates, notice days, reference, notes and multiple agreement files. Reminders target the **notice deadline** (end date minus notice days), allowing time to review renewal manually.

Archiving is reversible from the archived-record filter. Restoring reinstates the search entry; child records require their committee/vendor to be restored first.

Each screen has a filtered/paginated list, inline create/edit form, status and owner filters, CSV export, loading/error handling and a Patch empty state. Controls wrap into one column on narrow screens, labels and validation are associated with their controls, status always has text, and operations provide pending/error feedback. Browser execution was prohibited for this task, so a visual/keyboard review at 375px was not run.

## Storage and access

All record kinds accept up to 20 private images/PDFs, 10 MB each, through `uploadWorkspaceFile`. The UI supports multiple selection, drag/drop, phone camera capture, authorised image/PDF preview and download. Uploads run one file at a time; an error preserves earlier successful files and says so. The folder is `/governance`; attachment rows keep files out of the general file library, including trash. The authorised file route checks current admin membership, disabled accounts and workspace state even for an unattached/reserved-folder file. Removed attachments are soft-deleted and retain their private link for the existing storage retention writer. Approved minutes cannot add or remove files. No public object URLs, extra bucket service, generated proof or placeholder downloads are used.

## Data and hooks

The single `governance_tools` migration appends `GovernanceKind`, `GovernanceRecord`, `GovernanceAttachment` and `GovernanceBankChange`. A record has common typed dates, owner, status, parent committee, optional CRM organisation/meeting, resolution number and strictly validated kind-specific JSON. Unknown detail keys are stripped on write; banking has a separate encrypted table. Workspace cascades cover every new table. The compound committee/attachment/revision relations enforce tenant ancestry; links to existing CRM and meeting models are tenant-checked by the service. Tenant indexes and composite unique constraints start with workspace ID. No existing data columns change.

Writes recheck current membership, account and workspace state, rate-limit at the action boundary, validate with Zod, then lock the workspace row for short atomic mutations. This serialises minutes approval, numbering, checklist retries and recurrence creation. Every mutation/reveal is audited without banking values or file bodies. Search indexes titles only as PRIVATE/owner-scoped; the shared live access registry requires admin rights and a live non-archived source. Activity follows the same live gate. Assistant search also checks current source rights and excludes governance from scheduled-job and API-token searches.

`lib/scheduled/governance.ts` is registered in the existing scheduler. It pages through open obligations, checklist items, active member terms and contracts, sends `governance.reminder` through `dispatch()`, and persists a transaction/advisory-locked event claim for each record/deadline and due/overdue phase. The owner receives a reminder in the configured lead window and once overdue; unavailable owners fall back to current admins. Notifications use personal routing only and contain no record title, tax identifier, bank value or proof. No external connector or automatic renewal is involved.

CSV exports use the same filters/access checks, contain at most 10,000 records, preserve currency/minor units in details, neutralise spreadsheet formulas, quote multiline fields, and are marked private/no-store. Exports are audited. Banking is excluded by construction.

## Cross-area files

The task explicitly requires changes to shared schema/migration, `lib/nav.ts`, `lib/roles.ts`, `lib/notify/events.ts`, `lib/scheduled/index.ts`, and file authorisation. Additional necessary hooks: `lib/crypto.ts` adds a dedicated encryption purpose; `lib/files/service.ts` hides private governance attachments/reserves their folder; `lib/search/query.ts` adds current source checks; `lib/assistant/tools/workspace.ts` applies the same checks to assistant search. The seed writes illustrative CRM organisation and Meeting rows through the existing models. No dependencies, README, deployment/release files, other worktrees, browser or Docker changes are involved.

## Verification and sources

Tests are `tests/unit/governance-tools.test.ts` (capabilities, date/recurrence, tax IDs, validation, CSV) and `tests/integration/governance-tools.db.test.ts` (current authz, tenant links, history, minutes locking, numbering races, encrypted revision/reveal, private Silo proof flows, live search and reminder races). `scripts/seed/governance-tools.mjs` uses the standard seed export and is repeatable for an existing demo workspace.

Official sources checked on 20 October 2026: [Income Tax donation reporting manual](https://www.incometax.gov.in/iec/foportal/newformpage/forms/form10bd-be/10bd-UM?mobile-app=1), [Income Tax form-year listing](https://www.incometax.gov.in/iec/foportal/node/11588), and [MHA FCRA FAQ](https://fcraonline.nic.in/Home/PDF_Doc/fc_faq_04102022.pdf). They support planning prompts only; the product intentionally requires manual CA-confirmed dates and current form selection.

The required repository text scan has inherited substring matches in the pre-existing notepad model, migration and callers. This feature introduces none of those names and does not rewrite historical migrations. The commit-message scan has no matches. Exact final verification totals are recorded in the hand-off.

## Verification totals

- Lint: pass, zero warnings. Typecheck and production build: pass with the requested 4 GB Node heap. Generated `.next` output removed after the build.
- Unit suite: 891 passed, one inherited skipped test, 63 files.
- PostgreSQL integration suite with private Silo transport: 350 passed, 37 files. Governance-specific coverage: 13 unit and 13 integration cases.
- Migration deployed to `sww_ops` and prepared in `sww_ops_test`; no pending migrations. Governance seed checked twice: 11 records each time, then the temporary verification workspace was removed.
- Commit-message scan: clear. Required repository scan: 31 inherited substring matches, identical to the starting commit; explicit scan of every newly added file is clear.
- No features are stubbed. Browser/mobile visual review was not run, as instructed. No commits, pushes or merges were made; changes remain ready for review.

Suggested logical commits: `feat(governance): add tenant-scoped records and access hooks`; `feat(governance): add manual tools and private proof uploads`; `test(governance): cover permissions, seed and document tools`.
