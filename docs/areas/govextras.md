# Governance and safety extras

These are manual internal tools for an NGO or small operating team. There are no external connectors, automated statutory decisions or member-facing services. Start at Governance; the existing compliance, board and vendor screens now share navigation with Insurance and registers, Risks and emergency plans, SOP reviews and Board packs. Safeguarding has a separate member-level entry because committee handlers may be ordinary members.

## Everyday tools

- **Insurance and registers** (`/governance/registers`): policy, licence and registration issuer, number, scope, sum insured, premium/fee, currency, start and expiry, renewal owner, reminder lead and a checked link to an existing compliance obligation. Amounts are integer minor units. Statutory register snapshots link the existing legal entity and describe members, directors, minutes or another register, with review date and multiple private evidence uploads. Entity-specific applicability is decided by the team.
- **Conflicts** (existing `/governance/board`): declarations gain a CRM organisation and optional payee name. Link an existing purchase, supplier bill, contract, board decision/resolution or disbursement, with management/recusal notes. The declaration view flags matching vendor organisations and exact normalised payee names. Aliases and non-obvious relationships require manual review. Warnings support judgement; they do not block or approve spending. Existing declaration text and committee membership stay in the governance records.
- **Risks and emergency plans** (`/governance/risk`): likelihood and impact each run from 1 to 5; score is their product. Low is 1–5, Medium 6–14 and High 15–25. Controls, assessment, owner, review date and evidence remain editable. Emergency plans point to existing Docs. Drill records link the plan and record date, findings and follow-up work. The existing Safety screens remain responsible for incident reports, inspections and corrective actions.
- **SOP reviews** (`/governance/reviews`): link an existing document, choose responsible admin and date, retain review notes and evidence, and filter overdue reviews. A reviewed record leaves the reminder queue; change the date/status manually for the next review. Existing Doc verification dates now also push personal review reminders, including admin-only document permission checks.
- **Board packs** (`/governance/packs`): choose a period, documents/reports, decisions, governance evidence and an optional finance currency summary. Save, review and deliberately freeze. This stores a Gilroy PDF and a ZIP with the PDF, full source snapshots, manifest, source dates, actor and SHA-256 checksums, plus copied selected evidence. Finance summaries exclude individual payroll entries and never mix currencies. Source edits do not change frozen artifacts. Frozen records, selections, notes and attachments are locked; corrections use another pack. A failed upload rolls back database references and cleans up uploaded objects. Retrying an already frozen pack returns its existing record. Packs are capped at 30 documents, 50 decisions, 50 governance records, 100 evidence files/18 MB of source binaries and a 25 MB generated bundle.

All governance tools use filtered, paginated lists, owner/status/date fields and formula-safe CSV exports. Empty states use Patch. Labels, native controls, pending/error feedback, wrapping navigation and responsive single-column forms support narrow screens and keyboard users. No browser was run, as instructed; visual/keyboard/screen-reader behaviour at 375px remains unverified.

## Confidential safeguarding and POSH

`/safeguarding` is deliberately separate from ordinary Safety incidents. A workspace OWNER records approved Internal Committee/safeguarding committee appointments, linked to an existing active committee with an expiry date. The app does not claim to establish a legally valid committee or calculate legal deadlines.

Access requires current active membership at MEMBER or above, an unexpired/unrevoked appointment in an active committee, and explicit assignment to that case. OWNER and ADMIN have no implicit case access. An owner may manage appointment metadata without seeing any cases. A current handler creates a case including themselves and chooses other currently appointed handlers. Assigned handlers may update status, review date and assignment while retaining themselves. Revocation, suspension, disabled accounts, expired appointments, archived committees/workspaces and removal from assignment end access on the next read.

Cases retain type, receipt date, manual next review date, designated handlers, restricted concern, append-only attributed notes/actions/outcomes, action owners and due dates. Closing requires every action complete and an outcome. Closed cases and their evidence remain locked. Concern text and timeline bodies use separate encrypted-at-rest purposes under the existing instance encryption root. Ciphertext is never sent to a view. Source reads, file reads, changes, appointments and exports are audited using ids and verbs only.

Case details, evidence names and timelines are excluded from global search, assistant output, shared activity, broad workspace exports and notifications. The case CSV is a minimal operational register (number, type, status, receipt/due date, handler ids); it exports only cases currently assigned to the appointed viewer, with the same filters and a 1,000-record limit. Restricted details stay in the case view. There is no public intake, external messaging or automatic investigation workflow.

## Private files and reminders

Every new record supports multiple private image/PDF evidence files through `uploadWorkspaceFile`, with 20 files per record and a 10 MB per-file limit. Drag/drop, file picker, phone camera capture, authorised image/PDF previews and downloads use the existing controls and `/api/files/[id]`. Generated packs use the same private storage and authorised file route; ZIP is download-only. General library, trash, movement, version operations, exports and generic search cannot expose case files. Orphan files in the reserved safeguarding folder fail closed. Governance evidence is admin-only. Case downloads require the current appointment and case assignment, including after closure.

The existing governance scheduler now covers insurance/licence/registration expiry, statutory register/risk/plan reviews and planned drills. `lib/scheduled/govextras.ts` adds Doc verification and confidential case review reminders. All use `dispatch()`, generic text, personal routing and persisted advisory-locked dedupe claims. Governance/Doc review phases are due and overdue; open cases due for review are reminded once per day. Unassigned governance reminders fall back to active admins. Confidential reminders go only to current appointed, assigned handlers and never fall back to admins. No private concern, outcome, document title or evidence name enters the notification envelope.

## Schema, seed and frontend

The single migration is `20261020233000_govextras`. It extends GovernanceKind and reuses GovernanceRecord/GovernanceAttachment; the four appended safeguarding models separate appointments, cases, encrypted timeline entries and composite tenant/file relations. Every new tenant root cascades from Workspace and every new index starts with workspaceId. Existing FileObject uniqueness is reused.

`scripts/seed/govextras.mjs` exports the standard async function and is repeatable. Examples describe a Kochi community office, INR insurance, licence, registration, reviewed register, blocked-exit risk, evacuation plan/drill, overdue SOP review and draft board pack. It seeds no invented concern or proof file. The demo loader is untouched.

Every data read happens in a page's default export or a server loader called before the JSX return. Rendering components receive loaded props and use plain exported types. The frontend catalog and generated contracts/readers must be regenerated after route/action changes. Stale readers are removed.

## Files outside the area folders

Required shared hooks: Prisma schema/migration; roles and nav; crypto purposes; notification event catalogue; existing governance scheduler and scheduler registry; file download checks, library filters and reserved folders; generic file search and workspace export exclusions. The existing governance components, forms, schemas, service and pages are extended to reuse those tools and repair their frontend boundary.

The inherited finance screens queried Prisma during rendering. To satisfy the task's frontend boundary check, `lib/finance/tools/views.ts` now loads their data and attachments in guarded page readers; three finance rendering components and nine finance pages accept loaded props. Finance record permissions remain in the existing services. This compatibility repair is separate from the governance feature.

The current worktree could not switch to `feat/gov-extras`: Git metadata writes were denied by the sandbox. It remains on `feat/govextras`. Its starting commit was one application fix behind local dev. The corresponding `frontend/pure-exports.json`, `package.json` and `scripts/check-frontend-boundary.mjs` changes were carried forward; the installer change was deliberately left untouched. No README, deployment/release file, Docker, browser, push or merge is involved.

## Review grouping and verification

Changes remain uncommitted as explicitly requested. Suggested logical commits, each with the two requested co-author trailers:

1. `feat(governance): add registers, reviews and confidential case services` — migration, validation, role/crypto/file gates, scheduling and service integration.
2. `feat(governance): add manual extras screens and immutable board packs` — forms, screens, evidence controls, CSV, pack PDF/bundle, navigation and frontend contracts.
3. `fix(frontend): load inherited finance views before rendering` — guarded finance loaders and rendering-only components.
4. `test(governance): cover extras and document manual operations` — unit/integration coverage, repeatable demo seed and this guide.

Final validation totals and any inherited scan limitations are recorded in the hand-off. No feature is a simulated connector or placeholder.

## Verification recorded

- Migration deployed to `sww_people` and prepared in `sww_people_test`; real private Silo transport used bucket `sww-govextras`.
- Lint passes with zero warnings. Unit suite: 73 files, 1,015 passed and one inherited skip. PostgreSQL/Silo suite: 42 files and 430 passed. A final area-only run passes all 16 integration cases, including current authorisation, tenancy, revoked appointments, broad-export exclusion, repeatable seed, reminder races, immutable evidence and PDF pagination.
- Frontend catalog: 196 guarded views, 290 actions, 486 transport types and 32 shared UI types. No stale generated readers. Final frontend typecheck and static database boundary check pass; contract source hash matches the current sources.
- PDF verification rendered a normal pack and a four-page long report, checked the first/last page layout and retained final-section text, and verified ZIP entry CRCs and manifest/evidence contents.
- The commit-message terminology scan has no findings. The required tracked-file scan has 31 inherited findings, verified identical to the starting commit. No newly introduced source, identifier, document or commit message adds a finding. Historical persistence names/migrations were not rewritten.
- Browser, mobile visual, live keyboard and screen-reader interaction checks were not run because browser use was explicitly prohibited.
- Optional frontend production bundle compilation passed. Its repeated build-time typecheck was stopped to reduce overlapping compiler work; the separately required frontend typecheck and database boundary check completed successfully.

- Backend production build passes, including its full TypeScript phase and static-page generation. The standalone typecheck also passes using the production build cache, with the requested 4096 MB Node heap. Root and frontend .next artifacts were removed after verification.
